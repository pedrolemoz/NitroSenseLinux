// Test-only guards, installed in both Electron processes before Acer loads.
// Production never imports this module.
function installIsolation(ports) {
  const permitted = new Set(ports.map(Number));
  const denied = () => Object.assign(new Error('Disabled by UI fixture isolation'), { code: 'ERR_UI_TEST_ISOLATION' });
  const allow = (host, port) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) && permitted.has(Number(port));
  const net = require('node:net');
  const connect = net.connect;
  function isolatedConnect(...args) {
    const first = args[0];
    const options = typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    if (!options.path && allow(options.host || 'localhost', options.port)) return connect.apply(this, args);
    const socket = new net.Socket();
    queueMicrotask(() => socket.destroy(denied()));
    return socket;
  }
  net.connect = net.createConnection = isolatedConnect;
  const tls = require('node:tls');
  const tlsConnect = tls.connect;
  tls.connect = function(first, ...rest) {
    const options = typeof first === 'object' ? first : { port: first, host: typeof rest[0] === 'string' ? rest[0] : 'localhost' };
    if (!allow(options.host || 'localhost', options.port)) throw denied();
    return tlsConnect.call(this, first, ...rest);
  };
  if (typeof globalThis.fetch === 'function') {
    const fetch = globalThis.fetch;
    globalThis.fetch = function(input, ...rest) {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!allow(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80))) return Promise.reject(denied());
      return fetch.call(this, input, ...rest);
    };
  }
  for (const protocol of ['http', 'https']) {
    const transport = require('node:' + protocol);
    const request = transport.request;
    transport.request = function(first, ...rest) {
      const url = typeof first === 'string' ? new URL(first) : first;
      const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : {};
      if (!allow(options.hostname || options.host || url.hostname || url.host || 'localhost', options.port || url.port || (protocol === 'https' ? 443 : 80))) throw denied();
      return request.call(this, first, ...rest);
    };
    transport.get = function(...args) { const request = transport.request(...args); request.end(); return request; };
  }
  const child = require('node:child_process');
  for (const name of ['exec', 'execFile', 'execSync', 'execFileSync', 'spawn', 'spawnSync', 'fork']) child[name] = () => { throw denied(); };
}
module.exports = { installIsolation };
