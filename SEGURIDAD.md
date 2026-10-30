# Seguridad y funcionamiento — estado actual

## Cómo funciona el acceso
- Cada persona entra con **su propio usuario de Supabase** (correo y contraseña). Los registros libres están desactivados.
- Un usuario puede ser **administrador** (rol `app_metadata.role = 'admin'`, ver `supabase_admin_roles.sql`).
  Todos entran bloqueados; el administrador pulsa el candado 🔒 de la cabecera para activar el modo administrador.
- La base de datos solo responde a usuarios con sesión. Lo que exige rol de administrador en la propia base de datos:
  borrar artículos, modificar o borrar líneas del historial, leer y escribir el histórico de precios y las filas
  antiguas de contraseñas.
- Los movimientos de stock guardan quién los hizo (`usuario`, lo escribe un disparador de la base de datos).
  Solo se muestra con el modo administrador activado (restricción de pantalla).
- La función `bright-worker` (IA de fotos y búsqueda web) solo responde a usuarios con sesión.
- Solo se entra con Supabase Auth: el acceso antiguo (usuario y contraseña de una tabla propia, contraseña única de Ajustes) se eliminó
  del código; con `useSupabaseAuth:false` en `config.js` ya no se puede entrar. La app sigue borrando del móvil los restos de aquel acceso
  (`almacen_auth_cache`, `almacen_login`).
- El cliente de Supabase se crea con `detectSessionInUrl:false` y flujo PKCE: un enlace con `#access_token=...` no puede sustituir la sesión
  de quien lo abre (la app no usa enlaces de acceso ni de recuperación de contraseña).

## Regla sin conexión: solo consulta
Cualquier cambio (stock, compras, artículos, ubicaciones, borrados, importaciones) exige conexión real con la nube.
Sin ella la app avisa con una barra naranja y solo permite consultar (buscar, abrir fichas, ver el mapa, escanear QR).
Un corte momentáneo (cambio de repetidor wifi) se reintenta una vez antes de avisar.
Excepciones: imprimir etiquetas las marca como impresas (`savePrintedIds`) sin exigir conexión, y el proveedor de una compra o factura se anota
en la lista de proveedores (`addProvider`) aunque la nube no responda; en ambos casos el cambio se escribe en el móvil y, si no llega a la nube,
queda en la cola de configuración pendiente (`dirtyCfg`) hasta que se sube.

## Altas y bajas de personas
- Alta: Supabase → Authentication → Users → Add user (correo y contraseña).
- Administrador nuevo: ejecutar en el SQL Editor
  `UPDATE auth.users SET raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'::jsonb WHERE email = 'correo@empresa.com';`
  y esa persona debe cerrar sesión y volver a entrar.
- Quitar el rol: `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE email = 'correo@empresa.com';`
  (la sesión actual sigue valiendo hasta que se renueva, aprox. 1 hora).
- Baja: borrar el usuario en Authentication → Users. Su móvil conserva en la base local (IndexedDB) lo ya descargado (artículos con precio,
  fotos, movimientos) y puede consultarlo sin conexión mientras siga con la sesión iniciada: la baja en Supabase no vacía el móvil. Esa base
  solo se vacía cuando la persona cierra sesión (ver más abajo) o borra los datos del navegador.

## Ficheros SQL
- `supabase_admin_roles.sql`: permisos por rol. **Es la política vigente.**
- `supabase_usuario_movimientos.sql`: columna `usuario` rellenada por la base de datos.
- `supabase_movimientos_unicos.sql`: evita movimientos duplicados.
- `supabase_setup.sql`: heredado, no hace falta.
- Se eliminó `supabase_seguridad.sql`: volver a ejecutarlo habría deshecho los permisos de administrador.

## Riesgos conocidos y límites
- **Origen compartido.** La app está en `mapaspontexsagunto-collab.github.io/almacen`, el mismo dominio que otras webs de esa
  cuenta. El navegador guarda la sesión por dominio, no por carpeta: un fallo de seguridad en cualquiera de esas webs podría
  leer la sesión. Lo ideal es alojar el almacén en su propio dominio o en otra cuenta de GitHub. Lo mismo vale para la base local
  (IndexedDB) y el historial de búsqueda, que también son por dominio.
