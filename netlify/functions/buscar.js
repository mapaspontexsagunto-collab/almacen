// Función intermediaria segura: recibe la imagen desde la app,
// llama a Groq (Llama con visión) usando la clave secreta guardada en Netlify,
// y devuelve el texto de respuesta. La clave NUNCA llega al navegador.
//
// Groq es gratuito y sin tarjeta. La clave empieza por "gsk_".
// Se guarda en Netlify como variable GEMINI_API_KEY (reutilizamos el nombre
// para no tener que cambiar nada más).

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta la clave (GEMINI_API_KEY)' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { image, prompt } = body;
  if (!image || !prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Faltan datos (image/prompt)' }) };
  }

  // Modelo de Groq con visión (ve imágenes). Rápido y gratuito.
  const MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  // Groq usa el formato compatible con OpenAI: la imagen va como data URL
  const payload = {
    model: MODEL,
    temperature: 0.2,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,' + image }
          }
        ]
      }
    ]
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    // --- DIAGNÓSTICO: se ve en el log de Netlify ---
    console.log('GROQ status:', res.status);
    console.log('GROQ respuesta:', JSON.stringify(data).slice(0, 800));

    if (!res.ok) {
      const msg = (data && data.error && data.error.message) ? data.error.message : 'desconocido';
      console.log('GROQ ERROR:', msg);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Error de Groq', detail: data })
      };
    }

    // Extraer el texto de la respuesta (formato OpenAI)
    const text =
      (data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content) || '';

    console.log('GROQ texto extraído (primeros 200):', text.slice(0, 200));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    };
  } catch (err) {
    console.log('FALLO al llamar a Groq:', String(err));
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Fallo al llamar a Groq', detail: String(err) })
    };
  }
};
