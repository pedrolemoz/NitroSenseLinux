// Only prepares Acer's original renderer overlay. The backend is an independent Rust process.
const { prepareRendererOverlay } = require('./asset-overrides.cjs');
const { call } = require('./backend-client.cjs');
const { closeAll } = require('./readonly-bridge.cjs');
async function startReadOnlySession(options) {
  await call('capabilities');
  const renderer = prepareRendererOverlay(options);
  return { renderer, mapPath: renderer.mapPath, close: async () => closeAll() };
}
module.exports = { startReadOnlySession };
