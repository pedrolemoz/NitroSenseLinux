const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBatteryCharge } = require('../lib/battery-charge.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-charge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function battery(name, scope) {
    const dir = path.join(root, name); fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'type'), 'Battery');
    if (scope) fs.writeFileSync(path.join(dir, 'scope'), scope);
    return dir;
  }
  return { root, battery, acerThreshold: null };
}
test('charge limits use a single system battery, exclude peripherals and verify both choices', t => {
  const f = fixture(t), dir = f.battery('BAT1'); f.battery('mouse', 'Device');
  const threshold = path.join(dir, 'charge_control_end_threshold'); fs.writeFileSync(threshold, '100\n');
  const charge = createBatteryCharge(f);
  assert.equal(charge.status().limit, 100);
  assert.equal(charge.setLimit(80).limit, 80);
  assert.equal(charge.setLimit(100).limit, 100);
  for (const value of [0, 81, '80', null]) assert.throws(() => charge.setLimit(value), /Choose/);
  assert.equal(fs.readFileSync(threshold, 'utf8'), '100');
});
test('missing driver support and ambiguous batteries cannot be written', t => {
  const f = fixture(t); f.battery('BAT1');
  const charge = createBatteryCharge(f);
  assert.equal(charge.status().supported, false);
  assert.match(charge.status().message, /driver/);
  assert.throws(() => charge.setLimit(80));
  f.battery('BAT2', 'System');
  assert.match(charge.status().message, /single system battery/);
});
test('permission denial and unconfirmed writes are reported without success', t => {
  const f = fixture(t), dir = f.battery('BAT1', 'System');
  fs.writeFileSync(path.join(dir, 'charge_control_end_threshold'), '100');
  const denied = createBatteryCharge({ ...f, fsImpl: { ...fs, accessSync() { throw new Error('denied'); } } });
  assert.equal(denied.status().supported, true);
  assert.equal(denied.status().writable, false);
  assert.throws(() => denied.setLimit(80), /permission/);
  const ignored = createBatteryCharge({ ...f, fsImpl: { ...fs, writeFileSync() {} } });
  assert.throws(() => ignored.setLimit(80), /did not confirm/);
});


test('Acer WMI driver supplies charge control when the battery lacks the standard ABI', t => {
  const f = fixture(t); f.battery('BAT1');
  const acerThreshold = path.join(f.root, 'wmi-threshold');
  fs.writeFileSync(acerThreshold, '80\n');
  const charge = createBatteryCharge({ ...f, acerThreshold });
  assert.equal(charge.status().limit, 80);
  assert.equal(charge.setLimit(100).limit, 100);
  assert.equal(fs.readFileSync(acerThreshold, 'utf8'), '100');
});
