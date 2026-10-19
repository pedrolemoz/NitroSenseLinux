const fs = require('node:fs');
const path = require('node:path');
const { prepareRendererOverlay } = require('./asset-overrides.cjs');
const { createLinuxTelemetry } = require('../lib/linux-telemetry.cjs');
const { createReadOnlyHandler, startAcerServices } = require('../lib/acer-service.cjs');
const { closeAll } = require('./readonly-bridge.cjs');

// Started only by the operator's explicit read-only mode, before Acer loads.
async function startReadOnlySession({ vendorRoot, stateDir, fsImpl = fs,
  monitor = createLinuxTelemetry(), ports, closeAdapters = closeAll } = {}) {
  const renderer = prepareRendererOverlay({ vendorRoot, stateDir, fsImpl });
  const statusFile = path.join(stateDir, 'backend-status.json');
  let lastStatus = {};
  let sampleCount = 0;
  let lastCollectedAt;
  const saveStatus = value => {
    fsImpl.writeFileSync(statusFile + '.tmp', JSON.stringify(value, null, 2), { mode: 0o600 });
    fsImpl.renameSync(statusFile + '.tmp', statusFile);
    lastStatus = value;
  };
  const onSample = sample => {
    if (sample.collectedAt !== lastCollectedAt) { sampleCount++; lastCollectedAt = sample.collectedAt; }
    saveStatus({ mode: 'read-only', collectedAt: sample.collectedAt,
    sampleCount, readOnly: sample.readOnly === true,
    fields: Object.keys(sample.data), readings: sample.data, sources: sample.sources || {},
    errors: sample.errors, platformState: sample.platformState, hardwareControls: false });
  };
  const onPlatformState = platformState => saveStatus({ ...lastStatus, platformState });
  let service;
  try { service = await startAcerServices({ ports, handler: createReadOnlyHandler(monitor, { onSample, onPlatformState }) }); }
  catch (error) { monitor.close?.(); throw error; }
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try { closeAdapters(); } finally {
      try { monitor.close?.(); } finally { await service.close(); }
    }
  }
  try {
    saveStatus({ mode: 'read-only', state: 'listening', hardwareControls: false,
      ports: Object.fromEntries(Object.entries(service.addresses).map(([channel, address]) => [channel, address.port])) });
  } catch (error) { await close(); throw error; }
  return { renderer, addresses: service.addresses, mapPath: renderer.mapPath, close };
}
module.exports = { startReadOnlySession };
