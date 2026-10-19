const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeUiSession, summarizeUiSessionFile } = require('../lib/ui-session.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('records lifecycle in order without treating it as operator confirmation', () => {
  const summary = summarizeUiSession(Buffer.from('[compat-window] close requested\r\n[compat-app] before-quit\r\n[compat-window] closed\r\n[compat-app] will-quit\r\n'), '0\n');
  assert.deepEqual(summary.events, ['window-close-requested', 'app-before-quit', 'window-closed', 'app-will-quit']);
  assert.equal(summary.processOutcome, 'exited-zero');
  assert.equal(summary.guiCloseConfirmed, false);
  assert.deepEqual(summarizeUiSession('startup failed', '0').events, []);
});

test('detects remote/preload failures and interruption without exporting log secrets', () => {
  const summary = summarizeUiSession("push token=PRIVATE_TOKEN\nCookie: PRIVATE_COOKIE\n[compat-renderer] preload failed: PRIVATE_PATH\nCannot find module '@electron/remote'\nCannot read properties of undefined (reading 'close')\nElectron exited with signal SIGINT\n");
  assert.deepEqual(summary.issues, { preloadFailed: true, missingRemote: true, undefinedClose: true, sigintRecorded: true, sandboxHelperFailed: false });
  assert.equal(summary.exitCode, null);
  assert.equal(summary.processOutcome, 'exit-not-recorded');
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_/);
  assert.match(summary.launchLogSha256, /^[a-f0-9]{64}$/);
});

test('does not infer closure from an embedded lifecycle phrase or missing exit code', () => {
  const summary = summarizeUiSession('console says [compat-window] closed\n[compat-window] close requested\n');
  assert.deepEqual(summary.events, ['window-close-requested']);
  assert.equal(summary.processOutcome, 'exit-not-recorded');
  assert.equal(summarizeUiSession('', '130').processOutcome, 'exited-nonzero');
});

test('rejects malformed or out of range exit evidence', () => {
  for (const value of ['', 'zero', '0\nsecret', '-1', '256', '1.5']) {
    assert.throws(() => summarizeUiSession('', value), /Invalid exit-code/);
  }
});

test('streaming summary matches hashes and diagnostics across chunks without exporting repeated errors', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-ui-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'launch.log');
  const text = 'PRIVATE_COOKIE ação\r\n'.repeat(10000) +
    'Error ERR_NITROSENSE_RPC_QUEUE_LIMIT PRIVATE_TOKEN\n'.repeat(20000) +
    "EACCES\nCannot read properties of undefined (reading 'PreloadList')\nSIGINT\n";
  fs.writeFileSync(filename, text);
  const summary = await summarizeUiSessionFile(filename, '1');
  assert.deepEqual(summary, summarizeUiSession(text, '1'));
  assert.equal(summary.diagnostics.rpcQueueLimitLines, 20000);
  assert.equal(summary.diagnostics.missingPreloadListLines, 1);
  assert.equal(summary.diagnostics.accessDeniedLines, 1);
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_/);
  await assert.rejects(summarizeUiSessionFile(path.join(directory, 'missing.log')), { code: 'ENOENT' });
});

test('identifies Electron sandbox helper abort without exporting the helper path', () => {
  const report = summarizeUiSession('[123:FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found, but is not configured correctly. PRIVATE_PATH\n', '1');
  assert.equal(report.issues.sandboxHelperFailed, true);
  assert.equal(report.issues.preloadFailed, false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_PATH/);
});
