// Test harness: original Acer main + full Angular renderer with fixture-only
// platform/telemetry. Never loads the native Acer DLL, drivers or real sensors.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const electron = require('electron');
const project = path.resolve(__dirname, '..');
// Install before guards or production loading. Electron's default handler opens
// a native modal on uncaught main-process errors, even for a hidden test window.
function abort(error) {
  fs.mkdirSync(path.join(project, '.state'), { recursive: true });
  fs.writeFileSync(path.join(project, '.state/ui-smoke-startup-error.txt'), String(error?.stack || error));
  console.error('UI_SMOKE_FAILED: see .state/ui-smoke-startup-error.txt');
  if (electron.app) electron.app.exit(1); else process.exit(1);
}
process.on('uncaughtException', abort);
process.on('unhandledRejection', error => {
  report.mainErrors ||= [];
  if (report.mainErrors.length < 100) report.mainErrors.push({ code: error?.code || 'ERR_UI_REJECTION', stack: String(error?.stack || error).slice(0, 2400) });
});
electron.dialog.showErrorBox = (_title, content) => abort(new Error(content));
if (process.versions.electron !== '26.6.10') { abort(new Error('Run with the separate Electron 26.6.10 test runtime')); return; }
const output = path.join(project, '.state', 'ui-smoke-' + new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(output, { recursive: true });
const fixture = path.join(output, 'fixture');
const put = (file, value) => { const p = path.join(fixture, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
put('dmi/product_name', 'Nitro ANV15-52'); put('dmi/product_family', 'Nitro'); put('dmi/chassis_type', '10');
put('proc/cpuinfo', 'model name : Fixture CPU\n');
put('bin/editor', '#!/bin/sh\nexit 97\n');
fs.chmodSync(path.join(fixture, 'bin/editor'), 0o700);
put('applications/fixture.desktop', '[Desktop Entry]\nType=Application\nName=Fixture Editor\nExec="' + path.join(fixture, 'bin/editor') + '"\n');
fs.mkdirSync(path.join(fixture, 'sys/class/input'), { recursive: true });
const originalPlatform = require('../runtime/platform.cjs');
const originalBridge = require('../runtime/readonly-bridge.cjs');
let fixtureBridge;
const originalLoad = Module._load;
const bootstrap = path.join(project, 'runtime/bootstrap.cjs');
const vendor = path.join(project, 'vendor/nitrosense-5.2.84-official');
let uiPort;
const allowedPorts = [];
const report = { fixtureOnly: true, nativeHardwareAccess: false, rendererErrors: [], pages: [] };
const failure = () => Object.assign(new Error('Fixture unavailable'), { code: 'EACCES' });
const childFailure = () => Object.assign(new Error('External process disabled in UI test'), { code: 'ERR_NITROSENSE_UNSUPPORTED' });
let sequence = 0;
let fixtureUsage = 17;
Module._load = function(request, parent, isMain) {
  if (parent?.filename === bootstrap && request === './source-patches.cjs') {
    const patches = originalLoad.apply(this, arguments);
    return { ...patches, transformSource(...args) {
      const result = patches.transformSource(...args);
      if (result.source.split('this.port=15150,').length !== 2) throw new Error('UI test port patch mismatch');
      return { ...result, source: result.source.replace('this.port=15150,', 'this.port=' + uiPort + ',') };
    } };
  }
  if (parent?.filename === bootstrap && request === './renderer-modules.cjs') {
    const modules = originalLoad.apply(this, arguments);
    return { ...modules, rendererPreloadSource(...args) {
      return modules.rendererPreloadSource(...args) + '\nrequire(' + JSON.stringify(path.join(__dirname, 'ui-smoke-isolation.cjs')) + ').installIsolation(' + JSON.stringify(allowedPorts) + ');' + `\nwindow.__uiSmokeErrors=[];const originalConsoleError=console.error;console.error=(...args)=>{for(const a of args){if(a?.stack&&window.__uiSmokeErrors.length<30)window.__uiSmokeErrors.push(String(a.stack));}originalConsoleError(...args)};`;
    } };
  }
  if (parent?.filename === bootstrap && request === './readonly-session.cjs') {
    const sessionModule = originalLoad.apply(this, arguments);
    return { async startReadOnlySession(options) {
      if (process.argv.includes('--delay-backend')) {
        if (!electron.app.commandLine.hasSwitch('no-sandbox')) throw new Error('Compatibility sandbox flag must be set before asynchronous startup');
        await new Promise(resolve => setTimeout(resolve, 1500));
        report.backendStartupDelayed = true;
      }
      const session = await sessionModule.startReadOnlySession({ ...options, ports: { main: 0, monitor: 0 }, closeAdapters: () => fixtureBridge?.closeAll() });
      allowedPorts.push(session.addresses.main.port, session.addresses.monitor.port);
      require('./ui-smoke-isolation.cjs').installIsolation(allowedPorts);
      fixtureBridge = originalBridge.createVendorBridge({ ports: { main: session.addresses.main.port, monitor: session.addresses.monitor.port } });
      return session;
    } };
  }
  if (request === path.join(project, 'runtime/readonly-bridge.cjs') && parent?.filename?.startsWith(vendor + path.sep)) return { ...originalBridge, ...fixtureBridge };
  if (parent?.filename === bootstrap && request === './platform.cjs') return { ...originalPlatform, createPlatform(options) {
    const platform = originalPlatform.createPlatform({ ...options, model: 'Nitro ANV15-52', dmiRoot: path.join(fixture, 'dmi'), procRoot: path.join(fixture, 'proc'), sysRoot: path.join(fixture, 'sys'),
      desktopOptions: { dataDirectories: [fixture], env: {} } });
    platform.native.getWMIValue = () => { throw failure(); };
    return platform;
  } };
  if (parent?.filename === path.join(project, 'runtime/readonly-session.cjs') && request === '../lib/linux-telemetry.cjs') return { createLinuxTelemetry: () => ({
    sample: () => ({ collectedAt: new Date().toISOString(), data: { CPU_CORE_AMOUNT: 2, CPU_CORE_FREQUENCY: [2000, 2100], CPU_FREQUENCY: 2050, CPU_MAX_FREQUENCY: 4600, CPU_USAGE: (++sequence, fixtureUsage), CPU_TEMPERATURE: 55, RAM_TOTAL: 48000, RAM_USAGE: 25 },
      cpuInfo: [{ cpu_index: 0, cpu_name: 'Fixture CPU', cpu_max_frequency: 4600 }], gpuInfo: [], errors: [{ source: 'nvidia-smi', code: 'ENOENT' }] }),
    readPlatformState: () => ({ power: { adaptorStatus: 1 }, profiles: [], errors: [] }), close() {},
  }) };
  if (parent?.filename?.startsWith(vendor + path.sep) && request === 'child_process') return {
    exec(command, options, callback) { const cb = typeof options === 'function' ? options : callback; if (cb) queueMicrotask(() => cb(childFailure(), '', '')); return new EventEmitter(); },
    execFile() { throw childFailure(); }, execSync() { throw childFailure(); }, spawn() { throw childFailure(); }, spawnSync() { throw childFailure(); },
  };
  return originalLoad.apply(this, arguments);
};
// Keep test windows hidden. Loading a full renderer is necessary for lifecycle
// and navigation tests, but the test must not interrupt the user's desktop.
electron.app.disableHardwareAcceleration();
electron.shell.openExternal = async () => { throw childFailure(); };
electron.dialog.showMessageBoxSync = () => { throw childFailure(); };
electron.dialog.showMessageBox = async () => { throw childFailure(); };
electron.BrowserWindow.prototype.show = function() {};
electron.BrowserWindow.prototype.showInactive = function() {};
electron.BrowserWindow.prototype.focus = function() {};
electron.Notification.prototype.show = function() {};
electron.app.whenReady().then(() => {
  electron.session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: !['file:', 'data:', 'devtools:'].includes(url.protocol) && !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && allowedPorts.includes(Number(url.port))) });
  });
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
electron.app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3 && /Error|Uncaught|failed/.test(message)) {
      const codes = [...message.matchAll(/\b(?:EACCES|ERR_[A-Z_]+)\b/g)].map(m => m[0]);
      report.rendererErrors.push({ codes, operation: /; ([A-Za-z_]+\.[A-Za-z_]+)/.exec(message)?.[1], category: /reading ['"]([^'"]+)/.exec(message)?.[1] || 'error' });
    }
  });
  window.webContents.once('dom-ready', async () => {
    try {
      await delay(12000);
      async function clickButton(id, text) {
        const target = await window.webContents.executeJavaScript(`(() => {
          const e = ${JSON.stringify(id)} ? document.getElementById(${JSON.stringify(id)}) : [...document.querySelectorAll('button,[role=button],span,div')].reverse().find(e => e.textContent.trim() === ${JSON.stringify(text)} && e.getBoundingClientRect().width);
          if (!e) return null;
          const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
          return { x, y, active: e.classList.contains('custom_menu_btn_selected'), reachable: e.contains(document.elementFromPoint(x, y)) || document.elementFromPoint(x, y)?.contains(e) };
        })()`);
        if (!target) return false;
        if (!target.active && !target.reachable) throw new Error('UI target blocked: ' + (id || text));
        if (!target.active) {
          window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 });
          window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 });
          await delay(400);
        }
        return true;
      }
      // Decline optional collection in the isolated fixture profile only.
      await window.webContents.executeJavaScript(`document.querySelectorAll('input[type=checkbox]').forEach(e => { if(e.checked) e.click(); })`);
      report.privacyDismissed = await clickButton(null, 'Start Now');
      await delay(1500);
      report.guideActions = [];
      for (let i = 0; i < 10; i++) {
        let action = null;
        for (const text of ['Next', 'Done', 'Got it', 'Close', 'Start Now']) {
          if (await clickButton(null, text)) { action = text; break; }
        }
        if (!action) break;
        report.guideActions.push(action);
      }
      const tabs = { Home: 'Home_el', Monitoring: 'Monitoring_el', 'App Center': 'AppCenter_el' };
      for (const tab of ['Home', 'Monitoring', 'App Center', 'Home']) {
        await clickButton(null, 'Close');
        const state = { tab, found: await clickButton(tabs[tab]) };
        await delay(1500);
        if (tab === 'App Center') {
          await clickButton(null, 'Close');
          if (!await clickButton(null, 'Preload') || !await clickButton(null, 'All Apps')) throw new Error('App catalog filter not reachable');
          await delay(1000);
        }
        state.text = await window.webContents.executeJavaScript('document.body.innerText');
        if (tab === 'App Center') { state.fixtureAppSeen = state.text.includes('Fixture Editor'); if (!state.fixtureAppSeen) throw new Error('Fixture launcher missing from catalog'); }
        state.activeMenu = await window.webContents.executeJavaScript(`document.querySelector('.custom_menu_btn_selected')?.id`);
        if (!state.found || state.activeMenu !== tabs[tab]) throw new Error('Navigation failed: ' + tab);
        if (tab === 'Monitoring') {
          state.initialUsageSeen = /\n17\n/.test(state.text);
          fixtureUsage = 63;
          for (let attempt = 0; attempt < 15; attempt++) {
            await delay(500);
            state.text = await window.webContents.executeJavaScript('document.body.innerText');
            if (/\n63\n/.test(state.text)) break;
          }
          state.updatedUsageSeen = /\n63\n/.test(state.text);
          if (!state.initialUsageSeen || !state.updatedUsageSeen) throw new Error('Fixture CPU updates did not reach the monitoring page');
        }
        state.url = window.webContents.getURL();
        report.pages.push(state);
        fs.writeFileSync(path.join(output, 'page-' + report.pages.length + '.png'), (await window.webContents.capturePage()).toPNG());
      }
      report.errorStacks = await window.webContents.executeJavaScript('window.__uiSmokeErrors');
      report.samplesCollected = sequence;
      report.passed = report.rendererErrors.length === 0 && !report.mainErrors?.length;
      if (!report.passed) report.failure = 'Unhandled errors recorded during navigation';
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      console.log('UI_SMOKE_REPORT=' + path.join(output, 'report.json'));
      electron.app.exit(report.passed ? 0 : 1);
    } catch (error) {
      report.failure = String(error.stack);
      report.failureContext = await window.webContents.executeJavaScript(`({url: location.href, active: document.querySelector('.custom_menu_btn_selected')?.id, text: document.body.innerText.slice(0,6000)})`).catch(() => null);
      try { fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG()); } catch {}
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
      console.error('UI smoke failed', error.stack); electron.app.exit(1);
    }
  });
});
setTimeout(() => { report.deadline = true; fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.error('UI smoke deadline'); electron.app.exit(2); }, 45000);
process.env.NITROSENSE_STATE_DIR = path.join(output, 'app-state');
process.argv.push('--read-only', '--vendor', vendor);
// Compile the Linux bootstrap with the fixture module overrides above.
// The production Linux/ordinary-user guards stay active.
const source = fs.readFileSync(bootstrap, 'utf8');
async function start() {
  const server = require('node:net').createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, 'localhost', resolve); });
  uiPort = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  allowedPorts.push(uiPort);
  const instance = new Module(bootstrap, module); instance.filename = bootstrap; instance.paths = Module._nodeModulePaths(path.dirname(bootstrap));
  instance._compile(source, bootstrap);
}
start().catch(abort);
