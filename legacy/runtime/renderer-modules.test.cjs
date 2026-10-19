const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { createRendererRequire, rendererPreloadSource } = require('./renderer-modules.cjs');

test('routes remote to the vendor package and preserves existing renderer modules', () => {
  const calls = [];
  const local = name => { calls.push(['local', name]); return 'local value'; };
  local.resolve = name => `local:${name}`;
  local.cache = {};
  const vendor = name => { calls.push(['vendor', name]); return { getCurrentWindow: () => 'actual window' }; };
  vendor.resolve = name => `vendor:${name}`;
  const require = createRendererRequire(local, vendor);
  assert.equal(require('@electron/remote').getCurrentWindow(), 'actual window');
  assert.equal(require('electron'), 'local value');
  assert.equal(require.resolve('@electron/remote'), 'vendor:@electron/remote');
  assert.equal(require.resolve('electron'), 'local:electron');
  assert.equal(require.cache, local.cache);
  assert.deepEqual(calls, [['vendor', '@electron/remote'], ['local', 'electron']]);
});

test('propagates vendor load errors instead of pretending to close a window', () => {
  const routed = createRendererRequire(() => {}, () => { throw new Error('remote package unavailable'); });
  assert.throws(() => routed('@electron/remote'), /remote package unavailable/);
});

test('generated preload installs routing before page code and loads remote lazily', () => {
  const root = path.resolve('fixture vendor');
  const window = { require: name => `original:${name}` };
  window.require.resolve = name => name;
  let loaded = false;
  const vendor = name => { loaded = true; return `vendor:${name}`; };
  vendor.resolve = name => name;
  const source = rendererPreloadSource(root);
  vm.runInNewContext(source, { window, require(name) {
    if (name === 'node:module') return { createRequire(base) {
      assert.equal(base, path.join(root, 'resources/app.asar/package.json')); return vendor;
    } };
    if (name.endsWith('renderer-modules.cjs')) return { createRendererRequire };
    throw new Error('Unexpected module');
  } });
  assert.equal(loaded, false);
  assert.equal(window.require('electron'), 'original:electron');
  assert.equal(window.require('@electron/remote'), 'vendor:@electron/remote');
});
