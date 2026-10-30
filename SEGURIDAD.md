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

## Regla sin conexión: solo consulta
Cualquier cambio (stock, compras, artículos, ubicaciones, borrados, importaciones) exige conexión real con la nube.
Sin ella la app avisa con una barra naranja y solo permite consultar (buscar, abrir fichas, ver el mapa, escanear QR).
Un corte momentáneo (cambio de repetidor wifi) se reintenta una vez antes de avisar.

## Altas y bajas de personas
- Alta: Supabase → Authentication → Users → Add user (correo y contraseña).
- Administrador nuevo: ejecutar en el SQL Editor
  `UPDATE auth.users SET raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'::jsonb WHERE email = 'correo@empresa.com';`
  y esa persona debe cerrar sesión y volver a entrar.
- Quitar el rol: `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE email = 'correo@empresa.com';`
  (la sesión actual sigue valiendo hasta que se renueva, aprox. 1 hora).
- Baja: borrar el usuario en Authentication → Users.

## Ficheros SQL
- `supabase_admin_roles.sql`: permisos por rol. **Es la política vigente.**
- `supabase_usuario_movimientos.sql`: columna `usuario` rellenada por la base de datos.
- `supabase_movimientos_unicos.sql`: evita movimientos duplicados.
- `supabase_endurecimiento.sql` (ejecutar **después** de los tres anteriores; es idempotente y no borra ni modifica filas): corrige el disparador de `usuario`
  (solo escribe el correo si el rol es `authenticated`; con SQL Editor o restauraciones se respeta el valor), crea índices del histórico de precios,
  quita permisos que sobran (anon sin ninguno en las tablas del almacén; sin TRUNCATE/TRIGGER/REFERENCES para authenticated; EXECUTE de las funciones
  auxiliares solo para authenticated), cierra `app_auth`, añade límites de tamaño NOT VALID (config < 200000 bytes, foto < 1000000, notas < 2000 caracteres)
  y termina con una tabla de comprobación (OK / REVISAR). Si se vuelve a ejecutar `supabase_usuario_movimientos.sql`, repetir este fichero, porque
  reinstala la versión antigua del disparador.
- `supabase_setup.sql`: heredado, no hace falta.
- Se eliminó `supabase_seguridad.sql`: volver a ejecutarlo habría deshecho los permisos de administrador.

## Riesgos conocidos y límites
- **Origen compartido.** La app está en `mapaspontexsagunto-collab.github.io/almacen`, el mismo dominio que otras webs de esa
  cuenta. El navegador guarda la sesión por dominio, no por carpeta: un fallo de seguridad en cualquiera de esas webs podría
  leer la sesión. Lo ideal es alojar el almacén en su propio dominio o en otra cuenta de GitHub.
- Las contraseñas del acceso antiguo siguen en el historial público de GitHub. Si alguna se reutilizó en otro sitio, cámbiala.
- El modo administrador de la pantalla se puede forzar desde la consola del navegador; la base de datos es la que impide
  borrar o modificar lo protegido. Siguen siendo legibles para cualquier usuario con sesión: precios de artículos
  (`items.precio`), costes y proveedores de las compras y el correo de quien hizo cada movimiento.
- Si alguien reactiva los registros o un proveedor externo en Supabase, cualquiera podría acceder. Mantén desactivados
  *Allow new users to sign up* y *Allow anonymous sign-ins*.
- Cualquier usuario con sesión puede modificar la configuración compartida (categorías, estanterías, mapa). La app valida
  los datos al leerlos, pero un usuario malintencionado podría desordenarlos.
- Mover entre almacenes no registra movimientos de entrada y salida.
- No hay registro de quién crea, edita o borra artículos, solo de los movimientos de stock.
- No hay CSP (GitHub Pages no permite cabeceras). Las librerías externas llevan control de integridad (SRI); al actualizar
  una versión hay que recalcular su hash.
