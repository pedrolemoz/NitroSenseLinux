const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { collectInventory } = require('../scripts/inspect-linux.cjs');

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-linux-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, value);
  }
  return { sysRoot: path.join(root, 'sys'), procRoot: path.join(root, 'proc'), kernelRelease: 'fixture-kernel' };
}

test('inventories labeled sensors, power, CPU and GUIDs without attributing sensors by order', t => {
  const options = fixture(t, {
    'sys/class/dmi/id/product_name': 'Nitro ANV15-52\n',
    'sys/class/dmi/id/product_serial': 'PRIVATE-SERIAL',
    'sys/class/hwmon/hwmon2/name': 'coretemp\n',
    'sys/class/hwmon/hwmon2/temp1_input': '51000\n',
    'sys/class/hwmon/hwmon2/temp1_label': 'Package id 0\n',
    'sys/class/hwmon/hwmon2/temp1_crit': '100000\n',
    'sys/class/hwmon/hwmon2/pwm1_enable': '2\n',
    'sys/class/hwmon/hwmon2/unrelated_secret': 'DO NOT READ',
    'sys/class/power_supply/BAT0/capacity': '75\n',
    'sys/class/power_supply/BAT0/serial_number': 'PRIVATE-BATTERY',
    'sys/bus/wmi/devices/67C3371D-95A3-4C37-BB61-DD47B491DAAB/modalias': 'wmi:example',
    'sys/devices/system/cpu/cpufreq/policy0/scaling_cur_freq': '1200000\n',
    'proc/cpuinfo': 'processor : 0\nmodel name : Test CPU\nprocessor : 1\nmodel name : Test CPU\n'
  });
  const inventory = collectInventory(options);
  assert.equal(inventory.kernelRelease, 'fixture-kernel');
  assert.deepEqual(inventory.cpuModel.models, ['Test CPU']);
  const attrs = inventory.hwmon[0].attributes;
  assert.equal(attrs.find(attr => attr.source.endsWith('/temp1_input')).value, '51000');
  assert.equal(attrs.find(attr => attr.source.endsWith('/temp1_label')).value, 'Package id 0');
  assert.equal(inventory.wmiDevices.length, 1);
  assert.equal(inventory.powerSupply[0].attributes[0].value, '75');
  const json = JSON.stringify(inventory);
  assert.ok(!json.includes('PRIVATE-'));
  assert.ok(!json.includes('DO NOT READ'));
  assert.ok(!json.includes(options.sysRoot.replaceAll('\\', '\\\\')));
  assert.equal(inventory.hwmon[0].cpu, undefined);
  assert.match(inventory.purpose, /not a hardware control test/);
});

test('reports absent paths and permission errors without inventing zero sensors', t => {
  const options = fixture(t, {
    'sys/class/hwmon/hwmon0/name': 'unreadable',
    'sys/class/hwmon/hwmon0/fan1_input': '2000'
  });
  const fsImpl = { readdirSync: (...args) => fs.readdirSync(...args),
    readFileSync: (name, encoding) => {
      if (name.endsWith('fan1_input')) { const error = new Error('Fixture access denied'); error.code = 'EACCES'; throw error; }
      return fs.readFileSync(name, encoding);
    } };
  const inventory = collectInventory({ ...options, fsImpl });
  const fan = inventory.hwmon[0].attributes.find(attr => attr.source.endsWith('/fan1_input'));
  assert.equal(fan.error.code, 'EACCES');
  assert.equal(fan.value, undefined);
  assert.equal(inventory.cpuModel.error.code, 'ENOENT');
  assert.equal(inventory.dmi[0].error.code, 'ENOENT');
  assert.ok(inventory.errors.some(item => item.source === '/sys/class/power_supply' && item.error.code === 'ENOENT'));
});

test('captures modern platform-profile class when legacy ACPI files are absent', t => {
  const options = fixture(t, {
    'sys/class/platform-profile/platform-profile-0/name': 'acer-wmi',
    'sys/class/platform-profile/platform-profile-0/profile': 'balanced',
    'sys/class/platform-profile/platform-profile-0/choices': 'quiet balanced performance'
  });
  const inventory = collectInventory(options);
  assert.equal(inventory.platformProfiles[0].attributes[0].error.code, 'ENOENT');
  assert.equal(inventory.platformProfiles[1].attributes.find(attr => attr.source.endsWith('/profile')).value, 'balanced');
  assert.equal(inventory.platformProfiles[1].attributes.find(attr => attr.source.endsWith('/choices')).value, 'quiet balanced performance');
});

test('keeps legacy ACPI profile and bounds filesystem reads', t => {
  const options = fixture(t, {
    'sys/firmware/acpi/platform_profile': 'balanced\n',
    'sys/firmware/acpi/platform_profile_choices': 'quiet balanced performance\n'
  });
  const inventory = collectInventory(options);
  assert.equal(inventory.platformProfiles[0].attributes[0].value, 'balanced');
  const limited = collectInventory({ ...options, maxFiles: 2, maxDirectories: 1 });
  assert.equal(limited.counts.files, 2);
  assert.equal(limited.counts.directories, 1);
  assert.ok(limited.limits.includes('files'));
  assert.ok(limited.limits.includes('directories'));
});
