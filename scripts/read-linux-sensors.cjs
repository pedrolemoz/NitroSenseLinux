const fs = require('node:fs');
const path = require('node:path');
const { readLinuxSensors } = require('../lib/linux-sensors.cjs');

if (require.main === module) {
  try {
    if (process.platform !== 'linux') throw new Error('Run on Linux to read live sysfs sensors.');
    if (process.argv.length > 3) throw new Error('Usage: node scripts/read-linux-sensors.cjs [new-output.json]');
    const snapshot = readLinuxSensors();
    const json = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (process.argv[2]) {
      const output = path.resolve(process.argv[2]);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, json, { flag: 'wx' });
      console.log(`Read-only sensor snapshot saved: ${output}`);
    } else process.stdout.write(json);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
