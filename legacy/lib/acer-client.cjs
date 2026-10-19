const net = require('node:net');
const { EventEmitter } = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const { encodeReadRequest, JsonObjects } = require('./protocol.cjs');
const { serviceResult } = require('./reference.cjs');

function clientError(code, message) { return Object.assign(new Error(message), { code }); }
class AcerServiceError extends Error {
  constructor(message) {
    const result = serviceResult(message);
    super(`Acer service request ${message.request}: ${result.name || 'unknown result'}`);
    this.code = 'ERR_NITROSENSE_SERVICE';
    this.request = message.request;
    this.result = result.code;
  }
}

// One outstanding request per connection: Acer correlates by function, not ID.
// No automatic replay, Windows captures, writes or fallback sensor values.
class AcerClient extends EventEmitter {
  constructor({ port, timeoutMs = 5000, maxPending = 32 } = {}) {
    super();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('A loopback port is required');
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.maxPending = maxPending;
    this.pending = [];
    this.connected = false;
    this.closed = false;
    this.socket = null;
    this.opening = null;
  }
  open() {
    if (this.closed) return Promise.reject(clientError('ERR_NITROSENSE_CLOSED', 'Client is closed'));
    if (this.connected) return Promise.resolve();
    if (this.opening) return this.opening;
    let resolveOpen, rejectOpen;
    this.opening = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
    const opening = this.opening;
    const socket = this.socket = net.createConnection({ host: '127.0.0.1', port: this.port });
    const decoder = new StringDecoder('utf8'), parser = new JsonObjects();
    const timer = setTimeout(() => this.fail(clientError('ERR_NITROSENSE_TIMEOUT', 'Service connection deadline')), this.timeoutMs);
    let opened = false;
    const rejectConnection = error => {
      clearTimeout(timer);
      if (!opened) rejectOpen(error);
    };
    socket.once('connect', () => {
      if (socket !== this.socket || this.closed) return;
      clearTimeout(timer); opened = true; this.connected = true; this.opening = null;
      resolveOpen();
      this.emit('connected');
      this.flush();
    });
    socket.on('data', bytes => {
      if (socket !== this.socket) return;
      try {
        for (const message of parser.push(decoder.write(bytes))) {
          if (!message.request && typeof message.Function === 'string') { this.emit('notification', message); continue; }
          const task = this.pending[0];
          if (!task?.sent || message.request !== task.request || serviceResult(message).status === 'unknown') {
            throw clientError('ERR_NITROSENSE_PROTOCOL', 'Unexpected or invalid service response');
          }
          this.pending.shift(); clearTimeout(task.timer);
          if (serviceResult(message).status === 'success') task.resolve(message.data);
          else task.reject(new AcerServiceError(message));
          this.emit('response', message);
          // Defer the next send until all messages in this TCP chunk are checked.
          // A duplicate old response must never resolve a new request of the same name.
        }
        this.flush();
      } catch (error) { this.fail(error.code ? error : clientError('ERR_NITROSENSE_PROTOCOL', 'Invalid service response')); }
    });
    socket.on('error', error => { rejectConnection(error); if (socket === this.socket) this.fail(error); });
    socket.once('close', () => {
      const error = clientError('ERR_NITROSENSE_DISCONNECTED', 'Service connection closed');
      rejectConnection(error);
      if (socket === this.socket) this.fail(error);
    });
    // fail() also settles a pending open when a request deadline or close() fires.
    socket._rejectOpen = rejectConnection;
    return opening;
  }
  request(id, payload) {
    if (id === 100) return Promise.reject(clientError('ERR_NITROSENSE_READ_ONLY', 'Hardware controls are unavailable in read-only mode'));
    if (this.closed) return Promise.reject(clientError('ERR_NITROSENSE_CLOSED', 'Client is closed'));
    if (this.pending.length >= this.maxPending) return Promise.reject(clientError('ERR_NITROSENSE_QUEUE_LIMIT', 'Service request queue limit'));
    let wire;
    try { wire = encodeReadRequest(id, payload); } catch (error) { return Promise.reject(error); }
    const request = ({ 10: 'GET_MONITOR_DATA', 30: 'GET_CONNECTED_DEVICE', 40: 'GET_LIGHTING_EFFECT_CAPABILITY' })[id] || payload.Function;
    if (typeof request !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(request)) return Promise.reject(clientError('ERR_NITROSENSE_PROTOCOL', 'Invalid function name'));
    const promise = new Promise((resolve, reject) => {
      const task = { request, wire, resolve, reject, sent: false };
      task.timer = setTimeout(() => this.fail(clientError('ERR_NITROSENSE_TIMEOUT', 'Service request deadline')), this.timeoutMs);
      this.pending.push(task);
    });
    // open() already rejects affected tasks. An old connection's rejection must
    // not invalidate a new connection created by a caller's recovery handler.
    this.open().then(() => this.flush(), () => {});
    return promise;
  }
  flush() {
    const task = this.pending[0];
    if (!this.connected || !task || task.sent) return;
    task.sent = true;
    try { this.socket.write(task.wire); } catch (error) { this.fail(error); }
  }
  fail(error) {
    const socket = this.socket, wasConnected = this.connected;
    this.socket = null; this.connected = false; this.opening = null;
    socket?._rejectOpen?.(error);
    socket?.destroy();
    for (const task of this.pending.splice(0)) { clearTimeout(task.timer); task.reject(error); }
    if (wasConnected) this.emit('disconnected', error);
  }
  close() {
    this.closed = true;
    this.fail(clientError('ERR_NITROSENSE_CLOSED', 'Client closed'));
  }
}
module.exports = { AcerClient, AcerServiceError };
