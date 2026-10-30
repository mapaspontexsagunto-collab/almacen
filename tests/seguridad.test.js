// Pruebas de los filtros de seguridad de shared/app.js
// Ejecutar: node --test tests/seguridad.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'shared', 'app.js'), 'utf8');
const store = {};
const noop = () => {};
const el = new Proxy(function () {}, { get: () => el, apply: () => el, set: () => true });
const ctx = vm.createContext({
  console, setTimeout, clearTimeout, Date, JSON, Math, Promise,
  document: { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [], createElement: () => el },
  window: {}, navigator: {}, location: { reload: noop },
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  indexedDB: {}, crypto: {}, fetch: async () => ({ ok: false }), alert: noop, confirm: () => true,
  Intl, URL, Blob: function () {}, FileReader: function () {}, Image: function () {},
});
// Las declaraciones `let/const` de nivel superior no cuelgan del contexto: las exponemos con una función
vm.runInContext(src + '\n;globalThis.__t={isSafeId,safePhoto,safeUrl,cleanItem,cleanItems,cleanShelves,cleanAisles,strArr,jsq,esc,cleanText,sessionValid,quienMov,whBarHtml,sesStorageKey,logout,isAdminRole,ensureOnline,GUARDED_FUNCS,asegurarFotos,noPhotoIds,pedirFoto,parseNumES,_invSanitize,_invValidate,assignInvoiceLine};', ctx);
const t = ctx.__t;

test('ids: solo letras, números, guion y guion bajo', () => {
  assert.ok(t.isSafeId('I1700000000000123'));
  assert.ok(t.isSafeId('01'));
  assert.ok(!t.isSafeId("x');alert(1)//"));
  assert.ok(!t.isSafeId(''));
  assert.ok(!t.isSafeId(null));
  assert.ok(!t.isSafeId('a'.repeat(65)));
});

test('fotos: solo data:image en base64', () => {
  const ok = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.strictEqual(t.safePhoto(ok), ok);
  assert.strictEqual(t.safePhoto('x" onerror="alert(1)'), null);
  assert.strictEqual(t.safePhoto('javascript:alert(1)'), null);
  assert.strictEqual(t.safePhoto('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.strictEqual(t.safePhoto(null), null);
});

test('enlaces: solo http(s)', () => {
  assert.strictEqual(t.safeUrl('https://a.com/x'), 'https://a.com/x');
  assert.strictEqual(t.safeUrl('javascript:alert(1)'), '#');
  assert.strictEqual(t.safeUrl(undefined), '#');
});

test('cleanItem descarta ids peligrosos y limpia ubicación y foto', () => {
  assert.strictEqual(t.cleanItem({ id: "a');x//", name: 'n' }), null);
  const c = t.cleanItem({ id: 'I1', loc: '01-"<b>3', pos: "a'b", photo: 'x" onerror=1', stock: 4 });
  assert.strictEqual(c.loc, '01-b3');
  assert.strictEqual(c.pos, 'ab');
  assert.strictEqual(c.photo, null);
  assert.strictEqual(c.stock, 4);
  assert.strictEqual(t.cleanItems([{ id: 'ok' }, { id: '<bad>' }, null]).length, 1);
});

test('cleanShelves limpia código, números y distribución', () => {
  const r = t.cleanShelves([
    { id: '01', name: 'E1', baldas: 5, x: 10, y: 20, w: 80, h: 80 },
    { id: "1');alert(1)//", baldas: '<img src=x onerror=1>' },
    { id: '!!!' },
    null,
    { id: '02', baldas: 9999, x: 'a" onanimationstart="1', layout: { 1: [{ id: "b');x//", k: 'g', rows: '<b>', cols: 9999, name: '<i>G' }, { id: '' }], bad: [1], 99: [] } },
  ]);
  assert.strictEqual(r.length, 3); // '!!!' se descarta (queda vacío)
  assert.strictEqual(r[0].id, '01');
  assert.strictEqual(r[0].x, 10);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(r[1].id));
  assert.strictEqual(typeof r[1].baldas, 'number');
  assert.strictEqual(r[2].baldas, 20);
  assert.ok(!('x' in r[2]), 'una x que no es número se descarta');
  const blocks = r[2].layout['1'];
  assert.strictEqual(blocks.length, 1);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(blocks[0].id));
  assert.strictEqual(blocks[0].cols, 40);
  assert.strictEqual(blocks[0].rows, 1);
  assert.ok(!/[<>]/.test(blocks[0].name));
  assert.ok(!('bad' in r[2].layout) && !('99' in r[2].layout));
});

