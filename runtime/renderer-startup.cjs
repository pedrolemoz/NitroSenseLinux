// Identity is optional for local monitoring. Keep failures observable without
// exposing identifiers, substituting values or elevating the graphical app.
async function settleOptional(view, name, read) {
  view._linuxOptionalState ||= {};
  try {
    const value = await read();
    view._linuxOptionalState[name] = { state: 'queried' };
    return value;
  } catch (error) {
    view._linuxOptionalState[name] = { state: 'unavailable', code: /^[A-Z0-9_]{1,80}$/.test(error?.code || '')
      ? error.code : 'ERR_NITROSENSE_OPTIONAL' };
    return null;
  }
}
async function initializeAnalytics(view, ddsc) {
  // A stored consent choice is preserved; failure to obtain required identity
  // disables this analytics session instead of sending an invented identifier.
  view.IsEnableGA = false;
  return settleOptional(view, 'analytics', async () => {
    if (!await ddsc.info.getGAInfoAgree()) return;
    const uuid = await ddsc.info.getSystemUuid();
    if (!uuid) throw Object.assign(new Error('Identity unavailable'), { code: 'ERR_NITROSENSE_IDENTITY' });
    await view.getSnNumber();
    view.machineGuid = uuid;
    view.IsEnableGA = true;
  });
}
function preparePlanet9(view) {
  view.p9UrlPromise = settleOptional(view, 'planet9', async () => {
    if (!view.oemSettings?.Features?.Planet9) return null;
    view.updateP9BaseUrl();
    const values = await Promise.all([view.ddsc.info.getSerialNumber(), view.ddsc.info.getSystemUuid(),
      view.ddsc.info.getLocaleCountryCode(), view.ddsc.info.getGAInfoAgree(), view.ddsc.info.getAcerIdKey()]);
    if (!values[0] || !values[1]) throw Object.assign(new Error('Identity unavailable'), { code: 'ERR_NITROSENSE_IDENTITY' });
    const query = new URLSearchParams({ sn: values[0], uid: values[1], region: values[2],
      cookies: values[3] ? 'on' : 'off', acerid: values[4], medium: 'NitroSense' });
    view.p9queryString = query.toString();
    return view._p9UrlQS;
  });
  return view.p9UrlPromise;
}
async function readOptionalIdentity(view, ddsc) {
  const state = {};
  for (const [name, read] of [
    ['serial', () => view.driverService.getSnNumber()],
    ['snid', () => view.driverService.getSnId()],
    ['uuid', () => ddsc.info.getSystemUuid()],
  ]) {
    try {
      await read();
      state[name] = { state: 'queried' };
    } catch (error) {
      state[name] = { state: 'unavailable', code: /^[A-Z0-9_]{1,80}$/.test(error?.code || '')
        ? error.code : 'ERR_NITROSENSE_IDENTITY' };
    }
  }
  view._linuxIdentityState = state;
  return state;
}
function createReadOnlyHome(view, modes, port) {
  // Home's webview is an overlay. Creating it for another tab hides that tab
  // beneath an empty /aframe guest, even though its component rendered correctly.
  const visible = view.gos.activeTab === 'Home' && (!view.gos.reCreateHome || Boolean(view.gos.showUI));
  if (!visible) { view.gos._embeddedUrl = null; return false; }
  // Template getters must never create Promises. An unavailable operating mode
  // used to reject getDataAsync on every Angular check, scheduling another check
  // indefinitely and starving rendering, input and monitoring subscriptions.
  const mode = view.pss.dataModel?.operatingMode?.getData();
  const name = mode == null ? null : modes[mode];
  const query = 'startupTab=' + encodeURIComponent(view.gos.activeTab ?? '');
  view.gos._embeddedUrl = `https://localhost:${port}/aframe?${query}` +
    (typeof name === 'string' ? '&OPERATING_MODE=' + encodeURIComponent(name) : '');
  return true;
}
module.exports = { readOptionalIdentity, createReadOnlyHome, settleOptional, initializeAnalytics, preparePlanet9 };
