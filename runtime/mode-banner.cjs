function modeBannerSource(readOnly) {
  const label = readOnly ? 'WAITING FOR LINUX READINGS — READ ONLY — HARDWARE CONTROLS UNAVAILABLE' :
    'INTERFACE ONLY — ACER SIMULATED DATA — HARDWARE CONTROL UNAVAILABLE';
  return `(() => {
    let e = document.getElementById('nitrosense-linux-mode');
    if (!e) {
      e = document.createElement('div'); e.id = 'nitrosense-linux-mode';
      e.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#8b1c13;color:white;font:12px sans-serif;padding:6px;text-align:center;pointer-events:none';
      document.body.appendChild(e);
    }
    e.textContent = ${JSON.stringify(label)};
    ${readOnly ? `if (!window.nitrosenseLinuxStatusInstalled) {
      window.nitrosenseLinuxStatusInstalled = true;
      window.addEventListener('nitrosense-linux-status', event => {
        if (event.detail?.kind !== 'monitor') return;
        e.textContent = event.detail.available ? 'LIVE LINUX READINGS — READ ONLY — MISSING VALUES: -- — HARDWARE CONTROLS UNAVAILABLE' :
          'LINUX READINGS UNAVAILABLE — READ ONLY — HARDWARE CONTROLS UNAVAILABLE';
      });
    }` : ''}
  })()`;
}
module.exports = { modeBannerSource };