test('cleanAisles: solo números finitos y etiqueta limpia', () => {
  const r = t.cleanAisles([{ label: '<b>P1', x: '1px;animation:x" onanimationstart="1', y: 5, w: 60, h: 'zz' }, null, 7]);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].label, 'bP1');
  assert.strictEqual(r[0].x, 0);
  assert.strictEqual(r[0].y, 5);
  assert.strictEqual(r[0].h, 0);
  assert.strictEqual(JSON.stringify(t.cleanAisles('no')), '[]');
});

test('cleanItem fuerza tipos numéricos y de texto', () => {
  const c = t.cleanItem({ id: 'I1', stock: '<img src=x onerror=1>', min: {}, precio: 'abc', name: 123, cats: 'x', ref: null });
  assert.strictEqual(c.stock, 0);
  assert.strictEqual(c.min, 0);
  assert.strictEqual(c.precio, null);
  assert.strictEqual(c.name, '123');
  assert.strictEqual(JSON.stringify(c.cats), '[]');
  assert.strictEqual(c.ref, null);
  assert.strictEqual(t.cleanItem({ id: 'I2', stock: '7', precio: '2.5' }).stock, 7);
  assert.strictEqual(t.cleanItem({ id: 'I2', stock: '7', precio: '2.5' }).precio, 2.5);
});

test('strArr descarta valores que no son texto de lista', () => {
  assert.strictEqual(JSON.stringify(t.strArr(['a', 1, null])), '["a","1"]');
  assert.strictEqual(JSON.stringify(t.strArr({ a: 1 })), '[]');
});

test('jsq: el literal JS sobrevive al atributo HTML y no se puede romper', () => {
  const entradas = ["Rodamientos", "O'Brien", 'a"b', "x');alert(1)//", '<img src=x onerror=1>', 'a\\b', 'línea\nnueva'];
  for (const s of entradas) {
    const attr = t.jsq(s);
    // el navegador decodifica las entidades HTML antes de ejecutar el JS del atributo
    const js = attr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    assert.strictEqual(vm.runInNewContext('(' + js + ')'), s);
    assert.ok(!/[<>]/.test(attr), 'sin < ni > sin escapar');
  }
});

test('sesión: caduca a los 30 días y rechaza el valor antiguo "1"', () => {
  ctx.WH = null;
  vm.runInContext("WH={sesKey:'k'}", ctx);
  store.k = String(Date.now());
  assert.ok(t.sessionValid());
  store.k = '1';
  assert.ok(!t.sessionValid());
  store.k = String(Date.now() - 31 * 24 * 3600 * 1000);
  assert.ok(!t.sessionValid());
  store.k = String(Date.now() + 10 * 24 * 3600 * 1000);
  assert.ok(!t.sessionValid());
});

test('quienMov: nombre corto a partir del correo', () => {
  assert.strictEqual(t.quienMov({ usuario: 'juan.perez@empresa.com' }), 'juan.perez');
  assert.strictEqual(t.quienMov({}), '');
  assert.strictEqual(t.quienMov(null), '');
  assert.strictEqual(t.quienMov({ usuario: 'a'.repeat(100) + '@x.com' }).length, 40);
});

