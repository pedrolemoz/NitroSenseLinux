const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { AcerClient } = require('../lib/acer-client.cjs');
const { startAcerServices, createReadOnlyHandler } = require('../lib/acer-service.cjs');

async function fixture(t, handler, options = {}) {
  const service = await startAcerServices({ ports: { main: 0 }, handler });
  t.after(() => service.close());
  const client = new AcerClient({ port: service.addresses.main.port, ...options });
  t.after(() => client.close());
  return { service, client };
}
async function rawServer(t, onData) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); socket.on('data', data => onData(socket, data));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  const client = new AcerClient({ port: server.address().port, timeoutMs: 500 });
  t.after(() => client.close());
  return client;
}

test('client serializes repeated function names and preserves per-request errors', async t => {
  let calls = 0;
  const { client } = await fixture(t, async ({ payload }) => {
    const call = ++calls;
    if (call === 1) await new Promise(resolve => setTimeout(resolve, 15));
    return { request: payload.Function, result: call === 2 ? '1' : '0', data: call === 2 ? null : call };
  });
  const results = await Promise.allSettled([1, 2, 3].map(() => client.request(20, { Function: 'SAME' })));
  assert.equal(results[0].value, 1);
  assert.equal(results[1].reason.code, 'ERR_NITROSENSE_SERVICE');
  assert.equal(results[1].reason.result, 1);
  assert.equal(results[1].reason.request, 'SAME');
  assert.equal(results[2].value, 3);
});

test('client refuses writes locally, exposes backend failure and can query again', async t => {
  let samples = 0;
  const handler = createReadOnlyHandler({ sample() { samples++; return { data: { RAM_TOTAL: 1024 }, cpuInfo: [] }; } });
  const { client } = await fixture(t, handler);
  await assert.rejects(client.request(100, { Function: 'FAN_CONTROL', Parameter: { mode: 1 } }), { code: 'ERR_NITROSENSE_READ_ONLY' });
  assert.equal(client.socket, null);
  await assert.rejects(client.request(0, { Function: 'SUPPORT_FAN_CONTROL' }), { code: 'ERR_NITROSENSE_SERVICE', result: 1 });
  assert.deepEqual(await client.request(10, {}), { RAM_TOTAL: 1024 });
  assert.equal(samples, 1);
});

test('deadline rejects all queued work and reconnect does not replay the lost request', async t => {
  const seen = [];
  const { client } = await fixture(t, async ({ payload }) => {
    seen.push(payload.Function);
    if (payload.Function === 'HANG') return new Promise(() => {});
    return { request: payload.Function, result: '0', data: 'fresh' };
  }, { timeoutMs: 100 });
  const results = await Promise.allSettled(['HANG', 'QUEUED'].map(Function => client.request(20, { Function })));
  assert.ok(results.every(result => result.reason.code === 'ERR_NITROSENSE_TIMEOUT'));
  assert.equal(await client.request(20, { Function: 'NEXT' }), 'fresh');
  assert.deepEqual(seen, ['HANG', 'NEXT']);
});

test('disconnect settles pending requests and close prevents future reconnect', async t => {
  const client = await rawServer(t, socket => socket.destroy());
  await assert.rejects(client.request(20, { Function: 'TEST' }), { code: 'ERR_NITROSENSE_DISCONNECTED' });
  client.close();
  await assert.rejects(client.request(10, {}), { code: 'ERR_NITROSENSE_CLOSED' });
});

test('invalid correlation and malformed service result reject rather than resolve null', async t => {
  let wrong = true;
  const client = await rawServer(t, socket => socket.write(JSON.stringify(wrong ?
    { request: 'OTHER', result: '0', data: 'wrong' } : { request: 'TEST', result: 'maybe', data: null })));
  await assert.rejects(client.request(20, { Function: 'TEST' }), { code: 'ERR_NITROSENSE_PROTOCOL' });
  wrong = false;
  await assert.rejects(client.request(20, { Function: 'TEST' }), { code: 'ERR_NITROSENSE_PROTOCOL' });
});

test('UTF-8 and quoted braces remain intact across fragmented service replies', async t => {
  const client = await rawServer(t, socket => {
    const bytes = Buffer.from(JSON.stringify({ request: 'TEST', result: '0', data: 'ação } { \\"' }));
    for (const byte of bytes) socket.write(Buffer.from([byte]));
  });
  assert.equal(await client.request(20, { Function: 'TEST' }), 'ação } { \\"');
});

test('duplicate response does not resolve a queued request with the same function name', async t => {
  const client = await rawServer(t, socket => {
    const response = JSON.stringify({ request: 'SAME', result: '0', data: 'first' });
    socket.write(response + response);
  });
  const results = await Promise.allSettled([1, 2].map(() => client.request(20, { Function: 'SAME' })));
  assert.equal(results[0].value, 'first');
  assert.equal(results[1].reason.code, 'ERR_NITROSENSE_PROTOCOL');
});

test('queue is bounded and closing settles an open connection and all outstanding requests', async t => {
  const { client } = await fixture(t, async () => new Promise(() => {}), { maxPending: 1 });
  const pending = assert.rejects(client.request(10, {}), { code: 'ERR_NITROSENSE_CLOSED' });
  await assert.rejects(client.request(10, {}), { code: 'ERR_NITROSENSE_QUEUE_LIMIT' });
  client.close(); await pending;
});
