const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createFsFacade } = require('./asset-overrides.cjs');
const { modeBannerSource } = require('./mode-banner.cjs');

async function runBootstrap(mode, { sessionError = null } = {}) {
  const root = path.resolve('fixture-vendor'), state = path.resolve('fixture-state');
  const entry = path.join(root, 'resources/app.asar/main.js');
  const app = new EventEmitter(), calls = [], written = new Map();
  Object.assign(app, { commandLine: { appendSwitch: flag => calls.push(['switch', flag]) }, setName: name => calls.push(['name', name]), setPath() {}, getPath: () => 'fixture', exit: code => calls.push(['exit', code]) });
  const platform = { native: { getRegistryValue: () => 'stored-preference' }, powershell: { legacy: {} } };
  const session = { renderer: { patches: ['renderer-patched'] }, mapPath: file => file, close: async () => calls.push(['close']) };
  const io = { mkdirSync() {}, cpSync() {}, writeFileSync: (file, value) => written.set(file, value), readFileSync: () => 'fixture original source', promises: {} };
  const Module = { _load() {}, _extensions: { '.js': () => {} } };
  const dependencies = {
    'node:fs': io, 'node:path': path, 'node:module': Module, electron: { app },
    '../lib/vendor.cjs': { verifyVendor: () => ({ root, manifest: { version: '5.1.392', asarSha256: 'fixture' } }) },
    './platform.cjs': { createPlatform: () => platform, unsupported: () => new Error('unavailable') },
    './source-patches.cjs': { transformSource: (_src, _oem, _preload, options) => { calls.push(['transform', options]); return { source: 'prepared', patches: [] }; } },
    './renderer-modules.cjs': { rendererPreloadSource: () => 'fixture preload' },
    './readonly-session.cjs': { startReadOnlySession: async () => { calls.push(['service']); if (sessionError) throw sessionError; return session; } },
    './asset-overrides.cjs': { createFsFacade }, './mode-banner.cjs': { modeBannerSource },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'bootstrap.cjs'), 'utf8'), {
    require(name) {
      if (name === entry) { calls.push(['entry']); Module._extensions['.js']({ _compile: () => calls.push(['compile']) }, entry); return; }
      assert.ok(name in dependencies, name); return dependencies[name];
    },
    process: { platform: 'linux', versions: { electron: '26.6.10' }, argv: ['electron', 'runtime', ...mode, '--vendor', root], env: { NITROSENSE_STATE_DIR: state }, getuid: () => 1000 },
    console: { error: (...args) => calls.push(['error', ...args]) },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, calls, written, platform, state };
}
test('bootstrap connects explicit read-only mode before loading Acer, disables simulator and stops only on actual quit', async () => {
  const run = await runBootstrap(['--read-only']);
  assert.ok(run.calls.findIndex(c => c[0] === 'switch' && c[1] === 'no-sandbox') < run.calls.findIndex(c => c[0] === 'service'));
  assert.ok(run.calls.findIndex(c => c[0] === 'switch' && c[1] === 'ignore-certificate-errors') < run.calls.findIndex(c => c[0] === 'service'));
  assert.ok(run.calls.findIndex(c => c[0] === 'service') < run.calls.findIndex(c => c[0] === 'entry'), JSON.stringify(run.calls));
  assert.equal(run.calls.find(c => c[0] === 'transform')[1].readOnly, true);
  assert.equal(run.platform.native.getRegistryValue(1, 'software\\acer\\xsense', 'SimulatorMode'), '0');
  assert.equal(JSON.parse(run.written.get(path.join(run.state, 'applied-patches.json'))).mode, 'read-only');
  assert.equal(JSON.parse(run.written.get(path.join(run.state, 'applied-patches.json'))).simulatorMode, '0');
  assert.equal(JSON.parse(run.written.get(path.join(run.state, 'applied-patches.json'))).hostPlatform, 'linux');
  run.app.emit('before-quit'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.calls.some(c => c[0] === 'close'), false);
  run.app.emit('will-quit'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(run.calls.some(c => c[0] === 'close'), true);
});
test('existing ui-only mode keeps the simulator and never starts the Linux service', async () => {
  const run = await runBootstrap(['--ui-only']);
  assert.equal(run.calls.some(c => c[0] === 'service'), false);
  assert.equal(run.platform.native.getRegistryValue(1, 'software\\acer\\xsense', 'SimulatorMode'), '1');
  assert.equal(run.calls.find(c => c[0] === 'transform')[1].readOnly, false);
});
test('bootstrap refuses ambiguous modes and prevents Acer startup after a service bind failure', async () => {
  const ambiguous = await runBootstrap(['--ui-only', '--read-only']);
  assert.equal(ambiguous.calls.some(c => c[0] === 'entry'), false);
  assert.ok(ambiguous.calls.some(c => c[0] === 'exit' && c[1] === 1));
  const failed = await runBootstrap(['--read-only'], { sessionError: Object.assign(new Error('Port occupied'), { code: 'EADDRINUSE' }) });
  assert.equal(failed.calls.some(c => c[0] === 'entry'), false);
  assert.ok(failed.calls.some(c => c[0] === 'exit' && c[1] === 1));
});
test('banner accurately distinguishes waiting, live data, unavailable data and simulation', () => {
  const nodes = new Map(), listeners = {};
  const context = { document: { getElementById: id => nodes.get(id), createElement: () => ({ style: {} }), body: { appendChild: element => nodes.set(element.id, element) } },
    window: { addEventListener: (event, listener) => { listeners[event] = listener; } } };
  vm.runInNewContext(modeBannerSource(true), context);
  const node = nodes.get('nitrosense-linux-mode'); assert.match(node.textContent, /WAITING/);
  listeners['nitrosense-linux-status']({ detail: { kind: 'monitor', available: true } }); assert.match(node.textContent, /LIVE LINUX/);
  listeners['nitrosense-linux-status']({ detail: { kind: 'monitor', available: false } }); assert.match(node.textContent, /UNAVAILABLE/);
  vm.runInNewContext(modeBannerSource(false), context); assert.match(node.textContent, /SIMULATED/);
});
