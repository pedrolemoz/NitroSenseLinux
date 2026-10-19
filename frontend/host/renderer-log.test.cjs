const test = require('node:test');
const assert = require('node:assert/strict');
const { createRendererLogger, rendererFunction } = require('./renderer-log.cjs');

test('template diagnostics return synchronously and never consume the RPC queue', () => {
  const client = { call() { assert.fail('Logging must not schedule RPC or Promise work'); } };
  for (const level of ['debug', 'debugview', 'info', 'warn', 'error']) {
    const fn = rendererFunction(client, 'host', 'logIt', level);
    for (let i = 0; i < 1000; i++) assert.equal(fn('[Fixture] absent profile'), undefined);
  }
});

test('local logging bounds repeated and distinct categories and excludes payloads', () => {
  const lines = [], log = createRendererLogger(line => lines.push(line));
  for (let i = 0; i < 1000; i++) log('error', ['[Lighting] PRIVATE_TOKEN']);
  for (let i = 0; i < 1000; i++) log('debug', [`[Category${i}] PRIVATE_SERIAL`]);
  assert.equal(lines.length, 128);
  assert.equal(lines[0], '[compat-renderer-log] error:Lighting');
  assert.doesNotMatch(lines.join('\n'), /PRIVATE_/);
  assert.doesNotThrow(() => createRendererLogger(() => { throw new Error('console unavailable'); })('info', []));
});

test('hardware and other functions preserve their original Promise and errors', async () => {
  const calls = [], expected = Promise.reject(Object.assign(new Error('unsupported'), { code: 'ERR_NITROSENSE_READ_ONLY' }));
  const client = { call(...args) { calls.push(args); return expected; } };
  const fn = rendererFunction(client, 'host', 'pssdk', 'setMode');
  const result = fn(4);
  assert.equal(result, expected);
  await assert.rejects(result, { code: 'ERR_NITROSENSE_READ_ONLY' });
  assert.deepEqual(calls, [['host', 'ddsc', 'pssdk', 'setMode', [4]]]);
});
