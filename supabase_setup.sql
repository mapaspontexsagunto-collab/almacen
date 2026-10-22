-- ATENCIÓN: FICHERO HEREDADO. El acceso actual usa Supabase Auth (ver SEGURIDAD.md). No hace falta ejecutarlo.
-- Ejecutar UNA VEZ en el SQL Editor de Supabase (instalación nueva)
-- Tabla heredada de credenciales (solo se usa si useSupabaseAuth es false en config.js).
-- RECOMENDADO: usar Supabase Auth y ejecutar después supabase_seguridad.sql (ver SEGURIDAD.md).

CREATE TABLE IF NOT EXISTS app_auth (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_auth ENABLE ROW LEVEL SECURITY;

-- IMPORTANTE: este fichero ya NO incluye contraseñas ni políticas públicas.
-- Si necesitas el acceso heredado, inserta TUS valores desde el SQL Editor (nunca los subas a GitHub):
--   INSERT INTO app_auth (key, value) VALUES
--     ('auth_user', '<usuario>'),
--     ('auth_pass_electrico', '<clave>'),
--     ('auth_pass_mecanico', '<clave>'),
--     ('admin_pass', '<clave admin>');
-- y crea una política de lectura SOLO si aceptas que cualquiera con la clave pública pueda leerlas
-- (no recomendado).
