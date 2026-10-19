const test = require('node:test');
const assert = require('node:assert/strict');
const { DeviceState, deviceQueriesSettled, refreshReadOnlyPower, finishReadOnlyStartup } = require('./renderer-device-state.cjs');
const denied = () => Object.assign(new Error('PRIVATE_SOURCE_DETAIL'), { code: 'EACCES', result: 1 });
const model = fetch => new DeviceState({ pssdk: { getUpdatedData: fetch } }, 'ADAPTOR_STATUS', 0);

test('device queries preserve real zero, invalidate stale state and recover after failures', async () => {
  let value = 0, fail = false;
  const state = model(async () => { if (fail) throw denied(); return value; });
  assert.equal(state.getData(), null); assert.equal(state.state, 'idle');
  await state.refresh(); assert.equal(await state.getDataAsync(), 0);
  fail = true;
  const pending = state.refreshAsync();
  assert.equal(state.getData(), null); assert.equal(state.state, 'loading');
  await pending;
  assert.equal(state.state, 'unavailable'); assert.equal(state.getData(), null);
  assert.deepEqual(state.error, { code: 'EACCES', result: 1 });
  await assert.rejects(state.getDataAsync(), { code: 'EACCES' });
  assert.doesNotMatch(JSON.stringify(state.error), /PRIVATE/);
  fail = false; value = 1;
  assert.equal(await state.refresh(), 1); assert.equal(await state.getDataAsync(), 1);
});

test('an event or newer failure supersedes older device replies', async () => {
  let first;
  const state = model(() => new Promise(resolve => { first = resolve; }));
  const old = state.refresh(); await Promise.resolve();
  state.update(0); first(1); await old;
  assert.equal(state.getData(), 0); assert.equal(state.state, 'available');
  const older = state.refresh(); await Promise.resolve();
  state._ddsc.pssdk.getUpdatedData = async () => { throw denied(); };
  await state.refresh(); first(1); await older;
  assert.equal(state.getData(), null); assert.equal(state.state, 'unavailable');
});

test('simultaneous readers share the query and null is an explicit unavailable result', async () => {
  let calls = 0, resolve;
  const state = model(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = state.getDataAsync(), second = state.getDataAsync();
  await Promise.resolve(); assert.equal(calls, 1);
  resolve(0); assert.deepEqual(await Promise.all([first, second]), [0, 0]);
  state._ddsc.pssdk.getUpdatedData = () => null;
  await state.refresh();
  await assert.rejects(state.getDataAsync(), { code: 'ERR_NITROSENSE_UNAVAILABLE' });
});

test('a stuck device query times out and its eventual reply cannot revive the failed state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish;
  const state = model(() => new Promise(resolve => { finish = resolve; }));
  const query = state.refresh(); await Promise.resolve();
  t.mock.timers.tick(5000); await query;
  assert.equal(state.state, 'unavailable'); assert.equal(state.error.code, 'ERR_NITROSENSE_TIMEOUT');
  finish(1); await Promise.resolve();
  assert.equal(state.getData(), null);
});

test('partial startup is ready only after both queries settle and never claims HID support', async () => {
  const view = { adaptorStatus: model(async () => 1), operatingMode: model(async () => { throw denied(); }) };
  assert.equal(deviceQueriesSettled(view, false), false);
  await Promise.all([view.adaptorStatus.refresh(), view.operatingMode.refresh()]);
  assert.equal(deviceQueriesSettled(view, false), true);
  assert.equal(view.operatingMode.getData(), null);
  assert.equal(deviceQueriesSettled(view, true), false);
});

test('read-only power refresh waits for original wrappers and never applies profiles or changes readiness', async () => {
  const adaptor = model(async () => 0);
  // Reproduce the original wrapper returning before the base query finishes.
  adaptor.refreshAsync = async function () { this.refresh(); };
  const mode = model(async () => { throw denied(); });
  const view = { bReady: true, dataModel: { adaptorStatus: adaptor, operatingMode: mode },
    activeProfile() { assert.fail('Must not apply scenarios'); },
    UpdateEcoStatus() { assert.fail('Must not infer or change system mode'); } };
  const result = await refreshReadOnlyPower(view);
  assert.equal(adaptor.getData(), 0); assert.equal(view.bReady, true);
  assert.equal(result.adaptorStatus.state, 'available');
  assert.equal(result.operatingMode.state, 'unavailable');
  assert.equal(result.batteryBoost.state, 'unavailable');
});

test('read-only startup coalesces callbacks and completes with unavailable controls without applying settings', async () => {
  let calls = 0;
  const view = { bReady: false, dataModel: {
    operatingMode: model(async () => { calls++; throw denied(); }),
    adaptorStatus: model(async () => { calls++; throw denied(); }),
    batteryBoost: model(async () => { calls++; throw denied(); }),
  }, activeProfile() { assert.fail('Must not apply profile'); },
  BatteryStatusCheck() { assert.fail('Must not infer power locks'); } };
  const first = finishReadOnlyStartup(view), second = finishReadOnlyStartup(view);
  assert.equal(first, second); assert.equal(await first, true); assert.equal(calls, 3);
  assert.equal(view.bReady, true);
  assert.equal(view.dataModel.operatingMode.getData(), null);
  assert.equal(view._linuxStartupPending, null);
  assert.equal(await finishReadOnlyStartup({}), false);
});
