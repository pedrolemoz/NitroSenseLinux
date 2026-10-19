const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseIdt, planOemFiles, validateCabinet, extractOemMsi } = require('../lib/msi-oem.cjs');
const installer = path.join(__dirname, '../Installer/NitroSense_5.1_RC10_v5.1.392_20251115/Setup/NitroSenseConfig.msi');
const available = fs.existsSync(installer);
const capturedMappingAvailable = available && ['../analysis/msi-layout.json',
  '../analysis/extracted/msi-oem-verified/extraction-report.json'].every(file => fs.existsSync(path.join(__dirname, file)));
function tables(content = Buffer.from('resource fixture')) {
  return { File: [{ File: 'settings', Component_: 'component', FileName: 'SETTIN~1.JSO|Settings.json', FileSize: String(content.length), Sequence: '1' }],
    Component: [{ Component: 'component', Directory_: 'common' }],
    Directory: [{ Directory: 'common', Directory_Parent: 'INSTALLFOLDER_OEM_NitroSense', DefaultDir: 'COMMON~1|Common' },
      { Directory: 'INSTALLFOLDER_OEM_NitroSense', Directory_Parent: 'TARGETDIR', DefaultDir: 'NitroSense' },
      { Directory: 'TARGETDIR', Directory_Parent: 'TARGETDIR', DefaultDir: 'SourceDir' }],
    Media: [{ DiskId: '1', LastSequence: '1', Cabinet: '#cab1.cab' }], Property: [{ Property: 'ProductVersion', Value: '5.1.392' }] };
}
function idt(name, rows) {
  const columns = Object.keys(rows[0]);
  return Buffer.from([columns.join('\t'), columns.map(() => 's255').join('\t'), name + '\t' + columns[0],
    ...rows.map(row => columns.map(key => row[key]).join('\t')), ''].join('\r\n'));
}
function cabinet(names = [{ name: 'settings', bytes: 16 }]) {
  const entries = names.map(entry => { const buffer = Buffer.alloc(16); buffer.writeUInt32LE(entry.bytes); return Buffer.concat([buffer, Buffer.from(entry.name + '\0')]); });
  const header = Buffer.alloc(36), bytes = Buffer.concat([header, ...entries]);
  bytes.write('MSCF'); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(36, 16); bytes.writeUInt16LE(names.length, 28);
  return bytes;
}
test('IDT parser validates schema, row widths and integer-backed extraction planning', () => {
  const data = tables();
  assert.deepEqual(parseIdt(idt('File', data.File).toString(), 'File'), data.File);
  assert.equal(planOemFiles(data)[0].path, 'Common/Settings.json');
  assert.throws(() => parseIdt('File\r\ns72\r\nOther\r\nx', 'File'), /schema/);
  assert.throws(() => parseIdt(idt('File', data.File).toString() + 'bad\n', 'File'), /row/);
});
test('MSI directory graph, duplicate targets and unsupported media cannot escape or fake extraction', () => {
  const traversal = tables(); traversal.Directory[0].DefaultDir = '..'; assert.throws(() => planOemFiles(traversal), /Unsafe/);
  const cycle = tables(); cycle.Directory[0].Directory_Parent = 'common'; assert.throws(() => planOemFiles(cycle), /settings missing/);
  const duplicate = tables(); duplicate.File.push({ ...duplicate.File[0], File: 'other' }); assert.throws(() => planOemFiles(duplicate), /Duplicate/);
  const external = tables(); external.Media[0].Cabinet = 'external.cab'; assert.throws(() => planOemFiles(external), /media/);
  const wrongVersion = tables(); wrongVersion.Property[0].Value = '0.0'; assert.throws(() => planOemFiles(wrongVersion), /version/);
});
test('CAB metadata validation rejects traversal, duplicate/unknown members and truncation', () => {
  assert.equal(validateCabinet(cabinet(), new Set(['settings'])).get('settings'), 16);
  for (const names of [[{ name: '../settings', bytes: 1 }], [{ name: 'unknown', bytes: 1 }], [{ name: 'settings', bytes: 1 }, { name: 'settings', bytes: 1 }]]) {
    assert.throws(() => validateCabinet(cabinet(names), new Set(['settings'])));
  }
  assert.throws(() => validateCabinet(cabinet().subarray(0, 35), new Set(['settings'])));
});
test('real captured MSI mapping matches all 128 Windows-verified Common paths and sizes', { skip: !capturedMappingAvailable }, () => {
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, '../analysis/msi-layout.json'), 'utf8'));
  const reference = JSON.parse(fs.readFileSync(path.join(__dirname, '../analysis/extracted/msi-oem-verified/extraction-report.json'), 'utf8'));
  const plan = planOemFiles({ ...layout.tables, Property: [{ Property: 'ProductVersion', Value: reference.productVersion }] });
  assert.equal(plan.length, 128);
  assert.deepEqual(plan.map(file => [file.path, file.bytes]).sort(), reference.files.map(file => [file.path, file.bytes]).sort());
});
function temporary(t) {
  const root = fs.mkdtempSync(path.join(__dirname, '.msi-oem-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
test('unreviewed MSI is rejected before external tools or staging can run', t => {
  const root = temporary(t), source = path.join(root, 'bad.msi'); fs.writeFileSync(source, 'not reviewed');
  let invoked = false;
  assert.throws(() => extractOemMsi(source, path.join(root, 'output'), { run() { invoked = true; } }), /Unreviewed MSI/);
  assert.equal(invoked, false); assert.equal(fs.existsSync(path.join(root, 'output.partial')), false);
});
test('tool contract extracts only stdout bytes, verifies sizes and atomically publishes a Common report', { skip: !available }, t => {
  const root = temporary(t), output = path.join(root, 'output'), content = Buffer.from('resource fixture'), data = tables(content), calls = [];
  const run = (tool, args, options) => {
    calls.push({ tool, args }); assert.equal(options.shell, false); assert.equal(options.timeout, 30000);
    if (args[0] === 'export') return idt(args[2], data[args[2]]);
    if (args[0] === 'extract') return cabinet([{ name: 'settings', bytes: content.length }]);
    assert.deepEqual(args.slice(0, 5), ['-p', '-q', '-s', '-F', 'settings']); return content;
  };
  const result = extractOemMsi(installer, output, { run });
  assert.equal(result.files, 1); assert.deepEqual(fs.readFileSync(path.join(output, 'Common/Settings.json')), content);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'extraction-report.json'), 'utf8'));
  assert.equal(report.files[0].sha256, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(fs.existsSync(output + '.partial'), false); assert.equal(fs.existsSync(path.join(output, '.cabinets')), false);
  assert.equal(calls.length, 7);
  assert.throws(() => extractOemMsi(installer, output, { run }), /already exists/);
});
test('tool failure preserves partial diagnostics but never publishes a completed output', { skip: !available }, t => {
  const root = temporary(t), output = path.join(root, 'output'), data = tables();
  const run = (_tool, args) => {
    if (args[0] === 'export') return idt(args[2], data[args[2]]);
    throw Object.assign(new Error('PRIVATE_STDERR'), { code: 'ENOENT' });
  };
  assert.throws(() => extractOemMsi(installer, output, { run }), error => error.code === 'ENOENT' && !error.message.includes('PRIVATE'));
  assert.equal(fs.existsSync(output), false); assert.equal(fs.existsSync(output + '.partial'), true);
  assert.equal(fs.existsSync(path.join(output + '.partial', 'extraction-report.json')), false);
});
