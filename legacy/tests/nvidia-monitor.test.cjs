const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { QUERY_ARGS, parseNvidiaOutput, createNvidiaMonitor } = require('../lib/nvidia-monitor.cjs');
const ROW = '00000000:01:00.0, NVIDIA Fixture GPU, 52, 0, 210, 3105\n';
function fixture(options = {}) {
  const children = [], calls = []; let now = 0;
  const monitor = createNvidiaMonitor({ platform: 'linux', clock: () => now, minIntervalMs: 1000,
    spawnImpl(command, args, settings) {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kills = []; child.kill = signal => child.kills.push(signal);
      children.push(child); calls.push({ command, args, settings }); return child;
    }, ...options });
  const complete = (child = children.at(-1), text = ROW) => { child.stdout.emit('data', Buffer.from(text)); child.emit('close', 0, null); };
  return { monitor, children, calls, complete, tick: () => { now += 2000; } };
}
test('GPU parser publishes actual single-device readings, units and stable PCI identity without RPM/idle inference', () => {
  const result = parseNvidiaOutput(ROW);
  assert.deepEqual(result.data, { GPU1_TEMPERATURE: 52, GPU1_USAGE: 0, GPU1_FREQUENCY: 210, GPU1_MAX_FREQUENCY: 3105 });
  assert.deepEqual(result.gpuInfo, [{ gpu_index: 1, gpu_name: 'NVIDIA Fixture GPU' }]);
  assert.equal(result.devices[0].pciBusId, '0000:01:00.0');
  assert.equal(Object.hasOwn(result.data, 'GPU1_FANSPEED'), false);
  assert.equal(Object.hasOwn(result.data, 'GPU1_IDLE_STATUS'), false);
  assert.equal(result.errors.length, 0);
});
test('CSV quoted names, N/A and invalid cells stay distinct from actual zero', () => {
  const result = parseNvidiaOutput('0000:01:00.0, "NVIDIA, Fixture ""GPU""", N/A, 101, 0, [Not Supported]\r\n');
  assert.equal(result.gpuInfo[0].gpu_name, 'NVIDIA, Fixture "GPU"');
  assert.deepEqual(result.data, { GPU1_FREQUENCY: 0 });
  assert.deepEqual(result.errors.map(e => e.code), ['UNAVAILABLE', 'INVALID_READING', 'UNAVAILABLE']);
});
test('multiple GPUs are not arbitrarily mapped to the Acer GPU1 channel', () => {
  const result = parseNvidiaOutput(ROW + ROW.replace('01:00.0', '02:00.0'));
  assert.deepEqual(result.data, {}); assert.deepEqual(result.gpuInfo, []);
  assert.equal(result.devices.length, 2);
  assert.equal(result.errors.at(-1).code, 'AMBIGUOUS_GPU_CHANNEL');
  assert.throws(() => parseNvidiaOutput(ROW + ROW), { code: 'DUPLICATE_GPU_IDENTITY' });
});
test('malformed output, identity and unsupported schema never manufacture a device', () => {
  for (const text of ['No devices were found', 'wrong, GPU, 5, 5, 5, 5', ROW + 'extra', '"unterminated']) assert.throws(() => parseNvidiaOutput(text));
  const empty = parseNvidiaOutput(''); assert.deepEqual(empty.gpuInfo, []); assert.equal(empty.errors[0].code, 'NO_GPU_REPORTED');
});
test('reader invokes only fixed read-only arguments without a shell and coalesces/cache-isolates results', async () => {
  const f = fixture();
  const first = f.monitor.sample(), second = f.monitor.sample();
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].args, [...QUERY_ARGS]);
  assert.equal(f.calls[0].settings.shell, false); assert.equal(f.calls[0].settings.env.LC_ALL, 'C');
  f.complete(); const [a, b] = await Promise.all([first, second]);
  a.data.GPU1_USAGE = 99; assert.equal(b.data.GPU1_USAGE, 0);
  assert.equal((await f.monitor.sample()).data.GPU1_USAGE, 0); assert.equal(f.calls.length, 1);
  f.monitor.close();
});
test('query failure after cache expiry discards the earlier successful GPU reading and hides raw stderr', async () => {
  const f = fixture(), first = f.monitor.sample(); f.complete(); await first; f.tick();
  const failed = assert.rejects(f.monitor.sample(), error => error.code === 'NVIDIA_QUERY_FAILED' && !error.message.includes('PRIVATE'));
  f.children.at(-1).stderr.emit('data', Buffer.from('PRIVATE_DRIVER_LOG')); f.children.at(-1).emit('close', 1, null); await failed;
  await assert.rejects(f.monitor.sample(), { code: 'NVIDIA_QUERY_FAILED' });
  assert.equal(f.calls.length, 2); f.monitor.close();
});
test('absolute deadline rejects without waiting for close and prevents spawning more stuck helpers', async () => {
  const f = fixture({ timeoutMs: 20 });
  await assert.rejects(f.monitor.sample(), { code: 'NVIDIA_QUERY_TIMEOUT' });
  assert.deepEqual(f.children[0].kills, ['SIGKILL']);
  f.tick(); await assert.rejects(f.monitor.sample(), { code: 'NVIDIA_QUERY_TIMEOUT' }); assert.equal(f.calls.length, 1);
  f.children[0].emit('close', null, 'SIGKILL');
  const recovered = f.monitor.sample(); f.complete(); assert.equal((await recovered).data.GPU1_TEMPERATURE, 52);
  f.monitor.close();
});
test('output cap, missing executable and close all reject explicitly', async () => {
  const capped = fixture({ maxBytes: 10 });
  const limit = assert.rejects(capped.monitor.sample(), { code: 'NVIDIA_OUTPUT_LIMIT' });
  capped.children[0].stdout.emit('data', Buffer.from(ROW)); await limit;
  assert.deepEqual(capped.children[0].kills, ['SIGKILL']); capped.monitor.close();
  const missing = fixture(), pending = assert.rejects(missing.monitor.sample(), { code: 'ENOENT' });
  missing.children[0].emit('error', Object.assign(new Error('private path'), { code: 'ENOENT' }));
  missing.children[0].emit('close', -2, null); await pending; missing.monitor.close();
  const closed = fixture(), unfinished = assert.rejects(closed.monitor.sample(), { code: 'ERR_NITROSENSE_CLOSED' });
  closed.monitor.close(); await unfinished;
  await assert.rejects(closed.monitor.sample(), { code: 'ERR_NITROSENSE_CLOSED' });
});
test('production reader refuses this Windows host before starting a helper', async () => {
  const f = fixture({ platform: 'win32' });
  await assert.rejects(f.monitor.sample(), { code: 'ERR_NITROSENSE_UNSUPPORTED' }); assert.equal(f.calls.length, 0);
});

test('driver/library mismatch is actionable without exporting raw NVML output', async () => {
  const f = fixture();
  const pending = assert.rejects(f.monitor.sample(), error => error.code === 'NVIDIA_DRIVER_LIBRARY_MISMATCH' && !error.message.includes('PRIVATE'));
  f.children[0].stderr.emit('data', Buffer.from('PRIVATE Failed to initialize NVML: Driver/library '));
  f.children[0].stderr.emit('data', Buffer.from('version mismatch\nNVML library version: 595.99\n'));
  f.children[0].emit('close', 18, null);
  await pending; f.monitor.close();
});
