'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPlatform } = require('./platform.cjs');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(__dirname, '.platform-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dmiRoot = path.join(root, 'dmi');
  const procRoot = path.join(root, 'proc');
  const vendorRoot = path.join(root, 'vendor');
  const sysRoot = path.join(root, 'sys');
  for (const dir of [dmiRoot, procRoot, vendorRoot, sysRoot]) fs.mkdirSync(dir);
  for (const [name, value] of Object.entries({ product_name: 'Nitro ANV15-52', product_family: 'Nitro V', chassis_type: '10', product_serial: 'unit-test-serial', product_uuid: 'unit-test-uuid' })) fs.writeFileSync(path.join(dmiRoot, name), value + '\n');
  fs.writeFileSync(path.join(procRoot, 'cpuinfo'), 'model name\t: Intel Core i5-13420H\n');
  const options = { app: { getLocale: () => 'pt-BR', getLocaleCountryCode: () => 'BR' }, stateDir: path.join(root, 'state'), vendorRoot, productVersion: '5.1.392', dmiRoot, procRoot, sysRoot, ...overrides };
  return { root, options, ...createPlatform(options) };
}

test('virtual installation uses imported version and real supplied DMI, never a fixed model', t => {
  const { native } = fixture(t);
  const bios = 'HARDWARE\\DESCRIPTION\\System\\BIOS';
  assert.equal(native.getRegistryValue(2, bios, 'SystemProductName'), 'Nitro ANV15-52');
  assert.equal(native.getRegistryValue(2, bios, 'SystemFamily'), 'Nitro V');
  const guid = native.getRegistryValue(2, 'SOFTWARE\\Acer\\NitroSense', 'Guid');
  assert.equal(native.getRegistryValue(2, 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + guid, 'DisplayVersion'), '5.1.392');
  assert.equal(native.getRegistryValue(2, 'HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0', 'ProcessorNameString'), 'Intel Core i5-13420H');
  assert.equal(native.getWMIValue('Win32_BIOS', 'SerialNumber'), 'unit-test-serial');
  assert.equal(native.getWMIValue('Win32_ComputerSystemProduct', 'UUID'), 'unit-test-uuid');
  assert.equal(native.isMobilePlatform(), true);
  assert.equal(native.getDisplayLanguage(), 'pt-BR');
});

test('preference writes persist only in user compatibility state and cannot impersonate installed config', t => {
  const { native, options } = fixture(t);
  native.setRegistryValue(1, 'SOFTWARE\\Acer\\XSense', 'DevTool', '1');
  assert.equal(createPlatform(options).native.getRegistryValue(1, 'software\\acer\\xsense', 'devtool'), '1');
  assert.equal(native.getRegistryValue(1, 'software\\acer\\xsense', 'absent'), '');
  assert.throws(() => native.setRegistryValue(2, 'SOFTWARE\\Acer\\NitroSense', 'Guid', 'fake'), { code: 'ERR_NITROSENSE_UNSUPPORTED' });
  assert.throws(() => createPlatform({ ...options, productVersion: '' }), /verified imported/);
});

test('native app enumeration derives desktop launchers and icon data from the Linux filesystem and Electron', async t => {
  const f = fixture(t);
  const data = path.join(f.root, 'desktop-data'), directory = path.join(data, 'applications');
  fs.mkdirSync(directory, { recursive: true });
  const desktop = path.join(directory, 'fixture.desktop');
  fs.writeFileSync(desktop, '[Desktop Entry]\nType=Application\nName=Fixture\nDBusActivatable=true\n');
  let iconFile;
  const platform = createPlatform({ ...f.options, desktopOptions: { dataDirectories: [data], env: {} }, app: {
    ...f.options.app, getFileIcon: async file => { iconFile = file; return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,fixture' }; },
  } });
  const [application] = platform.native.getAllInstalledApps();
  assert.equal(application.display, 'Fixture');
  assert.equal(await platform.native.getAppIconDataUri(application.id), 'data:image/png;base64,fixture');
  assert.equal(iconFile, desktop);
  await assert.rejects(platform.native.getAppIconDataUri('unregistered'), { code: 'ERR_NITROSENSE_APP_NOT_FOUND' });
});

test('unsupported hardware operations fail explicitly and absent APIs report callback errors', async t => {
  const { native, store, devices, powershell } = fixture(t);
  assert.throws(() => native.SetBrightness(70), { code: 'ERR_NITROSENSE_UNSUPPORTED' });
  assert.throws(() => native.getWMIValue('ACPI', 'fan'), { code: 'ERR_NITROSENSE_UNSUPPORTED' });
  assert.throws(() => native.getActiveProcess(), { code: 'ERR_NITROSENSE_UNSUPPORTED' });
  await new Promise(resolve => store.StoreContext.getDefault().getAppAndOptionalStorePackageUpdatesAsync((error, result) => {
    assert.equal(error.code, 'ERR_NITROSENSE_UNSUPPORTED'); assert.equal(result, undefined); resolve();
  }));
  await new Promise(resolve => devices.DeviceInformation.findAllAsync(4, (error, result) => {
    assert.equal(error.code, 'ERR_NITROSENSE_UNSUPPORTED'); assert.equal(result, undefined); resolve();
  }));
  await new Promise(resolve => native.startWhisperMonitor(result => {
    assert.deepEqual(result, { support: false, enable: false, result: false }); resolve();
  }));
  await new Promise(resolve => new powershell.PowerShell().call('Get-WmiObject win32_bios').subscribe(result => {
    assert.deepEqual(result.success, []); assert.match(result.error[0], /not implemented/); resolve();
  }));
});

test('window bridge minimizes real Electron window and returns detected display dimensions', t => {
  let minimized = 0;
  const window = { isDestroyed: () => false, minimize: () => minimized++, getNativeWindowHandle: () => Buffer.from([1, 0, 0, 0]) };
  const { native } = fixture(t, { electron: { BrowserWindow: { getAllWindows: () => [window] }, screen: { getAllDisplays: () => [{ size: { width: 1920, height: 1080 } }] } } });
  native.setupMainWindow(1, () => assert.fail('No synthetic Windows event'));
  native.minimizeMainWindow();
  assert.equal(minimized, 1);
  assert.deepEqual(native.GetDisplayMaxResolution(), { width: 1920, height: 1080 });
});

test('process and keyboard enumeration derive values from proc and sysfs', t => {
  const { native, options } = fixture(t);
  fs.mkdirSync(path.join(options.procRoot, '123'));
  fs.writeFileSync(path.join(options.procRoot, '123', 'comm'), 'example\n');
  assert.deepEqual(native.getAllProcess(), [{ processId: 123, exeFile: 'example' }]);
  const device = path.join(options.sysRoot, 'class', 'input', 'event0', 'device');
  fs.mkdirSync(path.join(device, 'capabilities'), { recursive: true });
  fs.mkdirSync(path.join(device, 'id'));
  fs.writeFileSync(path.join(device, 'capabilities', 'ev'), '120013');
  fs.writeFileSync(path.join(device, 'capabilities', 'key'), '40000000');
  fs.writeFileSync(path.join(device, 'id', 'vendor'), '05af');
  fs.writeFileSync(path.join(device, 'id', 'product'), '1');
  assert.deepEqual(native.getKeyboard_PID_VID(), ['VID_05AF&PID_0001']);
});
