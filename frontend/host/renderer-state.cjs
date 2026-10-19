// Presentation boundaries for the original Acer renderer, not a replacement UI.
const MONITOR_FIELDS = require('./monitor-fields.cjs');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numberOrNull = value => finite(value) ? value : null;
const ceilOrNull = value => finite(value) ? Math.ceil(value) : null;
const displayNumber = value => finite(value) ? String(value) : '--';
const percentage = value => finite(value) && value >= 0 && value <= 100 ? (Math.ceil(value * 100) / 100).toFixed(1) : '--';
const temperature = (value, fahrenheit) => finite(value) ? fahrenheit ? Math.floor(value * 1.8) + 32 : value : '--';
function ramUsage(monitor, fixed = false) {
  const total = monitor?.RAM_TOTAL, usage = monitor?.RAM_USAGE;
  if (!finite(total) || total <= 0 || !finite(usage) || usage < 0 || usage > 100) return '--';
  const value = Math.ceil(total * usage / 1024) / 100;
  return fixed ? value.toFixed(1) : value;
}
function reportStatus(detail) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('nitrosense-linux-status', { detail }));
  }
}
function monitorSample(input) {
  const data = Object.fromEntries(MONITOR_FIELDS.map(key => [key, null]));
  if (input && typeof input === 'object') {
    for (const key of MONITOR_FIELDS) {
      if (key === 'CPU_CORE_FREQUENCY') {
        const value = input[key];
        if (Array.isArray(value) && value.length > 0 && value.every(finite) && value.length === input.CPU_CORE_AMOUNT) data[key] = [...value];
      } else if (finite(input[key])) data[key] = input[key];
    }
  }
  const fields = MONITOR_FIELDS.filter(key => data[key] !== null);
  data.timeStamp = input?.timeStamp || new Date();
  data._linux = { readOnly: true, available: fields.length > 0, fields,
    error: typeof input?._linux?.error === 'string' ? input._linux.error : null };
  reportStatus({ kind: 'monitor', ...data._linux });
  return data;
}
class CapabilityState {
  constructor(fetch) {
    this._func = fetch; this._data = null; this.state = 'loading'; this.error = null; this.generation = 0;
    this.ready = this.init(fetch);
  }
  async init(fetch = this._func) {
    const generation = ++this.generation;
    this.state = 'loading'; this._data = null; this.error = null;
    try {
      const value = await fetch.call();
      if (generation !== this.generation) return;
      if (value === null || value === undefined) throw Object.assign(new Error('No capability result'), { code: 'ERR_NITROSENSE_UNAVAILABLE' });
      this._data = value; this.state = 'available';
    } catch (error) {
      if (generation !== this.generation) return;
      this._data = null; this.state = 'unavailable';
      this.error = { code: typeof error?.code === 'string' ? error.code : 'ERR_NITROSENSE_CAPABILITY',
        ...(typeof error?.request === 'string' ? { request: error.request } : {}),
        ...(Number.isInteger(error?.result) ? { result: error.result } : {}) };
    }
    reportStatus({ kind: 'capability', state: this.state, error: this.error });
    return this._data;
  }
  refresh() { this.ready = this.init(); return this.ready; }
  get data() { return this._data; }
}
function cpuDetails(view, amount, frequencies) {
  if (!Number.isInteger(amount) || amount < 1 || !Array.isArray(frequencies) || frequencies.length !== amount || !frequencies.every(finite)) {
    view.CPU_Core_FREQUENCY = []; return;
  }
  view.CPU_Core_FREQUENCY = frequencies.map((value, index) => ({ index, FrquenctList: view.SetAndGetData(value) }));
}
function temperatureExtrema(view, gpuType, cpuType, systemType) {
  const range = type => {
    const values = (view.pss.monitorDataStore?.getTemperatureList(type) || []).filter(finite);
    return values.length ? [Math.max(...values), Math.min(...values)] : [null, null];
  };
  const [gpuMax, gpuMin] = range(gpuType);
  view.gpuTempratureMax = gpuMax; view.gpuTempratureMin = gpuMin;
  [view.cpuTempratureMax, view.cpuTempratureMin] = range(cpuType);
  [view.system.temperture_max, view.system.temperture_min] = range(systemType);
}
function cpuGauge(view, needle = false) {
  const maximum = view.pss.HWSupport?.CPUInfo?.data?.[0]?.cpu_max_frequency;
  const current = view.monitorData?.CPU_FREQUENCY;
  const ratio = finite(current) && finite(maximum) && maximum > 0 ? Math.floor(current / maximum * 100) : null;
  if (needle) return ratio === null ? 'none' : `rotate(${2.7 * ratio}deg)`;
  return ratio === null ? '0px 440px' : `${3.3 * ratio}px ${440 - 3.3 * ratio}px`;
}
module.exports = { finite, numberOrNull, ceilOrNull, displayNumber, percentage, temperature,
  ramUsage, monitorSample, CapabilityState, cpuDetails, temperatureExtrema, cpuGauge };
