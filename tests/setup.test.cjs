const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { verifyDownload, extractInstaller, URL, DEFAULT_VENDOR } = require('../scripts/setup.cjs');
test('setup pins the official Acer HTTPS source and versioned destination', () => {
  const url = new URLConstructor(URL);
  assert.equal(url.protocol, 'https:'); assert.equal(url.hostname, 'global-download.acer.com');
  assert.ok(decodeURIComponent(url.pathname).endsWith('/Nitro Sense_Acer_5.2.84_W11x64_A.zip'));
  assert.equal(DEFAULT_VENDOR, 'vendor/nitrosense-5.2.84-official');
});
const URLConstructor = global.URL;
test('modified or incomplete downloads fail integrity validation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-download-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'bad.zip'); fs.writeFileSync(file, 'incomplete');
  await assert.rejects(verifyDownload(file), /SHA-256 mismatch/);
  const output = path.join(root, 'installer');
  assert.throws(() => extractInstaller(file, output), /ZIP/);
  assert.equal(fs.existsSync(output), false); assert.equal(fs.existsSync(output + '.partial'), false);
});
