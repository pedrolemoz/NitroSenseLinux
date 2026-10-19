const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { transformRenderer, RENDERER_FILE } = require('./renderer-patches.cjs');
const archive = path.resolve(__dirname, '../../vendor/nitrosense-5.2.84-official/resources/app.asar');
function member(bytes, name) {
  let node = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)));
  for (const segment of name.split('/')) node = node.files[segment];
  const start = 8 + bytes.readUInt32LE(4) + Number(node.offset);
  return bytes.subarray(start, start + node.size).toString('utf8');
}
function handler(source, logged) {
  const begin = source.indexOf('e.on(nc.NOTIFICATION_SERVICE_ERROR,');
  const end = source.indexOf(',e.on(nc.TOKEN_UPDATED,', begin);
  assert.ok(begin >= 0 && end > begin);
  let callback;
  vm.runInNewContext(source.slice(begin, end), {
    e: { on(_name, cb) { callback = cb; } }, nc: { NOTIFICATION_SERVICE_ERROR: 'original-error' },
    console: { log: (...args) => logged.push(args) },
  });
  return callback;
}
test('actual original push string failures remain reported without a second JSON exception', { skip: !fs.existsSync(archive) }, () => {
  const bytes = fs.readFileSync(archive);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), 'c79516a91d2eae93b019d040c786d23d8e69795b18255b709a37d48b9b78a401');
  const receiver = member(bytes, 'node_modules/electron-fcm-push-receiver/src/index.js');
  assert.ok(receiver.includes('webContents.send(NOTIFICATION_SERVICE_ERROR, e.message)'));
  const original = member(bytes, RENDERER_FILE);
  assert.throws(() => handler(original, [])({}, '404 Not Found'), /JSON/);
  const logged = [], patched = transformRenderer(original);
  const callback = handler(patched.source, logged);
  for (const message of ['404 Not Found', '', '{"code":"unavailable"}']) {
    assert.doesNotThrow(() => callback({}, message));
    assert.equal(logged.at(-1)[1], message);
  }
  assert.throws(() => transformRenderer(patched.source), /Unreviewed Acer/);
});
