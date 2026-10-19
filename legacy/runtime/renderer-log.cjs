// Logging must be synchronous: an RPC Promise created by a template getter
// schedules another Angular check, which evaluates the getter and logs again.
// Keep only bounded category diagnostics locally; never forward payloads,
// credentials, serial numbers or arbitrary exception text to the collector.
const levels = new Set(['info', 'debug', 'debugview', 'error', 'warn']);
function createRendererLogger(write = line => console.info(line)) {
  const seen = new Set();
  return function log(level, args) {
    if (!levels.has(level)) return;
    const text = typeof args?.[0] === 'string' ? args[0] : '';
    const category = /^\[([a-zA-Z0-9_. -]{1,48})\]/.exec(text)?.[1] || 'renderer';
    const key = `${level}:${category}`;
    if (seen.has(key) || seen.size >= 128) return;
    seen.add(key);
    try { write(`[compat-renderer-log] ${key}`); } catch { /* Logging is best effort. */ }
  };
}
const log = createRendererLogger();
function rendererFunction(client, subject, category, name) {
  if (category === 'logIt' && levels.has(name)) return (...args) => log(name, args);
  return (...args) => client.call(subject, 'ddsc', category, name, args);
}
module.exports = { createRendererLogger, rendererFunction };