- Las contraseñas del acceso antiguo siguen en el historial público de GitHub. Si alguna se reutilizó en otro sitio, cámbiala.
- El modo administrador de la pantalla se puede forzar desde la consola del navegador; la base de datos es la que impide
  borrar o modificar lo protegido. Siguen siendo legibles para cualquier usuario con sesión: precios de artículos
  (`items.precio`), costes y proveedores de las compras y el correo de quien hizo cada movimiento.
- Si alguien reactiva los registros o un proveedor externo en Supabase, cualquiera podría acceder. Mantén desactivados
  *Allow new users to sign up* y *Allow anonymous sign-ins*.
- Cualquier usuario con sesión puede modificar la configuración compartida (categorías, estanterías, mapa). La app valida
  los datos al leerlos (también al importar una copia) y los acota para que no puedan congelarla: como máximo 200 estanterías,
  200 pasillos, 500 categorías o proveedores de hasta 60 caracteres (y 500 familias por artículo), 8 bloques por balda y
  100 cajones (filas x columnas) por gavetero. Aun así, un usuario malintencionado podría desordenarlos. Los límites están en la
  app; la base de datos no los impone.
- Mover entre almacenes no registra movimientos de entrada y salida.
- No hay registro de quién crea, edita o borra artículos, solo de los movimientos de stock.
- No hay cabeceras de seguridad (GitHub Pages no permite configurarlas). Cada `index.html` lleva solo una CSP mínima por `<meta>`
  (`Content-Security-Policy`: `object-src 'none'; base-uri 'self'; form-action 'self'`). No lleva `script-src` ni `connect-src`: la
  app usa manejadores `onclick` en línea y una directiva equivocada la dejaría sin funcionar, así que NO frena la ejecución de scripts
  inyectados; la defensa real contra eso es escapar todo lo que se pinta (esc / jsq / cleanItem).
- Las librerías externas llevan control de integridad (SRI) y sus huellas están fijadas en tres sitios (`index.html`, constantes
  `PDFJS_*` de `app.js` y `CDN_SRI` de cada `sw.js`): al actualizar una versión hay que recalcular su hash en todos. El service worker
  solo guarda en caché una librería si su contenido coincide con esa huella (si no, la sirve desde la red sin guardarla), y la caché
  se renovó (versión v4) para descartar lo guardado antes de esa comprobación.
- El stock se corrige leyendo el valor actual de la nube antes de cada cambio; dos personas actuando en el mismo segundo sobre el mismo
  artículo podrían pisarse. Al editar el formulario de un artículo, si no se toca el stock se guarda el que hay en ese momento en la nube
  (se relee al guardar; si no se puede comprobar, no se guarda), y si se cambia se registra el movimiento respecto a ese stock actual.
- Copias de seguridad: el plan gratuito de Supabase no permite recuperar un punto anterior. Exporta desde Ajustes de vez en cuando.
  - La copia (versión 4) lleva la etiqueta del almacén, artículos con fotos, categorías, estanterías, plano, proveedores, estado de
    etiquetas, movimientos e historial de precios. La lectura es estricta: si no se puede leer algo entero, no se genera la copia.
    Un almacén vacío de verdad sí se exporta (el actual se lee del dispositivo; el otro, tras una sonda que confirma que la sesión puede leer).
    Si no se llega a la nube (una comprobación de 5 s, sin esperar a las lecturas) solo se exporta lo local (artículos, categorías,
    estanterías y configuración, sin movimientos ni historial de precios) y el aviso lo dice; si falta alguna foto en el dispositivo, no se genera.
    Si la nube responde pero falla la lectura del historial, no se genera la copia.
  - Importar solo lo puede hacer un administrador y **fusiona** con la nube: crea o actualiza cada artículo por su código (también su stock)
    y NO borra los que no estén en el archivo. La configuración que traiga la copia sustituye a la actual; lo que no traiga (o traiga vacío)
    no se toca. NO restaura movimientos ni historial de precios (el trigger de movimientos pondría como autor a quien importa).
    Una copia de otro almacén se rechaza; las copias antiguas (versión 2 y 3, sin etiqueta) se aceptan avisando de que no se puede comprobar.
    Si algún artículo falla al subir, se para y se avisa "X de N"; los del almacén actual quedan en la cola de pendientes.
