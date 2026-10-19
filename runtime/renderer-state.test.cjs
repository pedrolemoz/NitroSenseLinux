const test = require('node:test');
const assert = require('node:assert/strict');
const { CapabilityState, monitorSample, percentage, ramUsage, temperature,
  displayNumber, cpuDetails, temperatureExtrema, cpuGauge } = require('./renderer-state.cjs');

test('renderer models distinguish unavailable readings, measured zero, and fresh failures', () => {
  const empty = monitorSample(null);
  assert.equal(empty.CPU_USAGE, null); assert.equal(empty._linux.available, false);
  const valid = monitorSample({ CPU_USAGE: 0, RAM_USAGE: 0, RAM_TOTAL: 8000, CPU_TEMPERATURE: 0 });
  assert.equal(valid.CPU_USAGE, 0); assert.equal(valid._linux.available, true);
  assert.equal(valid.GPU1_USAGE, null);
  const failed = monitorSample({ _linux: { error: 'ERR_NITROSENSE_DISCONNECTED' } });
  assert.equal(failed.RAM_TOTAL, null); assert.equal(failed.CPU_USAGE, null);
  assert.equal(failed._linux.error, 'ERR_NITROSENSE_DISCONNECTED');
});
test('formatting avoids null-to-zero conversions and preserves real zero in both temperature units', () => {
  for (const missing of [null, undefined, NaN, Infinity, '0']) {
    assert.equal(displayNumber(missing), '--'); assert.equal(percentage(missing), '--');
    assert.equal(temperature(missing, true), '--');
  }
  assert.equal(displayNumber(0), '0'); assert.equal(percentage(0), '0.0');
  assert.equal(temperature(0, false), 0); assert.equal(temperature(0, true), 32);
  assert.equal(temperature(-10, true), 14);
  assert.equal(ramUsage({ RAM_TOTAL: 8000, RAM_USAGE: null }), '--');
  assert.equal(ramUsage({ RAM_TOTAL: 8000, RAM_USAGE: 0 }, true), '0.0');
});
test('capability errors are explicit, clear previous data and can recover without a fake empty list', async () => {
  let fail = false;
  const state = new CapabilityState(async () => {
    if (fail) throw Object.assign(new Error('PRIVATE_TOKEN'), { code: 'ERR_NITROSENSE_SERVICE', request: 'SUPPORT_CPU_INFO', result: 1 });
    return [{ cpu_name: 'Fixture' }];
  });
  await state.ready; assert.equal(state.state, 'available');
  fail = true; await state.refresh();
  assert.equal(state.state, 'unavailable'); assert.equal(state.data, null);
  assert.deepEqual(state.error, { code: 'ERR_NITROSENSE_SERVICE', request: 'SUPPORT_CPU_INFO', result: 1 });
  assert.doesNotMatch(JSON.stringify(state.error), /PRIVATE_/);
  fail = false; await state.refresh(); assert.equal(state.state, 'available');
});
test('an older capability reply cannot overwrite a newer failed refresh', async () => {
  let first;
  const state = new CapabilityState(() => new Promise(resolve => { first = resolve; }));
  state._func = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  await state.refresh(); first([1]); await state.ready; await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.state, 'unavailable'); assert.equal(state.data, null);
});
test('per-core cards and temperature extrema drop missing data without dropping measured zero or negative temperature', () => {
  const view = { CPU_Core_FREQUENCY: [{ index: 0 }], SetAndGetData: data => ({ data }) };
  cpuDetails(view, 2, null); assert.deepEqual(view.CPU_Core_FREQUENCY, []);
  cpuDetails(view, 2, [1000, 2000]); assert.equal(view.CPU_Core_FREQUENCY[1].FrquenctList.data, 2000);
  view.system = {}; view.pss = { monitorDataStore: { getTemperatureList: () => [null, undefined, NaN, 0, -1, 50] } };
  temperatureExtrema(view, 1, 2, 3);
  assert.equal(view.cpuTempratureMin, -1); assert.equal(view.cpuTempratureMax, 50);
  view.pss.monitorDataStore.getTemperatureList = () => [null];
  temperatureExtrema(view, 1, 2, 3); assert.equal(view.cpuTempratureMax, null);
});
test('gauges remain neutral without a reading/capability and use actual frequency when available', () => {
  const view = { pss: { HWSupport: { CPUInfo: { data: null } } }, monitorData: {} };
  assert.equal(cpuGauge(view, true), 'none');
  view.pss.HWSupport.CPUInfo.data = [{ cpu_max_frequency: 4000 }];
  view.monitorData.CPU_FREQUENCY = 2000;
  assert.equal(cpuGauge(view, true), 'rotate(135deg)');
});
