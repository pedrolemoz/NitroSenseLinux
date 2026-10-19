const fs = require('node:fs');
const crypto = require('node:crypto');
function summarize(inventory) {
  if (inventory.schemaVersion !== 1) throw new Error('Unsupported Linux inventory schema');
  const dmi = Object.fromEntries(inventory.dmi.filter(a => a.value !== undefined).map(a => [a.source.split('/').pop(), a.value]));
  return {
    kernel: inventory.kernelRelease, capturedAt: inventory.collectedAt, dmi,
    hwmon: inventory.hwmon.map(h => ({ source: h.source,
      name: h.attributes.find(a => a.source.endsWith('/name'))?.value || null,
      temperatures: h.attributes.filter(a => /\/temp\d+_input$/.test(a.source)),
      fans: h.attributes.filter(a => /\/fan\d+_input$/.test(a.source)),
      pwm: h.attributes.filter(a => /\/pwm\d+(?:_enable)?$/.test(a.source)) })),
    profiles: inventory.platformProfiles,
    gamingWmiPresent: inventory.wmiDevices.some(d => d.id.toUpperCase() === '7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56'),
    errors: inventory.errors, limits: inventory.limits,
    limitation: 'This records exposed interfaces, not proof that a specific driver or control path works.',
  };
}
if (require.main === module) {
  try {
    const input = process.argv[2] || '.state/linux-inventory.json';
    const output = process.argv[3] || 'analysis/linux-inventory-summary.json';
    const bytes = fs.readFileSync(input);
    const summary = summarize(JSON.parse(bytes.toString('utf8')));
    summary.sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(output, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ kernel: summary.kernel, model: summary.dmi.product_name,
      gamingWmiPresent: summary.gamingWmiPresent,
      fans: summary.hwmon.reduce((n, h) => n + h.fans.length, 0),
      pwm: summary.hwmon.reduce((n, h) => n + h.pwm.length, 0) }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { summarize };
