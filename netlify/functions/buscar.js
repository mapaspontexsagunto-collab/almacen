// Función intermediaria: recibe imagen+prompt desde la app, llama a Google Gemini
// con la clave secreta guardada en Netlify y devuelve { text }.
// La clave NUNCA llega al navegador.
//
// Gemini free tier: 1.500 peticiones/día, 1 millón de tokens/minuto.
// Clave gratis en aistudio.google.com (empieza por AIza o Aq., ambas válidas).

exports.handler = async (event) => {
  const resp = (statusCode, obj) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  });

  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method Not Allowed' });

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) return resp(500, { error: 'Falta la clave (GEMINI_API_KEY) en Netlify' });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return resp(400, { error: 'JSON inválido' }); }

  const { image, prompt } = body;
  if (!image || !prompt) return resp(400, { error: 'Faltan datos (image/prompt)' });

  // Gemini 2.0 Flash: rápido, gratuito y soporta imágenes.
  const MODEL = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: image } }
      ]
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1000
    }
  };

  // Hasta 2 intentos ante errores transitorios de red o saturación (5xx).
  let last = { status: 0, msg: 'desconocido' };

  for (let intento = 1; intento <= 2; intento++) {
    let res, data;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      data = await res.json();
    } catch (err) {
      console.log('FALLO de red al llamar a Gemini:', String(err));
      last = { status: 503, msg: String(err) };
      if (intento < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
      break;
    }

    console.log('GEMINI status:', res.status);

    if (res.ok) {
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) {
        const reason = data?.candidates?.[0]?.finishReason || 'respuesta vacía';
        console.log('GEMINI sin texto:', reason);
        return resp(502, { error: 'Gemini no devolvió texto', detail: reason });
      }
      console.log('GEMINI respuesta (primeros 200):', text.slice(0, 200));
      return resp(200, { text });
    }

    const msg = data?.error?.message || 'desconocido';
    console.log('GEMINI ERROR ' + res.status + ':', msg);
    last = { status: res.status, msg };

    // Reintentar solo ante saturación transitoria (5xx), no ante límite (429).
    if (res.status >= 500 && intento < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
    break;
  }

  const out = (last.status === 429 || last.status >= 500) ? last.status : 502;
  return resp(out, { error: 'Gemini devolvió un error', status: last.status, message: last.msg });
};