test('barra de usuario: pestaña activa, enlace al otro almacén y nombre escapado', () => {
  const cur = { key: 'electrico', name: 'Almacén Eléctrico', icon: '⚡' };
  const otro = { key: 'mecanico', name: 'Almacén Mecánico', icon: '🔧' };
  const h = t.whBarHtml(cur, otro, '<img src=x onerror=1>');
  assert.ok(h.includes('<span class="wh-tab active">⚡ Eléctrico</span>'));
  assert.ok(h.includes('href="../almacen-mecanico/index.html"'));
  assert.ok(h.includes('🔧<span class="tl"> Mecánico</span>'));
  assert.ok(h.includes('aria-label="Cambiar a Almacén Mecánico"'));
  assert.ok(!h.includes('<img'), 'el nombre se escapa');
  assert.ok(!t.whBarHtml(cur, otro, '').includes('wh-user'), 'sin nombre no hay chip de usuario');
  assert.ok(!t.whBarHtml(cur, null, 'ana').includes('href='), 'sin otro almacén no hay enlace');
});

test('sesión: con Supabase Auth la clave es común a los dos almacenes', () => {
  vm.runInContext("WH={sesKey:'k'}", ctx);
  assert.strictEqual(t.sesStorageKey(), 'k');
  vm.runInContext("var WAREHOUSE_CONFIG={useSupabaseAuth:true}", ctx);
  assert.strictEqual(t.sesStorageKey(), 'almacen_sesion_sb');
  vm.runInContext("WAREHOUSE_CONFIG=undefined; delete globalThis.WAREHOUSE_CONFIG", ctx);
});

test('logout borra la sesión y el desbloqueo de admin de los dos almacenes', async () => {
  const sess = {};
  ctx.sessionStorage = { getItem: k => sess[k] ?? null, setItem: (k, v) => { sess[k] = String(v); }, removeItem: k => { delete sess[k]; } };
  vm.runInContext("var WAREHOUSE_CONFIG={key:'electrico',sesKey:'se',useSupabaseAuth:false};var WAREHOUSE_OTHER_CONFIG={key:'mecanico',sesKey:'sm'};WH=WAREHOUSE_CONFIG", ctx);
  Object.assign(store, { se: '1', sm: '1', almacen_sesion_sb: '1' });
  sess.almacen_admin_electrico = '1'; sess.almacen_admin_mecanico = '1';
  await t.logout();
  assert.ok(!('se' in store) && !('sm' in store));
  assert.ok(!('almacen_admin_electrico' in sess) && !('almacen_admin_mecanico' in sess));
  vm.runInContext("WAREHOUSE_CONFIG=undefined;WAREHOUSE_OTHER_CONFIG=undefined; delete globalThis.WAREHOUSE_CONFIG; delete globalThis.WAREHOUSE_OTHER_CONFIG", ctx);
});

test('barra: candado de administrador según el estado', () => {
  const cur = { key: 'electrico', name: 'Almacén Eléctrico', icon: '⚡' };
  assert.ok(t.whBarHtml(cur, null, 'ana', true).includes('🔒<span class="lbl"> Admin</span>'));
  assert.ok(t.whBarHtml(cur, null, 'ana', false).includes('🔓<span class="lbl"> Admin</span>'));
  assert.ok(!t.whBarHtml(cur, null, 'ana').includes('wh-lock'), 'sin estado no hay candado');
});

test('barra: botón de salir solo si se pide', () => {
  const cur = { key: 'electrico', name: 'Almacén Eléctrico', icon: '⚡' };
  assert.ok(t.whBarHtml(cur, null, 'ana', true, true).includes('askLogout()'));
  assert.ok(!t.whBarHtml(cur, null, 'ana', true).includes('askLogout()'));
  assert.ok(t.whBarHtml(cur, null, '', undefined, true).includes('Cerrar sesión'));
});

