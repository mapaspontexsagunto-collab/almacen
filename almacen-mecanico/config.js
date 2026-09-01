/* Configuracion especifica del Almacen Mecanico */
const WAREHOUSE_CONFIG = {
  key: 'mecanico',
  name: 'Almacén Mecánico',
  icon: '🔧',
  db: 'almacen_mec_db',
  tblItems: 'items_mec',
  tblCfg: 'config_mec',
  tblMov: 'movements_mec',
  tblPrice: 'price_history_mec',
  sesKey: 'almacen_sesion_mecanico',
  fallbackUser: 'manteni',
  fallbackPassElectrico: 'Electrico',
  fallbackPassMecanico: 'Mecanico'
};

/* El almacen opuesto (para mover material entre almacenes) */
const WAREHOUSE_OTHER_CONFIG = {
  key: 'electrico',
  name: 'Almacén Eléctrico',
  icon: '⚡',
  db: 'almacen_db',
  tblItems: 'items',
  tblCfg: 'config',
  tblMov: 'movements',
  tblPrice: 'price_history',
  sesKey: 'almacen_sesion_electrico'
};
