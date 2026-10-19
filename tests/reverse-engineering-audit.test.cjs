const test = require('node:test');
const assert = require('node:assert/strict');
const { implementation, suspicious, validateRecord } = require('../scripts/audit-reverse-engineering.cjs');

test('audit flags replacement UI and ignores ordinary protocol implementations', () => {
  assert.ok(implementation('runtime/renderer-patches.cjs'));
  assert.ok(!implementation('runtime/vendor-sdk.test.cjs'));
  for (const code of [
    'panel.innerHTML = `<button>80%</button>`',
    'document.createElement("section")',
    'customElements.define("new-scenario", Scenario)',
    'document.body.insertAdjacentHTML("beforeend", html)',
    'require("renderer-scenario.cjs")',
  ]) assert.ok(suspicious('runtime/adapter.cjs', code).length, code);
  assert.ok(suspicious('src/Scenario.tsx', 'export function Scenario() {}').length);
  assert.deepEqual(suspicious('lib/transport.cjs', 'return client.request(20, { Function: name });'), []);
  assert.deepEqual(suspicious('runtime/renderer-patches.cjs', 'return this.InsertProfile(this.getInitialProfile("MUI_DAILY_USE"))'), []);
});

test('screenshot-only assertions cannot satisfy the research evidence schema', () => {
  assert.ok(validateRecord({ schema: 1, feature: 'Screenshot looks correct', validation: [{ status: 'pass', evidence: 'Compared screenshot' }] }).length);
  const record = {
    schema: 1, feature: 'Original feature trace example',
    original: [{ member: 'main.js', sha256: 'a'.repeat(64), symbols: ['getScenario'] }],
    files: [{ path: 'runtime/source-patches.cjs', sha256: 'b'.repeat(64) }],
    trace: Object.fromEntries(['control', 'model', 'transport', 'osOrFirmware', 'replyAndRefresh', 'linuxAdaptation'].map(k => [k, 'Specific original boundary explanation'])),
    validation: [{ status: 'blocked', behavior: 'Read back actual firmware value', evidence: 'Windows capture required; not yet verified' }],
    windows: { status: 'required', reason: 'Native service reply contract unresolved' },
    remainingGaps: 'Hardware parity is still unverified',
  };
  assert.deepEqual(validateRecord(record), []);
  for (const key of Object.keys(record.trace)) {
    const changed = structuredClone(record); delete changed.trace[key];
    assert.ok(validateRecord(changed).length);
  }
});

test('audit covers replacement UI outside conventional runtime directories', () => {
  for (const file of ['new-app.vue', 'public/index.html', 'App.tsx', 'styles/main.css', 'index.cjs', 'scripts/custom-panel.cjs', 'app/components/Scenario.js']) {
    assert.equal(implementation(file), true, file);
  }
});

test('audit covers the Rust workspace, tooling and frontend bridge', () => {
  for (const file of ['backend/Cargo.toml', 'backend/Cargo.lock', 'backend/crates/tools/src/main.rs',
    'frontend/host/bootstrap.cjs', 'tools/audit.rs']) assert.equal(implementation(file), true, file);
  assert.equal(implementation('backend/target/debug/generated.rs'), false);
});
