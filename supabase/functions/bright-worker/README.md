# bright-worker (función Edge de Supabase)

Intermediaria entre la app del almacén y Gemini (leer facturas y reconocer fotos) y Brave (búsqueda web).
`index.ts` es la **referencia en el repositorio**. La función que responde de verdad vive en el panel de
Supabase (Edge Functions) y **no se actualiza al hacer commit**: hay que desplegarla a mano.

**Desplegar `bright-worker` es obligatorio:** hasta entonces la función en producción no tiene las comprobaciones nuevas
(rol de administrador para factura, instrucción de foto y tope de prompt, límites de uso y tamaño de imagen).

## Secretos que necesita (solo los nombres; los valores nunca van al repositorio)

| Secreto | Para qué |
|---|---|
| `GEMINI_API_KEY` | Clave de la API de Gemini (Google AI Studio). Obligatoria. |
| `BRAVE_API_KEY` | Clave de Brave Search API. Obligatoria para la búsqueda web. |
| `GEMINI_MODEL` | Opcional. Modelo de Gemini (por defecto `gemini-2.5-flash`). **Confirma que el nombre coincide con el que usa hoy la función desplegada** y ponlo aquí si es otro. Si el nombre contiene `flash` (y no `-pro`) la función manda `thinkingConfig {thinkingBudget: 0}` (sin tokens de razonamiento, que cuentan contra el tope de salida y podían cortar el JSON); con un modelo `-pro` no se manda. Si cambias a un modelo que no acepte `thinkingBudget`, la función recibirá un 400 de Gemini (422 `upstream_rejected`). |
| `ALLOWED_ORIGINS` | Opcional. Orígenes extra permitidos por CORS, separados por comas (p. ej. `http://localhost:8080` para pruebas). El origen de la app (GitHub Pages) ya va en el código. |
| `RATE_LIMIT_AI_PER_HOUR` | Opcional. Llamadas a Gemini por usuario y hora (por defecto 30). |
| `RATE_LIMIT_WEB_PER_HOUR` | Opcional. Llamadas a Brave por usuario y hora (por defecto **20**; cada búsqueda de la app hace 4 llamadas, así que son 5 búsquedas por hora). |
| `RATE_LIMIT_WEB_PER_DAY` | Opcional. Llamadas a Brave por usuario y **día** (por defecto **40** = 10 búsquedas de la app al día). Acota el gasto mensual de un solo usuario. |

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
- Rechaza sin sesión de usuario (401), sesiones anónimas, campos desconocidos (400), `Content-Length` no numérico (400),
  imágenes de más de 5 M de caracteres base64 (413) y formatos que no sean JPEG/PNG/WEBP (415: se comprueban los
  bytes reales de la cabecera, solo base64 estándar con longitud múltiplo de 4). El cuerpo se lee por flujo y se corta
  con 413 al pasar el máximo en bytes aunque no venga `Content-Length`.
- La libertad de prompt es solo para administradores. Un usuario que no es administrador (solo puede pedir fotos) tiene un tope de prompt de
  2200 caracteres (413 `payload_too_large`, el mismo código que para una imagen demasiado grande) y la instrucción de sistema fija
  (mejor esfuerzo, no una garantía). Los prompts de foto de la app miden ~900-1000 caracteres sin la lista de categorías, y la app recorta esa
  lista a ~1000 caracteres, así que caben aunque haya 500 categorías de 60 caracteres (el tope está en el cliente, no en la función).
- Gemini: se pide `application/json` (los dos prompts de la app piden JSON); topes de salida 16384 (factura) y 1500 (foto).
- Errores del proveedor: 4xx distinto de 429 -> **422** `upstream_rejected` (no transitorio, la app no lo reintenta);
  429 -> 429; 5xx o red -> 502; tiempo agotado -> 504 (la función corta a los 50 s; la app espera hasta 70 s).
  Cuando el proveedor falla se devuelve el hueco del límite de uso: solo cuentan las llamadas que van bien.
- Límite por usuario, **en memoria**: IA por hora; Brave por hora (20) y por día (40). Es de mejor esfuerzo (cada
  instancia lleva su cuenta y se reinicia al reciclarse). Frena el abuso normal, no a un atacante decidido.
- **Registros desactivados:** confirma en Supabase -> Authentication -> Sign In / Providers que
  *Allow new users to sign up* está **desactivado**. Con los registros abiertos, cualquiera podría crear una cuenta y usar la
  función (IA y Brave) dentro de esos límites.
- Si se despliega esta versión con una app antigua en caché (que no manda `purpose`), los administradores siguen
  funcionando; los usuarios normales solo pueden usar la función para fotos de componentes.

## Probar tras desplegar

1. Entrar en la app con un usuario normal: *Buscar por foto* y *Buscar info técnica en internet* deben funcionar.
2. Entrar como administrador: *Escanear factura* debe funcionar.
3. (Opcional) Con la sesión de un usuario normal, una petición con `purpose: "factura"` debe devolver 403.
4. Escanear una factura larga (varias decenas de líneas): el JSON debe llegar completo (con el razonamiento de Gemini 2.5
   activado, sus tokens podrían cortarlo; por eso se desactiva).

Si TODAS las fotos devuelven 422 (`upstream_rejected`), lo más probable es que `GEMINI_API_KEY` o `GEMINI_MODEL` sean incorrectos
(clave inválida o sin permiso, o un nombre de modelo que no existe o no acepta `thinkingBudget`).

## Tests

`node --test tests/seguridad.test.js` ejecuta esta función en Node con un Deno simulado, usando el soporte de TypeScript
de Node (22.18+ o 24). En un Node sin él, esos tests se **omiten** en silencio; con `REQUIRE_TS_TESTS=1` fallan en su lugar
(úsalo en la integración continua). En PowerShell, desde la raíz del repositorio:

```powershell
$env:REQUIRE_TS_TESTS='1'; node --test tests/seguridad.test.js
```
