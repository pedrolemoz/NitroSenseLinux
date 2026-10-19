const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

// Small live sampler for the service. Does not run the broad hardware inventory.
// Sources/units: docs.kernel.org/filesystems/proc.html and hwmon/sysfs-interface.html.
function createLinuxMonitor({ procRoot = '/proc', sysRoot = '/sys', fsImpl = fs,
  clock = () => performance.now(), minIntervalMs = 250, kernelRelease = require('node:os').release() } = {}) {
  let previous = null, cached = null, sampledAt = -Infinity;
  const physical = source => source.startsWith('/proc/') ? path.join(procRoot, source.slice(6)) : path.join(sysRoot, source.slice(5));
  function sample() {
    const now = clock();
    if (cached && now >= sampledAt && now - sampledAt < minIntervalMs) return structuredClone(cached);
    const data = {}, sources = {}, errors = [];
    const read = source => {
      const text = fsImpl.readFileSync(physical(source), 'utf8');
      if (text.length > 1024 * 1024) throw Object.assign(new Error('Read limit'), { code: 'LIMIT' });
      return text.trim();
    };
    const list = source => fsImpl.readdirSync(physical(source)).sort();
    const failed = (source, error) => errors.push({ source, code: error.code || 'INVALID_READING' });
    const put = (key, value, source) => { data[key] = value; sources[key] = source; };
    let cpu = null;
    try {
      const text = read('/proc/cpuinfo');
      cpu = text.split(/\n\s*\n/).map(block => {
        const fields = Object.fromEntries(block.split('\n').filter(line => line.includes(':')).map(line => {
          const colon = line.indexOf(':'); return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
        }));
        return fields;
      }).filter(fields => /^\d+$/.test(fields.processor || ''));
      if (!cpu.length || new Set(cpu.map(c => c.processor)).size !== cpu.length) throw new Error('Invalid CPU identities');
      cpu.sort((a, b) => Number(a.processor) - Number(b.processor));
      put('CPU_CORE_AMOUNT', cpu.length, '/proc/cpuinfo (logical processors)');
      const frequencies = cpu.map(c => /^\d+(?:\.\d+)?$/.test(c['cpu MHz'] || '') ? Number(c['cpu MHz']) : NaN);
      if (frequencies.every(f => Number.isFinite(f) && f > 0)) {
        put('CPU_CORE_FREQUENCY', frequencies, '/proc/cpuinfo (MHz, processor order)');
        put('CPU_FREQUENCY', frequencies.reduce((a, b) => a + b, 0) / frequencies.length, '/proc/cpuinfo (mean MHz)');
      } else failed('/proc/cpuinfo:cpu MHz', new Error('Frequency unavailable'));
    } catch (error) { cpu = null; failed('/proc/cpuinfo', error); }
    try {
      const stat = read('/proc/stat');
      const fields = stat.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/);
      if (!fields || fields.length < 8 || !fields.every(v => /^\d+$/.test(v))) throw new Error('Invalid CPU counters');
      // guest/guest_nice are already included in user/nice. Do not count twice.
      const counters = fields.slice(0, 8).map(BigInt);
      const topology = stat.split('\n').map(line => line.match(/^(cpu\d+)\s/)?.[1]).filter(Boolean).join(',');
      if (!topology) throw new Error('CPU topology unavailable');
      if (previous && previous.topology === topology && now >= sampledAt &&
          counters.every((v, i) => v >= previous.counters[i])) {
        const delta = counters.map((v, i) => v - previous.counters[i]);
        const total = delta.reduce((a, b) => a + b, 0n), idle = delta[3] + delta[4];
        if (total > 0n) put('CPU_USAGE', Number((total - idle) * 1000000n / total) / 10000, '/proc/stat (delta, idle includes iowait)');
      }
      previous = { counters, topology };
    } catch (error) { previous = null; failed('/proc/stat', error); }
    try {
      const text = read('/proc/meminfo');
      const get = key => {
        const match = text.match(new RegExp(`^${key}:\\s+(\\d+) kB$`, 'm'));
        if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error('Invalid memory counter');
        return Number(match[1]);
      };
      const total = get('MemTotal'), available = get('MemAvailable');
      if (total <= 0 || available > total) throw new Error('Invalid available memory');
      put('RAM_TOTAL', total / 1024, '/proc/meminfo:MemTotal (MiB)');
      put('RAM_USAGE', (total - available) / total * 100, '/proc/meminfo (1 - MemAvailable/MemTotal, percent)');
    } catch (error) { failed('/proc/meminfo', error); }
    try {
      const root = '/sys/devices/system/cpu/cpufreq';
      const values = list(root).filter(n => /^policy\d+$/.test(n)).map(name => {
        const raw = read(`${root}/${name}/cpuinfo_max_freq`);
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) throw new Error('Invalid maximum frequency');
        return Number(raw) / 1000;
      });
      if (values.length) put('CPU_MAX_FREQUENCY', Math.max(...values), `${root}/policy*/cpuinfo_max_freq (max MHz)`);
    } catch (error) { failed('/sys/devices/system/cpu/cpufreq', error); }
    try {
      const packages = [];
      for (const name of list('/sys/class/hwmon').filter(n => /^hwmon\d+$/.test(n))) {
        const base = `/sys/class/hwmon/${name}`;
        try {
          if (read(`${base}/name`) !== 'coretemp') continue;
          for (const label of list(base).filter(n => /^temp\d+_label$/.test(n))) {
            if (!/^Package id \d+$/.test(read(`${base}/${label}`))) continue;
            const source = `${base}/${label.replace('_label', '_input')}`;
            const raw = read(source);
            if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Invalid temperature');
            packages.push({ value: Number(raw) / 1000, source });
          }
        } catch (error) { failed(base, error); }
      }
      // No CPU/GPU assignment from unlabeled Acer channel numbers.
      if (packages.length === 1) put('CPU_TEMPERATURE', packages[0].value, packages[0].source);
    } catch (error) { failed('/sys/class/hwmon', error); }
    // Linux v7.0 acer-wmi explicitly maps fan1/2 to CPU/GPU and temp1/2 to
    // CPU/GPU. Restrict this integration to the verified model/kernel/driver;
    // a hwmon name alone is not sufficient evidence for channel attribution.
    try {
      const acers = list('/sys/class/hwmon').filter(name => /^hwmon\d+$/.test(name)).filter(name => {
        const base = `/sys/class/hwmon/${name}`;
        try { return read(`${base}/name`) === 'acer' && /^7\.0\./.test(kernelRelease) &&
          path.basename(fsImpl.realpathSync(physical(`${base}/device/driver`))) === 'acer-wmi' &&
          read('/sys/class/dmi/id/product_name') === 'Nitro ANV15-52'; } catch { return false; }
      });
      if (acers.length === 1) {
        const base = `/sys/class/hwmon/${acers[0]}`;
        for (const [attribute, key, scale] of [['fan1_input', 'CPU_FANSPEED', 1], ['fan2_input', 'GPU1_FANSPEED', 1], ['temp2_input', 'GPU1_TEMPERATURE', 1000]]) {
          const source = `${base}/${attribute}`;
          try {
            const raw = read(source);
            if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > (scale === 1 ? 100000 : 200000)) throw new Error('Invalid Acer sensor');
            put(key, Number(raw) / scale, source);
          } catch (error) { failed(source, error); }
        }
      }
    } catch { /* Unidentified Acer channels remain unassigned. */ }
    // System battery only: peripheral batteries and ambiguous multi-battery
    // configurations must not become the notebook's charge percentage.
    try {
      const root = '/sys/class/power_supply';
      const batteries = (fsImpl.existsSync(physical(root)) ? list(root) : []).filter(name => {
        const base = `${root}/${name}`;
        try { return read(`${base}/type`) === 'Battery' &&
          (!fsImpl.existsSync(physical(`${base}/present`)) || read(`${base}/present`) === '1') &&
          (!fsImpl.existsSync(physical(`${base}/scope`)) || read(`${base}/scope`) === 'System'); } catch { return false; }
      });
      if (batteries.length === 1) {
        const base = `${root}/${batteries[0]}`;
        const number = attribute => {
          const raw = read(`${base}/${attribute}`);
          if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Invalid battery reading');
          return Number(raw);
        };
        for (const [attribute, key, maximum] of [['capacity', 'BATTERY_PERCENTAGE', 100], ['cycle_count', 'BATTERY_CYCLE_COUNT', 100000]]) {
          if (!fsImpl.existsSync(physical(`${base}/${attribute}`))) continue;
          try { const value = number(attribute); if (value > maximum) throw new Error('Invalid battery range'); put(key, value, `${base}/${attribute}`); }
          catch (error) { failed(`${base}/${attribute}`, error); }
        }
        for (const unit of ['energy', 'charge']) {
          if (!fsImpl.existsSync(physical(`${base}/${unit}_full`)) || !fsImpl.existsSync(physical(`${base}/${unit}_full_design`))) continue;
          try {
            const full = number(`${unit}_full`), design = number(`${unit}_full_design`);
            if (design <= 0 || full <= 0 || full > design * 1.2) throw new Error('Invalid battery capacity');
            put('BATTERY_MAX_CAPACITY', full / design * 100, `${base}/${unit}_full / ${unit}_full_design (percent)`);
          } catch (error) { failed(base, error); }
          break;
        }
      }
    } catch { /* Missing battery interfaces do not remove CPU/RAM readings. */ }
    const info = [];
    if (cpu) {
      const models = [...new Set(cpu.map(c => c['model name']).filter(Boolean))];
      const packages = new Set(cpu.map(c => c['physical id']));
      if (models.length === 1 && packages.size === 1 && !packages.has(undefined)) {
        info.push({ cpu_index: 0, cpu_name: models[0],
          ...(data.CPU_MAX_FREQUENCY === undefined ? {} : { cpu_max_frequency: data.CPU_MAX_FREQUENCY }) });
      }
    }
    cached = { collectedAt: new Date().toISOString(), data, sources, errors, cpuInfo: info, readOnly: true };
    sampledAt = now;
    return structuredClone(cached);
  }
  return { sample };
}
module.exports = { createLinuxMonitor };
