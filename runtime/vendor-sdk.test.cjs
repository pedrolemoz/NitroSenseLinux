const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { readAsar } = require('../lib/asar.cjs');
const { transformSource } = require('./source-patches.cjs');
const { transformRenderer, RENDERER_FILE } = require('./renderer-patches.cjs');
const { createVendorBridge } = require('./readonly-bridge.cjs');
const { startAcerServices, createReadOnlyHandler } = require('../lib/acer-service.cjs');
const rpc = require('./rpc.cjs');
const archive = path.join(__dirname, '../vendor/nitrosense-5.1.392-official/resources/app.asar');
const available = fs.existsSync(archive);
const protocolMapAvailable = fs.existsSync(path.join(__dirname, '../analysis/protocol-map.json'));

// Evaluate only isolated vendor classes/methods with test dependencies. Never
// invoke the vendor entrypoint, Electron, a Windows constructor or real sensors.
function awaiter(self, args, _Promise, generator) {
  const iterator = generator.apply(self, args || []);
  return (async () => {
    let step = iterator.next();
    while (!step.done) {
      try { step = iterator.next(await step.value); }
      catch (error) { step = iterator.throw(error); }
    }
    return step.value;
  })();
}
class Log { info() {} debug() {} error() {} }
function sources() {
  const asar = readAsar(fs.readFileSync(archive));
  const main = asar.read('main.js').toString();
  const patched = transformSource(main, path.resolve('.state/unused-oem'), path.resolve('.state/unused-preload.cjs'), { readOnly: true });
  const renderer = transformRenderer(asar.read(RENDERER_FILE).toString());
  return { main, patched, renderer };
}
function classSource(source, begin, end) {
  const start = source.indexOf(begin), until = source.indexOf(end, start);
  assert.ok(start >= 0 && until > start);
  return source.slice(start, until);
}

test('read-only main and renderer patches match the actual Acer sources and parse', { skip: !available }, () => {
  const { patched, renderer, main } = sources();
  assert.equal(patched.patches.length, 15); assert.equal(renderer.patches.length, 68);
  new vm.Script(patched.source); new vm.Script(renderer.source);
  assert.equal(transformSource(main, path.resolve('.state/unused-oem'), path.resolve('.state/unused-preload.cjs')).patches.length, 7);
  assert.throws(() => transformRenderer(renderer.source), /Unreviewed Acer/);
});

test('patched original AppCenter accepts Linux launchers without parsing Windows manifests or filtering exe files', { skip: !available }, () => {
  const { patched } = sources();
  const method = classSource(patched.source, 'getAllInstalledApps(){return c.getAllInstalledApps()}', 'getAppIconDataUri(e){');
  const apps = [{ id: 'linux-desktop:fixture.desktop', display: 'Fixture', desktopFile: '/fixture.desktop', linkTargetParsingPath: '/fixture.desktop', platform: 'linux' }];
  const Center = vm.runInNewContext(`(class Center {${method}})`, { c: { getAllInstalledApps: () => apps } });
  assert.equal(new Center().getAllInstalledApps(), apps);
});

test('actual patched lighting getters tolerate missing profiles without asynchronous diagnostic work', { skip: !available }, () => {
  const { renderer } = sources();
  const methods = classSource(renderer.source, 'Current_LightingDataFromDeviceName(e){', 'get ProfileKeyboard(){');
  const Lighting = vm.runInNewContext(`(class Lighting {${methods}})`);
  const view = new Lighting();
  view.pss = { _mfs: { ddsc: { logIt: { debug() { assert.fail('A getter must not start RPC'); } } } } };
  for (let i = 0; i < 1000; i++) {
    assert.equal(view.Current_LightingDataFromIndex(1), undefined);
    assert.equal(view.Current_LightingDataFromDeviceName('Keyboard'), undefined);
    assert.equal(view.profileLight, undefined); assert.equal(view.profileGlobal, undefined);
  }
  const device = { device: 1, deviceName: 'Keyboard' };
  view.pss.CurrentProfile = { lighting: { devices: [device], GlobalEffect: 'fixture' } };
  assert.equal(view.Current_LightingDataFromIndex(1), device);
  assert.equal(view.Current_LightingDataFromDeviceName('Keyboard'), device);
  assert.equal(view.profileGlobal, 'fixture');
});

