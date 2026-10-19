const crypto = require('node:crypto');
const path = require('node:path');
const RENDERER_FILE = 'dist/widgets/main/main.3f0bc01a1d49e6ce.js';
const RENDERER_SHA256 = 'cd87941481821f733292bcc380601869f6a85adcacf522d3498dfa61db95276e';

// Prepared for the read-only integration. The current --ui-only loader does not
// apply these patches. Original assets are never changed on disk.
function transformRenderer(source) {
  if (crypto.createHash('sha256').update(source).digest('hex') !== RENDERER_SHA256) throw new Error('Unreviewed Acer renderer source');
  const rpc = JSON.stringify(path.join(__dirname, 'rpc.cjs'));
  const view = JSON.stringify(path.join(__dirname, 'renderer-state.cjs'));
  const device = JSON.stringify(path.join(__dirname, 'renderer-device-state.cjs'));
  const logging = JSON.stringify(path.join(__dirname, 'renderer-log.cjs'));
  const patches = [];
  function replace(before, after, reason, count = 1) {
    if (source.split(before).length !== count + 1) throw new Error('Reviewed renderer patch no longer matches: ' + reason);
    source = source.split(before).join(after); patches.push(reason);
  }
  function section(begin, end, after, reason) {
    const start = source.indexOf(begin), until = source.indexOf(end, start + begin.length);
    if (start < 0 || until < 0) throw new Error('Reviewed renderer section no longer matches: ' + reason);
    replace(source.slice(start, until), after, reason);
  }
  replace('this.getCategory(r)[s]=(...f)=>this.client.call(XS,"ddsc",r,s,f)',
    `this.getCategory(r)[s]=require(${logging}).rendererFunction(this.client,XS,r,s)`,
    'Keep renderer diagnostics synchronous and bounded outside the hardware RPC queue');
  replace('null==this.driverService.SNnumber){let g=yield this.driverService.getSnNumber(),M=yield this.driverService.getSnId(),S=yield r.info.getSystemUuid();console.log(`[main.ts] get sn: ${g}, snid: ${M}, uuid: ${S}`),r.logIt.info(`[main.ts] get sn: ${g}, snid: ${M}, uuid: ${S}`)}',
    `null==this.driverService.SNnumber){yield require(${JSON.stringify(path.join(__dirname, 'renderer-startup.cjs'))}).readOptionalIdentity(this,r)}`,
    'Keep optional identity failures from aborting main page initialization');
  const startup = JSON.stringify(path.join(__dirname, 'renderer-startup.cjs'));
  replace('this.machineGuid=yield d.info.getSystemUuid(),a.unsubscribe(),this.IsEnableGA=yield e.ddsc.info.getGAInfoAgree(),d.logIt.info(`[GA4.service] IsEnableGA init: ${this.IsEnableGA}`),this.getSnNumber()',
    `yield require(${startup}).initializeAnalytics(this,d),a.unsubscribe()`,
    'Settle optional analytics initialization without invented identity or consent changes');
  replace('this.getSnNumber(),this.bSimulatorMode=yield r.info.getSimulatorMode()',
    `require(${startup}).settleOptional(this,"serviceIdentity",()=>this.getSnNumber()),this.bSimulatorMode=yield r.info.getSimulatorMode()`,
    'Observe optional service identity failure without rejecting independent initialization');
  replace('this.initDynamicEffects(t),this.initFanDialControl(t)',
    `require(${startup}).settleOptional(this,"lighting",()=>this.initDynamicEffects(t)),this.initFanDialControl(t)`,
    'Keep unavailable lighting discovery from leaving an unhandled startup rejection');
  replace('a=yield e.info.getMachineGuid(),r=new Date,s=[ste("expireTime",">",r)',
    `a=yield require(${startup}).settleOptional(this,"recommendations",()=>e.info.getMachineGuid());if(a==null)return;const r=new Date,s=[ste("expireTime",">",r)`,
    'Skip identity dependent recommendation subscription when identity is unavailable');
  section('setPlanet9Promise(){', 'refreshCheckWinStoreUpdate(){',
    `setPlanet9Promise(){return require(${startup}).preparePlanet9(this)}`,
    'Settle unavailable or disabled Planet9 without a permanently pending Promise');
  replace('this.mfs.ddsc.util.callADES(this.IsAgreePrivacyPolicy)',
    `require(${startup}).settleOptional(this,"adesConsent",()=>this.mfs.ddsc.util.callADES(this.IsAgreePrivacyPolicy))`,
    'Record absent ADES synchronization while preserving the local privacy choice');
  replace('this.mfs.ddsc.util.callADES(t)',
    `require(${startup}).settleOptional(this,"adesConsent",()=>this.mfs.ddsc.util.callADES(t))`,
    'Settle absent ADES synchronization when leaving the privacy dialog');
  replace('get BatteryPercentage(){return this.BatteryStatus.BatteryPercent}',
    `get BatteryPercentage(){return require(${view}).displayNumber(this.pss.monitorData?.BATTERY_PERCENTAGE)}`,
    'Read real system battery percentage instead of the absent Windows service default zero');
  replace('get Battery_CycleCount(){if(!this.ShowBatteryInfo)return"-";const e=this.BatteryInformation.CycleCount;return null!=e&&-1!=e?`${e}`:void 0}',
    `get Battery_CycleCount(){return require(${view}).displayNumber(this.pss.monitorData?.BATTERY_CYCLE_COUNT)}`,
    'Read system battery cycle count from Linux without a fake Windows result');
  replace('get Battery_MaximumCapacity(){if(!this.ShowBatteryInfo)return"-";const e=this.BatteryInformation.MaximumCapacity;return null!=e&&-1!=e?`${e}%`:void 0}',
    `get Battery_MaximumCapacity(){const value=this.pss.monitorData?.BATTERY_MAX_CAPACITY;return require(${view}).finite(value)?value.toFixed(1)+"%":"--"}`,
    'Read measured full-to-design battery capacity when Linux exposes matching units');
  replace('this.gos.oemSettings.PreloadList', 'this.gos.oemSettings?.PreloadList',
    'Allow AppCenter rendering before OEM settings arrive', 2);
  replace('this.gos.oemSettings.Game', 'this.gos.oemSettings?.Game',
    'Allow AppCenter game filtering before OEM settings arrive');
  section('Current_LightingDataFromDeviceName(e){', 'get ProfileKeyboard(){',
    'Current_LightingDataFromDeviceName(e){return this.profileLight?.devices?.find(r=>r.deviceName==e)}Current_LightingDataFromIndex(e){return this.profileLight?.devices?.find(r=>r.device==e)}get profileLight(){return this.pss.CurrentProfile?.lighting}get profileGlobal(){return this.profileLight?.GlobalEffect}',
    'Keep unavailable lighting getters free of exceptions and asynchronous logging');
  section('class ZP{', 'class Co extends ZP{', `class ZP extends require(${device}).DeviceState{}`,
    'Settle failed device queries, invalidate stale values and bound asynchronous readers');
  section('refresh(){return pe(this,void 0,void 0,function*(){let t=yield this._ddsc.pssdk.getSystemUpdatedData',
    'set GA4Label(t)',
    'refresh(){return this.read(()=>this._ddsc.pssdk.getSystemUpdatedData(this._funcName))}refreshAsync(){return this.refresh()}refreshParam(t){return this.read(()=>Promise.reject(Object.assign(new Error("Unsupported parameter query"),{code:"ERR_NITROSENSE_UNSUPPORTED"})))}',
    'Use the same settled lifecycle for system device queries');
  replace('setLocalData(t){this._data=t}', 'setLocalData(t){this.update(t)}',
    'Invalidate pending device replies when original events deliver newer state', 2);
  // Preserve local scenario models and lighting defaults for their separate
  // audit; every queried device clears its constructor default before awaiting.
  replace('setDataWithoutScenario_And_RefreshUI(t){this.setLocalData(t),this.setDataWithoutScenario(t)}',
    'setDataWithoutScenario_And_RefreshUI(t){return this.setDataWithoutScenario(t)}',
    'Do not publish requested settings before the backend accepts the write', 2);
  replace('this.getData()!=t&&(this.setLocalData(t),this.setDataWithoutScenario(t),this._ddsc.logIt.debug(`set operating mode without scenario:${Le[t]}`))',
    'return this.getData()!=t?this.setDataWithoutScenario(t):Promise.resolve()',
    'Return operating mode write failures without an optimistic local mode');
  replace('setMode(t){this.getData()!=t&&(this.setData(t),this._ddsc.logIt.debug(`set operating mode:${Le[t]}`))}',
    'setMode(t){return this.getData()!=t?this.setData(t):Promise.resolve()}',
    'Return the original operating mode write promise');
  section('setModeWithoutScenario_And_RefreshUI(t){this._ddsc.logIt.info', 'class aIe extends Co{',
    'setModeWithoutScenario_And_RefreshUI(t){return this.getData()!=t?this.setDataWithoutScenario_And_RefreshUI(t):Promise.resolve()}}',
    'Return operating mode UI refresh failure without changing local data');
  for (const name of ['setModeWithoutScenario', 'setMode', 'setModeWithoutScenario_And_RefreshUI']) {
    replace(`${name}(t){this.setSystemMode(t),super.${name}(t)}`,
      `${name}(t){return this.setSystemMode(t),super.${name}(t)}`,
      `Preserve write settlement through the original operating mode wrapper (${name})`);
  }
  replace('fanControl.getData().', 'fanControl.getData()?.',
    'Allow fan views to consume an unavailable device value', 9);
  replace('custombootLogo.getData()).length>=1', 'custombootLogo.getData())?.length>=1',
    'Allow an unavailable boot logo query');
  replace('custombootLogo.getData().imageSource', 'custombootLogo.getData()?.imageSource',
    'Guard the unavailable boot logo image');
  section('fnDataReady(){', 'fnBatteryBoostNotify(e){',
    `fnDataReady(){return require(${device}).finishReadOnlyStartup(this)}`,
    'Finish partial startup after queries settle without retry loops or automatic profile application');
  section('SyncBatteryStatus(){', 'setDeviceData(e,a,r){',
    `SyncBatteryStatus(){return require(${device}).refreshReadOnlyPower(this)}`,
    'Refresh read-only power state without applying scenarios or writing hardware');
  replace('get IsUnplugAC(){var e;return!ou(null===(e=this.dataModel)||void 0===e?void 0:e.adaptorStatus.getData())}',
    'get IsUnplugAC(){const e=this.dataModel?.adaptorStatus.getData();return e==null?null:!ou(e)}',
    'Preserve unknown power state instead of inferring unplugged AC');
  section('get createHomeTab(){', 'get embeddedUrl(){',
    `get createHomeTab(){return require(${JSON.stringify(path.join(__dirname, 'renderer-startup.cjs'))}).createReadOnlyHome(this,Le,window.location.port)}`,
    'Keep home template evaluation synchronous when operating mode is unavailable');
  replace('getDisplayedName(t){return ml.get(Da).get(this._prefixMUI+this._typeData[t]+this._postfixMUI)}',
    'getDisplayedName(t){return ml.get(Da).get(t==null||this._typeData[t]==null?"--":this._prefixMUI+this._typeData[t]+this._postfixMUI)}',
    'Display unavailable enum values without undefined translation keys', 2);
  replace('call(t,e,...a){return this.subscribeCategory(this.getReplyTopic,t),new Promise((s,d)=>{const f=(this.funcCallbackId++).toString();var c={callId:f,fnName:e,param:a};this.client.publish(this.getCallTopic(t),JSON.stringify(c)),this.cbMap.set(f,s)})}',
    `call(t,e,...a){return require(${rpc}).callRpc(this,t,e,a)}`,
    'Register renderer RPC callbacks before publish with bounded deadlines');
  replace('this.cbMap.has(c.callId)&&(this.cbMap.get(c.callId)(c.result),this.cbMap.delete(c.callId))',
    `require(${rpc}).acceptRpcReply(this,c)`,
    'Reject explicit Linux RPC errors in the original renderer');
  replace('let ne={callId:g,reason:"fromFunction",result:yield this.fnMap.get(M)(...S)};',
    `let ne=yield require(${rpc}).rpcReply(g,()=>this.fnMap.get(M)(...S));`,
    'Reply to failed renderer RPC functions with a correlated error');
  replace('class r2{constructor(t){this._data=void 0,this.init(t),this._func=t}init(t){return pe(this,void 0,void 0,function*(){let e=yield t.call();null!=e&&(this._data=e)})}refresh(){return pe(this,void 0,void 0,function*(){this._data=yield this._func.call()})}get data(){return this._data}}',
    `class r2 extends require(${view}).CapabilityState{}`,
    'Preserve capability failures and invalidate old data without unhandled initialization rejections');
  replace('get size(){return this._data.length}', 'get size(){return Array.isArray(this._data)?this._data.length:0}',
    'Allow unavailable capability collections to render without fabricating a capability list', 2);
  replace('this.monitorData={timeStamp:new Date,CPU_CORE_AMOUNT:0,CPU_CORE_FREQUENCY:[],CPU_FREQUENCY:0,CPU_TEMPERATURE:0,CPU_USAGE:0,CPU_FANSPEED:0,GPU1_FREQUENCY:0,GPU1_TEMPERATURE:0,GPU1_USAGE:0,GPU1_IDLE_STATUS:0,GPU1_MAX_FREQUENCY:0,GPU1_FANSPEED:0,SYS1_TEMPERATURE:0,SYS1_FANSPEED:0,RAM_FREQUENCY:0,RAM_TOTAL:0,RAM_USAGE:0,ETHERNET_DOWNLOAD:0,ETHERNET_UPLOAD:0,WIFI_DOWNLOAD:0,WIFI_UPLOAD:0}',
    `this.monitorData=require(${view}).monitorSample(null)`, 'Start monitor models with unavailable readings rather than zero measurements', 2);
  replace('this.monitorDataStore.pushDatas(e),this.monitorData=e,this.updateMonitorData(e)',
    `e=require(${view}).monitorSample(e),this.monitorDataStore.pushDatas(e),this.monitorData=e,this.updateMonitorData(e)`,
    'Normalize each new monitor sample independently and clear absent readings', 2);
  replace('resetData(e){e.length=i.MaxDataCount;for(let a=0;a<i.MaxDataCount;a++)e[a]=0}',
    'resetData(e){e.length=i.MaxDataCount;for(let a=0;a<i.MaxDataCount;a++)e[a]=null}',
    'Represent history without observations as graph gaps');
  replace('CPU_Cores_Data(t,e){if(this.CPU_Core_FREQUENCY.length!=t){this.CPU_Core_FREQUENCY=[];for(var a=0;a<t;a++){var r={index:a,FrquenctList:this.SetAndGetData(e[a])};this.CPU_Core_FREQUENCY.push(r)}}else for(a=0;a<t;a++)this.CPU_Core_FREQUENCY[a].FrquenctList=this.SetAndGetData(e[a])}',
    `CPU_Cores_Data(t,e){return require(${view}).cpuDetails(this,t,e)}`,
    'Clear unavailable per-core frequency cards without accessing missing arrays');
  replace('this.cpuUsage=Math.ceil(d.CPU_USAGE),this.gpuUsage=Math.ceil(d.GPU1_USAGE)',
    `this.cpuUsage=require(${view}).ceilOrNull(d.CPU_USAGE),this.gpuUsage=require(${view}).ceilOrNull(d.GPU1_USAGE)`,
    'Do not convert null CPU or GPU usage to zero');
  replace('this.system.RAM_Usage=Math.ceil(d.RAM_TOTAL*d.RAM_USAGE/1024)/100,this.system.RAM_Usage_ratio=Math.ceil(100*d.RAM_USAGE)/100',
    `this.system.RAM_Usage=require(${view}).ramUsage(d),this.system.RAM_Usage_ratio=require(${view}).percentage(d.RAM_USAGE)`,
    'Preserve unavailable RAM in monitor subscriptions');
  replace('this.cpuTempratureMax=-1,this.cpuTempratureMin=-1,this.gpuTempratureMax=-1,this.gpuTempratureMin=-1',
    'this.cpuTempratureMax=null,this.cpuTempratureMin=null,this.gpuTempratureMax=null,this.gpuTempratureMin=null',
    'Avoid numeric temperature sentinels before observations');
  replace('this.system={temperture:10,temperture_min:-1,temperture_max:-1,RAM_Freq:4800,RAM_Usage:8.7,RAM_Usage_ratio:55.4,Ethernet_dowload:65.5,Ethernet_upload:1.4,Wifi_dowload:0,Wifi_Upload:0}',
    'this.system={temperture:null,temperture_min:null,temperture_max:null,RAM_Freq:null,RAM_Usage:null,RAM_Usage_ratio:null,Ethernet_dowload:null,Ethernet_upload:null,Wifi_dowload:null,Wifi_Upload:null}',
    'Remove example measurements from the original monitoring component initialization');
  const ramGetters = [
    'get ramUsage(){return Math.ceil(this.pss.monitorData.RAM_TOTAL*this.pss.monitorData.RAM_USAGE/1024)/100}',
    'get ramUsage(){var t,e;return(Math.ceil((null===(t=this.pss.monitorData)||void 0===t?void 0:t.RAM_TOTAL)*(null===(e=this.pss.monitorData)||void 0===e?void 0:e.RAM_USAGE)/1024)/100).toFixed(1)}',
    'get ramUsage(){var e;return Math.ceil(null===(e=this.pss.monitorData)||void 0===e?void 0:e.RAM_USAGE)||0}',
  ];
  ramGetters.forEach((before, index) => replace(before, index === 2 ?
    `get ramUsage(){return require(${view}).displayNumber(require(${view}).ceilOrNull(this.pss.monitorData?.RAM_USAGE))}` :
    `get ramUsage(){return require(${view}).ramUsage(this.pss.monitorData,${index === 1})}`,
    `Display unavailable RAM in original view ${index + 1}`));
  for (const [name, count] of [['e', 2], ['t', 1]]) replace(
    `get ramUsageRatio(){var ${name};return(Math.ceil(100*(null===(${name}=this.pss.monitorData)||void 0===${name}?void 0:${name}.RAM_USAGE))/100).toFixed(1)}`,
    `get ramUsageRatio(){return require(${view}).percentage(this.pss.monitorData?.RAM_USAGE)}`,
    `Preserve unavailable RAM ratios (${name})`, count);
  replace('temperatureConvert(e){return 0==e?"--":this.gos.temperatureUnit==Qr.Celsius||null==this.gos.temperatureUnit?e:Math.floor(1.8*e)+32}',
    `temperatureConvert(e){return require(${view}).temperature(e,this.gos.temperatureUnit==Qr.Fahrenheit)}`, 'Guard toolbar temperature units');
  replace('temperatureConvert(t){return 0==t?"--":this.tempUnit==Qr.Celsius||null==this.tempUnit?t:Math.floor(1.8*t)+32}',
    `temperatureConvert(t){return require(${view}).temperature(t,this.tempUnit==Qr.Fahrenheit)}`, 'Guard monitor temperature units');
  replace('temperatureConvert(t){return 0==t?"--":this.gos.tempUnit==Qr.Fahrenheit?Math.floor(1.8*t)+32:t}',
    `temperatureConvert(t){return require(${view}).temperature(t,this.gos.tempUnit==Qr.Fahrenheit)}`, 'Guard overlay temperature units');
  replace('normalizeNum(t){return t<1e3?t.toFixed(1):(t/1e3).toFixed(1)}',
    `normalizeNum(t){return require(${view}).finite(t)?(t<1e3?t.toFixed(1):(t/1e3).toFixed(1)):"--"}`,
    'Render unavailable network throughput without calling toFixed on null');
  replace('getUnit(t){return this.tr.instant(t<1e3?"MUI_Kbps":"MUI_Mbps")}',
    `getUnit(t){return require(${view}).finite(t)?this.tr.instant(t<1e3?"MUI_Kbps":"MUI_Mbps"):""}`,
    'Avoid assigning a dynamic throughput scale to an unavailable reading');
  replace('this.modeNumList=this.pss.HWSupport.operatingMode.data.filter(e=>e!=Le.ECO)',
    'this.modeNumList=this.pss.HWSupport?.operatingMode?.data?.filter(e=>e!=Le.ECO)??null',
    'Allow shared introduction dialogs without an operating mode capability list');
  replace('getCeil(t){return 0==t?"--":Math.ceil(t)}',
    `getCeil(t){return require(${view}).displayNumber(require(${view}).ceilOrNull(t))}`, 'Preserve real zero usage while marking unavailable readings');
  replace('valueConvert(e){return 0==e||null==e?"--":e}', `valueConvert(e){return require(${view}).displayNumber(e)}`, 'Format finite toolbar values only');
  replace('valueConvert(t){return 0==t||null==t?"--":t.toString()}', `valueConvert(t){return require(${view}).displayNumber(t)}`, 'Format finite monitor values only');
  for (const signature of ['getGpuData(e){', 'getGpuData(e,a){', 'getGpuData(t,e){', 'getGpuData(t){']) {
    const arg = signature[11];
    replace(signature, `${signature}if(!require(${view}).finite(${arg}))return"--";`, `Guard unavailable GPU values (${signature})`);
  }
  const start = source.indexOf('setMonitorDataMaxMin(){'), end = source.indexOf('getGpuData(t,e){', start);
  if (start < 0 || end < 0) throw new Error('Reviewed temperature extrema boundary no longer matches');
  replace(source.slice(start, end),
    `setMonitorDataMaxMin(){return require(${view}).temperatureExtrema(this,ma.GPU_TEMPERATURE,ma.CPU_TEMPERATURE,ma.SYS_TEMPERATURE)}`,
    'Use only observed temperatures for history extrema');
  replace('get cpuUsageDasharray(){var t,e=Math.floor(this.monitorData.CPU_FREQUENCY/(null===(t=this.pss.HWSupport)||void 0===t?void 0:t.CPUInfo.data[0].cpu_max_frequency)*100);return`${3.3*e}px ${440-3.3*e}px`}',
    `get cpuUsageDasharray(){return require(${view}).cpuGauge(this)}`, 'Guard gauges while CPU capability is unavailable');
  replace('get cpuNeedleRotate(){return this.pss.HWSupport.CPUInfo.data[0].cpu_max_frequency>0?`rotate(${2.7*Math.floor(this.monitorData.CPU_FREQUENCY/this.pss.HWSupport.CPUInfo.data[0].cpu_max_frequency*100)}deg)`:"rotate(0deg)"}',
    `get cpuNeedleRotate(){return require(${view}).cpuGauge(this,true)}`, 'Avoid a measured CPU needle position without a maximum frequency');
  const direct = /W\(e\.monitorData\.([A-Z][A-Z0-9_]+)\)/g;
  const optional = /W\(null==e\.monitorData\?null:e\.monitorData\.([A-Z][A-Z0-9_]+)\)/g;
  if ([...source.matchAll(direct)].length !== 6 || [...source.matchAll(optional)].length !== 3) throw new Error('Reviewed monitor text bindings no longer match');
  source = source.replace(direct, (_all, key) => `W(require(${view}).displayNumber(e.monitorData.${key}))`)
    .replace(optional, (_all, key) => `W(require(${view}).displayNumber(e.monitorData?.${key}))`);
  patches.push('Display unavailable direct monitor text bindings without numeric coercion');
  return { source, patches };
}
module.exports = { transformRenderer, RENDERER_FILE, RENDERER_SHA256 };
