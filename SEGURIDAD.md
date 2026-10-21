# Seguridad — pasos que hay que hacer en Supabase y GitHub

El código de la aplicación ya no lleva contraseñas por defecto y valida los datos que llegan de la nube.
Lo que sigue **no se puede arreglar solo con código**: hay que hacerlo en Supabase/GitHub.

## 1. Cambiar TODAS las contraseñas (urgente)
Las contraseñas antiguas siguen en el historial público de GitHub y la tabla `app_auth` se podía leer sin autenticar.
Considera que están comprometidas.
- Cambia las claves en la app (Ajustes → Accesos) o con el SQL Editor (`UPDATE app_auth SET value='...' WHERE key='...'`).
- Cambia la contraseña de administrador.
- Pon el repositorio en **privado** (Settings → General → Danger Zone), salvo que necesites que sea público.
- Borra de la tabla `config` y `config_mec` la fila con `key = 'loginCfg'` y revisa `adminPass` (guardan claves en claro).

## 2. Pasar a Supabase Auth (acceso real, protegido en el servidor)
1. Supabase → Authentication → Users → **Add user** (correo + contraseña) para cada persona.
2. Authentication → Sign In / Providers → desactiva **Allow new users to sign up** y **Allow anonymous sign-ins**.
   (Si no, cualquiera podría crearse una cuenta y entrar en los datos.)
3. En `almacen-electrico/config.js` y `almacen-mecanico/config.js` pon `useSupabaseAuth: true` y despliega.
   Desde ese momento se entra con el **correo** y la contraseña de Supabase.
4. Comprueba que puedes entrar y ver el inventario en los dos almacenes.
5. Ejecuta `supabase_seguridad.sql` en el SQL Editor. Deja las tablas accesibles solo a usuarios autenticados.

## 3. Función Edge `bright-worker`
Supabase → Edge Functions → bright-worker → activa **Verify JWT**. La app ya envía el token del usuario.
Añade límite de tamaño de imagen y de peticiones por usuario dentro de la función (su código no está en este repositorio).

## Qué sigue pendiente (limitaciones conocidas)
- La **contraseña de administrador** (precios, costes, ajustes) se comprueba en el navegador y la base de datos no la aplica:
  cualquier usuario autenticado puede leer precios y la huella (hash) de esa contraseña. Si hace falta separar
  administradores, hay que añadir un rol en `app_metadata` y políticas por rol.
  Tras actualizar, cambia la contraseña de administrador una vez para que se guarde como hash y no en claro.
- El stock se corrige leyendo el valor actual de la nube antes de cada cambio, pero no es atómico:
  para evitar cualquier carrera entre dos personas haría falta una función RPC (`update ... set stock = stock + delta`).
- Mover entre almacenes no escribe movimientos de entrada/salida.
- No hay CSP. Las librerías externas ya llevan `integrity` (SRI); al actualizar una versión hay que recalcular su hash.
- Sin conexión a internet no se puede iniciar sesión si se usa Supabase Auth (con sesión ya abierta sí funciona).

## Quién hace cada movimiento (historial por usuario)
1. Crea **un usuario por persona** en Supabase (Authentication → Users). No compartáis correo.
2. Ejecuta `supabase_usuario_movimientos.sql` en el SQL Editor. Añade la columna `usuario` y la rellena el servidor
   con el correo de la sesión; no se puede falsear desde la app ni cambiar después.
3. La app muestra 👤 el nombre (la parte del correo antes de la @) en el historial, y añade la columna *Usuario* al Excel y al PDF, **solo con la contraseña de administrador desbloqueada**.
   Ojo: es una restricción de la pantalla. Cualquier usuario con sesión podría ver los correos si inspecciona las respuestas de la app.
- Solo queda registrado a partir de ese momento. Cubre entradas, salidas y compras.
- Si alguien hace un movimiento sin conexión y otra persona abre sesión en ese mismo móvil antes de que se sincronice, se anotará a nombre de quien sincronice. Conviene esperar a que se suba (el indicador de sincronización) antes de cerrar sesión.
- No registra quién crea, edita o borra artículos, ni quién borra una línea del historial (borrar líneas exige la contraseña de administrador).

## Administrador por usuario (sustituye a la contraseña de administrador)
Con Supabase Auth no hay contraseña de administrador: algunos usuarios se marcan como administradores en Supabase.
- Todos entran **bloqueados**. Quien es administrador pulsa el candado **🔒 Admin** (arriba) y confirma **Desbloquear**;
  puede volver a bloquear con el mismo botón. Quien no es administrador no puede desbloquear aunque lo intente.
- Pasos: 1) desplegar la app, 2) ejecutar el PASO A de `supabase_admin_roles.sql` con los correos de los administradores,
  3) esas personas cierran sesión y vuelven a entrar (para que su sesión lleve el rol), 4) ejecutar el PASO B.
- Lo que la **base de datos** ya exige solo a administradores: borrar artículos, modificar o borrar líneas del historial,
  leer y escribir el histórico de precios, y las filas antiguas de contraseñas (`adminPass`, `loginCfg`).
- Lo que sigue siendo solo de pantalla: ocultar costes, ajustes y el nombre de quién hizo cada movimiento.
  Los precios de los artículos (`items.precio`) los puede leer cualquier usuario con sesión si inspecciona las respuestas.
- Si un administrador borra algo sin conexión y otra persona sincroniza después en ese mismo móvil, el borrado no se aplica
  en la nube (la base de datos lo rechaza) hasta que lo sincronice un administrador.
