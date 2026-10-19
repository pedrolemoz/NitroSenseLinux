const fs = require('node:fs');
const path = require('node:path');
function createLinuxPlatformState({ sysRoot = '/sys', fsImpl = fs, maxDevices = 64 } = {}) {
  const physical = source => path.join(sysRoot, source.slice(5));
  function sample() {
    const errors = [], supplies = [], profiles = [];
    function read(source, optional = false) {
      try {
        const value = fsImpl.readFileSync(physical(source), 'utf8');
        if (value.length > 4096) throw Object.assign(new Error('Attribute limit'), { code: 'LIMIT' });
        return value.trim();
      } catch (error) {
        if (!(optional && error.code === 'ENOENT')) errors.push({ source, code: error.code || 'READ_FAILED' });
        return null;
      }
    }
    function list(source, optional = false) {
      try {
        const names = fsImpl.readdirSync(physical(source)).sort();
        if (names.length > maxDevices) throw Object.assign(new Error('Device count limit'), { code: 'LIMIT' });
        return names.filter(name => !name.includes('/') && !name.includes('\\') && !['.', '..'].includes(name));
      } catch (error) {
        if (!(optional && error.code === 'ENOENT')) errors.push({ source, code: error.code || 'READ_FAILED' });
        return [];
      }
    }
    let uncertain = false, otherInput = false, mainsSeen = false;
    const beforePowerErrors = errors.length;
    for (const device of list('/sys/class/power_supply')) {
      const source = `/sys/class/power_supply/${device}`, type = read(`${source}/type`);
      if (type === null) { uncertain = true; continue; }
      if (type === 'Battery') continue;
      const scope = read(`${source}/scope`, true);
      if (scope === 'Device') continue;
      if (scope !== null && scope !== 'System') { errors.push({ source: `${source}/scope`, code: scope === 'Unknown' ? 'UNCLASSIFIED_SCOPE' : 'INVALID_READING' }); uncertain = true; continue; }
      const raw = read(`${source}/online`);
      const online = raw === '0' ? false : raw === '1' ? true : null;
      if (raw !== null && online === null) errors.push({ source: `${source}/online`, code: 'INVALID_READING' });
      supplies.push({ source, type, scope, online });
      if (online === null) uncertain = true;
      if (type === 'Mains') mainsSeen = true;
      else if (online !== false) otherInput = true;
    }
    if (errors.length > beforePowerErrors) uncertain = true;
    const mainsOnline = supplies.some(supply => supply.type === 'Mains' && supply.online === true);
    // Code 1 is the ordinary AC class observed in the Windows capture and in
    // the original client's bit test. No USB-C/charger-power flags are inferred.
    const adaptorStatus = mainsSeen && !uncertain && !otherInput ? mainsOnline ? 1 : 0 : null;
    function profile(source, modern) {
      const currentPath = `${source}/${modern ? 'profile' : 'platform_profile'}`;
      const current = read(currentPath, !modern);
      const choicesPath = `${source}/${modern ? 'choices' : 'platform_profile_choices'}`;
      const raw = read(choicesPath, !modern);
      if (current === null && raw === null && !modern) return;
      const choices = raw?.split(/\s+/).filter(Boolean) || null;
      const validName = value => /^[a-z][a-z-]*$/.test(value);
      const valid = current !== null && validName(current) && Array.isArray(choices) && choices.length > 0 &&
        choices.every(validName) && new Set(choices).size === choices.length && (choices.includes(current) || current === 'custom');
      if (!valid) errors.push({ source, code: 'INVALID_PROFILE_READING' });
      profiles.push({ source, name: modern ? read(`${source}/name`) : null, current, choices,
        available: valid, acerMode: null, mapping: 'unvalidated', writableByThisBackend: false });
    }
    for (const device of list('/sys/class/platform-profile', true)) profile(`/sys/class/platform-profile/${device}`, true);
    profile('/sys/firmware/acpi', false);
    return { collectedAt: new Date().toISOString(), readOnly: true,
      power: { adaptorStatus, mainsOnline: mainsSeen && !uncertain ? mainsOnline : null, supplies }, profiles, errors };
  }
  return { sample };
}
module.exports = { createLinuxPlatformState };