- El stock se corrige leyendo el valor actual antes de cada cambio; dos personas actuando en el mismo segundo sobre el mismo
  artículo podrían pisarse. Editar el formulario de un artículo guarda también el stock que tenía al abrirlo.
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
  (los únicos que la base de datos reserva a administradores); en las demás claves el valor local sigue pendiente. Importar una copia
  exige modo administrador desde el principio (antes de leer el archivo) y conserva la foto del dispositivo si la copia no trae una.
- Historial e informes: el Excel de movimientos, los costes del mes y su PDF leen la nube de forma estricta; si no se puede leer
  el historial se aborta con "No se pudo leer el historial de la nube" (nunca salen informes parciales). Inicio sí muestra lo local
  pero con un aviso visible. Solo se consulta la ventana necesaria (6 meses en Inicio, el mes en Costes, el rango pedido al exportar).
- Borrar una línea del historial solo borra la copia local si la nube la borró (o ya no existía, comprobado con una lectura que sí devuelve filas:
  con la sesión caducada la base de datos devuelve 0 filas sin error y eso NO cuenta como borrado; igual al borrar artículos); un fallo de red lo avisa y no toca nada.
  El proveedor de un movimiento solo se descarta si la tabla no tiene la columna `provider` (se avisa en el toast final de la compra, una vez por sesión,
  y en el aviso de Inicio); cualquier otro fallo lo deja pendiente.
- Mover entre almacenes lee el stock actual de la nube antes de copiar y solo quita el artículo de aquí si la copia se subió y el borrado
  en la nube tuvo éxito; si no, avisa "queda en los dos almacenes" (el borrado pendiente se reintenta al sincronizar). "Borrar todo" y
  "mover varios" informan de cuántos salieron bien y fallaron. "Borrar todo" exige conexión, no corre a la vez que otra operación, se para en el
  primer fallo y no deja borrados en cola (el resto sigue en el inventario; nada se borra solo al sincronizar sin una nueva confirmación).

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
- En los textos de los artículos (nombre, referencia, marca, máquina, notas) se eliminan los caracteres < y > al leerlos.
- Los PDF se leen con pdf.js 3.11.174 fijado: el script lleva control de integridad (SRI), el worker se verifica por huella antes de usarlo,
  y se abre con `isEvalSupported:false` (mitigación de CVE-2024-4367). Máximo 15 MB y 3 páginas por documento.
- La función `bright-worker` tiene ahora su código de referencia en `supabase/functions/bright-worker/index.ts` (con README de despliegue), pero
  **la que responde de verdad vive en el panel de Supabase y hay que desplegarla a mano** (`supabase functions deploy bright-worker`); hasta entonces
  sigue valiendo la versión antigua. La versión del repositorio verifica el token contra Supabase Auth, exige `app_metadata.role = 'admin'` cuando la app
  manda `purpose: 'factura'` (la app lo manda desde el escáner de facturas y manda `'foto'` en el resto), limita el tamaño (imagen 2,5 M de caracteres,
  prompt 4000), fija el máximo de salida, rechaza campos desconocidos y limita el uso por usuario y hora **en memoria, de mejor esfuerzo** (cada instancia
  lleva su cuenta y se reinicia al reciclarse; no frena a un atacante decidido). `purpose` lo envía el cliente: un usuario normal que lo omita no obtiene
  el rol de administrador, pero sí podría mandar un prompt propio con una foto; por eso a quien no es administrador se le aplica una instrucción fija
  (mejor esfuerzo) que limita la función a fotos de componentes. La función acepta el prompt que manda el cliente (necesario para las facturas).
  Fotos de artículos y consultas de búsqueda también salen hacia Gemini y Brave. Antes de esta versión bastaba una sesión de usuario y debía limitar
  el tamaño de la imagen; el rol de administrador no se comprobaba dentro de la función.
- La seguridad real de los datos es RLS y el rol de administrador en Supabase, no el candado de la pantalla: cualquier usuario con
  sesión podría escribir artículos y movimientos llamando a la API; la base de datos reserva a los administradores el histórico de precios
  y, además, borrar artículos y modificar o borrar movimientos.
