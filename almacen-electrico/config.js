/* Configuracion especifica del Almacen Electrico */
const WAREHOUSE_CONFIG = {
  key: 'electrico',
  name: 'Almacén Eléctrico',
  icon: '⚡',
  db: 'almacen_db',
  tblItems: 'items',
  tblCfg: 'config',
  tblMov: 'movements',
  tblPrice: 'price_history',
  sesKey: 'almacen_sesion_electrico',
  // Debe ser true. El acceso antiguo se eliminó; no usar false (con false nadie puede entrar).
  // El acceso es con Supabase Auth (ver SEGURIDAD.md) y debe estar en true en los DOS almacenes.
  useSupabaseAuth: true
};

/* El almacen opuesto (para mover material entre almacenes) */
const WAREHOUSE_OTHER_CONFIG = {
  key: 'mecanico',
  name: 'Almacén Mecánico',
  icon: '🔧',
  db: 'almacen_mec_db',
  tblItems: 'items_mec',
  tblCfg: 'config_mec',
  tblMov: 'movements_mec',
  tblPrice: 'price_history_mec',
  sesKey: 'almacen_sesion_mecanico'
};