test('actual renderer DDSC registration keeps repeated view logging out of RPC while monitoring still returns data', { skip: !available }, async () => {
  const { renderer } = sources();
  const definition = classSource(renderer.source, 'class Pt{', 'let Wi=');
  const Pt = vm.runInNewContext(`(${definition})`, {
    Pz: class { next() {} complete() {} }, du: awaiter, XS: 'PWARuntime', window: { location: { href: 'fixture' } },
    require: name => { assert.equal(name, path.join(__dirname, 'renderer-log.cjs')); return require('./renderer-log.cjs'); },
  });
  const calls = [], sample = { CPU_USAGE: 12, RAM_USAGE: 25 };
  const client = { async call(...args) {
    calls.push(args);
    if (args[1] === 'getAllFuncs') return [{ moduleName: 'logIt', func: 'debug' }, { moduleName: 'pssdk', func: 'getMonitorData' }];
    return sample;
  }, on() {}, off() {}, broadcast() {} };
  const bridge = new Pt(); await bridge.init(client);
  for (let i = 0; i < 1000; i++) assert.equal(bridge.ddsc.logIt.debug('[Lighting] profile absent'), undefined);
  assert.equal(calls.length, 1);
  assert.equal(await bridge.ddsc.pssdk.getMonitorData(), sample);
  assert.deepEqual(calls[1].slice(0, 4), ['PWARuntime', 'ddsc', 'pssdk', 'getMonitorData']);
});

test('original ADES entry reports unsupported instead of instantiating the Windows socket service', { skip: !available }, () => {
  const { patched } = sources();
  const method = classSource(patched.source, 'callADES(e){', 'getResolution(){');
  const Util = vm.runInNewContext(`(class Util {${method}})`, { require: name => {
    assert.equal(name, path.join(__dirname, 'platform.cjs')); return require('./platform.cjs');
  }, d: { ades: { get instance() { throw new Error('Must not instantiate Windows ADES'); } } } });
  assert.throws(() => new Util().callADES(true), { code: 'ERR_NITROSENSE_UNSUPPORTED' });
});

test('original SDK Whisper initialization preserves unsupported status without using an unready MQTT bridge', { skip: !available }, () => {
  const { patched } = sources();
  const method = classSource(patched.source, 'class PSSdk{constructor(){', 'static getInstance(){');
  let callback, endpoint, broadcasts = 0;
  const Sdk = vm.runInNewContext(`(${method}})`, {
    l: { getAdapter: () => ({}), getSysMonitorAdapter: () => ({}) },
    g: { Scenario: { getInstance: () => ({}) } }, u: { Store: { getInstance: () => ({}) } },
    p: { Info: { getInstance: () => ({ oemSettings: {} }) } }, o: { OPERATING_MODE: { DEFAULT: 1 } },
    c: { startWhisperMonitor: fn => { callback = fn; } }, a: { LogIt: { getInstance: () => new Log() } },
    n: { MqttFunctionCall: { getInstance: () => endpoint }, Event_WhisperModeChanged: 'whisper' },
    clearTimeout, setTimeout,
  });
  const sdk = new Sdk(), state = { support: false, enable: false, result: false };
  assert.doesNotThrow(() => callback(state)); assert.equal(sdk.whisperInfo, state);
  endpoint = { connected: false, broadcast: () => broadcasts++ }; callback(state); assert.equal(broadcasts, 0);
  endpoint.connected = true; callback(state); assert.equal(broadcasts, 1);
});

test('actual patched capability wrappers retain unavailable state and original formatters handle missing measurements', { skip: !available }, async () => {
  const { renderer } = sources();
  const definitions = classSource(renderer.source, 'class r2 extends', 'class HP extends');
  const classes = vm.runInNewContext(`(()=>{${definitions};return {r2,FP}})()`, { require: name => {
    assert.equal(name, path.join(__dirname, 'renderer-state.cjs')); return require('./renderer-state.cjs');
  } });
  const cap = new classes.FP(async () => { throw Object.assign(new Error('denied'), { code: 'ERR_NITROSENSE_SERVICE' }); }, {}, '');
  await cap.ready; assert.equal(cap.size, 0); assert.equal(cap.data, null); assert.equal(cap.state, 'unavailable');
  const methods = [...renderer.source.matchAll(/temperatureConvert\([et]\)\{return require\([^}]+\}/g)].map(m => m[0]);
  assert.equal(methods.length, 3);
  for (const method of methods) {
    const Format = vm.runInNewContext(`(class Format {${method}})`, { Qr: { Celsius: 0, Fahrenheit: 1 }, require: () => require('./renderer-state.cjs') });
    const formatter = new Format(); Object.assign(formatter, { gos: { temperatureUnit: 1, tempUnit: 1 }, tempUnit: 1 });
    assert.equal(formatter.temperatureConvert(null), '--'); assert.equal(formatter.temperatureConvert(0), 32);
  }
});

