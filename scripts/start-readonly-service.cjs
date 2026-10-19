// Standalone development entry. UI read-only mode owns its own service lifecycle.
const { createLinuxTelemetry } = require('../lib/linux-telemetry.cjs');
const { createReadOnlyHandler, startAcerServices } = require('../lib/acer-service.cjs');

async function main() {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/start-readonly-service.cjs');
  if (process.platform !== 'linux') throw new Error('The live read-only service requires Linux');
  if (process.getuid() === 0) throw new Error('Run as an ordinary user, without sudo');
  const monitor = createLinuxTelemetry();
  const handler = createReadOnlyHandler(monitor);
  const services = await startAcerServices({ handler });
  console.log('NitroSense Linux read-only development service: 127.0.0.1:46933/46753.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    monitor.close();
    await services.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
