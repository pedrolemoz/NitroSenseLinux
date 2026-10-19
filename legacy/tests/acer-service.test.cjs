const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { AcerRequests } = require('../lib/acer-requests.cjs');
const { encodeReadRequest, JsonObjects } = require('../lib/protocol.cjs');
const { createReadOnlyHandler, startAcerServices } = require('../lib/acer-service.cjs');
const { createLinuxMonitor } = require('../lib/linux-monitor.cjs');

function frame(id, payload) {
  const header = Buffer.from('4143455200000000', 'hex');
  header.writeUInt32LE(id, 4);
  return Buffer.concat([header, Buffer.from(JSON.stringify(payload))]);
}
async function connect(t, port) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  return socket;
}
function responses(socket, count) {
  return new Promise((resolve, reject) => {
    const parser = new JsonObjects(), received = [];
    const timer = setTimeout(() => finish(new Error('Response deadline')), 3000);
    function finish(error) {
      clearTimeout(timer); socket.off('data', data); socket.off('error', finish); socket.off('close', closed);
      error ? reject(error) : resolve(received);
    }
    function closed() { finish(new Error('Closed before replies')); }
    function data(chunk) {
      try { received.push(...parser.push(chunk)); if (received.length === count) finish(); }
      catch (error) { finish(error); }
    }
    socket.setEncoding('utf8');
    socket.on('data', data); socket.once('error', finish); socket.once('close', closed);
  });
}

test('request decoder accepts every TCP split, UTF-8, nesting and concatenated packets', () => {
  const expected = [
    { id: 20, payload: { Function: 'TEST', Parameter: ['ação } [ \\"', { a: 1 }] } },
    { id: 10, payload: {} },
  ];
  const wire = Buffer.concat(expected.map(r => frame(r.id, r.payload)));
  for (let split = 0; split <= wire.length; split++) {
    const parser = new AcerRequests();
    assert.deepEqual([...parser.push(wire.subarray(0, split)), ...parser.push(wire.subarray(split))], expected);
  }
  const parser = new AcerRequests();
  assert.deepEqual([...wire].flatMap(byte => parser.push(Buffer.from([byte]))), expected);
});

test('request decoder rejects bad headers, malformed JSON, invalid UTF-8 and bounded input', () => {
  assert.throws(() => new AcerRequests().push(Buffer.from('NOPE')), /header/);
  assert.throws(() => new AcerRequests().push(Buffer.concat([frame(10, {}).subarray(0, 8), Buffer.from('{]')])));
  assert.throws(() => new AcerRequests().push(Buffer.concat([frame(10, {}).subarray(0, 8), Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125])])), /UTF-8/);
  assert.throws(() => new AcerRequests({ maxBytes: 5 }).push(frame(20, { Function: 'TEST' })), /size limit/);
  assert.throws(() => new AcerRequests({ maxFrames: 1 }).push(Buffer.concat([frame(10, {}), frame(10, {})])), /count limit/);
});

test('read-only handler preserves correlation and errors without replay or successful writes', async () => {
  let samples = 0;
  const handler = createReadOnlyHandler({ sample() { samples++; return { data: { RAM_TOTAL: 100 }, cpuInfo: [], errors: [] }; } }, { version: '0.1.0' });
  assert.deepEqual(await handler({ id: 0, payload: { Function: 'VERSION' } }, 'main'), { request: 'VERSION', result: '0', data: '0.1.0' });
  assert.deepEqual(await handler({ id: 10, payload: {} }, 'monitor'), { request: 'GET_MONITOR_DATA', result: '0', data: { RAM_TOTAL: 100 } });
  for (const Function of ['FAN_CONTROL', 'OPERATING_MODE', 'LIGHTING']) {
    assert.deepEqual(await handler({ id: 100, payload: { Function, Parameter: { mode: 4 } } }, 'main'), { request: Function, result: '1', data: null });
  }
  assert.equal(samples, 1);
  assert.equal((await handler({ id: 0, payload: { Function: 'SUPPORT_FAN_CONTROL' } }, 'main')).result, '1');
  assert.equal((await handler({ id: 10, payload: { Function: 'VERSION' } }, 'main')).result, '3');
  const failed = createReadOnlyHandler({ sample() { throw new Error('denied'); } });
  assert.deepEqual(await failed({ id: 10, payload: {} }, 'monitor'), { request: 'GET_MONITOR_DATA', result: '1', data: null });
});

