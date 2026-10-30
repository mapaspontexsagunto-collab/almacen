# bright-worker (función Edge de Supabase)

Intermediaria entre la app del almacén y Gemini (leer facturas y reconocer fotos) y Brave (búsqueda web).
`index.ts` es la **referencia en el repositorio**. La función que responde de verdad vive en el panel de
Supabase (Edge Functions) y **no se actualiza al hacer commit**: hay que desplegarla a mano.

## Secretos que necesita (solo los nombres; los valores nunca van al repositorio)

| Secreto | Para qué |
|---|---|
| `GEMINI_API_KEY` | Clave de la API de Gemini (Google AI Studio). Obligatoria. |
| `BRAVE_API_KEY` | Clave de Brave Search API. Obligatoria para la búsqueda web. |
| `GEMINI_MODEL` | Opcional. Modelo de Gemini (por defecto `gemini-2.5-flash`). Pon aquí el que usa hoy la función desplegada si es otro. |
| `ALLOWED_ORIGINS` | Opcional. Orígenes extra permitidos por CORS, separados por comas (p. ej. `http://localhost:8080` para pruebas). El origen de la app (GitHub Pages) ya va en el código. |
| `RATE_LIMIT_AI_PER_HOUR` | Opcional. Llamadas a Gemini por usuario y hora (por defecto 30). |
| `RATE_LIMIT_WEB_PER_HOUR` | Opcional. Llamadas a Brave por usuario y hora (por defecto 60; cada búsqueda de la app hace 4). |

`SUPABASE_URL` y `SUPABASE_ANON_KEY` los inyecta Supabase solos; no hay que crearlos.

## Desplegar

Antes de sustituir la función actual, compara este fichero con el código que hay hoy en el panel (Edge Functions
-> bright-worker -> Code) por si tiene algo que aquí falte (por ejemplo, otro modelo de Gemini).

```bash
# Una vez: instalar la CLI de Supabase e iniciar sesión (supabase login), y enlazar el proyecto
supabase link --project-ref <referencia-del-proyecto>

# Guardar los secretos (te pide el valor; no lo escribas en ficheros ni en el chat)
supabase secrets set GEMINI_API_KEY=... BRAVE_API_KEY=...

# Desplegar
supabase functions deploy bright-worker
```

Alternativa sin la CLI: panel de Supabase -> Edge Functions -> bright-worker -> pegar el contenido de `index.ts`
y guardar; los secretos se editan en Edge Functions -> Secrets.

La opción "Verify JWT" de la función puede quedarse como está: el código comprueba además el token contra
Supabase Auth.

## Comportamiento

- Petición IA: `{image, prompt, purpose?}` -> `{text}`. `purpose = 'factura'` solo lo acepta para administradores
  (`app_metadata.role = 'admin'`); la app manda `'foto'` en el resto de casos.
- Petición web: `{mode:'web', query, num?}` -> `{results:[{title, link, display, snippet}]}`.
- Rechaza sin sesión de usuario (401), sesiones anónimas, campos desconocidos (400), imágenes de más de
  2,5 M de caracteres base64 (413) y formatos que no sean JPEG/PNG/WEBP (415).
- Límite por usuario y hora, **en memoria**: es de mejor esfuerzo (cada instancia lleva su cuenta y se reinicia
  al reciclarse). Frena el abuso normal, no a un atacante decidido.
- Si se despliega esta versión con una app antigua en caché (que no manda `purpose`), los administradores siguen
  funcionando; los usuarios normales solo pueden usar la función para fotos de componentes.

## Probar tras desplegar

1. Entrar en la app con un usuario normal: *Buscar con IA* (foto) y *Buscar info técnica en internet* deben funcionar.
2. Entrar como administrador: *Escanear factura* debe funcionar.
3. (Opcional) Con la sesión de un usuario normal, una petición con `purpose: "factura"` debe devolver 403.
