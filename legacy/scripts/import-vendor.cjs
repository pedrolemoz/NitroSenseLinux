// Import resources from the user's official package. Never run installer code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Zip, destination } = require('../lib/zip.cjs');
const { readAsar } = require('../lib/asar.cjs');
const KNOWN_ASAR = 'c79516a91d2eae93b019d040c786d23d8e69795b18255b709a37d48b9b78a401';
function digest(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function importVendor(input, output, oemSource) {
  const root = path.resolve(output);
  if (fs.existsSync(root)) throw new Error('Output already exists; choose a new directory: ' + root);
  const archive = new Zip(input);
  const asar = archive.read('app/resources/app.asar');
  if (digest(asar) !== KNOWN_ASAR) throw new Error('Unsupported Acer package: no reviewed adapter for this ASAR hash');
  const parsed = readAsar(asar);
  const pkg = JSON.parse(parsed.read('package.json').toString('utf8'));
  if (pkg.name !== 'acernitrosense' || pkg.version !== '5.2.84' || pkg.main !== 'main.js') throw new Error('Unexpected Acer application identity');
  const staged = root + '.partial';
  if (fs.existsSync(staged)) throw new Error('Previous import staging directory exists: ' + staged);
  fs.mkdirSync(staged, { recursive: true });
  const hashes = [];
  let msiEvidence = null;
  function write(relative, data) {
    const target = destination(staged, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data, { flag: 'wx' });
    hashes.push({ path: relative, sha256: digest(data), bytes: data.length });
  }
  write('resources/app.asar', asar);
  write('AppxManifest.xml', archive.read('AppxManifest.xml'));
  for (const name of archive.entries.keys()) {
    if (name.endsWith('/')) continue;
    if (!name.startsWith('app/win32/') && !name.startsWith('app/resources/app.asar.unpacked/')) continue;
    if (name.toLowerCase().endsWith('.msi')) continue; // Windows setup is not run by the loader.
    const relative = name.slice(4).split('/').map(segment => decodeURIComponent(segment)).join('/');
    write(relative, archive.read(name));
  }
  if (oemSource) {
    const reportPath = path.join(path.resolve(oemSource), 'extraction-report.json');
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, ''));
      if (report.msiSha256 !== '113f71cb8e2176acd8e3e08bd036bf74b9ec1c60fee0197677a2f9aeb2b2bbdb' ||
          report.productVersion !== pkg.version) throw new Error('OEM MSI evidence is not the reviewed package');
      for (const file of report.files) {
        const data = fs.readFileSync(destination(path.resolve(oemSource), file.path));
        if (data.length !== file.bytes || digest(data) !== file.sha256) throw new Error('OEM extraction integrity mismatch');
      }
      msiEvidence = { msiSha256: report.msiSha256, productVersion: report.productVersion };
    }
    // Copy only vendor Common resources; never copy profiles, credentials or logs.
    const common = path.join(path.resolve(oemSource), 'Common');
    function copy(dir, relative) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('OEM resource symlinks are not supported');
        const next = relative + '/' + entry.name, full = path.join(dir, entry.name);
        if (entry.isDirectory()) copy(full, next);
        else if (entry.isFile()) write(next, fs.readFileSync(full));
      }
    }
    copy(common, 'oem/NitroSense/Common');
  }
  fs.mkdirSync(path.join(staged, 'oem/NitroSense'), { recursive: true });
  const manifest = { schema: 1, application: pkg.name, version: pkg.version,
    runtime: '26.6.10', sourceAppxSha256: digest(archive.bytes), asarSha256: KNOWN_ASAR,
    oemCommonImported: !!oemSource, msiEvidence, files: hashes,
    limitations: ['Linux hardware controls remain unimplemented/unvalidated; see docs/status.md for runtime status.',
      ...(!oemSource ? ['MSI Common resources have not been imported; OEM setup is incomplete.'] : []),
      'Microsoft Store, Windows services and drivers are not imported as executable dependencies.'],
  };
  fs.writeFileSync(path.join(staged, 'import.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  fs.renameSync(staged, root);
  return { output: root, version: pkg.version, files: hashes.length, oemCommonImported: !!oemSource };
}
if (require.main === module) {
  const [input, output = 'vendor/nitrosense-5.2.84', flag, oem] = process.argv.slice(2);
  if (!input || flag && (flag !== '--oem' || !oem)) {
    console.error('Usage: node legacy/scripts/import-vendor.cjs <official.appx> [output] [--oem <installed-OEM-directory>]');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(importVendor(input, output, oem), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = { importVendor, KNOWN_ASAR };