test('patched Acer device models clear failed readings, accept newer events and reject optimistic operating modes', { skip: !available }, async () => {
  const { renderer } = sources();
  const definitions = classSource(renderer.source, 'class ZP extends', 'var Xs=') +
    classSource(renderer.source, 'class lte extends', 'var o6=');
  const classes = vm.runInNewContext(`(()=>{${definitions};return {Co,tIe,lte,nIe}})()`, {
    require: () => require('./renderer-device-state.cjs'), pe: awaiter,
    qr: class { constructor(value) { this.value = value; } next(value) { this.value = value; } },
    Le: {}, bt: { SystemUsageControl: 1 }, clearTimeout, setTimeout,
  });
  let fail = false;
  const ddsc = new EventEmitter(); ddsc.logIt = new Log(); ddsc.broadcast = () => assert.fail('No successful write broadcast');
  ddsc.pssdk = {
    getUpdatedData: async () => { if (fail) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return 0; },
    getSystemUpdatedData: async () => { throw Object.assign(new Error('unsupported'), { code: 'ERR_NITROSENSE_UNSUPPORTED' }); },
    setDeviceData: async () => { throw Object.assign(new Error('readonly'), { code: 'ERR_NITROSENSE_READ_ONLY' }); },
    setDataWithoutScenario: async () => { throw Object.assign(new Error('readonly'), { code: 'ERR_NITROSENSE_READ_ONLY' }); },
  };
  const power = new classes.lte(ddsc, 'ADAPTOR_STATUS', 0);
  assert.equal(power.getData(), null); await power.refresh(); assert.equal(await power.getDataAsync(), 0);
  fail = true; power.refreshAsync();
  await assert.rejects(power.getDataAsync(), { code: 'EACCES' }); assert.equal(power.getData(), null);
  const system = new classes.tIe(ddsc, 'AUTO_REFRESH_RATE', 0, null);
  await system.refreshAsync(); assert.equal(system.state, 'unavailable'); assert.equal(system.getData(), null);
  const fan = new classes.Co(ddsc, 'FAN_CONTROL', { mode: 0 }, null);
  await fan.refresh(); assert.equal(fan.getData(), null);
  ddsc.emit('FAN_CONTROL', { mode: 2 }); assert.equal(fan.state, 'available'); assert.equal(fan.getData().mode, 2);
  const mode = new classes.nIe(ddsc, 'OPERATING_MODE', 1, null);
  await mode.refresh(); assert.equal(mode.getData(), null);
  for (const setter of ['setMode', 'setModeWithoutScenario', 'setModeWithoutScenario_And_RefreshUI']) {
    await assert.rejects(mode[setter](3), { code: 'ERR_NITROSENSE_READ_ONLY' });
    assert.equal(mode.getData(), null);
  }
});

test('patched Acer startup and power refresh settle partial data without original hardware application', { skip: !available }, async () => {
  const { renderer } = sources();
  const methods = classSource(renderer.source, 'fnDataReady(){', 'fnBatteryBoostNotify(e){') +
    classSource(renderer.source, 'SyncBatteryStatus(){', 'setDeviceData(e,a,r){') +
    classSource(renderer.source, 'get IsUnplugAC(){const e=', 'get IsUnplugDC(){');
  const View = vm.runInNewContext(`(class View {${methods}})`, { require: () => require('./renderer-device-state.cjs'), ou: value => !!(value & 3) });
  const { DeviceState } = require('./renderer-device-state.cjs');
  const view = new View(); let power = 1;
  const ddsc = { pssdk: { getUpdatedData: async name => {
    if (name !== 'ADAPTOR_STATUS' || power === null) throw Object.assign(new Error('unsupported'), { code: 'ERR_NITROSENSE_SERVICE' });
    return power;
  } } };
  view.dataModel = Object.fromEntries([['operatingMode', 'OPERATING_MODE'], ['adaptorStatus', 'ADAPTOR_STATUS'], ['batteryBoost', 'BATTERY_BOOST']]
    .map(([key, name]) => [key, new DeviceState(ddsc, name)]));
  view.activeProfile = view.BatteryStatusCheck = () => assert.fail('Must not apply hardware settings');
  assert.equal(await view.fnDataReady(), true); assert.equal(view.bReady, true); assert.equal(view.IsUnplugAC, false);
  power = 0; await view.SyncBatteryStatus(); assert.equal(view.IsUnplugAC, true);
  power = null; await view.SyncBatteryStatus(); assert.equal(view.IsUnplugAC, null);
  const fanGetter = classSource(renderer.source, 'get currentFanMode(){var t,e;', 'get currentFanData(){');
  const FanView = vm.runInNewContext(`(class FanView {${fanGetter}})`, { Cr: { Custom: 2 } });
  const fanView = new FanView(); fanView.pss = { dataModel: { fanControl: { getData: () => null } } };
  assert.equal(fanView.currentFanMode, undefined);
});

