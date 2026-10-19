const { EventEmitter } = require('node:events');
const { AcerClient } = require('../lib/acer-client.cjs');
const { rpcReply } = require('./rpc.cjs');

const MONITOR_FIELDS = require('../lib/monitor-fields.cjs');

function normalizeMonitorData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Monitor object required');
  const data = {};
  for (const key of MONITOR_FIELDS) {
    const value = input[key];
    if (key === 'CPU_CORE_FREQUENCY') {
      if (Array.isArray(value) && value.length && value.every(v => Number.isFinite(v) && v >= 0) &&
          Number.isInteger(input.CPU_CORE_AMOUNT) && value.length === input.CPU_CORE_AMOUNT) {
        data[key] = value.map(Math.ceil);
      }
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      if (key === 'CPU_CORE_AMOUNT' && (!Number.isInteger(value) || value <= 0)) continue;
      if (!key.endsWith('TEMPERATURE') && value < 0) continue;
      if (key.endsWith('_USAGE') && value > 100) continue;
      data[key] = ['CPU_FREQUENCY', 'RAM_TOTAL', 'WIFI_DOWNLOAD', 'WIFI_UPLOAD'].includes(key) ? Math.ceil(value) :
        ['CPU_USAGE', 'RAM_USAGE'].includes(key) ? Math.ceil(100 * value) / 100 : value;
    }
  }
  data.timeStamp = new Date();
  return data;
}

async function pumpMonitorData(sdk, target, mqtt, mainTarget, overlayTarget) {
  if (!(sdk.pumpData || sdk.widgetPumpData) || sdk.isGettingMonitorData) return;
  sdk.isGettingMonitorData = true;
  let data, failure = null;
  try {
    const adapter = sdk.bEC_HID_Support ? sdk.sysMonitorAdapter : sdk.adapter;
    data = normalizeMonitorData(await adapter.getMonitorData());
  } catch (error) {
    // Publish a fresh unavailable sample instead of leaving stale readings on screen.
    failure = typeof error.code === 'string' ? error.code : 'ERR_NITROSENSE_MONITOR';
    data = { timeStamp: new Date() };
  } finally { sdk.isGettingMonitorData = false; }
  const fields = Object.keys(data).filter(key => key !== 'timeStamp');
  data._linux = { readOnly: true, available: fields.length > 0, fields, error: failure };
  if (target === mainTarget) mqtt.broadcast('UPDATE_MONITOR_DATA', data);
  else if (target === overlayTarget) mqtt.broadcast('UPDATE_OVERLAY_MONITOR_DATA', data);
  return data;
}

function createVendorBridge({ ports = { main: 46933, monitor: 46753 }, timeoutMs = 5000,
  onStatus = () => {}, mqtt = null } = {}) {
  const adapters = new Map();
  function getVendorAdapter(Original, rx, channel) {
    if (!['main', 'monitor'].includes(channel)) throw new Error('Unknown service channel');
    if (adapters.has(channel)) return adapters.get(channel);
    // Reuse the original vendor methods and parsers, without invoking its Windows
    // connection constructor. Only the transport/lifecycle boundary is replaced.
    const adapter = Object.create(Original.prototype);
    adapter.connect = new rx.BehaviorSubject(false);
    adapter.gotData = new rx.Subject();
    adapter.powerResume = new EventEmitter();
    adapter.connected = false;
    const client = new AcerClient({ port: ports[channel], timeoutMs });
    let wasConnected = false;
    client.on('connected', () => {
      adapter.connected = true; adapter.connect.next(true);
      if (wasConnected) adapter.powerResume.emit('reconnected');
      wasConnected = true;
      if (channel === 'main') adapter.Initialization_ServiceVersion().catch(error => onStatus({ channel, error: error.code }));
      else adapter.powerResume.emit('startMonitorData');
      onStatus({ channel, connected: true });
    });
    client.on('disconnected', error => {
      adapter.connected = false; adapter.connect.next(false);
      onStatus({ channel, connected: false, error: error.code });
    });
    client.on('response', response => adapter.gotData.next(response));
    client.on('notification', event => { if (mqtt) mqtt.broadcast(event.Function, event.Parameter); });
    adapter.sendRequest = (id, payload) => client.request(id, payload);
    adapter.getMonitorData = () => client.request(10, {}).then(data => {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw Object.assign(new Error('Invalid monitor response'), { code: 'ERR_NITROSENSE_PROTOCOL' });
      }
      return { ...data, timeStamp: new Date() };
    });
    // The original overclock method discards its Promise and returns []; expose
    // the actual result/error so callers can distinguish unavailable capability.
    adapter.getSupportOverclockingMode = () => client.request(0, { Function: 'SUPPORT_OVERCLOCKING_MODE_CAPABILITY' });
    adapter.close = () => client.close();
    adapter.connectToService = () => client.open();
    adapter.reConnectToService = () => client.open();
    adapters.set(channel, adapter);
    client.open().catch(error => onStatus({ channel, connected: false, error: error.code }));
    return adapter;
  }
  function closeAll() { for (const adapter of adapters.values()) adapter.close(); adapters.clear(); }
  return { getVendorAdapter, closeAll };
}
const defaultBridge = createVendorBridge();
module.exports = { MONITOR_FIELDS, normalizeMonitorData, pumpMonitorData, rpcReply,
  createVendorBridge, ...defaultBridge };
