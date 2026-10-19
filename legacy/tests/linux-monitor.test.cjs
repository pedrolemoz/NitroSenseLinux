const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLinuxMonitor } = require('../lib/linux-monitor.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.monitor-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, value);
  };
  write('proc/cpuinfo', 'processor : 1\nphysical id : 0\nmodel name : Fixture CPU\ncpu MHz : 2000\n\nprocessor : 0\nphysical id : 0\nmodel name : Fixture CPU\ncpu MHz : 1000\n');
  write('proc/stat', 'cpu 100 20 30 400 10 5 5 0 100 20\ncpu0 1 0 0 1\ncpu1 1 0 0 1\n');
  write('proc/meminfo', 'MemTotal: 8192000 kB\nMemAvailable: 2048000 kB\n');
  write('sys/devices/system/cpu/cpufreq/policy0/cpuinfo_max_freq', '4500000');
  write('sys/class/hwmon/hwmon0/name', 'acer');
  write('sys/class/hwmon/hwmon0/temp1_input', '99000');
  write('sys/class/hwmon/hwmon0/fan1_input', '2500');
  write('sys/class/hwmon/hwmon2/name', 'coretemp');
  write('sys/class/hwmon/hwmon2/temp1_label', 'Package id 0');
  write('sys/class/hwmon/hwmon2/temp1_input', '55000');
  let now = 0;
  const options = { procRoot: path.join(root, 'proc'), sysRoot: path.join(root, 'sys'), clock: () => now };
  return { root, write, options, tick: () => { now += 1000; }, monitor: createLinuxMonitor(options) };
}

test('live sampler converts real source units and uses labeled CPU rather than Acer channel order', t => {
  const { monitor } = fixture(t);
  const sample = monitor.sample();
  assert.equal(sample.data.CPU_CORE_AMOUNT, 2);
  assert.deepEqual(sample.data.CPU_CORE_FREQUENCY, [1000, 2000]);
  assert.equal(sample.data.CPU_FREQUENCY, 1500);
  assert.equal(sample.data.CPU_MAX_FREQUENCY, 4500);
  assert.equal(sample.data.CPU_TEMPERATURE, 55);
  assert.equal(sample.data.RAM_TOTAL, 8000);
  assert.equal(sample.data.RAM_USAGE, 75);
  assert.equal(Object.hasOwn(sample.data, 'CPU_USAGE'), false);
  assert.equal(Object.hasOwn(sample.data, 'CPU_FANSPEED'), false);
  assert.equal(Object.hasOwn(sample.data, 'GPU1_TEMPERATURE'), false);
  assert.deepEqual(sample.cpuInfo, [{ cpu_index: 0, cpu_name: 'Fixture CPU', cpu_max_frequency: 4500 }]);
  assert.deepEqual(sample.errors, []);
});

test('CPU deltas avoid double guest accounting and reset after counter regressions or topology changes', t => {
  const { monitor, write, tick } = fixture(t);
  monitor.sample(); tick();
  write('proc/stat', 'cpu 120 20 30 480 10 5 5 0 120 20\ncpu0 1 0 0 1\ncpu1 1 0 0 1\n');
  assert.equal(monitor.sample().data.CPU_USAGE, 20);
  tick(); write('proc/stat', 'cpu 1 0 0 1 0 0 0 0 0 0\ncpu0 1 0 0 1\ncpu1 1 0 0 1\n');
  assert.equal(Object.hasOwn(monitor.sample().data, 'CPU_USAGE'), false);
  tick(); write('proc/stat', 'cpu 10 0 0 10 0 0 0 0 0 0\ncpu0 1 0 0 1\n');
  assert.equal(Object.hasOwn(monitor.sample().data, 'CPU_USAGE'), false);
});