test('original startup hook prepared for read-only mode runs even when Electron was already ready', { skip: !available }, async () => {
  const { patched } = sources();
  const method = classSource(patched.source, 'onReady(){', 'registerKey(){');
  let startup = 0, protocol = 0;
  const Ready = vm.runInNewContext(`(class Ready {${method}})`, {
    a: { app: { whenReady: () => Promise.resolve(), on: () => { throw new Error('A late ready listener would be missed'); } } },
    i: () => { startup++; return Promise.resolve(); }, E: { protocol: { registerFileProtocol: () => protocol++ } },
  });
  new Ready().onReady(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(startup, 1); assert.equal(protocol, 1);
});

test('original CPU capability method and patched SDK pump consume the Linux service without simulator or NaN', { skip: !available || !protocolMapAvailable }, async t => {
  let failed = false, adaptorStatus = 1;
  const service = await startAcerServices({ ports: { main: 0, monitor: 0 }, handler: createReadOnlyHandler({ sample() {
    if (failed) throw Object.assign(new Error('source denied'), { code: 'EACCES' });
    return { data: { CPU_CORE_AMOUNT: 2, RAM_TOTAL: 8000, RAM_USAGE: 25.125 }, cpuInfo: [{ cpu_index: 0, cpu_name: 'Test CPU' }] };
  }, readPlatformState: () => ({ power: { adaptorStatus }, profiles: [], errors: [] }) }) });
  t.after(() => service.close());
  const bridge = createVendorBridge({ ports: { main: service.addresses.main.port, monitor: service.addresses.monitor.port } });
  t.after(() => bridge.closeAll());
  const { main, patched } = sources();
  const methods = JSON.parse(fs.readFileSync(path.join(__dirname, '../analysis/protocol-map.json'), 'utf8')).adapters[0].methods;
  const names = ['getSupportCPUInfo', 'getSupportFanControl', 'Initialization_ServiceVersion', 'getServiceVersion', 'getUpdatedData', '__parseReponse'];
  const selected = methods.filter(m => names.includes(m.name)).map(m => main.slice(m.start, m.end)).join('\n');
  const Original = vm.runInNewContext(`(class Original { constructor(){throw new Error('Original constructor must not run')} ${selected} })`,
    { d: { getLogger: () => new Log() }, i: awaiter, m: { INITIALIZATION: 0, GET_UPDATED_DATA: 20 }, o: { UPDATED_DATA: { ADAPTOR_STATUS: 'ADAPTOR_STATUS' } }, Date });
  class Subject { constructor(value) { this.value = value; } next(value) { this.value = value; } }
  const adapter = bridge.getVendorAdapter(Original, { Subject, BehaviorSubject: Subject }, 'main');
  assert.deepEqual(await adapter.getSupportCPUInfo(), [{ cpu_index: 0, cpu_name: 'Test CPU' }]);
  await assert.rejects(adapter.getSupportFanControl(), { code: 'ERR_NITROSENSE_SERVICE', result: 1 });
  await assert.rejects(adapter.getSupportOverclockingMode(), { code: 'ERR_NITROSENSE_SERVICE', result: 1 });
  assert.equal(await adapter.Initialization_ServiceVersion(), '0.1.0');
  assert.equal(await adapter.getUpdatedData('ADAPTOR_STATUS'), 1);
  adaptorStatus = 0; assert.equal(await adapter.getUpdatedData('ADAPTOR_STATUS'), 0);
  adaptorStatus = null; await assert.rejects(adapter.getUpdatedData('ADAPTOR_STATUS'), { code: 'ERR_NITROSENSE_SERVICE' });
  const sent = [], mqtt = { broadcast: (...args) => sent.push(args) };
  const method = classSource(patched.source, 'pumpMonitorData(e){', 'getSupportOperatingMode(){');
  const Sdk = vm.runInNewContext(`(class Sdk {${method}})`, {
    require: name => { assert.equal(name, path.join(__dirname, 'readonly-bridge.cjs')); return require('./readonly-bridge.cjs'); },
    n: { MqttFunctionCall: { getInstance: () => mqtt } }, m: { MainAapp: 1, Overlay: 2 },
  });
  const sdk = new Sdk(); Object.assign(sdk, { adapter, pumpData: true });
  const data = await sdk.pumpMonitorData(1);
  assert.equal(data.RAM_USAGE, 25.13); assert.equal(data.RAM_TOTAL, 8000);
  assert.equal(Object.hasOwn(data, 'CPU_CORE_FREQUENCY'), false);
  assert.equal(Object.hasOwn(data, 'GPU1_USAGE'), false);
  assert.ok(!JSON.stringify(data).includes('NaN'));
  failed = true;
  const unavailable = await sdk.pumpMonitorData(1);
  assert.equal(unavailable._linux.available, false);
  assert.equal(unavailable._linux.error, 'ERR_NITROSENSE_SERVICE');
  assert.equal(Object.hasOwn(unavailable, 'RAM_USAGE'), false);
  assert.equal(sdk.isGettingMonitorData, false);
  assert.equal(sent.length, 2);
});

test('actual patched main/renderer MQTT classes propagate success and operation errors in both directions', { skip: !available }, async () => {
  const { patched, renderer } = sources();
  const mainClass = classSource(patched.source, 'class MqttFunctionCall{', 't.MqttFunctionCall=MqttFunctionCall');
  const rendererClass = classSource(renderer.source, 'class Uo{', 'function d1(');
  const requireRpc = name => { assert.equal(name, path.join(__dirname, 'rpc.cjs')); return rpc; };
  const Main = vm.runInNewContext(`(${mainClass})`, { n: { EventEmitter }, Log, i: awaiter, require: requireRpc, Date });
  const Renderer = vm.runInNewContext(`(${rendererClass})`, { H_e: { EventEmitter }, B_e: Log, du: awaiter, require: requireRpc, Date });
  const peers = [];
  const broker = { connect() {
    const peer = new EventEmitter(); peer.topics = new Set(); peers.push(peer);
    peer.subscribe = (topic, callback) => { peer.topics.add(topic); queueMicrotask(() => callback(null, [])); };
    peer.publish = (topic, body, callback) => {
      for (const other of peers) if (other.topics.has(topic)) queueMicrotask(() => other.emit('message', topic, Buffer.from(body)));
      if (callback) queueMicrotask(() => callback(null));
    };
    return peer;
  } };
  const host = new Main(), page = new Renderer();
  await host.init('host', 'fixture', broker); await page.init('page', 'fixture', broker);
  host.export('realReading', () => ({ RAM_USAGE: 15 }));
  host.export('notImplemented', () => { throw Object.assign(new Error('PRIVATE_DATA'), { code: 'ERR_NITROSENSE_SERVICE', request: 'SUPPORT_GPU_INFO', result: 1 }); });
  page.export('pageThrows', async () => { throw Object.assign(new Error('PRIVATE_COOKIE'), { code: 'ERR_PAGE_OPERATION' }); });
  assert.deepEqual({ ...await page.call('host', 'realReading') }, { RAM_USAGE: 15 });
  await assert.rejects(page.call('host', 'notImplemented'), { code: 'ERR_NITROSENSE_SERVICE', request: 'SUPPORT_GPU_INFO', result: 1 });
  await assert.rejects(host.call('page', 'pageThrows'), { code: 'ERR_PAGE_OPERATION' });
  await assert.rejects(page.call('host', 'missing'), { code: 'ERR_NITROSENSE_RPC_UNIMPLEMENTED' });
  assert.equal(host.cbMap.size, 0); assert.equal(page.cbMap.size, 0);
});

test('actual main page identity block continues initialization after denied optional identifiers', { skip: !available }, async () => {
  const { renderer } = sources();
  const start = renderer.source.indexOf('null==this.driverService.SNnumber){yield require(');
  const end = renderer.source.indexOf('if(setTimeout(()=>{this.ga4.AppStart', start);
  assert.ok(start >= 0 && end > start);
  const initialize = vm.runInNewContext(`(function(r){return pe(this, [r], undefined, function*(r){if(${renderer.source.slice(start, end)}this.menuInitialized=true})})`, { require, pe: awaiter });
  const denied = () => { throw Object.assign(new Error('PRIVATE_SERIAL'), { code: 'EACCES' }); };
  const view = { driverService: { getSnNumber: denied, getSnId: denied } };
  await initialize.call(view, { info: { getSystemUuid: denied } });
  assert.equal(view.menuInitialized, true);
  for (const field of ['serial', 'snid', 'uuid']) {
    assert.deepEqual(view._linuxIdentityState[field], { state: 'unavailable', code: 'EACCES' });
  }
  assert.doesNotMatch(JSON.stringify(view._linuxIdentityState), /PRIVATE/);
});

test('actual Home getter never calls asynchronous mode queries while mode is unavailable', { skip: !available }, () => {
  const { renderer } = sources();
  const getter = classSource(renderer.source, 'get createHomeTab(){', 'get embeddedUrl(){');
  const Home = vm.runInNewContext(`(class Home {${getter}})`, { require, Le: {}, window: { location: { port: '12345' } } });
  const view = new Home();
  view.gos = { showUI: true, reCreateHome: true, activeTab: 'Home' };
  view.pss = { dataModel: { operatingMode: {
    getData: () => null, getDataAsync() { assert.fail('No Promise work in template getters'); },
  } } };
  for (let i = 0; i < 10000; i++) assert.equal(view.createHomeTab, true);
  assert.doesNotMatch(view.gos._embeddedUrl, /undefined|OPERATING_MODE/);
});

test('actual monitoring throughput formatter accepts missing network data and preserves zero', { skip: !available }, () => {
  const { renderer } = sources();
  const methods = classSource(renderer.source, 'getUnit(t){', 'temperatureConvert(t){');
  const Monitor = vm.runInNewContext(`(class Monitor {${methods}})`, { require });
  const view = new Monitor(); view.tr = { instant: key => key };
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.equal(view.normalizeNum(value), '--'); assert.equal(view.getUnit(value), '');
  }
  assert.equal(view.normalizeNum(0), '0.0'); assert.equal(view.getUnit(0), 'MUI_Kbps');
  assert.equal(view.normalizeNum(1500), '1.5'); assert.equal(view.getUnit(1500), 'MUI_Mbps');
});

