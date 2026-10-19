const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSensors, readLinuxSensors } = require('../lib/linux-sensors.cjs');

function inventory(attributes) {
  return { schemaVersion: 1, collectedAt: 'fixture', kernelRelease: 'fixture',
    hwmon: [{ source: '/sys/class/hwmon/hwmon29', attributes: Object.entries(attributes).map(([name, value]) =>
      ({ source: `/sys/class/hwmon/hwmon29/${name}`, ...(typeof value === 'object' ? value : { value }) })) }],
    platformProfiles: [], errors: [], limits: [] };
}

test('converts units, preserves real zero, labels and unidentified Acer channels', () => {
  const snapshot = normalizeSensors(inventory({ name: 'acer', temp1_input: '54000', temp2_input: '-1500',
    fan1_input: '2725', fan2_input: '0', temp1_label: 'CPU' }));
  assert.equal(snapshot.hwmon[0].name, 'acer');
  assert.deepEqual(snapshot.hwmon[0].readings.map(r => r.value), [54, -1.5, 2725, 0]);
  assert.equal(snapshot.hwmon[0].readings[0].label, 'CPU');
  assert.equal(snapshot.hwmon[0].readings[2].label, null);
  assert.deepEqual(snapshot.hwmon[0].pwmInterfaces, []);
});

test('propagates absent/denied and malformed readings without substituting values', () => {
  const snapshot = normalizeSensors(inventory({ name: 'acer', fan1_input: { error: { code: 'EACCES' } },
    temp1_input: '', temp2_input: '123junk', temp3_input: '9007199254740992', fan2_input: '-1',
    temp4_input: { value: '42', truncated: true } }));
  for (const reading of snapshot.hwmon[0].readings) {
    assert.ok(reading.error);
    assert.equal(reading.value, undefined);
  }
  assert.equal(snapshot.hwmon[0].readings[0].error.code, 'EACCES');
});

test('rediscovers hwmon after renumbering and reads fresh values without filesystem writes', () => {
  let number = 4, rpm = '2000';
  const fsImpl = {
    readdirSync(name) {
      const source = name.replaceAll('\\', '/');
      if (source === '/sys/class/hwmon') return [`hwmon${number}`];
      if (source === `/sys/class/hwmon/hwmon${number}`) return ['name', 'fan1_input'];
      return [];
    },
    readFileSync(name) {
      const source = name.replaceAll('\\', '/');
      if (source === `/sys/class/hwmon/hwmon${number}/name`) return 'acer';
      if (source === `/sys/class/hwmon/hwmon${number}/fan1_input`) return rpm;
      const error = new Error('Absent fixture path'); error.code = 'ENOENT'; throw error;
    }
  };
  assert.equal(readLinuxSensors({ fsImpl }).hwmon[0].readings[0].value, 2000);
  number = 19; rpm = '2600';
  const second = readLinuxSensors({ fsImpl });
  assert.equal(second.hwmon[0].source, '/sys/class/hwmon/hwmon19');
  assert.equal(second.hwmon[0].readings[0].value, 2600);
});

test('keeps provider identity, errors and announced choices without mapping Acer modes', () => {
  const input = inventory({ name: 'acer' });
  input.platformProfiles = [{ source: '/sys/class/platform-profile/platform-profile-7', attributes: [
    { source: '/sys/class/platform-profile/platform-profile-7/name', value: 'acer-wmi' },
    { source: '/sys/class/platform-profile/platform-profile-7/profile', error: { code: 'EIO' } },
    { source: '/sys/class/platform-profile/platform-profile-7/choices', value: 'quiet balanced performance' }
  ] }];
  const profile = normalizeSensors(input).profiles[0];
  assert.equal(profile.name.value, 'acer-wmi');
  assert.equal(profile.current.error.code, 'EIO');
  assert.deepEqual(profile.choices.values, ['quiet', 'balanced', 'performance']);
});
