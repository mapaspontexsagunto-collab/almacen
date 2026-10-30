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
    etiquetas, movimientos e historial de precios. La lectura es estricta: si no se puede leer algo entero (o un almacén sale vacío),
    no se genera la copia. Sin conexión solo se exporta lo local (sin movimientos ni historial de precios) y el aviso lo dice.
  - Importar solo lo puede hacer un administrador y **fusiona** con la nube: crea o actualiza cada artículo por su código (también su stock)
    y NO borra los que no estén en el archivo. La configuración que traiga la copia sustituye a la actual; lo que no traiga (o traiga vacío)
    no se toca. NO restaura movimientos ni historial de precios (el trigger de movimientos pondría como autor a quien importa).
    Una copia de otro almacén se rechaza; las copias antiguas (versión 2 y 3, sin etiqueta) se aceptan avisando de que no se puede comprobar.
    Si algún artículo falla al subir, se para y se avisa "X de N"; los del almacén actual quedan en la cola de pendientes.
- La configuración (categorías, estanterías, plano, proveedores, etiquetas impresas) que no llega a la nube queda en una cola local
  (dirtyCfg) que se reintenta al sincronizar y no se pisa con el valor de la nube mientras esté pendiente; la app avisa de que
  "solo se guardó en este dispositivo". Si dos dispositivos cambian la misma clave sin conexión, gana el último que sincroniza.

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
- La función `bright-worker` no está en este repositorio: hoy basta una sesión de usuario (no solo administradores) y debe limitar
  el tamaño de la imagen. Si se quiere que solo la usen administradores, hay que comprobar el rol dentro de la función.
- La seguridad real de los datos es RLS y el rol de administrador en Supabase, no el candado de la pantalla: cualquier usuario con
  sesión podría escribir artículos y movimientos llamando a la API; la base de datos reserva a los administradores el histórico de precios
  y, además, borrar artículos y modificar o borrar movimientos.
