const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLinuxPlatformState } = require('../lib/linux-platform-state.cjs');
const { createReadOnlyHandler } = require('../lib/acer-service.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.platform-state-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, value) => { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  write('class/power_supply/ACAD/type', 'Mains'); write('class/power_supply/ACAD/online', '1');
  write('class/power_supply/BAT1/type', 'Battery');
  const reader = createLinuxPlatformState({ sysRoot: root });
  return { root, write, reader };
}
test('ordinary AC presence is read fresh and valid offline zero is never inferred from missing data', t => {
  const { reader, write, root } = fixture(t);
  assert.equal(reader.sample().power.adaptorStatus, 1);
  write('class/power_supply/ACAD/online', '0'); assert.equal(reader.sample().power.adaptorStatus, 0);
  fs.unlinkSync(path.join(root, 'class/power_supply/ACAD/online'));
  const missing = reader.sample(); assert.equal(missing.power.adaptorStatus, null); assert.ok(missing.errors.some(e => e.code === 'ENOENT'));
});
test('USB-C/system charger ambiguity is not turned into ordinary Acer AC flags and device supplies are excluded', t => {
  const { reader, write } = fixture(t);
  write('class/power_supply/USB/type', 'USB_PD'); write('class/power_supply/USB/scope', 'System'); write('class/power_supply/USB/online', '1');
  assert.equal(reader.sample().power.adaptorStatus, null);
  write('class/power_supply/USB/scope', 'Device'); assert.equal(reader.sample().power.adaptorStatus, 1);
  write('class/power_supply/USB/scope', 'Unknown'); assert.equal(reader.sample().power.adaptorStatus, null);
  assert.ok(reader.sample().errors.some(error => error.code === 'UNCLASSIFIED_SCOPE'));
  write('class/power_supply/USB/scope', 'Device');
  write('class/power_supply/ACAD/online', 'unknown'); assert.equal(reader.sample().power.adaptorStatus, null);
});
test('raw legacy and per-driver profiles retain identity/choices without mapping performance to Acer modes', t => {
  const { reader, write } = fixture(t);
  write('firmware/acpi/platform_profile', 'balanced'); write('firmware/acpi/platform_profile_choices', 'quiet balanced balanced-performance performance');
  write('class/platform-profile/platform-profile-0/name', 'acer-wmi');
  write('class/platform-profile/platform-profile-0/profile', 'performance');
  write('class/platform-profile/platform-profile-0/choices', 'quiet balanced balanced-performance performance');
  const state = reader.sample(); assert.equal(state.profiles.length, 2);
  assert.equal(state.profiles[0].name, 'acer-wmi'); assert.equal(state.profiles[0].current, 'performance');
  assert.ok(state.profiles.every(profile => profile.acerMode === null && !profile.writableByThisBackend && profile.available));
  write('class/platform-profile/platform-profile-0/profile', 'custom'); assert.equal(reader.sample().profiles[0].available, true);
});
test('profile disappearance/malformed values and permissions stay errors rather than prior state', t => {
  const { root, reader, write } = fixture(t);
  write('firmware/acpi/platform_profile', 'balanced'); write('firmware/acpi/platform_profile_choices', 'quiet balanced');
  assert.equal(reader.sample().profiles[0].available, true);
  write('firmware/acpi/platform_profile', 'not-advertised'); assert.equal(reader.sample().profiles[0].available, false);
  fs.unlinkSync(path.join(root, 'firmware/acpi/platform_profile')); fs.unlinkSync(path.join(root, 'firmware/acpi/platform_profile_choices'));
  assert.deepEqual(reader.sample().profiles, []);
  const fsImpl = { ...fs, readdirSync() { throw Object.assign(new Error('private path'), { code: 'EACCES' }); }, readFileSync() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  const denied = createLinuxPlatformState({ sysRoot: root, fsImpl }).sample();
  assert.equal(denied.power.adaptorStatus, null); assert.ok(denied.errors.every(e => e.code === 'EACCES'));
});
test('Acer ADAPTOR_STATUS queries bypass GPU sampling, preserve zero and fail for unclassified inputs', async t => {
  const { reader, write } = fixture(t); let observations = 0;
  const handler = createReadOnlyHandler({ sample() { assert.fail('Power query must not wait for GPU'); }, readPlatformState: () => reader.sample() }, { onPlatformState: () => observations++ });
  const query = () => handler({ id: 20, payload: { Function: 'ADAPTOR_STATUS' } }, 'main');
  assert.deepEqual(await query(), { request: 'ADAPTOR_STATUS', result: '0', data: { status: 1 } });
  write('class/power_supply/ACAD/online', '0'); assert.equal((await query()).data.status, 0);
  write('class/power_supply/ACAD/online', 'broken'); assert.equal((await query()).result, '1');
  assert.equal(observations, 3);
  assert.equal((await handler({ id: 20, payload: { Function: 'AC_STATUS' } }, 'main')).result, '1');
  assert.equal((await handler({ id: 20, payload: { Function: 'OPERATING_MODE' } }, 'main')).result, '1');
  assert.equal((await handler({ id: 100, payload: { Function: 'OPERATING_MODE', Parameter: { mode: 4 } } }, 'main')).result, '1');
});
