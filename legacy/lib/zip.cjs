// Bounded ZIP/ZIP64 reader for AppX archives (store/deflate, one disk).
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const MAX_ENTRY = 512 * 1024 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;
function safeRelative(name) {
  if (!name || name.includes('\0') || name.includes('\\') || name.includes(':') ||
      name.startsWith('/') || name.split('/').some(s => s === '..' || s === '.')) {
    throw new Error('Unsafe archive member path: ' + name);
  }
  return name;
}
function destination(root, name) {
  safeRelative(name);
  const base = path.resolve(root), result = path.resolve(base, name);
  if (!result.startsWith(base + path.sep)) throw new Error('Archive path escapes output');
  return result;
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = (i >>> 1) ^ (i & 1 ? 0xedb88320 : 0);
  return i >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
class Zip {
  constructor(file) {
    this.bytes = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
    const b = this.bytes;
    let end = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
      if (b.readUInt32LE(i) === 0x06054b50 && i + 22 + b.readUInt16LE(i + 20) === b.length) { end = i; break; }
    }
    if (end < 0) throw new Error('ZIP end directory not found');
    let count = b.readUInt16LE(end + 10), size = b.readUInt32LE(end + 12);
    let pos = b.readUInt32LE(end + 16);
    function u64(offset) {
      if (offset < 0 || offset + 8 > b.length) throw new Error('Invalid ZIP64 integer bounds');
      const n = Number(b.readBigUInt64LE(offset));
      if (!Number.isSafeInteger(n)) throw new Error('ZIP64 value exceeds safe integer range');
      return n;
    }
    if (b.readUInt16LE(end + 4) || b.readUInt16LE(end + 6) ||
        b.readUInt16LE(end + 8) !== count) throw new Error('Multidisk ZIP is not supported');
    if (count === 65535 || pos === 0xffffffff || size === 0xffffffff) {
      const loc = end - 20;
      if (loc < 0 || b.readUInt32LE(loc) !== 0x07064b50 ||
          b.readUInt32LE(loc + 4) || b.readUInt32LE(loc + 16) !== 1) throw new Error('Invalid ZIP64 locator');
      const record = u64(loc + 8);
      if (record + 56 > loc || b.readUInt32LE(record) !== 0x06064b50 ||
          b.readUInt32LE(record + 16) || b.readUInt32LE(record + 20)) throw new Error('Invalid ZIP64 end record');
      count = u64(record + 32); size = u64(record + 40); pos = u64(record + 48);
      if (u64(record + 24) !== count) throw new Error('Multidisk ZIP64 is not supported');
    }
    if (count > 100000) throw new Error('ZIP entry count limit');
    const centralEnd = pos + size;
    if (centralEnd > end) throw new Error('Invalid ZIP central directory bounds');
    this.entries = new Map();
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > centralEnd || b.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid ZIP entry');
      const nameLength = b.readUInt16LE(pos + 28), extraLength = b.readUInt16LE(pos + 30);
      const next = pos + 46 + nameLength + extraLength + b.readUInt16LE(pos + 32);
      if (next > centralEnd) throw new Error('Invalid ZIP member bounds');
      const name = safeRelative(b.subarray(pos + 46, pos + 46 + nameLength).toString('utf8'));
      const flags = b.readUInt16LE(pos + 8), method = b.readUInt16LE(pos + 10);
      let length = b.readUInt32LE(pos + 24), compressed = b.readUInt32LE(pos + 20);
      let offset = b.readUInt32LE(pos + 42);
      const mode = b.readUInt32LE(pos + 38) >>> 16;
      if (b.readUInt16LE(pos + 34)) throw new Error('Multidisk ZIP member');
      if ([length, compressed, offset].includes(0xffffffff)) {
        let extra = pos + 46 + nameLength;
        const extraEnd = extra + extraLength;
        let found = false;
        while (extra + 4 <= extraEnd) {
          const tag = b.readUInt16LE(extra), len = b.readUInt16LE(extra + 2);
          const nextExtra = extra + 4 + len;
          if (nextExtra > extraEnd) throw new Error('Invalid ZIP extra field');
          if (tag === 1) {
            let q = extra + 4;
            function read() { if (q + 8 > nextExtra) throw new Error('Short ZIP64 extra'); const n = u64(q); q += 8; return n; }
            if (length === 0xffffffff) length = read();
            if (compressed === 0xffffffff) compressed = read();
            if (offset === 0xffffffff) offset = read();
            found = true; break;
          }
          extra = nextExtra;
        }
        if (!found) throw new Error('Missing ZIP64 extra data');
      }
      if (flags & 1 || ![0, 8].includes(method)) throw new Error('Unsupported ZIP compression/encryption');
      if ((mode & 0xf000) === 0xa000) throw new Error('ZIP symlinks are not supported');
      if (this.entries.has(name)) throw new Error('Duplicate ZIP member: ' + name);
      total += length;
      if (length > MAX_ENTRY || total > MAX_TOTAL || offset + 30 > pos) throw new Error('ZIP resource/bounds limit');
      this.entries.set(name, { name, flags, method, length, compressed, offset, crc: b.readUInt32LE(pos + 16) });
      pos = next;
    }
    if (pos !== centralEnd) throw new Error('ZIP directory length mismatch');
  }
  read(name) {
    const entry = this.entries.get(name);
    if (!entry) throw new Error('Missing ZIP member: ' + name);
    const b = this.bytes, p = entry.offset;
    if (b.readUInt32LE(p) !== 0x04034b50) throw new Error('Invalid local ZIP header');
    const start = p + 30 + b.readUInt16LE(p + 26) + b.readUInt16LE(p + 28);
    const end = start + entry.compressed;
    if (end > b.length) throw new Error('Invalid compressed member bounds');
    const data = entry.method === 0 ? b.subarray(start, end) :
      zlib.inflateRawSync(b.subarray(start, end), { maxOutputLength: Math.min(MAX_ENTRY, entry.length + 1) });
    if (data.length !== entry.length || crc32(data) !== entry.crc) throw new Error('ZIP integrity mismatch: ' + name);
    return data;
  }
}
module.exports = { Zip, crc32, safeRelative, destination };
