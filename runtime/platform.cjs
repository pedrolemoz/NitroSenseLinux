'use strict';

// Boundary shapes are taken from the supplied 5.1.392 main.js, not the DLL ABI.
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDesktopCatalog } = require('../lib/desktop-apps.cjs');

function unsupported(operation) {
  const error = new Error(`NitroSense Linux: ${operation} is not implemented on this platform`);
  error.code = 'ERR_NITROSENSE_UNSUPPORTED';
  error.operation = operation;
  return error;
}

function createPlatform(options) {
  const { app, stateDir, vendorRoot, productVersion, model, electron,
    dmiRoot = '/sys/class/dmi/id', procRoot = '/proc', sysRoot = '/sys', desktopOptions = {} } = options;
  if (!app || !path.isAbsolute(stateDir || '') || !path.isAbsolute(vendorRoot || '')) {
    throw new TypeError('app, absolute stateDir and absolute vendorRoot are required');
  }
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(productVersion || '')) {
    throw new TypeError('productVersion must be the verified imported configuration version');
  }
  if (!fs.statSync(vendorRoot).isDirectory()) throw new TypeError('vendorRoot must be an imported directory');
  const read = file => fs.readFileSync(file, 'utf8').trim();
  const dmi = name => read(path.join(dmiRoot, name));
  fs.mkdirSync(stateDir, { recursive: true });
  const registryFile = path.join(stateDir, 'platform-registry.json');
  let preferences = {};
  try { preferences = JSON.parse(read(registryFile)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!preferences || Array.isArray(preferences) || typeof preferences !== 'object') {
    throw new Error('Invalid platform-registry.json');
  }
  const key = (hive, branch, name = '') => `${hive}:${branch.replace(/\//g, '\\').toLowerCase()}:${name.toLowerCase()}`;
  const bios = 'hardware\\description\\system\\bios';
  // This is a virtual installation identity, never a Windows MSI registration.
  const importedGuid = '{NITROSENSE-LINUX-IMPORTED-CONFIG}';
  const xsense = 'software\\acer\\xsense';
  const getRegistryValue = (hive, branch, name) => {
    branch = branch.replace(/\//g, '\\').toLowerCase();
    const lowerName = name.toLowerCase();
    if (hive === 2 && branch === bios) {
      if (lowerName === 'systemproductname') return model || dmi('product_name');
      if (lowerName === 'systemfamily') return dmi('product_family');
    }
    if (hive === 2 && branch === 'hardware\\description\\system\\centralprocessor\\0' && lowerName === 'processornamestring') {
      const match = read(path.join(procRoot, 'cpuinfo')).match(/^model name\s*:\s*(.+)$/m);
      if (!match) throw unsupported('CPU model from /proc/cpuinfo');
      return match[1];
    }
    if (hive === 2 && branch === 'software\\acer\\nitrosense' && lowerName === 'guid') return importedGuid;
    if (hive === 2 && branch === `software\\microsoft\\windows\\currentversion\\uninstall\\${importedGuid.toLowerCase()}` && lowerName === 'displayversion') return productVersion;
    // Missing optional Windows registry entries have the DLL's observed empty-string shape.
    if (branch === xsense) return Object.hasOwn(preferences, key(hive, branch, name)) ? preferences[key(hive, branch, name)] : '';
    return '';
  };
  let logging = false;
  const logFile = path.join(stateDir, 'platform.log');
  let mainWindow;
  const desktopCatalog = createDesktopCatalog({ locale: () => app.getLocale(), ...desktopOptions });
  const native = {
    getRegistryValue,
    getRegistryUInt32(hive, branch, name) {
      // Linux bridge uses unencrypted loopback transport; no OEM AgentService key exists.
      if (hive === 2 && branch.toLowerCase() === 'software\\oem\\aceragentservice' && name === 'SupportAES') return 0;
      if (hive === 1 && branch.toLowerCase() === 'software\\microsoft\\lighting' && name === 'AmbientLightingEnabled') return 0;
      const value = getRegistryValue(hive, branch, name);
      if (value === '') throw unsupported(`missing DWORD ${branch}\\${name}`);
      if (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 0xffffffff) throw new TypeError('Invalid registry DWORD');
      return Number(value);
    },
    setRegistryValue(hive, branch, name, value) {
      if (hive !== 1 || branch.toLowerCase() !== xsense) throw unsupported(`registry write ${branch}\\${name}`);
      if (typeof value !== 'string' && typeof value !== 'number') throw new TypeError('Registry value must be a string or number');
      preferences[key(hive, branch, name)] = value;
      fs.writeFileSync(`${registryFile}.tmp`, JSON.stringify(preferences, null, 2), { mode: 0o600 });
      fs.renameSync(`${registryFile}.tmp`, registryFile);
    },
    RegistryPathIsExist(hive, branch) {
      const normalized = branch.toLowerCase();
      return (hive === 2 && normalized === 'software\\acer\\nitrosense') ||
        Object.keys(preferences).some(value => value.startsWith(`${hive}:${normalized}:`));
    },
    initLogSystem(_directory, enabled) { logging = Boolean(enabled); },
    ndLog(level, message) {
      if (logging) fs.appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${String(message)}\n`, { mode: 0o600 });
    },
    getWMIValue(className, property) {
      const query = `${className}.${property}`.toLowerCase();
      if (query === 'win32_bios.serialnumber') return dmi('product_serial');
      if (query === 'win32_computersystemproduct.uuid') return dmi('product_uuid');
      throw unsupported(`WMI ${className}.${property}`);
    },
    getDisplayLanguage() { return app.getLocale(); },
    getDisplayLanguage2() { return app.getLocale(); },
    getCurrentLocation() { return app.getLocaleCountryCode(); },
    startWhisperMonitor(callback) {
      if (typeof callback !== 'function') throw new TypeError('Whisper monitor callback required');
      // PSSdk consumes these fields. NVIDIA Windows WhisperMode has no implemented backend.
      queueMicrotask(() => callback({ support: false, enable: false, result: false }));
    },
    isMobilePlatform() { return [8, 9, 10, 11, 14, 30, 31, 32].includes(Number(dmi('chassis_type'))); },
    getAllProcess() {
      return fs.readdirSync(procRoot).filter(name => /^\d+$/.test(name)).flatMap(name => {
        try { return [{ processId: Number(name), exeFile: read(path.join(procRoot, name, 'comm')) }]; }
        catch (error) { if (['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) return []; throw error; }
      });
    },
    getAllInstalledApps() {
      const { apps, issues } = desktopCatalog.scan();
      fs.writeFileSync(path.join(stateDir, 'desktop-apps-status.json'), JSON.stringify({
        collectedAt: new Date().toISOString(), source: 'xdg-desktop-entries', applications: apps.length, issues,
        limitation: 'Launcher inventory; not all installed binaries or a running-process association.',
      }, null, 2), { mode: 0o600 });
      return apps;
    },
    async getAppIconDataUri(id) {
      const entry = desktopCatalog.lookup(id);
      if (typeof app.getFileIcon !== 'function') throw unsupported('Linux file icons require Electron');
      const image = await app.getFileIcon(entry.desktopFile, { size: 'normal' });
      if (image.isEmpty()) throw unsupported('Linux application icon unavailable');
      return image.toDataURL();
    },
    getKeyboard_PID_VID() {
      const root = path.join(sysRoot, 'class', 'input');
      return fs.readdirSync(root).filter(name => /^event\d+$/.test(name)).flatMap(name => {
        const device = path.join(root, name, 'device');
        const events = read(path.join(device, 'capabilities', 'ev'));
        // EV_KEY alone also includes mice; require keyboard keys in the supported-key bitmap.
        const keys = read(path.join(device, 'capabilities', 'key')).split(/\s+/).reverse();
        const keyA = keys.length && (BigInt(`0x${keys[0]}`) & (1n << 30n));
        if (!(BigInt(`0x${events.split(/\s+/).pop()}`) & 2n) || !keyA) return [];
        const vendor = read(path.join(device, 'id', 'vendor')).toUpperCase().padStart(4, '0');
        const product = read(path.join(device, 'id', 'product')).toUpperCase().padStart(4, '0');
        return [`VID_${vendor}&PID_${product}`];
      });
    },
    setupMainWindow(handle, callback) {
      if (!electron?.BrowserWindow) throw unsupported('setupMainWindow requires Electron BrowserWindow');
      mainWindow = electron.BrowserWindow.getAllWindows().find(window => !window.isDestroyed() &&
        window.getNativeWindowHandle().readUInt32LE(0) === handle);
      if (!mainWindow) throw new Error('No Electron window exists for setupMainWindow');
      if (typeof callback !== 'function') throw new TypeError('Window callback required');
      // WM_SETTINGCHANGE has no Linux equivalent; no synthetic native messages are emitted.
    },
    minimizeMainWindow() {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('NitroSense main window has not been registered');
      mainWindow.minimize();
    },
    GetDisplayMaxResolution() {
      if (!electron?.screen) throw unsupported('display resolution requires Electron screen');
      const displays = electron.screen.getAllDisplays();
      if (!displays.length) throw new Error('No display detected');
      const display = displays.reduce((a, b) => a.size.width * a.size.height > b.size.width * b.size.height ? a : b);
      return { width: display.size.width, height: display.size.height };
    },
    messageBox(message) {
      if (!electron?.dialog) throw unsupported('messageBox requires Electron dialog');
      electron.dialog.showErrorBox('NitroSense', String(message));
    }
  };
  for (const name of ['GetBrightness', 'GetVolume', 'IsLogoDigitalMusicExist', 'IsRpdbqDigitalMusicExist',
    'Lighting', 'SetBrightness', 'SetInteractiveBrightness', 'SetInteractiveLighting', 'SetLogoDigitalBrightness',
    'SetLogoDigitalMusic', 'SetVolume', 'getActiveProcess',
    'getForegrundWindow', 'getRunningApps', 'getUserFileInfo', 'setWhisperMode', 'shellExecute',
    'shellExecuteFromExplorer']) {
    native[name] = () => { throw unsupported(`xsense_native.${name}`); };
  }
  const store = {
    StoreContext: { getDefault: () => ({
      getAppAndOptionalStorePackageUpdatesAsync(callback) {
        queueMicrotask(() => callback(unsupported('Microsoft Store updates'), undefined));
      }
    }) }
  };
  const devices = {
    DeviceInformation: {
      findAllAsync(kind, callback) {
        queueMicrotask(() => callback(unsupported(`Windows DeviceInformation kind ${kind}`), undefined));
      }
    }
  };
  class FullPowerShell {
    call(command) {
      return { subscribe(observer) {
        const response = { success: [], error: [unsupported(`PowerShell: ${command}`).message] };
        queueMicrotask(() => typeof observer === 'function' ? observer(response) : observer.next(response));
        return { unsubscribe() {} };
      } };
    }
    destroy() {}
  }
  class PowerShell extends EventEmitter {
    constructor(command) {
      super();
      queueMicrotask(() => {
        const error = unsupported(`PowerShell: ${command}`);
        this.emit('error-output', error.message);
        if (this.listenerCount('error')) this.emit('error', error);
        this.emit('end', 1);
      });
    }
  }
  return { native, store, devices, powershell: { PowerShell: FullPowerShell, legacy: PowerShell } };
}

module.exports = { createPlatform, unsupported };
