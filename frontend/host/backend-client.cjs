// Transport only. The Rust service owns OS access, commands and preferences.
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const backend = path.resolve(__dirname, '../../backend/target/debug/nitrosense-backend');
const failure = code => Object.assign(new Error(`NitroSense backend: ${code}`), { code });
let sequence = 0;
function request(method, parameters = {}) { return { api_version: 1, id: ++sequence, method, ...parameters }; }
function socketPath() {
  const socket = process.env.NITROSENSE_BACKEND_SOCKET;
  if (!socket || !path.isAbsolute(socket)) throw failure('ERR_NITROSENSE_SOCKET');
  return socket;
}
function validate(response, id) {
  if (response.api_version !== 1 || response.id !== id || response.error && response.result !== undefined)
    throw failure('ERR_NITROSENSE_PROTOCOL');
  if (response.error) throw Object.assign(failure('ERR_NITROSENSE_BACKEND'), { backendCode: response.error.code });
  if (!Object.hasOwn(response, 'result')) throw failure('ERR_NITROSENSE_PROTOCOL');
  return response.result;
}
function call(method, parameters) {
  const wire = request(method, parameters);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath() });
    let bytes = Buffer.alloc(0), settled = false;
    const timer = setTimeout(() => finish(failure('ERR_NITROSENSE_TIMEOUT')), 8000);
    function finish(error, value) {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      error ? reject(error) : resolve(value);
    }
    socket.on('connect', () => socket.write(JSON.stringify(wire) + '\n'));
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 65536) return finish(failure('ERR_NITROSENSE_PROTOCOL'));
      const end = bytes.indexOf(10);
      if (end < 0) return;
      try { finish(null, validate(JSON.parse(bytes.subarray(0, end).toString('utf8')), wire.id)); }
      catch (error) { finish(error); }
    });
    socket.on('error', () => finish(failure('ERR_NITROSENSE_DISCONNECTED')));
    socket.on('close', () => finish(failure('ERR_NITROSENSE_DISCONNECTED')));
  });
}
function callSync(method, parameters) {
  // Acer's native addon is synchronous. The CLI translates that calling convention
  // to the same service API; it performs no hardware work in this process.
  try {
    return JSON.parse(execFileSync(backend, ['request', '--socket', socketPath(), '--json', JSON.stringify(request(method, parameters))],
      { encoding: 'utf8', timeout: 8000, maxBuffer: 65536, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { throw failure('ERR_NITROSENSE_BACKEND'); }
}
class AcerClient extends EventEmitter {
  constructor({ channel }) { super(); this.channel = channel; this.connected = false; this.closed = false; this.pending = 0; }
  async open() {
    if (this.closed) throw failure('ERR_NITROSENSE_CLOSED');
    if (this.connected) return;
    await call('capabilities');
    if (this.closed) throw failure('ERR_NITROSENSE_CLOSED');
    if (!this.connected) { this.connected = true; this.emit('connected'); }
  }
  async request(packet_id, payload) {
    if (this.closed) throw failure('ERR_NITROSENSE_CLOSED');
    if (this.pending >= 32) throw failure('ERR_NITROSENSE_QUEUE_LIMIT');
    this.pending++;
    try {
      await this.open();
      const reply = await call('acer_query', { channel: this.channel, packet_id, payload });
      if (this.closed) throw failure('ERR_NITROSENSE_CLOSED');
      this.emit('response', reply);
      if (reply.result !== '0') throw Object.assign(failure('ERR_NITROSENSE_SERVICE'), { request: reply.request, result: Number(reply.result) });
      return reply.data;
    } catch (error) {
      if (error.code === 'ERR_NITROSENSE_DISCONNECTED' && this.connected) { this.connected = false; this.emit('disconnected', error); }
      throw error;
    } finally { this.pending--; }
  }
  close() { this.closed = true; this.connected = false; }
}
module.exports = { call, callSync, AcerClient };
