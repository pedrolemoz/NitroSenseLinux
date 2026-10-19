// Read-only first stage of the Linux backend. No vendor data or cached fallback.
const { collectInventory } = require('../scripts/inspect-linux.cjs');

function normalizeSensors(inventory) {
  if (inventory.schemaVersion !== 1) throw new Error('Unsupported Linux inventory schema');
  function numeric(attribute, unit) {
    const base = { source: attribute.source, unit };
    if (attribute.error) return { ...base, error: attribute.error };
    const raw = attribute.value;
    if (attribute.truncated || typeof raw !== 'string' || !/^-?\d+$/.test(raw) ||
        !Number.isSafeInteger(Number(raw)) || (unit === 'rpm' && Number(raw) < 0)) {
      return { ...base, error: { code: 'INVALID_READING', message: 'Expected a complete integer sysfs reading' } };
    }
    return { ...base, value: Number(raw) / (unit === 'celsius' ? 1000 : 1) };
  }
  const hwmon = inventory.hwmon.map(device => {
    const attributes = new Map(device.attributes.map(a => [a.source.slice(a.source.lastIndexOf('/') + 1), a]));
    const name = attributes.get('name');
    const readings = device.attributes.filter(a => /\/(temp|fan)\d+_input$/.test(a.source)).map(a => {
      const channel = a.source.slice(a.source.lastIndexOf('/') + 1).replace(/_input$/, '');
      const label = attributes.get(`${channel}_label`);
      return { channel, label: label?.value ?? null, ...(label?.error ? { labelError: label.error } : {}),
        ...numeric(a, channel.startsWith('temp') ? 'celsius' : 'rpm') };
    });
    return { source: device.source, name: name?.value ?? null,
      ...(name?.error ? { nameError: name.error } : {}), readings,
      pwmInterfaces: device.attributes.filter(a => /\/pwm\d+(?:_enable)?$/.test(a.source)) };
  });
  const profiles = inventory.platformProfiles.map(device => {
    const modern = device.source.startsWith('/sys/class/platform-profile/');
    const get = suffix => device.attributes.find(a => a.source.endsWith(`/${suffix}`));
    const current = get(modern ? 'profile' : 'platform_profile');
    const choices = get(modern ? 'choices' : 'platform_profile_choices');
    return { source: device.source, name: modern ? get('name') : undefined,
      current, choices: choices?.value !== undefined ? { source: choices.source, values: choices.value.split(/\s+/).filter(Boolean) } : choices };
  });
  return { schemaVersion: 1, collectedAt: inventory.collectedAt, kernelRelease: inventory.kernelRelease,
    readOnly: true, hwmon, profiles, errors: inventory.errors, limits: inventory.limits,
    limitation: 'Readings are observations, not verified physical controls. Unlabeled channels have no CPU/GPU assignment. Profile choices are not validated Acer modes.' };
}

// Discovery is repeated on each sample: hwmon numbers may change after reload/resume.
function readLinuxSensors(options) { return normalizeSensors(collectInventory(options)); }
module.exports = { normalizeSensors, readLinuxSensors };
