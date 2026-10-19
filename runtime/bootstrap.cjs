// Experimental Linux entrypoint. Vendor ASAR is never changed on disk.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const electron = require('electron');
const { verifyVendor } = require('../lib/vendor.cjs');
const { createPlatform, unsupported } = require('./platform.cjs');
const { transformSource } = require('./source-patches.cjs');
const { rendererPreloadSource } = require('./renderer-modules.cjs');
const { startReadOnlySession } = require('./readonly-session.cjs');
const { createFsFacade } = require('./asset-overrides.cjs');
const { modeBannerSource } = require('./mode-banner.cjs');
let readOnlySession;
async function boot() {
  if (process.platform !== 'linux' || !process.versions.electron) throw new Error('Launch with Electron Linux');
  if (process.versions.electron !== '26.6.10') throw new Error('This adapter requires Electron 26.6.10 for the first compatibility experiment');
  const readOnly = process.argv.includes('--read-only'), uiOnly = process.argv.includes('--ui-only');
  if (readOnly === uiOnly) throw new Error('Choose exactly one explicit mode: --ui-only or --read-only. Hardware controls are not implemented.');
  if (process.getuid?.() === 0) throw new Error('Run the UI as an ordinary user, without sudo');
  const vendorIndex = process.argv.indexOf('--vendor');
  if (vendorIndex < 0 || !process.argv[vendorIndex + 1]) throw new Error('--vendor <import-directory> is required');
  const { root, manifest } = verifyVendor(path.resolve(process.argv[vendorIndex + 1]));
  const stateDir = path.resolve(process.env.NITROSENSE_STATE_DIR || path.join(process.env.XDG_STATE_HOME || path.join(require('os').homedir(), '.local/state'), 'nitrosense-linux'));
  const oemRoot = path.join(stateDir, 'oem/NitroSense');
  fs.mkdirSync(oemRoot, { recursive: true });
  fs.cpSync(path.join(root, 'oem/NitroSense/Common'), path.join(oemRoot, 'Common'), { recursive: true });
  const app = electron.app;
  // The reviewed Acer entrypoint already sets this flag, but loading it after
  // awaiting the Linux service is too late for Chromium's early helper startup.
  // Preserve the existing experimental compatibility policy before any await.
  app.commandLine.appendSwitch('no-sandbox');
  // The original local HTTPS/MQTT server uses a self-signed certificate. Its
  // existing certificate flag must also precede Chromium initialization.
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.setName(readOnly ? 'NitroSense Linux — READ ONLY' : 'NitroSense Linux — UI ONLY');
  const userData = path.join(stateDir, readOnly ? 'electron-read-only-data' : 'electron-user-data');
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  const originalGetPath = app.getPath.bind(app);
  app.getPath = name => name === 'exe' ? path.join(root, 'NitroSense.exe') : originalGetPath(name);
  app.getVersion = () => manifest.version;
  const platform = createPlatform({ app, stateDir, vendorRoot: root, productVersion: manifest.version, electron });
  const originalRegistryValue = platform.native.getRegistryValue;
  platform.native.getRegistryValue = (hive, branch, name) => {
    if (hive === 1 && branch.toLowerCase() === 'software\\acer\\xsense' && name.toLowerCase() === 'simulatormode') return readOnly ? '0' : '1';
    return originalRegistryValue(hive, branch, name);
  };
  if (readOnly) {
    readOnlySession = await startReadOnlySession({ vendorRoot: root, stateDir });
    // A canceled quit (the original X hides the window) must keep the service alive.
    app.once('will-quit', () => { void readOnlySession.close().catch(error => console.error('[compat-backend] shutdown failed:', error.code || 'UNKNOWN')); });
  }
  const mappedPath = value => {
    const normalized = typeof value === 'string' && value.startsWith(oemRoot) ? value.replace(/\\/g, '/') : value;
    return readOnlySession ? readOnlySession.mapPath(normalized) : normalized;
  };
  const vendorFs = createFsFacade(fs, mappedPath);
  const originalLoad = Module._load;
  const mappings = new Map([
    ['xsense_native', platform.native],
    ['@nodert-win10-rs4/windows.services.store', platform.store],
    ['@nodert-win10-rs4/windows.devices.enumeration', platform.devices],
    ['full-powershell', platform.powershell], ['powershell', platform.powershell.legacy],
    ['fs', vendorFs], ['fs/promises', vendorFs.promises],
    ['win-audio', { get speakers() { throw unsupported('Windows audio'); } }],
  ]);
  Module._load = function(request, parent, isMain) {
    if (parent?.filename?.startsWith(root + path.sep) && mappings.has(request)) return mappings.get(request);
    return originalLoad.apply(this, arguments);
  };
  const entry = path.join(root, 'resources/app.asar/main.js');
  const rendererPreload = path.join(stateDir, 'renderer-preload.cjs');
  fs.writeFileSync(rendererPreload, rendererPreloadSource(root), { mode: 0o600 });
  const originalJs = Module._extensions['.js'];
  Module._extensions['.js'] = function(module, filename) {
    if (filename !== entry) return originalJs(module, filename);
    const { source, patches } = transformSource(fs.readFileSync(filename, 'utf8'), oemRoot, rendererPreload, { readOnly });
    fs.writeFileSync(path.join(stateDir, 'applied-patches.json'), JSON.stringify({ asarSha256: manifest.asarSha256, mode: readOnly ? 'read-only' : 'ui-only',
      hostPlatform: process.platform, simulatorMode: platform.native.getRegistryValue(1, 'software\\acer\\xsense', 'SimulatorMode'), patches,
      rendererPatches: readOnlySession?.renderer.patches || [] }, null, 2));
    module._compile(source, filename);
  };
  app.on('browser-window-created', (_event, window) => {
    window.on('close', () => console.error('[compat-window] close requested'));
    window.on('closed', () => console.error('[compat-window] closed'));
    window.webContents.on('preload-error', (_event, preload, error) =>
      console.error('[compat-renderer] preload failed:', preload, error.message));
    window.webContents.on('dom-ready', () => {
      window.webContents.executeJavaScript(modeBannerSource(readOnly)).catch(error => console.error(error.message));
    });
  });
  app.on('before-quit', () => console.error('[compat-app] before-quit'));
  app.on('will-quit', () => console.error('[compat-app] will-quit'));
  if (!process.argv.includes('--forceShow')) process.argv.push('--forceShow');
  console.error(readOnly ? 'READ-ONLY EXPERIMENT: live Linux sources; unavailable readings remain unknown; hardware controls disabled.' :
    'INTERFACE-ONLY EXPERIMENT: original Acer simulator; no real hardware control.');
  require(entry);
}
boot().catch(async error => {
  console.error(error.stack); process.exitCode = 1;
  try { await readOnlySession?.close(); } finally { electron.app?.exit(1); }
});
