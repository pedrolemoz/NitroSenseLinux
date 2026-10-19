// Read lifecycle used by the original Acer device models in --read-only only.
// A settled query is distinct from a successful query: partial startup must
// finish even when a device has no Linux implementation.
const READ_TIMEOUT_MS = 5000;
const failure = code => Object.assign(new Error('Device state unavailable'), { code });
function bounded(operation, milliseconds = READ_TIMEOUT_MS) {
  let timer;
  return Promise.race([operation, new Promise((_, reject) => {
    timer = setTimeout(() => reject(failure('ERR_NITROSENSE_TIMEOUT')), milliseconds);
  })]).finally(() => clearTimeout(timer));
}
function safeError(error) {
  return { code: typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code : 'ERR_NITROSENSE_DEVICE_STATE',
  ...(Number.isInteger(error?.result) ? { result: error.result } : {}) };
}
class DeviceState {
  constructor(ddsc, name) {
    this._ddsc = ddsc; this._funcName = name; this._data = null;
    this._refresh = false; this.state = 'idle'; this.error = null;
    this._generation = 0; this._pending = null;
  }
  read(fetch) {
    const generation = ++this._generation;
    this._data = null; this._refresh = false; this.state = 'loading'; this.error = null;
    this._pending = bounded(Promise.resolve().then(fetch)).then(value => {
      if (generation !== this._generation) return null;
      if (value === null || value === undefined) throw failure('ERR_NITROSENSE_UNAVAILABLE');
      this._data = value; this._refresh = true; this.state = 'available';
      return value;
    }).catch(error => {
      if (generation !== this._generation) return null;
      this._data = null; this._refresh = true; this.state = 'unavailable'; this.error = safeError(error);
      // Original constructors ignore refresh promises. Preserve failure as state
      // here; callers requesting a value via getDataAsync receive a rejection.
      return null;
    });
    return this._pending;
  }
  refresh() { return this.read(() => this._ddsc.pssdk.getUpdatedData(this._funcName)); }
  refreshAsync() { return this.refresh(); }
  refreshParam(param) { return this.read(() => this._ddsc.pssdk.getUpdatedDataParam(this._funcName, param)); }
  update(value) {
    ++this._generation; this._refresh = true;
    this._data = value ?? null; this.state = value == null ? 'unavailable' : 'available';
    this.error = value == null ? { code: 'ERR_NITROSENSE_UNAVAILABLE' } : null;
  }
  getData() { return this._data; }
  getDataAsync() {
    return bounded((async () => {
      if (this.state === 'idle') this.refresh();
      while (this.state === 'loading') await this._pending;
      if (this.state !== 'available') throw failure(this.error?.code || 'ERR_NITROSENSE_UNAVAILABLE');
      return this._data;
    })());
  }
}
function deviceQueriesSettled(model, hidMode) {
  // Linux has no EC/HID transport. This only gates startup, never claims that
  // either query succeeded or enables hardware controls.
  return !hidMode && ['adaptorStatus', 'operatingMode'].every(key =>
    ['available', 'unavailable'].includes(model[key]?.state));
}
async function refreshReadOnlyPower(view) {
  const models = ['operatingMode', 'adaptorStatus', 'batteryBoost'];
  await Promise.allSettled(models.map(async key => {
    const model = view.dataModel?.[key];
    await model?.refreshAsync();
    // The original HID wrappers start the base query without returning it.
    await model?._pending;
  }));
  view._linuxPowerState = Object.fromEntries(models.map(key => {
    const model = view.dataModel?.[key];
    return [key, { state: model?.state || 'unavailable', error: model?.error || null }];
  }));
  return view._linuxPowerState;
}
function finishReadOnlyStartup(view) {
  if (view._linuxStartupPending) return view._linuxStartupPending;
  view._linuxStartupPending = (async () => {
    if (!view.dataModel) return false;
    await refreshReadOnlyPower(view);
    if (!deviceQueriesSettled(view.dataModel, false)) return false;
    // UI lifecycle readiness does not mean that every physical device exists.
    // Do not call BatteryStatusCheck/activeProfile: both can apply settings.
    view.bReady = true;
    return true;
  })().finally(() => { view._linuxStartupPending = null; });
  return view._linuxStartupPending;
}
module.exports = { DeviceState, deviceQueriesSettled, refreshReadOnlyPower, finishReadOnlyStartup };
