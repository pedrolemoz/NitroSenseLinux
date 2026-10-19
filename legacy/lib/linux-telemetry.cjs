const { performance } = require('node:perf_hooks');
const { createLinuxMonitor } = require('./linux-monitor.cjs');
const { createNvidiaMonitor } = require('./nvidia-monitor.cjs');
const { createLinuxPlatformState } = require('./linux-platform-state.cjs');
const GPU_FIELDS = new Set(['GPU1_TEMPERATURE', 'GPU1_USAGE', 'GPU1_FREQUENCY', 'GPU1_MAX_FREQUENCY']);

function createLinuxTelemetry({ cpu = createLinuxMonitor(), gpu = createNvidiaMonitor(), platform = createLinuxPlatformState(),
  clock = () => performance.now(), minIntervalMs = 250 } = {}) {
  let pending = null, cached = null, sampledAt = -Infinity, closed = false;
  function sample() {
    if (closed) return Promise.reject(Object.assign(new Error('Telemetry closed'), { code: 'ERR_NITROSENSE_CLOSED' }));
    if (pending) return pending.then(structuredClone);
    const now = clock();
    if (cached && now >= sampledAt && now - sampledAt < minIntervalMs) return Promise.resolve(structuredClone(cached));
    pending = (async () => {
      const [processor, graphics, system] = await Promise.allSettled([Promise.resolve().then(() => cpu.sample()), Promise.resolve().then(() => gpu.sample()), Promise.resolve().then(() => platform.sample())]);
      if (closed) throw Object.assign(new Error('Telemetry closed'), { code: 'ERR_NITROSENSE_CLOSED' });
      const base = processor.status === 'fulfilled' ? processor.value : { data: {}, sources: {}, cpuInfo: [], errors: [{ source: 'procfs/sysfs', code: processor.reason?.code || 'CPU_SAMPLE_FAILED' }] };
      const card = graphics.status === 'fulfilled' ? graphics.value : { data: {}, sources: {}, gpuInfo: [], devices: [], errors: [{ source: 'nvidia-smi', code: graphics.reason?.code || 'GPU_SAMPLE_FAILED' }] };
      const gpuData = Object.fromEntries(Object.entries(card.data || {}).filter(([key]) => GPU_FIELDS.has(key)));
      const platformState = system.status === 'fulfilled' ? system.value : { power: { adaptorStatus: null }, profiles: [], errors: [{ source: 'platform-state', code: system.reason?.code || 'PLATFORM_SAMPLE_FAILED' }] };
      cached = { collectedAt: new Date().toISOString(), readOnly: true,
        data: { ...base.data, ...gpuData }, sources: { ...base.sources, ...Object.fromEntries(Object.entries(card.sources || {}).filter(([key]) => GPU_FIELDS.has(key))) },
        cpuInfo: base.cpuInfo || [], gpuInfo: card.gpuInfo || [], gpuDevices: card.devices || [], platformState,
        errors: [...(base.errors || []), ...(card.errors || []), ...(platformState.errors || [])] };
      sampledAt = clock(); return cached;
    })().finally(() => { pending = null; });
    return pending.then(structuredClone);
  }
  function close() { if (closed) return; closed = true; cached = null; gpu.close?.(); cpu.close?.(); }
  function readPlatformState() {
    if (closed) throw Object.assign(new Error('Telemetry closed'), { code: 'ERR_NITROSENSE_CLOSED' });
    return platform.sample();
  }
  return { sample, close, readPlatformState };
}
module.exports = { createLinuxTelemetry };