test('isAdminRole: solo el rol admin de Supabase cuenta', async () => {
  const set = (cfg, sess) => vm.runInContext(
    'var WAREHOUSE_CONFIG=' + cfg + ';sb={auth:{getSession:async()=>({data:{session:' + sess + '}})}}', ctx);
  set('{useSupabaseAuth:true}', "{user:{app_metadata:{role:'admin'}}}");
  assert.strictEqual(await t.isAdminRole(), true);
  set('{useSupabaseAuth:true}', "{user:{app_metadata:{role:'user'}}}");
  assert.strictEqual(await t.isAdminRole(), false);
  set('{useSupabaseAuth:true}', "{user:{user_metadata:{role:'admin'}}}"); // editable por el usuario: no vale
  assert.strictEqual(await t.isAdminRole(), false);
  set('{useSupabaseAuth:true}', 'null');
  assert.strictEqual(await t.isAdminRole(), false);
  set('{useSupabaseAuth:false}', "{user:{app_metadata:{role:'admin'}}}"); // modo antiguo: nunca por rol
  assert.strictEqual(await t.isAdminRole(), false);
  vm.runInContext('WAREHOUSE_CONFIG=undefined; delete globalThis.WAREHOUSE_CONFIG; sb=null', ctx);
});

test('sin conexión: ensureOnline bloquea, tolera un corte momentáneo y no bloquea con conexión', async () => {
  vm.runInContext("WH={tblCfg:'config'}", ctx);
  const mk = (resultados) => "sb={from:()=>({select:()=>({limit:async()=>({error:(__r.shift()?null:{message:'x'})})})})}";
  const set = (lista) => { ctx.__r = lista; vm.runInContext(mk(), ctx); };
  set([true]);                         // responde bien al primer intento
  assert.strictEqual(await t.ensureOnline('x'), true);
  set([false, true]);                  // falla una vez y se recupera (cambio de repetidor)
  assert.strictEqual(await t.ensureOnline('x'), true);
  set([false, false]);                 // sin conexión de verdad
  assert.strictEqual(await t.ensureOnline('x'), false);
  vm.runInContext('sb=null', ctx);     // sin librería de Supabase
  assert.strictEqual(await t.ensureOnline('x'), false);
});

test('sin conexión: las funciones protegidas están envueltas y no ejecutan nada sin red', async () => {
  assert.ok(t.GUARDED_FUNCS.length >= 15);
  for (const [name] of t.GUARDED_FUNCS) {
    assert.strictEqual(vm.runInContext('typeof ' + name, ctx), 'function', name);
    assert.ok(vm.runInContext(name + '.toString()', ctx).includes('ensureOnline'), name + ' no está protegida');
  }
  ctx.navigator = { onLine: false };
  const t0 = Date.now();
  // el original fallaría (no hay formulario): si devuelve undefined, el envoltorio lo ha bloqueado
  assert.strictEqual(await vm.runInContext('saveItem()', ctx), undefined);
  assert.ok(Date.now() - t0 < 1000, 'sin red se bloquea al instante');
  ctx.navigator = {};
});

test('cleanItems rápido: valida el tipo de foto sin recorrerla entera', () => {
  const ok = 'data:image/jpeg;base64,/9j/4AAQ';
  assert.strictEqual(t.cleanItems([{ id: 'I1', photo: ok }], true)[0].photo, ok);
  assert.strictEqual(t.cleanItems([{ id: 'I1', photo: 'javascript:alert(1)' }], true)[0].photo, null);
  assert.strictEqual(t.cleanItems([{ id: 'I1', photo: 'data:text/html;base64,AAAA' }], true)[0].photo, null);
});

