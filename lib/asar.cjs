const { safeRelative } = require('./zip.cjs');
function readAsar(bytes) {
  if (bytes.length < 16) throw new Error('Short ASAR header');
  const headerSize = bytes.readUInt32LE(4), jsonSize = bytes.readUInt32LE(12);
  const base = 8 + headerSize;
  if (16 + jsonSize > base || base > bytes.length) throw new Error('Invalid ASAR bounds');
  const tree = JSON.parse(bytes.subarray(16, 16 + jsonSize).toString('utf8'));
  const entries = new Map();
  function walk(node, prefix = '') {
    for (const [name, entry] of Object.entries(node.files || {})) {
      if (name.includes('/')) throw new Error('Invalid ASAR segment');
      const relative = safeRelative(prefix + name);
      if (entry.files) walk(entry, relative + '/');
      else entries.set(relative, entry);
    }
  }
  walk(tree);
  return { entries, read(name) {
    const entry = entries.get(name);
    if (!entry || entry.unpacked || entry.link) throw new Error('Not a packed ASAR file: ' + name);
    const start = base + Number(entry.offset), end = start + entry.size;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < base || end > bytes.length) {
      throw new Error('Invalid ASAR entry bounds');
    }
    return bytes.subarray(start, end);
  } };
}
module.exports = { readAsar };
