// Acer native-addon shape adapter. Linux operations and our preferences live in Rust.
const { EventEmitter } = require('node:events');
const { callSync } = require('./backend-client.cjs');
function unsupported(operation) {
  return Object.assign(new Error(`NitroSense Linux: ${operation} unavailable`), { code: 'ERR_NITROSENSE_UNSUPPORTED' });
}
function createPlatform({ app, productVersion, electron }) {
  const snapshot = callSync('snapshot');
  const identity = snapshot.identity;
  const xsense = 'software\\acer\\xsense', guid = '{NITROSENSE-LINUX-IMPORTED-CONFIG}';
  const normalize = branch => branch.replaceAll('/', '\\').toLowerCase();
  const key = (hive, branch, name) => `${hive}:${normalize(branch)}:${name.toLowerCase()}`;
  const getRegistryValue = (hive, branch, name) => {
    branch = normalize(branch); name = name.toLowerCase();
    let value;
    if (hive === 2 && branch === 'hardware\\description\\system\\bios') {
      value = ({ systemproductname: identity.model, systemfamily: identity.family })[name];
      if (!value) throw unsupported('DMI identity'); return value;
    }
    if (hive === 2 && branch === 'hardware\\description\\system\\centralprocessor\\0' && name === 'processornamestring') {
      if (!identity.cpu) throw unsupported('CPU identity'); return identity.cpu;
    }
    if (hive === 2 && branch === 'software\\acer\\nitrosense' && name === 'guid') return guid;
    if (hive === 2 && branch === `software\\microsoft\\windows\\currentversion\\uninstall\\${guid.toLowerCase()}` && name === 'displayversion') return productVersion;
    if (hive === 1 && branch === xsense && name === 'simulatormode') return '0';
    if (branch === xsense) return callSync('preference', { key: key(hive, branch, name) }) ?? '';
    return '';
  };
  let mainWindow;
  const native = {
    getRegistryValue,
    getRegistryUInt32(hive, branch, name) {
      if (hive === 2 && normalize(branch) === 'software\\oem\\aceragentservice' && name === 'SupportAES') return 0;
      if (hive === 1 && normalize(branch) === 'software\\microsoft\\lighting' && name === 'AmbientLightingEnabled') return 0;
      const value = getRegistryValue(hive, branch, name);
      if (value === '' || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 0xffffffff) throw unsupported('DWORD');
      return Number(value);
    },
    setRegistryValue(hive, branch, name, value) {
      if (hive !== 1 || normalize(branch) !== xsense) throw unsupported('registry write');
      callSync('set_preference', { key: key(hive, branch, name), value });
    },
    RegistryPathIsExist: (hive, branch) => hive === 2 && normalize(branch) === 'software\\acer\\nitrosense',
    initLogSystem() {}, ndLog() {}, // Raw Acer logs can contain credentials; never persist through the adapter.
    getWMIValue(className, property) {
      const name = ({ 'win32_bios.serialnumber': 'serial', 'win32_computersystemproduct.uuid': 'uuid' })[`${className}.${property}`.toLowerCase()];
      if (!name) throw unsupported('WMI query'); return callSync('device_identifier', { name });
    },
    getDisplayLanguage: () => app.getLocale(), getDisplayLanguage2: () => app.getLocale(), getCurrentLocation: () => app.getLocaleCountryCode(),
    isMobilePlatform() { if (identity.mobile === null) throw unsupported('chassis identity'); return identity.mobile; },
    startWhisperMonitor(callback) { queueMicrotask(() => callback({ support: false, enable: false, result: false })); },
    getAllProcess: () => callSync('processes').map(p => ({ processId: p.pid, exeFile: p.name })),
    getAllInstalledApps: () => callSync('applications', { locale: app.getLocale() }).map(a => ({
      id: a.id, desktopId: a.id.slice('linux-desktop:'.length), display: a.name, platform: 'linux',
      desktopFile: a.desktop_file, linkTargetParsingPath: a.desktop_file, packageInstallPath: '', isWin32Desktop: false,
      ...(a.executable ? { executablePath: a.executable } : {}), ...(a.icon ? { icon: a.icon } : {}),
    })),
    async getAppIconDataUri(id) {
      const item = callSync('applications', { locale: app.getLocale() }).find(a => a.id === id);
      if (!item) throw unsupported('application icon');
      const image = await app.getFileIcon(item.desktop_file, { size: 'normal' });
      if (image.isEmpty()) throw unsupported('application icon'); return image.toDataURL();
    },
    getKeyboard_PID_VID: () => callSync('keyboards').map(k => `VID_${k.vendor}&PID_${k.product}`),
    setupMainWindow(handle, callback) {
      if (typeof callback !== 'function') throw new TypeError('Window callback required');
      mainWindow = electron.BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getNativeWindowHandle().readUInt32LE(0) === handle);
      if (!mainWindow) throw unsupported('main window');
    },
    minimizeMainWindow() { if (!mainWindow || mainWindow.isDestroyed()) throw unsupported('main window'); mainWindow.minimize(); },
    GetDisplayMaxResolution() {
      const displays = electron.screen.getAllDisplays(); if (!displays.length) throw unsupported('display');
      return displays.reduce((a,b) => a.size.width*a.size.height > b.size.width*b.size.height ? a : b).size;
    },
    messageBox: message => electron.dialog.showErrorBox('NitroSense', String(message)),
  };
  for (const name of ['GetBrightness','GetVolume','IsLogoDigitalMusicExist','IsRpdbqDigitalMusicExist','Lighting','SetBrightness','SetInteractiveBrightness',
    'SetInteractiveLighting','SetLogoDigitalBrightness','SetLogoDigitalMusic','SetVolume','getActiveProcess','getForegrundWindow','getRunningApps',
    'getUserFileInfo','setWhisperMode','shellExecute','shellExecuteFromExplorer']) native[name] = () => { throw unsupported(name); };
  class FullPowerShell { call() { return { subscribe(observer) { queueMicrotask(() => { const r = { success: [], error: ['PowerShell unavailable'] }; typeof observer === 'function' ? observer(r) : observer.next(r); }); return { unsubscribe() {} }; } }; } destroy() {} }
  class PowerShell extends EventEmitter { constructor() { super(); queueMicrotask(() => { this.emit('error-output', 'PowerShell unavailable'); this.emit('end', 1); }); } }
  return { native,
    store: { StoreContext: { getDefault: () => ({ getAppAndOptionalStorePackageUpdatesAsync: cb => queueMicrotask(() => cb(unsupported('Microsoft Store'), undefined)) }) } },
    devices: { DeviceInformation: { findAllAsync: (_kind, cb) => queueMicrotask(() => cb(unsupported('Windows devices'), undefined)) } },
    powershell: { PowerShell: FullPowerShell, legacy: PowerShell },
  };
}
module.exports = { createPlatform, unsupported };
