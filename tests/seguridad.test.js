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
const NOMBRES_R1 = 'registrarMovimiento,dbPut,dbDelete,dbGetAll,cfgPut,cloudCfgPut,closeModal,openModal,renderAll,renderItems,renderMap,refreshVisiblePage,updateOrganizeBanner,toast,syncFromCloud,_pushToCloud,_invoiceAfterSave,updateSyncBadge';
async function conNube(opciones, fn) {
  const orig = vm.runInContext('({' + NOMBRES_R1.split(',').map(n => n + ':' + n).join(',') + ',sb:sb,WH:WH,items:items,cur:currentItem,pd:pendingDelta,di:dirtyIds,ok:cloudOK,ed:editingId,sbusy:_stockBusy})', ctx);
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
      dirtyIds=new Set();pendingDelta=0;currentItem=null;cloudOK=true;_stockBusy=false;
      sb={from:()=>({
        select:()=>({limit:async()=>({error:null}),eq:()=>({maybeSingle:async()=>__stock()})}),
        update:f=>({eq:(c,id)=>({select:async()=>{__calls.push(['update',f,id]);return __upd();}})}),
        upsert:async o=>{__calls.push(['upsert',o]);return {error:null};}
      })};
    `, ctx);
    await fn();
  } finally {
    ctx.document.getElementById = getAntes;
    ctx.__o = orig;
    vm.runInContext(NOMBRES_R1.split(',').map(n => n + '=__o.' + n).join(';') + ';sb=__o.sb;WH=__o.WH;items=__o.items;currentItem=__o.cur;pendingDelta=__o.pd;dirtyIds=__o.di;cloudOK=__o.ok;editingId=__o.ed;_stockBusy=__o.sbusy;', ctx);
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
    // error de red: false y queda en la cola de pendientes
    ev("__upd=()=>({data:null,error:{message:'red'}})");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), false);
    assert.strictEqual(ev("dirtyIds.has('I1')"), true);
    // artículo ya pendiente de subir (alta/cambio local): se sube entero como siempre (sin foto que no toque)
    ev("__calls=[];__upd=()=>({data:[{id:'I1'}],error:null})");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), true);
    const c = JSON.parse(ev("JSON.stringify(__calls)"));
    assert.strictEqual(c.length, 1);
    assert.strictEqual(c[0][0], 'upsert');
    assert.strictEqual(ev("dirtyIds.has('I1')"), false, 'el volcado entero limpia la cola');
    // sin nube: cola
    ev("sb=null;dirtyIds=new Set()");
    assert.strictEqual(await ev("cloudUpdateFields('I1',{stock:1})"), false);
    assert.strictEqual(ev("dirtyIds.has('I1')"), true);
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
    // el movimiento va bien pero falla guardar en el móvil: aviso y el artículo queda en la cola
    ev("registrarMovimiento=async(it,a,n,t)=>{__movs.push([a,n,t]);};dbPut=async()=>{throw new Error('cuota')};__toasts=[];__movs=[];pendingDelta=-1");
    await ev('confirmPending()');
    assert.strictEqual(ev('__movs.length'), 1);
    assert.ok(ev('__toasts').some(m => m.includes('no se pudo guardar en el móvil')));
    // y si falla la subida: aviso y cola
    ev("dbPut=async()=>{};dirtyIds=new Set();__upd=()=>({data:null,error:{message:'red'}});__toasts=[];pendingDelta=-1");
    await ev('confirmPending()');
    assert.strictEqual(ev("dirtyIds.has('I1')"), true);
    assert.ok(ev('__toasts').some(m => m.includes('no se pudo subir')));
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
    assert.strictEqual(ev("dirtyIds.has('I3')"), true, 'el fallo de red queda en la cola');
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
    assert.strictEqual(ev("dirtyIds.has('I1')"), true);
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
    ev("items=[{id:'I1'},{id:'I2'},{id:'I3'}];__sync=0;__push=0;__ordenOK=false;_stockBusy=false;_syncing=false;");
    ev("syncFromCloud=async()=>{__sync++;cloudOK=true;};_pushToCloud=async()=>{__push++;__busyDuring=_stockBusy;};");
    assert.ok(ev('pushToCloud.toString()').includes('ensureOnline'), 'sigue protegida sin conexión');
    await ev('pushToCloud()');
    assert.strictEqual(ev('__sync'), 1, 'sincroniza antes');
    assert.strictEqual(ev('__push'), 0, 'no sube nada hasta confirmar');
    assert.ok(ev('__opened').includes('modal-confirm'));
    assert.ok(ev("document.getElementById('confirm-msg').textContent").includes('3 artículos'));
    // confirmar: sube con el bloqueo puesto y lo libera al acabar
    await ev("document.getElementById('confirm-ok').onclick()");
    assert.strictEqual(ev('__push'), 1);
    assert.strictEqual(ev('__busyDuring'), true);
    assert.strictEqual(ev('_stockBusy'), false);
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
    // cancelar (no pulsar confirmar) no sube nada
    assert.strictEqual(ev('__push'), 1);
  });
});
