-- Ejecutar esto UNA VEZ en Supabase SQL Editor
-- Tabla de credenciales compartida entre ambos almacenes

CREATE TABLE IF NOT EXISTS app_auth (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insertar credenciales iniciales (valores en texto plano - la app los hashea al comparar)
INSERT INTO app_auth (key, value) VALUES
  ('auth_user', 'manteni'),
  ('auth_pass_electrico', 'Electrico'),
  ('auth_pass_mecanico', 'Mecanico'),
  ('admin_pass', 'Mapamsi01')
ON CONFLICT (key) DO NOTHING;

-- Politica de seguridad: solo lectura publica (la app usa la clave publica)
ALTER TABLE app_auth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON app_auth
  FOR SELECT USING (true);

-- Para editar credenciales desde la app (cuando el admin cambia contrasenas):
CREATE POLICY "Allow public update" ON app_auth
  FOR UPDATE USING (true);

-- NOTA: Para cambiar credenciales manualmente, usar el SQL Editor de Supabase:
-- UPDATE app_auth SET value = 'NuevaContrasena', updated_at = now() WHERE key = 'auth_pass_electrico';
-- UPDATE app_auth SET value = 'NuevoUsuario', updated_at = now() WHERE key = 'auth_user';
