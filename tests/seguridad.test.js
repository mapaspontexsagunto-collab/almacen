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
vm.runInContext(src + '\n;globalThis.__t={isSafeId,safePhoto,safeUrl,cleanItem,cleanItems,cleanShelves,cleanAisles,strArr,jsq,esc,cleanText,sessionValid,quienMov,whBarHtml,sesStorageKey,logout,isAdminRole,ensureOnline,GUARDED_FUNCS,asegurarFotos,noPhotoIds,pedirFoto,parseNumES,_invSanitize,_invValidate,assignInvoiceLine,_invoiceAfterSave,_invCleanProvider,invoiceSetProvider};', ctx);
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
  // "1.500" es ambiguo: en un precio se rechaza; en una cantidad se toma como mil
  assert.ok(Number.isNaN(t.parseNumES('1.500')));
  assert.strictEqual(t.parseNumES('1.500', { miles: true }), 1500);
  assert.strictEqual(t.parseNumES('12.500.000', { miles: true }), 12500000);
  assert.strictEqual(t.parseNumES('1,5'), 1.5);
  assert.strictEqual(t.parseNumES('0,125'), 0.125, 'precio con 3 decimales con coma (así se muestra en el campo)');
  assert.ok(Number.isNaN(t.parseNumES('1e5')));
  assert.ok(Number.isNaN(t.parseNumES('0x10')));
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
  assert.strictEqual(t._invSanitize({ lines: [{ desc: 'sin cantidad' }] }).lines[0].qty, null, 'sin cantidad: la persona debe escribirla');
  assert.strictEqual(t._invSanitize({ lines: [{ desc: 'p', qty: 1, price: '1.500' }] }).lines[0].priceBad, true, 'precio ambiguo se marca');
});

test('escáner: _invValidate exige cantidad entera positiva y precio válido', () => {
  assert.strictEqual(t._invValidate({ qty: 3, price: 2.5 }), '');
  assert.strictEqual(t._invValidate({ qty: 3, price: null }), '');
  assert.notStrictEqual(t._invValidate({ qty: null }), '');
  assert.notStrictEqual(t._invValidate({ qty: 0 }), '');
  assert.notStrictEqual(t._invValidate({ qty: -1 }), '');
  assert.notStrictEqual(t._invValidate({ qty: 2.5 }), '', 'decimales: hay que editarla');
  assert.notStrictEqual(t._invValidate({ qty: 1, price: -3 }), '');
  assert.notStrictEqual(t._invValidate({ qty: 1, price: null, priceBad: true }), '', 'un precio marcado como dudoso bloquea la línea');
  assert.notStrictEqual(t._invValidate(null), '');
});

test('artículos: cleanItem quita < y > de nombre, referencia, marca, máquina y notas', () => {
  const c = vm.runInContext('cleanItem', ctx)({ id: 'I1', name: '<img src=x onerror=1>Tornillo', ref: 'A<B', brand: '<b>X', machine: 'M>1', notes: '<script>' });
  for (const k of ['name', 'ref', 'brand', 'machine', 'notes']) assert.ok(!/[<>]/.test(c[k]), k);
  assert.ok(c.name.includes('Tornillo'));
});

