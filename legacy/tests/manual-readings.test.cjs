const test = require('node:test');
const assert = require('node:assert/strict');
const { assessSession } = require('../scripts/check-manual-readings.cjs');
const patches = () => ({ hostPlatform: 'linux', mode: 'read-only', simulatorMode: '0' });
const backend = () => ({ mode: 'read-only', readOnly: true, sampleCount: 3, collectedAt: '2026-10-18T23:00:00Z',
  readings: { CPU_USAGE: 0, RAM_USAGE: 24, RAM_TOTAL: 48000, CPU_TEMPERATURE: 55 },
  sources: { CPU_USAGE: '/proc/stat (delta)', RAM_USAGE: '/proc/meminfo (percent)', RAM_TOTAL: '/proc/meminfo:MemTotal (MiB)', CPU_TEMPERATURE: '/sys/class/hwmon/hwmon1/temp1_input' },
  errors: [{ source: 'nvidia-smi', code: 'ENOENT', message: 'PRIVATE_TOKEN' }] });

test('manual check confirms source evidence with genuine zero CPU usage and missing GPU, never UI success', () => {
  const report = assessSession(patches(), backend());
  assert.equal(report.backendEvidenceConfirmed, true);
  assert.equal(report.readings.CPU_USAGE, 0);
  assert.equal(report.gpuReadingsPresent, false);
  assert.equal(report.uiVerifiedAutomatically, false);
  assert.deepEqual(report.errorCodes, ['ENOENT']);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_TOKEN/);
});

test('manual check rejects simulation, unknown sources, missing files and insufficient samples', () => {
  for (const change of [p => p.simulatorMode = '1', p => p.mode = 'ui-only', p => p.hostPlatform = 'win32']) {
    const configuration = patches(); change(configuration);
    assert.equal(assessSession(configuration, backend()).backendEvidenceConfirmed, false);
  }
  for (const change of [b => b.sampleCount = 1, b => b.readOnly = false,
    b => b.sources.CPU_USAGE = 'fixture:cpu', b => delete b.sources.RAM_USAGE,
    b => b.readings.CPU_USAGE = null, b => b.readings.RAM_USAGE = 101]) {
    const sample = backend(); change(sample);
    assert.equal(assessSession(patches(), sample).backendEvidenceConfirmed, false);
  }
  assert.equal(assessSession(null, null).backendEvidenceConfirmed, false);
});