test('two loopback services serialize async replies, reconnect and shut down active connections', async t => {
  const calls = [];
  const service = await startAcerServices({ ports: { main: 0, monitor: 0 }, handler: async ({ payload }, channel) => {
    calls.push(payload.Function);
    if (payload.Function === 'FIRST') await new Promise(resolve => setTimeout(resolve, 20));
    return { request: payload.Function, result: '0', data: channel };
  } });
  t.after(() => service.close());
  assert.equal(service.addresses.main.address, '127.0.0.1');
  assert.notEqual(service.addresses.main.port, service.addresses.monitor.port);
  const socket = await connect(t, service.addresses.main.port);
  const received = responses(socket, 2);
  const wire = Buffer.concat(['FIRST', 'SECOND'].map(Function => encodeReadRequest(20, { Function })));
  socket.write(wire.subarray(0, 5)); socket.write(wire.subarray(5));
  assert.deepEqual((await received).map(r => [r.request, r.data]), [['FIRST', 'main'], ['SECOND', 'main']]);
  socket.destroy();
  const next = await connect(t, service.addresses.monitor.port);
  const nextReply = responses(next, 1);
  next.write(encodeReadRequest(20, { Function: 'THIRD' }));
  assert.equal((await nextReply)[0].data, 'monitor');
  assert.deepEqual(calls, ['FIRST', 'SECOND', 'THIRD']);
  const closed = once(next, 'close');
  await service.close(); await closed;
});

test('malformed client is disconnected and the service remains usable', async t => {
  let handled = 0;
  const service = await startAcerServices({ ports: { main: 0 }, handler: async () => { handled++; return {}; } });
  t.after(() => service.close());
  const bad = await connect(t, service.addresses.main.port);
  const closed = once(bad, 'close'); bad.write('INVALID'); await closed;
  assert.equal(handled, 0);
  const good = await connect(t, service.addresses.main.port);
  const reply = responses(good, 1); good.write(frame(10, {}));
  assert.deepEqual(await reply, [{}]);
});

test('bind failure rolls back the other port without replacing an existing service', async t => {
  const first = await startAcerServices({ ports: { main: 0 }, handler: async () => ({}) });
  t.after(() => first.close());
  await assert.rejects(startAcerServices({ ports: { main: 0, monitor: first.addresses.main.port }, handler: async () => ({}) }), { code: 'EADDRINUSE' });
  const socket = await connect(t, first.addresses.main.port);
  const reply = responses(socket, 1); socket.write(frame(10, {}));
  assert.deepEqual(await reply, [{}]);
});

test('end to end: both Acer channels return fresh proc readings and reject control packets', async t => {
  const root = fs.mkdtempSync(path.join(__dirname, '.service-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const procRoot = path.join(root, 'proc'), sysRoot = path.join(root, 'sys');
  fs.mkdirSync(procRoot); fs.mkdirSync(sysRoot);
  const memory = available => fs.writeFileSync(path.join(procRoot, 'meminfo'), `MemTotal: 1024000 kB\nMemAvailable: ${available} kB\n`);
  memory(512000);
  const service = await startAcerServices({ ports: { main: 0, monitor: 0 }, handler:
    createReadOnlyHandler(createLinuxMonitor({ procRoot, sysRoot, minIntervalMs: 0 })) });
  t.after(() => service.close());
  const first = await connect(t, service.addresses.main.port);
  let reply = responses(first, 1); first.write(frame(10, {}));
  assert.deepEqual((await reply)[0], { request: 'GET_MONITOR_DATA', result: '0', data: { RAM_TOTAL: 1000, RAM_USAGE: 50 } });
  memory(256000);
  const second = await connect(t, service.addresses.monitor.port);
  reply = responses(second, 1); second.write(frame(10, {}));
  assert.equal((await reply)[0].data.RAM_USAGE, 75);
  reply = responses(first, 1); first.write(frame(100, { Function: 'FAN_CONTROL', Parameter: { mode: 1 } }));
  assert.deepEqual((await reply)[0], { request: 'FAN_CONTROL', result: '1', data: null });
  fs.writeFileSync(path.join(procRoot, 'meminfo'), 'unavailable');
  reply = responses(second, 1); second.write(frame(10, {}));
  assert.deepEqual((await reply)[0], { request: 'GET_MONITOR_DATA', result: '1', data: null });
});

test('pending request limit and idle deadline disconnect clients without executing queued commands', async t => {
  let handled = 0;
  const service = await startAcerServices({ ports: { main: 0 }, maxPending: 1, idleTimeoutMs: 50,
    handler: async () => { handled++; return {}; } });
  t.after(() => service.close());
  const socket = await connect(t, service.addresses.main.port);
  const closed = once(socket, 'close');
  socket.write(Buffer.concat([frame(10, {}), frame(10, {})])); await closed;
  assert.equal(handled, 0);
  const idle = await connect(t, service.addresses.main.port);
  await once(idle, 'close');
  assert.equal(handled, 0);
});
