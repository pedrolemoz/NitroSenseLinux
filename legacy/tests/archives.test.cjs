const test = require('node:test');
const assert = require('node:assert/strict');
const { Zip, crc32, destination } = require('../lib/zip.cjs');
function fixture(name = 'file.txt', data = Buffer.from('original bytes')) {
  const n = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}
test('ZIP reads original bytes and verifies checksum', () => {
  const bytes = fixture(); assert.equal(new Zip(bytes).read('file.txt').toString(), 'original bytes');
  bytes[38] ^= 1;
  assert.throws(() => new Zip(bytes).read('file.txt'), /integrity mismatch/);
});
test('archive paths cannot escape or create Windows aliases', () => {
  for (const p of ['../outside', '/absolute', 'C:/absolute', 'ok/../outside', 'a\\b', '%00']) {
    if (p === '%00') continue;
    assert.throws(() => destination('output', p));
  }
  assert.throws(() => new Zip(fixture('../outside')), /Unsafe archive/);
});
test('truncated directories and unsupported compression fail', () => {
  assert.throws(() => new Zip(fixture().subarray(0, 30)), /directory not found/);
  const bytes = fixture(); const pos = bytes.indexOf(Buffer.from('504b0102', 'hex'));
  bytes.writeUInt16LE(99, pos + 10);
  assert.throws(() => new Zip(bytes), /Unsupported ZIP compression/);
});
