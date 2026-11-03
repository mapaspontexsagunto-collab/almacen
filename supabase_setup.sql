-- ATENCIÓN: FICHERO HEREDADO. NO hace falta ejecutarlo: el acceso actual usa Supabase Auth (ver SEGURIDAD.md).
-- Solo crea la tabla app_auth del acceso antiguo por contraseña propia, que la app ya no lee ni escribe
-- (con useSupabaseAuth distinto de true no se puede entrar). supabase_endurecimiento.sql la cierra del todo.
-- Este repositorio NO contiene el esquema de las tablas items, config, movements y price_history (ni de sus
-- versiones _mec): se crearon en Supabase fuera de este repositorio.
-- Para poner en marcha el proyecto sigue el orden de SEGURIDAD.md ("Puesta en marcha").

CREATE TABLE IF NOT EXISTS app_auth (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_auth ENABLE ROW LEVEL SECURITY;

-- IMPORTANTE: este fichero no incluye contraseñas ni políticas públicas, y la tabla no debe llenarse: la app
-- no la usa. Nunca subas credenciales a GitHub ni crees políticas de lectura sobre esta tabla.
