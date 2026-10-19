// Reviewed, exact source replacements for the single supported vendor build.
// These are applied in memory. The vendor ASAR remains untouched.
const crypto = require('node:crypto');
const path = require('node:path');
const MAIN_SHA256 = '8dfad247b6fc019e9c308e86e982eda6e99ffc8f7e2fbb761bb7a6bf3d3fa440';
function transformSource(source, oemRoot, rendererPreload, { readOnly = false } = {}) {
  if (!path.isAbsolute(rendererPreload || '')) throw new Error('Absolute renderer preload required');
  if (crypto.createHash('sha256').update(source).digest('hex') !== MAIN_SHA256) {
    throw new Error('Unreviewed Acer entry source');
  }
  const patches = [];
  function replaceOnce(before, after, reason) {
    if (source.split(before).length !== 2) throw new Error('Reviewed Acer patch no longer matches: ' + reason);
    source = source.replace(before, after); patches.push(reason);
  }
  // Electron exposes title-bar overlays only on supported desktop platforms.
  const overlayCall = 'this.mainWin.setTitleBarOverlay(';
  if (source.split(overlayCall).length !== 4) throw new Error('Reviewed title-bar overlay calls no longer match');
  source = source.split(overlayCall).join('this.mainWin.setTitleBarOverlay?.(');
  patches.push('Skip unavailable native title-bar overlays on Linux');
  replaceOnce('"C:/ProgramData/OEM/NitroSense"', JSON.stringify(oemRoot), 'Map OEM resources to user state');
  replaceOnce('this.appWatcher=setInterval(()=>{const e=n.getActiveProcess().pId;this.bCheckPID?this.curPID!=e&&(this.curPID=e,this.ChangeProfile(e)):this.ChangeProfile(e)},this.appWatcherTime)',
    'this.appWatcher=null', 'Disable unavailable Windows foreground-process monitoring');
  replaceOnce('M.ades.instance;', 'void 0;', 'Disable Windows notification service in interface-only experiment');
  replaceOnce('callADES(e){d.ades.instance.notificationdata(e)}',
    `callADES(e){throw require(${JSON.stringify(path.join(__dirname, 'platform.cjs'))}).unsupported("ADES consent synchronization")}`,
    'Report missing ADES integration explicitly without creating a Windows reconnect loop');
  replaceOnce('n.MqttFunctionCall.getInstance().broadcast(n.Event_WhisperModeChanged,e.enable&&e.support);',
    '(()=>{const t=n.MqttFunctionCall.getInstance();t&&t.connected&&t.broadcast(n.Event_WhisperModeChanged,e.enable&&e.support)})();',
    'Do not broadcast unsupported Whisper initialization before the MQTT bridge is ready');
  const appsAt = source.indexOf('getAllInstalledApps(){const e=c.getAllInstalledApps();');
  const appsEnd = source.indexOf('getAppIconDataUri(e){', appsAt);
  if (appsAt < 0 || appsEnd < 0) throw new Error('Reviewed installed-app boundary no longer matches');
  replaceOnce(source.slice(appsAt, appsEnd), 'getAllInstalledApps(){return c.getAllInstalledApps()}',
    'Use the Linux desktop catalog without Windows manifest parsing or exe-only filtering');
  replaceOnce('webPreferences:{nodeIntegration:!0,webviewTag:!0,webSecurity:!1,contextIsolation:!1,nodeIntegrationInSubFrames:!1',
    `webPreferences:{preload:${JSON.stringify(rendererPreload)},nodeIntegration:!0,webviewTag:!0,webSecurity:!1,contextIsolation:!1,nodeIntegrationInSubFrames:!1`,
    'Resolve the renderer remote bridge from the original vendor ASAR');
  if (readOnly) {
    replaceOnce('getScenario(){return this.scenario}',
      'getScenario(){if(this.IsProfileEmpty()){this.scenario.active=0,this.scenario.select=0,this.InsertProfile(this.getInitialProfile("MUI_DAILY_USE"))}else{let e=!1;const t=e=>Number.isInteger(e)&&e>=0&&e<this.scenario.profiles.length;!t(this.scenario.select)&&(this.scenario.select=0,e=!0),!t(this.scenario.active)&&(this.scenario.active=this.scenario.select,e=!0),e&&this.saveScenario()}return this.scenario}',
      'Initialize the original Daily Use profile without waiting for Windows keyboard lighting discovery and repair invalid selection indices');
    const serviceStart = source.indexOf('checkAcerEZServiceExist(){');
    const serviceEnd = source.indexOf('setNewWarrantyInfo(e){', serviceStart);
    if (serviceStart < 0 || serviceEnd < 0) throw new Error('Reviewed Acer service check boundary no longer matches');
    replaceOnce(source.slice(serviceStart, serviceEnd), 'checkAcerEZServiceExist(){return!1}',
      'Report the Windows AcerEZ service absent on Linux without launching sc');
    const bridge = JSON.stringify(path.join(__dirname, 'readonly-bridge.cjs'));
    const rpc = JSON.stringify(path.join(__dirname, 'rpc.cjs'));
    replaceOnce('onReady(){a.app.on("ready",()=>i(this,void 0,void 0,(function*(){',
      'onReady(){a.app.whenReady().then(()=>i(this,void 0,void 0,(function*(){',
      'Register Acer startup safely after asynchronous Linux service initialization');
    replaceOnce('t.getAdapter=function getAdapter(){return i.EnvConfig.getInstance().simulatorMode?o.SimulatorAdapter.instance:n.PSSdkAdapter.instance}',
      `t.getAdapter=function getAdapter(){return i.EnvConfig.getInstance().simulatorMode?o.SimulatorAdapter.instance:require(${bridge}).getVendorAdapter(n.PSSdkAdapter,r(10),"main")}`,
      'Connect original main SDK methods through the Linux read-only transport');
    replaceOnce('t.getSysMonitorAdapter=function getSysMonitorAdapter(){return i.EnvConfig.getInstance().simulatorMode?a.SimulatorSysMonitorAdaptor.instance:s.SysMonitorAdaptor.instance}',
      `t.getSysMonitorAdapter=function getSysMonitorAdapter(){return i.EnvConfig.getInstance().simulatorMode?a.SimulatorSysMonitorAdaptor.instance:require(${bridge}).getVendorAdapter(s.SysMonitorAdaptor,r(10),"monitor")}`,
      'Connect original system SDK methods through the Linux read-only transport');
    const begin = 'pumpMonitorData(e){return', end = 'getSupportOperatingMode(){';
    const at = source.indexOf(begin), until = source.indexOf(end, at);
    if (at < 0 || until < 0 || source.indexOf(begin, at + 1) !== -1) throw new Error('Reviewed SDK pump boundary no longer matches');
    replaceOnce(source.slice(at, until),
      `pumpMonitorData(e){return require(${bridge}).pumpMonitorData(this,e,n.MqttFunctionCall.getInstance(),m.MainAapp,m.Overlay)}`,
      'Preserve partial live samples and release the monitor mutex on failure');
    replaceOnce('let r={callId:i,reason:"fromFunction",result:yield t(...o)};',
      `let r=yield require(${rpc}).rpcReply(i,()=>t(...o));`,
      'Reply explicitly when a Linux SDK operation fails instead of leaving RPC pending');
    const callStart = 'call(e,t,...r){', callEnd = 'listerenBroadcastChannel(e){';
    const callAt = source.indexOf(callStart), callUntil = source.indexOf(callEnd, callAt);
    if (callAt < 0 || callUntil < 0 || source.indexOf(callStart, callAt + 1) !== -1) throw new Error('Reviewed RPC call boundary no longer matches');
    replaceOnce(source.slice(callAt, callUntil),
      `call(e,t,...r){return require(${rpc}).callRpc(this,e,t,r)}`,
      'Bound RPC deadlines and register callbacks before publishing');
    replaceOnce('this.cbMap.has(e.callId)&&(this.cbMap.get(e.callId)(e.result),this.cbMap.delete(e.callId))',
      `require(${rpc}).acceptRpcReply(this,e)`,
      'Reject failed RPC operations instead of resolving error replies as success');
  }
  return { source, patches };
}
module.exports = { transformSource, MAIN_SHA256 };