test('escáner: registrar una línea suma el stock UNA vez, valida, exige admin y no repite', async () => {
  const guardar = vm.runInContext('({rm:registrarMovimiento,dp:dbPut,cp:cloudPut,cu:cloudUpdateFields,pa:cloudPriceAdd,ap:addProvider,dg:dbGetAll,cm:closeModal,rl:renderInvoiceLines,rv:refreshVisiblePage})', ctx);
  const dummy = { classList: { add() {}, remove() {} }, style: {}, textContent: '', innerHTML: '' };
  const getAntes = ctx.document.getElementById;
  ctx.document.getElementById = () => dummy;
  try {
    vm.runInContext(String.raw`
      __movs=[];__precios=[];
      registrarMovimiento=async(it,a,n,tipo,c,prov)=>{__movs.push([a,n,tipo,c,prov]);};
      __nube=5;
      dbPut=async()=>{};cloudPut=async it=>{__nube=it.stock;return true;};cloudUpdateFields=async(id,f)=>{__nube=f.stock;return true;};cloudPriceAdd=async e=>{__precios.push(e);return true;};addProvider=async()=>{};
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
    assert.strictEqual(vm.runInContext('__movs[0][4]', ctx), 'ACME', 'el movimiento lleva el proveedor');
    assert.strictEqual(vm.runInContext('__precios[0].provider', ctx), 'ACME', 'y el histórico de precios también');
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
    vm.runInContext('registrarMovimiento=__g.rm;dbPut=__g.dp;cloudPut=__g.cp;cloudUpdateFields=__g.cu;cloudPriceAdd=__g.pa;addProvider=__g.ap;dbGetAll=__g.dg;closeModal=__g.cm;renderInvoiceLines=__g.rl;refreshVisiblePage=__g.rv;sb=null;adminUnlocked=false;_invLines=[];items=[];_invProvider="";WH=null;', ctx);
  }
});

test('escáner: cerrar el formulario sin guardar olvida la línea pendiente de crear', async () => {
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

test('escáner: cerrar la factura cancela un escaneo en curso', () => {
  const dummy = { classList: { add() {}, remove() {} }, style: {}, textContent: '', innerHTML: '' };
  const getAntes = ctx.document.getElementById;
  ctx.document.getElementById = () => dummy;
  try {
    vm.runInContext('_invScanning=true;_invScanId=5;', ctx);
    vm.runInContext("closeModal('modal-invoice')", ctx);
    assert.strictEqual(vm.runInContext('_invScanning', ctx), false, 'se puede empezar otro escaneo');
    assert.strictEqual(vm.runInContext('_invScanId', ctx), 6, 'el escaneo anterior queda invalidado');
  } finally {
    ctx.document.getElementById = getAntes;
  }
});

test('escáner: un artículo nuevo con stock 0 no registra la compra y la línea sigue pendiente', async () => {
  const guardar = vm.runInContext('({rm:registrarMovimiento,pa:cloudPriceAdd,ap:addProvider,rv:renderInvoiceModal,ts:toast})', ctx);
  try {
    vm.runInContext(String.raw`
      __movs=[];__precios=[];
      registrarMovimiento=async()=>{__movs.push(1);};cloudPriceAdd=async e=>{__precios.push(e);return true;};addProvider=async()=>{};
      renderInvoiceModal=()=>{};toast=()=>{};
      adminUnlocked=true;_invProvider='ACME';
      items=[{id:'N1',name:'Nuevo',stock:0,precio:3}];
      _invLines=[{desc:'x',qty:5,price:3,status:'pending',itemId:null}];
    `, ctx);
    await t._invoiceAfterSave('N1', 0);
    assert.strictEqual(vm.runInContext('_invLines[0].status', ctx), 'pending');
    assert.strictEqual(vm.runInContext('__movs.length', ctx), 0);
    assert.strictEqual(vm.runInContext('__precios.length', ctx), 0, 'sin unidades no hay historial de precios');
    // con stock real: registra la compra con el stock final del formulario
    vm.runInContext("items[0].stock=4;", ctx);
    await t._invoiceAfterSave('N1', 0);
    assert.strictEqual(vm.runInContext('_invLines[0].status', ctx), 'assigned');
    assert.strictEqual(vm.runInContext('__movs.length', ctx), 1);
    assert.strictEqual(vm.runInContext('__precios[0].qty', ctx), 4);
    // con el modo administrador bloqueado no hace nada
    vm.runInContext("__movs=[];adminUnlocked=false;_invLines=[{desc:'y',qty:1,price:1,status:'pending',itemId:null}];items[0].stock=2;", ctx);
    await t._invoiceAfterSave('N1', 0);
    assert.strictEqual(vm.runInContext('__movs.length', ctx), 0);
  } finally {
    ctx.__g2 = guardar;
    vm.runInContext('registrarMovimiento=__g2.rm;cloudPriceAdd=__g2.pa;addProvider=__g2.ap;renderInvoiceModal=__g2.rv;toast=__g2.ts;adminUnlocked=false;_invLines=[];items=[];_invProvider="";', ctx);
  }
});

test('escáner: el proveedor se puede editar, se limpia y se recorta', () => {
  assert.strictEqual(t._invCleanProvider('  ACME   S.L.  '), 'ACME S.L.');
  assert.ok(!/[<>]/.test(t._invCleanProvider('<img src=x onerror=1>ACME')));
  assert.strictEqual(t._invCleanProvider('x'.repeat(200)).length, 80);
  assert.strictEqual(t._invCleanProvider(null), '');
  const el = { value: '  Suministros   Pérez  ' };
  t.invoiceSetProvider(el, true);
  assert.strictEqual(vm.runInContext('_invProvider', ctx), 'Suministros Pérez');
  assert.strictEqual(el.value, 'Suministros Pérez', 'al terminar de escribir se muestra limpio');
  const el2 = { value: 'Acme ' };
  t.invoiceSetProvider(el2, false);
  assert.strictEqual(el2.value, 'Acme ', 'mientras se escribe no se toca el campo');
  assert.strictEqual(vm.runInContext('_invProvider', ctx), 'Acme');
  t.invoiceSetProvider({ value: '' }, false);
  assert.strictEqual(vm.runInContext('_invProvider', ctx), '');
  vm.runInContext('_invProvider=""', ctx);
});

test('no quedan contraseñas por defecto en el código', () => {
  const ficheros = ['shared/app.js', 'almacen-electrico/config.js', 'almacen-mecanico/config.js', 'supabase_setup.sql'];
  for (const f of ficheros) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/Mapamsi01|'Electrico'|'Mecanico'|fallbackPass/.test(s), f);
  }
});

// ===== Integridad del stock (bloque R1) =====
// Entorno simulado: nube (sb) configurable, base local y avisos registrados. Todo se restaura al terminar.
const NOMBRES_R1 = 'registrarMovimiento,dbPut,dbDelete,dbGetAll,cfgPut,cloudCfgPut,closeModal,openModal,renderAll,renderItems,renderMap,refreshVisiblePage,updateOrganizeBanner,toast,syncFromCloud,_syncFromCloud,_pushToCloud,_invoiceAfterSave,updateSyncBadge,cfgGet,pushPendingMovements,cloudGetMeta,dbReplaceAll,cloudCfgGetMany,setCloudStatus';
async function conNube(opciones, fn) {
  const orig = vm.runInContext('({' + NOMBRES_R1.split(',').map(n => n + ':' + n).join(',') + ',sb:sb,WH:WH,items:items,cur:currentItem,pd:pendingDelta,di:dirtyIds,dd:dirtyDel,df:dirtyFields,ok:cloudOK,ed:editingId,sbusy:_stockBusy,sync:_syncing,sh:shelves,av:adjustValue,cat:categories,aht:addHereTarget,ahs:[...addHereSel],mds:mapDraftShelves,esi:editShelfIdx})', ctx);
  const getAntes = ctx.document.getElementById;
  const dom = Object.assign({}, opciones.dom || {});
  const dummy = () => ({ classList: { add() {}, remove() {}, contains: () => false }, style: {}, textContent: '', innerHTML: '', value: '', onclick: null });
  const cache = {};
  ctx.document.getElementById = id => (cache[id] = cache[id] || Object.assign(dummy(), dom[id] || {}));
  ctx.__dom = cache;
  try {
    vm.runInContext(String.raw`
      __calls=[];__toasts=[];__movs=[];__closed=[];__opened=[];__dbDel=[];__dbPuts=[];
      __stock=()=>({data:{stock:5},error:null});   // lectura del stock en la nube
      __upd=()=>({data:[{id:'x'}],error:null});    // respuesta de update
      registrarMovimiento=async(it,a,n,tipo,c,prov)=>{__movs.push([a,n,tipo,c,prov]);};
      dbPut=async it=>{__dbPuts.push(it.id);};dbDelete=async id=>{__dbDel.push(id);};dbGetAll=async()=>items;
      cfgPut=async()=>{};cloudCfgPut=async()=>true;
      closeModal=id=>{__closed.push(id);};openModal=id=>{__opened.push(id);};
      renderAll=()=>{};renderItems=()=>{};renderMap=()=>{};refreshVisiblePage=()=>{};updateOrganizeBanner=()=>{};updateSyncBadge=()=>{};
      toast=m=>{__toasts.push(String(m));};
      WH={tblCfg:'config',tblItems:'items'};
      __probe=()=>({data:[{key:'categories'}],error:null}); // prueba de lectura (tabla de configuración): la sesión puede leer
      __cfg={};cfgPut=async(k,v)=>{__cfg[k]=JSON.parse(JSON.stringify(v));};
      dirtyIds=new Set();dirtyDel=new Set();dirtyFields=Object.create(null);pendingDelta=0;currentItem=null;cloudOK=true;_stockBusy=false;_syncing=false;
      sb={from:()=>({
        select:()=>({limit:async()=>__probe(),eq:()=>({maybeSingle:async()=>__stock()})}),
        update:f=>({eq:(c,id)=>({select:async()=>{__calls.push(['update',f,id]);return __upd();}})}),
        upsert:async o=>{__calls.push(['upsert',o]);return {error:null};}
      })};
    `, ctx);
    await fn();
  } finally {
    ctx.document.getElementById = getAntes;
    ctx.__o = orig;
    vm.runInContext(NOMBRES_R1.split(',').map(n => n + '=__o.' + n).join(';') + ';sb=__o.sb;WH=__o.WH;items=__o.items;currentItem=__o.cur;pendingDelta=__o.pd;dirtyIds=__o.di;dirtyDel=__o.dd;dirtyFields=__o.df;cloudOK=__o.ok;editingId=__o.ed;_stockBusy=__o.sbusy;_syncing=__o.sync;shelves=__o.sh;adjustValue=__o.av;categories=__o.cat;addHereTarget=__o.aht;addHereSel.clear();__o.ahs.forEach(x=>addHereSel.add(x));mapDraftShelves=__o.mds;editShelfIdx=__o.esi;', ctx);
  }
}
const ev = s => vm.runInContext(s, ctx);
const evj = s => JSON.parse(vm.runInContext('JSON.stringify(' + s + ')', ctx)); // objetos/listas del contexto -> normales

test('stock: fetchCloudStock distingue artículo borrado, error y tiempo agotado', async () => {
  await conNube({}, async () => {
    ev("__stock=()=>({data:{stock:7},error:null})");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await ev('fetchCloudStock("I1")'))), { ok: true, stock: 7 });
    ev("__stock=()=>({data:null,error:null})");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await ev('fetchCloudStock("I1")'))), { missing: true });
    ev("__stock=()=>({data:null,error:{message:'rls'}})");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await ev('fetchCloudStock("I1")'))), { error: true });
    ev("__stock=()=>{throw new Error('red')}");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await ev('fetchCloudStock("I1")'))), { error: true });
    ev("__stock=()=>({data:{stock:null},error:null})"); // fila sin stock legible: no es "borrado"
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await ev('fetchCloudStock("I1")'))), { error: true });
    ev('sb=null');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await ev('fetchCloudStock("I1")'))), { error: true });
  });
});

test('stock: cloudUpdateFields actualiza solo las columnas, nunca recrea y encola los fallos', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:3,photo:'data:image/png;base64,AAAA'}]");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{loc:'01-2',pos:''})"), true);
    assert.deepStrictEqual(JSON.parse(ev("JSON.stringify(__calls)")), [['update', { loc: '01-2', pos: '' }, 'I1']]);
    // 0 filas: el artículo ya no existe -> 'missing', sin upsert y sin encolar
    ev("__calls=[];__upd=()=>({data:[],error:null})");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), 'missing');
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0);
    assert.strictEqual(ev("dirtyIds.has('I1')"), false);
    // error de red: false y quedan en la cola de cambios PARCIALES (no como artículo entero)
    ev("__upd=()=>({data:null,error:{message:'red'}})");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), false);
    assert.deepStrictEqual(evj("dirtyFields"), { I1: { stock: 1 } });
    assert.strictEqual(ev("dirtyIds.has('I1')"), false);
    // un segundo fallo se fusiona con el primero (no lo pierde)
    assert.strictEqual(await ev("cloudUpdateFields('I1',{loc:'01-3',pos:'g'})"), false);
    assert.deepStrictEqual(evj("dirtyFields"), { I1: { stock: 1, loc: '01-3', pos: 'g' } });
    // solo se guardan las columnas conocidas
    await ev("cloudUpdateFields('I1',{name:'x',photo:'y',stock:2})");
    assert.deepStrictEqual(evj("dirtyFields.I1"), { stock: 2, loc: '01-3', pos: 'g' });
    // una subida correcta de esas columnas las quita de la cola
    ev("__upd=()=>({data:[{id:'I1'}],error:null})");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:4})"), true);
    assert.deepStrictEqual(evj("dirtyFields.I1"), { loc: '01-3', pos: 'g' });
    assert.strictEqual(await ev("cloudUpdateFields('I1',{loc:'01-3',pos:'g'})"), true);
    assert.deepStrictEqual(evj("dirtyFields"), {}, 'sin columnas pendientes se quita la entrada');
    // artículo ya pendiente de subir (alta/cambio local): se sube entero como siempre (sin foto que no toque)
    ev("markDirty('I1');__calls=[]");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), true);
    const c = JSON.parse(ev("JSON.stringify(__calls)"));
    assert.strictEqual(c.length, 1);
    assert.strictEqual(c[0][0], 'upsert');
    assert.strictEqual(ev("dirtyIds.has('I1')"), false, 'el volcado entero limpia la cola');
    // sin nube: cola parcial
    ev("sb=null;dirtyIds=new Set()");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), false);
    assert.deepStrictEqual(evj("dirtyFields"), { I1: { stock: 1 } });
    assert.strictEqual(ev("dirtyIds.has('I1')"), false);
  });
});

test('stock: un "0 filas" con la sesión caída (RLS) NO se toma por artículo borrado', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:9},{id:'I2',name:'B',stock:1}];currentItem=items[0];pendingDelta=-1");
    // la nube devuelve vacío SIN error y la prueba de lectura también (sesión caducada / usuario retirado)
    ev("__stock=()=>({data:null,error:null});__upd=()=>({data:[],error:null});__probe=()=>({data:[],error:null})");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await ev('fetchCloudStock("I1")'))), { error: true });
    assert.strictEqual(await ev('cloudPuedeLeer()'), false);
    await ev('confirmPending()');
    assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I1', 'I2'], 'no se quita nada');
    assert.deepStrictEqual(evj('__dbDel'), []);
    assert.strictEqual(ev('items[0].stock'), 9);
    assert.strictEqual(ev('__movs.length'), 0);
    assert.strictEqual(ev('__calls.length'), 0, 'ni update ni upsert');
    assert.ok(ev('__toasts.pop()').includes('No se pudo comprobar el stock'));
    assert.ok(!ev('__toasts').some(m => m.includes('eliminado')));
    // el update (stock ya leído) devuelve 0 filas con la sesión caída: error, queda pendiente y no se borra
    ev("__stock=()=>({data:{stock:9},error:null});__toasts=[];pendingDelta=-1");
    await ev('confirmPending()');
    assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I1', 'I2'], 'tampoco aquí se quita');
    assert.deepStrictEqual(evj('__dbDel'), []);
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { stock: 8 } }, 'el cambio queda pendiente de subir');
    const ultimo = ev('__toasts').pop();
    assert.ok(ultimo.includes('pendiente de subir') && !ultimo.includes('eliminado'), ultimo);
    // la prueba falla (error / tiempo agotado): mismo resultado, ni se borra ni se recrea
    for (const p of ["({data:null,error:{message:'jwt'}})", "(()=>{throw new Error('Tiempo agotado: acceso')})()"]) {
      ev("dirtyFields=Object.create(null);__calls=[];__upd=()=>({data:[],error:null});__probe=()=>" + p);
      assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), false);
      assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I1', 'I2']);
      assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0);
    }
    // la prueba devuelve una fila: ahora sí es un borrado real y se quita como antes
    ev("__probe=()=>({data:[{key:'categories'}],error:null});dirtyFields=Object.create(null);__stock=()=>({data:null,error:null});__toasts=[];pendingDelta=-1");
    await ev('confirmPending()');
    assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I2']);
    assert.deepStrictEqual(evj('__dbDel'), ['I1']);
    assert.ok(ev('__toasts').pop().includes('eliminado'));
  });
});

test('stock: si la lectura del stock falla no se cambia nada a ciegas (fail-closed)', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:99,photo:null}];currentItem=items[0];pendingDelta=-2");
    ev("__stock=()=>{throw new Error('Tiempo agotado: stock')}");
    await ev('confirmPending()');
    assert.strictEqual(ev('items[0].stock'), 99);
    assert.strictEqual(ev('__movs.length'), 0, 'sin movimiento');
    assert.strictEqual(ev('__calls.length'), 0, 'sin escritura en la nube');
    assert.ok(ev('__toasts').some(m => m.includes('No se pudo comprobar el stock')));
    assert.strictEqual(ev('_stockBusy'), false, 'se libera el bloqueo');
    // lo mismo con el ajuste a un valor y con la compra
    ev("adjustValue=50");
    await ev('applyAdjust()');
    assert.strictEqual(ev('__movs.length'), 0);
    assert.strictEqual(ev('__calls.length'), 0);
  });
});

test('stock: si otro administrador borró el artículo, restar stock NO lo resucita', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:9,photo:'data:image/png;base64,AAAA'},{id:'I2',name:'B',stock:1}];currentItem=items[0];pendingDelta=-1");
    ev("__stock=()=>({data:null,error:null})"); // la fila ya no existe
    await ev('confirmPending()');
    assert.strictEqual(ev('__calls.length'), 0, 'ni update ni upsert');
    assert.strictEqual(ev('__movs.length'), 0);
    assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I2'], 'se quita de la lista local');
    assert.deepStrictEqual(evj('__dbDel'), ['I1']);
    assert.ok(ev('__closed').includes('modal-detail'), 'se cierra la ficha');
    assert.strictEqual(ev('currentItem'), null);
    assert.ok(ev('__toasts').some(m => m.includes('eliminado')));
    assert.strictEqual(ev("dirtyIds.has('I1')"), false);
  });
});

test('stock: restar stock sube SOLO el stock (sin foto ni nombre) y se registra el movimiento', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:99,precio:2,photo:'data:image/png;base64,AAAA',loc:'01-1'}];currentItem=items[0];pendingDelta=-2");
    await ev('confirmPending()'); // la nube dice 5 -> 3
    assert.strictEqual(ev('items[0].stock'), 3);
    assert.deepStrictEqual(evj('__movs'), [[5, 3, 'Salida', 4, null]], 'anterior de la nube (5), no el local (99)');
    assert.deepStrictEqual(JSON.parse(ev('JSON.stringify(__calls)')), [['update', { stock: 3 }, 'I1']]);
    assert.strictEqual(ev("dirtyIds.has('I1')"), false);
  });
});

test('stock: si el artículo se borra justo entre la lectura y la subida tampoco se recrea', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:5}];currentItem=items[0];pendingDelta=1");
    ev("__upd=()=>({data:[],error:null})"); // el update no afecta a ninguna fila
    await ev('confirmPending()');
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0);
    assert.deepStrictEqual(ev('items.length'), 0);
    assert.ok(ev('__toasts').some(m => m.includes('eliminado')));
  });
});

test('stock: _confirmPending y _applyAdjust restauran el stock si falla el movimiento y avisan si falla lo demás', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:5}];currentItem=items[0];pendingDelta=-1");
    ev("registrarMovimiento=async()=>{throw new Error('idb')}");
    await ev('confirmPending()'); // no debe lanzar
    assert.strictEqual(ev('items[0].stock'), 5, 'stock restaurado');
    assert.strictEqual(ev('__calls.length'), 0, 'nada se sube');
    assert.ok(ev('__toasts').some(m => m.includes('Error al registrar')));
    ev("adjustValue=2;__toasts=[]");
    await ev('applyAdjust()');
    assert.strictEqual(ev('items[0].stock'), 5);
    assert.strictEqual(ev('__calls.length'), 0);
    assert.ok(ev('__toasts').some(m => m.includes('Error al registrar')));
    // el movimiento va bien pero falla guardar en el móvil (la nube sí sube): el ÚLTIMO aviso es el de éxito con la advertencia
    ev("registrarMovimiento=async(it,a,n,t)=>{__movs.push([a,n,t]);};dbPut=async()=>{throw new Error('cuota')};__toasts=[];__movs=[];pendingDelta=-1");
    await ev('confirmPending()');
    assert.strictEqual(ev('__movs.length'), 1);
    let ultimo = ev('__toasts').pop();
    assert.ok(ultimo.startsWith('−1 ud') && ultimo.includes('no guardado en el móvil'), ultimo);
    // y si falla la subida: queda en la cola de cambios parciales y el ÚLTIMO aviso lo dice (no se tapa con el de éxito)
    ev("dbPut=async()=>{};dirtyIds=new Set();__upd=()=>({data:null,error:{message:'red'}});__toasts=[];pendingDelta=-1");
    await ev('confirmPending()');
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { stock: 4 } }, 'la nube dice 5 -> 4');
    assert.strictEqual(ev("dirtyIds.has('I1')"), false, 'cambio parcial: no se sube la fila entera');
    ultimo = ev('__toasts').pop();
    assert.ok(ultimo.startsWith('−1 ud') && ultimo.endsWith('⚠ pendiente de subir'), ultimo);
    assert.ok(!ev('__toasts').some(m => m.includes('no se pudo subir')), 'ya no hay un toast de advertencia que el de éxito tape');
    // todo bien: sin sufijo
    ev("__upd=()=>({data:[{id:'I1'}],error:null});__toasts=[];pendingDelta=-1");
    await ev('confirmPending()');
    assert.strictEqual(ev('__toasts.pop()'), '−1 ud · stock: 3', 'con stock pendiente manda el local (4), no el de la nube (5)');
    assert.deepStrictEqual(evj('dirtyFields'), {}, 'subido: se quita de la cola');
  });
});

test('avisos: el aviso de pendiente de subir llega al final en ajuste, compra y escáner (no lo tapa el de éxito)', async () => {
  const dom = { 'pur-qty': { value: '3' }, 'pur-price': { value: '' }, 'pur-discount': { value: '' }, 'pur-provider': { value: '' } };
  await conNube({ dom }, async () => {
    const g = ev('({pa:cloudPriceAdd,ap:addProvider,rp:renderPriceHistory,adm:adminUnlocked,il:_invLines,ip:_invProvider,ri:renderInvoiceLines})'); ctx.__gt = g;
    try {
      ev("items=[{id:'I1',name:'A',stock:5}];currentItem=items[0];cloudPriceAdd=async()=>true;addProvider=async()=>{};renderPriceHistory=()=>{};__upd=()=>({data:null,error:{message:'red'}})");
      ev("adjustValue=7");
      await ev('applyAdjust()');
      assert.strictEqual(ev('__toasts.pop()'), 'Stock actualizado: 7 · ⚠ pendiente de subir');
      await ev('applyPurchase()');
      let ultimo = ev('__toasts.pop()');
      assert.ok(ultimo.startsWith('✓ Entrada de compra: +3') && ultimo.endsWith('⚠ pendiente de subir'), ultimo);
      // línea de factura
      ev("adminUnlocked=true;_invProvider='';_invLines=[{desc:'x',qty:2,price:null,status:'pending',itemId:null}];renderInvoiceLines=()=>{};");
      await ev("assignInvoiceLine(0,'I1')");
      ultimo = ev('__toasts.pop()');
      assert.ok(ultimo.startsWith('✓ A · +2 ud') && ultimo.endsWith('⚠ pendiente de subir'), ultimo);
      assert.ok(ev('dirtyFields.I1.stock') > 0);
      // con la subida correcta no hay sufijo
      ev("__upd=()=>({data:[{id:'I1'}],error:null});_invLines=[{desc:'y',qty:1,price:null,status:'pending',itemId:null}];");
      await ev("assignInvoiceLine(0,'I1')");
      assert.strictEqual(ev('__toasts.pop()'), '✓ A · +1 ud');
      assert.strictEqual(ev("dirtyFields.I1"), undefined, 'la subida correcta quita la cola parcial');
    } finally {
      vm.runInContext('cloudPriceAdd=__gt.pa;addProvider=__gt.ap;renderPriceHistory=__gt.rp;adminUnlocked=__gt.adm;_invLines=__gt.il;_invProvider=__gt.ip;renderInvoiceLines=__gt.ri;', ctx);
    }
  });
});

test('ubicación: colocar/mover solo envía loc y pos, no recrea borrados y avisa del resultado', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:3,loc:'',pos:''},{id:'I2',name:'B',stock:4,loc:'',pos:''},{id:'I3',name:'C',stock:5,loc:'',pos:''}]");
    ev("__upd=()=>(__calls[__calls.length-1][2]==='I2'?{data:[],error:null}:(__calls[__calls.length-1][2]==='I3'?{data:null,error:{message:'red'}}:{data:[{id:'x'}],error:null}))");
    ev("addHereTarget={sid:'01',balda:'2',cid:'g1'};addHereSel.clear();['I1','I2','I3'].forEach(i=>addHereSel.add(i));");
    await ev('ahPlace()');
    const llamadas = JSON.parse(ev('JSON.stringify(__calls)'));
    assert.deepStrictEqual(llamadas.map(c => c[0]), ['update', 'update', 'update']);
    for (const c of llamadas) assert.deepStrictEqual(c[1], { loc: '01-2', pos: 'g1' });
    assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I1', 'I3'], 'I2 (borrado por otra persona) se quita');
    assert.deepStrictEqual(evj("dirtyFields"), { I3: { loc: '01-2', pos: 'g1' } }, 'el fallo de red queda en la cola parcial (solo loc/pos)');
    assert.strictEqual(ev("dirtyIds.has('I3')"), false);
    const aviso = ev('__toasts').pop();
    assert.ok(aviso.includes('sin subir') && aviso.includes('ya no existían'), aviso);
    // mover una celda: solo loc/pos
    ev("__calls=[];__upd=()=>({data:[{id:'I1'}],error:null});__toasts=[]");
    await ev("moveItemToCell('I1','02','3','')");
    assert.deepStrictEqual(JSON.parse(ev('JSON.stringify(__calls)')), [['update', { loc: '02-3', pos: '' }, 'I1']]);
    assert.strictEqual(ev("__toasts.pop()"), '✓ Movido');
    // si la fila no existe, tampoco se recrea
    ev("__calls=[];__upd=()=>({data:[],error:null});__toasts=[]");
    await ev("moveItemToCell('I1','02','4','')");
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0);
    assert.ok(ev('__toasts').pop().includes('eliminado'));
  });
});

test('ubicación: renombrar el código de una estantería reubica con update parcial', async () => {
  await conNube({ dom: { 'es-name': { value: 'Nueva' }, 'es-code': { value: '02' }, 'es-baldas': { value: '3' } } }, async () => {
    ev("items=[{id:'I1',name:'A',stock:3,loc:'01-1',pos:'g1',photo:'data:image/png;base64,AAAA'},{id:'I2',name:'B',stock:2,loc:'01-2'},{id:'I3',name:'C',stock:1,loc:'05-1'}]");
    ev("mapDraftShelves=[{id:'01',name:'E1',baldas:3}];editShelfIdx=0;");
    await ev('saveEditShelf()');
    const llamadas = JSON.parse(ev('JSON.stringify(__calls)'));
    assert.deepStrictEqual(llamadas.map(c => c[2]), ['I1', 'I2'], 'solo los de esa estantería');
    assert.strictEqual(llamadas[0][1].loc, '02-1');
    assert.strictEqual(llamadas[0][1].pos, 'g1');
    assert.strictEqual(llamadas[1][1].loc, '02-2');
    for (const c of llamadas) assert.ok(!('stock' in c[1]) && !('photo' in c[1]) && !('name' in c[1]), 'sin stock, foto ni nombre');
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0);
    assert.strictEqual(ev("items.find(i=>i.id==='I1').loc"), '02-1');
  });
});

test('QR "colocar aquí": espera a la cadena, revierte si falla lo local y avisa al final', async () => {
  await conNube({}, async () => {
    const t = "{sid:'01',balda:'2',cid:''}";
    ev("items=[{id:'I1',name:'Rodamiento',stock:3,loc:'05-1',pos:'x'}]");
    // fallo local: se restaura la ubicación y no se sube nada
    ev("dbPut=async()=>{throw new Error('cuota')}");
    await ev("placeScannedItem(items[0]," + t + ")");
    assert.strictEqual(ev('items[0].loc'), '05-1');
    assert.strictEqual(ev('items[0].pos'), 'x');
    assert.strictEqual(ev('__calls.length'), 0);
    assert.ok(ev('__toasts').pop().includes('No se pudo guardar'));
    assert.ok(!ev('__toasts').some(m => m.includes('colocado aquí')), 'sin toast de éxito');
    // éxito: update parcial y toast de éxito SOLO al terminar
    ev("dbPut=async()=>{};__toasts=[]");
    const p = ev("placeScannedItem(items[0]," + t + ")");
    assert.strictEqual(ev('__toasts.length'), 0, 'aún no hay aviso de éxito');
    await p;
    assert.deepStrictEqual(JSON.parse(ev('JSON.stringify(__calls)')), [['update', { loc: '01-2', pos: '' }, 'I1']]);
    assert.strictEqual(ev('__toasts.pop()'), '✓ Rodamiento colocado aquí');
    // la nube falla: se conserva en local, queda en la cola y el aviso lo dice
    ev("__upd=()=>({data:null,error:{message:'red'}});__toasts=[]");
    await ev("placeScannedItem(items[0],{sid:'03',balda:'1',cid:''})");
    assert.deepStrictEqual(evj("dirtyFields"), { I1: { loc: '03-1', pos: '' } });
    assert.strictEqual(ev("dirtyIds.has('I1')"), false);
    assert.ok(ev('__toasts.pop()').includes('no se pudo subir'));
    // artículo borrado por otra persona
    ev("__upd=()=>({data:[],error:null});__toasts=[];dirtyIds=new Set()");
    await ev("placeScannedItem(items[0],{sid:'04',balda:'1',cid:''})");
    assert.strictEqual(ev('items.length'), 0);
    assert.ok(ev('__toasts.pop()').includes('eliminado'));
  });
});

test('formulario: stock y precio se validan, vacío/NaN al editar no guarda ni registra salidas', async () => {
  const form = (o) => Object.assign({ 'f-name': { value: 'Tornillo' }, 'f-cat': { value: 'Tornillería' }, 'f-shelf': { value: '01' }, 'f-balda': { value: '1' }, 'f-stock': { value: '7' }, 'f-min': { value: '2' }, 'f-precio': { value: '' }, 'f-precio-group': { style: { display: '' } } }, o);
  // parseFormNum: valor canónico del navegador, sin la ambigüedad de los puntos de millar
  assert.strictEqual(ev("parseFormNum('0.125')"), 0.125);
  assert.strictEqual(ev("parseFormNum('12')"), 12);
  assert.strictEqual(ev("parseFormNum('1.234,50')"), 1234.5);
  assert.ok(Number.isNaN(ev("parseFormNum('abc')")));
  assert.ok(Number.isNaN(ev("parseFormNum('')")));
  const intenta = async (campos, edit, extra) => {
    let r;
    await conNube({ dom: form(campos) }, async () => {
      ev("categories=['Tornillería'];selectedExtraCats=new Set();_invCreateIdx=null;pendingPhoto=null;photoRemoved=false;_formStock0=4;_invoiceAfterSave=async()=>{};cloudPut=async it=>{__calls.push(['put',it]);return true;};");
      ev("items=[{id:'I1',name:'Tornillo',stock:4,precio:1,loc:'01-1'}];editingId=" + (edit ? "'I1'" : 'null'));
      if (extra) ev(extra);
      await ev('_saveItem()');
      r = { calls: JSON.parse(ev('JSON.stringify(__calls)')), movs: ev('__movs.length'), toasts: ev('__toasts.slice()'), closed: ev('__closed.slice()') };
    });
    return r;
  };
  const cp = ev('cloudPut'); ctx.__cp0 = cp;
  try {
    // editar con stock vacío: aviso, no guarda, ninguna "Salida"
    let r = await intenta({ 'f-stock': { value: '' } }, true);
    assert.strictEqual(r.calls.length, 0); assert.strictEqual(r.movs, 0);
    assert.ok(r.toasts.some(m => m.includes('Indica el stock')));
    // texto no numérico descartado por el navegador (badInput)
    r = await intenta({ 'f-stock': { value: '', validity: { badInput: true } } }, true);
    assert.strictEqual(r.calls.length, 0); assert.ok(r.toasts.some(m => m.includes('Stock no válido')));
    // decimal, negativo
    for (const v of ['1.5', '-3']) {
      r = await intenta({ 'f-stock': { value: v } }, true);
      assert.strictEqual(r.calls.length, 0, v); assert.strictEqual(r.movs, 0, v);
      assert.ok(r.toasts.some(m => m.includes('Stock no válido')), v);
    }
    // precio no válido (antes se guardaba como 0)
    r = await intenta({ 'f-precio': { value: 'abc' } }, true);
    assert.strictEqual(r.calls.length, 0); assert.ok(r.toasts.some(m => m.includes('Precio no válido')));
    r = await intenta({ 'f-precio': { value: '', validity: { badInput: true } } }, true);
    assert.strictEqual(r.calls.length, 0); assert.ok(r.toasts.some(m => m.includes('Precio no válido')));
    r = await intenta({ 'f-precio': { value: '-2' } }, true);
    assert.strictEqual(r.calls.length, 0);
    // nada inválido se ha guardado: la categoría no se escribió antes de validar
    // válido al editar: el stock de la nube (5) y el formulario (7): Entrada de 2 y precio 0.125 intacto
    r = await intenta({ 'f-precio': { value: '0.125' } }, true);
    assert.strictEqual(r.calls.filter(c => c[0] === 'put').length, 1);
    const it = r.calls.find(c => c[0] === 'put')[1];
    assert.strictEqual(it.stock, 7); assert.strictEqual(it.precio, 0.125);
    assert.strictEqual(r.movs, 1, 'una sola entrada (de 5 en la nube a 7)');
    // alta nueva con stock vacío: se permite (0), con valor no válido no
    r = await intenta({ 'f-stock': { value: '' } }, false);
    assert.strictEqual(r.calls.filter(c => c[0] === 'put')[0][1].stock, 0);
    assert.strictEqual(r.movs, 0);
    r = await intenta({ 'f-stock': { value: 'abc' } }, false);
    assert.strictEqual(r.calls.length, 0);
    // artículo borrado por otra persona mientras se editaba: no se recrea al guardar
    r = await intenta({}, true, "__stock=()=>({data:null,error:null})");
    assert.strictEqual(r.calls.length, 0); assert.ok(r.toasts.some(m => m.includes('eliminado')));
    assert.ok(r.closed.includes('modal-form'));
    // no se pudo leer el stock: no se guarda
    r = await intenta({}, true, "__stock=()=>{throw new Error('t')}");
    assert.strictEqual(r.calls.length, 0); assert.strictEqual(r.movs, 0);
    assert.ok(r.toasts.some(m => m.includes('No se pudo comprobar')));
  } finally {
    vm.runInContext('cloudPut=__cp0;', ctx); // (conNube ya restaura _invoiceAfterSave y el resto)
  }
});

test('compra: cantidad, precio y descuento se validan y solo se sube stock y precio', async () => {
  const dom = (o) => Object.assign({ 'pur-qty': { value: '3' }, 'pur-price': { value: '1.234' }, 'pur-discount': { value: '' }, 'pur-provider': { value: '' } }, o);
  const compra = async (campos) => {
    let r;
    await conNube({ dom: dom(campos) }, async () => {
      ev("items=[{id:'I1',name:'A',stock:99,precio:1,photo:'data:image/png;base64,AAAA'}];currentItem=items[0];cloudPriceAdd=async()=>true;addProvider=async()=>{};renderPriceHistory=()=>{};");
      await ev('applyPurchase()');
      r = { calls: JSON.parse(ev('JSON.stringify(__calls)')), movs: JSON.parse(ev('JSON.stringify(__movs)')), toasts: ev('__toasts.slice()') };
    });
    return r;
  };
  const g = ev('({pa:cloudPriceAdd,ap:addProvider,rp:renderPriceHistory})'); ctx.__gc = g;
  try {
    let r = await compra({});
    assert.deepStrictEqual(r.calls, [['update', { stock: 8, precio: 1.234 }, 'I1']], 'stock de la nube (5)+3, precio con 3 decimales respetado, sin foto');
    assert.strictEqual(r.movs.length, 1);
    for (const v of [{ 'pur-qty': { value: '' } }, { 'pur-qty': { value: '0' } }, { 'pur-qty': { value: '1.5' } }, { 'pur-price': { value: 'abc' } }, { 'pur-price': { value: '-1' } }, { 'pur-discount': { value: '150' } }, { 'pur-price': { value: '', validity: { badInput: true } } }]) {
      r = await compra(v);
      assert.strictEqual(r.calls.length, 0, JSON.stringify(v));
      assert.strictEqual(r.movs.length, 0, JSON.stringify(v));
    }
  } finally {
    vm.runInContext('cloudPriceAdd=__gc.pa;addProvider=__gc.ap;renderPriceHistory=__gc.rp', ctx);
  }
});

test('pushToCloud: sincroniza primero, pide confirmación con el número de artículos y respeta el bloqueo', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1'},{id:'I2'},{id:'I3'}];__sync=0;__push=0;__ordenOK=false;_stockBusy=false;_syncing=false;__syncReal=syncFromCloud;");
    ev("syncFromCloud=async()=>{__sync++;cloudOK=true;};_pushToCloud=async()=>{__push++;__busyDuring=_stockBusy;};");
    assert.ok(ev('pushToCloud.toString()').includes('ensureOnline'), 'sigue protegida sin conexión');
    await ev('pushToCloud()');
    assert.strictEqual(ev('__sync'), 1, 'sincroniza antes');
    assert.strictEqual(ev('__push'), 0, 'no sube nada hasta confirmar');
    assert.ok(ev('__opened').includes('modal-confirm'));
    assert.ok(ev("document.getElementById('confirm-msg').textContent").includes('3 artículos'));
    // confirmar: sincroniza OTRA vez antes de subir, sube con el bloqueo puesto y lo libera al acabar
    await ev("document.getElementById('confirm-ok').onclick()");
    assert.strictEqual(ev('__sync'), 2, 'segunda sincronización justo antes de subir');
    assert.strictEqual(ev('__push'), 1);
    assert.strictEqual(ev('__busyDuring'), true);
    assert.strictEqual(ev('_stockBusy'), false);
    assert.ok(!ev("document.getElementById('confirm-msg').textContent").includes('ya sincronizados ahora mismo'), 'el texto ya no afirma algo que puede ser viejo');
    // la ventana se abrió bien pero la sincronización del momento de confirmar falla: no se sube nada
    ev("__sync=0;__push=0;__toasts=[]");
    await ev('pushToCloud()');
    ev("syncFromCloud=async()=>{__sync++;cloudOK=false;}"); // cae la red mientras la ventana estaba abierta
    await ev("document.getElementById('confirm-ok').onclick()");
    assert.strictEqual(ev('__sync'), 2);
    assert.strictEqual(ev('__push'), 0, 'sin sincronización correcta no se sube');
    assert.strictEqual(ev('_stockBusy'), false);
    assert.ok(ev('__toasts.pop()').includes('No se pudo sincronizar'));
    // una sincronización que lanza una excepción deja cloudOK=false (la comprobación real)
    ev("syncFromCloud=__syncReal");
    ev("cloudOK=true;_syncFromCloud=async()=>{throw new Error('boom')}");
    await ev('syncFromCloud()');
    assert.strictEqual(ev('cloudOK'), false, 'un fallo al sincronizar no puede dejar cloudOK en true');
    ev("syncFromCloud=async()=>{__sync++;cloudOK=true;}");
    // si hay un cambio de stock o sincronización en curso no empieza
    ev("__sync=0;__opened=[];_stockBusy=true");
    await ev('pushToCloud()');
    assert.strictEqual(ev('__sync'), 0); assert.strictEqual(ev('__opened.length'), 0);
    ev("_stockBusy=false;_syncing=true");
    await ev('pushToCloud()');
    assert.strictEqual(ev('__sync'), 0); assert.strictEqual(ev('__opened.length'), 0);
    ev("_syncing=false");
    // si la sincronización previa falla, no se ofrece subir
    ev("syncFromCloud=async()=>{cloudOK=false;}");
    await ev('pushToCloud()');
    assert.strictEqual(ev('__opened.length'), 0);
    assert.ok(ev('__toasts.pop()').includes('No se pudo sincronizar'));
    // cancelar (abrir la ventana y no pulsar confirmar) no sube nada ni deja bloqueos ni toca la nube
    ev("syncFromCloud=async()=>{__sync++;cloudOK=true;};__sync=0;__push=0;__calls=[];__opened=[];__toasts=[]");
    await ev('pushToCloud()');
    assert.ok(ev('__opened').includes('modal-confirm'), 'la ventana se muestra');
    assert.strictEqual(ev('__sync'), 1, 'solo la sincronización previa');
    assert.strictEqual(ev('__push'), 0);
    assert.strictEqual(ev('__calls.length'), 0, 'ninguna escritura en la nube');
    assert.strictEqual(ev('_stockBusy'), false);
    assert.strictEqual(ev('__toasts.length'), 0);
  });
});

// ===== Configuración y copias de seguridad (bloque R2) =====
// Reutiliza el entorno de conNube y además: config local simulada (cfgGet/cfgPut), cola dirtyCfg real y restauración del estado global.
const ESTADO_R2 = 'shelves,categories,aisles,mapSize,providers,printedIds,modifiedIds,dirtyCfg,dirtyDel,adminUnlocked,_syncing,mapDraftShelves,mapDraftAisles,mapDraftSize,mapEditing,editShelfIdx,shelfDraft,pushPendingMovements,flushDirty,cloudGetMeta,dbReplaceAll,setCloudStatus,cloudCfgGetMany,cfgGet,cloudCfgPut,withTimeout,noPhotoIds';
// sb simulado: upsert/update registrados en __calls; __ups(tabla,fila) decide la respuesta del upsert
const SB_R2 = "sb={from:t=>({select:()=>({limit:async()=>({error:null})}),upsert:async(o)=>{__calls.push(['upsert',t,o]);return __ups(t,o);},update:f=>({eq:(c,id)=>({select:async()=>{__calls.push(['update',f,id,t]);return {data:[{id}],error:null};}})})})}";
async function conR2(opciones, fn) {
  const real = ev('cloudCfgPut');
  const nombres = ESTADO_R2.split(',').filter(n => n !== 'noPhotoIds');
  const orig = ev('({' + nombres.map(n => n + ':' + n).join(',') + '})');
  ctx.__real = real;
  ctx.__o2 = orig;
  try {
    await conNube(opciones, async () => {
      ev("cloudCfgPut=__real;__cfg={};cfgGet=async k=>(k in __cfg?__cfg[k]:null);cfgPut=async(k,v)=>{__cfg[k]=JSON.parse(JSON.stringify(v));};dirtyCfg=new Set();dirtyDel=new Set();adminUnlocked=true;_syncing=false;__ups=()=>({error:null});WH={key:'electrico',name:'Almacén Eléctrico',tblCfg:'config',tblItems:'items',tblMov:'movements',tblPrice:'price_history'};");
      ev(SB_R2);
      await fn();
    });
  } finally {
    ctx.__o2 = orig;
    ev(nombres.map(n => n + '=__o2.' + n).join(';'));
  }
}

test('config: cloudCfgPut devuelve true/false, usa tiempo límite, encola los fallos y no los traga', async () => {
  await conR2({}, async () => {
    assert.strictEqual(await ev("cloudCfgPut('shelves',[{id:'01'}])"), true);
    assert.deepStrictEqual(JSON.parse(ev('JSON.stringify(__calls)')), [['upsert', 'config', { key: 'shelves', value: [{ id: '01' }] }]]);
    assert.strictEqual(ev('dirtyCfg.size'), 0, 'si sube bien no queda pendiente');
    // error devuelto por la nube
    ev("__ups=()=>({error:{message:'red'}})");
    assert.strictEqual(await ev("cloudCfgPut('shelves',[])"), false);
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true);
    assert.deepStrictEqual(evj('__cfg.dirtyCfg'), ['shelves'], 'la cola se guarda en el móvil');
    // excepción
    ev("dirtyCfg=new Set();__ups=()=>{throw new Error('boom')}");
    assert.strictEqual(await ev("cloudCfgPut('aisles',[])"), false);
    assert.strictEqual(ev("dirtyCfg.has('aisles')"), true);
    // sin permisos (RLS): reintentar no sirve, no se queda encolada
    ev("dirtyCfg=new Set();__ups=()=>({error:{code:'42501',message:'rls'}})");
    assert.strictEqual(await ev("cloudCfgPut('adminPass','x')"), false);
    assert.strictEqual(ev('dirtyCfg.size'), 0);
    // tiempo agotado
    ev("__ups=()=>({error:null});withTimeout=()=>Promise.reject(new Error('Tiempo agotado: config'))");
    assert.strictEqual(await ev("cloudCfgPut('mapSize',{w:1,h:1})"), false);
    assert.strictEqual(ev("dirtyCfg.has('mapSize')"), true);
    ev('withTimeout=__o2.withTimeout');
    // sin nube: false y encolada
    ev('sb=null;dirtyCfg=new Set()');
    assert.strictEqual(await ev("cloudCfgPut('providers',['a'])"), false);
    assert.strictEqual(ev("dirtyCfg.has('providers')"), true);
  });
});

test('config: flushDirtyCfg sube el valor local, y la sincronización lo hace ANTES de leer la nube y no pisa claves sucias (E-L18)', async () => {
  await conR2({}, async () => {
    ev(`items=[];dirtyIds=new Set();__orden=[];
      shelves=[{id:'LOCAL',name:'L',baldas:2}];categories=['A'];printedIds=new Set(['I1']);
      __cfg.shelves=shelves;__cfg.printedIds=['I1'];dirtyCfg=new Set(['shelves','printedIds']);
      pushPendingMovements=async()=>{};flushDirty=async()=>{};cloudGetMeta=async()=>[];dbReplaceAll=async()=>{};setCloudStatus=()=>{};
      cloudCfgGetMany=async()=>{__orden.push('leer');return {shelves:[{id:'NUBE',name:'N',baldas:5}],printedIds:['Z'],categories:['B']};};
      __ups=(t,o)=>{__orden.push('subir:'+o.key);return {error:{message:'red'}};};`);
    await ev('_syncFromCloud(false)');
    // la subida de lo pendiente ocurre antes de leer la config de la nube; al fallar no se pisa lo local ni se siembra
    // (el primer fallo de red corta el bucle: no se intenta printedIds, que sigue pendiente)
    assert.deepStrictEqual(evj('__orden'), ['subir:shelves', 'leer']);
    assert.deepStrictEqual(evj('shelves.map(s=>s.id)'), ['LOCAL']);
    assert.deepStrictEqual(evj('[...printedIds]'), ['I1']);
    assert.deepStrictEqual(evj('categories'), ['B'], 'una clave que no está pendiente sí se actualiza desde la nube');
    assert.strictEqual(ev("dirtyCfg.has('shelves')&&dirtyCfg.has('printedIds')"), true);
    // si la subida funciona, la cola se vacía y se lee la nube
    ev("__orden=[];__ups=(t,o)=>{__orden.push('subir:'+o.key);return {error:null};};");
    await ev('_syncFromCloud(false)');
    assert.deepStrictEqual(evj('__orden'), ['subir:shelves', 'subir:printedIds', 'leer']);
    assert.strictEqual(ev('dirtyCfg.size'), 0);
    // sin valor local no hay nada que subir: se limpia de la cola
    ev("dirtyCfg=new Set(['providers']);delete __cfg.providers;__orden=[]");
    await ev('flushDirtyCfg()');
    assert.strictEqual(ev('dirtyCfg.size'), 0);
    assert.deepStrictEqual(evj('__orden'), []);
  });
});

test('colas: init carga TODAS las colas (loadDirty: artículos, columnas y config) antes de la primera sincronización', async () => {
  // La carga de dirtyCfg vive ahora en loadDirty(), que init() llama antes de syncFromCloud()
  const ini = src.slice(src.indexOf('async function init()'), src.indexOf('async function _syncFromCloud'));
  assert.ok(ini.indexOf('await loadDirty()') > 0, 'init carga las colas');
  assert.ok(ini.indexOf('await loadDirty()') < ini.indexOf('await syncFromCloud()'), 'antes de sincronizar');
  await conR2({}, async () => {
    ev("__cfg.dirtyIds=['A'];__cfg.dirtyDel=['B'];__cfg.dirtyCfg=['shelves','aisles'];__cfg.dirtyFields={C:{stock:4,loc:'01-1',zzz:1},'../x':{stock:1}};dirtyIds=new Set();dirtyDel=new Set();dirtyCfg=new Set();dirtyFields=Object.create(null);");
    await ev('loadDirty()');
    assert.deepStrictEqual(evj('[...dirtyIds]'), ['A']);
    assert.deepStrictEqual(evj('[...dirtyDel]'), ['B']);
    assert.deepStrictEqual(evj('[...dirtyCfg]'), ['shelves', 'aisles']);
    assert.deepStrictEqual(evj('dirtyFields'), { C: { stock: 4, loc: '01-1' } }, 'columnas y ids validados');
    // cola de configuración ilegible: no impide cargar las demás
    ev("cfgGet=async k=>{if(k==='dirtyCfg')throw new Error('idb');return k==='dirtyIds'?['Z']:null;};dirtyIds=new Set();dirtyCfg=new Set();");
    await ev('loadDirty()');
    assert.deepStrictEqual(evj('[...dirtyIds]'), ['Z']);
    assert.strictEqual(ev('dirtyCfg.size'), 0);
  });
});

test('estantería: guardar una estantería NO confirma el resto del borrador del mapa (E-L6)', async () => {
  await conR2({ dom: { 'es-name': { value: 'A2' }, 'es-code': { value: '01' }, 'es-baldas': { value: '4' } } }, async () => {
    // guardada: 01 y 02. Borrador: se ha borrado la 02 y se edita la 01
    ev("items=[];shelves=[{id:'01',name:'A',baldas:3},{id:'02',name:'B',baldas:3}];mapDraftShelves=[{id:'01',name:'A',baldas:3}];editShelfIdx=0;");
    await ev('saveEditShelf()');
    assert.deepStrictEqual(evj('shelves.map(s=>s.id)'), ['01', '02'], 'la 02 NO se borra por guardar la 01');
    assert.strictEqual(ev("shelves.find(s=>s.id==='01').name"), 'A2');
    assert.strictEqual(ev("shelves.find(s=>s.id==='01').baldas"), 4);
    const sube = JSON.parse(ev('JSON.stringify(__calls.filter(c=>c[0]==="upsert"))'));
    assert.deepStrictEqual(sube[0][2].value.map(s => s.id), ['01', '02']);
    assert.deepStrictEqual(evj('mapDraftShelves.map(s=>s.id)'), ['01'], 'el borrador sigue como estaba (se confirma con Guardar plano)');
    assert.ok(ev('__toasts.pop()').includes('Guardar plano'));
    // un código ya usado por una estantería guardada (aunque el borrador la haya quitado) se rechaza
    ev("document.getElementById('es-code').value='02';__calls=[];editShelfIdx=0;__toasts=[]");
    await ev('saveEditShelf()');
    assert.ok(ev('__toasts.pop()').includes('Ya existe'));
    assert.strictEqual(ev('__calls.length'), 0);
    assert.strictEqual(ev("shelves.find(s=>s.id==='01').name"), 'A2', 'no se modificó nada');
  });
});

test('estantería: si la nube falla se avisa, se encola la config y se conservan los repuestos reubicados', async () => {
  await conR2({ dom: { 'es-name': { value: 'Nueva' }, 'es-code': { value: '09' }, 'es-baldas': { value: '3' } } }, async () => {
    ev("items=[{id:'I1',name:'A',stock:3,loc:'01-1',pos:''}];shelves=[{id:'01',name:'E1',baldas:3}];mapDraftShelves=[{id:'01',name:'E1',baldas:3}];editShelfIdx=0;__ups=()=>({error:{message:'red'}})");
    await ev('saveEditShelf()');
    assert.strictEqual(ev("items.find(i=>i.id==='I1').loc"), '09-1');
    assert.deepStrictEqual(evj('shelves.map(s=>s.id)'), ['09'], 'la copia local ya lleva el código nuevo');
    assert.deepStrictEqual(evj('__cfg.shelves.map(s=>s.id)'), ['09']);
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true, 'queda en la cola de configuración');
    const aviso = ev('__toasts.pop()');
    assert.ok(aviso.includes('solo se guardó en este dispositivo'), aviso);
    assert.ok(!aviso.startsWith('✓'), 'no hay toast de éxito');
  });
});

test('plano, estanterías, distribución, proveedor y etiquetas: avisan cuando solo se guardó en el dispositivo', async () => {
  await conR2({}, async () => {
    // plano
    ev("mapDraftShelves=[{id:'01',name:'A',baldas:3}];mapDraftAisles=[];mapDraftSize={w:20,h:10};mapEditing=true;__ups=()=>({error:{message:'red'}})");
    await ev('saveMapLayout()');
    assert.ok(ev('__toasts.pop()').includes('solo en este dispositivo'));
    assert.strictEqual(ev("['shelves','aisles','mapSize'].every(k=>dirtyCfg.has(k))"), true);
    ev("dirtyCfg=new Set();__ups=()=>({error:null});mapDraftShelves=[{id:'01',name:'A',baldas:3}];mapDraftAisles=[];mapDraftSize={w:20,h:10};mapEditing=true");
    await ev('saveMapLayout()');
    assert.strictEqual(ev('__toasts.pop()'), '✓ Plano guardado');
    assert.strictEqual(ev('dirtyCfg.size'), 0);
    // gestor de estanterías
    ev("shelfDraft=[{id:'01',name:'A',baldas:3}];__ups=()=>({error:{message:'red'}})");
    await ev('saveShelves()');
    assert.ok(ev('__toasts.pop()').includes('solo en este dispositivo'));
    ev("__ups=()=>({error:null});shelfDraft=[{id:'01',name:'A',baldas:3}]");
    await ev('saveShelves()');
    assert.strictEqual(ev('__toasts.pop()'), '✓ Estanterías actualizadas');
    // proveedor
    ev("providers=[];__toasts=[];__ups=()=>({error:{message:'red'}})");
    // R3: addProvider ya no avisa por su cuenta (el aviso se taparía): devuelve el resultado y quien llama añade sufijoHist
    assert.strictEqual(await ev("addProvider('ACME')"), false);
    assert.deepStrictEqual(evj('providers'), ['ACME']);
    assert.strictEqual(ev("dirtyCfg.has('providers')"), true, 'queda en la cola para subirse al sincronizar');
    ev("__ups=()=>({error:null});__toasts=[]");
    assert.strictEqual(await ev("addProvider('Otro')"), true);
    assert.strictEqual(await ev("addProvider('Otro')"), true, 'ya existía: nada que guardar');
    assert.strictEqual(ev('__toasts.length'), 0, 'con éxito no se avisa');
    // etiquetas impresas
    ev("printedIds=new Set(['I1']);modifiedIds=new Set();__ups=()=>({error:{message:'red'}})");
    assert.strictEqual(await ev('savePrintedIds()'), false);
    assert.strictEqual(ev("dirtyCfg.has('printedIds')&&dirtyCfg.has('modifiedIds')"), true);
    ev('__ups=()=>({error:null})');
    assert.strictEqual(await ev('savePrintedIds()'), true);
  });
});

test('pushToCloud: tiempo límite, errores registrados y NO se marca "Conectado" si fallan artículos', async () => {
  const stAntes = ctx.setTimeout;
  ctx.setTimeout = (f, ms) => setTimeout(f, ms < 5000 ? 0 : ms); // sin esperas reales entre reintentos
  try {
    await conR2({}, async () => {
      ev("items=[{id:'I1',name:'A',stock:1},{id:'I2',name:'B',stock:2}];dirtyIds=new Set(['I1']);__status=[];setCloudStatus=ok=>{__status.push(ok)};categories=['C'];shelves=[{id:'01',name:'A',baldas:1}];aisles=[];printedIds=new Set();__ups=(t,o)=>({error:(t==='items'&&o.id==='I2')?{message:'red'}:null});");
      await ev('_pushToCloud()');
      assert.deepStrictEqual(evj('__status'), [false], 'no se declara conectado');
      const aviso = ev('__toasts.pop()');
      assert.ok(aviso.includes('Subidos 1/2') && aviso.includes('Fallaron 1') && aviso.includes('pendientes'), aviso);
      assert.strictEqual(ev("dirtyIds.has('I2')"), true, 'el que falló queda en la cola');
      assert.strictEqual(ev("dirtyIds.has('I1')"), false, 'el que subió sale de la cola');
      // un tiempo agotado cuenta como fallo y no cuelga
      ev("dirtyIds=new Set();__status=[];__ups=()=>({error:null});withTimeout=()=>Promise.reject(new Error('Tiempo agotado: subir'))");
      await ev('_pushToCloud()');
      assert.deepStrictEqual(evj('__status'), [false]);
      ev('withTimeout=__o2.withTimeout');
      // todo bien
      ev("dirtyIds=new Set();__status=[];__ups=()=>({error:null});");
      await ev('_pushToCloud()');
      assert.deepStrictEqual(evj('__status'), [true]);
      assert.ok(ev('__toasts.pop()').startsWith('✓ Subidos los 2'));
      // artículos bien pero la configuración no sube: se dice
      ev("__status=[];__ups=(t)=>({error:t==='config'?{message:'red'}:null});");
      await ev('_pushToCloud()');
      const av2 = ev('__toasts.pop()');
      assert.ok(av2.startsWith('⚠') && av2.includes('configuración'), av2);
    });
  } finally {
    ctx.setTimeout = stAntes;
  }
});

// ---- Copias de seguridad ----
const MEC_R2 = "{key:'mecanico',name:'Almacén Mecánico',tblItems:'items_mec',tblCfg:'config_mec',tblMov:'movements_mec',tblPrice:'price_history_mec'}";
const ELE_R2 = "{key:'electrico',name:'Almacén Eléctrico',tblItems:'items',tblCfg:'config',tblMov:'movements',tblPrice:'price_history'}";
// sb de solo lectura para exportar: tablas {nombre:[filas]}, cfgs {tabla:{clave:valor}}; opts fuerza errores o recuentos distintos
function sbExport(tablas, cfgs, opts = {}) {
  const rangos = [];
  const sb = {
    rangos,
    from: tbl => ({
      select: (cols, o) => {
        if (o && o.head) return Promise.resolve(opts.countError ? { count: null, error: { message: 'rls' } } : { count: (tablas[tbl] || []).length + (opts.extraCount || 0), error: null });
        const q = {
          order: () => q,
          range: async (a, b) => { rangos.push([tbl, a, b]); if (opts.pageError) return { data: null, error: { message: 'timeout' } }; return { data: (tablas[tbl] || []).slice(a, b + 1), error: null }; },
          limit: async () => { rangos.push([tbl, 'sonda']); return opts.probeError ? { data: null, error: { message: 'rls' } } : opts.probeRows ? { data: [{ key: 'categories' }], error: null } : { error: null }; },
          in: async () => ({ data: [], error: null }),
          eq: (c, k) => ({ maybeSingle: async () => { if (opts.cfgError) return { data: null, error: { message: 'x' } }; const c2 = (cfgs || {})[tbl] || {}; return { data: k in c2 ? { value: c2[k] } : null, error: null }; } }),
        };
        return q;
      },
    }),
  };
  return sb;
}
const FOTO_R2 = 'data:image/png;base64,AAAA';

test('copias: collectWarehouse lee el otro almacén con páginas pequeñas, cuenta las filas y trae config e historial', async () => {
  await conR2({}, async () => {
    const filas = Array.from({ length: 120 }, (_, i) => ({ id: 'M' + i, name: 'n' + i, categories: ['c'], photo: FOTO_R2 }));
    const s = sbExport({ items_mec: filas, movements_mec: [{ ts: 1, itemId: 'M1' }, { ts: 2, itemId: 'M2' }], price_history_mec: [{ item_id: 'M1', ts: 3 }] },
      { config_mec: { categories: ['Cat'], shelves: [{ id: '01' }], mapSize: { w: 10, h: 10 } } });
    ctx.__sbx = s; ev('sb=__sbx');
    const r = JSON.parse(JSON.stringify(await ev('collectWarehouse(' + MEC_R2 + ')')));
    assert.strictEqual(r.items.length, 120);
    assert.deepStrictEqual(r.items[0].cats, ['c']);
    assert.ok(!('categories' in r.items[0]));
    assert.deepStrictEqual(r.categories, ['Cat']);
    assert.deepStrictEqual(r.mapSize, { w: 10, h: 10 });
    assert.deepStrictEqual(r.aisles, [], 'una clave sin fila queda vacía en la copia');
    assert.strictEqual(r.movements.length, 2);
    assert.strictEqual(r.price_history.length, 1);
    const pagItems = s.rangos.filter(x => x[0] === 'items_mec');
    assert.ok(pagItems.length >= 3 && pagItems.every(x => x[2] - x[1] + 1 <= 50), 'páginas de 50 filas como máximo (llevan fotos)');
  });
});

test('copias: cualquier fallo de lectura del otro almacén lanza error (nunca un almacén vacío)', async () => {
  await conR2({}, async () => {
    const filas = [{ id: 'M1', name: 'n', categories: [], photo: FOTO_R2 }];
    const tablas = { items_mec: filas, movements_mec: [], price_history_mec: [] };
    const casos = [
      ['página', sbExport(tablas, {}, { pageError: true })],
      ['recuento', sbExport(tablas, {}, { countError: true })],
      ['incompleta', sbExport(tablas, {}, { extraCount: 5 })],
      ['config', sbExport(tablas, {}, { cfgError: true })],
      ['vacío', sbExport({ items_mec: [], movements_mec: [], price_history_mec: [] }, {})],
      ['sin nube', null],
    ];
    for (const [nombre, s] of casos) {
      ctx.__sbx = s; ev('sb=__sbx');
      let err = null;
      try { await ev('collectWarehouse(' + MEC_R2 + ')'); } catch (e) { err = e; }
      assert.ok(err, 'debe fallar: ' + nombre);
    }
  });
});

test('copias: exportBoth aborta con un mensaje claro si no puede leer un almacén y no descarga nada', async () => {
  const restaurar = descargaSimulada();
  try {
    await conR2({}, async () => {
      vm.runInContext('globalThis.WAREHOUSE_CONFIG=' + ELE_R2 + ';globalThis.WAREHOUSE_OTHER_CONFIG=' + MEC_R2, ctx);
      ev("items=[{id:'I1',name:'A',stock:1,photo:'" + FOTO_R2 + "'}];dbGetAll=async()=>items;categories=['X'];shelves=[{id:'01'}];aisles=[];providers=['P'];printedIds=new Set(['I1']);modifiedIds=new Set()");
      const tablas = { items: [], movements: [{ ts: 5, itemId: 'I1' }], price_history: [], items_mec: [{ id: 'M1', name: 'm', categories: [], photo: FOTO_R2 }], movements_mec: [], price_history_mec: [] };
      ctx.__sbx = sbExport(tablas, {}, { pageError: true }); ev('sb=__sbx');
      await ev('exportBoth()');
      assert.strictEqual(ctx.__blobs.length, 0, 'sin copia');
      const aviso = ev('__toasts.pop()');
      assert.ok(aviso.startsWith('⚠ No se pudo leer') && aviso.includes('No se ha generado la copia'), aviso);
      // todo bien: versión 4 con los dos almacenes, config e historial
      ctx.__sbx = sbExport(tablas, { config_mec: { shelves: [{ id: '05' }] } }); ev('sb=__sbx');
      await ev('exportBoth()');
      assert.strictEqual(ctx.__blobs.length, 1);
      const j = JSON.parse(ctx.__blobs[0]);
      assert.strictEqual(j.version, 4);
      assert.deepStrictEqual(Object.keys(j.warehouses).sort(), ['electrico', 'mecanico']);
      assert.strictEqual(j.warehouses.electrico.items.length, 1);
      assert.deepStrictEqual(j.warehouses.electrico.providers, ['P']);
      assert.deepStrictEqual(j.warehouses.electrico.printedIds, ['I1']);
      assert.strictEqual(j.warehouses.electrico.movements.length, 1);
      assert.strictEqual(j.warehouses.mecanico.items.length, 1);
      assert.deepStrictEqual(j.warehouses.mecanico.shelves, [{ id: '05' }]);
      assert.ok(ev('__toasts.pop()').includes('movimientos'));
    });
  } finally {
    restaurar();
    vm.runInContext('globalThis.WAREHOUSE_CONFIG=undefined;globalThis.WAREHOUSE_OTHER_CONFIG=undefined', ctx);
  }
});

test('copias: exportData etiqueta el almacén (v4), incluye historial y config y avisa si no puede', async () => {
  const restaurar = descargaSimulada();
  try {
    await conR2({}, async () => {
      ev("items=[{id:'I1',name:'A',stock:1,photo:'" + FOTO_R2 + "'}];dbGetAll=async()=>items;categories=['X'];shelves=[{id:'01'}];aisles=[{label:'P'}];mapSize={w:12,h:9};providers=['P'];printedIds=new Set(['I1']);modifiedIds=new Set(['I1'])");
      const tablas = { movements: [{ ts: 5, itemId: 'I1' }, { ts: 6, itemId: 'I1' }], price_history: [{ item_id: 'I1', ts: 1 }] };
      ctx.__sbx = sbExport(tablas, {}); ev('sb=__sbx');
      await ev('exportData()');
      let j = JSON.parse(ctx.__blobs.pop());
      assert.strictEqual(j.version, 4);
      assert.strictEqual(j.warehouse, 'electrico');
      assert.deepStrictEqual(j.mapSize, { w: 12, h: 9 });
      assert.deepStrictEqual(j.aisles, [{ label: 'P' }]);
      assert.deepStrictEqual(j.providers, ['P']);
      assert.deepStrictEqual(j.modifiedIds, ['I1']);
      assert.strictEqual(j.movements.length, 2);
      assert.strictEqual(j.price_history.length, 1);
      assert.ok(ev('__toasts.pop()').includes('2 movimientos'));
      // el historial no se puede leer: no se genera una copia sin él
      ctx.__sbx = sbExport(tablas, {}, { pageError: true }); ev('sb=__sbx');
      await ev('exportData()');
      assert.strictEqual(ctx.__blobs.length, 0);
      assert.ok(ev('__toasts.pop()').includes('No se pudo leer el historial'));
      // sin conexión: se genera lo local y se dice que falta el historial
      ev('sb=null');
      await ev('exportData()');
      j = JSON.parse(ctx.__blobs.pop());
      assert.ok(!('movements' in j));
      assert.ok(ev('__toasts.pop()').includes('Sin conexión: no incluye movimientos'));
    });
  } finally {
    restaurar();
  }
});

test('fotos de copias y Excel: el aviso dice la causa real (sin conexión / fallo de descarga) y no cuenta artículos sin foto en la nube', async () => {
  await conR2({}, async () => {
    ev("items=[{id:'A',photo:null},{id:'B',photo:'" + FOTO_R2 + "'},{id:'C',photo:null},{id:'D',photo:null}];noPhotoIds.clear();noPhotoIds.add('C');dirtyIds=new Set(['D'])");
    assert.strictEqual(ev('fotosSinDescargar()'), 1, 'solo A: C no tiene foto en la nube y D es un alta local pendiente');
    const conSb = ev('msgFotosFaltan(1)');
    assert.ok(conSb.includes('No se pudieron descargar 1 foto'), conSb);
    ev('sb=null');
    const sinSb = ev('msgFotosFaltan(3)');
    assert.ok(sinSb.includes('Sin conexión') && !sinSb.includes('No se pudieron descargar'), sinSb);
    // exportData sin conexión y con un artículo sin foto local: rechaza con la causa correcta
    const blobAntes = ctx.Blob;
    ctx.__blobs = []; ctx.Blob = function (p) { ctx.__blobs.push(p[0]); };
    try {
      await ev('exportData()');
    } finally { ctx.Blob = blobAntes; }
    assert.strictEqual(ctx.__blobs.length, 0);
    assert.ok(ev('__toasts.pop()').includes('Sin conexión a la nube'));
  });
  ev('noPhotoIds.clear()');
});

// Descargas simuladas: Blob junta los trozos, URL registra create/revoke y el temporizador de 60 s se captura (no se espera de verdad)
// Devuelve la función que restaura los globales.
function descargaSimulada() {
  const blobAntes = ctx.Blob, urlAntes = ctx.URL, stAntes = ctx.setTimeout;
  ctx.__blobs = []; ctx.__partes = []; ctx.__revocadas = []; ctx.__t60 = [];
  ctx.Blob = function (partes) { ctx.__partes.push(partes); ctx.__blobs.push(partes.join('')); };
  ctx.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: u => { ctx.__revocadas.push(u); } };
  ctx.setTimeout = (f, ms, ...a) => { if (ms === 60000) { ctx.__t60.push(f); return 0; } return stAntes(f, ms, ...a); };
  return () => { ctx.Blob = blobAntes; ctx.URL = urlAntes; ctx.setTimeout = stAntes; };
}

// Fichero de copia simulado: importData lee el texto con FileReader
async function importarTexto(texto) {
  const frAntes = ctx.FileReader;
  ctx.FileReader = function () { this.readAsText = f => { this.onload({ target: { result: f.text } }); }; };
  ctx.__ev = { target: { files: [{ text: texto }] } };
  try {
    await ev('importData(__ev)');
    await new Promise(r => setTimeout(r, 30));
  } finally { ctx.FileReader = frAntes; }
}

test('importar: rechaza copias de otro almacén, de versión futura o que no son JSON; la confirmación es honesta', async () => {
  await conR2({}, async () => {
    vm.runInContext('globalThis.WAREHOUSE_CONFIG=' + ELE_R2 + ';globalThis.WAREHOUSE_OTHER_CONFIG=' + MEC_R2, ctx);
    try {
      await importarTexto(JSON.stringify({ version: 4, warehouse: 'mecanico', items: [{ id: 'M1' }] }));
      assert.ok(ev('__toasts.pop()').includes('no de este almacén'));
      assert.ok(!ev('__opened').includes('modal-confirm'));
      await importarTexto(JSON.stringify({ version: 9, items: [] }));
      assert.ok(ev('__toasts.pop()').includes('versión más nueva'));
      await importarTexto('esto no es json');
      assert.ok(ev('__toasts.pop()').includes('no es una copia de seguridad'));
      await importarTexto(JSON.stringify({ version: 4, warehouse: 'electrico' }));
      assert.ok(ev('__toasts.pop()').includes('lista de artículos'));
      assert.ok(!ev('__opened').includes('modal-confirm'));
      // copia antigua (v2, sin etiqueta) con un id inválido: se puede importar y se avisa de ambas cosas
      await importarTexto(JSON.stringify({ version: 2, items: [{ id: 'I1' }, { id: '<mal>' }], categories: ['A'] }));
      assert.ok(ev('__opened').includes('modal-confirm'));
      const msg = ev("document.getElementById('confirm-msg').textContent");
      assert.ok(msg.includes('fusiona con la nube') && msg.includes('SE CONSERVAN'), msg);
      assert.ok(!/Reemplazar/i.test(msg), 'ya no dice "Reemplazará"');
      assert.ok(msg.includes('1 artículo(s) del archivo tienen un código no válido'), msg);
      assert.ok(msg.includes('sin etiqueta de almacén'), msg);
      assert.ok(msg.includes('No se restauran los movimientos'), msg);
      assert.strictEqual(ev('__calls.length'), 0, 'hasta confirmar no se toca nada');
    } finally {
      vm.runInContext('globalThis.WAREHOUSE_CONFIG=undefined;globalThis.WAREHOUSE_OTHER_CONFIG=undefined', ctx);
    }
  });
});

test('importar: sube con cloudPut, NO vacía el móvil antes (sin dbReplaceAll) y solo escribe la config que trae la copia', async () => {
  await conR2({}, async () => {
    ev("items=[{id:'OLD',name:'viejo',stock:1}];dbGetAll=async()=>items;__replaced=0;dbReplaceAll=async()=>{__replaced++};categories=['Antes'];shelves=[{id:'99',name:'X',baldas:1}]");
    const copia = { version: 4, warehouse: 'electrico', items: [{ id: 'I1', name: 'A', stock: 2 }, { id: 'I2', name: 'B', stock: 3 }], categories: [], shelves: [{ id: '01', name: 'E1', baldas: 3 }], aisles: [], printedIds: ['I1'] };
    vm.runInContext('globalThis.WAREHOUSE_CONFIG=' + ELE_R2, ctx);
    try {
      await importarTexto(JSON.stringify(copia));
      await ev("document.getElementById('confirm-ok').onclick()");
      assert.strictEqual(ev('__replaced'), 0, 'no se reemplaza la base local');
      assert.deepStrictEqual(evj('__dbPuts'), ['I1', 'I2']);
      const llamadas = JSON.parse(ev('JSON.stringify(__calls)'));
      assert.deepStrictEqual(llamadas.filter(c => c[1] === 'items').map(c => c[2].id), ['I1', 'I2']);
      assert.deepStrictEqual(llamadas.filter(c => c[1] === 'config').map(c => c[2].key).sort(), ['printedIds', 'shelves'], 'ni categorías ni plano vacíos sobre la nube');
      assert.deepStrictEqual(evj('categories'), ['Antes'], 'las categorías no se tocan');
      assert.deepStrictEqual(evj('shelves.map(s=>s.id)'), ['01']);
      assert.strictEqual(ev('_stockBusy'), false);
      assert.ok(ev('__toasts.pop()').startsWith('✓ Importados 2 artículos (fusionados con la nube)'));
    } finally {
      vm.runInContext('globalThis.WAREHOUSE_CONFIG=undefined', ctx);
    }
  });
});

test('importar: cuenta los fallos, avisa "X de N", no toca la config, deja lo pendiente en la cola y se para tras 3 fallos seguidos', async () => {
  await conR2({}, async () => {
    vm.runInContext('globalThis.WAREHOUSE_CONFIG=' + ELE_R2, ctx);
    try {
      ev("items=[];dbGetAll=async()=>items;__replaced=0;dbReplaceAll=async()=>{__replaced++};dirtyIds=new Set()");
      const items5 = [1, 2, 3, 4, 5].map(n => ({ id: 'I' + n, name: 'n' + n, stock: n }));
      // falla solo el segundo
      ev("__ups=(t,o)=>({error:(t==='items'&&o.id==='I2')?{message:'red'}:null})");
      await importarTexto(JSON.stringify({ version: 4, warehouse: 'electrico', items: items5.slice(0, 3), shelves: [{ id: '01', name: 'E', baldas: 1 }] }));
      await ev("document.getElementById('confirm-ok').onclick()");
      let aviso = ev('__toasts.pop()');
      assert.ok(aviso.includes('1 de 3 artículos fallaron'), aviso);
      assert.strictEqual(ev("__calls.filter(c=>c[1]==='config').length"), 0, 'config intacta');
      assert.strictEqual(ev("dirtyIds.has('I2')"), true);
      assert.strictEqual(ev('__replaced'), 0);
      assert.deepStrictEqual(evj('__dbPuts'), ['I1', 'I2', 'I3'], 'los tres quedan en el móvil (el fallido, pendiente)');
      // la nube cae del todo: tras 3 intentos se para y el resto queda pendiente
      ev("__calls=[];__dbPuts=[];dirtyIds=new Set();__ups=()=>({error:{message:'red'}})");
      await importarTexto(JSON.stringify({ version: 4, warehouse: 'electrico', items: items5 }));
      await ev("document.getElementById('confirm-ok').onclick()");
      aviso = ev('__toasts.pop()');
      assert.ok(aviso.includes('5 de 5 artículos fallaron'), aviso);
      assert.strictEqual(ev("__calls.filter(c=>c[1]==='items').length"), 3, 'no sigue insistiendo');
      assert.deepStrictEqual(evj('[...dirtyIds].sort()'), ['I1', 'I2', 'I3', 'I4', 'I5']);
      assert.deepStrictEqual(evj('__dbPuts'), ['I1', 'I2', 'I3', 'I4', 'I5']);
      assert.strictEqual(ev('_stockBusy'), false);
      // solo un administrador
      ev("__calls=[];adminUnlocked=false;__toasts=[]");
      await ev("document.getElementById('confirm-ok').onclick()");
      assert.ok(ev('__toasts.pop()').includes('Solo un administrador'));
      assert.strictEqual(ev('__calls.length'), 0);
    } finally {
      vm.runInContext('globalThis.WAREHOUSE_CONFIG=undefined', ctx);
    }
  });
});

test('importar los dos almacenes: el otro se escribe en su tabla, la config vacía no se escribe y un fallo para y avisa', async () => {
  await conR2({}, async () => {
    vm.runInContext('globalThis.WAREHOUSE_CONFIG=' + ELE_R2 + ';globalThis.WAREHOUSE_OTHER_CONFIG=' + MEC_R2, ctx);
    try {
      ev("items=[];dbGetAll=async()=>items;__replaced=0;dbReplaceAll=async()=>{__replaced++};dirtyIds=new Set()");
      const copia = { version: 3, warehouses: {
        electrico: { items: [{ id: 'I1', name: 'A', stock: 1 }], categories: ['X'], shelves: [] },
        mecanico: { items: [{ id: 'M1', name: 'B', stock: 2 }], categories: [], shelves: [{ id: '05', name: 'E5', baldas: 2 }] },
        raro: { items: [{ id: 'Z' }] },
      } };
      await importarTexto(JSON.stringify(copia));
      assert.ok(ev("document.getElementById('confirm-msg').textContent").includes('1 almacén(es) del archivo no existen'));
      await ev("document.getElementById('confirm-ok').onclick()");
      const ll = JSON.parse(ev('JSON.stringify(__calls)'));
      assert.deepStrictEqual(ll.map(c => c[1] + ':' + (c[2].id || c[2].key)), ['items:I1', 'config:categories', 'items_mec:M1', 'config_mec:shelves']);
      assert.strictEqual(ev('__replaced'), 0);
      assert.deepStrictEqual(evj('__dbPuts'), ['I1'], 'solo el almacén actual se guarda en el móvil');
      assert.ok(ev('__toasts.pop()').startsWith('✓ Importados 2 artículos'));
      // el otro almacén falla: se avisa y no se sigue con su configuración
      ev("__calls=[];__ups=(t)=>({error:t==='items_mec'?{message:'red'}:null})");
      await ev("document.getElementById('confirm-ok').onclick()");
      assert.ok(ev('__toasts.pop()').includes('1 de 2 artículos fallaron'));
      assert.strictEqual(ev("__calls.filter(c=>c[1]==='config_mec').length"), 0);
    } finally {
      vm.runInContext('globalThis.WAREHOUSE_CONFIG=undefined;globalThis.WAREHOUSE_OTHER_CONFIG=undefined', ctx);
    }
  });
});

test('cola parcial: tras un fallo, flushDirty sube SOLO esas columnas (sin upsert) y limpia la cola', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:3,loc:'01-1',photo:'data:image/png;base64,AAAA'},{id:'I2',name:'B',stock:2,loc:'01-1'}]");
    ev("__upd=()=>({data:null,error:{message:'red'}})");
    await ev("cloudUpdateFields('I1',{stock:7})");
    await ev("cloudUpdateFields('I2',{loc:'05-2',pos:'g'})");
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { stock: 7 }, I2: { loc: '05-2', pos: 'g' } });
    assert.strictEqual(ev('dirtyIds.size'), 0, 'no están como artículo entero');
    // vuelve la red
    ev("__calls=[];__upd=()=>({data:[{id:'x'}],error:null})");
    await ev('flushDirty()');
    assert.deepStrictEqual(evj('__calls'), [['update', { stock: 7 }, 'I1'], ['update', { loc: '05-2', pos: 'g' }, 'I2']]);
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0, 'nunca se sube la fila entera');
    assert.deepStrictEqual(evj('dirtyFields'), {});
    assert.deepStrictEqual(evj('__cfg.dirtyFields'), {}, 'la cola guardada en el móvil también queda vacía');
    // sigue sin red: la entrada se conserva para el siguiente intento
    ev("__upd=()=>({data:null,error:{message:'red'}});__calls=[]");
    await ev("cloudUpdateFields('I1',{stock:9})");
    await ev('flushDirty()');
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { stock: 9 } });
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0);
    // un artículo en la cola ENTERA (alta/edición) sigue subiéndose con upsert y esto limpia también lo parcial
    ev("dirtyFields.I1={stock:9};markDirty('I1');__calls=[];__upd=()=>({data:[{id:'x'}],error:null})");
    await ev('flushDirty()');
    assert.deepStrictEqual(evj('__calls.map(c=>c[0])'), ['upsert'], 'solo el volcado entero, sin update duplicado');
    assert.deepStrictEqual(evj('dirtyFields'), {});
    assert.strictEqual(ev('dirtyIds.size'), 0);
  });
});

test('cola parcial: si otra persona borró el artículo, flushDirty NO lo recrea y lo quita del móvil', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:3,loc:'01-1'},{id:'I2',name:'B',stock:2,loc:'01-1'}]");
    ev("__upd=()=>({data:null,error:{message:'red'}})");
    await ev("cloudUpdateFields('I1',{stock:7})");
    ev("__calls=[];__upd=()=>({data:[],error:null})"); // la fila ya no existe y la sesión puede leer
    await ev('flushDirty()');
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0, 'no se recrea');
    assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I2']);
    assert.deepStrictEqual(evj('__dbDel'), ['I1']);
    assert.deepStrictEqual(evj('dirtyFields'), {});
    assert.strictEqual(ev("dirtyIds.has('I1')"), false);
    // con la sesión caída (0 filas sin error y la prueba de lectura vacía) NO se da por borrado: la entrada se conserva
    ev("__upd=()=>({data:null,error:{message:'red'}})");
    await ev("cloudUpdateFields('I2',{stock:5})");
    ev("__calls=[];__dbDel=[];__upd=()=>({data:[],error:null});__probe=()=>({data:[],error:null})");
    await ev('flushDirty()');
    assert.deepStrictEqual(evj('items.map(i=>i.id)'), ['I2'], 'sigue en el móvil');
    assert.deepStrictEqual(evj('__dbDel'), []);
    assert.deepStrictEqual(evj('dirtyFields'), { I2: { stock: 5 } });
    assert.strictEqual(ev("__calls.filter(c=>c[0]==='upsert').length"), 0);
    // una entrada de un artículo que ya no está en el móvil se descarta sin tocar la nube
    ev("dirtyFields.GONE={stock:1};__calls=[]");
    await ev('flushDirty()');
    assert.strictEqual(ev("'GONE' in dirtyFields"), false);
    assert.ok(!ev('__calls').some(c => c[2] === 'GONE'));
  });
});

test('cola parcial: se guarda en el móvil, sobrevive a un reinicio (loadDirty) y se valida al cargar', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:3,loc:'01-1'}]");
    ev("__upd=()=>({data:null,error:{message:'red'}})");
    await ev("cloudUpdateFields('I1',{stock:7,loc:'02-1',pos:''})");
    assert.deepStrictEqual(evj('__cfg.dirtyFields'), { I1: { stock: 7, loc: '02-1', pos: '' } }, 'guardada con cfgPut');
    // "reinicio": se pierde la memoria y se vuelve a leer lo guardado
    ev("dirtyFields=Object.create(null);dirtyIds=new Set();dirtyDel=new Set();cfgGet=async k=>(k in __cfg?__cfg[k]:null);");
    await ev('loadDirty()');
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { stock: 7, loc: '02-1', pos: '' } });
    assert.strictEqual(ev('hayPendientes()'), true, 'también cuenta para el aviso de cerrar sesión');
    assert.strictEqual(ev("stockPendiente('I1')"), true);
    // datos corruptos o manipulados: solo columnas conocidas, con su tipo y con ids seguros
    ev("__cfg.dirtyFields={'mal id!':{stock:1},I1:{stock:'x',loc:'a',name:'zz',precio:null},I2:{stock:5,pos:7},I3:'no',I4:{}}");
    await ev('loadDirty()');
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { loc: 'a', precio: null }, I2: { stock: 5 } });
    ev("__cfg.dirtyFields=null");
    await ev('loadDirty()');
    assert.deepStrictEqual(evj('dirtyFields'), {});
    assert.strictEqual(ev('hayPendientes()'), false);
    ev("dirtyDel.add('X')");
    assert.strictEqual(ev('hayPendientes()'), true);
    // logout avisa de los cambios parciales sin subir
    ev("dirtyDel=new Set();dirtyFields.I1={stock:1};");
    assert.strictEqual(ev('hayPendientes()'), true);
  });
});

test('cola parcial: la sincronización no pisa con el valor de la nube lo que está pendiente de subir', async () => {
  await conNube({}, async () => {
    ev("items=[{id:'I1',name:'A',stock:7,loc:'02-1',pos:'',photo:'data:image/png;base64,AAAA'},{id:'I2',name:'B',stock:2,loc:'01-1'}]");
    ev("pushPendingMovements=async()=>{};dbReplaceAll=async()=>{};cloudCfgGetMany=async()=>undefined;setCloudStatus=()=>{};" +
      "cloudGetMeta=async()=>[{id:'I1',name:'A',stock:50,loc:'09-9',pos:'x',categories:[]},{id:'I2',name:'B',stock:30,loc:'03-3',pos:'',categories:[]}]");
    // I1 tiene stock y ubicación pendientes (el flush falla: sin red para escribir); I2 no tiene nada pendiente
    ev("__upd=()=>({data:null,error:{message:'red'}});dirtyFields.I1={stock:7,loc:'02-1',pos:''}");
    await ev('_syncFromCloud(false)');
    const i1 = evj("items.find(i=>i.id==='I1')"), i2 = evj("items.find(i=>i.id==='I2')");
    assert.strictEqual(i1.stock, 7, 'manda el stock local pendiente');
    assert.strictEqual(i1.loc, '02-1');
    assert.strictEqual(i1.pos, '');
    assert.strictEqual(i1.photo, 'data:image/png;base64,AAAA', 'conserva la foto local');
    assert.strictEqual(i2.stock, 30, 'sin pendiente: se toma lo de la nube');
    assert.strictEqual(i2.loc, '03-3');
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { stock: 7, loc: '02-1', pos: '' } }, 'sigue pendiente');
    // con el stock pendiente no se lee el de la nube para cambiarlo a ciegas
    assert.strictEqual(await ev("refreshStock(items[0])"), 'skip');
  });
});

test('estantería: el aviso distingue lo no subido a la nube de lo no guardado en este dispositivo', async () => {
  await conNube({ dom: { 'es-name': { value: 'Nueva' }, 'es-code': { value: '02' }, 'es-baldas': { value: '3' } } }, async () => {
    const preparar = () => {
      ev("items=[{id:'I1',name:'A',stock:3,loc:'01-1'},{id:'I2',name:'B',stock:2,loc:'01-2'},{id:'I3',name:'C',stock:1,loc:'01-3'}];__toasts=[]");
      // saveEditShelf ahora confirma la estantería editada en `shelves`: hay que reponerla en cada repetición
      ev("shelves=[{id:'01',name:'E1',baldas:3}];mapDraftShelves=[{id:'01',name:'E1',baldas:3}];editShelfIdx=0;");
    };
    ev("dbPut=async it=>{if(it.id==='I3')throw new Error('cuota');}");
    ev("__upd=()=>(__calls[__calls.length-1][2]==='I1'?{data:null,error:{message:'red'}}:{data:[{id:'x'}],error:null})");
    preparar();
    await ev('saveEditShelf()');
    let aviso = ev('__toasts.pop()');
    assert.ok(aviso.includes('1 repuesto(s) no se pudieron guardar en la nube'), aviso);
    assert.ok(aviso.includes('1 repuesto(s) no se pudieron guardar en este dispositivo'), aviso);
    // solo fallo local: no habla de la nube
    ev("__upd=()=>({data:[{id:'x'}],error:null});__calls=[]");
    preparar();
    await ev('saveEditShelf()');
    aviso = ev('__toasts.pop()');
    assert.ok(aviso.includes('no se pudieron guardar en este dispositivo') && !aviso.includes('en la nube'), aviso);
    // todo bien
    ev("dbPut=async()=>{};__calls=[]");
    preparar();
    await ev('saveEditShelf()');
    assert.ok(ev('__toasts.pop()').startsWith('✓ Estantería actualizada (3 repuesto(s)'));
  });
});

// ===== Interacciones entre las dos colas (artículos: dirtyFields/dirtyIds/dirtyDel; configuración: dirtyCfg) =====
test('colas: hayPendientes cuenta cada cola por separado, incluida la configuración', async () => {
  await conR2({}, async () => {
    const limpiar = "dirtyIds=new Set();dirtyDel=new Set();dirtyFields=Object.create(null);dirtyCfg=new Set();";
    ev(limpiar);
    assert.strictEqual(ev('hayPendientes()'), false);
    for (const marca of ["dirtyIds.add('A')", "dirtyDel.add('A')", "dirtyFields.A={stock:1}", "dirtyCfg.add('shelves')"]) {
      ev(limpiar + marca);
      assert.strictEqual(ev('hayPendientes()'), true, marca);
    }
    ev(limpiar);
  });
});

test('colas: una sincronización con columnas pendientes Y configuración pendiente conserva ambas cosas locales, y sube en orden', async () => {
  await conR2({}, async () => {
    ev(`items=[{id:'I1',name:'A',stock:7,min:0,loc:'01-1',pos:'h'}];__orden=[];
      dirtyIds=new Set();dirtyDel=new Set();dirtyFields={I1:{stock:7,loc:'01-1'}};dirtyCfg=new Set(['shelves']);
      shelves=[{id:'LOCAL',name:'L',baldas:2}];categories=['A'];__cfg.shelves=shelves;
      pushPendingMovements=async()=>{};dbReplaceAll=async()=>{};setCloudStatus=()=>{};
      cloudGetMeta=async()=>{__orden.push('meta');return [{id:'I1',name:'A',stock:99,min:0,loc:'09-9',pos:'g',categories:[]}];};
      cloudCfgGetMany=async()=>{__orden.push('leer');return {shelves:[{id:'NUBE',name:'N',baldas:5}],categories:['B']};};
      sb={from:t=>({select:()=>({limit:async()=>({data:[{key:'k'}],error:null})}),
        upsert:async o=>{__orden.push('cfg:'+o.key);return {error:{message:'red'}};},
        update:f=>({eq:(c,id)=>({select:async()=>{__orden.push('upd:'+id);return {data:null,error:{message:'red'}};}})})})};`);
    await ev('_syncFromCloud(false)');
    // orden: columnas pendientes -> configuración pendiente -> lectura de la nube
    assert.deepStrictEqual(evj('__orden'), ['upd:I1', 'cfg:shelves', 'meta', 'leer']);
    // sin red: manda lo local en las dos colas y nada se pierde
    assert.strictEqual(ev("items[0].stock"), 7);
    assert.strictEqual(ev("items[0].loc"), '01-1');
    assert.deepStrictEqual(evj('shelves.map(s=>s.id)'), ['LOCAL']);
    assert.deepStrictEqual(evj('categories'), ['B'], 'lo que no está pendiente sí se actualiza desde la nube');
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { stock: 7, loc: '01-1' } });
    assert.deepStrictEqual(evj('[...dirtyCfg]'), ['shelves']);
    assert.strictEqual(ev('hayPendientes()'), true);
    // vuelve la red: se suben las dos colas, se vacían y entonces manda la nube
    ev(`__orden=[];sb={from:t=>({select:()=>({limit:async()=>({data:[{key:'k'}],error:null})}),
        upsert:async o=>{__orden.push('cfg:'+o.key);return {error:null};},
        update:f=>({eq:(c,id)=>({select:async()=>{__orden.push('upd:'+id+':'+JSON.stringify(f));return {data:[{id}],error:null};}})})})};`);
    await ev('_syncFromCloud(false)');
    assert.deepStrictEqual(evj('__orden'), ['upd:I1:{"stock":7,"loc":"01-1"}', 'cfg:shelves', 'meta', 'leer']);
    assert.deepStrictEqual(evj('dirtyFields'), {});
    assert.strictEqual(ev('dirtyCfg.size'), 0);
    assert.strictEqual(ev('hayPendientes()'), false);
  });
});

test('colas: cerrar sesión avisa también cuando solo queda configuración sin subir', async () => {
  await conR2({}, async () => {
    const guardar = ev('movGetAll');
    ctx.__mg = guardar;
    try {
      ev("movGetAll=async()=>[];dirtyIds=new Set();dirtyDel=new Set();dirtyFields=Object.create(null);dirtyCfg=new Set();");
      await ev('askLogout()');
      assert.ok(!ev("document.getElementById('confirm-msg').textContent").includes('sin sincronizar'), 'sin nada pendiente no hay aviso');
      ev("dirtyCfg.add('shelves')");
      await ev('askLogout()');
      assert.ok(ev("document.getElementById('confirm-msg').textContent").includes('Hay cambios sin sincronizar'));
      ev("dirtyCfg=new Set();dirtyFields.I1={stock:2}");
      await ev('askLogout()');
      assert.ok(ev("document.getElementById('confirm-msg').textContent").includes('Hay cambios sin sincronizar'));
    } finally {
      ev('movGetAll=__mg');
    }
  });
});

test('colas: cambiar el código de una estantería sin red deja encoladas la ubicación (parcial) y la config, y lo cuenta el aviso', async () => {
  await conR2({ dom: { 'es-name': { value: 'E2' }, 'es-code': { value: '02' }, 'es-baldas': { value: '3' } } }, async () => {
    ev(`items=[{id:'I1',name:'A',stock:3,loc:'01-1',pos:'h'}];__toasts=[];
      shelves=[{id:'01',name:'E1',baldas:3}];mapDraftShelves=[{id:'01',name:'E1',baldas:3}];editShelfIdx=0;
      sb={from:t=>({select:()=>({limit:async()=>({data:[{key:'k'}],error:null})}),
        upsert:async o=>({error:{message:'red'}}),
        update:f=>({eq:(c,id)=>({select:async()=>({data:null,error:{message:'red'}})})})})};`);
    await ev('saveEditShelf()');
    const aviso = ev('__toasts.pop()');
    assert.ok(aviso.includes('1 repuesto(s) no se pudieron guardar en la nube'), aviso);
    assert.ok(aviso.includes('La estantería solo se guardó en este dispositivo'), aviso);
    assert.deepStrictEqual(evj('dirtyFields'), { I1: { loc: '02-1', pos: 'h' } }, 'solo la ubicación, nunca el artículo entero');
    assert.strictEqual(ev('dirtyIds.size'), 0);
    assert.deepStrictEqual(evj('[...dirtyCfg]'), ['shelves']);
    assert.deepStrictEqual(evj('shelves.map(s=>s.id)'), ['02']);
    assert.strictEqual(ev('hayPendientes()'), true);
  });
});

test('tests: conNube restaura las variables globales que tocan los tests', async () => {
  const antes = ev('[shelves,adjustValue,categories,addHereTarget,[...addHereSel],mapDraftShelves,editShelfIdx,dirtyFields,dirtyDel]');
  await conNube({}, async () => {
    ev("shelves=[{id:'ZZ'}];adjustValue=99;categories=['X'];addHereTarget={sid:'1'};addHereSel.add('Q');mapDraftShelves=[{id:'ZZ'}];editShelfIdx=3;dirtyFields.I9={stock:1};");
  });
  assert.strictEqual(ev('shelves'), antes[0]);
  assert.strictEqual(ev('adjustValue'), antes[1]);
  assert.strictEqual(ev('categories'), antes[2]);
  assert.strictEqual(ev('addHereTarget'), antes[3]);
  assert.strictEqual(ev('addHereSel.size'), antes[4].length);
  assert.strictEqual(ev('mapDraftShelves'), antes[5]);
  assert.strictEqual(ev('editShelfIdx'), antes[6]);
  assert.strictEqual(ev('dirtyFields'), antes[7]);
  assert.strictEqual(ev('dirtyDel'), antes[8]);
});

// ===== Historial, informes y borrados (bloque R3) =====
// Sustituye funciones/variables globales durante la prueba y las restaura siempre (sobre conNube/conR2, que restauran el resto)
let _conStubsN = 0;
async function conStubs(nombres, fn) {
  const clave = '__stubs' + (++_conStubsN);
  ctx[clave] = ev('({' + nombres.map(n => n + ':' + n).join(',') + '})');
  try { await fn(); } finally { ev(nombres.map(n => n + '=' + clave + '.' + n).join(';')); delete ctx[clave]; }
}
const norm = x => JSON.parse(JSON.stringify(x));
// Nube simulada de movimientos: constructor de consultas encadenable y "esperable" que registra las operaciones en __mqs
// y responde con __movRes(st) (st={t:tabla, ops:[[nombre,...args],...]})
const QB = String.raw`
  __mqs=[];__movRes=()=>({data:[],error:null});
  __qb=t=>{const st={t,ops:[]};const b={};
    ['select','gte','lte','order','range','eq','limit','delete','insert','maybeSingle'].forEach(k=>{b[k]=(...a)=>{st.ops.push([k,...a]);return b;};});
    b.then=(res,rej)=>{__mqs.push(st);return Promise.resolve().then(()=>__movRes(st)).then(res,rej);};
    return b;};
  sb={from:t=>__qb(t)};`;
const nombresOps = q => q.ops.map(o => o[0]);

test('historial: getMergedMovements estricto devuelve null si falla la nube, sin duplicados y solo la ventana pedida (SF-A5)', async () => {
  await conR2({}, async () => {
    await conStubs(['movGetAll'], async () => {
      ev(QB);
      ev("__movRes=()=>({data:[{ts:30,itemId:'B'},{ts:20,itemId:'A'},{ts:20,itemId:'A'},{ts:10,itemId:'C'}],error:null})");
      ev("movGetAll=async()=>[{ts:20,itemId:'A',synced:false},{ts:25,itemId:'L',synced:false},{ts:5,itemId:'OLD',synced:false},{ts:26,itemId:'S',synced:true}]");
      const r = norm(await ev('getMergedMovements(true,{desde:8,hasta:100})'));
      assert.deepStrictEqual(r.map(m => m.ts + '|' + m.itemId), ['30|B', '20|A', '10|C', '25|L'],
        'la fila repetida de la nube se deduplica, el pendiente fuera de la ventana (5) y el ya subido (26) no entran');
      // consulta acotada y paginación ordenada por el par único (ts,itemId)
      const q = norm(ev('__mqs[0]'));
      assert.deepStrictEqual(q.ops.filter(o => o[0] === 'gte' || o[0] === 'lte'), [['gte', 'ts', 8], ['lte', 'ts', 100]]);
      assert.deepStrictEqual(q.ops.filter(o => o[0] === 'order'), [['order', 'ts', { ascending: false }], ['order', 'itemId', { ascending: false }]]);
      // lectura estricta que falla: null (no un informe parcial)
      ev("__movRes=()=>({data:null,error:{message:'red'}})");
      assert.strictEqual(await ev('getMergedMovements(true)'), null);
      ev("__movRes=()=>{throw new Error('boom')}");
      assert.strictEqual(await ev('getMergedMovements(true)'), null);
      // con estado: devuelve lo local y marca que la nube no se pudo leer
      ev("__e={nube:true}");
      const loc = norm(await ev('getMergedMovements(false,undefined,__e)'));
      assert.deepStrictEqual(loc.map(m => m.itemId), ['A', 'L', 'OLD']);
      assert.strictEqual(ev('__e.nube'), false);
      // sin nube (sb nulo) también cuenta como fallo en modo estricto
      ev('sb=null');
      assert.strictEqual(await ev('getMergedMovements(true)'), null);
    });
  });
});

test('historial: cloudMovGetAll acota por fechas, pagina con orden estable y distingue fallo (strict) de vacío', async () => {
  await conR2({}, async () => {
    ev(QB);
    // sin rango: ni gte ni lte; dos páginas (1000 + 5)
    ev("__movRes=st=>{const r=st.ops.find(o=>o[0]==='range');return {data:Array.from({length:r[1]===0?1000:5},(_,i)=>({ts:i,itemId:'X'+r[1]+'_'+i})),error:null};}");
    const todo = await ev('cloudMovGetAll(true)');
    assert.strictEqual(todo.length, 1005);
    assert.strictEqual(ev('__mqs.length'), 2);
    assert.deepStrictEqual(norm(ev('__mqs.map(q=>q.ops.find(o=>o[0]==="range").slice(1))')), [[0, 999], [1000, 1999]]);
    assert.ok(ev('__mqs.every(q=>!q.ops.some(o=>o[0]==="gte"||o[0]==="lte"))'), 'sin rango no se filtra');
    // fallo: strict -> null, no strict -> []
    ev("__movRes=()=>({data:null,error:{message:'red'}})");
    assert.strictEqual(await ev('cloudMovGetAll(true,{desde:1})'), null);
    assert.deepStrictEqual(norm(await ev('cloudMovGetAll(false,{desde:1})')), []);
    // tiempo agotado por página
    ev("withTimeout=()=>Promise.reject(new Error('Tiempo agotado: página 1'))");
    assert.strictEqual(await ev('cloudMovGetAll(true)'), null);
    ev('withTimeout=__o2.withTimeout');
    ev('sb=null');
    assert.strictEqual(await ev('cloudMovGetAll(true)'), null);
    assert.deepStrictEqual(norm(await ev('cloudMovGetAll(false)')), []);
  });
});

test('historial: los pendientes se comparan solo desde el movimiento pendiente más antiguo (no se baja toda la tabla)', async () => {
  await conR2({}, async () => {
    await conStubs(['movGetAll', 'cloudMovGetAll', 'cloudMovPut', 'movUpdate'], async () => {
      ev("__args=[];__sub=[];movGetAll=async()=>[{ts:100,itemId:'A',synced:false},{ts:50,itemId:'B',synced:false},{ts:70,itemId:'C',synced:true}];cloudMovGetAll=async(s,r)=>{__args.push([s,r]);return [{ts:100,itemId:'A'}];};cloudMovPut=async m=>{__sub.push(m.itemId);return true;};movUpdate=async()=>{};");
      await ev('_pushPendingMovements()');
      assert.deepStrictEqual(norm(ev('__args')), [[true, { desde: 50 }]]);
      assert.deepStrictEqual(norm(ev('__sub')), ['B'], 'A ya estaba en la nube: no se duplica');
    });
  });
});

test('borrado de línea: cloudMovDelete devuelve true / false (denegado) / null (error de red o tiempo agotado)', async () => {
  await conR2({}, async () => {
    ev(QB);
    const borrar = () => ev('cloudMovDelete(5,"A")');
    const esDelete = "st.ops.some(o=>o[0]==='delete')";
    ev("__movRes=st=>(" + esDelete + "?{data:[{ts:5}],error:null}:{data:[],error:null})");
    assert.strictEqual(await borrar(), true, 'borrada de verdad');
    // L1: el borrado filtra por ts Y por itemId (sin el filtro de itemId borraría las líneas de TODOS los artículos de ese instante)
    const qDel = norm(ev("__mqs.find(q=>q.ops.some(o=>o[0]==='delete'))"));
    assert.strictEqual(qDel.t, 'movements');
    assert.deepStrictEqual(qDel.ops.filter(o => o[0] === 'eq'), [['eq', 'ts', 5], ['eq', 'itemId', 'A']], 'ambos filtros presentes');
    assert.ok(qDel.ops.findIndex(o => o[0] === 'delete') < qDel.ops.findIndex(o => o[0] === 'eq'), 'los filtros se aplican sobre el delete');
    ev("__movRes=()=>({data:[],error:null})");
    assert.strictEqual(await borrar(), null, '0 filas sin poder confirmar el acceso (sesión caducada: la RLS también oculta la fila): no se da por borrada (M1)');
    ev("__movRes=st=>(st.t==='config'?{data:[{key:'k'}],error:null}:{data:[],error:null})");
    assert.strictEqual(await borrar(), true, '0 filas, la comprobación no la encuentra y la sesión sí puede leer: ya no existía');
    ev("__movRes=st=>(" + esDelete + "?{data:[],error:null}:{data:[{ts:5}],error:null})");
    assert.strictEqual(await borrar(), false, '0 filas pero sigue ahí: denegado por RLS');
    ev("__movRes=()=>({data:null,error:{code:'42501',message:'rls'}})");
    assert.strictEqual(await borrar(), false, 'error de permisos');
    ev("__movRes=()=>({data:null,error:{message:'red'}})");
    assert.strictEqual(await borrar(), null, 'error de la nube');
    ev("__movRes=()=>{throw new Error('Failed to fetch')}");
    assert.strictEqual(await borrar(), null, 'excepción de red (antes devolvía true y la línea reaparecía)');
    ev("__movRes=st=>(" + esDelete + "?{data:[],error:null}:{data:null,error:{message:'red'}})");
    assert.strictEqual(await borrar(), null, 'falla la comprobación posterior: no se sabe');
    ev("__movRes=()=>({data:[{ts:5}],error:null});withTimeout=()=>Promise.reject(new Error('Tiempo agotado: borrar movimiento'))");
    assert.strictEqual(await borrar(), null, 'tiempo agotado');
    ev('withTimeout=__o2.withTimeout;sb=null');
    assert.strictEqual(await borrar(), null, 'sin conexión no se puede borrar en la nube');
  });
});

test('borrado de línea (M1): con la sesión caducada confirmDeleteMov no borra la copia local ni dice "Línea borrada"', async () => {
  await conR2({}, async () => {
    await conStubs(['movDeleteLocal', 'renderHomeMovements', 'renderCostes', 'pendingMovDel'], async () => {
      ev(QB);
      // la RLS solo concede 'authenticated': DELETE, comprobación y prueba de lectura devuelven 0 filas SIN error
      ev("__movRes=()=>({data:[],error:null});__locales=[];movDeleteLocal=async(ts,id)=>{__locales.push([ts,id]);};renderHomeMovements=async()=>{};renderCostes=async()=>{};pendingMovDel={ts:5,itemId:'A'};__toasts=[]");
      await ev('confirmDeleteMov()');
      assert.deepStrictEqual(norm(ev('__locales')), [], 'la fila local se conserva');
      assert.ok(!ev('__toasts').some(m => m.includes('Línea borrada')), ev('__toasts.join("|")'));
      assert.ok(ev('__toasts').some(m => m.includes('No se pudo borrar')), ev('__toasts.join("|")'));
      // con la sesión válida (la prueba de lectura devuelve filas) y la línea ya inexistente sí se da por borrada
      ev("__movRes=st=>(st.t==='config'?{data:[{key:'k'}],error:null}:{data:[],error:null});pendingMovDel={ts:5,itemId:'A'};__toasts=[]");
      await ev('confirmDeleteMov()');
      assert.deepStrictEqual(norm(ev('__locales')), [[5, 'A']]);
      assert.strictEqual(ev('__toasts.pop()'), 'Línea borrada');
    });
  });
});

test('borrado de artículo (M1): cloudDelete con 0 filas solo cuenta como "ya no existía" si la sesión puede leer; si no, falla y queda en cola', async () => {
  await conR2({}, async () => {
    ev(QB);
    ev("dirtyDel=new Set();cloudOK=true");
    const esDelete = "st.ops.some(o=>o[0]==='delete')";
    // borrado normal
    ev("__movRes=st=>(" + esDelete + "?{data:[{id:'I1'}],error:null}:{data:null,error:null})");
    assert.strictEqual(await ev("cloudDelete('I1')"), true);
    const qDel = norm(ev("__mqs.find(q=>q.ops.some(o=>o[0]==='delete'))"));
    assert.strictEqual(qDel.t, 'items');
    assert.deepStrictEqual(qDel.ops.filter(o => o[0] === 'eq'), [['eq', 'id', 'I1']]);
    // 0 filas, la comprobación no la encuentra y la sesión puede leer: ya no existía
    ev("__movRes=st=>(st.t==='config'?{data:[{key:'k'}],error:null}:(" + esDelete + "?{data:[],error:null}:{data:null,error:null}))");
    assert.strictEqual(await ev("cloudDelete('I1')"), true);
    assert.strictEqual(ev("dirtyDel.has('I1')"), false);
    // 0 filas pero la sesión no puede leer (caducada: la RLS oculta todo): NO es "ya no existía", queda pendiente
    ev("__movRes=st=>(st.t==='config'?{data:[],error:null}:(" + esDelete + "?{data:[],error:null}:{data:null,error:null}))");
    assert.strictEqual(await ev("cloudDelete('I1')"), false);
    assert.strictEqual(ev("dirtyDel.has('I1')"), true, 'se encola como cualquier otro fallo de red');
    assert.strictEqual(ev('cloudOK'), false);
    // 0 filas pero la fila sigue ahí: denegado (no se encola)
    ev("dirtyDel=new Set();__movRes=st=>(" + esDelete + "?{data:[],error:null}:{data:{id:'I1'},error:null});__toasts=[]");
    assert.strictEqual(await ev("cloudDelete('I1')"), false);
    assert.strictEqual(ev("dirtyDel.has('I1')"), false);
    assert.ok(ev('__toasts').some(m => m.includes('Sin permisos')));
  });
});

test('borrado de línea: confirmDeleteMov no toca la fila local si falla la red y avisa de cada caso', async () => {
  await conR2({}, async () => {
    await conStubs(['cloudMovDelete', 'movDeleteLocal', 'renderHomeMovements', 'renderCostes', 'pendingMovDel'], async () => {
      ev(QB);
      ev("__locales=[];__rend=0;movDeleteLocal=async(ts,id)=>{__locales.push([ts,id]);};renderHomeMovements=async()=>{__rend++;};renderCostes=async()=>{__rend++;};");
      // error de red
      ev("cloudMovDelete=async()=>null;pendingMovDel={ts:5,itemId:'A'};__toasts=[]");
      await ev('confirmDeleteMov()');
      assert.deepStrictEqual(norm(ev('__locales')), [], 'la fila local se conserva');
      assert.strictEqual(ev('__rend'), 0);
      assert.ok(ev('__toasts').some(m => m.includes('No se pudo borrar (error de red)')), ev('__toasts.join("|")'));
      assert.ok(!ev('__toasts').some(m => m.includes('Línea borrada')));
      // denegado: mensaje de permisos de siempre
      ev("cloudMovDelete=async()=>false;pendingMovDel={ts:5,itemId:'A'};__toasts=[]");
      await ev('confirmDeleteMov()');
      assert.deepStrictEqual(norm(ev('__locales')), []);
      assert.ok(ev('__toasts').some(m => m.includes('Sin permisos para borrar esta línea')));
      // borrado real
      ev("cloudMovDelete=async()=>true;pendingMovDel={ts:5,itemId:'A'};__toasts=[]");
      await ev('confirmDeleteMov()');
      assert.deepStrictEqual(norm(ev('__locales')), [[5, 'A']]);
      assert.strictEqual(ev('__toasts.pop()'), 'Línea borrada');
      assert.strictEqual(ev('__rend'), 1);
    });
  });
});

test('movimientos: cloudMovPut reintenta sin provider SOLO si falta la columna (PGRST204 / 42703) y deja la marca del aviso (SF-A16, M2)', async () => {
  await conR2({}, async () => {
    await conStubs(['_provAviso', '_provFalta'], async () => {
      ev(QB);
      ev("_provAviso=false;_provFalta=false;__movRes=st=>__ins(st.ops.find(o=>o[0]==='insert')[1]);__ins=()=>({error:null})");
      const mov = '({itemId:"A",ts:1,provider:"ACME",synced:false,id:3})';
      const inserts = () => ev('__mqs.filter(q=>q.ops.some(o=>o[0]==="insert")).length');
      // columna inexistente: segundo intento sin provider
      for (const code of ['PGRST204', '42703']) {
        ev("__mqs=[];__ins=m=>('provider' in m?{error:{code:'" + code + "'}}:{error:null})");
        assert.strictEqual(await ev('cloudMovPut(' + mov + ')'), true, code);
        assert.strictEqual(inserts(), 2, code);
        assert.ok(!('provider' in norm(ev('__mqs[1].ops.find(o=>o[0]==="insert")[1]'))), 'el reintento va sin provider');
      }
      assert.strictEqual(ev('__toasts.filter(m=>m.includes("provider")).length'), 0, 'cloudMovPut ya no avisa por su cuenta: el toast de éxito del llamante lo taparía (M2)');
      assert.strictEqual(ev('_provFalta'), true, 'queda la marca para que el aviso salga en el toast final');
      // cualquier otro error: NO se reintenta sin provider y el movimiento sigue pendiente
      for (const err of ["{message:'red'}", "{code:'42501',message:'rls'}", "{code:'PGRST301'}", "{code:'08006'}"]) {
        ev("__mqs=[];__ins=()=>({error:" + err + "})");
        assert.strictEqual(await ev('cloudMovPut(' + mov + ')'), false, err);
        assert.strictEqual(inserts(), 1, err + ': un solo intento, con provider');
      }
      ev("__mqs=[];__movRes=()=>{throw new Error('Failed to fetch')}");
      assert.strictEqual(await ev('cloudMovPut(' + mov + ')'), false);
      assert.strictEqual(inserts(), 1);
      // ya existía (índice único)
      ev("__mqs=[];__movRes=st=>({error:{code:'23505'}})");
      assert.strictEqual(await ev('cloudMovPut(' + mov + ')'), true);
      assert.strictEqual(inserts(), 1);
      // columna inexistente pero el segundo intento también falla (red): pendiente
      ev("__mqs=[];__movRes=st=>(st.ops.find(o=>o[0]==='insert')[1].provider!==undefined?{error:{code:'PGRST204'}}:{error:{message:'red'}})");
      assert.strictEqual(await ev('cloudMovPut(' + mov + ')'), false);
      assert.strictEqual(inserts(), 2);
      // sin proveedor no hay reintento
      ev("__mqs=[];__movRes=()=>({error:{code:'PGRST204'}})");
      assert.strictEqual(await ev('cloudMovPut({itemId:"A",ts:2,synced:false})'), false);
      assert.strictEqual(inserts(), 1);
    });
  });
});

test('movimientos (M2): el aviso de la columna "provider" ausente sale UNA vez en el toast FINAL de la compra y en el aviso de Inicio', async () => {
  const dom = { 'pur-qty': { value: '3' }, 'pur-price': { value: '2' }, 'pur-discount': { value: '' }, 'pur-provider': { value: 'ACME' }, 'home-pending-warn': { style: { display: 'none' }, textContent: '' } };
  await conR2({ dom }, async () => {
    await conStubs(['_provAviso', '_provFalta', 'cloudPriceAdd', 'addProvider', 'renderPriceHistory', 'renderInvoiceModal', 'adminUnlocked', 'refreshStock', 'cloudUpdateFields', 'movGetAll'], async () => {
      ev(QB);
      ev("_provAviso=false;_provFalta=false;items=[{id:'I1',name:'A',stock:5,precio:1}];currentItem=items[0];renderPriceHistory=()=>{};renderInvoiceModal=()=>{};cloudPriceAdd=async()=>true;addProvider=async()=>true;refreshStock=async()=>'skip';cloudUpdateFields=async()=>true;movGetAll=async()=>[];");
      // la nube no tiene la columna provider; el resto de consultas (prueba de conexión) responden bien
      ev("__movRes=st=>{const i=st.ops.find(o=>o[0]==='insert');return i?(('provider' in i[1])?{error:{code:'PGRST204'}}:{error:null}):{data:[{key:'k'}],error:null};}");
      // cloudMovPut corre dentro de registrarMovimiento, dentro de _commitStock (igual que en la app real)
      ev("registrarMovimiento=async(it,a,n,tipo,c,prov)=>{await cloudMovPut({itemId:it.id,ts:1,tipo,provider:prov,synced:false});};");
      await ev('applyPurchase()');
      assert.ok(ev('__mqs.some(q=>q.ops.some(o=>o[0]==="insert"&&!("provider" in o[1])))'), 'el movimiento se subió sin provider');
      let t = ev('__toasts.pop()');
      assert.ok(t.startsWith('✓ Entrada de compra: +3'), t);
      assert.ok(t.includes('⚠ proveedor no guardado (falta la columna provider en la nube)'), 'el aviso va en el TOAST FINAL, no en uno anterior que se tapa: ' + t);
      assert.ok(!ev('__toasts').some(m => m.includes('provider')), 'no hay otro toast con el aviso que se pierda');
      // solo una vez por sesión
      ev("items=[{id:'I1',name:'A',stock:5,precio:1}];currentItem=items[0];__mqs=[];");
      await ev('applyPurchase()');
      t = ev('__toasts.pop()');
      assert.ok(t.startsWith('✓ Entrada de compra: +3') && !t.includes('provider'), t);
      // el aviso de movimientos de Inicio lo recuerda mientras dure la sesión (aunque no haya pendientes)
      await ev('checkPendingMovs()');
      assert.strictEqual(ctx.__dom['home-pending-warn'].style.display, '');
      assert.ok(ctx.__dom['home-pending-warn'].textContent.includes('"provider"'), ctx.__dom['home-pending-warn'].textContent);
      ev('_provFalta=false');
      await ev('checkPendingMovs()');
      assert.strictEqual(ctx.__dom['home-pending-warn'].style.display, 'none');
    });
  });
});

test('Inicio: una sola lectura del historial (ventana de 6 meses), aviso visible si falla y sin pisar con un render lento (SF-A5, E-L10)', async () => {
  const dom = { 'home-hist-warn': { style: { display: 'none' } } };
  await conNube({ dom }, async () => {
    await conStubs(['checkPendingMovs', 'getMergedMovements', 'renderHomeChart', 'homeMovsCache', '_homeSeq'], async () => {
      const ahora = Date.now();
      ev("__gm=[];__chart=[];items=[];checkPendingMovs=async()=>{};renderHomeChart=m=>{__chart.push(m.length);};");
      ev("getMergedMovements=async(s,r,e)=>{__gm.push([s,r]);return [{ts:" + (ahora - 1000) + ",diferencia:2,nombre:'RECIENTE',itemId:'A'},{ts:" + (ahora - 200 * 86400000) + ",diferencia:-1,nombre:'ANTIGUO',itemId:'B'}];}");
      await ev('renderHomeMovements()');
      assert.strictEqual(ev('__gm.length'), 1, 'antes se pedía dos veces');
      const d = new Date();
      assert.deepStrictEqual(norm(ev('__gm[0]')), [false, { desde: new Date(d.getFullYear(), d.getMonth() - 5, 1).getTime() }]);
      assert.deepStrictEqual(norm(ev('__chart')), [2], 'el gráfico recibe la misma lectura (6 meses)');
      const html = ctx.__dom['home-entradas'].innerHTML + ctx.__dom['home-salidas'].innerHTML;
      assert.ok(html.includes('RECIENTE') && !html.includes('ANTIGUO'), 'la lista solo muestra 90 días');
      assert.strictEqual(ctx.__dom['home-hist-warn'].style.display, 'none');
      // la nube no se pudo leer: aviso visible y se siguen mostrando los datos locales
      ev("getMergedMovements=async(s,r,e)=>{e.nube=false;return [{ts:" + (ahora - 5) + ",diferencia:3,nombre:'LOCAL',itemId:'A'}];}");
      await ev('renderHomeMovements(true)');
      assert.strictEqual(ctx.__dom['home-hist-warn'].style.display, '');
      assert.ok(ctx.__dom['home-entradas'].innerHTML.includes('LOCAL'));
      // vuelve a leerse bien: el aviso desaparece
      ev("getMergedMovements=async()=>[]");
      await ev('renderHomeMovements(true)');
      assert.strictEqual(ctx.__dom['home-hist-warn'].style.display, 'none');
      // un render lento no pisa a uno más reciente
      ev("__n=0;getMergedMovements=async()=>{const n=++__n;if(n===1)await new Promise(r=>{__rel=r;});return [{ts:" + (ahora - 9) + ",diferencia:1,nombre:n===1?'VIEJO':'NUEVO',itemId:'A'}];}");
      const lento = ev('renderHomeMovements(true)');
      await new Promise(r => setTimeout(r, 10));
      await ev('renderHomeMovements(true)');
      ev('__rel()');
      await lento;
      const fin = ctx.__dom['home-entradas'].innerHTML;
      assert.ok(fin.includes('NUEVO') && !fin.includes('VIEJO'), 'manda el render más reciente');
      assert.ok(ev('homeMovsCache').every(m => m.nombre === 'NUEVO'));
    });
  });
});

test('gráfico: el mes de cada movimiento se calcula en hora local (turno de noche del día 1) (E-L9)', async () => {
  const tzAntes = process.env.TZ;
  process.env.TZ = 'Europe/Madrid'; // zona con adelanto sobre UTC: con toISOString() la 00:30 del día 1 caía en el mes anterior
  try {
    await conNube({}, async () => {
      const d = new Date();
      const primero = new Date(d.getFullYear(), d.getMonth(), 1, 0, 30).getTime();
      const ultimoMesAnt = new Date(d.getFullYear(), d.getMonth(), 0, 23, 30).getTime();
      ev('renderHomeChart([{ts:' + primero + ',diferencia:5},{ts:' + ultimoMesAnt + ',diferencia:-3}])');
      const grupos = ctx.__dom['home-chart-bars'].innerHTML.split('chart-bar-group').slice(1);
      assert.strictEqual(grupos.length, 6);
      assert.ok(grupos[5].includes('Entradas: 5') && grupos[5].includes('Salidas: 0'), 'mes actual: ' + grupos[5]);
      assert.ok(grupos[4].includes('Salidas: 3') && grupos[4].includes('Entradas: 0'), 'mes anterior: ' + grupos[4]);
      assert.strictEqual(ev('claveMes(new Date(2026,0,1,0,30))'), '2026-01');
    });
  } finally {
    if (tzAntes === undefined) delete process.env.TZ; else process.env.TZ = tzAntes;
  }
});

test('Costes: lectura estricta de solo el mes elegido; si falla no hay cifras parciales y lastCostesCalc guarda sus movimientos', async () => {
  const dom = { 'cos-month': { value: '3' }, 'cos-year': { value: '2026' }, 'cos-hist-warn': { style: { display: 'none' } } };
  await conNube({ dom }, async () => {
    await conStubs(['getMergedMovements', 'lastCostesCalc', 'pushPendingMovements', 'homeMovsCache'], async () => {
      ev("__gm=[];items=[];pushPendingMovements=async()=>{};homeMovsCache=[{nombre:'DE-INICIO'}];getMergedMovements=async(s,r)=>{__gm.push([s,r]);return null;};");
      // fallo de lectura
      assert.strictEqual(await ev('calcCostesMes()'), null);
      await ev('renderCostes()');
      assert.strictEqual(ev('lastCostesCalc'), null);
      assert.strictEqual(ctx.__dom['cos-hist-warn'].style.display, '');
      assert.strictEqual(ctx.__dom['cos-in'].textContent, '—', 'sin cifras parciales');
      assert.ok(ev('__toasts').some(m => m.includes('No se pudo leer el historial de la nube')));
      // lectura correcta
      const dentro = new Date(2026, 3, 15, 12).getTime(), fuera = new Date(2026, 4, 2, 12).getTime();
      ev("__gm=[];getMergedMovements=async(s,r)=>{__gm.push([s,r]);return [{ts:" + dentro + ",diferencia:2,coste:5,tipo:'Entrada',cat:'C',nombre:'DEL-MES'},{ts:" + fuera + ",diferencia:1,nombre:'OTRO-MES'}];}");
      await ev('renderCostes()');
      assert.deepStrictEqual(norm(ev('__gm[0]')), [true, { desde: new Date(2026, 3, 1).getTime(), hasta: new Date(2026, 4, 0, 23, 59, 59, 999).getTime() }]);
      assert.strictEqual(ctx.__dom['cos-hist-warn'].style.display, 'none');
      assert.deepStrictEqual(norm(ev('lastCostesCalc.movs.map(m=>m.nombre)')), ['DEL-MES']);
      assert.strictEqual(ev('lastCostesCalc.m'), 3);
      assert.strictEqual(ev('lastCostesCalc.y'), 2026);
      assert.deepStrictEqual(norm(ev('homeMovsCache')), [{ nombre: 'DE-INICIO' }], 'Costes ya no pisa la caché de Inicio');
    });
  });
});

test('Costes (M3): una lectura lenta de otro mes no pisa la pantalla ni lastCostesCalc de la selección más reciente', async () => {
  const dom = { 'cos-month': { value: '2' }, 'cos-year': { value: '2026' }, 'cos-hist-warn': { style: { display: 'none' } } };
  await conNube({ dom }, async () => {
    await conStubs(['getMergedMovements', 'lastCostesCalc', 'pushPendingMovements', 'homeMovsCache', '_costSeq'], async () => {
      const marzo = new Date(2026, 2, 10, 12).getTime(), abril = new Date(2026, 3, 10, 12).getTime();
      ev("items=[];pushPendingMovements=async()=>{};homeMovsCache=[];lastCostesCalc=null;__toasts=[];__marFalla=false;");
      // marzo (mes 2) tarda hasta que se libera; abril responde al momento
      ev("getMergedMovements=async(s,r)=>{const mar=r.desde===new Date(2026,2,1).getTime();if(mar)await new Promise(x=>{__rel=x;});if(mar&&__marFalla)return null;return [{ts:mar?" + marzo + ":" + abril + ",diferencia:1,coste:5,tipo:'Entrada',cat:'C',nombre:mar?'MARZO':'ABRIL'}];}");
      const lenta = ev('renderCostes()'); // el usuario elige marzo...
      await new Promise(r => setTimeout(r, 10));
      ctx.__dom['cos-month'].value = '3'; // ...y enseguida abril
      await ev('renderCostes()');
      ev('__rel()'); // marzo termina el último
      await lenta;
      assert.strictEqual(ev('lastCostesCalc.m'), 3, 'lastCostesCalc sigue siendo el de abril (el selector dice abril)');
      assert.deepStrictEqual(norm(ev('lastCostesCalc.movs.map(m=>m.nombre)')), ['ABRIL']);
      const html = ctx.__dom['cos-entradas'].innerHTML;
      assert.ok(html.includes('ABRIL') && !html.includes('MARZO'), 'la pantalla muestra abril: ' + html);
      // una lectura lenta que además FALLA tampoco pisa ni avisa si ya hay una selección más reciente
      ev("__marFalla=true");
      ctx.__dom['cos-month'].value = '2';
      const lenta2 = ev('renderCostes()');
      await new Promise(r => setTimeout(r, 10));
      ctx.__dom['cos-month'].value = '3';
      await ev('renderCostes()');
      ev('__rel()');
      await lenta2;
      assert.strictEqual(ev('lastCostesCalc.m'), 3);
      assert.ok(ctx.__dom['cos-entradas'].innerHTML.includes('ABRIL'));
      assert.strictEqual(ctx.__dom['cos-hist-warn'].style.display, 'none', 'el fallo de una lectura obsoleta no enciende el aviso');
      assert.ok(!ev('__toasts').some(m => m.includes('No se pudo leer')), ev('__toasts.join("|")'));
    });
  });
});

test('Costes (M3): el refresco automático tras guardar stock no usa toast (taparía "pendiente de subir"); el cambio de mes sí avisa', async () => {
  const refrescar = ev('refreshVisiblePage'); // la real, antes de que conNube la sustituya
  ctx.__refrescar = refrescar;
  const dom = { 'cos-month': { value: '3' }, 'cos-year': { value: '2026' }, 'cos-hist-warn': { style: { display: 'none' } }, 'page-costes': { classList: { contains: () => true, add() {}, remove() {} } } };
  try {
    await conNube({ dom }, async () => {
      await conStubs(['getMergedMovements', 'lastCostesCalc', 'pushPendingMovements', 'homeMovsCache', '_costSeq'], async () => {
        ev("items=[];pushPendingMovements=async()=>{};homeMovsCache=[];lastCostesCalc=null;getMergedMovements=async()=>null;__toasts=[];");
        ev("toast('+3 uds · stock: 8 · ⚠ pendiente de subir')"); // el toast de éxito de _commitStock
        ev('__refrescar()');
        await new Promise(r => setTimeout(r, 20));
        assert.deepStrictEqual(norm(ev('__toasts')), ['+3 uds · stock: 8 · ⚠ pendiente de subir'], 'el refresco no tapa el aviso con otro toast');
        assert.strictEqual(ctx.__dom['cos-hist-warn'].style.display, '', 'pero el aviso en la página sí se muestra');
        assert.strictEqual(ctx.__dom['cos-in'].textContent, '—');
        assert.strictEqual(ev('lastCostesCalc'), null);
        // acción del usuario (cambiar de mes / abrir la página): sí hay toast
        await ev('renderCostes()');
        assert.ok(ev('__toasts').some(m => m.includes('No se pudo leer el historial de la nube')), ev('__toasts.join("|")'));
      });
    });
  } finally {
    delete ctx.__refrescar;
  }
});

test('informe de costes PDF: usa los movimientos del mes (lastCostesCalc), no la caché de Inicio, y no sale si no se pudo leer (E-L10)', async () => {
  const dom = { 'cos-month': { value: '3' }, 'cos-year': { value: '2026' } };
  await conNube({ dom }, async () => {
    await conStubs(['lastCostesCalc', 'homeMovsCache', 'renderCostes', 'adminUnlocked'], async () => {
      ctx.window.jspdf = ev("({jsPDF:function(){return new Proxy({},{get:(o,k)=>k==='internal'?{pageSize:{getWidth:()=>595}}:k==='autoTable'?(opt=>{__tablas.push(opt);}):k==='save'?(n=>{__guardado=n;}):(()=>{})});}})");
      try {
        ev("__tablas=[];__guardado=null;adminUnlocked=false;homeMovsCache=[{ts:1,fecha:'x',nombre:'DE-INICIO',tipo:'Entrada',diferencia:1}];lastCostesCalc={valIn:0,valOut:0,valCompras:0,porCat:{},m:3,y:2026,movs:[{ts:2,fecha:'y',nombre:'DEL-MES',tipo:'Entrada',diferencia:2}]};__rc=0;renderCostes=async()=>{__rc++;};");
        await ev('exportCostesPDF()');
        assert.strictEqual(ev('__rc'), 0, 'datos del mes elegido: no recalcula');
        const filas = norm(ev('__tablas[1].body'));
        assert.deepStrictEqual(filas.map(f => f[1]), ['DEL-MES']);
        assert.ok(String(ev('__guardado')).includes('2026-04'));
        // otro mes seleccionado: recalcula; si no se puede leer la nube (lastCostesCalc nulo) no se genera el PDF
        ev("__tablas=[];__guardado=null;lastCostesCalc.m=2;renderCostes=async()=>{__rc++;lastCostesCalc=null;};");
        await ev('exportCostesPDF()');
        assert.strictEqual(ev('__rc'), 1);
        assert.strictEqual(ev('__guardado'), null);
        assert.strictEqual(ev('__tablas.length'), 0);
      } finally {
        delete ctx.window.jspdf;
      }
    });
  });
});

test('exportar movimientos (L2): "Desde" por defecto es el día 1 del mes en hora local (en UTC+1/+2 no cae en el último día del mes anterior)', async () => {
  const tzAntes = process.env.TZ;
  process.env.TZ = 'Europe/Madrid'; // con toISOString(), la medianoche local del día 1 es el día anterior en UTC
  try {
    const dom = { 'mov-from': { value: '' }, 'mov-to': { value: '' } };
    await conNube({ dom }, async () => {
      await conStubs(['setMovRange'], async () => {
        ev('setMovRange=()=>{}');
        ev('exportMovimientos()');
        const d = new Date();
        const p2 = n => String(n).padStart(2, '0');
        assert.strictEqual(ctx.__dom['mov-from'].value, d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-01');
        assert.strictEqual(ctx.__dom['mov-to'].value, d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()), 'Hasta = hoy en hora local');
        assert.ok(ev('__opened').includes('modal-mov-range'));
      });
    });
  } finally {
    if (tzAntes === undefined) delete process.env.TZ; else process.env.TZ = tzAntes;
  }
});

test('exportar movimientos: lectura estricta, aborta con aviso si no se puede leer la nube y consulta solo el rango pedido (SF-A5)', async () => {
  const dom = { 'mov-from': { value: '2026-04-01' }, 'mov-to': { value: '2026-04-30' } };
  await conNube({ dom }, async () => {
    await conStubs(['getMergedMovements', 'movRangeMode', 'asegurarFotos', 'pushPendingMovements'], async () => {
      ev("__gm=[];__fotos=0;pushPendingMovements=async()=>{};asegurarFotos=async()=>{__fotos++;return {};};getMergedMovements=async(s,r)=>{__gm.push([s,r]);return null;};movRangeMode='range';");
      await ev('doExportMovimientos()');
      assert.deepStrictEqual(norm(ev('__gm')), [[true, { desde: new Date('2026-04-01T00:00:00').getTime(), hasta: new Date('2026-04-30T23:59:59.999').getTime() }]]);
      assert.ok(ev('__toasts').some(m => m.includes('No se pudo leer el historial de la nube')), ev('__toasts.join("|")'));
      assert.ok(!ev('__toasts').some(m => m.includes('Generando Excel')), 'no se llega a generar el Excel');
      assert.strictEqual(ev('__fotos'), 0);
      // exportar todo: sin ventana, pero también estricto
      ev("__gm=[];__toasts=[];movRangeMode='all';");
      await ev('doExportMovimientos()');
      assert.deepStrictEqual(norm(ev('__gm')), [[true, null]], 'sin ventana de fechas (undefined se serializa como null)');
      assert.ok(ev('__toasts').some(m => m.includes('No se pudo leer el historial de la nube')));
    });
  });
});

test('historial de precios y proveedor: el aviso de fallo llega en el toast final de compra, factura y artículo nuevo (SF-A10)', async () => {
  assert.strictEqual(ev('sufijoHist(true,true)'), '');
  assert.strictEqual(ev('sufijoHist(undefined,undefined)'), '', 'sin dato (nada que guardar) no se avisa');
  assert.strictEqual(ev('sufijoHist(false,true)'), ' · ⚠ historial de precios no guardado');
  assert.strictEqual(ev('sufijoHist(true,false)'), ' · ⚠ proveedor no guardado en la nube');
  // compra desde la ficha
  const dom = { 'pur-qty': { value: '3' }, 'pur-price': { value: '2' }, 'pur-discount': { value: '' }, 'pur-provider': { value: 'ACME' } };
  await conNube({ dom }, async () => {
    await conStubs(['cloudPriceAdd', 'addProvider', 'renderPriceHistory', 'renderInvoiceModal', 'adminUnlocked', '_invLines', '_invProvider'], async () => {
      ev("items=[{id:'I1',name:'A',stock:5,precio:1}];currentItem=items[0];renderPriceHistory=()=>{};renderInvoiceModal=()=>{};cloudPriceAdd=async()=>false;addProvider=async()=>false;");
      await ev('applyPurchase()');
      let t = ev('__toasts.pop()');
      assert.ok(t.startsWith('✓ Entrada de compra: +3') && t.includes('historial de precios no guardado') && t.includes('proveedor no guardado'), t);
      ev("items=[{id:'I1',name:'A',stock:5,precio:1}];currentItem=items[0];cloudPriceAdd=async()=>true;addProvider=async()=>true;");
      await ev('applyPurchase()');
      t = ev('__toasts.pop()');
      assert.ok(t.startsWith('✓ Entrada de compra: +3') && !t.includes('⚠'), t);
      // línea de factura asignada a un artículo existente
      ev("adminUnlocked=true;_invProvider='ACME';_invLines=[{desc:'x',qty:2,price:4,status:'pending',itemId:null}];renderInvoiceLines=()=>{};cloudPriceAdd=async()=>false;addProvider=async()=>false;items=[{id:'I1',name:'A',stock:5,precio:1}];");
      await ev("assignInvoiceLine(0,'I1')");
      t = ev('__toasts.pop()');
      assert.ok(t.startsWith('✓ A · +2 ud') && t.includes('historial de precios no guardado') && t.includes('proveedor no guardado'), t);
      // artículo nuevo creado desde la factura (con el movimiento de compra fallando)
      ev("_invLines=[{desc:'y',qty:1,price:4,status:'pending',itemId:null}];items=[{id:'N1',name:'Nuevo',stock:4,precio:3}];registrarMovimiento=async()=>{throw new Error('idb');};");
      await t_invoiceAfterSave();
      t = ev('__toasts.pop()');
      assert.ok(t.startsWith('✓ Nuevo creado y asignado a la factura') && t.includes('no se pudo registrar el movimiento de compra') && t.includes('historial de precios no guardado') && t.includes('proveedor no guardado'), t);
      ev("registrarMovimiento=async()=>{};_invLines=[{desc:'y',qty:1,price:4,status:'pending',itemId:null}];cloudPriceAdd=async()=>true;addProvider=async()=>true;");
      await t_invoiceAfterSave();
      assert.strictEqual(ev('__toasts.pop()'), '✓ Nuevo creado y asignado a la factura');
    });
  });
});
async function t_invoiceAfterSave() { return ev("_invoiceAfterSave('N1',0)"); }

test('historial de precios: cloudPriceAdd devuelve el resultado real (con tiempo límite)', async () => {
  await conR2({}, async () => {
    ev(QB);
    assert.strictEqual(await ev('cloudPriceAdd({item_id:"I1",price:1})'), true);
    assert.strictEqual(ev('__mqs[0].t'), 'price_history');
    ev("__movRes=()=>({error:{message:'rls'}})");
    assert.strictEqual(await ev('cloudPriceAdd({item_id:"I1"})'), false);
    ev("__movRes=()=>{throw new Error('red')}");
    assert.strictEqual(await ev('cloudPriceAdd({item_id:"I1"})'), false);
    ev("__movRes=()=>({error:null});withTimeout=()=>Promise.reject(new Error('Tiempo agotado: precio'))");
    assert.strictEqual(await ev('cloudPriceAdd({item_id:"I1"})'), false);
    ev('withTimeout=__o2.withTimeout;sb=null');
    assert.strictEqual(await ev('cloudPriceAdd({item_id:"I1"})'), false);
  });
});

test('proveedor: addProvider devuelve si se pudo guardar y deja el fallo en la cola dirtyCfg (SF-A10)', async () => {
  await conR2({}, async () => {
    await conStubs(['providers'], async () => {
      ev("providers=[]");
      assert.strictEqual(await ev("addProvider('')"), true);
      ev("__ups=()=>({error:{message:'red'}})");
      assert.strictEqual(await ev("addProvider('ACME')"), false);
      assert.strictEqual(ev("dirtyCfg.has('providers')"), true);
      ev("__ups=()=>({error:null});cfgPut=async()=>{throw new Error('idb')}");
      assert.strictEqual(await ev("addProvider('Otro')"), false, 'falla el guardado en el móvil');
      ev("cfgPut=async(k,v)=>{__cfg[k]=v}");
      assert.strictEqual(await ev("addProvider('Tercero')"), true);
    });
  });
});

// Entorno para mover/borrar: dos almacenes, nube de artículos simulada y funciones de red sustituidas
const STUBS_MOVER = ['cloudPutTo', 'cloudDelete', 'cloudGetPhotos', 'otherWarehouse', 'requireAdmin', 'updateSelBar', 'dbGetAll', 'dbDelete'];
async function conMover(fn) {
  await conNube({}, async () => {
    await conStubs(STUBS_MOVER, async () => {
      ev(`WH={key:'electrico',name:'Eléctrico',tblCfg:'config',tblItems:'items'};
        __otro={name:'Mecánico',tblItems:'items_mec'};otherWarehouse=()=>__otro;requireAdmin=f=>f();updateSelBar=()=>{};
        __copias=[];__borrados=[];__dbDel=[];__fotos={};
        cloudPutTo=async(t,it)=>{__copias.push([t,it.id,it.stock,it.loc,it.photo]);return !(__noCopia&&__noCopia.includes(it.id));};
        cloudDelete=async id=>{__borrados.push(id);if(__noBorra&&__noBorra.includes(id)){markDirtyDel(id);return false;}return true;};
        cloudGetPhotos=async ids=>{const o={};ids.forEach(i=>{if(i in __fotos)o[i]=__fotos[i];});return o;};
        __noCopia=[];__noBorra=[];
        dbDelete=async id=>{__dbDel.push(id);};dbGetAll=async()=>items.filter(i=>!__dbDel.includes(i.id));`);
      await fn();
    });
  });
}

test('mover de almacén: lee el stock actual de la nube antes de copiar y solo borra en local lo borrado de verdad (SF-A14)', async () => {
  await conMover(async () => {
    ev("items=[{id:'I1',name:'A',stock:3,loc:'01-1',pos:'p',photo:'data:image/png;base64,AAAA'}];__stock=()=>({data:{stock:9},error:null});");
    assert.strictEqual(await ev('_moverItemA(items[0],__otro)'), 'ok');
    assert.deepStrictEqual(norm(ev('__copias')), [['items_mec', 'I1', 9, '', 'data:image/png;base64,AAAA']], 'copia el stock de la nube (9), no el local viejo (3), y sin ubicación');
    assert.deepStrictEqual(norm(ev('__dbDel')), ['I1']);
    // no se pudo leer el stock: no se copia nada (falla cerrado)
    ev("items=[{id:'I2',name:'B',stock:3,photo:'data:image/png;base64,AAAA'}];__copias=[];__borrados=[];__dbDel=[];__stock=()=>{throw new Error('t')}");
    assert.strictEqual(await ev('_moverItemA(items[0],__otro)'), 'stock');
    assert.strictEqual(ev('__copias.length'), 0);
    assert.strictEqual(ev('__borrados.length'), 0);
    // otra persona lo borró: se quita del móvil y no se copia
    ev("__stock=()=>({data:null,error:null})");
    assert.strictEqual(await ev('_moverItemA(items[0],__otro)'), 'missing');
    assert.strictEqual(ev('__copias.length'), 0);
    assert.strictEqual(ev('items.length'), 0);
    // con un cambio local pendiente manda el stock local
    ev("items=[{id:'I3',name:'C',stock:3,photo:'data:image/png;base64,AAAA'}];dirtyFields.I3={stock:3};__stock=()=>({data:{stock:9},error:null});__copias=[]");
    assert.strictEqual(await ev('_moverItemA(items[0],__otro)'), 'ok');
    assert.strictEqual(ev('__copias[0][2]'), 3);
    // la copia falla: no se borra nada del origen
    ev("items=[{id:'I4',name:'D',stock:3,photo:'data:image/png;base64,AAAA'}];__copias=[];__borrados=[];__dbDel=[];__noCopia=['I4']");
    assert.strictEqual(await ev('_moverItemA(items[0],__otro)'), 'nube');
    assert.strictEqual(ev('__borrados.length'), 0);
    assert.strictEqual(ev('__dbDel.length'), 0);
    // el borrado del origen falla: queda en los dos y la fila local NO se borra
    ev("items=[{id:'I5',name:'E',stock:3,photo:'data:image/png;base64,AAAA'}];__copias=[];__borrados=[];__dbDel=[];__noCopia=[];__noBorra=['I5']");
    assert.strictEqual(await ev('_moverItemA(items[0],__otro)'), 'copiado');
    assert.strictEqual(ev('__copias.length'), 1);
    assert.deepStrictEqual(norm(ev('__dbDel')), [], 'se conserva la fila local');
    assert.strictEqual(ev("dirtyDel.has('I5')"), true, 'el borrado queda en la cola');
    // sin foto local y sin poder comprobarla: no se mueve
    ev("items=[{id:'I6',name:'F',stock:3,photo:null}];__copias=[];__noBorra=[];__fotos={}");
    assert.strictEqual(await ev('_moverItemA(items[0],__otro)'), 'foto');
    assert.strictEqual(ev('__copias.length'), 0);
  });
});

test('mover de almacén (ficha): el aviso dice lo que pasó de verdad', async () => {
  await conMover(async () => {
    const mover = async () => { await ev('moveToOtherWarehouse()'); await ctx.__dom['confirm-ok'].onclick(); };
    ev("items=[{id:'I1',name:'A',stock:3,photo:'data:image/png;base64,AAAA'}];currentItem=items[0];__stock=()=>({data:{stock:9},error:null});__toasts=[]");
    await mover();
    assert.strictEqual(ev('__toasts.pop()'), '✓ Movido a Mecánico (sin ubicación)');
    assert.deepStrictEqual(norm(ev('__dbDel')), ['I1']);
    // el borrado del origen falla por la red: aviso de que queda en los dos, con reintento
    ev("items=[{id:'I2',name:'B',stock:3,photo:'data:image/png;base64,AAAA'}];currentItem=items[0];__dbDel=[];__noBorra=['I2'];__toasts=[]");
    await mover();
    const t = ev('__toasts.pop()');
    assert.ok(t.includes('Copiado a Mecánico') && t.includes('NO se pudo quitar de Eléctrico') && t.includes('se reintentará'), t);
    assert.deepStrictEqual(norm(ev('__dbDel')), []);
    assert.strictEqual(ev('items.length'), 1, 'el artículo sigue en este almacén');
    // la copia falla
    ev("items=[{id:'I3',name:'C',stock:3,photo:'data:image/png;base64,AAAA'}];currentItem=items[0];__noBorra=[];__noCopia=['I3'];__toasts=[]");
    await mover();
    assert.ok(ev('__toasts.pop()').includes('No se pudo mover'));
    // no se pudo comprobar el stock
    ev("items=[{id:'I4',name:'D',stock:3,photo:'data:image/png;base64,AAAA'}];currentItem=items[0];__noCopia=[];__stock=()=>{throw new Error('t')};__toasts=[]");
    await mover();
    assert.ok(ev('__toasts.pop()').includes('No se pudo comprobar el stock actual'));
  });
});

test('mover varios: informa de movidos, fallidos, copiados sin borrar y desaparecidos; solo se borra en local lo borrado (SF-A14)', async () => {
  await conMover(async () => {
    ev(`items=['I1','I2','I3','I5'].map(id=>({id,name:id,stock:3,photo:'data:image/png;base64,AAAA'}));
      __stock=()=>({data:{stock:9},error:null});__noCopia=['I2'];__noBorra=['I3'];__toasts=[];
      selectedIds.clear();['I1','I2','I3','I4','I5'].forEach(i=>selectedIds.add(i));`);
    try {
      await ev('bulkMove()');
      await ctx.__dom['confirm-ok'].onclick();
      const t = ev('__toasts.pop()');
      assert.ok(t.includes('Movidos 2 de 5 a Mecánico'), t);
      assert.ok(t.includes('1 no se movieron') && t.includes('1 copiados pero no se pudieron quitar') && t.includes('1 ya no existían'), t);
      assert.deepStrictEqual(norm(ev('__dbDel')), ['I1', 'I5'], 'solo lo borrado de verdad se quita en local');
      assert.deepStrictEqual(norm(ev('[...selectedIds]')), ['I2'], 'queda seleccionado lo que no se movió');
      // todo bien
      ev("items=[{id:'I8',name:'x',stock:1,photo:'data:image/png;base64,AAAA'}];__noCopia=[];__noBorra=[];__dbDel=[];selectedIds.clear();selectedIds.add('I8');");
      await ev('bulkMove()');
      await ctx.__dom['confirm-ok'].onclick();
      assert.strictEqual(ev('__toasts.pop()'), '✓ Movidos 1 de 1 a Mecánico');
      assert.strictEqual(ev('selectedIds.size'), 0);
    } finally {
      ev('selectedIds.clear()');
    }
  });
  assert.strictEqual(ev('resumenMover({ok:2,copiado:0,fallo:0,missing:0,total:2},"X")'), '✓ Movidos 2 de 2 a X');
});

test('borrar todo: cuenta aciertos y fallos y solo limpia en local (y las categorías) lo que se borró de verdad (SF-A14)', async () => {
  await conMover(async () => {
    ev("items=['I1','I2','I3'].map(id=>({id,name:id,stock:1}));categories=['Cat'];__noBorra=['I2'];__toasts=[];__cfg={};");
    await ev('askWipe()');
    await ctx.__dom['confirm-ok'].onclick();
    let t = ev('__toasts.pop()');
    assert.ok(t.includes('No se pudo borrar todo: 1 borrados, el resto sigue en el inventario'), t);
    assert.ok(!t.includes('se reintentará'), 'ya no queda un borrado en cola que se ejecute solo al sincronizar (M4)');
    assert.deepStrictEqual(norm(ev('__borrados')), ['I1', 'I2'], 'se para en el primer fallo: I3 ni se intenta');
    assert.strictEqual(ev('dirtyDel.size'), 0, 'el borrado fallido no queda en cola (M4)');
    assert.deepStrictEqual(norm(ev('__dbDel')), ['I1'], 'I2 sigue en el móvil');
    assert.deepStrictEqual(norm(ev('items.map(i=>i.id)')), ['I2', 'I3']);
    assert.strictEqual(ev('_stockBusy'), false, 'se libera la marca de "operación en curso"');
    assert.deepStrictEqual(norm(ev('categories')), ['Cat'], 'con fallos no se vacían las categorías');
    assert.ok(!('categories' in norm(ev('__cfg'))));
    // sin fallos: se borra todo, se vacían las categorías y se avisa de si no subieron
    ev("items=['I1','I2'].map(id=>({id,name:id,stock:1}));__noBorra=[];__borrados=[];__dbDel=[];__toasts=[];cloudCfgPut=async()=>false");
    await ev('wipeAll()');
    t = ev('__toasts.pop()');
    assert.ok(t.startsWith('Inventario borrado') && t.includes('categorías solo se vaciaron en este dispositivo'), t);
    assert.strictEqual(ev('items.length'), 0);
    assert.deepStrictEqual(norm(ev('categories')), []);
    ev("items=['I1'].map(id=>({id,name:id,stock:1}));__dbDel=[];__toasts=[];cloudCfgPut=async()=>true");
    await ev('wipeAll()');
    assert.strictEqual(ev('__toasts.pop()'), 'Inventario borrado');
  });
});

test('borrar todo (M4): sin conexión no toca nada y con otra operación en curso no arranca', async () => {
  await conMover(async () => {
    ev("items=['I1','I2'].map(id=>({id,name:id,stock:1}));categories=['Cat'];__toasts=[];__cfg={};");
    ctx.navigator = { onLine: false };
    try {
      await ev('wipeAll()');
    } finally {
      ctx.navigator = {};
    }
    assert.deepStrictEqual(norm(ev('__borrados')), [], 'ninguna petición de borrado');
    assert.deepStrictEqual(norm(ev('__dbDel')), []);
    assert.deepStrictEqual(norm(ev('items.map(i=>i.id)')), ['I1', 'I2']);
    assert.deepStrictEqual(norm(ev('categories')), ['Cat']);
    assert.strictEqual(ev('dirtyDel.size'), 0);
    assert.ok(ev('__toasts').some(m => m.includes('Sin conexión') && m.includes('borrar el inventario')), ev('__toasts.join("|")'));
    assert.strictEqual(ev('_stockBusy'), false, 'la marca de ocupado se libera aunque no haya conexión');
    // otra operación en curso (movimiento de stock, subida...): no se mezcla
    ev("__toasts=[];_stockBusy=true");
    await ev('wipeAll()');
    assert.deepStrictEqual(norm(ev('__borrados')), []);
    assert.deepStrictEqual(norm(ev('items.map(i=>i.id)')), ['I1', 'I2']);
    assert.deepStrictEqual(norm(ev('__toasts')), ['Procesando…']);
    assert.strictEqual(ev('_stockBusy'), true, 'no libera la marca de la operación que ya estaba en curso');
  });
});

test('borrar todo (M4): mantiene la marca de ocupado mientras borra y para en el primer fallo sin dejar borrados en cola', async () => {
  await conMover(async () => {
    ev("items=['I1','I2','I3','I4'].map(id=>({id,name:id,stock:1}));categories=['Cat'];__toasts=[];__cfg={};__ocupado=[];__noBorra=['I2','I3'];");
    // el stub de cloudDelete anota si _stockBusy está activo en cada petición
    ev("cloudDelete=async id=>{__borrados.push(id);__ocupado.push(_stockBusy);if(__noBorra.includes(id)){markDirtyDel(id);return false;}return true;};");
    await ev('wipeAll()');
    assert.deepStrictEqual(norm(ev('__borrados')), ['I1', 'I2'], 'tras el primer fallo (I2) no se intenta I3 ni I4');
    assert.deepStrictEqual(norm(ev('__ocupado')), [true, true]);
    assert.deepStrictEqual(norm(ev('[...dirtyDel]')), [], 'ni I2 ni los no intentados quedan en cola: no se borrarán solos al sincronizar');
    assert.deepStrictEqual(norm(ev('__dbDel')), ['I1']);
    assert.deepStrictEqual(norm(ev('items.map(i=>i.id)')), ['I2', 'I3', 'I4']);
    assert.deepStrictEqual(norm(ev('categories')), ['Cat'], 'con un fallo no se vacían las categorías');
    assert.ok(!('categories' in norm(ev('__cfg'))));
    assert.strictEqual(ev('__toasts.pop()'), '⚠ No se pudo borrar todo: 1 borrados, el resto sigue en el inventario');
    assert.strictEqual(ev('_stockBusy'), false);
    // un borrado en cola de ANTES (otro artículo) no se toca
    ev("dirtyDel=new Set(['OLD']);__borrados=[];__noBorra=['I2'];");
    await ev('wipeAll()');
    assert.deepStrictEqual(norm(ev('[...dirtyDel]')), ['OLD'], 'solo se limpia el artículo que falló en este borrado');
    // cloudDelete que lanza una excepción inesperada: la marca de ocupado se libera igualmente
    ev("cloudDelete=async()=>{throw new Error('boom')};");
    await assert.rejects(() => ev('wipeAll()'));
    assert.strictEqual(ev('_stockBusy'), false);
  });
});

test('diagnóstico de movimientos: solo lee la columna ts (DB-LOW6)', async () => {
  await conR2({}, async () => {
    await conStubs(['showInfo'], async () => {
      ev(QB);
      ev("__movRes=()=>({data:[],error:null,count:7});showInfo=(t,m)=>{__info=m;};");
      await ev('diagnosticoMovimientos()');
      assert.deepStrictEqual(norm(ev('__mqs[0].ops[0]')), ['select', 'ts', { count: 'exact' }]);
      assert.ok(String(ev('__info')).includes('7'));
    });
  });
});

// ===== Arreglos de la revisión ECC (bloque R2b) =====
test('config M1: dos escrituras solapadas de la misma clave no pierden la marca de pendiente si la última falla', async () => {
  await conR2({}, async () => {
    ev('__pend=[];__ups=(t,o)=>new Promise(r=>__pend.push(r));');
    // A y B en vuelo; A termina bien: B sigue sin subir, la clave sigue pendiente; B falla: sigue pendiente
    const pA = ev("cloudCfgPut('shelves',[{id:'A'}])");
    const pB = ev("cloudCfgPut('shelves',[{id:'B'}])");
    assert.strictEqual(ev('__pend.length'), 2);
    ev('__pend[0]({error:null})');
    assert.strictEqual(await pA, true);
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true, 'el éxito de A no limpia lo que B aún no ha subido');
    ev("__pend[1]({error:{message:'red'}})");
    assert.strictEqual(await pB, false);
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true);
    assert.deepStrictEqual(evj('__cfg.dirtyCfg'), ['shelves']);
    // B termina bien antes que A y A falla después: la clave vuelve a quedar pendiente (el valor local es el más nuevo)
    ev('dirtyCfg=new Set();__pend=[]');
    const pA2 = ev("cloudCfgPut('shelves',[{id:'A'}])");
    const pB2 = ev("cloudCfgPut('shelves',[{id:'B'}])");
    ev('__pend[1]({error:null})');
    assert.strictEqual(await pB2, true);
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), false, 'la última escritura subió bien y limpia');
    ev("__pend[0]({error:{message:'red'}})");
    assert.strictEqual(await pA2, false);
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true, 'un fallo siempre deja la clave pendiente');
    // las dos bien: solo la última limpia, y queda limpia
    ev('dirtyCfg=new Set();__pend=[]');
    const pA3 = ev("cloudCfgPut('shelves',[{id:'A'}])");
    const pB3 = ev("cloudCfgPut('shelves',[{id:'B'}])");
    ev('__pend[0]({error:null})');
    await pA3;
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true);
    ev('__pend[1]({error:null})');
    await pB3;
    assert.strictEqual(ev('dirtyCfg.size'), 0);
    // la sincronización sube A, el usuario guarda B a mitad y B falla: lo local (B) sigue pendiente y no se pisa con A
    ev("dirtyCfg=new Set(['shelves']);__pend=[];__cfg.shelves=[{id:'A'}]");
    const pF = ev('flushDirtyCfg()');
    await new Promise(r => setTimeout(r, 5));
    assert.strictEqual(ev('__pend.length'), 1, 'sube A');
    ev("__cfg.shelves=[{id:'B'}]");
    const pB4 = ev("cloudCfgPut('shelves',[{id:'B'}])");
    ev('__pend[0]({error:null})');
    await pF;
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true, 'A terminó bien pero B está en vuelo');
    ev("__pend[1]({error:{message:'red'}})");
    await pB4;
    assert.strictEqual(ev("dirtyCfg.has('shelves')"), true);
  });
});

test('config M2: un 42501 solo es definitivo en adminPass y loginCfg; en el resto la config local sigue pendiente', async () => {
  await conR2({}, async () => {
    ev("__ups=()=>({error:{code:'42501',message:'rls'}})");
    for (const k of ['shelves', 'categories', 'aisles', 'mapSize', 'providers', 'printedIds']) {
      assert.strictEqual(await ev("cloudCfgPut('" + k + "',[1])"), false);
      assert.strictEqual(ev("dirtyCfg.has('" + k + "')"), true, k + ' sigue pendiente (sesión caducada, no falta de permiso)');
    }
    assert.deepStrictEqual(evj('[...dirtyCfg].sort()'), ['aisles', 'categories', 'mapSize', 'printedIds', 'providers', 'shelves']);
    for (const k of ['adminPass', 'loginCfg']) {
      assert.strictEqual(await ev("cloudCfgPut('" + k + "','x')"), false);
      assert.strictEqual(ev("dirtyCfg.has('" + k + "')"), false, k + ': reintentar no serviría (solo administradores)');
    }
    assert.deepStrictEqual(evj('__cfg.dirtyCfg').sort(), ['aisles', 'categories', 'mapSize', 'printedIds', 'providers', 'shelves']);
  });
});

test('config L1: la sincronización no pisa una clave guardada mientras leía la nube (contador por clave), aunque ya haya subido', async () => {
  await conR2({}, async () => {
    ev(`items=[];dirtyIds=new Set();categories=['ANTES'];providers=['P0'];
      pushPendingMovements=async()=>{};flushDirty=async()=>{};cloudGetMeta=async()=>[];dbReplaceAll=async()=>{};setCloudStatus=()=>{};
      cloudCfgGetMany=async()=>{categories=['LOCAL2'];await cloudCfgPut('categories',['LOCAL2']);return {categories:['NUBE'],providers:['P1']};};`);
    await ev('_syncFromCloud(false)');
    assert.strictEqual(ev("dirtyCfg.has('categories')"), false, 'la subida terminó bien: ya no está pendiente, pero cambió durante la lectura');
    assert.deepStrictEqual(evj('categories'), ['LOCAL2'], 'no se pisa con el valor leído antes del cambio');
    assert.deepStrictEqual(evj('providers'), ['P1'], 'una clave que no cambió sí se actualiza desde la nube');
  });
});

test('config L2: flushDirtyCfg corta tras el primer fallo de red o de tiempo y sigue tras un error del servidor', async () => {
  await conR2({}, async () => {
    const preparar = () => ev("dirtyCfg=new Set(['shelves','categories','aisles']);__cfg.shelves=[1];__cfg.categories=[2];__cfg.aisles=[3];__calls=[]");
    const subidas = () => ev("__calls.filter(c=>c[0]==='upsert').length");
    preparar();
    ev("__ups=()=>({error:{message:'TypeError: Failed to fetch'}})");
    await ev('flushDirtyCfg()');
    assert.strictEqual(subidas(), 1, 'sin red: no insiste con las demás');
    assert.strictEqual(ev('dirtyCfg.size'), 3);
    preparar();
    ev("__ups=()=>{throw new Error('Tiempo agotado: config')}");
    await ev('flushDirtyCfg()');
    assert.strictEqual(subidas(), 1, 'tiempo agotado: tampoco');
    preparar();
    ev("__ups=()=>({error:{code:'23505',message:'duplicado'}})");
    await ev('flushDirtyCfg()');
    assert.strictEqual(subidas(), 3, 'un error del servidor de una clave no bloquea las demás');
    preparar();
    ev("__ups=()=>({error:null})");
    await ev('flushDirtyCfg()');
    assert.strictEqual(subidas(), 3);
    assert.strictEqual(ev('dirtyCfg.size'), 0);
  });
});

test('copias M3: con el cliente creado pero sin red, exportData exporta lo local rápido (sin esperar 20 s) y con aviso; sin fotos no genera', async () => {
  const restaurar = descargaSimulada();
  try {
    await conR2({}, async () => {
      ev("items=[{id:'I1',name:'A',stock:1,photo:'" + FOTO_R2 + "'}];dbGetAll=async()=>items;categories=['X'];shelves=[{id:'01'}];aisles=[];providers=['P'];printedIds=new Set(['I1']);modifiedIds=new Set()");
      const s = sbExport({ movements: [{ ts: 5, itemId: 'I1' }], price_history: [] }, {});
      ctx.__sbx = s; ev('sb=__sbx');
      // la comprobación de red agota su tiempo (simulado: sin esperas reales)
      ev("withTimeout=(p,ms,l)=>l==='ping'?Promise.reject(new Error('Tiempo agotado: ping')):__o2.withTimeout(p,ms,l)");
      try {
        const t0 = Date.now();
        await ev('exportData()');
        assert.ok(Date.now() - t0 < 2000, 'no espera a las lecturas de la nube');
        const j = JSON.parse(ctx.__blobs.pop());
        assert.strictEqual(j.items.length, 1);
        assert.deepStrictEqual(j.categories, ['X']);
        assert.deepStrictEqual(j.shelves, [{ id: '01' }]);
        assert.deepStrictEqual(j.providers, ['P']);
        assert.ok(!('movements' in j) && !('price_history' in j), 'local: sin movimientos ni precios');
        assert.ok(ev('__toasts.pop()').includes('Sin conexión: no incluye movimientos'));
        assert.strictEqual(s.rangos.filter(x => x[1] !== 'sonda').length, 0, 'no se leyó ninguna tabla de la nube');
        // una foto que falta sigue bloqueando la copia (no se genera incompleta)
        ev("items=[{id:'I1',name:'A',stock:1,photo:null}]");
        await ev('exportData()');
        assert.strictEqual(ctx.__blobs.length, 0);
        assert.ok(ev('__toasts.pop()').includes('No se pudieron descargar 1 foto'));
        assert.strictEqual(s.rangos.filter(x => x[1] !== 'sonda').length, 0, 'tampoco se intentó bajar la foto (20 s por lote)');
      } finally { ev('withTimeout=__o2.withTimeout'); }
    });
  } finally { restaurar(); }
});

test('copias M4: un almacén realmente vacío no bloquea la copia (el actual se lee de IndexedDB; el otro, con sonda de lectura)', async () => {
  const restaurar = descargaSimulada();
  vm.runInContext('globalThis.WAREHOUSE_CONFIG=' + ELE_R2 + ';globalThis.WAREHOUSE_OTHER_CONFIG=' + MEC_R2, ctx);
  try {
    await conR2({}, async () => {
      ev("items=[];dbGetAll=async()=>items;categories=[];shelves=[];aisles=[];providers=[];printedIds=new Set();modifiedIds=new Set()");
      const vacias = { items: [], movements: [], price_history: [], items_mec: [], movements_mec: [], price_history_mec: [] };
      // el otro almacén vacío pero legible (la sonda devuelve filas): se acepta
      ctx.__sbx = sbExport(vacias, {}, { probeRows: true }); ev('sb=__sbx');
      const r = JSON.parse(JSON.stringify(await ev('collectWarehouse(' + MEC_R2 + ')')));
      assert.deepStrictEqual(r.items, []);
      assert.deepStrictEqual(r.movements, []);
      // el actual vacío tampoco lanza
      const a = JSON.parse(JSON.stringify(await ev('collectWarehouse(' + ELE_R2 + ')')));
      assert.deepStrictEqual(a.items, []);
      // exportBoth genera la copia con los dos vacíos y el JSON es válido
      await ev('exportBoth()');
      assert.strictEqual(ctx.__blobs.length, 1);
      const j = JSON.parse(ctx.__blobs[0]);
      assert.deepStrictEqual(Object.keys(j.warehouses).sort(), ['electrico', 'mecanico']);
      assert.deepStrictEqual(j.warehouses.mecanico.items, []);
      assert.ok(ev('__toasts.pop()').startsWith('✓ Copia de los dos almacenes (0 eléctrico, 0 mecánico)'));
      // la sonda falla (error de lectura): sigue sin generarse
      for (const o of [{ probeError: true }, {}]) {
        ctx.__blobs.length = 0;
        ctx.__sbx = sbExport(vacias, {}, o); ev('sb=__sbx');
        let err = null;
        try { await ev('collectWarehouse(' + MEC_R2 + ')'); } catch (e) { err = e; }
        assert.ok(err, 'sonda sin filas o con error: ilegible, no se acepta');
        await ev('exportBoth()');
        assert.strictEqual(ctx.__blobs.length, 0);
        assert.ok(ev('__toasts.pop()').includes('No se ha generado la copia'));
      }
    });
  } finally {
    restaurar();
    vm.runInContext('globalThis.WAREHOUSE_CONFIG=undefined;globalThis.WAREHOUSE_OTHER_CONFIG=undefined', ctx);
  }
});

test('copias L10: la descarga se construye por trozos, es JSON válido y libera la URL a los 60 s', async () => {
  const restaurar = descargaSimulada();
  try {
    await conR2({}, async () => {
      const lista = Array.from({ length: 450 }, (_, i) => ({ id: 'I' + i, name: 'n' + i, stock: i, photo: FOTO_R2 }));
      ctx.__lista = lista;
      ev("items=__lista;dbGetAll=async()=>items;categories=['X'];shelves=[];aisles=[];providers=[];printedIds=new Set();modifiedIds=new Set();mapSize=null");
      ctx.__sbx = sbExport({ movements: [{ ts: 1, itemId: 'I1' }], price_history: [] }, {}); ev('sb=__sbx');
      await ev('exportData()');
      assert.strictEqual(ctx.__blobs.length, 1);
      assert.ok(ctx.__partes[0].length > 5, 'varios trozos y no una sola cadena');
      const j = JSON.parse(ctx.__blobs[0]);
      assert.strictEqual(j.items.length, 450);
      assert.deepStrictEqual(j.items[449], lista[449]);
      assert.deepStrictEqual(j.movements, [{ ts: 1, itemId: 'I1' }]);
      assert.strictEqual(j.mapSize, null);
      assert.strictEqual(ctx.__t60.length, 1, 'un temporizador de 60 s');
      assert.deepStrictEqual(ctx.__revocadas, [], 'aún no se libera');
      ctx.__t60[0]();
      assert.deepStrictEqual(ctx.__revocadas, ['blob:x']);
    });
  } finally { restaurar(); }
});

test('importar L5/L6/L7: limpia el borrado pendiente, conserva la foto local y comprueba el administrador antes de leer el archivo', async () => {
  await conR2({}, async () => {
    vm.runInContext('globalThis.WAREHOUSE_CONFIG=' + ELE_R2, ctx);
    try {
      ev(`items=[{id:'I1',name:'viejo',stock:1,photo:'${FOTO_R2}'},{id:'I2',name:'dos',stock:1,photo:null}];dbGetAll=async()=>items;
        __dbObjs=[];dbPut=async it=>{__dbObjs.push(it)};dirtyDel=new Set(['I1','I3']);`);
      const copia = { version: 4, warehouse: 'electrico', items: [{ id: 'I1', name: 'A', stock: 2 }, { id: 'I2', name: 'B', stock: 3, photo: 'data:image/png;base64,BBBB' }] };
      await importarTexto(JSON.stringify(copia));
      await ev("document.getElementById('confirm-ok').onclick()");
      assert.ok(ev('__toasts.pop()').startsWith('✓ Importados 2 artículos'));
      assert.deepStrictEqual(evj('[...dirtyDel]'), ['I3'], 'I1 se acaba de importar: ya no se borra; I3 no tiene que ver');
      const objs = evj('__dbObjs');
      assert.strictEqual(objs[0].photo, FOTO_R2, 'la copia no trae foto: se conserva la del dispositivo');
      assert.strictEqual(objs[1].photo, 'data:image/png;base64,BBBB', 'si la copia trae foto, manda la de la copia');
      const subidas = evj("__calls.filter(c=>c[1]==='items').map(c=>c[2])");
      assert.ok(!('photo' in subidas[0]), 'a la nube no se envía una foto que la copia no trae');
      // un artículo cuya subida falla NO limpia su borrado pendiente por la vía de éxito (queda como alta pendiente)
      ev("dirtyDel=new Set(['I1']);__ups=()=>({error:{message:'red'}})");
      await importarTexto(JSON.stringify({ version: 4, warehouse: 'electrico', items: [{ id: 'I1', name: 'A', stock: 2 }] }));
      await ev("document.getElementById('confirm-ok').onclick()");
      assert.strictEqual(ev("dirtyIds.has('I1')"), true);
      // sin modo administrador: se rechaza ANTES de leer el archivo y de pedir confirmación
      ev("adminUnlocked=false;__toasts=[];__opened=[]");
      ctx.__toco = false;
      ctx.__ev = { target: { get files() { ctx.__toco = true; return []; } } };
      await ev('importData(__ev)'); // envuelta por el guardián de conexión (async)
      assert.strictEqual(ctx.__toco, false, 'no se llega a mirar el archivo');
      assert.ok(ev('__toasts.pop()').includes('Solo un administrador'));
      assert.ok(!ev('__opened').includes('modal-confirm'));
    } finally {
      vm.runInContext('globalThis.WAREHOUSE_CONFIG=undefined', ctx);
    }
  });
});

test('avisos L11: la duración crece con el texto (2,5 s + 40 ms por carácter, máximo 12 s) y los cortos duran 2,5 s', () => {
  assert.strictEqual(ev("_toastMs('a'.repeat(80))"), 2500);
  assert.strictEqual(ev("_toastMs('a'.repeat(81))"), 2500 + 81 * 40);
  assert.strictEqual(ev("_toastMs('a'.repeat(200))"), 10500);
  assert.strictEqual(ev("_toastMs('a'.repeat(240))"), 12000);
  assert.strictEqual(ev("_toastMs('a'.repeat(5000))"), 12000);
  assert.strictEqual(ev('_toastMs(12345)'), 2500);
  // toast() real usa esa duración
  const getAntes = ctx.document.getElementById, stAntes = ctx.setTimeout;
  const esperas = [];
  ctx.document.getElementById = () => ({ classList: { add() {}, remove() {} }, textContent: '' });
  ctx.setTimeout = (f, ms) => { esperas.push(ms); return 0; };
  try {
    ev("toast('b'.repeat(100))");
    ev("toast('corto')");
  } finally { ctx.document.getElementById = getAntes; ctx.setTimeout = stAntes; }
  assert.deepStrictEqual(esperas, [2500 + 100 * 40, 2500]);
});

// ===== SQL y funcion de IA (bloque R6) =====
test('R6 cliente: aiBuscar envia purpose (factura solo si se pide; el resto es foto)', async () => {
  const fetchAntes = ctx.fetch, abortAntes = ctx.AbortController;
  ctx.AbortController = AbortController; // aiBuscar lo usa para el tiempo maximo
  const peticiones = [];
  ctx.fetch = async (url, op) => { peticiones.push({ url, op, body: JSON.parse(op.body) }); return { ok: true, json: async () => ({ text: 'x' }) }; };
  try {
    await ev('aiBuscar("QUJD", "p", "factura")');
    await ev('aiBuscar("QUJD", "p")');
    await ev('aiBuscar("QUJD", "p", "foto")');
    await ev('aiBuscar("QUJD", "p", "admin")'); // un valor raro nunca se convierte en factura
    assert.deepStrictEqual(peticiones.map(p => p.body.purpose), ['factura', 'foto', 'foto', 'foto']);
    assert.strictEqual(peticiones[0].body.image, 'QUJD');
    assert.strictEqual(peticiones[0].body.prompt, 'p');
    assert.deepStrictEqual(Object.keys(peticiones[0].body).sort(), ['image', 'prompt', 'purpose']);
    assert.ok(String(peticiones[0].url).endsWith('/functions/v1/bright-worker'));
  } finally { ctx.fetch = fetchAntes; if (abortAntes === undefined) delete ctx.AbortController; else ctx.AbortController = abortAntes; }
  // El escaner de facturas pasa 'factura' (todas las demas llamadas son de foto)
  assert.ok(/aiBuscar\(paginas\[k\],\s*_invPrompt\(\),\s*'factura'\)/.test(src), 'el escaner de facturas pide purpose factura');
  assert.strictEqual((src.match(/aiBuscar\(/g) || []).length, 4, 'definicion + 3 llamadas');
});

test('R6 SQL: supabase_endurecimiento.sql es idempotente y no destruye datos', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase_endurecimiento.sql'), 'utf8');
  const codigo = sql.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');
  assert.ok(!/\bDELETE\s+FROM\b|\bDROP\s+(TABLE|SCHEMA|POLICY|COLUMN|CONSTRAINT)\b|\bTRUNCATE\s+(TABLE\s+)?[a-z_."]+\s*;|\bVALIDATE\s+CONSTRAINT\b|\bSET\s+NOT\s+NULL\b/i.test(codigo), 'sin sentencias destructivas');
  assert.ok(!/\bUPDATE\s+public\./i.test(codigo) && !/\bINSERT\s+INTO\b/i.test(codigo), 'no modifica filas');
  // todos los CREATE INDEX llevan IF NOT EXISTS
  const indices = codigo.match(/CREATE\s+(UNIQUE\s+)?INDEX\b[^']*/gi) || [];
  assert.ok(indices.length >= 2 && indices.every(i => /IF\s+NOT\s+EXISTS/i.test(i)), 'indices con IF NOT EXISTS');
  assert.ok(!/CONCURRENTLY/i.test(codigo), 'sin CONCURRENTLY (no vale dentro de una transaccion)');
  // trigger corregido (DB-M2)
  assert.ok(/ELSIF\s*\(auth\.jwt\(\)\s*->>\s*'role'\)\s*=\s*'authenticated'\s*THEN\s*NEW\.usuario\s*:=\s*auth\.jwt\(\)\s*->>\s*'email'/.test(codigo));
  assert.ok(/IF\s+TG_OP\s*=\s*'UPDATE'\s+THEN\s+NEW\.usuario\s*:=\s*OLD\.usuario/.test(codigo));
  // indices (DB-LOW3), permisos (DB-LOW4), RLS (DB-M1), limites (SEC-M1)
  assert.ok(/\(item_id, ts DESC\)/.test(codigo) && /\(ts DESC\)/.test(codigo));
  assert.ok(/REVOKE ALL ON TABLE public\.%I FROM anon/.test(codigo));
  assert.ok(/REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.%I FROM authenticated/.test(codigo));
  assert.ok(/REVOKE EXECUTE ON FUNCTION public\.set_movimiento_usuario\(\) FROM PUBLIC, anon, authenticated/.test(codigo));
  assert.ok(/REVOKE EXECUTE ON FUNCTION public\.es_admin\(\) FROM PUBLIC, anon/.test(codigo) && /GRANT EXECUTE ON FUNCTION public\.es_admin\(\) TO authenticated/.test(codigo));
  assert.ok(/pg_tables WHERE schemaname = 'public' AND NOT rowsecurity/.test(sql));
  assert.ok(/CHECK \(%s\) NOT VALID/.test(codigo));
  // S-M1: el limite de config mide el texto sin comprimir (octet_length), no pg_column_size (que mide el tamano comprimido/TOAST)
  assert.ok(/octet_length\(value::text\) < 200000/.test(codigo) && /length\(photo\) < 1000000/.test(codigo) && /length\(notes\) < 2000/.test(codigo));
  assert.ok(!/pg_column_size/.test(codigo), 'el codigo no usa pg_column_size (solo puede aparecer en comentarios)');
  // S-L2: la fila 51 cuenta tablas, no indices
  assert.ok(/count\(DISTINCT t\.oid\)/.test(codigo), 'fila 51 cuenta tablas distintas');
  // S-L3/L4: filas informativas documentadas
  assert.ok(/fila 10[^\n]*informativ/i.test(sql) && /fila 60[^\n]*3 restricciones/i.test(sql), 'comentarios de las filas 10 y 60');
  // nunca se quitan a authenticated los permisos que la app necesita
  assert.ok(!/REVOKE\s+(ALL|SELECT|INSERT|UPDATE|DELETE)[^;]*FROM[^;]*authenticated/i.test(codigo.replace(/REVOKE ALL ON TABLE public\.%I FROM anon, authenticated/g, '')), 'no quita SELECT/INSERT/UPDATE/DELETE a authenticated en las tablas del almacen');
  assert.ok(/^SELECT orden, comprobacion/m.test(sql), 'termina con la tabla de comprobacion');
});

test('R6 funcion bright-worker: sin claves en el codigo, exige admin para factura y CORS limitado', () => {
  const dir = path.join(__dirname, '..', 'supabase', 'functions', 'bright-worker');
  const f = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  for (const [nombre, s] of [['index.ts', f], ['README.md', readme]]) {
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{20,}|BSA[0-9A-Za-z_-]{20,}|eyJ[0-9A-Za-z_-]{20,}|sb_(publishable|secret)_[0-9A-Za-z_-]{10,}/.test(s), 'sin claves en ' + nombre);
  }
  assert.ok(/Deno\.env\.get\(/.test(f) && /entorno\('GEMINI_API_KEY'\)/.test(f) && /entorno\('BRAVE_API_KEY'\)/.test(f));
  assert.ok(/purpose === 'factura' && !usuario\.admin/.test(f) && /app_metadata\?\.role === 'admin'/.test(f), 'factura exige app_metadata.role admin');
  assert.ok(/\/auth\/v1\/user/.test(f), 'verifica el token con Supabase Auth');
  assert.ok(/mapaspontexsagunto-collab\.github\.io/.test(f) && !/Allow-Origin['"]\s*:\s*['"]\*/.test(f), 'CORS restringido al origen de la app');
  assert.ok(/MAX_IMAGEN = 5_000_000/.test(f) && /MAX_PROMPT = 4000/.test(f) && /maxOutputTokens/.test(f));
  assert.ok(/supabase functions deploy bright-worker/.test(readme));
  for (const n of ['GEMINI_API_KEY', 'BRAVE_API_KEY']) assert.ok(readme.includes(n), n);
});

// Comportamiento real de la funcion (Deno simulado): solo si Node sabe ejecutar TypeScript
const SECRETO_G = 'G-secreto-de-prueba-111', SECRETO_B = 'B-secreto-de-prueba-222';
async function conFuncion(fn, env) {
  const { pathToFileURL } = require('url');
  const entorno = Object.assign({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-de-prueba', GEMINI_API_KEY: SECRETO_G, BRAVE_API_KEY: SECRETO_B }, env || {});
  const denoAntes = globalThis.Deno, fetchAntes = globalThis.fetch;
  globalThis.Deno = { env: { get: n => entorno[n] }, serve() {} };
  const llamadas = [];
  const usuarios = {
    ['n'.repeat(30)]: { id: 'normal-' + Math.random(), app_metadata: {} },
    ['a'.repeat(30)]: { id: 'admin-' + Math.random(), app_metadata: { role: 'admin' } },
    ['o'.repeat(30)]: { id: 'anon-' + Math.random(), app_metadata: {}, is_anonymous: true },
    // rol 'admin' puesto por el propio usuario en user_metadata (editable por el usuario): NO es administrador
    ['u'.repeat(30)]: { id: 'umeta-' + Math.random(), app_metadata: {}, user_metadata: { role: 'admin' } },
  };
  const upstream = { gemini: () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hola' }, { text: ' mundo' }] } }] }), { status: 200 }), brave: null };
  upstream.brave = () => new Response(JSON.stringify({ web: { results: [{ title: '<b>Ficha</b>', url: 'https://a.com/x', description: 'd <i>x</i>', meta_url: { hostname: 'a.com' } }, { title: 'mala', url: 'javascript:alert(1)' }] } }), { status: 200 });
  globalThis.fetch = async (u, op) => {
    u = String(u); llamadas.push({ u, op });
    if (u.endsWith('/auth/v1/user')) { const u2 = usuarios[String(op.headers.Authorization).slice(7)]; return u2 ? new Response(JSON.stringify(u2), { status: 200 }) : new Response('{}', { status: 401 }); }
    if (u.includes('generativelanguage')) return upstream.gemini();
    if (u.includes('api.search.brave.com')) return upstream.brave();
    throw new Error('llamada inesperada ' + u);
  };
  try {
    const { handler } = await import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'bright-worker', 'index.ts')).href);
    const ORIGEN = 'https://mapaspontexsagunto-collab.github.io';
    const pedir = (body, tok, cab) => handler(new Request('https://f.supabase.co/functions/v1/bright-worker', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', origin: ORIGEN }, tok === null ? {} : { authorization: 'Bearer ' + (tok || 'n'.repeat(30)) }, cab || {}), body: typeof body === 'string' ? body : JSON.stringify(body) }));
    await fn({ handler, pedir, llamadas, upstream, ORIGEN, ext: n => llamadas.filter(l => l.u.includes(n)) });
  } finally { globalThis.Deno = denoAntes; globalThis.fetch = fetchAntes; if (denoAntes === undefined) delete globalThis.Deno; }
}
const sinTs = !process.features.typescript;
const IMG = '/9j/4AAQSkZJRg==';

test('R6 funcion: autenticacion, CORS y validacion de la peticion', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ handler, pedir, llamadas, ORIGEN }) => {
    // sin token, token invalido, sesion anonima: 401 y no se llama a Gemini
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' }, null)).status, 401);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' }, 'x'.repeat(30))).status, 401);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' }, 'o'.repeat(30))).status, 401);
    assert.strictEqual(llamadas.filter(l => l.u.includes('generativelanguage')).length, 0);
    // origen no permitido: 403 sin cabecera Allow-Origin; origen de la app: eco del origen
    const mal = await pedir({ image: IMG, prompt: 'p' }, null, { origin: 'https://evil.example' });
    assert.strictEqual(mal.status, 403);
    assert.strictEqual(mal.headers.get('access-control-allow-origin'), null);
    const bien = await pedir({ image: IMG, prompt: 'p' });
    assert.strictEqual(bien.status, 200);
    assert.strictEqual(bien.headers.get('access-control-allow-origin'), ORIGEN);
    assert.deepStrictEqual(await bien.json(), { text: 'hola mundo' });
    // preflight
    const pre = await handler(new Request('https://f/x', { method: 'OPTIONS', headers: { origin: ORIGEN } }));
    assert.strictEqual(pre.status, 204);
    assert.strictEqual(pre.headers.get('access-control-allow-origin'), ORIGEN);
    assert.strictEqual((await handler(new Request('https://f/x', { method: 'GET', headers: { origin: ORIGEN } }))).status, 405);
    // validacion: campos desconocidos, tipos, purpose raro, imagen demasiado grande, formato, JSON roto
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p', extra: 1 })).status, 400);
    assert.strictEqual((await pedir({ image: 5, prompt: 'p' })).status, 400);
    assert.strictEqual((await pedir({ image: IMG })).status, 400);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p', purpose: 'otra' })).status, 400);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p', purpose: ['factura'] })).status, 400);
    assert.strictEqual((await pedir({ image: '/9j/' + 'A'.repeat(5_000_000), prompt: 'p' })).status, 413);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p'.repeat(4001) })).status, 413);
    assert.strictEqual((await pedir({ image: 'AAAA', prompt: 'p' })).status, 415);
    assert.strictEqual((await pedir('{no es json')).status, 400);
    assert.strictEqual((await pedir('[1]')).status, 400);
  });
});

test('R6 funcion: purpose factura exige administrador; maxOutputTokens fijo; la clave solo va en cabecera', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ pedir, ext }) => {
    const r403 = await pedir({ image: IMG, prompt: 'p', purpose: 'factura' }); // usuario normal
    assert.strictEqual(r403.status, 403);
    assert.deepStrictEqual(await r403.json(), { error: 'forbidden' });
    assert.strictEqual(ext('generativelanguage').length, 0, 'no se llama a Gemini');
    const ok = await pedir({ image: IMG, prompt: 'p', purpose: 'factura' }, 'a'.repeat(30)); // administrador
    assert.strictEqual(ok.status, 200);
    const gem = ext('generativelanguage');
    assert.strictEqual(gem.length, 1);
    const cuerpo = JSON.parse(gem[0].op.body);
    assert.strictEqual(cuerpo.generationConfig.maxOutputTokens, 16384);
    assert.ok(/solo datos/.test(cuerpo.systemInstruction.parts[0].text), 'instruccion fija contra instrucciones dentro del documento');
    assert.strictEqual(gem[0].op.headers['x-goog-api-key'], SECRETO_G);
    assert.ok(!gem[0].u.includes(SECRETO_G), 'la clave no va en la URL');
    // foto de un usuario normal: instruccion restringida y tope de salida menor
    await pedir({ image: IMG, prompt: 'p', purpose: 'foto' });
    const foto = JSON.parse(ext('generativelanguage')[1].op.body);
    assert.strictEqual(foto.generationConfig.maxOutputTokens, 1500);
    assert.ok(/factura/.test(foto.systemInstruction.parts[0].text), 'instruccion restringida a componentes');
    assert.strictEqual(foto.contents[0].parts[1].inline_data.mime_type, 'image/jpeg');
    // un administrador sin purpose (app antigua en cache) no queda restringido
    await pedir({ image: IMG, prompt: 'p' }, 'a'.repeat(30));
    const antigua = JSON.parse(ext('generativelanguage')[2].op.body);
    assert.ok(!/responde únicamente \{\}/.test(antigua.systemInstruction.parts[0].text));
  });
});

test('R6 funcion: limite por usuario (429 con Retry-After), busqueda web saneada y errores sin filtrar secretos', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ pedir, ext, upstream }) => {
    // limite de IA: con 2 por hora, la tercera da 429
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 200);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 200);
    const lim = await pedir({ image: IMG, prompt: 'p' });
    assert.strictEqual(lim.status, 429);
    assert.ok(Number(lim.headers.get('retry-after')) >= 1);
    assert.strictEqual(ext('generativelanguage').length, 2, 'la peticion limitada no llega a Gemini');
    // otro usuario no se ve afectado; la busqueda web tiene su propio contador
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' }, 'a'.repeat(30))).status, 200);
    const web = await pedir({ mode: 'web', query: 'siemens 3RT2015', num: 2 });
    assert.strictEqual(web.status, 200);
    assert.deepStrictEqual(await web.json(), { results: [{ title: 'Ficha', link: 'https://a.com/x', display: 'a.com', snippet: 'd x' }] });
    const brave = ext('api.search.brave.com')[0];
    assert.strictEqual(brave.op.headers['X-Subscription-Token'], SECRETO_B);
    assert.ok(!brave.u.includes(SECRETO_B) && brave.u.includes('count=2') && brave.u.includes('q=siemens'));
    // validacion web
    assert.strictEqual((await pedir({ mode: 'web', query: '' })).status, 400);
    assert.strictEqual((await pedir({ mode: 'web', query: 'x'.repeat(201) })).status, 400);
    assert.strictEqual((await pedir({ mode: 'web', query: 'x', num: 99 })).status, 400);
    assert.strictEqual((await pedir({ mode: 'web', query: 'x', foo: 1 })).status, 400);
    assert.strictEqual((await pedir({ mode: 'otro', query: 'x' })).status, 400);
    // fallo del proveedor: 502 generico, sin cuerpo ni claves del proveedor
    upstream.brave = () => new Response('detalle interno con ' + SECRETO_B, { status: 500 });
    const e = await pedir({ mode: 'web', query: 'x' }, 'a'.repeat(30));
    const t = await e.text();
    assert.strictEqual(e.status, 502);
    assert.ok(!t.includes(SECRETO_B) && !t.includes('detalle'));
    upstream.brave = () => new Response('{}', { status: 429 });
    assert.strictEqual((await pedir({ mode: 'web', query: 'x' }, 'a'.repeat(30))).status, 429);
    upstream.gemini = () => { throw Object.assign(new Error('boom ' + SECRETO_G), { name: 'TimeoutError' }); };
    const g = await pedir({ image: IMG, prompt: 'p' }, 'a'.repeat(30));
    assert.strictEqual(g.status, 504);
    assert.ok(!(await g.text()).includes(SECRETO_G));
  }, { RATE_LIMIT_AI_PER_HOUR: '2' });
});

test('R6: SEGURIDAD.md documenta el SQL de endurecimiento y el despliegue de bright-worker', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'SEGURIDAD.md'), 'utf8');
  assert.ok(s.includes('supabase_endurecimiento.sql') && s.includes('supabase functions deploy bright-worker'));
  assert.ok(/mejor esfuerzo/.test(s) && /purpose/.test(s));
  // S-M1: SEGURIDAD.md no promete un limite sobre el tamano almacenado (comprimido) de config
  assert.ok(/octet_length\(value::text\)/.test(s) && !/pg_column_size/.test(s), 'el limite de config se describe sobre el texto sin comprimir');
  assert.ok(!/config < 200000 bytes/.test(s), 'sin la promesa antigua de bytes almacenados');
});

// ===== Revision ECC de SQL y funcion (S-*, F-*) =====
test('R6 ECC F-L7: con REQUIRE_TS_TESTS=1 los tests de la funcion no pueden omitirse en silencio', () => {
  // Sin la variable, en un Node sin TypeScript los tests de la funcion se omiten (skip). Con REQUIRE_TS_TESTS=1, fallan.
  if (process.env.REQUIRE_TS_TESTS !== '1') return;
  assert.ok(process.features.typescript, 'REQUIRE_TS_TESTS=1 pero este Node no ejecuta TypeScript (usa Node 22.18+ o 24)');
});

test('R6 ECC F-M1: Gemini flash sin tokens de razonamiento, respuesta JSON y topes 16384/1500; los modelos -pro no llevan thinkingBudget', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ pedir, ext }) => {
    await pedir({ image: IMG, prompt: 'p', purpose: 'factura' }, 'a'.repeat(30));
    await pedir({ image: IMG, prompt: 'p', purpose: 'foto' });
    const g = ext('generativelanguage');
    const [fac, foto] = g.map(x => JSON.parse(x.op.body).generationConfig);
    assert.deepStrictEqual(fac.thinkingConfig, { thinkingBudget: 0 });
    assert.deepStrictEqual(foto.thinkingConfig, { thinkingBudget: 0 });
    assert.strictEqual(fac.responseMimeType, 'application/json');
    assert.strictEqual(foto.responseMimeType, 'application/json');
    assert.strictEqual(fac.maxOutputTokens, 16384);
    assert.strictEqual(foto.maxOutputTokens, 1500);
    assert.ok(g[0].u.includes('/models/gemini-2.5-flash:generateContent'));
  });
  await conFuncion(async ({ pedir, ext }) => {
    await pedir({ image: IMG, prompt: 'p' });
    const gc = JSON.parse(ext('generativelanguage')[0].op.body).generationConfig;
    assert.strictEqual(gc.thinkingConfig, undefined, 'un modelo -pro no admite thinkingBudget 0');
    assert.strictEqual(gc.responseMimeType, 'application/json');
    assert.ok(ext('generativelanguage')[0].u.includes('/models/gemini-2.5-pro:'));
  }, { GEMINI_MODEL: 'gemini-2.5-pro' });
  await conFuncion(async ({ pedir, ext }) => {
    await pedir({ image: IMG, prompt: 'p' });
    assert.deepStrictEqual(JSON.parse(ext('generativelanguage')[0].op.body).generationConfig.thinkingConfig, { thinkingBudget: 0 });
  }, { GEMINI_MODEL: 'gemini-2.5-flash-lite' });
});

test('R6 ECC F-M2: los 4xx del proveedor (salvo 429) dan 422 upstream_rejected; los fallos transitorios 502/504; el 429 sigue siendo 429', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ pedir, upstream }) => {
    for (const st of [400, 401, 403, 404, 422]) {
      upstream.gemini = () => new Response('detalle interno ' + SECRETO_G, { status: st });
      const r = await pedir({ image: IMG, prompt: 'p' });
      const t = await r.text();
      assert.strictEqual(r.status, 422, 'Gemini ' + st);
      assert.deepStrictEqual(JSON.parse(t), { error: 'upstream_rejected' });
      assert.ok(!t.includes(SECRETO_G));
      upstream.brave = () => new Response('x', { status: st });
      assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 422, 'Brave ' + st);
    }
    for (const st of [500, 502, 503]) {
      upstream.gemini = () => new Response('x', { status: st });
      const r = await pedir({ image: IMG, prompt: 'p' });
      assert.strictEqual(r.status, 502, 'Gemini ' + st);
      assert.deepStrictEqual(await r.json(), { error: 'upstream_error' });
      upstream.brave = () => new Response('x', { status: st });
      assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 502, 'Brave ' + st);
    }
    upstream.gemini = () => new Response('{}', { status: 429 });
    const l = await pedir({ image: IMG, prompt: 'p' });
    assert.strictEqual(l.status, 429);
    assert.strictEqual(l.headers.get('retry-after'), '60');
    upstream.gemini = () => { throw new TypeError('fetch failed'); };
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 502, 'fallo de red: 502');
    upstream.gemini = () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 504);
    upstream.gemini = () => { throw Object.assign(new Error('a'), { name: 'AbortError' }); };
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 504);
  }, { RATE_LIMIT_AI_PER_HOUR: '100', RATE_LIMIT_WEB_PER_HOUR: '100', RATE_LIMIT_WEB_PER_DAY: '100' });
  // el cliente no reintenta el 422 (ver el test del cliente) y el codigo lo documenta
  const f = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'bright-worker', 'index.ts'), 'utf8');
  assert.ok(/upstream_rejected/.test(f));
});

test('R6 ECC F-M2: el hueco de limite se devuelve cuando falla el proveedor (502, 504, 422, 429) y se gasta cuando va bien', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ pedir, upstream }) => {
    const bienG = upstream.gemini, bienB = upstream.brave;
    const fallos = [() => new Response('x', { status: 500 }), () => new Response('x', { status: 400 }), () => new Response('x', { status: 429 }),
      () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }];
    const esperados = [502, 422, 429, 504];
    // muchos mas fallos que el limite (2): ninguno llega a dar 429 propio por culpa de los fallos
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      for (let i = 0; i < fallos.length; i++) {
        upstream.gemini = fallos[i];
        upstream.brave = fallos[i];
        assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, esperados[i], 'IA fallo ' + i + ' vuelta ' + vuelta);
        assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, esperados[i], 'web fallo ' + i + ' vuelta ' + vuelta);
      }
    }
    // y despues siguen quedando los 2 huecos completos
    upstream.gemini = bienG; upstream.brave = bienB;
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 200);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 200);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 429);
    assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200);
    assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200);
    assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 429);
  }, { RATE_LIMIT_AI_PER_HOUR: '2', RATE_LIMIT_WEB_PER_HOUR: '2', RATE_LIMIT_WEB_PER_DAY: '2' });
});

test('R6 ECC F-M3: limites por defecto de Brave (20/hora, 40/dia) y ventana diaria propia', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  // por hora, por defecto 20
  await conFuncion(async ({ pedir }) => {
    for (let i = 0; i < 20; i++) assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200, 'busqueda ' + i);
    const r = await pedir({ mode: 'web', query: 'x' });
    assert.strictEqual(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) >= 1 && Number(r.headers.get('retry-after')) <= 3600);
  });
  // por dia, por defecto 40 (con el limite por hora muy alto para aislar el diario)
  await conFuncion(async ({ pedir }) => {
    for (let i = 0; i < 40; i++) assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200, 'busqueda ' + i);
    const r = await pedir({ mode: 'web', query: 'x' });
    assert.strictEqual(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 3600, 'el aviso del limite diario es de horas, no de minutos');
  }, { RATE_LIMIT_WEB_PER_HOUR: '1000' });
  // la ventana diaria sobrevive a la horaria (hora 2, dia 3)
  await conFuncion(async ({ pedir }) => {
    const dn = Date.now, t0 = dn.call(Date);
    let t = t0; Date.now = () => t;
    try {
      assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200);
      assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200);
      assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 429, 'limite horario');
      t = t0 + 61 * 60 * 1000; // pasada la hora
      assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200, 'tercera del dia');
      const dia = await pedir({ mode: 'web', query: 'x' });
      assert.strictEqual(dia.status, 429, 'limite diario aunque la hora ya este libre');
      assert.ok(Number(dia.headers.get('retry-after')) > 3600);
      t = t0 + 25 * 60 * 60 * 1000; // pasado el dia
      assert.strictEqual((await pedir({ mode: 'web', query: 'x' })).status, 200);
    } finally { Date.now = dn; }
  }, { RATE_LIMIT_WEB_PER_HOUR: '2', RATE_LIMIT_WEB_PER_DAY: '3' });
});

test('R6 ECC F-M3: prompt acotado para quien no es administrador (foto) y holgura sobre los prompts reales del cliente', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  const f = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'bright-worker', 'index.ts'), 'utf8');
  const mx = /MAX_PROMPT_FOTO = (\d[\d_]*)/.exec(f);
  assert.ok(mx, 'existe MAX_PROMPT_FOTO');
  const MAX_FOTO = Number(mx[1].replace(/_/g, ''));
  // Los prompts de foto reales de shared/app.js (con 40 categorias de 15 caracteres) deben caber con un 30 % de holgura
  const plantillas = [...src.matchAll(/const prompt=`([\s\S]*?)`;/g)].map(m => m[1].replace(/\r\n/g, '\n'));
  assert.strictEqual(plantillas.length, 2, 'los dos prompts de foto del cliente');
  for (const p of plantillas) {
    const real = new Function('expertoEn', 'cats', 'return `' + p + '`')('material mecánico industrial', Array(40).fill('Categoria-12345')).length;
    assert.ok(real * 1.3 <= MAX_FOTO, 'prompt real de ' + real + ' caracteres con un 30 % de holgura cabe en ' + MAX_FOTO);
  }
  assert.ok(MAX_FOTO <= 2500, 'el tope sigue siendo corto (no un prompt libre)');
  await conFuncion(async ({ pedir, ext }) => {
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p'.repeat(MAX_FOTO) })).status, 200);
    const r = await pedir({ image: IMG, prompt: 'p'.repeat(MAX_FOTO + 1) });
    assert.strictEqual(r.status, 413);
    assert.deepStrictEqual(await r.json(), { error: 'payload_too_large' });
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p'.repeat(MAX_FOTO + 1), purpose: 'foto' })).status, 413);
    const antes = ext('generativelanguage').length;
    // el administrador conserva los 4000 de la factura (y un administrador con foto tambien)
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p'.repeat(4000), purpose: 'factura' }, 'a'.repeat(30))).status, 200);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p'.repeat(4000), purpose: 'foto' }, 'a'.repeat(30))).status, 200);
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p'.repeat(4001), purpose: 'factura' }, 'a'.repeat(30))).status, 413);
    assert.strictEqual(ext('generativelanguage').length, antes + 2);
    // la instruccion fija sigue ahi para el usuario normal
    const ult = JSON.parse(ext('generativelanguage')[0].op.body);
    assert.ok(/responde únicamente \{\}/.test(ult.systemInstruction.parts[0].text));
  }, { RATE_LIMIT_AI_PER_HOUR: '100' });
});

test('R6 ECC F-M4: cuerpo sin Content-Length (chunked) se corta con 413 al pasar el maximo en BYTES; Content-Length no numerico => 400', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ handler, pedir, ORIGEN }) => {
    const peticion = (cuerpo, extra) => new Request('https://f.supabase.co/functions/v1/bright-worker', { method: 'POST', duplex: 'half', body: cuerpo,
      headers: Object.assign({ 'content-type': 'application/json', origin: ORIGEN, authorization: 'Bearer ' + 'n'.repeat(30) }, extra || {}) });
    // 1) enorme y sin Content-Length: se aborta pronto (no se lee todo)
    const trozo = new Uint8Array(1_000_000).fill(97);
    let leidos = 0;
    const flujo = new ReadableStream({ pull(c) { if (leidos >= 60) { c.close(); return; } leidos++; c.enqueue(trozo); } });
    const req = peticion(flujo);
    assert.strictEqual(req.headers.get('content-length'), null, 'sin Content-Length');
    const r = await handler(req);
    assert.strictEqual(r.status, 413);
    assert.deepStrictEqual(await r.json(), { error: 'payload_too_large' });
    assert.ok(leidos < 20, 'se dejo de leer pronto (' + leidos + ' trozos de 60)');
    // 2) se cuentan BYTES, no caracteres: 1.800.000 euros = 5,4 MB en 1,8 M de caracteres
    const enc = new TextEncoder();
    const bytes = enc.encode('{"a":"' + '€'.repeat(1_800_000) + '"}');
    assert.ok(bytes.length > 5_100_000 && bytes.length / 3 < 1_800_100);
    const flujo2 = new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.slice(i, i + 65536)); c.close(); } });
    assert.strictEqual((await handler(peticion(flujo2))).status, 413, 'por bytes');
    // 3) un cuerpo normal por flujo (sin Content-Length) sigue funcionando, tambien con caracteres de varios bytes
    const normal = enc.encode(JSON.stringify({ image: IMG, prompt: 'Resistencia de 10 kΩ — ñandú €' }));
    const flujo3 = new ReadableStream({ start(c) { c.enqueue(normal.slice(0, 7)); c.enqueue(normal.slice(7)); c.close(); } });
    const ok = await handler(peticion(flujo3));
    assert.strictEqual(ok.status, 200);
    // 4) Content-Length no numerico, negativo o con basura: 400; declarado enorme: 413
    for (const cl of ['abc', '-1', '12abc', '1e3', '']) {
      const x = await pedir({ image: IMG, prompt: 'p' }, null, { 'content-length': cl, authorization: 'Bearer ' + 'n'.repeat(30) });
      if (cl === '') continue; // cabecera vacia: el entorno la puede descartar
      assert.strictEqual(x.status, 400, 'content-length ' + JSON.stringify(cl));
    }
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' }, null, { 'content-length': '99999999', authorization: 'Bearer ' + 'n'.repeat(30) })).status, 413);
    // sin cuerpo: JSON vacio => 400
    assert.strictEqual((await handler(peticion(null))).status, 400);
  });
});

test('R6 ECC F-L1/F-L2: la imagen se valida por bytes reales (JPEG/PNG/WEBP), base64 estandar y longitud multiplo de 4; tope 5 M', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  const b64 = a => Buffer.from(a).toString('base64');
  const jpg = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const png = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const webp = b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP')]));
  assert.ok(jpg.length === 16 && png.length === 16 && webp.length === 16);
  await conFuncion(async ({ pedir, ext }) => {
    for (const [im, mime] of [[jpg, 'image/jpeg'], [png, 'image/png'], [webp, 'image/webp'], [IMG, 'image/jpeg']]) {
      assert.strictEqual((await pedir({ image: im, prompt: 'p' })).status, 200, mime);
      const g = ext('generativelanguage'); const c = JSON.parse(g[g.length - 1].op.body);
      assert.strictEqual(c.contents[0].parts[1].inline_data.mime_type, mime);
    }
    const llamadas = ext('generativelanguage').length;
    const malas = {
      'RIFF pero WAVE': b64(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVE')])),
      'PNG con firma rota': b64([0x89, 0x50, 0x4e, 0x48, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]),
      'JPEG con firma rota': b64([0xff, 0xd8, 0x00, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]),
      'GIF': b64(Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00')),
      'base64url (_ en vez de /)': jpg.replace('/', '_'),
      'base64url (- en vez de +)': b64([0xff, 0xd8, 0xff, 0xfb, 0xff, 0xfe, 0xfb, 0xef, 0xbe, 0xff, 0, 1]).replace(/\+/g, '-').replace(/\//g, '_'),
      'longitud no multiplo de 4': jpg.slice(0, 14),
      'longitud 17': jpg + '=',
      'padding de mas': jpg.slice(0, 12) + '====',
      'con espacios': jpg.slice(0, 8) + ' ' + jpg.slice(9),
      'solo prefijo falso': '/9j/AAAA'.slice(0, 7),
    };
    for (const [n, im] of Object.entries(malas)) {
      const r = await pedir({ image: im, prompt: 'p' });
      assert.strictEqual(r.status, 415, n);
      assert.deepStrictEqual(await r.json(), { error: 'unsupported_image' });
    }
    assert.strictEqual(ext('generativelanguage').length, llamadas, 'nada de eso llega a Gemini');
    // F-L2: una imagen de 3 M de caracteres (antes 413) ya pasa; por encima de 5 M, 413
    const grande = '/9j/' + 'A'.repeat(3_000_000 - 4);
    assert.strictEqual(grande.length % 4, 0);
    assert.strictEqual((await pedir({ image: grande, prompt: 'p' })).status, 200);
    assert.strictEqual((await pedir({ image: '/9j/' + 'A'.repeat(5_000_000 - 3), prompt: 'p' })).status, 413);
  }, { RATE_LIMIT_AI_PER_HOUR: '1000' });
});

test('R6 ECC F-L7: user_metadata.role admin NO es administrador; admin con foto sin restriccion; purpose exacto; Retry-After', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ pedir, ext }) => {
    const u = await pedir({ image: IMG, prompt: 'p', purpose: 'factura' }, 'u'.repeat(30));
    assert.strictEqual(u.status, 403, 'user_metadata no da permisos');
    assert.strictEqual(ext('generativelanguage').length, 0);
    // y con 'foto' queda restringido como cualquier usuario normal
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p', purpose: 'foto' }, 'u'.repeat(30))).status, 200);
    assert.ok(/responde únicamente \{\}/.test(JSON.parse(ext('generativelanguage')[0].op.body).systemInstruction.parts[0].text));
    // administrador con purpose foto: instruccion SIN restriccion de componentes (es el diseno: el rol manda)
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p', purpose: 'foto' }, 'a'.repeat(30))).status, 200);
    const adm = JSON.parse(ext('generativelanguage')[1].op.body);
    assert.ok(!/responde únicamente \{\}/.test(adm.systemInstruction.parts[0].text));
    assert.ok(/solo datos/.test(adm.systemInstruction.parts[0].text));
    assert.strictEqual(adm.generationConfig.maxOutputTokens, 1500, 'el tope depende del purpose, no del rol');
    // purpose exacto: otras mayusculas, espacios, vacio o nulo => 400
    for (const p of ['Factura', 'factura ', ' factura', 'FOTO', '', null, 1, {}]) {
      assert.strictEqual((await pedir({ image: IMG, prompt: 'p', purpose: p }, 'a'.repeat(30))).status, 400, 'purpose ' + JSON.stringify(p));
    }
    assert.strictEqual(ext('generativelanguage').length, 2);
  });
  await conFuncion(async ({ pedir }) => {
    assert.strictEqual((await pedir({ image: IMG, prompt: 'p' })).status, 200);
    const r = await pedir({ image: IMG, prompt: 'p' });
    assert.strictEqual(r.status, 429);
    const ra = r.headers.get('retry-after');
    assert.ok(/^\d+$/.test(ra), 'Retry-After en segundos enteros');
    assert.ok(Number(ra) >= 3590 && Number(ra) <= 3600, 'casi una hora: ' + ra);
  }, { RATE_LIMIT_AI_PER_HOUR: '1' });
});

test('R6 ECC F-L4: sinHtml quita etiquetas y luego decodifica las entidades basicas (sin doble decodificacion)', { skip: sinTs && 'Node sin soporte de TypeScript' }, async () => {
  await conFuncion(async ({ pedir, upstream }) => {
    upstream.brave = () => new Response(JSON.stringify({ web: { results: [
      { title: '<b>Tom &amp; Jerry</b> &lt;x&gt; &quot;q&quot; &#39;a&#39; &#x27;b&#x27;', url: 'https://a.com/1', description: '&amp;lt;b&amp;gt; <i>ok</i>' },
      { title: 'x'.repeat(250), url: 'https://a.com/2', description: 'd' },
    ] } }), { status: 200 });
    const d = await (await pedir({ mode: 'web', query: 'x' })).json();
    assert.strictEqual(d.results[0].title, 'Tom & Jerry <x> "q" \'a\' \'b\'');
    assert.strictEqual(d.results[0].snippet, '&lt;b&gt; ok', 'un &amp;lt; queda como &lt; (no se decodifica dos veces)');
    assert.strictEqual(d.results[1].title.length, 200);
  });
});

test('R6 ECC: documentacion de la funcion (README) y del SQL actualizada', () => {
  const dir = path.join(__dirname, '..', 'supabase', 'functions', 'bright-worker');
  const r = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  assert.ok(/RATE_LIMIT_WEB_PER_DAY/.test(r) && /\b40\b/.test(r) && /\b20\b/.test(r), 'limites de Brave documentados');
  assert.ok(/Allow new users to sign up/.test(r), 'recordatorio de desactivar los registros');
  assert.ok(/GEMINI_MODEL/.test(r) && /thinkingBudget/.test(r) && /confirma/i.test(r), 'el modelo debe confirmarse contra el desplegado');
  assert.ok(/422/.test(r) && /upstream_rejected/.test(r) && /5\s*M|5\.000\.000|5 000 000/.test(r), 'codigos y limite de imagen');
  assert.ok(/REQUIRE_TS_TESTS/.test(r) || /REQUIRE_TS_TESTS/.test(fs.readFileSync(path.join(__dirname, '..', 'SEGURIDAD.md'), 'utf8')), 'REQUIRE_TS_TESTS documentado');
});

test('R6 ECC S-L1: el campo Notas del formulario tiene maxlength 1999 en los dos almacenes y cleanItem recorta a 1999', () => {
  for (const w of ['almacen-electrico', 'almacen-mecanico']) {
    const h = fs.readFileSync(path.join(__dirname, '..', w, 'index.html'), 'utf8');
    assert.ok(/<input[^>]*id="f-notes"[^>]*maxlength="1999"/.test(h), 'maxlength en ' + w);
  }
  const larga = ev('cleanItem({id:"I1",notes:"x".repeat(2500)})');
  assert.strictEqual(larga.notes.length, 1999);
  assert.strictEqual(ev('cleanItem({id:"I1",notes:"x".repeat(1999)})').notes.length, 1999, 'justo en el limite no se toca');
  assert.strictEqual(ev('cleanItem({id:"I1",notes:"corta"})').notes, 'corta');
  // no se parte un caracter doble (emoji): quedaria un sustituto suelto que la base de datos rechaza
  const emoji = ev('cleanItem({id:"I1",notes:"x".repeat(1998)+"\\ud83d\\ude00"+"y".repeat(10)})').notes;
  assert.strictEqual(emoji.length, 1998);
  assert.ok(!/[\ud800-\udbff]$/.test(emoji));
  assert.strictEqual(ev('cleanItem({id:"I1",notes:null})').notes, null);
});

test('R6 ECC F-L2/F-L3: mensajes del cliente por estado HTTP, tiempo de 70 s y el 422 no se reintenta', async () => {
  const msg = s => ev('aiErrorMsg({status:' + s + '})');
  assert.ok(/imagen es demasiado grande/i.test(msg(413)));
  assert.ok(/formato de imagen no admitido/i.test(msg(415)));
  assert.ok(/rechaz[oó] la imagen/i.test(msg(422)));
  assert.ok(/sesi[oó]n ha caducado, vuelve a entrar/i.test(msg(401)));
  assert.ok(/solo para administradores/i.test(msg(403)));
  for (const s of [413, 415, 422, 401, 403]) assert.ok(!/dentro de Claude/.test(msg(s)), 'sin el mensaje de Claude para ' + s);
  assert.ok(/saturado/.test(msg(502)) && /muchas peticiones/.test(msg(429)), 'los mensajes existentes siguen igual');
  assert.ok(/dentro de Claude/.test(msg(418)), 'el mensaje generico se conserva para el resto');
  assert.ok(/Sin conexi/.test(ev('aiErrorMsg({kind:"red"})')));

  const fetchAntes = ctx.fetch, abortAntes = ctx.AbortController, stAntes = ctx.setTimeout;
  ctx.AbortController = AbortController;
  const esperas = [];
  ctx.setTimeout = (f, ms) => { esperas.push(ms); if (ms < 10000) f(); return 0; }; // las pausas entre reintentos se ejecutan al momento
  try {
    let n = 0;
    ctx.fetch = async () => { n++; return { ok: true, json: async () => ({ text: 'x' }) }; };
    await ev('aiBuscar("QUJD", "p")');
    assert.ok(esperas.includes(70000) && !esperas.includes(60000), 'tiempo del cliente 70 s (la funcion corta a los 50 s)');
    for (const [st, veces] of [[422, 1], [413, 1], [415, 1], [401, 1], [403, 1], [429, 1], [502, 3], [504, 3]]) {
      n = 0;
      ctx.fetch = async () => { n++; return { ok: false, status: st, json: async () => ({}) }; };
      let err = null;
      try { await ev('aiBuscar("QUJD", "p")'); } catch (e) { err = e; }
      assert.ok(err && err.status === st, 'estado ' + st);
      assert.strictEqual(n, veces, 'intentos con ' + st);
    }
    // braveSearch: el 422 tampoco se reintenta
    n = 0;
    ctx.fetch = async () => { n++; return { ok: false, status: 422, json: async () => ({}) }; };
    const r = await ev('braveSearch("x", 4)');
    assert.strictEqual(n, 1);
    assert.strictEqual(r.status, 422);
  } finally { ctx.fetch = fetchAntes; ctx.setTimeout = stAntes; if (abortAntes === undefined) delete ctx.AbortController; else ctx.AbortController = abortAntes; }
});