- La configuración (categorías, estanterías, plano, proveedores, etiquetas impresas) que no llega a la nube queda en una cola local
  (dirtyCfg) que se reintenta al sincronizar y no se pisa con el valor de la nube mientras esté pendiente; la app avisa de que
  "solo se guardó en este dispositivo". Si dos dispositivos cambian la misma clave sin conexión, gana el último que sincroniza.
  Un contador por clave evita que una subida antigua limpie la marca de pendiente de un valor más nuevo, y la sincronización no pisa
  una clave que se guardó mientras leía la nube. Un error de permisos (42501) solo se da por definitivo en `adminPass` y `loginCfg`
  (claves del acceso antiguo que la app ya no escribe ni lee); en las demás claves el valor local sigue pendiente. Importar una copia
  exige modo administrador desde el principio (antes de leer el archivo) y conserva la foto del dispositivo si la copia no trae una.
- Historial e informes: el Excel de movimientos, los costes del mes y su PDF leen la nube de forma estricta; si no se puede leer
  el historial se aborta con "No se pudo leer el historial de la nube" (nunca salen informes parciales). Inicio sí muestra lo local
  pero con un aviso visible. Solo se consulta la ventana necesaria (6 meses en Inicio, el mes en Costes, el rango pedido al exportar).
  En los Excel (inventario y movimientos) todo texto se recorta a 32000 caracteres (una celda de más de 32767 corrompe el archivo) y, si
  empieza por `=`, `+`, `-` o `@`, se le antepone una comilla simple para que nunca se interprete como fórmula; los números siguen siendo
  números. La app no importa Excel (solo copias `.json`, que pasan por la validación de datos).
- Borrar una línea del historial solo borra la copia local si la nube la borró (o ya no existía, comprobado con una lectura que sí devuelve filas:
  con la sesión caducada la base de datos devuelve 0 filas sin error y eso NO cuenta como borrado; igual al borrar artículos); un fallo de red lo avisa y no toca nada.
  El proveedor de un movimiento solo se descarta si la tabla no tiene la columna `provider` (se avisa en el toast final de la compra, una vez por sesión,
  y en el aviso de Inicio); cualquier otro fallo lo deja pendiente.
- Mover entre almacenes lee el stock actual de la nube antes de copiar y solo quita el artículo de aquí si la copia se subió y el borrado
  en la nube tuvo éxito; si no, avisa "queda en los dos almacenes" (el borrado pendiente se reintenta al sincronizar). "Borrar todo" y
  "mover varios" informan de cuántos salieron bien y fallaron. "Borrar todo" exige conexión, no corre a la vez que otra operación, se para en el
  primer fallo y no deja borrados en cola (el resto sigue en el inventario; nada se borra solo al sincronizar sin una nueva confirmación).
- Cerrar sesión intenta primero subir lo pendiente (movimientos, artículos, borrados, columnas y configuración), esperando a que acabe
  una sincronización en curso. Si con conexión no se consigue, o no hay conexión, pide confirmación explícita avisando de que lo pendiente
  SE PERDERÁ; si se cancela no se toca nada, y si se acepta se descarta (así nunca se sube a nombre de quien entre después).
  Una vez cerrada la sesión, se vacía la base local del almacén actual (artículos con precio y fotos, movimientos, colas de pendientes y
  configuración) y el historial de búsqueda de los dos almacenes; el móvil queda sin datos de la persona anterior y no se puede consultar
  nada sin volver a entrar (para lo que hace falta conexión). Límite: la base del OTRO almacén solo se vacía si no tiene cambios sin
  subir (desde aquí no se pueden subir); si los tiene se conserva (aviso en la consola) y se subirían más adelante a nombre de quien
  entre después. Cerrar el navegador sin cerrar sesión no vacía nada.
- Con Supabase Auth, la comprobación de conexión de antes de cada cambio exige también una sesión viva: con la sesión caducada la app
  avisa "La sesión ha caducado" y funciona solo para consultar (solo si el servidor rechaza la sesión; un límite de peticiones, un fallo del servidor o la red se avisan como "Sin conexión"). Si la nube devuelve 0 artículos y hay artículos locales, se conservan
  los locales y el indicador queda en "Sin conexión" (no puede saberse si está de verdad vacía o es una sesión caducada).
