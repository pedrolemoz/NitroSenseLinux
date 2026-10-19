const test = require('node:test');
const assert = require('node:assert/strict');
const { serviceResult, classifyObservation, summarizeReference } = require('../lib/reference.cjs');
test('Acer numeric and string result codes are distinct from transport success', () => {
  assert.equal(serviceResult({ result: '0' }).status, 'success');
  assert.equal(serviceResult({ result: 0 }).status, 'success');
  assert.equal(serviceResult({ result: '3' }).name, 'WRONG_PARAMETERS');
  assert.equal(serviceResult({ result: '' }).status, 'unknown');
  const o = classifyObservation({ expected: 'GET_CONNECTED_DEVICE', status: 'observed',
    response: { request: 'GET_CONNECTED_DEVICE', data: null, result: '1' } });
  assert.equal(o.transport, 'matched-response'); assert.equal(o.result.status, 'service-error');
});
test('actual lighting null envelope does not become a named success or no-response', () => {
  const o = classifyObservation({ expected: 'GET_LIGHTING_EFFECT_CAPABILITY', status: 'error',
    error: 'deadline', messages: [{ data: null, request: null, result: '0' }] });
  assert.equal(o.transport, 'unattributed-message'); assert.equal(o.result.status, 'unknown');
  assert.equal(o.anonymous.length, 1);
});
test('mode decoding retains unknown codes and never adds absent turbo mode', () => {
  const summary = summarizeReference({ schema: 1, observations: [{ port: 46933,
    packetId: 0, payload: { Function: 'SUPPORT_OPERATING_MODE_CAPABILITY' },
    expected: 'SUPPORT_OPERATING_MODE_CAPABILITY',
    response: { request: 'SUPPORT_OPERATING_MODE_CAPABILITY', result: '0', data: [0, 1, 4, 6, 99] } }] });
  assert.deepEqual(summary.operatingModes.map(v => v.name), ['QUIET', 'DEFAULT', 'EXTREME', 'ECO', 'UNKNOWN']);
  assert.equal(summary.totals.serviceSuccess, 1);
});
