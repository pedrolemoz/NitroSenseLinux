const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { readAsar } = require('../lib/asar.cjs');
const { AcerClient } = require('../lib/acer-client.cjs');
const { startAcerServices } = require('../lib/acer-service.cjs');
const { RENDERER_FILE } = require('./renderer-patches.cjs');
const { startReadOnlySession } = require('./readonly-session.cjs');
const { prepareRendererOverlay, createFsFacade } = require('./asset-overrides.cjs');
const archive = path.join(__dirname, '../../vendor/nitrosense-5.2.84-official/resources/app.asar');
const available = fs.existsSync(archive);
let source;
function fixture(t) {
  source ||= readAsar(fs.readFileSync(archive)).read(RENDERER_FILE).toString();
  const root = fs.mkdtempSync(path.join(__dirname, '.readonly-session-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vendorRoot = path.join(root, 'vendor'), stateDir = path.join(root, 'state');
  const originalPath = path.join(vendorRoot, 'resources/app.asar', RENDERER_FILE);
  const fsImpl = { ...fs, readFileSync(file, options) { return file === originalPath ? source : fs.readFileSync(file, options); } };
  return { root, vendorRoot, stateDir, originalPath, fsImpl };
}

test('renderer overlay serves matching stat/read/stream/range/promises bytes and leaves original source untouched', { skip: !available }, async t => {
  const f = fixture(t), overlay = prepareRendererOverlay(f);
  const virtual = createFsFacade(fs, overlay.mapPath);
  const bytes = virtual.readFileSync(f.originalPath);
  assert.equal(virtual.statSync(f.originalPath).size, bytes.length);
  assert.equal((await virtual.promises.stat(f.originalPath)).size, bytes.length);
  assert.deepEqual(await virtual.promises.readFile(f.originalPath), bytes);
  const chunks = [], stream = virtual.createReadStream(f.originalPath, { start: 3, end: 120 });
  stream.on('data', chunk => chunks.push(chunk)); await once(stream, 'end');
  assert.deepEqual(Buffer.concat(chunks), bytes.subarray(3, 121));
  assert.notEqual(bytes.toString(), source);
  assert.equal(f.fsImpl.readFileSync(f.originalPath, 'utf8'), source);
  assert.equal(overlay.mapPath(f.originalPath + '.map'), f.originalPath + '.map');
});

test('read-only session exposes live fixture data, records availability and closes both service ports', { skip: !available }, async t => {
  const f = fixture(t); let closedAdapters = 0, closedProvider = 0, fail = false;
  const session = await startReadOnlySession({ ...f, ports: { main: 0, monitor: 0 }, closeAdapters: () => closedAdapters++, monitor: { sample() {
    return { collectedAt: 'fixture', data: fail ? {} : { RAM_USAGE: 15 }, sources: fail ? {} : { RAM_USAGE: '/proc/meminfo (fixture)' }, readOnly: true, cpuInfo: [], errors: [] };
  }, close() { closedProvider++; } } });
  t.after(() => session.close());
  const client = new AcerClient({ port: session.addresses.main.port }); t.after(() => client.close());
  assert.deepEqual(await client.request(10, {}), { RAM_USAGE: 15 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.stateDir, 'backend-status.json'), 'utf8')).fields, ['RAM_USAGE']);
  const diagnostic = JSON.parse(fs.readFileSync(path.join(f.stateDir, 'backend-status.json'), 'utf8'));
  assert.equal(diagnostic.sampleCount, 1);
  assert.equal(diagnostic.readOnly, true);
  assert.equal(diagnostic.readings.RAM_USAGE, 15);
  assert.equal(diagnostic.sources.RAM_USAGE, '/proc/meminfo (fixture)');
  await client.request(10, {});
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.stateDir, 'backend-status.json'), 'utf8')).sampleCount, 1);
  fail = true; await assert.rejects(client.request(10, {}), { code: 'ERR_NITROSENSE_SERVICE' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.stateDir, 'backend-status.json'), 'utf8')).fields, []);
  const disconnected = once(client, 'disconnected'); await session.close(); await disconnected;
  await session.close(); assert.equal(closedAdapters, 1); assert.equal(closedProvider, 1);
});

test('read-only session rejects a conflicting service without disturbing it', { skip: !available }, async t => {
  const f = fixture(t); let closedProvider = 0;
  const existing = await startAcerServices({ ports: { main: 0 }, handler: async ({ payload }) => ({ request: payload.Function, result: '0', data: 'existing' }) });
  t.after(() => existing.close());
  await assert.rejects(startReadOnlySession({ ...f, ports: { main: 0, monitor: existing.addresses.main.port }, monitor: { sample() { throw new Error('Must not sample'); }, close() { closedProvider++; } } }), { code: 'EADDRINUSE' });
  assert.equal(closedProvider, 1);
  const client = new AcerClient({ port: existing.addresses.main.port }); t.after(() => client.close());
  assert.equal(await client.request(0, { Function: 'VERSION' }), 'existing');
});
