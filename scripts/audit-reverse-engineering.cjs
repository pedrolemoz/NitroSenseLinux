// Evidence/heuristic gate, not a detector of intent or a proof of Windows parity.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function implementation(file) {
  return !/\.test\.[cm]?js$/.test(file) && !/^backend\/target\//.test(file) && (
    /^(runtime|lib|drivers|src|ui|frontend|backend)\//.test(file) ||
    /\.rs$/.test(file) || /(?:^|\/)Cargo\.(?:toml|lock)$/.test(file) ||
    /^scripts\/.*\.(?:cjs|sh|ps1)$/.test(file) ||
    /\.(html|jsx|tsx|vue|svelte|css|scss)$/.test(file) ||
    /^[^/]+\.[cm]?js$/.test(file) ||
    /(?:^|\/)(?:components|screens|pages)\/|(?:screen|component|panel)\.[cm]?js$/i.test(file));
}
function suspicious(file, added) {
  const errors = [];
  if (/(?:^|\/)(?:components|screens|pages)\/|(?:screen|component|panel)\.[cm]?js$/i.test(file)) errors.push('replacement screen/component source path');
  if (/\.(html|jsx|tsx|vue|svelte|css|scss)$/.test(file)) errors.push('UI source added/edited outside the original Acer asset pipeline');
  for (const [pattern, message] of [
    [/\b(?:customElements\.define|ReactDOM\.|createRoot\()/, 'new frontend/component registration'],
    [/\b(?:innerHTML|outerHTML)\s*=|\binsertAdjacentHTML\s*\(|\bdocument\.write\s*\(/, 'HTML/template injection'],
    [/\b(?:document|this\.document)\.createElement\s*\(\s*['"](?:div|section|button|input|select|canvas|style)['"]/, 'new DOM controls/layout'],
    [/nitrosense-linux-scenario|renderer-scenario\.cjs/, 'removed replacement Scenario component reintroduced'],
  ]) if (pattern.test(added)) errors.push(message);
  return errors;
}
function validateRecord(record) {
  const errors = [];
  const meaningful = value => typeof value === 'string' && value.trim().length >= 12;
  if (record.schema !== 1 || !meaningful(record.feature)) errors.push('schema/feature missing');
  if (!Array.isArray(record.original) || !record.original.length || record.original.some(s =>
    !s.member || !/^[a-f0-9]{64}$/.test(s.sha256 || '') || !Array.isArray(s.symbols) || !s.symbols.length || s.symbols.some(v => !v || typeof v !== 'string'))) errors.push('original members, hashes and symbols required');
  for (const key of ['control', 'model', 'transport', 'osOrFirmware', 'replyAndRefresh', 'linuxAdaptation']) {
    if (!meaningful(record.trace?.[key])) errors.push('trace.' + key + ' required');
  }
  if (!Array.isArray(record.files) || !record.files.length || record.files.some(f =>
    !implementation(f.path || '') || !/^(?:[a-f0-9]{64}|deleted)$/.test(f.sha256 || ''))) errors.push('implementation files and current hashes required');
  if (!Array.isArray(record.validation) || !record.validation.length || record.validation.some(v =>
    !['pass', 'fail', 'blocked', 'not-tested'].includes(v.status) || !meaningful(v.behavior) || !meaningful(v.evidence))) errors.push('behavioral validation and evidence required');
  if (!['not-required', 'required', 'captured'].includes(record.windows?.status) || !meaningful(record.windows?.reason)) errors.push('Windows inspection decision/reason required');
  if (!meaningful(record.remainingGaps)) errors.push('remaining functional gaps required');
  return errors;
}
function run() {
  let base = process.env.RE_AUDIT_BASE || 'HEAD', verify = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--verify-original') verify = true;
    else throw new Error('Usage: audit-reverse-engineering.cjs [--base revision] [--verify-original]');
  }
  if (/^0+$/.test(base)) base = execFileSync('git', ['hash-object', '-t', 'tree', '/dev/null'], { cwd: root, encoding: 'utf8' }).trim();
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // Resolve user-supplied refs before using them as diff arguments.
  base = git(['rev-parse', '--verify', base + '^{tree}']).trim();
  const files = [...new Set((git(['diff', '--name-only', '-z', base, '--']) + git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean))].filter(implementation);
  const records = [], errors = [], reviewedFindings = [];
  const directory = path.join(root, 'docs/reverse-engineering');
  for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.json'))) {
    const record = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    const invalid = validateRecord(record);
    if (invalid.length) errors.push(...invalid.map(e => file + ': ' + e));
    else records.push(record);
  }
  for (const file of files) {
    const target = path.join(root, file), exists = fs.existsSync(target);
    const digest = exists ? sha(fs.readFileSync(target)) : 'deleted';
    const record = records.find(r => r.files.some(f => f.path === file && f.sha256 === digest));
    if (!record) errors.push(file + ': missing reverse engineering record bound to the current file hash');
    const diff = git(['diff', '--no-ext-diff', '--unified=0', '--no-renames', base, '--', file]);
    const added = diff ? diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).join('\n') : exists ? fs.readFileSync(target, 'utf8') : '';
    const findings = suspicious(file, added);
    // The Rust audit contains the detector's literal examples and its tests.
    // Review only that exact file/hash, retain the finding in the report, and
    // continue requiring ordinary original-source evidence for the tool itself.
    const selfReview = file === 'backend/crates/tools/src/audit.rs' && record?.heuristicReviews?.some(r =>
      r.path === file && r.sha256 === digest && typeof r.reason === 'string' && r.reason.length >= 40);
    if (selfReview && findings.length) reviewedFindings.push({ file, sha256: digest, findings,
      reason: record.heuristicReviews.find(r => r.path === file && r.sha256 === digest).reason });
    else errors.push(...findings.map(e => file + ': ' + e));
  }
  if (verify) {
    const { readAsar } = require('../lib/asar.cjs');
    const { KNOWN_ASAR } = require('./import-vendor.cjs');
    const bytes = fs.readFileSync(path.join(root, 'vendor/nitrosense-5.2.84-official/resources/app.asar'));
    if (sha(bytes) !== KNOWN_ASAR) throw new Error('Unreviewed original ASAR');
    const asar = readAsar(bytes);
    for (const record of records) for (const source of record.original) {
      const data = asar.read(source.member);
      if (sha(data) !== source.sha256) errors.push(record.feature + ': original source hash mismatch');
      for (const symbol of source.symbols) if (!data.toString('utf8').includes(symbol)) errors.push(record.feature + ': original symbol absent: ' + symbol);
    }
  }
  console.log(JSON.stringify({ checkedFiles: files, originalVerified: verify, errors, reviewedFindings,
    limitation: 'Heuristics flag common replacement UI patterns; evidence metadata cannot establish intent, truthful claims, complete detection or Windows parity. Human trace review and real behavioral verification are mandatory.' }, null, 2));
  if (errors.length) process.exitCode = 1;
}
if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { implementation, suspicious, validateRecord };
