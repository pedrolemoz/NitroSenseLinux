// Embedded version strings are static provenance evidence, not a runtime test.
const fs = require('node:fs');
const crypto = require('node:crypto');
const file = process.argv[2] || 'analysis/extracted/NitroSense.exe';
const bytes = fs.readFileSync(file);
const text = bytes.toString('latin1');
const markers = [...text.matchAll(/(?:Electron|Chrome)\/[0-9]+(?:\.[0-9]+)+/g)]
  .map(m => ({ value: m[0], fileOffset: m.index }));
if (!markers.length) throw new Error('No embedded runtime version markers found');
const result = { file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  evidenceType: 'ASCII version markers in supplied executable', markers,
  limitation: 'Embedded strings do not prove runtime behavior or Linux compatibility.' };
fs.writeFileSync('analysis/runtime-markers.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
