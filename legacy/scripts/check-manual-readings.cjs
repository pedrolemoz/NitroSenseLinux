// Inspect only saved diagnostics; never opens Electron or reads real sensors.
const fs = require('node:fs');
const path = require('node:path');
function assessSession(patches, backend) {
  const values = backend?.readings || {}, sources = backend?.sources || {};
  const checks = {
    linux: patches?.hostPlatform === 'linux',
    readOnlyMode: patches?.mode === 'read-only' && backend?.mode === 'read-only' && backend?.readOnly === true,
    simulatorDisabled: patches?.simulatorMode === '0',
    multipleSamples: Number.isSafeInteger(backend?.sampleCount) && backend.sampleCount >= 2,
    cpuFromProcfs: typeof sources.CPU_USAGE === 'string' && sources.CPU_USAGE.startsWith('/proc/stat '),
    ramFromProcfs: typeof sources.RAM_USAGE === 'string' && sources.RAM_USAGE.startsWith('/proc/meminfo '),
    cpuUsageValid: Number.isFinite(values.CPU_USAGE) && values.CPU_USAGE >= 0 && values.CPU_USAGE <= 100,
    ramUsageValid: Number.isFinite(values.RAM_USAGE) && values.RAM_USAGE >= 0 && values.RAM_USAGE <= 100,
    timestampRecorded: typeof backend?.collectedAt === 'string' && Number.isFinite(Date.parse(backend.collectedAt)),
    sourceLabelsRecognized: Object.keys(values).length > 0 && Object.keys(values).every(key =>
      typeof sources[key] === 'string' && /^(?:\/proc\/|\/sys\/|nvidia-smi:)/.test(sources[key])),
  };
  const fields = ['CPU_USAGE', 'CPU_FREQUENCY', 'CPU_TEMPERATURE', 'RAM_TOTAL', 'RAM_USAGE',
    'GPU1_USAGE', 'GPU1_FREQUENCY', 'GPU1_TEMPERATURE', 'CPU_FANSPEED', 'GPU1_FANSPEED',
    'BATTERY_PERCENTAGE', 'BATTERY_CYCLE_COUNT', 'BATTERY_MAX_CAPACITY'];
  return {
    schemaVersion: 1,
    backendEvidenceConfirmed: Object.values(checks).every(Boolean),
    checks,
    collectedAt: checks.timestampRecorded ? backend.collectedAt : null,
    sampleCount: Number.isSafeInteger(backend?.sampleCount) ? backend.sampleCount : null,
    readings: Object.fromEntries(fields.filter(key => Number.isFinite(values[key])).map(key => [key, values[key]])),
    gpuReadingsPresent: fields.filter(key => key.startsWith('GPU1_')).some(key => Number.isFinite(values[key]) && /^(nvidia-smi:|\/sys\/class\/hwmon\/)/.test(sources[key] || '')),
    nvidiaTelemetryPresent: fields.some(key => key.startsWith('GPU1_') && Number.isFinite(values[key]) && sources[key]?.startsWith('nvidia-smi:')),
    errorCodes: [...new Set((backend?.errors || []).map(error => error?.code).filter(code => typeof code === 'string' && /^[A-Z0-9_]{1,80}$/.test(code)))],
    uiVerifiedAutomatically: false,
    limitation: 'Configuration and saved source evidence only. The operator must verify the displayed readings, updates and navigation; this report is not proof of all features or protection against modified code.',
  };
}
function latestSession(project) {
  const root = path.join(project, '.state');
  const directories = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name.startsWith('linux-readonly-'))
    .map(entry => ({ directory: path.join(root, entry.name), modified: fs.statSync(path.join(root, entry.name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
  if (!directories.length) throw Object.assign(new Error('No operator session'), { code: 'NO_SESSION' });
  return directories[0].directory;
}
function inspectSession(directory) {
  const missing = [];
  function read(relative) {
    try { return JSON.parse(fs.readFileSync(path.join(directory, relative), 'utf8')); }
    catch (error) { missing.push({ file: relative, code: error.code === 'ENOENT' ? 'MISSING' : 'UNREADABLE' }); return null; }
  }
  const patches = read('app-state/applied-patches.json'), backend = read('app-state/backend-status.json');
  return { directory, ...assessSession(patches, backend), missingDiagnostics: missing };
}
if (require.main === module) {
  try {
    if (process.argv.length > 3) throw Object.assign(new Error('Expected at most one evidence directory'), { code: 'USAGE' });
    const directory = process.argv[2] ? path.resolve(process.argv[2]) : latestSession(path.resolve(__dirname, '../..'));
    const report = inspectSession(directory);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.backendEvidenceConfirmed ? 0 : 1;
  } catch (error) {
    console.error('Reading check unavailable (' + (error.code || 'INVALID_INPUT') + '). Start the manual read-only collector and wait 30 seconds.');
    process.exitCode = 1;
  }
}
module.exports = { assessSession, inspectSession, latestSession };
