const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const available = fs.existsSync(bash);
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Execute only a staged copy against a synthetic sysfs/procfs and mocked
// commands. The real probe script, sudo and modprobe are never executed.
function fixture(t, { enabled = false, native = false, fail = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-driver-')).replace(/\\/g, '/');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function put(file, text) { fs.mkdirSync(path.dirname(root + file), { recursive: true }); fs.writeFileSync(root + file, text); }
  put('/sys/module/acer_wmi/parameters/predator_v4', enabled ? 'Y\n' : 'N\n');
  put('/proc/sys/kernel/random/boot_id', 'fixture-boot\n'); put('/proc/uptime', '10 20\n');
  if (native) {
    put('/sys/class/hwmon/hwmon9/name', 'acer\n'); put('/sys/class/hwmon/hwmon9/fan1_input', '2500\n');
    put('/sys/class/platform-profile/profile0/name', 'acer-wmi\n'); put('/sys/class/platform-profile/profile0/profile', 'balanced\n');
  }
  let source = fs.readFileSync(path.join(__dirname, '../../scripts/validate-linux-sensors.sh'), 'utf8');
  source = source.replace(/^project=.*$/m, `project=${quote(root)}`)
    .replace(/\/(sys|proc)\//g, (_match, kind) => root + '/' + kind + '/');
  const script = root + '/fixture.sh'; fs.writeFileSync(script, source);
  const setup = `uname() { printf 'Linux\\n'; }
node() { printf '{}\\n' > "$2"; }
sh() { printf '%s\\n' "$*" >> ${quote(root + '/trial-calls')}; ${fail ? 'return 7' : `printf 'Y\\n' > ${quote(root + '/sys/module/acer_wmi/parameters/predator_v4')}`}; }
. "$1" --output ${quote(root + '/evidence')}`;
  const result = spawnSync(bash, ['-c', setup, 'fixture', script], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return { root, result, calls: fs.existsSync(root + '/trial-calls') ? fs.readFileSync(root + '/trial-calls', 'utf8') : '' };
}

test('already active predator_v4 is preserved without requesting a module reload', { skip: !available }, t => {
  const f = fixture(t, { enabled: true });
  assert.equal(f.result.status, 0, f.result.stderr); assert.equal(f.calls, '');
  assert.match(fs.readFileSync(f.root + '/evidence/module-after.txt', 'utf8'), /predator_v4=Y/);
});

test('native Acer interfaces are preserved even with predator_v4 override disabled', { skip: !available }, t => {
  const f = fixture(t, { native: true });
  assert.equal(f.result.status, 0, f.result.stderr); assert.equal(f.calls, '');
  assert.match(fs.readFileSync(f.root + '/evidence/module-after.txt', 'utf8'), /predator_v4=N/);
});

test('missing interfaces use the guarded existing trial once and collect after state in the same evidence folder', { skip: !available }, t => {
  const f = fixture(t);
  assert.equal(f.result.status, 0, f.result.stderr); assert.equal(f.calls, 'scripts/probe-acer-wmi.sh --trial-v4\n');
  assert.match(fs.readFileSync(f.root + '/evidence/module-before.txt', 'utf8'), /predator_v4=N/);
  assert.match(fs.readFileSync(f.root + '/evidence/module-after.txt', 'utf8'), /predator_v4=Y/);
  assert.ok(fs.existsSync(f.root + '/evidence/sensors-after.json'));
});

test('failed module preparation preserves failure status and evidence without pretending success', { skip: !available }, t => {
  const f = fixture(t, { fail: true });
  assert.equal(f.result.status, 7);
  assert.equal(fs.readFileSync(f.root + '/evidence/trial-exit-code.txt', 'utf8'), '7\n');
  assert.ok(fs.existsSync(f.root + '/evidence/module-after.txt'));
  assert.equal(fs.existsSync(f.root + '/evidence/sensors-after.json'), false);
});
