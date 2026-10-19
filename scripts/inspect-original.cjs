// Static extraction/indexing only: no vendor module or binary is executed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readAsar } = require('../lib/asar.cjs');
const { KNOWN_ASAR } = require('./import-vendor.cjs');
const { MAIN_SHA256 } = require('../runtime/source-patches.cjs');
const { RENDERER_FILE, RENDERER_SHA256 } = require('../runtime/renderer-patches.cjs');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let archive = path.join(root, 'vendor/nitrosense-5.2.84-official/resources/app.asar');
const symbols = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--archive' && args[i + 1]) archive = path.resolve(args[++i]);
  else if (args[i] === '--symbol' && args[i + 1]) symbols.push(args[++i]);
  else throw new Error('Usage: inspect-original.cjs [--archive app.asar] [--symbol originalSymbol]');
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const bytes = fs.readFileSync(archive);
if (sha(bytes) !== KNOWN_ASAR) throw new Error('Unreviewed original ASAR');
const asar = readAsar(bytes);
const output = path.join(root, 'analysis', 'original-5.2.84');
fs.mkdirSync(output, { recursive: true });
const sources = [];
for (const [member, expected, file] of [['main.js', MAIN_SHA256, 'main.js'], [RENDERER_FILE, RENDERER_SHA256, 'renderer.js']]) {
  const data = asar.read(member);
  if (sha(data) !== expected) throw new Error('Unreviewed original source: ' + member);
  fs.writeFileSync(path.join(output, file), data);
  const source = data.toString('utf8');
  const locations = symbols.map(symbol => {
    if (!symbol || symbol.length > 200) throw new Error('Invalid symbol');
    const offsets = []; let at = -1;
    while ((at = source.indexOf(symbol, at + 1)) !== -1) offsets.push(at);
    return { symbol, offsets };
  });
  sources.push({ member, sha256: expected, file, locations });
}
fs.writeFileSync(path.join(output, 'index.json'), JSON.stringify({ version: '5.2.84', asarSha256: KNOWN_ASAR,
  method: 'Exact packed JavaScript extraction and literal symbol indexing; not native decompilation or original project recovery',
  offsetUnit: 'zero-based UTF-16 code units', sources }, null, 2) + '\n');
console.log(JSON.stringify({ output, sources: sources.map(s => ({ member: s.member, symbols: s.locations })) }, null, 2));
