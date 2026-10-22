-- Evita movimientos duplicados: no puede haber dos con el mismo instante (ts) y el mismo artículo.
-- Ejecutar UNA VEZ en Supabase → SQL Editor. Es seguro repetirlo.
-- 1) Borra los duplicados que ya existan (se conserva uno de cada).
-- 2) Crea el índice único. Si la app reintenta subir un movimiento que ya está, la base de datos lo rechaza
--    y la app lo da por subido.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['movements', 'movements_mec'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN RAISE NOTICE 'La tabla % no existe: se omite', t; CONTINUE; END IF;
    EXECUTE format(
      'DELETE FROM public.%1$I a USING public.%1$I b WHERE a.ctid > b.ctid AND a.ts = b.ts AND a."itemId" = b."itemId"', t);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %1$I ON public.%2$I (ts, "itemId")', t || '_ts_item_uniq', t);
  END LOOP;
END $$;

-- Comprobación: debe devolver 0 filas
-- SELECT ts, "itemId", count(*) FROM movements GROUP BY 1, 2 HAVING count(*) > 1;