- Al desplegar una versión nueva, la app abierta se recarga sola cuando no hay ventanas abiertas, ni editor del mapa abierto (borrador sin guardar), ni cambios de stock o sincronización
  en curso. El service worker falla la instalación si no puede guardar `index.html` o `app.js`, y busca solo en la caché de su almacén.
- Si la base de datos del móvil no se puede abrir (modo privado, bloqueada, sin espacio) aparece un aviso rojo con el botón Reintentar (si el fallo es otro, el aviso dice que la aplicación no ha podido arrancar). Un aviso de permiso de cámara sin contestar no bloquea el siguiente escaneo (espera máxima de 3 s).

## Datos que salen a terceros (IA y búsqueda web)
- Las funciones de IA y de búsqueda web pasan por `bright-worker`, que reenvía a Gemini (Google) y Brave Search. No solo las facturas:
  también la foto de un artículo (identificación y relleno automático desde foto) y los términos de búsqueda web (marca, referencia,
  tipo del artículo) salen de la empresa hacia esos servicios. No fotografíes ni busques nada que no deba salir.
- `bright-worker` acepta el texto de instrucciones (prompt) que le manda el cliente: cualquier usuario con sesión podría usarla como una
  IA genérica a cargo de la cuenta de la empresa. No distingue administradores de otros usuarios.
- Todo lo que devuelven esos servicios es dato no fiable: el dominio del fabricante solo se acepta como nombre de dominio puro (sin ruta,
  arroba ni dos puntos) y el enlace se construye como `https://<dominio>`.

## Escáner de facturas (IA)
- Solo para administradores (modo administrador activado) y con conexión. Al bloquear el modo administrador se cierra y se olvida la factura.
- **Privacidad:** cada factura se envía como imagen (hasta 3 páginas por documento, una petición por página) a la función
  `bright-worker` y de ahí a Gemini (Google). Contiene proveedor, precios y posiblemente direcciones o NIF, y las páginas
  segundas y terceras pueden llevar condiciones o datos bancarios. No subas documentos que no deban salir de la empresa.
- Todo lo que devuelve la IA se trata como dato no fiable: se limpia, se validan cantidad y precio (formato español "12,50" incluido,
  cantidades enteras, límites) y se muestra una confirmación con lo que se va a registrar antes de tocar el stock. El artículo lo elige siempre una persona.
- Cada entrada pasa por las mismas protecciones que una compra normal: conexión real, stock actual leído de la nube (si esa lectura
  tarda más de 5 s o hay un cambio local pendiente, se usa el stock del móvil), bloqueo anti doble pulsación.
  Una línea registrada no se puede repetir ni "deshacer" desde la factura (para corregir, ajusta el stock en la ficha del artículo).
- Crear un artículo desde una factura registra su compra con el stock final del formulario; con stock 0 no se registra nada y la línea sigue pendiente.
- Si se cierra la factura o se bloquea el modo administrador mientras la IA analiza, el resultado se descarta.
- El proveedor detectado se puede corregir o elegir de la lista de proveedores conocidos antes de registrar; se limpia igual que el resto (sin < ni > y máximo 80 caracteres).
- En los textos de los artículos (nombre, categoría, referencia, marca, máquina, notas) se eliminan los caracteres < y > al leerlos; en la
  ubicación y la posición se eliminan además comillas, `&`, acento grave y barras invertidas.
- Los PDF se leen con pdf.js 3.11.174 fijado: el script lleva control de integridad (SRI), el worker se verifica por huella antes de usarlo,
  y se abre con `isEvalSupported:false` (mitigación de CVE-2024-4367). Máximo 15 MB y 3 páginas por documento.
- La función `bright-worker` no está en este repositorio: hoy basta una sesión de usuario (no solo administradores) y debe limitar
  el tamaño de la imagen. Si se quiere que solo la usen administradores, hay que comprobar el rol dentro de la función.
- La seguridad real de los datos es RLS y el rol de administrador en Supabase, no el candado de la pantalla: cualquier usuario con
  sesión podría escribir artículos y movimientos llamando a la API; la base de datos reserva a los administradores el histórico de precios
  y, además, borrar artículos y modificar o borrar movimientos.
