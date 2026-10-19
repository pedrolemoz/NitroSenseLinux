// Electron's fs treats *.asar as virtual directories. Integrity checks need
// the actual archive bytes and physical paths; vendor loading still uses fs.
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { destination } = require('./zip.cjs');
const { KNOWN_ASAR } = require('../scripts/import-vendor.cjs');
function verifyVendor(directory) {
  const root = fs.realpathSync(directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'import.json'), 'utf8'));
  if (manifest.schema !== 1 || manifest.application !== 'acernitrosense' ||
      manifest.version !== '5.1.392' || manifest.runtime !== '26.6.10' || manifest.asarSha256 !== KNOWN_ASAR) {
    throw new Error('Unsupported import manifest');
  }
  if (!manifest.msiEvidence || manifest.msiEvidence.productVersion !== manifest.version ||
      manifest.msiEvidence.msiSha256 !== '1a9715c8d4de31a8d88b2b3f61574ec53dca1b81eba07ccb0a00a41a3a3a2e10') {
    throw new Error('OEM configuration is not verified: prepare from the reviewed MSI on Linux or Windows');
  }
  const files = new Set();
  for (const file of manifest.files) {
    const target = destination(root, file.path);
    const real = fs.realpathSync(target);
    if (real !== target || fs.lstatSync(target).isSymbolicLink()) throw new Error('Symlink/alias in vendor files');
    const bytes = fs.readFileSync(target);
    if (bytes.length !== file.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error('Vendor file was modified: ' + file.path);
    }
    if (files.has(file.path)) throw new Error('Duplicate manifest member');
    files.add(file.path);
  }
  for (const required of ['resources/app.asar', 'win32/Settings.json', 'win32/Nitro/Nitro ANV15-52.json', 'oem/NitroSense/Common/Settings.json']) {
    if (!files.has(required)) throw new Error('Missing required official resource: ' + required);
  }
  const actualAsar = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'resources/app.asar'))).digest('hex');
  if (actualAsar !== KNOWN_ASAR) throw new Error('Original ASAR integrity mismatch');
  return { root, manifest, verifiedFiles: files.size };
}
module.exports = { verifyVendor };
