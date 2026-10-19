// Result names come from RETURN_CODE in the supplied Acer 5.1.392 main.js.
const RESULT_NAMES = ['SUCCESS', 'FAIL_TO_GET_DATA', 'TIMEOUT', 'WRONG_PARAMETERS'];
const OPERATING_MODES = { 0: 'QUIET', 1: 'DEFAULT', 4: 'EXTREME', 5: 'TURBO', 6: 'ECO' };
function serviceResult(message) {
  if (!message || !Object.hasOwn(message, 'result')) return { status: 'unknown', code: null, name: null };
  const value = message.result;
  if (!(typeof value === 'number' && Number.isInteger(value) ||
      typeof value === 'string' && /^\d+$/.test(value))) return { status: 'unknown', code: null, name: null };
  const code = Number(value);
  return { status: code === 0 ? 'success' : 'service-error', code, name: RESULT_NAMES[code] || 'UNMAPPED_RESULT' };
}
function classifyObservation(observation) {
  const messages = observation.messages || [];
  const matching = observation.response?.request === observation.expected && observation.response ||
    messages.find(m => m.request === observation.expected && observation.expected != null);
  if (matching) return { transport: 'matched-response', result: serviceResult(matching), message: matching };
  const anonymous = messages.filter(m => m && m.request == null && !m.Function);
  return { transport: anonymous.length ? 'unattributed-message' : messages.length ? 'unmatched-messages' : 'no-response',
    result: { status: 'unknown', code: null, name: null }, anonymous,
    error: observation.error || null };
}
function summarizeReference(reference) {
  if (reference.schema !== 1 || !Array.isArray(reference.observations)) throw new Error('Unsupported capture format');
  const observations = reference.observations.map(o => ({ port: o.port, packetId: o.packetId,
    function: o.payload.Function || o.expected, ...classifyObservation(o) }));
  const successful = (name, port = 46933) => observations.find(o => o.port === port && o.function === name && o.result.status === 'success')?.message?.data;
  const modes = successful('SUPPORT_OPERATING_MODE_CAPABILITY');
  return { schema: 1, capturedAt: reference.observedAt, environment: reference.environment,
    serviceVersion: successful('VERSION') || null,
    operatingModes: Array.isArray(modes) ? modes.map(code => ({ code, name: OPERATING_MODES[code] || 'UNKNOWN' })) : null,
    fanCapabilities: successful('SUPPORT_FAN_CONTROL') || null,
    cpu: successful('SUPPORT_CPU_INFO') || null, gpu: successful('SUPPORT_GPU_INFO') || null,
    monitorFields: [46933, 46753].map(port => ({ port,
      fields: Object.keys(successful('GET_MONITOR_DATA', port) || {}).sort() })),
    totals: { requests: observations.length,
      matched: observations.filter(o => o.transport === 'matched-response').length,
      serviceSuccess: observations.filter(o => o.result.status === 'success').length,
      serviceErrors: observations.filter(o => o.result.status === 'service-error').length,
      unattributed: observations.filter(o => o.transport === 'unattributed-message').length },
    observations,
    limitations: ['Windows reference values are historical observations, not Linux sensor readings.',
      'Service errors do not by themselves prove a feature is absent from the hardware.',
      'Unattributed messages cannot safely resolve named request callbacks in the original client.'],
  };
}
module.exports = { serviceResult, classifyObservation, summarizeReference };
