const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeReadRequest, JsonObjects } = require('../lib/protocol.cjs');
test('wire query matches Acer header and forbids settings packets', () => {
  const b = encodeReadRequest(20, { Function: 'FAN_CONTROL' });
  assert.equal(b.subarray(0, 8).toString('hex'), '4143455214000000');
  assert.equal(b.subarray(8).toString(), '{"Function":"FAN_CONTROL"}');
  assert.throws(() => encodeReadRequest(100, {}), /read\/query/);
});
test('TCP splitting, quoted braces, escapes and coalesced replies are handled', () => {
  const frames = [{ request: 'VERSION', data: 'a } \\" b' }, { Function: 'event', Parameter: [{ a: 2 }] }];
  const wire = frames.map(v => JSON.stringify(v)).join('\n');
  for (let split = 0; split <= wire.length; split++) {
    const p = new JsonObjects();
    assert.deepEqual([...p.push(wire.slice(0, split)), ...p.push(wire.slice(split))], frames);
  }
});
test('malformed and oversized responses fail explicitly', () => {
  assert.throws(() => new JsonObjects().push('not-json'), /Expected/);
  assert.throws(() => new JsonObjects(10).push('{"data":"too long"}'), /size limit/);
});
