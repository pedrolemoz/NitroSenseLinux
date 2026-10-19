// Operator-run, local Windows queries only. Never sends SET_DEVICE_DATA (100).
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const cp = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { encodeReadRequest, JsonObjects } = require('../lib/protocol.cjs');
const { serviceResult } = require('../lib/reference.cjs');
const capabilities = ['VERSION', 'SUPPORT_OPERATING_MODE_CAPABILITY',
  'SUPPORT_OVERCLOCKING_MODE_CAPABILITY', 'SUPPORT_AUDIO_MODE', 'SUPPORT_KEYBOARD_INFO',
  'SUPPORT_FAN_CONTROL', 'SUPPORT_CPU_INFO', 'SUPPORT_GPU_INFO', 'SUPPORT_CUSTOM_BOOT_LOGO',
  'SUPPORT_EC_HID_INFO', 'SUPPORT_LCD_OVERDRIVE', 'SUPPORT_GPU_MODE', 'SUPPORT_GPU_MODE_CAPABILITY'];
function query(port, id, payload, timeout = 5000) {
  return new Promise(resolve => {
    const start = Date.now(), messages = [], parser = new JsonObjects(), decoder = new StringDecoder('utf8');
    const expected = payload.Function || ({ 10: 'GET_MONITOR_DATA', 30: 'GET_CONNECTED_DEVICE', 40: 'GET_LIGHTING_EFFECT_CAPABILITY' })[id];
    let done = false, deadline;
    const socket = net.createConnection({ host: '127.0.0.1', port });
    function finish(error, response) {
      if (done) return; done = true; clearTimeout(deadline); socket.destroy();
      resolve({ port, packetId: id, payload, expected, elapsedMs: Date.now() - start,
        status: error ? 'error' : 'observed', ...(error ? { error } : { response, service: serviceResult(response) }), messages });
    }
    deadline = setTimeout(() => finish('Absolute query deadline exceeded'), timeout);
    socket.setTimeout(timeout, () => finish('No matching response before timeout'));
    socket.once('connect', () => socket.write(encodeReadRequest(id, payload)));
    socket.on('data', bytes => {
      try {
        for (const message of parser.push(decoder.write(bytes))) {
          messages.push(message);
          if (message.request === expected) return finish(null, message);
          if (messages.length >= 100) return finish('Unmatched message limit');
        }
      } catch (error) { finish(error.message); }
    });
    socket.once('error', error => finish(error.message));
    socket.once('close', () => finish('Connection closed before matching response'));
  });
}
function windowsEnvironment() {
  if (process.platform !== 'win32') throw new Error('Run this reference collector on the original Windows installation');
  const code = "$ErrorActionPreference='Stop'; $aes=Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\OEM\\AcerAgentService' -ErrorAction SilentlyContinue; $bios=Get-ItemProperty -LiteralPath 'HKLM:\\HARDWARE\\DESCRIPTION\\System\\BIOS'; [pscustomobject]@{SupportAES=$aes.SupportAES;Model=$bios.SystemProductName;BiosVersion=$bios.BIOSVersion}|ConvertTo-Json -Compress";
  const raw = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code], { encoding: 'utf8', windowsHide: true });
  const env = JSON.parse(raw.trim());
  if (Number(env.SupportAES || 0) !== 0) throw new Error('AES is enabled. Plaintext collector cannot inspect this installation; no connection was made.');
  return env;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg.startsWith('--') && arg !== '--followup')) throw new Error('Only --followup is supported');
  const followup = args.includes('--followup');
  const out = path.resolve(args.find(arg => !arg.startsWith('--')) ||
    (followup ? '.state/windows-followup.json' : '.state/windows-reference.json'));
  if (fs.existsSync(out)) throw new Error('Refusing to overwrite an existing reference; choose a new output filename');
  const environment = windowsEnvironment();
  console.error('Querying local Acer services. No hardware-setting packets are sent.');
  const observations = [];
  const requests = followup ? [
    ...['OPERATING_MODE', 'FAN_CONTROL', 'ADAPTOR_STATUS', 'AC_STATUS', 'SOUND_MODE']
      .map(Function => [46933, 20, { Function }]),
    [46753, 20, { Function: 'SUPPORT_SYSTEM_CAPABILITY' }],
    [46753, 20, { Function: 'SUPPORT_GPU_INFO' }],
  ] : [
    ...capabilities.map(Function => [46933, 0, { Function }]),
    [46933, 30, {}], [46933, 40, {}], [46933, 10, {}],
    [46753, 0, { Function: 'SUPPORT_DISPLAY_POWER_SAVER' }], [46753, 10, {}],
  ];
  for (const [port, id, payload] of requests) {
    const result = await query(port, id, payload);
    observations.push(result);
    const detail = result.service ? ` / ${result.service.name || result.service.status}` :
      result.messages?.length ? ` / ${result.messages.length} unmatched message(s)` : '';
    console.error(`${port} ${payload.Function || id}: ${result.status}${detail}`);
    // A missing service should not cause a long series of redundant timeouts.
    if (result.error?.includes('ECONNREFUSED')) break;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ schema: 1, observedAt: new Date().toISOString(), environment,
    collector: 'read-only-query-v2', scope: followup ? 'current-state-and-system-capabilities' : 'initial-reference', observations,
    limitations: ['One separate TCP connection per query; no writes or UI actions.',
      'Errors and missing responses remain unknown; they do not establish unsupported hardware.'],
  }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(out);
  if (observations.some(o => o.status !== 'observed')) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { query };