test('fotos bajo demanda: solo se descargan las que faltan y se recuerdan las que no existen', async () => {
  vm.runInContext("WH={tblItems:'items'};items=[{id:'I1',photo:'data:image/jpeg;base64,AAAA'},{id:'I2',photo:null},{id:'I3',photo:null}];__llamadas=[];" +
    "sb={from:()=>({select:()=>({in:async(c,ids)=>{__llamadas.push(ids.join());return {data:ids.map(id=>({id,photo:id==='I2'?'data:image/png;base64,BBBB':null}))};}})})}", ctx);
  const r1 = await t.asegurarFotos(['I1', 'I2', 'I3']);
  assert.strictEqual(JSON.stringify(r1), JSON.stringify({ I2: 'data:image/png;base64,BBBB' }), 'devuelve lo descargado');
  assert.strictEqual(vm.runInContext('items[1].photo', ctx), 'data:image/png;base64,BBBB');
  assert.strictEqual(vm.runInContext('items[2].photo', ctx), null);
  assert.ok(t.noPhotoIds.has('I3'), 'I3 no tiene foto en la nube: no se vuelve a pedir');
  assert.strictEqual(vm.runInContext('__llamadas.join("|")', ctx), 'I2,I3'); // I1 ya tenía foto
  const r2 = await t.asegurarFotos(['I1', 'I2', 'I3']);
  assert.strictEqual(JSON.stringify(r2), '{}');
  assert.strictEqual(vm.runInContext('__llamadas.length', ctx), 1, 'la segunda vez no pide nada');
  t.noPhotoIds.clear();
  vm.runInContext('sb=null', ctx);
});

test('escáner: parseNumES entiende el formato español e inglés y rechaza lo que no es número', () => {
  assert.strictEqual(t.parseNumES('12,50'), 12.5);
  assert.strictEqual(t.parseNumES('1.234,56'), 1234.56);
  assert.strictEqual(t.parseNumES('1,234.56'), 1234.56);
  assert.strictEqual(t.parseNumES('12.5'), 12.5);
  assert.strictEqual(t.parseNumES('12 €'), 12);
  assert.strictEqual(t.parseNumES(7), 7);
  assert.ok(Number.isNaN(t.parseNumES('abc')));
  assert.ok(Number.isNaN(t.parseNumES({})));
  assert.ok(Number.isNaN(t.parseNumES(null)));
  assert.ok(Number.isNaN(t.parseNumES(NaN)));
  assert.ok(Number.isNaN(t.parseNumES('')));
});

test('escáner: _invSanitize limpia texto, números y límites de lo que devuelve la IA', () => {
  const r = t._invSanitize({
    proveedor: '<img src=x onerror=1>ACME',
    fecha: '01/02/2026',
    lines: [
      { desc: '<b>Rodamiento</b> 6205', ref: 'R-1', qty: '3', price: '12,50', unit: 'ud' },
      { desc: 'Sin cantidad', qty: 'abc', price: -4 },
      { desc: 'Enorme', qty: 1e15, price: 1e9 },
      { desc: 'Abono', qty: -2, price: 5 },
      { desc: { x: 1 }, ref: [1], qty: 2, price: null, unit: '<script>' },
      null, 7,
    ],
  });
  assert.ok(!/[<>]/.test(r.proveedor), 'proveedor sin < ni >');
  assert.strictEqual(r.lines.length, 5);
  assert.ok(!/[<>]/.test(r.lines[0].desc));
  assert.strictEqual(r.lines[0].qty, 3);
  assert.strictEqual(r.lines[0].price, 12.5);
  assert.strictEqual(r.lines[1].qty, null);
  assert.strictEqual(r.lines[1].price, null);
  assert.strictEqual(r.lines[1].priceBad, true);
  assert.strictEqual(r.lines[2].qty, null, 'cantidad enorme descartada');
  assert.strictEqual(r.lines[2].price, null);
  assert.strictEqual(r.lines[3].qty, null, 'cantidad negativa descartada');
  assert.strictEqual(r.lines[4].unit, 'ud', 'unidad rara -> ud');
  assert.strictEqual(typeof r.lines[4].desc, 'string');
  const muchas = t._invSanitize({ lines: Array.from({ length: 500 }, () => ({ desc: 'x', qty: 1 })) });
  assert.strictEqual(muchas.lines.length, 200, 'máximo 200 líneas');
  assert.strictEqual(t._invSanitize(null).lines.length, 0);
});

