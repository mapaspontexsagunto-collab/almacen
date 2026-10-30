-- ============================================================================
-- ENDURECIMIENTO DE LA BASE DE DATOS (bloque R6 de la auditoría final)
-- ============================================================================
-- Ejecutar en Supabase -> SQL Editor, DESPUÉS de supabase_admin_roles.sql,
-- supabase_usuario_movimientos.sql y supabase_movimientos_unicos.sql.
-- Es seguro repetirlo (idempotente) y NO borra ni modifica filas: no hay DROP TABLE,
-- DELETE ni TRUNCATE. No toca las políticas de RLS (esas son las de supabase_admin_roles.sql).
--
-- Qué hace (cada paso lleva su explicación más abajo):
--   1) Corrige el disparador que anota quién hizo cada movimiento (DB-M2).
--   2) Crea índices para el histórico de precios (DB-LOW3).
--   3) Quita permisos que sobran en las tablas del almacén y en las funciones auxiliares (DB-LOW4).
--   4) Cierra las tablas heredadas de contraseñas (app_auth) (DB-M1).
--   5) Añade límites de tamaño a artículos y configuración, sin bloquear filas existentes (SEC-M1).
--   6) Comprobación final: UNA sola tabla de resultados con OK / REVISAR en cada fila.
--
-- IMPORTANTE:
--   · Todo el script se ejecuta de una vez; si algo falla se corta y no se aplica nada más
--     (vuelve a ejecutarlo tras corregir el aviso).
--   · Si algún día vuelves a ejecutar supabase_usuario_movimientos.sql, ese fichero reinstala la
--     versión ANTIGUA de la función del apartado 1: vuelve a ejecutar este fichero después.
--   · El apartado 3 NO toca los permisos de lectura/escritura de los usuarios con sesión
--     (SELECT, INSERT, UPDATE, DELETE): siguen mandando las políticas de RLS. Un usuario normal
--     sigue pudiendo ver y crear artículos y movimientos.
-- ============================================================================

-- Si otra sesión tiene bloqueada una tabla, mejor fallar a los 5 s que dejar la app esperando.
SET lock_timeout = '5s';

-- Protección: este script es para Supabase (necesita los roles anon y authenticated y auth.jwt()).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Faltan los roles anon/authenticated: este script es para un proyecto de Supabase';
  END IF;
END $$;

-- ============ 1) Disparador de "usuario" del movimiento (DB-M2) ============
-- Antes: en TODO insert se escribía auth.jwt()->>'email'. Sin sesión (SQL Editor, restauraciones
-- con pg_restore, COPY) eso da NULL y se perdía quién hizo cada movimiento.
-- Ahora: en un UPDATE el usuario no cambia nunca; en un INSERT solo se sobrescribe con el correo
-- de la sesión si el rol es 'authenticated' (la app). Con cualquier otro rol (SQL Editor, servicio)
-- se respeta el valor que traiga la fila.
CREATE OR REPLACE FUNCTION public.set_movimiento_usuario() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.usuario := OLD.usuario;                     -- el usuario nunca se puede cambiar después
  ELSIF (auth.jwt() ->> 'role') = 'authenticated' THEN
    NEW.usuario := auth.jwt() ->> 'email';          -- lo pone el servidor con el correo de la sesión
  END IF;
  RETURN NEW;
END $$;

-- ============ 2) Índices del histórico de precios (DB-LOW3) ============
-- La app pide el histórico de un artículo ordenado por fecha (item_id, ts DESC) y el listado
-- completo por fecha (ts DESC). Sin índices cada consulta recorre toda la tabla.
-- CREATE INDEX IF NOT EXISTS: no falla si ya existen. Bloquea las escrituras de esa tabla
-- unos instantes (el histórico de precios es pequeño y solo lo escriben administradores).
DO $$
DECLARE s text; t text;
BEGIN
  FOREACH s IN ARRAY ARRAY['', '_mec'] LOOP
    t := 'price_history' || s;
    IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE 'La tabla % no existe: se omite', t; CONTINUE; END IF;
    IF (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = t AND column_name IN ('item_id', 'ts')) < 2 THEN
      RAISE NOTICE 'La tabla % no tiene las columnas item_id y ts: se omiten sus índices', t; CONTINUE;
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (item_id, ts DESC)', t || '_item_ts_idx', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (ts DESC)', t || '_ts_idx', t);
  END LOOP;
END $$;

