const path = require('node:path');
const { verifyVendor } = require('../lib/vendor.cjs');
try {
  const { root, manifest, verifiedFiles } = verifyVendor(path.resolve(process.argv[2] || 'vendor/nitrosense-5.2.84-official'));
  console.log(JSON.stringify({ vendorRoot: root, version: manifest.version, requiredElectron: manifest.runtime,
    verifiedFiles, originalAsarIntact: true, oemMsiVerified: true, hostPlatform: process.platform,
    validationScope: 'Vendor integrity only; this command does not test the GUI or hardware.',
    supportedMode: 'experimental Linux read-only monitoring',
    next: 'Operator read-only test: sh legacy/scripts/test-linux-readonly.sh; see docs/manual-testing.md' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
