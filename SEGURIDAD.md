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
