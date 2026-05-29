// Función intermediaria segura: recibe la imagen desde la app,
// llama a Google Gemini con la clave secreta (guardada en Netlify),
// y devuelve el texto de respuesta. La clave NUNCA llega al navegador.

exports.handler = async (event) => {
  // Solo aceptar POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Falta GEMINI_API_KEY' }) };
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

  // Modelo gratuito y rápido con visión
  const MODEL = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: image } }
        ]
      }
    ],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1000 }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': API_KEY
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Error de Gemini', detail: data })
      };
    }

    // Extraer el texto de la respuesta de Gemini
    const text =
      (data.candidates &&
        data.candidates[0] &&
        data.candidates[0].content &&
        data.candidates[0].content.parts &&
        data.candidates[0].content.parts.map(p => p.text || '').join('')) || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Fallo al llamar a Gemini', detail: String(err) })
    };
  }
};