test('shared introduction dialog tolerates an unavailable operating mode list', { skip: !available }, () => {
  const { renderer } = sources();
  const statement = 'this.modeNumList=this.pss.HWSupport?.operatingMode?.data?.filter(e=>e!=Le.ECO)??null';
  assert.ok(renderer.source.includes(statement));
  const initialize = vm.runInNewContext(`(function(){${statement}})`, { Le: { ECO: 0 } });
  const view = { pss: { HWSupport: { operatingMode: { data: null } } } };
  initialize.call(view); assert.equal(view.modeNumList, null);
  view.pss.HWSupport.operatingMode.data = [0, 1, 2];
  initialize.call(view); assert.deepEqual(view.modeNumList, [1, 2]);
});

test('original battery getters use Linux readings instead of Windows zero defaults', { skip: !available }, () => {
  const { renderer } = sources();
  const percentage = classSource(renderer.source, 'get BatteryPercentage(){', 'get BatteryACMode(){');
  const cycles = classSource(renderer.source, 'get Battery_CycleCount(){', 'getBatteryCalibrationStatus(){');
  const capacity = classSource(renderer.source, 'get Battery_MaximumCapacity(){', 'get Battery_Temperature(){');
  const Battery = vm.runInNewContext(`(class Battery {${percentage}${cycles}${capacity}})`, { require });
  const view = new Battery(); view.pss = { monitorData: {} };
  assert.equal(view.BatteryPercentage, '--'); assert.equal(view.Battery_CycleCount, '--');
  view.pss.monitorData = { BATTERY_PERCENTAGE: 80, BATTERY_CYCLE_COUNT: 130, BATTERY_MAX_CAPACITY: 93.2 };
  assert.equal(view.BatteryPercentage, '80'); assert.equal(view.Battery_CycleCount, '130');
  assert.equal(view.Battery_MaximumCapacity, '93.2%');
});
