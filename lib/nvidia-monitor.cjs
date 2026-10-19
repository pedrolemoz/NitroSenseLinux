const { spawn } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const QUERY_FIELDS = Object.freeze(['pci.bus_id', 'name', 'temperature.gpu', 'utilization.gpu', 'clocks.current.graphics', 'clocks.max.graphics']);
const QUERY_ARGS = Object.freeze([`--query-gpu=${QUERY_FIELDS.join(',')}`, '--format=csv,noheader,nounits']);
const failure = code => Object.assign(new Error(`NVIDIA monitoring unavailable (${code})`), { code });

function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false, endedQuote = false;
  const pushCell = () => { row.push(cell.trim()); cell = ''; endedQuote = false; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; endedQuote = true; }
      } else cell += char;
    } else if (char === '"') {
      if (cell.trim() || endedQuote) throw failure('INVALID_GPU_OUTPUT');
      cell = ''; quoted = true;
    } else if (char === ',') pushCell();
    else if (char === '\n') { pushCell(); if (row.some(Boolean)) rows.push(row); row = []; }
    else {
      if (endedQuote && !/\s/.test(char)) throw failure('INVALID_GPU_OUTPUT');
      cell += char;
    }
  }
  if (quoted) throw failure('INVALID_GPU_OUTPUT');
  if (cell || row.length) { pushCell(); if (row.some(Boolean)) rows.push(row); }
  return rows;
}
function parseNvidiaOutput(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536 || text.includes('\0')) throw failure('INVALID_GPU_OUTPUT');
  const rows = parseCsv(text), seen = new Set(), devices = [], errors = [];
  if (rows.length > 32) throw failure('GPU_COUNT_LIMIT');
  for (const row of rows) {
    if (row.length !== QUERY_FIELDS.length) throw failure('INVALID_GPU_OUTPUT');
    const pci = row[0].match(/^([0-9a-f]{4,8}):([0-9a-f]{2}):([0-9a-f]{2})\.([0-7])$/i);
    if (!pci || !row[1] || /^(?:N\/A|\[.*\])$/.test(row[1]) || /[\x00-\x1f]/.test(row[1])) throw failure('INVALID_GPU_IDENTITY');
    const domain = Number.parseInt(pci[1], 16).toString(16).padStart(4, '0');
    const pciBusId = `${domain}:${pci[2]}:${pci[3]}.${pci[4]}`.toLowerCase();
    if (seen.has(pciBusId)) throw failure('DUPLICATE_GPU_IDENTITY');
    seen.add(pciBusId);
    const readings = {}, sources = {};
    for (const [column, key] of [[2, 'GPU1_TEMPERATURE'], [3, 'GPU1_USAGE'], [4, 'GPU1_FREQUENCY'], [5, 'GPU1_MAX_FREQUENCY']]) {
      const raw = row[column], source = `nvidia-smi:${pciBusId}:${QUERY_FIELDS[column]}`;
      if (['N/A', '[N/A]', '[Not Supported]', 'Not Supported'].includes(raw)) { errors.push({ source, code: 'UNAVAILABLE' }); continue; }
      const value = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER ||
          (key !== 'GPU1_TEMPERATURE' && value < 0) || key === 'GPU1_USAGE' && value > 100 || key === 'GPU1_MAX_FREQUENCY' && value === 0) {
        errors.push({ source, code: 'INVALID_READING' }); continue;
      }
      readings[key] = value; sources[key] = source;
    }
    devices.push({ pciBusId, name: row[1], readings, sources });
  }
  // GPU1 is a client channel, not nvidia-smi's unstable numeric device index.
  const single = devices.length === 1 ? devices[0] : null;
  if (!devices.length) errors.push({ source: 'nvidia-smi', code: 'NO_GPU_REPORTED' });
  if (devices.length > 1) errors.push({ source: 'nvidia-smi', code: 'AMBIGUOUS_GPU_CHANNEL' });
  return { data: single ? { ...single.readings } : {}, sources: single ? { ...single.sources } : {},
    gpuInfo: single ? [{ gpu_index: 1, gpu_name: single.name }] : [], devices, errors, readOnly: true };
}