-- Las "claves únicas" que usa la app para guardar con "upsert" (items.id y config.key) deben existir.
-- Se comprueban en la sección final (filas "clave única ..."). Para verlas a mano:
--   SELECT conrelid::regclass AS tabla, conname, contype, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid IN ('public.items'::regclass, 'public.config'::regclass,
--                       'public.items_mec'::regclass, 'public.config_mec'::regclass)
--      AND contype IN ('p', 'u');

-- ============ 3) Permisos que sobran (DB-LOW4) ============
-- Supabase concede por defecto TODOS los permisos de tabla a anon y authenticated; lo único que
-- protege es RLS. Se quitan los que la app nunca usa, SOLO en las 8 tablas del almacén (no es global:
-- el proyecto puede compartirse con otras apps).
--   · anon (visitante sin sesión): ningún permiso en las tablas del almacén.
--   · authenticated: se quitan TRUNCATE (vaciar la tabla saltándose RLS), TRIGGER y REFERENCES.
--     Se mantienen SELECT, INSERT, UPDATE y DELETE: los limitan las políticas de supabase_admin_roles.sql.
DO $$
DECLARE s text; t text;
BEGIN
  FOREACH s IN ARRAY ARRAY['', '_mec'] LOOP
    FOREACH t IN ARRAY ARRAY['items' || s, 'config' || s, 'movements' || s, 'price_history' || s] LOOP
      IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE 'La tabla % no existe: se omite', t; CONTINUE; END IF;
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
      EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM authenticated', t);
    END LOOP;
  END LOOP;
END $$;

-- Funciones auxiliares. Se quita el permiso de EJECUTAR a quien no lo necesita:
--   · set_movimiento_usuario(): es solo un disparador; nadie debe llamarla a mano. (Un disparador
--     se ejecuta igualmente: PostgreSQL solo exige este permiso al CREAR el disparador.)
--   · es_usuario() / es_admin(): las usan las políticas de RLS, que se evalúan con el rol
--     authenticated, así que se mantiene para authenticated y se quita a PUBLIC y anon.
DO $$
BEGIN
  IF to_regprocedure('public.set_movimiento_usuario()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.set_movimiento_usuario() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.es_usuario()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.es_usuario() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.es_usuario() TO authenticated;
  END IF;
  IF to_regprocedure('public.es_admin()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.es_admin() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.es_admin() TO authenticated;
  END IF;
END $$;

-- ============ 4) Tablas heredadas de contraseñas (DB-M1) ============
-- app_auth (y app_auth_antigua, si existe) solo servían al acceso antiguo (useSupabaseAuth:false).
-- Ambos almacenes usan ya Supabase Auth, así que se cierran del todo: RLS activada y ningún permiso
-- para anon ni authenticated. (Si algún día volvieras al acceso antiguo, habría que reabrirlas.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['app_auth', 'app_auth_antigua'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
-- Si esas tablas tuvieran políticas sueltas (la comprobación final avisa), se pueden quitar a mano:
--   SELECT policyname, tablename FROM pg_policies WHERE schemaname='public' AND tablename IN ('app_auth','app_auth_antigua');
--   DROP POLICY "nombre de la política" ON public.app_auth;

-- ============ 5) Límites de tamaño (SEC-M1) ============
-- Evitan que una sesión (o un fallo) meta filas enormes que llenen la base o ralenticen la app:
--   · config.value        < 200000 bytes
--   · items.photo         < 1000000 caracteres (las fotos de la app ocupan una fracción de eso)
--   · items.notes         < 2000 caracteres
-- Se añaden NOT VALID: no se revisan las filas que ya existen (la operación es instantánea, no
-- reescribe la tabla), pero sí todo insert/update nuevo.
-- Protección extra: si YA hay una fila que no cumple el límite, NO se añade esa restricción (porque
-- cualquier edición de esa fila fallaría) y se avisa; la comprobación final lo mostrará como REVISAR.
-- Para ver esas filas (cambia la tabla si hace falta):
--   SELECT id, length(notes) FROM public.items WHERE length(notes) >= 2000;
--   SELECT id, length(photo) FROM public.items WHERE length(photo) >= 1000000;
--   SELECT key, pg_column_size(value) FROM public.config WHERE pg_column_size(value) >= 200000;
DO $$
DECLARE s text; r record; t text; n bigint;
BEGIN
  FOREACH s IN ARRAY ARRAY['', '_mec'] LOOP
    FOR r IN SELECT * FROM (VALUES
        ('items',  '_photo_len_chk',  'photo', 'length(photo) < 1000000'),
        ('items',  '_notes_len_chk',  'notes', 'length(notes) < 2000'),
        ('config', '_value_size_chk', 'value', 'pg_column_size(value) < 200000')
      ) AS v(tabla, restriccion, columna, condicion)
    LOOP
      t := r.tabla || s;
      IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE 'La tabla % no existe: se omite', t; CONTINUE; END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = t AND column_name = r.columna) THEN
        RAISE NOTICE 'La tabla % no tiene la columna %: se omite', t, r.columna; CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = t || r.restriccion AND conrelid = to_regclass('public.' || t)) THEN CONTINUE; END IF;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE NOT (%s)', t, r.condicion) INTO n;
      IF n > 0 THEN
        RAISE NOTICE 'La tabla % ya tiene % fila(s) que no cumplen (%): NO se añade la restricción %', t, n, r.condicion, t || r.restriccion;
        CONTINUE;
      END IF;
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s) NOT VALID', t, t || r.restriccion, r.condicion);
    END LOOP;
  END LOOP;
