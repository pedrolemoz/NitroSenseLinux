// Prepare user-owned installer resources only. Never execute Acer/Windows code.
const fs = require('node:fs');
const path = require('node:path');
const { extractOemMsi } = require('../lib/msi-oem.cjs');
const { importVendor } = require('./import-vendor.cjs');
const { verifyVendor } = require('../lib/vendor.cjs');
const OFFICIAL_APPX = '92086ed242014d8fadab04e6217e62b4.appx';
function prepareLinuxVendor(installer, output, { extract = extractOemMsi, importResources = importVendor, verify = verifyVendor } = {}) {
  const source = fs.realpathSync(installer), destination = path.resolve(output), oem = destination + '.oem';
  for (const candidate of [destination, destination + '.partial', oem, oem + '.partial']) {
    if (fs.existsSync(candidate)) throw new Error('Preparation destination/staging already exists; select a new output');
  }
  const appx = path.join(source, 'UWP', OFFICIAL_APPX);
  if (!fs.statSync(appx).isFile()) throw new Error('Reviewed NitroSense AppX missing');
  const extraction = extract(path.join(source, 'Setup/NitroSenseConfig.msi'), oem);
  const imported = importResources(appx, destination, oem);
  const verified = verify(destination);
  return { ...imported, oem: extraction.output, verifiedFiles: verified.verifiedFiles, originalAsarIntact: true };
}
if (require.main === module) {
  try {
    if (process.platform !== 'linux') throw new Error('This preparation entry requires Linux');
    if (process.argv.length !== 4) throw new Error('Usage: node legacy/scripts/prepare-linux-vendor.cjs <official-installer-directory> <new-vendor-directory>');
    console.log(JSON.stringify(prepareLinuxVendor(...process.argv.slice(2)), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareLinuxVendor, OFFICIAL_APPX };
