const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { summarizeReference } = require('../lib/reference.cjs');
const input = process.argv[2] || '.state/windows-reference.json';
const output = process.argv[3] || 'analysis/windows-reference-summary.json';
try {
  const bytes = fs.readFileSync(input);
  const summary = summarizeReference(JSON.parse(bytes.toString('utf8')));
  summary.sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ totals: summary.totals, operatingModes: summary.operatingModes,
    anomalies: summary.observations.filter(o => o.result.status !== 'success') }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
