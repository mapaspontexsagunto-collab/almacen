// Función intermediaria de Netlify. Dos modos:
//
//  1) MODO IA (por defecto): recibe imagen+prompt, llama a Google Gemini con la
//     clave secreta GEMINI_API_KEY y devuelve { text }.
//
//  2) MODO WEB ({ mode:'web', query }): busca en internet con Brave Search API
//     usando BRAVE_API_KEY y devuelve { results:[{title,link,snippet,display}] }.
//
// Las claves NUNCA llegan al navegador.

exports.handler = async (event) => {
  const resp = (statusCode, obj) => ({
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  });

  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body); }
  catch (e) { return resp(400, { error: 'JSON inválido' }); }

  // ============================================================
  //  MODO WEB: búsqueda de información técnica en internet (Brave)
  // ============================================================
  if (body.mode === 'web') {
    const BRAVE_KEY = process.env.BRAVE_API_KEY;
    if (!BRAVE_KEY) return resp(500, { error: 'Falta BRAVE_API_KEY en Netlify' });

    const query = (body.query || '').toString().trim();
    if (!query) return resp(400, { error: 'Falta la consulta (query)' });

    const count = Math.min(Math.max(parseInt(body.num) || 6, 1), 10);
    const url = 'https://api.search.brave.com/res/v1/web/search'
      + `?q=${encodeURIComponent(query)}`
      + `&count=${count}&country=es&search_lang=es`;

    let last = { status: 0, msg: 'desconocido' };
    for (let intento = 1; intento <= 2; intento++) {
      let res, data;
      try {
        res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': BRAVE_KEY
          }
        });
        data = await res.json();
      } catch (err) {
        last = { status: 503, msg: String(err) };
        if (intento < 2) { await new Promise(r => setTimeout(r, 1200)); continue; }
        break;
      }

      if (res.ok) {
        const arr = (data && data.web && data.web.results) ? data.web.results : [];
        const results = arr.map(it => ({
          title: it.title || '',
          link: it.url || '',
          snippet: it.description || '',
          display: (it.meta_url && it.meta_url.hostname) ? it.meta_url.hostname : ''
        }));
        return resp(200, { results });
      }

      const msg = (data && data.error && (data.error.detail || data.error.message)) || 'desconocido';
      last = { status: res.status, msg };
      if (res.status >= 500 && intento < 2) { await new Promise(r => setTimeout(r, 1200)); continue; }
      break;
    }
    const out = (last.status === 429 || last.status >= 500) ? last.status : 502;
    return resp(out, { error: 'Búsqueda web falló', status: last.status, message: last.msg });
  }

  // ============================================================
  //  MODO IA: identificación por imagen con Gemini
  // ============================================================
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) return resp(500, { error: 'Falta la clave (GEMINI_API_KEY) en Netlify' });

  const { image, prompt } = body;
  if (!image || !prompt) return resp(400, { error: 'Faltan datos (image/prompt)' });

  // Gemini 2.5 Flash: rápido, gratuito y soporta imágenes.
  const MODEL = 'gemini-2.5-flash';
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
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 }
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

    if (res.status >= 500 && intento < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
    break;
  }

  const out = (last.status === 429 || last.status >= 500) ? last.status : 502;
  return resp(out, { error: 'Gemini devolvió un error', status: last.status, message: last.msg });
};
