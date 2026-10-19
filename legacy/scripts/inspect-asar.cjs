// Read ASAR metadata and selected source files without executing Acer code.
// Usage: node legacy/scripts/inspect-asar.cjs <archive> <output-directory>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [archive, output] = process.argv.slice(2);
if (!archive || !output) throw new Error('Expected archive and output directory');
const bytes = fs.readFileSync(archive);
const headerSize = bytes.readUInt32LE(4);
const jsonSize = bytes.readUInt32LE(12);
if (16 + jsonSize > bytes.length || 8 + headerSize > bytes.length) {
  throw new Error('Invalid ASAR header bounds');
}
const header = JSON.parse(bytes.subarray(16, 16 + jsonSize).toString('utf8'));
const inventory = [];
const selected = new Set(['package.json', 'main.js', 'preload/ddsc.js']);
const destination = path.resolve(output);
fs.mkdirSync(destination, { recursive: true });
function walk(tree, prefix = '') {
  for (const [name, entry] of Object.entries(tree.files || {})) {
    const relative = prefix + name;
    if (entry.files) { walk(entry, relative + '/'); continue; }
    inventory.push({ path: relative, size: entry.size, unpacked: !!entry.unpacked, link: entry.link });
    if (!selected.has(relative)) continue;
    if (entry.link || entry.unpacked) throw new Error('Selected entry is not packed data');
    const start = 8 + headerSize + Number(entry.offset);
    const end = start + entry.size;
    if (!Number.isSafeInteger(start) || start < 8 + headerSize || end > bytes.length) {
      throw new Error('Invalid member bounds: ' + relative);
    }
    const target = path.resolve(destination, relative);
    if (!target.startsWith(destination + path.sep)) throw new Error('Unsafe member path');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes.subarray(start, end), { flag: 'wx' });
  }
}
walk(header);
fs.writeFileSync(path.join(destination, 'asar-inventory.json'), JSON.stringify({
  archive: path.resolve(archive),
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  files: inventory,
}, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ entries: inventory.length, selected: [...selected], destination }));
