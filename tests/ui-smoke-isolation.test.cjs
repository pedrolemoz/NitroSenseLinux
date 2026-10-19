const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('UI fixture guard allows its local server and blocks outside connections and subprocesses', () => {
  // A subprocess keeps the test-only global guards out of the test runner.
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const net = require('node:net');
    const server = net.createServer(socket => socket.end('fixture'));
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      require(${JSON.stringify(path.resolve('scripts/ui-smoke-isolation.cjs'))}).installIsolation([port]);
      const read = new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        socket.on('data', chunk => resolve(chunk.toString())); socket.on('error', reject);
      });
      assert.equal(await read, 'fixture');
      await assert.rejects(new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '192.0.2.1', port: 80 });
        socket.on('error', reject); socket.on('connect', resolve);
      }), { code: 'ERR_UI_TEST_ISOLATION' });
      assert.throws(() => require('node:https').get('https://example.invalid/'), { code: 'ERR_UI_TEST_ISOLATION' });
      assert.throws(() => require('node:tls').connect({ host: 'example.invalid', port: 443 }), { code: 'ERR_UI_TEST_ISOLATION' });
      if (globalThis.fetch) await assert.rejects(fetch('https://example.invalid/'), { code: 'ERR_UI_TEST_ISOLATION' });
      assert.throws(() => require('node:child_process').spawn('unused'), { code: 'ERR_UI_TEST_ISOLATION' });
      server.close();
    });
  `], { timeout: 5000, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