END $$;

RESET lock_timeout;

-- ============ 6) COMPROBACIÓN FINAL ============
-- Devuelve una tabla con una fila por comprobación: columna "resultado" = OK o REVISAR.
-- "encontrado" debe ser igual a "esperado". (El editor de Supabase solo muestra el resultado de la
-- ÚLTIMA consulta; por eso esta es la última y está todo en una.)
-- Los "esperado" se calculan según las tablas que existan, así que también valen si falta un almacén.
WITH tablas AS (        -- las tablas del almacén que existen
  SELECT c.oid, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relname IN ('items', 'config', 'movements', 'price_history',
                       'items_mec', 'config_mec', 'movements_mec', 'price_history_mec')
), privilegios(p) AS (
  SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
), comprobaciones AS (
  SELECT 10 AS orden, 'Tablas públicas sin RLS (DB-M1; si aparecen, mira su nombre en la consulta de abajo)' AS comprobacion,
         (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity)::int AS encontrado, 0 AS esperado
  UNION ALL
  SELECT 11, 'Tablas del almacén sin RLS',
         (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity
             AND tablename IN (SELECT relname FROM tablas))::int, 0
  UNION ALL
  SELECT 12, 'Políticas de RLS de las tablas del almacén (4 items + 4 config + 4 movements + 1 price_history por almacén)',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT relname FROM tablas))::int,
         (SELECT sum(CASE WHEN relname LIKE 'price_history%' THEN 1 ELSE 4 END) FROM tablas)::int
  UNION ALL
  SELECT 13, 'Políticas de las tablas del almacén abiertas a anon o PUBLIC',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN (SELECT relname FROM tablas)
             AND roles && ARRAY['anon', 'public']::name[])::int, 0
  UNION ALL
  SELECT 20, 'Permisos de anon sobre las tablas del almacén (cualquiera)',
         (SELECT count(*) FROM tablas, privilegios WHERE has_table_privilege('anon', tablas.oid, privilegios.p))::int, 0
  UNION ALL
  SELECT 21, 'Permisos TRUNCATE/TRIGGER/REFERENCES de authenticated en las tablas del almacén',
         (SELECT count(*) FROM tablas, privilegios WHERE privilegios.p IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
             AND has_table_privilege('authenticated', tablas.oid, privilegios.p))::int, 0
  UNION ALL
  SELECT 22, 'Permisos que FALTAN a authenticated (SELECT/INSERT/UPDATE/DELETE; si no es 0 la app dejaría de funcionar)',
         (SELECT count(*) FROM tablas, privilegios WHERE privilegios.p IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
             AND NOT has_table_privilege('authenticated', tablas.oid, privilegios.p))::int, 0
  UNION ALL
  SELECT 23, 'Permisos de anon/authenticated sobre app_auth y app_auth_antigua',
         (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, privilegios, unnest(ARRAY['anon', 'authenticated']) AS rol
           WHERE n.nspname = 'public' AND c.relname IN ('app_auth', 'app_auth_antigua') AND c.relkind IN ('r', 'p')
             AND has_table_privilege(rol, c.oid, privilegios.p))::int, 0
  UNION ALL
  SELECT 24, 'Políticas sueltas en app_auth / app_auth_antigua (informativo: sin permisos no sirven de nada)',
         (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('app_auth', 'app_auth_antigua'))::int, 0
  UNION ALL
  SELECT 30, 'set_movimiento_usuario(): ejecutable por anon/authenticated/PUBLIC',
         (SELECT count(*) FROM unnest(ARRAY['anon', 'authenticated']) AS rol
           WHERE has_function_privilege(rol, 'public.set_movimiento_usuario()', 'EXECUTE'))::int
         + (SELECT count(*) FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.oid = 'public.set_movimiento_usuario()'::regprocedure AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')::int, 0
  UNION ALL
  SELECT 31, 'es_usuario()/es_admin(): ejecutables por anon',
         (SELECT count(*) FROM unnest(ARRAY['public.es_usuario()', 'public.es_admin()']) AS f
           WHERE coalesce(has_function_privilege('anon', to_regprocedure(f)::oid, 'EXECUTE'), false))::int, 0
  UNION ALL
  SELECT 32, 'es_usuario()/es_admin(): NO ejecutables por authenticated (si no es 0 la app dejaría de funcionar)',
         (SELECT count(*) FROM unnest(ARRAY['public.es_usuario()', 'public.es_admin()']) AS f
           WHERE NOT coalesce(has_function_privilege('authenticated', to_regprocedure(f)::oid, 'EXECUTE'), false))::int, 0
  UNION ALL
  SELECT 40, 'Función del disparador de usuario corregida (comprueba el rol authenticated)',
         (SELECT count(*) FROM pg_proc WHERE oid = 'public.set_movimiento_usuario()'::regprocedure
             AND pg_get_functiondef(oid) LIKE '%''authenticated''%')::int, 1
  UNION ALL
  SELECT 41, 'Disparadores trg_movimiento_usuario instalados (uno por tabla de movimientos)',
         (SELECT count(*) FROM pg_trigger WHERE tgname = 'trg_movimiento_usuario' AND NOT tgisinternal)::int,
         (SELECT count(*) FROM tablas WHERE relname LIKE 'movements%')::int
  UNION ALL
  SELECT 50, 'Índices nuevos del histórico de precios (2 por almacén)',
         (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
             AND indexname IN ('price_history_item_ts_idx', 'price_history_ts_idx',
                               'price_history_mec_item_ts_idx', 'price_history_mec_ts_idx'))::int,
         (SELECT 2 * count(*) FROM tablas WHERE relname LIKE 'price_history%')::int
  UNION ALL
  SELECT 51, 'Claves únicas de un solo campo: items(id) y config(key) (los "upsert" las necesitan)',
         (SELECT count(*) FROM tablas t JOIN pg_index i ON i.indrelid = t.oid
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
           WHERE t.relname IN ('items', 'items_mec', 'config', 'config_mec')
             AND i.indisunique AND i.indnatts = 1 AND i.indpred IS NULL AND i.indexprs IS NULL
             AND ((t.relname LIKE 'items%' AND a.attname = 'id') OR (t.relname LIKE 'config%' AND a.attname = 'key')))::int,
         (SELECT count(*) FROM tablas WHERE relname IN ('items', 'items_mec', 'config', 'config_mec'))::int
  UNION ALL
  SELECT 52, 'Índices únicos de movimientos (ts, itemId) (de supabase_movimientos_unicos.sql)',
         (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'
             AND indexname IN ('movements_ts_item_uniq', 'movements_mec_ts_item_uniq'))::int,
         (SELECT count(*) FROM tablas WHERE relname LIKE 'movements%')::int
  UNION ALL
  SELECT 60, 'Límites de tamaño instalados (3 por almacén: foto, notas, config)',
         (SELECT count(*) FROM pg_constraint
           WHERE conname IN ('items_photo_len_chk', 'items_notes_len_chk', 'config_value_size_chk',
                             'items_mec_photo_len_chk', 'items_mec_notes_len_chk', 'config_mec_value_size_chk')
             AND conrelid IN (SELECT oid FROM tablas))::int,
         (SELECT 3 * count(*) FROM tablas WHERE relname IN ('items', 'items_mec'))::int
)
SELECT orden, comprobacion, encontrado, esperado,
       CASE WHEN encontrado = esperado THEN 'OK' ELSE 'REVISAR' END AS resultado
  FROM comprobaciones
 ORDER BY orden;

-- Aparte (ejecútala sola si la fila 10 sale en REVISAR): nombres de las tablas públicas sin RLS.
-- Si el proyecto es compartido, algunas pueden ser de otras apps: valóralas una a una.
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
-- Para activar RLS en una tabla que no debe ser pública (sin políticas = nadie con sesión la ve):
--   ALTER TABLE public.nombre_de_la_tabla ENABLE ROW LEVEL SECURITY;
