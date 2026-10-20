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
vm.runInContext(src + '\n;globalThis.__t={isSafeId,safePhoto,safeUrl,cleanItem,cleanItems,cleanShelves,cleanAisles,strArr,jsq,esc,cleanText,sessionValid};', ctx);
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

test('no quedan contraseñas por defecto en el código', () => {
  const ficheros = ['shared/app.js', 'almacen-electrico/config.js', 'almacen-mecanico/config.js', 'supabase_setup.sql'];
  for (const f of ficheros) {
    const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/Mapamsi01|'Electrico'|'Mecanico'|fallbackPass/.test(s), f);
  }
});
