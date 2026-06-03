// Función intermediaria segura: recibe la imagen desde la app, llama a Groq
// (Llama con visión) con la clave secreta de Netlify y devuelve { text }.
// La clave NUNCA llega al navegador.
//
// Groq es gratuito y sin tarjeta. La clave empieza por "gsk_".
// Se guarda en Netlify como variable GEMINI_API_KEY (se reutiliza el nombre).
//
// MEJORAS de esta versión:
//  - Reintenta una vez ante errores transitorios de saturación (5xx) o de red.
//  - REENVÍA el código de error real (p.ej. 429 = límite de Groq alcanzado),
//    para que la app muestre un mensaje claro en lugar de un 502 genérico.

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

  // Modelo de Groq con visión (ve imágenes). Rápido y gratuito.
  const MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  // Groq usa el formato compatible con OpenAI: la imagen va como data URL.
  const payload = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + image } }
        ]
      }
    ]
  };

  // Hasta 2 intentos. El 2.º solo si fue un error transitorio (5xx o red);
  // el 429 (límite) NO se reintenta aquí porque no se libera en 1-2 segundos.
  let last = { status: 0, msg: 'desconocido' };

  for (let intento = 1; intento <= 2; intento++) {
    let res, data;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + API_KEY
        },
        body: JSON.stringify(payload)
      });
      data = await res.json();
    } catch (err) {
      console.log('FALLO de red al llamar a Groq:', String(err));
      last = { status: 503, msg: String(err) };
      if (intento < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
      break;
    }

    console.log('GROQ status:', res.status);

    if (res.ok) {
      const text =
        (data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content) || '';
      if (!text) return resp(502, { error: 'La IA no devolvió texto', detail: data });
      console.log('GROQ texto extraído (primeros 200):', text.slice(0, 200));
      return resp(200, { text });
    }

    const msg = (data && data.error && data.error.message) ? data.error.message : 'desconocido';
    console.log('GROQ ERROR ' + res.status + ':', msg);
    last = { status: res.status, msg };

    // Reintentar solo si es saturación transitoria (5xx).
    if (res.status >= 500 && intento < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
    break;
  }

  // Reenviar el código real: 429 = límite alcanzado, 5xx = saturación.
  const out = (last.status === 429 || last.status >= 500) ? last.status : 502;
  return resp(out, { error: 'Groq devolvió un error', status: last.status, message: last.msg });
};
