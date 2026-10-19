// Operator-run Linux inventory. Reads sysfs/procfs; never writes hardware settings.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function collectInventory({ sysRoot = '/sys', procRoot = '/proc', fsImpl = fs,
  kernelRelease = os.release(), maxDirectories = 256, maxFiles = 1024 } = {}) {
  const errors = [], limits = [], counts = { directories: 0, files: 0 };
  const limit = kind => { if (!limits.includes(kind)) limits.push(kind); };
  const physical = source => source.startsWith('/sys/')
    ? path.join(sysRoot, source.slice(5)) : path.join(procRoot, source.slice(6));
  const errorRecord = (source, error) => ({ source, error: {
    code: error.code || 'UNKNOWN', message: String(error.message).replaceAll(physical(source), source)
      .replaceAll(sysRoot, '/sys').replaceAll(procRoot, '/proc') } });
  function read(source) {
    if (counts.files >= maxFiles) { limit('files'); return errorRecord(source, { code: 'LIMIT', message: 'File read limit reached' }); }
    counts.files++;
    try {
      const content = fsImpl.readFileSync(physical(source), 'utf8');
      return { source, value: content.slice(0, 65536).trim(), ...(content.length > 65536 ? { truncated: true } : {}) };
    } catch (error) { return errorRecord(source, error); }
  }
  function list(source) {
    if (counts.directories >= maxDirectories) { limit('directories'); return []; }
    counts.directories++;
    try { return fsImpl.readdirSync(physical(source)).sort(); }
    catch (error) { errors.push(errorRecord(source, error)); return []; }
  }
  function attributes(source, accept) {
    return list(source).filter(accept).slice(0, maxFiles).map(name => read(`${source}/${name}`));
  }
  const dmi = ['sys_vendor', 'product_name', 'product_version', 'bios_vendor', 'bios_version', 'bios_date']
    .map(name => read(`/sys/class/dmi/id/${name}`));
  const hwmon = list('/sys/class/hwmon').filter(name => /^hwmon\d+$/.test(name)).slice(0, maxDirectories)
    .map(name => ({ source: `/sys/class/hwmon/${name}`, attributes: attributes(`/sys/class/hwmon/${name}`,
      attr => attr === 'name' || /^(temp|fan|pwm)\d+(?:_[a-z0-9_]+)?$/.test(attr)) }));
  const platformProfiles = [
    { source: '/sys/firmware/acpi', attributes: ['platform_profile', 'platform_profile_choices']
      .map(name => read(`/sys/firmware/acpi/${name}`)) },
    ...list('/sys/class/platform-profile').slice(0, maxDirectories).map(name => ({
      source: `/sys/class/platform-profile/${name}`, attributes: ['name', 'profile', 'choices']
        .map(attr => read(`/sys/class/platform-profile/${name}/${attr}`)) }))
  ];
  const powerSupply = list('/sys/class/power_supply').slice(0, maxDirectories).map(name => ({
    source: `/sys/class/power_supply/${name}`, attributes: attributes(`/sys/class/power_supply/${name}`,
      attr => /^(type|status|online|present|capacity|capacity_level|health|technology|cycle_count|voltage_now|current_now|power_now|energy_now|energy_full|energy_full_design|charge_now|charge_full|charge_full_design|charge_control_start_threshold|charge_control_end_threshold)$/.test(attr)) }));
  const wmiDevices = list('/sys/bus/wmi/devices').filter(name => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?::\d+)?$/i.test(name))
    .slice(0, maxDirectories).map(name => ({ source: `/sys/bus/wmi/devices/${name}`, id: name }));
  const cpuFrequency = list('/sys/devices/system/cpu/cpufreq').filter(name => /^policy\d+$/.test(name)).slice(0, maxDirectories)
    .map(name => ({ source: `/sys/devices/system/cpu/cpufreq/${name}`, attributes: attributes(`/sys/devices/system/cpu/cpufreq/${name}`,
      attr => /^(affected_cpus|related_cpus|scaling_driver|scaling_governor|scaling_available_governors|scaling_cur_freq|scaling_min_freq|scaling_max_freq|cpuinfo_min_freq|cpuinfo_max_freq|energy_performance_preference|energy_performance_available_preferences)$/.test(attr)) }));
  const cpuInfo = read('/proc/cpuinfo');
  const cpuModel = cpuInfo.error ? cpuInfo : { source: cpuInfo.source,
    models: [...new Set(cpuInfo.value.split('\n').filter(line => /^(model name|Hardware)\s*:/.test(line))
      .map(line => line.slice(line.indexOf(':') + 1).trim()))], ...(cpuInfo.truncated ? { truncated: true } : {}) };
  return { schemaVersion: 1, collectedAt: new Date().toISOString(),
    purpose: 'Read-only interface inventory; not a hardware control test. No WMI methods or external commands invoked.',
    kernelRelease, dmi, hwmon, platformProfiles, powerSupply, wmiDevices, cpuFrequency, cpuModel,
    errors, limits, counts };
}

function main() {
  if (process.platform !== 'linux') throw new Error('Execute this collector on Linux; Windows results cannot describe Linux hardware interfaces.');
  if (process.argv.length > 3) throw new Error('Usage: node legacy/scripts/inspect-linux.cjs [new-output.json]');
  const output = path.resolve(process.argv[2] || '.state/linux-inventory.json');
  const inventory = collectInventory();
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx' });
  console.log(`Read-only Linux inventory saved: ${output}`);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { collectInventory };
