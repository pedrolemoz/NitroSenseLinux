const net = require('node:net');
const { AcerRequests } = require('./acer-requests.cjs');

function createReadOnlyHandler(monitor, { version = require('../../package.json').version, onSample = () => {}, onPlatformState = () => {} } = {}) {
  return async ({ id, payload }, channel) => {
    const functionName = typeof payload.Function === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(payload.Function) ? payload.Function : null;
    const request = ({ 10: 'GET_MONITOR_DATA', 30: 'GET_CONNECTED_DEVICE', 40: 'GET_LIGHTING_EFFECT_CAPABILITY' })[id] || functionName;
    const reply = (result, data = null) => ({ request, result: String(result), data });
    if (!request) return reply(3);
    if ([10, 30, 40].includes(id) && Object.keys(payload).length) return reply(3);
    // No hardware writes exist in this service, including the ordinary Acer startup writes.
    if (id === 100) return reply(1);
    if (Object.hasOwn(payload, 'Parameter')) return reply(3);
    if (id === 0 && functionName === 'VERSION' && channel === 'main') return reply(0, version);
    if (id === 20 && functionName === 'ADAPTOR_STATUS' && channel === 'main') {
      try {
        const state = await monitor.readPlatformState(); onPlatformState(state);
        return [0, 1].includes(state.power?.adaptorStatus) ? reply(0, { status: state.power.adaptorStatus }) : reply(1);
      } catch { return reply(1); }
    }
    if (id === 10 || id === 0 && ['SUPPORT_CPU_INFO', 'SUPPORT_GPU_INFO'].includes(functionName) && channel === 'main') {
      try {
        const sample = await monitor.sample();
        onSample(sample);
        if (id === 10) return Object.keys(sample.data).length ? reply(0, sample.data) : reply(1);
        const info = functionName === 'SUPPORT_GPU_INFO' ? sample.gpuInfo : sample.cpuInfo;
        return Array.isArray(info) && info.length ? reply(0, info) : reply(1);
      } catch { return reply(1); }
    }
    // Known but unimplemented queries fail, rather than replaying Windows capabilities.
    if ([0, 20, 30, 40].includes(id)) return reply(1);
    return reply(3);
  };
}

async function startAcerServices({ handler, ports = { main: 46933, monitor: 46753 },
  maxConnections = 8, maxPending = 32, idleTimeoutMs = 30000,
  maxResponseBytes = 1024 * 1024 } = {}) {
  if (typeof handler !== 'function') throw new TypeError('A request handler is required');
  const servers = [], sockets = new Set(), addresses = {};
  let stopping = false;
  async function close() {
    stopping = true;
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise(resolve => server.close(() => resolve()))));
  }
  try {
    for (const [channel, port] of Object.entries(ports)) {
      const server = net.createServer(socket => {
        if (stopping || sockets.size >= maxConnections) { socket.destroy(); return; }
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => socket.destroy());
        socket.setTimeout(idleTimeoutMs, () => socket.destroy());
        const parser = new AcerRequests({ maxFrames: maxPending });
        let queue = Promise.resolve(), pending = 0;
        socket.on('data', bytes => {
          try {
            const requests = parser.push(bytes);
            if (pending + requests.length > maxPending) throw new Error('Pending request limit');
            pending += requests.length;
            for (const request of requests) {
              queue = queue.then(async () => {
                if (socket.destroyed || stopping) return;
                const response = await handler(request, channel);
                if (socket.destroyed || stopping) return;
                const wire = Buffer.from(JSON.stringify(response));
                if (wire.length > maxResponseBytes) throw new Error('Response size limit');
                // Serialize completion of writes as well as handlers (bounded backpressure).
                await new Promise((resolve, reject) => socket.write(wire, error => error ? reject(error) : resolve()));
              }).catch(() => socket.destroy()).finally(() => pending--);
            }
          } catch { socket.destroy(); }
        });
      });
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
          server.removeListener('error', reject);
          // Runtime errors must not become uncaught exceptions after successful bind.
          server.on('error', () => { void close(); });
          resolve();
        });
      });
      addresses[channel] = server.address();
    }
    return { addresses, close };
  } catch (error) { await close(); throw error; }
}
module.exports = { createReadOnlyHandler, startAcerServices };