function createNvidiaMonitor({ command = '/usr/bin/nvidia-smi', spawnImpl = spawn,
  platform = process.platform, env = process.env, clock = () => performance.now(),
  timeoutMs = 1500, minIntervalMs = 1000, maxBytes = 65536 } = {}) {
  if (!path.isAbsolute(command) || !(timeoutMs > 0 && timeoutMs <= 3000)) throw new Error('Absolute NVIDIA tool path and bounded timeout required');
  let running = null, cached = null, sampledAt = -Infinity, closed = false;
  function sample() {
    if (closed) return Promise.reject(failure('ERR_NITROSENSE_CLOSED'));
    if (platform !== 'linux') return Promise.reject(failure('ERR_NITROSENSE_UNSUPPORTED'));
    if (running) return running.promise.then(structuredClone);
    const now = clock();
    if (cached && now >= sampledAt && now - sampledAt < minIntervalMs) {
      return cached.error ? Promise.reject(failure(cached.error)) : Promise.resolve(structuredClone(cached.value));
    }
    let resolve, reject;
    const current = { promise: new Promise((yes, no) => { resolve = yes; reject = no; }), child: null, settled: false };
    running = current;
    let timer, size = 0, diagnosticTail = '', diagnosticCode = null;
    const chunks = [];
    const settle = (error, value) => {
      if (current.settled) return;
      current.settled = true; clearTimeout(timer); sampledAt = clock();
      cached = error ? { error: error.code || 'NVIDIA_QUERY_FAILED' } : { value };
      error ? reject(failure(cached.error)) : resolve(value);
    };
    current.stop = code => {
      settle(failure(code));
      current.child?.kill('SIGKILL');
    };
    try {
      const child = current.child = spawnImpl(command, [...QUERY_ARGS], {
        shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, LC_ALL: 'C', LANG: 'C' },
      });
      const consume = (bytes, stdout) => {
        if (current.settled) return;
        size += bytes.length;
        if (size > maxBytes) { current.stop('NVIDIA_OUTPUT_LIMIT'); return; }
        diagnosticTail = (diagnosticTail + bytes.toString('utf8')).slice(-512);
        if (/Driver\/library version mismatch/i.test(diagnosticTail)) diagnosticCode = 'NVIDIA_DRIVER_LIBRARY_MISMATCH';
        if (stdout) chunks.push(Buffer.from(bytes));
      };
      child.stdout.on('data', bytes => consume(bytes, true));
      child.stderr.on('data', bytes => consume(bytes, false)); // Drain, bound, never echo raw stderr.
      child.once('error', error => settle(failure(error.code || 'NVIDIA_QUERY_FAILED')));
      child.once('close', (code, signal) => {
        if (running === current) running = null;
        if (current.settled) return;
        if (code !== 0 || signal) { settle(failure(diagnosticCode || 'NVIDIA_QUERY_FAILED')); return; }
        try {
          const bytes = Buffer.concat(chunks), text = bytes.toString('utf8');
          if (!Buffer.from(text).equals(bytes)) throw failure('INVALID_GPU_OUTPUT');
          settle(null, parseNvidiaOutput(text));
        } catch (error) { settle(error); }
      });
      timer = setTimeout(() => current.stop('NVIDIA_QUERY_TIMEOUT'), timeoutMs);
    } catch (error) { running = null; settle(failure(error.code || 'NVIDIA_QUERY_FAILED')); }
    // A timed-out helper remains accounted for until its close event arrives;
    // subsequent callers never spawn an unbounded series of stuck processes.
    return current.promise.then(structuredClone);
  }
  function close() { closed = true; cached = null; running?.stop('ERR_NITROSENSE_CLOSED'); }
  return { sample, close };
}
module.exports = { QUERY_FIELDS, QUERY_ARGS, parseNvidiaOutput, createNvidiaMonitor };