test('escáner: _invValidate exige cantidad entera positiva y precio válido', () => {
  assert.strictEqual(t._invValidate({ qty: 3, price: 2.5 }), '');
  assert.strictEqual(t._invValidate({ qty: 3, price: null }), '');
  assert.notStrictEqual(t._invValidate({ qty: null }), '');
  assert.notStrictEqual(t._invValidate({ qty: 0 }), '');
  assert.notStrictEqual(t._invValidate({ qty: -1 }), '');
  assert.notStrictEqual(t._invValidate({ qty: 2.5 }), '', 'decimales: hay que editarla');
  assert.notStrictEqual(t._invValidate({ qty: 1, price: -3 }), '');
  assert.notStrictEqual(t._invValidate(null), '');
});

test('artículos: cleanItem quita < y > de nombre, referencia, marca, máquina y notas', () => {
  const c = vm.runInContext('cleanItem', ctx)({ id: 'I1', name: '<img src=x onerror=1>Tornillo', ref: 'A<B', brand: '<b>X', machine: 'M>1', notes: '<script>' });
  for (const k of ['name', 'ref', 'brand', 'machine', 'notes']) assert.ok(!/[<>]/.test(c[k]), k);
  assert.ok(c.name.includes('Tornillo'));
});

test('escáner: registrar una línea suma el stock UNA vez, valida, exige admin y no repite', async () => {
  const guardar = vm.runInContext('({rm:registrarMovimiento,dp:dbPut,cp:cloudPut,pa:cloudPriceAdd,ap:addProvider,dg:dbGetAll,cm:closeModal,rl:renderInvoiceLines,rv:refreshVisiblePage})', ctx);
  const dummy = { classList: { add() {}, remove() {} }, style: {}, textContent: '', innerHTML: '' };
  const getAntes = ctx.document.getElementById;
  ctx.document.getElementById = () => dummy;
  try {
    vm.runInContext(String.raw`
      __movs=[];__precios=[];
      registrarMovimiento=async(it,a,n,tipo,c,prov)=>{__movs.push([a,n,tipo,c,prov]);};
      __nube=5;
      dbPut=async()=>{};cloudPut=async it=>{__nube=it.stock;return true;};cloudPriceAdd=async e=>{__precios.push(e);return true;};addProvider=async()=>{};
      dbGetAll=async()=>items;closeModal=()=>{};renderInvoiceLines=()=>{};refreshVisiblePage=()=>{};
      WH={tblCfg:'config',tblItems:'items'};
      sb={from:()=>({select:()=>({limit:async()=>({error:null}),eq:()=>({maybeSingle:async()=>({data:{stock:__nube},error:null})})})})};
      items=[{id:'I1',name:'Rodamiento',stock:99,precio:1}];
      _invProvider='ACME';
      _invLines=[{desc:'x',qty:3,price:2,status:'pending',itemId:null},{desc:'y',qty:null,price:null,status:'pending',itemId:null}];
      adminUnlocked=false;
    `, ctx);
    // sin modo administrador: no hace nada
    await t.assignInvoiceLine(0, 'I1');
    assert.strictEqual(vm.runInContext('items[0].stock', ctx), 99);
    assert.strictEqual(vm.runInContext('_invLines[0].status', ctx), 'pending');
    // con administrador: usa el stock de la nube (5), no el local (99)
    vm.runInContext('adminUnlocked=true', ctx);
    await t.assignInvoiceLine(0, 'I1');
    assert.strictEqual(vm.runInContext('items[0].stock', ctx), 8, 'stock de la nube 5 + 3');
    assert.strictEqual(vm.runInContext('items[0].precio', ctx), 2);
    assert.strictEqual(vm.runInContext('_invLines[0].status', ctx), 'assigned');
    assert.strictEqual(vm.runInContext('__movs.length', ctx), 1);
    assert.strictEqual(vm.runInContext('__precios.length', ctx), 1);
    assert.strictEqual(vm.runInContext('__movs[0][2]', ctx), 'Compra');
    // dos pulsaciones a la vez: solo una entrada
    vm.runInContext("_invLines=[{desc:'z',qty:2,price:null,status:'pending',itemId:null}];items[0].stock=8;__nube=8;__movs=[];", ctx);
    await Promise.all([t.assignInvoiceLine(0, 'I1'), t.assignInvoiceLine(0, 'I1')]);
    assert.strictEqual(vm.runInContext('__movs.length', ctx), 1, 'una sola entrada con doble pulsación');
    assert.strictEqual(vm.runInContext('items[0].stock', ctx), 10);
    // repetir una línea ya registrada no suma otra vez
    await t.assignInvoiceLine(0, 'I1');
    assert.strictEqual(vm.runInContext('items[0].stock', ctx), 10);
    // línea con cantidad no válida: no se registra
    vm.runInContext("_invLines=[{desc:'q',qty:null,price:null,status:'pending',itemId:null}];__movs=[];", ctx);
    await t.assignInvoiceLine(0, 'I1');
    assert.strictEqual(vm.runInContext('__movs.length', ctx), 0);
    // sin conexión: no cambia nada
    vm.runInContext("_invLines=[{desc:'w',qty:4,price:null,status:'pending',itemId:null}];sb=null;", ctx);
    ctx.navigator = { onLine: false };
    await t.assignInvoiceLine(0, 'I1');
    assert.strictEqual(vm.runInContext('items[0].stock', ctx), 10);
    assert.strictEqual(vm.runInContext('_invLines[0].status', ctx), 'pending');
  } finally {
    ctx.navigator = {};
    ctx.document.getElementById = getAntes;
    ctx.__g = guardar;
    vm.runInContext('registrarMovimiento=__g.rm;dbPut=__g.dp;cloudPut=__g.cp;cloudPriceAdd=__g.pa;addProvider=__g.ap;dbGetAll=__g.dg;closeModal=__g.cm;renderInvoiceLines=__g.rl;refreshVisiblePage=__g.rv;sb=null;adminUnlocked=false;_invLines=[];', ctx);
  }
});

