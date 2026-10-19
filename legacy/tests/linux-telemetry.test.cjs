const test = require('node:test');
const assert = require('node:assert/strict');
const { createLinuxTelemetry: makeTelemetry } = require('../lib/linux-telemetry.cjs');
const createLinuxTelemetry = options => makeTelemetry({ platform: { sample: () => ({ power: { adaptorStatus: null }, profiles: [], errors: [] }) }, ...options });
const { parseNvidiaOutput } = require('../lib/nvidia-monitor.cjs');
const { createReadOnlyHandler, startAcerServices } = require('../lib/acer-service.cjs');
const { AcerClient } = require('../lib/acer-client.cjs');
const cpu = () => ({ data: { RAM_TOTAL: 8000 }, sources: { RAM_TOTAL: 'fixture:meminfo' }, cpuInfo: [], errors: [] });
const GPU = '0000:01:00.0, NVIDIA Fixture GPU, 55, 12, 1000, 3000\n';

test('telemetry combines actual provider fields and does not let GPU data overwrite CPU fields', async () => {
  const gpu = parseNvidiaOutput(GPU); gpu.data.RAM_TOTAL = 1;
  const telemetry = createLinuxTelemetry({ cpu: { sample: cpu }, gpu: { sample: async () => gpu } });
  const sample = await telemetry.sample();
  assert.equal(sample.data.RAM_TOTAL, 8000); assert.equal(sample.data.GPU1_TEMPERATURE, 55);
  assert.equal(sample.gpuInfo[0].gpu_name, 'NVIDIA Fixture GPU');
  assert.equal(sample.sources.GPU1_FREQUENCY, 'nvidia-smi:0000:01:00.0:clocks.current.graphics'); telemetry.close();
});
test('GPU error preserves CPU availability while clearing stale GPU data and identity', async () => {
  let fail = false, now = 0;
  const telemetry = createLinuxTelemetry({ cpu: { sample: cpu }, clock: () => now, gpu: { async sample() {
    if (fail) throw Object.assign(new Error('PRIVATE_OUTPUT'), { code: 'ENOENT' }); return parseNvidiaOutput(GPU);
  } } });
  assert.equal((await telemetry.sample()).data.GPU1_USAGE, 12);
  fail = true; now = 1000; const sample = await telemetry.sample();
  assert.equal(sample.data.RAM_TOTAL, 8000); assert.equal(Object.hasOwn(sample.data, 'GPU1_USAGE'), false);
  assert.deepEqual(sample.gpuInfo, []); assert.equal(sample.errors[0].code, 'ENOENT');
  assert.doesNotMatch(JSON.stringify(sample), /PRIVATE_/); telemetry.close();
});
test('concurrent requests share a collection, close cancels providers and prevents a late success', async () => {
  let resolve, calls = 0, stopped = 0;
  const telemetry = createLinuxTelemetry({ cpu: { sample: cpu }, gpu: {
    sample() { calls++; return new Promise(done => { resolve = done; }); }, close() { stopped++; },
  } });
  const results = Promise.allSettled([telemetry.sample(), telemetry.sample()]);
  await new Promise(done => setImmediate(done)); assert.equal(calls, 1);
  telemetry.close(); telemetry.close(); resolve(parseNvidiaOutput(GPU));
  const failed = await results; assert.ok(failed.every(value => value.reason.code === 'ERR_NITROSENSE_CLOSED')); assert.equal(stopped, 1);
});
test('platform snapshots are independent of GPU collection and kept as raw diagnostics', async () => {
  let status = 1, graphics = 0;
  const telemetry = createLinuxTelemetry({ cpu: { sample: cpu }, gpu: { sample() { graphics++; return parseNvidiaOutput(GPU); } },
    platform: { sample: () => ({ power: { adaptorStatus: status }, profiles: [{ current: 'performance', acerMode: null }], errors: [] }) } });
  assert.equal(telemetry.readPlatformState().power.adaptorStatus, 1); assert.equal(graphics, 0);
  status = 0; assert.equal(telemetry.readPlatformState().power.adaptorStatus, 0);
  const sample = await telemetry.sample(); assert.equal(sample.platformState.profiles[0].acerMode, null);
  assert.equal(Object.hasOwn(sample.data, 'OPERATING_MODE'), false); telemetry.close();
});
test('GPU capability and monitor readings flow over both Acer services, with explicit failure when driver disappears', async t => {
  let failed = false, now = 0;
  const monitor = createLinuxTelemetry({ cpu: { sample: cpu }, clock: () => now, gpu: { async sample() {
    if (failed) throw Object.assign(new Error('driver lost'), { code: 'NVIDIA_QUERY_FAILED' }); return parseNvidiaOutput(GPU);
  } } });
  t.after(() => monitor.close());
  const service = await startAcerServices({ ports: { main: 0, monitor: 0 }, handler: createReadOnlyHandler(monitor) });
  t.after(() => service.close());
  const main = new AcerClient({ port: service.addresses.main.port }), sys = new AcerClient({ port: service.addresses.monitor.port });
  t.after(() => { main.close(); sys.close(); });
  assert.deepEqual(await main.request(0, { Function: 'SUPPORT_GPU_INFO' }), [{ gpu_index: 1, gpu_name: 'NVIDIA Fixture GPU' }]);
  assert.equal((await sys.request(10, {})).GPU1_FREQUENCY, 1000);
  failed = true; now = 1000;
  await assert.rejects(main.request(0, { Function: 'SUPPORT_GPU_INFO' }), { code: 'ERR_NITROSENSE_SERVICE', result: 1 });
  assert.deepEqual(await sys.request(10, {}), { RAM_TOTAL: 8000 });
});
