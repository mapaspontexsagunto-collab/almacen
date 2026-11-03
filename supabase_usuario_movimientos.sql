-- Registra QUIÉN hace cada movimiento de stock.
-- Ejecutar UNA VEZ en Supabase → SQL Editor, cuando se use Supabase Auth (useSupabaseAuth: true).
-- Es seguro repetirlo. Los movimientos anteriores se quedan sin usuario (solo lo llevan los registrados
-- desde que se ejecutó este fichero).
-- OJO: volver a ejecutarlo REINSTALA el disparador antiguo (escribe el correo en cualquier inserción,
-- también desde el SQL Editor). Después, ejecuta de nuevo supabase_endurecimiento.sql, que lo corrige.

CREATE OR REPLACE FUNCTION public.set_movimiento_usuario() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.usuario := OLD.usuario;                 -- el usuario nunca se puede cambiar después
  ELSE
    NEW.usuario := auth.jwt() ->> 'email';      -- lo pone el servidor con el correo de la sesión
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['movements','movements_mec'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE 'La tabla % no existe: se omite', t; CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS usuario text', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_movimiento_usuario ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_movimiento_usuario BEFORE INSERT OR UPDATE ON public.%I ' ||
      'FOR EACH ROW EXECUTE FUNCTION public.set_movimiento_usuario()', t);
  END LOOP;
END $$;

-- Comprobación (después de hacer un movimiento de prueba en la app):
-- SELECT fecha, hora, nombre, tipo, diferencia, usuario FROM movements ORDER BY ts DESC LIMIT 5;
