const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { destination } = require('../lib/zip.cjs');

// Model the Electron failure: patched fs cannot read an ASAR as a raw file.
// Fixtures contain no Acer binaries; the expected archive hash is injected.
function fixture(electron) {
  const root = path.resolve('vendor-test-fixture');
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const archive = Buffer.from('fixture archive bytes');
  const files = new Map([
    ['resources/app.asar', archive], ['win32/Settings.json', Buffer.from('{}')],
    ['win32/Nitro/Nitro ANV15-52.json', Buffer.from('{}')],
    ['oem/NitroSense/Common/Settings.json', Buffer.from('{}')]
  ]);
  const manifest = { schema: 1, application: 'acernitrosense', version: '5.2.84', runtime: '26.6.10',
    asarSha256: hash(archive), msiEvidence: { productVersion: '5.2.84',
      msiSha256: '113f71cb8e2176acd8e3e08bd036bf74b9ec1c60fee0197677a2f9aeb2b2bbdb' },
    files: [...files].map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) })) };
  const storage = new Map([...files].map(([name, bytes]) => [path.join(root, name), bytes]));
  storage.set(path.join(root, 'import.json'), Buffer.from(JSON.stringify(manifest)));
  const physicalFs = {
    realpathSync: name => name,
    lstatSync: () => ({ isSymbolicLink: () => false }),
    readFileSync: (name, encoding) => {
      if (!storage.has(name)) throw new Error('Missing fixture file');
      return encoding ? storage.get(name).toString(encoding) : storage.get(name);
    }
  };
  const requested = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/vendor.cjs'), 'utf8'), {
    module, process: { versions: electron ? { electron: '26.6.10' } : {} },
    require(name) {
      requested.push(name);
      if (name === 'original-fs') return physicalFs;
      if (name === 'node:fs') return electron ? { readFileSync() { throw new Error('Electron ASAR virtualization'); } } : physicalFs;
      if (name === './zip.cjs') return { destination };
      if (name === '../scripts/import-vendor.cjs') return { KNOWN_ASAR: hash(archive) };
      return require(name);
    }
  });
  return { root, storage, requested, verifyVendor: module.exports.verifyVendor };
}

test('Electron integrity verification reads physical archive bytes despite virtual fs', () => {
  const f = fixture(true);
  assert.equal(f.verifyVendor(f.root).verifiedFiles, 4);
  assert.ok(f.requested.includes('original-fs'));
});

test('physical archive verification still rejects a changed archive', () => {
  const f = fixture(true);
  const target = path.join(f.root, 'resources/app.asar');
  const changed = Buffer.from(f.storage.get(target)); changed[0] ^= 1;
  f.storage.set(target, changed);
  assert.throws(() => f.verifyVendor(f.root), /Vendor file was modified: resources\/app.asar/);
});

test('plain Node verification works without an Electron-only module', () => {
  const f = fixture(false);
  assert.equal(f.verifyVendor(f.root).verifiedFiles, 4);
  assert.ok(!f.requested.includes('original-fs'));
});
