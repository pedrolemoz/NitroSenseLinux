const fs = require('node:fs');
const path = require('node:path');

// Standard power-supply ABI or the model-specific Acer WMI charge driver.
function createBatteryCharge({ root = '/sys/class/power_supply',
  acerThreshold = '/sys/bus/wmi/devices/79772EC5-04B1-4BFD-843C-61E7F77B6CC9/charge_control_end_threshold', fsImpl = fs } = {}) {
  function detect() {
    const batteries = fsImpl.readdirSync(root).filter(name => {
      const base = path.join(root, name);
      try {
        return fsImpl.readFileSync(path.join(base, 'type'), 'utf8').trim() === 'Battery' &&
          (!fsImpl.existsSync(path.join(base, 'scope')) || fsImpl.readFileSync(path.join(base, 'scope'), 'utf8').trim() === 'System') &&
          (!fsImpl.existsSync(path.join(base, 'present')) || fsImpl.readFileSync(path.join(base, 'present'), 'utf8').trim() === '1');
      } catch { return false; }
    });
    if (batteries.length !== 1) throw new Error('A single system battery with a Linux charge threshold is required.');
    const standard = path.join(root, batteries[0], 'charge_control_end_threshold');
    if (fsImpl.existsSync(standard)) return standard;
    if (acerThreshold && fsImpl.existsSync(acerThreshold)) return acerThreshold;
    return standard;
  }
  function status() {
    try {
      const file = detect(), raw = fsImpl.readFileSync(file, 'utf8').trim();
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) throw new Error('Invalid charge threshold reported by kernel.');
      let writable = true;
      try { fsImpl.accessSync(file, fs.constants.W_OK); } catch { writable = false; }
      return { supported: true, writable, limit: Number(raw), message: writable ? '' : 'Charge limit requires write permission from your system administrator.' };
    } catch (error) {
      return { supported: false, writable: false, limit: null,
        message: error.code === 'ENOENT' ? 'Your Linux driver does not expose battery charge limits on this laptop.' : error.message };
    }
  }
  function setLimit(limit) {
    if (limit !== 80 && limit !== 100) throw new Error('Choose 80% or 100%.');
    const current = status();
    if (!current.writable) throw new Error(current.message);
    const file = detect();
    fsImpl.writeFileSync(file, String(limit));
    const result = status();
    if (result.limit !== limit) throw new Error('Kernel did not confirm the requested charge limit.');
    return result;
  }
  return { status, setLimit };
}
module.exports = { createBatteryCharge };
