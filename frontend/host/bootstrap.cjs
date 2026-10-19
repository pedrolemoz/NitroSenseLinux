// Host the verified original Acer application. No Linux hardware access lives here.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const electron = require('electron');
const { createPlatform, unsupported } = require('./platform.cjs');
const { transformSource } = require('./source-patches.cjs');
const { rendererPreloadSource } = require('./renderer-modules.cjs');
const { startReadOnlySession } = require('./readonly-session.cjs');
const { createFsFacade } = require('./asset-overrides.cjs');
const { acquireInstance } = require('./single-instance.cjs');
const project = path.resolve(__dirname, '../..');
let session;
async function boot() {
  if (process.platform !== 'linux' || process.versions.electron !== '26.6.10') throw new Error('Original host currently requires Linux Electron 26.6.10; supported-runtime migration remains pending');
  if (process.getuid?.() === 0) throw new Error('Run as the desktop user');
  if (!process.argv.includes('--experimental-runtime')) throw new Error('Legacy Electron hardening is incomplete; use the documented --experimental-runtime entrypoint');
  // Existing Acer runtime limitation, recorded as a release blocker. These flags
  // are never represented as a hardened or completed runtime migration.
  electron.app.commandLine.appendSwitch('no-sandbox');
  electron.app.commandLine.appendSwitch('ignore-certificate-errors');
  const index = process.argv.indexOf('--vendor');
  if (index < 0 || !process.argv[index + 1]) throw new Error('--vendor <verified import> required');
  const root = fs.realpathSync(process.argv[index + 1]);
  execFileSync(path.join(project, 'backend/target/debug/nitrosense-tools'), ['check-original', '--vendor', root],
    { timeout: 30000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'import.json'), 'utf8'));
  const stateDir = process.env.NITROSENSE_STATE_DIR;
  if (!stateDir || !path.isAbsolute(stateDir)) throw new Error('Absolute private frontend state directory required');
  const app = electron.app;
  if (process.argv.includes('--inspect')) require('./inspect.cjs').install(app, stateDir);
  app.setName('NitroSense');
  const frontendState = path.join(process.env.XDG_STATE_HOME || path.join(require('node:os').homedir(), '.local/state'), 'nitrosense-linux/frontend');
  fs.mkdirSync(frontendState, { recursive: true, mode: 0o700 });
  app.setPath('userData', frontendState);
  if (!acquireInstance(app)) return;
  const originalGetPath = app.getPath.bind(app);
  app.getPath = name => name === 'exe' ? path.join(root, 'NitroSense.exe') : originalGetPath(name);
  app.getVersion = () => manifest.version;
  // Original Store uses oemFolder/ProfilePool, not Electron's userData. Keep
  // that original store stable; only diagnostic overlays belong to the session.
  const oemRoot = path.join(frontendState, 'oem/NitroSense');
  fs.mkdirSync(oemRoot, { recursive: true, mode: 0o700 });
  fs.cpSync(path.join(root, 'oem/NitroSense/Common'), path.join(oemRoot, 'Common'), { recursive: true });
  const platform = createPlatform({ app, productVersion: manifest.version, electron });
  session = await startReadOnlySession({ vendorRoot: root, stateDir });
  app.once('will-quit', () => { void session.close(); });
  const vendorFs = createFsFacade(fs, file => session.mapPath(typeof file === 'string' && file.startsWith(oemRoot) ? file.replaceAll('\\', '/') : file));
  const mappings = new Map([
    ['xsense_native', platform.native], ['@nodert-win10-rs4/windows.services.store', platform.store],
    ['@nodert-win10-rs4/windows.devices.enumeration', platform.devices], ['full-powershell', platform.powershell],
    ['powershell', platform.powershell.legacy], ['fs', vendorFs], ['fs/promises', vendorFs.promises],
    ['win-audio', { get speakers() { throw unsupported('Windows audio'); } }],
  ]);
  const originalLoad = Module._load;
  Module._load = function(request, parent) {
    if (parent?.filename?.startsWith(root + path.sep) && mappings.has(request)) return mappings.get(request);
    return originalLoad.apply(this, arguments);
  };
  const entry = path.join(root, 'resources/app.asar/main.js');
  const preload = path.join(stateDir, 'renderer-preload.cjs');
  const diagnostics = process.argv.includes('--inspect') ? '\nwindow.addEventListener("error",e=>console.error("[inspection-stack] "+String(e.error?.stack||e.message)));\n' : '';
  fs.writeFileSync(preload, rendererPreloadSource(root) + diagnostics, { mode: 0o600 });
  const originalJs = Module._extensions['.js'];
  Module._extensions['.js'] = function(module, filename) {
    if (filename !== entry) return originalJs(module, filename);
    const { source, patches } = transformSource(fs.readFileSync(filename, 'utf8'), oemRoot, preload, { readOnly: true });
    fs.writeFileSync(path.join(stateDir, 'applied-patches.json'), JSON.stringify({ asarSha256: manifest.asarSha256,
      backend: 'rust', patches, rendererPatches: session.renderer.patches }), { mode: 0o600 });
    module._compile(source, filename);
  };
  if (!process.argv.includes('--forceShow')) process.argv.push('--forceShow');
  require(entry);
}
boot().catch(async error => {
  console.error('[NitroSense host]', error.code || error.message);
  await session?.close(); electron.app.exit(1);
});
