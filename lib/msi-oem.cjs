const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { destination } = require('./zip.cjs');
const MSI_SHA256 = '1a9715c8d4de31a8d88b2b3f61574ec53dca1b81eba07ccb0a00a41a3a3a2e10';
const VERSION = '5.1.392';
const COLUMNS = { File: ['File', 'Component_', 'FileName', 'FileSize', 'Sequence'],
  Component: ['Component', 'Directory_'], Directory: ['Directory', 'Directory_Parent', 'DefaultDir'],
  Media: ['DiskId', 'LastSequence', 'Cabinet'], Property: ['Property', 'Value'] };
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function parseIdt(text, table) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines.length < 3) throw new Error('Truncated MSI table export: ' + table);
  const columns = lines[0].split('\t'), types = lines[1].split('\t'), keys = lines[2].split('\t');
  if (!COLUMNS[table] || new Set(columns).size !== columns.length || types.length !== columns.length ||
      keys[0] !== table || !COLUMNS[table].every(name => columns.includes(name))) throw new Error('Unexpected MSI table schema: ' + table);
  return lines.slice(3).map(line => {
    const values = line.split('\t');
    if (values.length !== columns.length) throw new Error('Malformed MSI table row: ' + table);
    return Object.fromEntries(columns.map((name, index) => [name, values[index]]));
  });
}
function indexed(rows, key) {
  const result = new Map();
  for (const row of rows) {
    if (!row[key] || result.has(row[key])) throw new Error('Missing/duplicate MSI key: ' + key);
    result.set(row[key], row);
  }
  return result;
}
function integer(value) {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid MSI integer');
  return Number(value);
}
function longName(value) {
  const name = value.split(':')[0].split('|').at(-1);
  if (!name || ['.', '..'].includes(name) || /[\\/:\x00-\x1f]/.test(name) || /[. ]$/.test(name)) throw new Error('Unsafe MSI target name');
  return name;
}
function planOemFiles(tables) {
  const properties = indexed(tables.Property, 'Property');
  if (properties.get('ProductVersion')?.Value !== VERSION) throw new Error('Unsupported MSI version');
  const files = indexed(tables.File, 'File'), components = indexed(tables.Component, 'Component');
  const directories = indexed(tables.Directory, 'Directory'), root = 'INSTALLFOLDER_OEM_NitroSense';
  if (!directories.has(root)) throw new Error('OEM root missing from MSI');
  const media = [...tables.Media].sort((a, b) => integer(a.LastSequence) - integer(b.LastSequence));
  if (media.some((entry, index) => !/^#cab\d+\.cab$/.test(entry.Cabinet) ||
      index > 0 && integer(entry.LastSequence) <= integer(media[index - 1].LastSequence))) throw new Error('Unsupported MSI media');
  const targets = new Set(), planned = [];
  for (const file of files.values()) {
    if (!/^[A-Za-z0-9_.-]+$/.test(file.File) || ['.', '..'].includes(file.File)) throw new Error('Unsafe cabinet file ID');
    let directory = components.get(file.Component_)?.Directory_;
    if (!directory) throw new Error('Missing MSI component');
    const segments = [], visited = new Set();
    while (directory !== root) {
      if (visited.has(directory) || !directories.has(directory)) throw new Error('Invalid MSI directory graph');
      visited.add(directory);
      const entry = directories.get(directory);
      if (!entry.Directory_Parent || entry.Directory_Parent === directory) break;
      if (entry.DefaultDir !== '.') segments.unshift(longName(entry.DefaultDir));
      directory = entry.Directory_Parent;
    }
    if (directory !== root) continue;
    const relative = [...segments, longName(file.FileName)].join('/');
    if (!relative.startsWith('Common/')) continue;
    const folded = relative.toLowerCase();
    if (targets.has(folded)) throw new Error('Duplicate OEM target');
    targets.add(folded);
    const sequence = integer(file.Sequence), bytes = integer(file.FileSize);
    const disk = media.find(entry => integer(entry.LastSequence) >= sequence);
    if (!disk || sequence < 1 || bytes > 512 * 1024 * 1024) throw new Error('Invalid OEM file bounds/media');
    planned.push({ id: file.File, path: relative, bytes, cabinet: disk.Cabinet.slice(1) });
  }
  if (!planned.some(file => file.path === 'Common/Settings.json')) throw new Error('Required Common settings missing');
  if (planned.reduce((sum, file) => sum + file.bytes, 0) > 512 * 1024 * 1024) throw new Error('OEM total size limit');
  return planned;
}
function validateCabinet(bytes, ids) {
  if (bytes.length < 36 || bytes.toString('ascii', 0, 4) !== 'MSCF' || bytes.readUInt32LE(8) !== bytes.length) throw new Error('Invalid cabinet header');
  let offset = bytes.readUInt32LE(16); const members = new Map();
  const count = bytes.readUInt16LE(28);
  for (let index = 0; index < count; index++) {
    if (offset + 16 >= bytes.length) throw new Error('Truncated cabinet file table');
    const size = bytes.readUInt32LE(offset); offset += 16;
    const end = bytes.indexOf(0, offset);
    if (end < 0) throw new Error('Unterminated cabinet member');
    const name = bytes.toString('utf8', offset, end);
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || !ids.has(name) || members.has(name.toLowerCase())) throw new Error('Unexpected cabinet member');
    members.set(name.toLowerCase(), size); offset = end + 1;
  }
  return members;
}
function extractOemMsi(input, output, { run = execFileSync, msiinfo = '/usr/bin/msiinfo', cabextract = '/usr/bin/cabextract' } = {}) {
  if (!path.isAbsolute(msiinfo) || !path.isAbsolute(cabextract)) throw new Error('Absolute extraction tool paths required');
  const msi = fs.realpathSync(input), root = path.resolve(output), staged = root + '.partial';
  if (fs.existsSync(root) || fs.existsSync(staged)) throw new Error('OEM destination/staging already exists');
  if (digest(fs.readFileSync(msi)) !== MSI_SHA256) throw new Error('Unreviewed MSI hash; no extraction tool executed');
  const options = { encoding: null, shell: false, windowsHide: true, timeout: 30000,
    maxBuffer: 256 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } };
  const invoke = (tool, args) => {
    try { return Buffer.from(run(tool, args, options)); }
    catch (error) { throw Object.assign(new Error(`${path.basename(tool)} failed (${error.code || 'EXTRACTION_FAILED'}); preserve partial output`), { code: error.code || 'EXTRACTION_FAILED' }); }
  };
  const tables = Object.fromEntries(Object.keys(COLUMNS).map(table => [table, parseIdt(invoke(msiinfo, ['export', msi, table]).toString('utf8'), table)]));
  const plan = planOemFiles(tables), ids = new Set(tables.File.map(file => file.File));
  // Resolve all pre-existing ancestors before creating our private staging tree.
  let ancestor = path.dirname(root);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (fs.realpathSync(ancestor) !== ancestor) throw new Error('Aliased OEM destination ancestor');
  fs.mkdirSync(path.dirname(root), { recursive: true });
  fs.mkdirSync(staged);
  const work = path.join(staged, '.cabinets'); fs.mkdirSync(work);
  const cabinets = [], files = [];
  for (const cabinet of [...new Set(plan.map(file => file.cabinet))]) {
    const bytes = invoke(msiinfo, ['extract', msi, cabinet]);
    const members = validateCabinet(bytes, ids), file = path.join(work, cabinet);
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    cabinets.push({ name: cabinet, bytes: bytes.length, sha256: digest(bytes) });
    for (const entry of plan.filter(entry => entry.cabinet === cabinet)) {
      if (members.get(entry.id.toLowerCase()) !== entry.bytes) throw new Error('Cabinet member size differs from MSI');
      // -p writes only to stdout; no cabinet-controlled filesystem paths are used.
      const content = invoke(cabextract, ['-p', '-q', '-s', '-F', entry.id, file]);
      if (content.length !== entry.bytes) throw new Error('Extracted OEM file size mismatch');
      const target = destination(staged, entry.path); fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { flag: 'wx' });
      files.push({ path: entry.path, bytes: content.length, sha256: digest(content) });
    }
  }
  if (work !== path.join(staged, '.cabinets') || fs.realpathSync(work) !== work) throw new Error('Unsafe cabinet cleanup target');
  fs.rmSync(work, { recursive: true });
  const report = { msiSha256: MSI_SHA256, productVersion: VERSION,
    evidence: 'Read-only MSI exports and embedded cabinet stdout extraction; no installation/custom actions', cabinets, files };
  fs.writeFileSync(path.join(staged, 'extraction-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  fs.renameSync(staged, root);
  return { output: root, files: files.length, msiSha256: MSI_SHA256, productVersion: VERSION };
}
module.exports = { MSI_SHA256, parseIdt, planOemFiles, validateCabinet, extractOemMsi };