test('escáner: cerrar el formulario sin guardar olvida la línea y no se asocia a otro artículo', async () => {
  const dummy = { classList: { add() {}, remove() {} }, style: {}, textContent: '', innerHTML: '' };
  const getAntes = ctx.document.getElementById;
  ctx.document.getElementById = () => dummy;
  try {
    vm.runInContext("_invLines=[{desc:'a',qty:1,status:'pending'}];_invCreateIdx=0;", ctx);
    vm.runInContext("closeModal('modal-form')", ctx); // Escape, deslizar o Cancelar
    assert.strictEqual(vm.runInContext('_invCreateIdx', ctx), null);
    vm.runInContext("closeModal('modal-otro')", ctx); // otras ventanas no tocan la línea
    vm.runInContext("_invCreateIdx=0;closeModal('modal-otro')", ctx);
    assert.strictEqual(vm.runInContext('_invCreateIdx', ctx), 0);
    await new Promise(r => setTimeout(r, 20)); // deja terminar el temporizador que vuelve a la factura
  } finally {
    ctx.document.getElementById = getAntes;
    vm.runInContext('_invCreateIdx=null;_invLines=[];', ctx);
  }
});

test('no quedan contraseñas por defecto en el código', () => {
  const ficheros = ['shared/app.js', 'almacen-electrico/config.js', 'almacen-mecanico/config.js', 'supabase_setup.sql'];
  for (const f of ficheros) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/Mapamsi01|'Electrico'|'Mecanico'|fallbackPass/.test(s), f);
  }
});
