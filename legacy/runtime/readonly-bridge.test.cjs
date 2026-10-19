const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMonitorData, pumpMonitorData, rpcReply } = require('./readonly-bridge.cjs');

test('normalization preserves partial samples, actual zero and negative temperatures without manufacturing NaN', () => {
  const source = { CPU_CORE_AMOUNT: 2, CPU_CORE_FREQUENCY: [1200.4, 2100.1], CPU_USAGE: 0,
    CPU_TEMPERATURE: -1, RAM_TOTAL: 1024.2, RAM_USAGE: 25.125, GPU1_USAGE: undefined,
    WIFI_UPLOAD: NaN, CPU_FREQUENCY: null, SYS1_FANSPEED: '2200', privateToken: 'DO_NOT_EXPORT' };
  const output = normalizeMonitorData(source);
  assert.deepEqual(output.CPU_CORE_FREQUENCY, [1201, 2101]);
  assert.equal(output.CPU_USAGE, 0); assert.equal(output.CPU_TEMPERATURE, -1);
  assert.equal(output.RAM_TOTAL, 1025); assert.equal(output.RAM_USAGE, 25.13);
  for (const name of ['GPU1_USAGE', 'WIFI_UPLOAD', 'CPU_FREQUENCY', 'SYS1_FANSPEED', 'privateToken']) assert.equal(Object.hasOwn(output, name), false);
  assert.ok(output.timeStamp instanceof Date);
  assert.deepEqual(source.CPU_CORE_FREQUENCY, [1200.4, 2100.1]);
  assert.equal(Object.hasOwn(normalizeMonitorData({ CPU_CORE_AMOUNT: 2, CPU_CORE_FREQUENCY: [1200] }), 'CPU_CORE_FREQUENCY'), false);
});

test('monitor pump always releases mutex and broadcasts unavailable instead of retaining old data', async () => {
  let fail = false;
  const sent = [], mqtt = { broadcast: (...args) => sent.push(args) };
  const sdk = { pumpData: true, isGettingMonitorData: false, adapter: { async getMonitorData() {
    if (fail) throw Object.assign(new Error('secret details'), { code: 'ERR_NITROSENSE_DISCONNECTED' });
    return { RAM_USAGE: 10 };
  } } };
  const good = await pumpMonitorData(sdk, 1, mqtt, 1, 2);
  assert.equal(good.RAM_USAGE, 10); assert.equal(good._linux.available, true);
  fail = true;
  const failed = await pumpMonitorData(sdk, 1, mqtt, 1, 2);
  assert.equal(sdk.isGettingMonitorData, false);
  assert.equal(Object.hasOwn(failed, 'RAM_USAGE'), false);
  assert.equal(failed._linux.available, false);
  assert.equal(failed._linux.error, 'ERR_NITROSENSE_DISCONNECTED');
  assert.deepEqual(sent.map(event => event[0]), ['UPDATE_MONITOR_DATA', 'UPDATE_MONITOR_DATA']);
  assert.doesNotMatch(JSON.stringify(failed), /secret details/);
});

test('pump suppresses concurrent collection and uses system adapter for HID path', async () => {
  let complete, calls = 0;
  const sdk = { pumpData: true, bEC_HID_Support: true, sysMonitorAdapter: {
    getMonitorData() { calls++; return new Promise(resolve => { complete = resolve; }); }
  } };
  const sent = [], mqtt = { broadcast: (...args) => sent.push(args) };
  const first = pumpMonitorData(sdk, 2, mqtt, 1, 2);
  assert.equal(await pumpMonitorData(sdk, 1, mqtt, 1, 2), undefined);
  complete({ CPU_USAGE: 42 }); await first;
  assert.equal(calls, 1); assert.equal(sent[0][0], 'UPDATE_OVERLAY_MONITOR_DATA');
  assert.equal(sdk.isGettingMonitorData, false);
});

test('RPC failure becomes a correlated error reply without copying raw details', async () => {
  const response = await rpcReply('7', () => { throw Object.assign(new Error('PRIVATE_TOKEN'), {
    code: 'ERR_NITROSENSE_SERVICE', request: 'SUPPORT_FAN_CONTROL', result: 1, path: 'PRIVATE_PATH' }); });
  assert.deepEqual(response, { callId: '7', reason: 'error', result: null,
    error: { code: 'ERR_NITROSENSE_SERVICE', request: 'SUPPORT_FAN_CONTROL', result: 1 } });
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_/);
  assert.deepEqual(await rpcReply('8', async () => 0), { callId: '8', reason: 'fromFunction', result: 0 });
});
