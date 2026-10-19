const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDesktopCatalog, parseDesktopEntry, executableName, localized } = require('../lib/desktop-apps.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.desktop-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const user = path.join(root, 'user'), system = path.join(root, 'system'), bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const executable = path.join(bin, 'fixture'); fs.writeFileSync(executable, 'not executed');
  const write = (base, name, fields) => {
    const file = path.join(base, 'applications', name); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '[Desktop Entry]\n' + fields + '\n'); return file;
  };
  const fsImpl = { ...fs, accessSync(file) {
    if (file !== executable) throw Object.assign(new Error('Not executable'), { code: 'EACCES' });
  } };
  const options = { dataDirectories: [user, system], home: root, locale: 'pt-BR',
    env: { PATH: bin, XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' }, fsImpl };
  return { root, user, system, bin, executable, write, options };
}

test('real desktop entries use localized names, stable IDs and user precedence, including hidden deletion', t => {
  const f = fixture(t);
  f.write(f.system, 'example.desktop', 'Type=Application\nName=System\nExec=fixture %U');
  f.write(f.user, 'example.desktop', 'Type=Application\nName=User\nName[pt]=Portugues\nName[pt_BR]=Brasil\nExec=fixture %U');
  f.write(f.system, 'deleted.desktop', 'Type=Application\nName=Deleted\nExec=fixture');
  f.write(f.user, 'deleted.desktop', 'Hidden=true');
  const catalog = createDesktopCatalog(f.options), { apps } = catalog.scan();
  assert.equal(apps.length, 1); assert.equal(apps[0].display, 'Brasil');
  assert.equal(apps[0].id, 'linux-desktop:example.desktop');
  assert.equal(apps[0].platform, 'linux'); assert.equal(apps[0].isWin32Desktop, false);
  assert.equal(apps[0].executablePath, f.executable);
  assert.ok(apps[0].linkTargetParsingPath.endsWith('example.desktop'));
  assert.equal(catalog.lookup(apps[0].id).display, 'Brasil');
});
test('desktop visibility, NoDisplay, TryExec and D-Bus-only launchers are respected without executing anything', t => {
  const f = fixture(t);
  f.write(f.user, 'hidden.desktop', 'Type=Application\nName=Hidden\nExec=fixture\nNoDisplay=true');
  f.write(f.user, 'kde.desktop', 'Type=Application\nName=KDE\nExec=fixture\nOnlyShowIn=KDE;');
  f.write(f.user, 'gnome.desktop', 'Type=Application\nName=GNOME\nExec=fixture\nOnlyShowIn=GNOME;');
  f.write(f.user, 'missing.desktop', 'Type=Application\nName=Missing\nExec=fixture\nTryExec=missing');
  f.write(f.user, 'dbus.desktop', 'Type=Application\nName=DBus\nDBusActivatable=true');
  const apps = createDesktopCatalog(f.options).scan().apps;
  assert.deepEqual(apps.map(a => a.display), ['DBus', 'GNOME']);
  assert.equal(Object.hasOwn(apps[0], 'executablePath'), false);
});
test('nested desktop IDs, escaped text and locale modifiers follow launcher metadata', t => {
  const f = fixture(t);
  f.write(f.user, 'suite/tool.desktop', 'Type=Application\nName=Tool\\sName\nName[sr@Latn]=Latin\nExec=fixture');
  assert.equal(createDesktopCatalog(f.options).scan().apps[0].desktopId, 'suite-tool.desktop');
  assert.equal(createDesktopCatalog(f.options).scan().apps[0].display, 'Tool Name');
  assert.equal(localized({ Name: 'Base', 'Name[sr@Latn]': 'Latin' }, 'Name', 'sr_RS.UTF-8@Latn'), 'Latin');
});
test('malformed entries are reported, while permission errors and limits never turn into an empty success list', t => {
  const f = fixture(t);
  f.write(f.user, 'bad.desktop', 'Type=Application\nName=Broken\nHidden=maybe\nExec=fixture');
  const result = createDesktopCatalog(f.options).scan();
  assert.deepEqual(result.apps, []); assert.equal(result.issues[0].code, 'ERR_NITROSENSE_DESKTOP_ENTRY');
  assert.throws(() => createDesktopCatalog({ ...f.options, maxFiles: 0 }).scan(), { code: 'ERR_NITROSENSE_LIMIT' });
  const fsImpl = { ...f.options.fsImpl, readdirSync() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  assert.throws(() => createDesktopCatalog({ ...f.options, fsImpl }).scan(), { code: 'EACCES' });
});
test('refresh sees removals and missing optional roots honestly yield no launchers', t => {
  const f = fixture(t), file = f.write(f.user, 'example.desktop', 'Type=Application\nName=App\nExec=fixture');
  const catalog = createDesktopCatalog(f.options); assert.equal(catalog.scan().apps.length, 1);
  fs.unlinkSync(file); assert.deepEqual(catalog.scan().apps, []);
  assert.throws(() => catalog.lookup('linux-desktop:example.desktop'), { code: 'ERR_NITROSENSE_APP_NOT_FOUND' });
});
test('Exec metadata parsing handles quoted paths without shell evaluation or field expansion', () => {
  assert.equal(executableName('"/opt/Some App/bin" %U'), '/opt/Some App/bin');
  assert.equal(executableName('env APP_MODE=test app %f'), 'env');
  assert.throws(() => executableName('$(touch /tmp/never)'), { code: 'ERR_NITROSENSE_DESKTOP_ENTRY' });
  assert.throws(() => executableName('"unterminated'), { code: 'ERR_NITROSENSE_DESKTOP_ENTRY' });
  assert.throws(() => parseDesktopEntry('[Desktop Entry]\nName=A\nName=B'), { code: 'ERR_NITROSENSE_DESKTOP_ENTRY' });
});
