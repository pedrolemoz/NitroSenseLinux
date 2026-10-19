const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareLinuxVendor, OFFICIAL_APPX } = require('../scripts/prepare-linux-vendor.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.prepare-linux-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'installer'), output = path.join(root, 'vendor');
  fs.mkdirSync(path.join(source, 'UWP'), { recursive: true }); fs.mkdirSync(path.join(source, 'Setup'));
  fs.writeFileSync(path.join(source, 'UWP', OFFICIAL_APPX), 'AppX test placeholder');
  fs.writeFileSync(path.join(source, 'UWP/dependency.appx'), 'Not the NitroSense application');
  fs.writeFileSync(path.join(source, 'Setup/NitroSenseConfig.msi'), 'MSI test placeholder');
  return { source, output };
}
test('preparation selects the reviewed main AppX alongside dependency packages and verifies after import', t => {
  const { source, output } = fixture(t), calls = [];
  const result = prepareLinuxVendor(source, output, {
    extract(input, destination) { calls.push('extract'); assert.equal(input, path.join(source, 'Setup/NitroSenseConfig.msi')); return { output: destination }; },
    importResources(input, destination, oem) { calls.push('import'); assert.equal(input, path.join(source, 'UWP', OFFICIAL_APPX)); assert.equal(destination, output); assert.equal(oem, output + '.oem'); return { output, files: 746 }; },
    verify(destination) { calls.push('verify'); assert.equal(destination, output); return { verifiedFiles: 746 }; },
  });
  assert.deepEqual(calls, ['extract', 'import', 'verify']); assert.equal(result.verifiedFiles, 746);
});
test('preparation refuses all existing output/staging variants before doing work', t => {
  const { source, output } = fixture(t); fs.mkdirSync(output + '.partial');
  assert.throws(() => prepareLinuxVendor(source, output, { extract() { assert.fail('No extraction after conflicting output'); } }), /already exists/);
});
test('extraction failure stops import and verification without reporting a prepared vendor', t => {
  const { source, output } = fixture(t);
  assert.throws(() => prepareLinuxVendor(source, output, {
    extract() { throw new Error('tool missing'); }, importResources() { assert.fail('Import must not run'); }, verify() { assert.fail('Verification must not run'); },
  }), /tool missing/);
});
