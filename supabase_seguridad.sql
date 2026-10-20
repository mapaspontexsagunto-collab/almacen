-- Seguridad de la base de datos: solo usuarios autenticados (Supabase Auth)
-- ORDEN (ver SEGURIDAD.md): 1) crear usuarios y desactivar registros, 2) poner useSupabaseAuth:true en los
-- dos config.js y desplegar, 3) comprobar que se puede entrar, 4) ejecutar ESTE fichero.
-- Si se ejecuta antes de activar Supabase Auth en la app, nadie podrá leer ni guardar datos.

DO $$
DECLARE t text; p record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_auth',
    'items','config','movements','price_history',
    'items_mec','config_mec','movements_mec','price_history_mec'
  ] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- Borrar TODAS las políticas existentes (sean del nombre que sean)
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;

    -- El rol anónimo (clave pública) no puede hacer nada en estas tablas
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    -- app_auth (credenciales heredadas) queda sin políticas: nadie accede por la API.
    -- El resto: solo usuarios con sesión (se excluyen los inicios de sesión anónimos de Supabase).
    IF t <> 'app_auth' THEN
      EXECUTE format(
        'CREATE POLICY "solo_autenticados" ON public.%I FOR ALL TO authenticated ' ||
        'USING (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) = false) ' ||
        'WITH CHECK (coalesce((auth.jwt() ->> ''is_anonymous'')::boolean, false) = false)', t);
    END IF;
  END LOOP;
END $$;

-- Cuando ya no necesites el acceso heredado:  DROP TABLE app_auth;

-- Comprobación: no debe aparecer ninguna política para el rol anon ni para public
-- SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname = 'public' ORDER BY 1;
-- SELECT table_name, privilege_type FROM information_schema.role_table_grants
--   WHERE grantee = 'anon' AND table_schema = 'public';
