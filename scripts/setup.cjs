// Download only from Acer; never execute Windows installers or custom actions.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFileSync } = require('node:child_process');
const { Zip, destination } = require('../lib/zip.cjs');
const { prepareLinuxVendor, OFFICIAL_APPX } = require('./prepare-linux-vendor.cjs');
const { verifyVendor } = require('../lib/vendor.cjs');
const URL = 'https://global-download.acer.com/GDFiles/Application/Nitro%20Sense/Nitro%20Sense_Acer_5.2.84_W11x64_A.zip?acerid=639270422763622831&Step1=&Step2=&Step3=NITRO%20ANV15-52&OS=ALL&LC=pt&BC=ACER&SC=PA_3';
const ZIP_SHA256 = 'a9e2ca1efff836a045b65e50ec54945488b4804e56b3f77852e9334f76d60908';
const INSTALLER = 'NitroSense_Acer_5.2.84_W11x64';
const DEFAULT_VENDOR = 'vendor/nitrosense-5.2.84-official';
async function verifyDownload(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  if (hash.digest('hex') !== ZIP_SHA256) throw new Error('Acer ZIP SHA-256 mismatch; remove the cached ZIP and retry.');
}
function extractInstaller(file, output) {
  if (fs.existsSync(output) || fs.existsSync(output + '.partial')) throw new Error('Installer destination/staging already exists');
  const zip = new Zip(file), staged = output + '.partial';
  const members = ['Setup/NitroSenseConfig.msi', 'UWP/' + OFFICIAL_APPX];
  for (const member of members) if (!zip.entries.has(INSTALLER + '/' + member)) throw new Error('Missing official installer member: ' + member);
  fs.mkdirSync(staged, { recursive: true });
  for (const member of members) {
    const target = destination(staged, member);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zip.read(INSTALLER + '/' + member), { flag: 'wx' });
  }
  fs.renameSync(staged, output);
}
async function setup({ zipFile, run = execFileSync } = {}) {
  if (process.platform !== 'linux') throw new Error('Setup requires Linux');
  const root = path.resolve(__dirname, '..'), vendor = path.join(root, DEFAULT_VENDOR);
  if (fs.existsSync(vendor)) {
    verifyVendor(vendor);
    console.log('Existing NitroSense 5.2.84 import verified.');
  } else {
    // Check requirements before the approximately 947 MiB download.
    for (const tool of ['/usr/bin/msiinfo', '/usr/bin/cabextract']) {
      try { fs.accessSync(tool, fs.constants.X_OK); } catch { throw new Error('Install msitools and cabextract first (see README): missing ' + tool); }
    }
    const cache = path.join(root, '.state/downloads'); fs.mkdirSync(cache, { recursive: true });
    const archive = zipFile ? path.resolve(zipFile) : path.join(cache, 'NitroSense_Acer_5.2.84_W11x64_A.zip');
    if (!zipFile && !fs.existsSync(archive)) {
      console.log('Downloading NitroSense 5.2.84 directly from Acer (approximately 947 MiB)…');
      const partial = archive + '.partial';
      try {
        const response = await fetch(URL, { signal: AbortSignal.timeout(30 * 60 * 1000), redirect: 'error' });
        if (!response.ok) throw new Error('Acer download failed: HTTP ' + response.status);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial, { flags: 'wx' }));
        await verifyDownload(partial);
        fs.renameSync(partial, archive);
      } catch (error) { throw new Error('Download failed: ' + error.message + '. Remove any .partial download before retrying.'); }
    }
    console.log('Verifying Acer ZIP…'); await verifyDownload(archive);
    const installer = fs.mkdtempSync(path.join(cache, 'installer-'));
    // Use a fresh child so interrupted imports never overwrite previous evidence.
    const extracted = path.join(installer, 'resources');
    extractInstaller(archive, extracted);
    console.log('Extracting and verifying Linux application resources…');
    prepareLinuxVendor(extracted, vendor);
    fs.rmSync(installer, { recursive: true });
  }
  console.log('Installing pinned Electron runtime…');
  run('npm', ['run', 'setup:electron'], { cwd: root, stdio: 'inherit', shell: false });
  console.log('Setup complete. Run npm start from your graphical session.');
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--zip')) {
    console.error('Usage: npm run setup -- [--zip /path/to/official.zip]'); process.exitCode = 1;
  } else setup({ zipFile: args[1] }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { setup, verifyDownload, extractInstaller, URL, ZIP_SHA256, DEFAULT_VENDOR };
