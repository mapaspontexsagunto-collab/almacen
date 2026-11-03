-- Administrador por usuario: la base de datos exige el rol, no solo la pantalla.
-- ORDEN (ver SEGURIDAD.md):
--   1) Fusionar y desplegar la versión de la app con el candado "Admin".
--   2) Marcar a los administradores (PASO A, más abajo) y que cierren sesión y vuelvan a entrar.
--   3) Ejecutar el PASO B (el resto de este fichero).
-- Si se ejecuta el PASO B antes de marcar al menos a un administrador, aborta con una excepción y NO
-- cambia nada (ejecuta primero el PASO A). El riesgo real es marcar a un administrador que todavía no
-- ha cerrado sesión y vuelto a entrar: mientras su sesión no lleve el rol, no podrá borrar ni modificar
-- lo protegido. Después de este fichero, ejecuta supabase_endurecimiento.sql (ver SEGURIDAD.md).
-- Es seguro repetirlo.

-- ============ PASO A: marcar administradores (cambia los correos) ============
-- El rol se guarda en app_metadata, que el usuario NO puede modificar desde la app.
-- Ejecútalo solo con los correos de los administradores:
--
-- UPDATE auth.users
--    SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--  WHERE email IN ('admin1@empresa.com', 'admin2@empresa.com');
--
-- Quitar el rol:
-- UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data - 'role' WHERE email = 'ex-admin@empresa.com';
--
-- Ver quién es administrador:
-- SELECT email, raw_app_meta_data ->> 'role' AS rol FROM auth.users ORDER BY email;

-- ============ PASO B: permisos por rol ============
CREATE OR REPLACE FUNCTION public.es_usuario() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (auth.jwt() ->> 'role') = 'authenticated'
     AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

CREATE OR REPLACE FUNCTION public.es_admin() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.es_usuario()
     AND coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

DO $$
DECLARE s text; t text; p record;
BEGIN
  -- Protección: sin ningún administrador no se podría borrar nada. Si falla, no se cambia nada.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE raw_app_meta_data ->> 'role' = 'admin') THEN
    RAISE EXCEPTION 'No hay ningún administrador: ejecuta primero el PASO A (y que esa persona cierre sesión y vuelva a entrar)';
  END IF;
  FOREACH s IN ARRAY ARRAY['', '_mec'] LOOP

    -- 1) Limpiar: borrar TODAS las políticas existentes de las cuatro tablas del almacén
    FOREACH t IN ARRAY ARRAY['items' || s, 'config' || s, 'movements' || s, 'price_history' || s] LOOP
      IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE 'La tabla % no existe: se omite', t; CONTINUE; END IF;
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
      END LOOP;
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END LOOP;

    -- 2) Artículos: cualquier usuario ve, crea y edita; solo administradores borran
    t := 'items' || s;
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY items_ver ON public.%I FOR SELECT TO authenticated USING ((SELECT public.es_usuario()))', t);
      EXECUTE format('CREATE POLICY items_crear ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.es_usuario()))', t);
      EXECUTE format('CREATE POLICY items_editar ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.es_usuario())) WITH CHECK ((SELECT public.es_usuario()))', t);
      EXECUTE format('CREATE POLICY items_borrar ON public.%I FOR DELETE TO authenticated USING ((SELECT public.es_admin()))', t);
    END IF;

    -- 3) Configuración: todos, salvo las filas antiguas de contraseñas (solo administradores)
    t := 'config' || s;
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY config_ver ON public.%I FOR SELECT TO authenticated USING ((SELECT public.es_usuario()) AND (key NOT IN (''adminPass'', ''loginCfg'') OR (SELECT public.es_admin())))', t);
      EXECUTE format('CREATE POLICY config_crear ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.es_usuario()) AND (key NOT IN (''adminPass'', ''loginCfg'') OR (SELECT public.es_admin())))', t);
      EXECUTE format('CREATE POLICY config_editar ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.es_usuario()) AND (key NOT IN (''adminPass'', ''loginCfg'') OR (SELECT public.es_admin()))) WITH CHECK ((SELECT public.es_usuario()) AND (key NOT IN (''adminPass'', ''loginCfg'') OR (SELECT public.es_admin())))', t);
      EXECUTE format('CREATE POLICY config_borrar ON public.%I FOR DELETE TO authenticated USING ((SELECT public.es_admin()))', t);
    END IF;

    -- 4) Movimientos: todos ven y crean; solo administradores modifican o borran líneas
    t := 'movements' || s;
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY mov_ver ON public.%I FOR SELECT TO authenticated USING ((SELECT public.es_usuario()))', t);
      EXECUTE format('CREATE POLICY mov_crear ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.es_usuario()))', t);
      EXECUTE format('CREATE POLICY mov_editar ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.es_admin())) WITH CHECK ((SELECT public.es_admin()))', t);
      EXECUTE format('CREATE POLICY mov_borrar ON public.%I FOR DELETE TO authenticated USING ((SELECT public.es_admin()))', t);
    END IF;

    -- 5) Histórico de precios: solo administradores (ver y escribir)
    t := 'price_history' || s;
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('CREATE POLICY precios_admin ON public.%I FOR ALL TO authenticated USING ((SELECT public.es_admin())) WITH CHECK ((SELECT public.es_admin()))', t);
    END IF;

  END LOOP;
END $$;

-- Comprobación (como administrador y como usuario normal, desde la app):
--   · Usuario normal: ve el inventario, mueve stock, pero no puede borrar artículos ni líneas del historial.
--   · Administrador: pulsa el candado 🔒 Admin y puede hacerlo todo.
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;