test('samples refresh after cache interval, rediscover hwmon and omit failed readings without stale fallback', t => {
  const { monitor, write, tick, root } = fixture(t);
  const first = monitor.sample(); first.data.CPU_TEMPERATURE = -999;
  write('sys/class/hwmon/hwmon2/temp1_input', '60000');
  assert.equal(monitor.sample().data.CPU_TEMPERATURE, 55);
  fs.renameSync(path.join(root, 'sys/class/hwmon/hwmon2'), path.join(root, 'sys/class/hwmon/hwmon7'));
  tick(); assert.equal(monitor.sample().data.CPU_TEMPERATURE, 60);
  write('sys/class/hwmon/hwmon7/temp1_input', 'bad');
  write('proc/meminfo', 'MemTotal: 10 kB\nMemAvailable: 20 kB\n');
  tick(); const failed = monitor.sample();
  assert.equal(Object.hasOwn(failed.data, 'CPU_TEMPERATURE'), false);
  assert.equal(Object.hasOwn(failed.data, 'RAM_USAGE'), false);
  assert.equal(failed.errors.length, 2);
  assert.ok(failed.errors.every(e => e.code === 'INVALID_READING'));
});

test('permission denial and malformed proc data remain errors, without host or historical fallback', t => {
  const { options } = fixture(t);
  const fsImpl = { ...fs, readFileSync() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  const sample = createLinuxMonitor({ ...options, fsImpl }).sample();
  assert.deepEqual(sample.data, {});
  assert.deepEqual(sample.cpuInfo, []);
  assert.ok(sample.errors.every(e => e.code === 'EACCES'));
});

test('verified ANV15-52 Linux 7.0 acer-wmi contract attributes actual CPU/GPU fans and GPU temperature', t => {
  const f = fixture(t);
  f.write('sys/class/dmi/id/product_name', 'Nitro ANV15-52');
  f.write('sys/class/hwmon/hwmon0/fan2_input', '2400');
  f.write('sys/class/hwmon/hwmon0/temp2_input', '51000');
  const driver = path.join(f.root, 'sys/bus/platform/drivers/acer-wmi');
  fs.mkdirSync(driver, { recursive: true });
  fs.mkdirSync(path.join(f.root, 'sys/class/hwmon/hwmon0/device'), { recursive: true });
  fs.symlinkSync(driver, path.join(f.root, 'sys/class/hwmon/hwmon0/device/driver'));
  const sample = createLinuxMonitor({ ...f.options, kernelRelease: '7.0.0-30-generic' }).sample();
  assert.equal(sample.data.CPU_FANSPEED, 2500); assert.equal(sample.data.GPU1_FANSPEED, 2400);
  assert.equal(sample.data.GPU1_TEMPERATURE, 51); assert.equal(sample.data.CPU_TEMPERATURE, 55);
  assert.match(sample.sources.GPU1_TEMPERATURE, /hwmon0\/temp2_input/);
  assert.equal(createLinuxMonitor({ ...f.options, kernelRelease: '6.8.0' }).sample().data.CPU_FANSPEED, undefined);
  f.write('sys/class/dmi/id/product_name', 'Other Model');
  assert.equal(createLinuxMonitor({ ...f.options, kernelRelease: '7.0.0' }).sample().data.CPU_FANSPEED, undefined);
});

test('real battery readings exclude peripheral batteries and do not replace missing charge by zero', t => {
  const f = fixture(t);
  f.write('sys/class/power_supply/BAT1/type', 'Battery');
  f.write('sys/class/power_supply/BAT1/scope', 'System');
  f.write('sys/class/power_supply/BAT1/capacity', '80');
  f.write('sys/class/power_supply/BAT1/cycle_count', '130');
  f.write('sys/class/power_supply/BAT1/charge_full', '4000');
  f.write('sys/class/power_supply/BAT1/charge_full_design', '5000');
  f.write('sys/class/power_supply/mouse/type', 'Battery');
  f.write('sys/class/power_supply/mouse/scope', 'Device');
  f.write('sys/class/power_supply/mouse/capacity', '10');
  let sample = createLinuxMonitor(f.options).sample();
  assert.equal(sample.data.BATTERY_PERCENTAGE, 80); assert.equal(sample.data.BATTERY_CYCLE_COUNT, 130);
  assert.equal(sample.data.BATTERY_MAX_CAPACITY, 80);
  f.write('sys/class/power_supply/BAT1/capacity', 'bad');
  sample = createLinuxMonitor(f.options).sample();
  assert.equal(sample.data.BATTERY_PERCENTAGE, undefined);
  assert.equal(sample.data.BATTERY_CYCLE_COUNT, 130);
});
