const test = require('node:test');
const assert = require('node:assert/strict');
const { readOptionalIdentity } = require('./renderer-startup.cjs');

test('optional identity preserves independent queries and never stores identifiers in diagnostics', async () => {
  const view = { driverService: {
    getSnNumber: async () => { throw Object.assign(new Error('secret'), { code: 'EACCES' }); },
    getSnId: async () => { throw new Error('secret'); },
  } };
  let uuidRead = false;
  const result = await readOptionalIdentity(view, { info: { getSystemUuid: async () => { uuidRead = true; return 'PRIVATE_UUID'; } } });
  assert.equal(uuidRead, true);
  assert.deepEqual(result, { serial: { state: 'unavailable', code: 'EACCES' },
    snid: { state: 'unavailable', code: 'ERR_NITROSENSE_IDENTITY' }, uuid: { state: 'queried' } });
  assert.equal(view._linuxIdentityState, result);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|secret/);
});

test('home getter is synchronous through absent, failed and changing operating mode', () => {
  const { createReadOnlyHome } = require('./renderer-startup.cjs');
  const view = { gos: { reCreateHome: true, showUI: true, activeTab: 'Home' }, pss: {} };
  assert.equal(createReadOnlyHome(view, {}, '12345'), true);
  assert.equal(view.gos._embeddedUrl, 'https://localhost:12345/aframe?startupTab=Home');
  let mode = null;
  view.pss.dataModel = { operatingMode: {
    getData: () => mode,
    getDataAsync() { assert.fail('Template evaluation must not create asynchronous work'); },
  } };
  for (let i = 0; i < 10000; i++) assert.equal(createReadOnlyHome(view, { 0: 'DEFAULT' }, '12345'), true);
  assert.doesNotMatch(view.gos._embeddedUrl, /OPERATING_MODE|undefined/);
  mode = 0;
  createReadOnlyHome(view, { 0: 'DEFAULT' }, '12345');
  assert.match(view.gos._embeddedUrl, /OPERATING_MODE=DEFAULT/);
  mode = null;
  createReadOnlyHome(view, {}, '12345');
  assert.doesNotMatch(view.gos._embeddedUrl, /OPERATING_MODE/);
  view.gos.showUI = false;
  assert.equal(createReadOnlyHome(view, {}, '12345'), false);
  assert.equal(view.gos._embeddedUrl, null);
});

test('analytics respects local consent and remains disabled when required identity fails', async () => {
  const { initializeAnalytics } = require('./renderer-startup.cjs');
  const view = { getSnNumber() { assert.fail('Identity should not be read without consent'); } };
  const ddsc = { info: { getGAInfoAgree: async () => false, getSystemUuid() { assert.fail('No consent'); } } };
  await initializeAnalytics(view, ddsc);
  assert.equal(view.IsEnableGA, false);
  ddsc.info.getGAInfoAgree = async () => true;
  ddsc.info.getSystemUuid = async () => { throw Object.assign(new Error('PRIVATE_UUID'), { code: 'EACCES' }); };
  await initializeAnalytics(view, ddsc);
  assert.equal(view.IsEnableGA, false);
  assert.deepEqual(view._linuxOptionalState.analytics, { state: 'unavailable', code: 'EACCES' });
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE/);
});

test('optional integrations settle rejections and disabled Planet9 performs no identity queries', async () => {
  const { preparePlanet9, settleOptional } = require('./renderer-startup.cjs');
  const view = { oemSettings: { Features: { Planet9: false } } };
  assert.equal(await preparePlanet9(view), null);
  view.oemSettings.Features.Planet9 = true;
  view.updateP9BaseUrl = () => {};
  view.ddsc = { info: Object.fromEntries(['getSerialNumber', 'getSystemUuid', 'getLocaleCountryCode', 'getGAInfoAgree', 'getAcerIdKey'].map(name => [name, async () => { throw Object.assign(new Error('PRIVATE'), { code: 'EACCES' }); }])) };
  assert.equal(await preparePlanet9(view), null);
  assert.deepEqual(view._linuxOptionalState.planet9, { state: 'unavailable', code: 'EACCES' });
  assert.equal(await settleOptional(view, 'lighting', () => { throw { code: 'private-code-secret' }; }), null);
  assert.deepEqual(view._linuxOptionalState.lighting, { state: 'unavailable', code: 'ERR_NITROSENSE_OPTIONAL' });
});
