// Acquire Electron's desktop lock before starting any fixed-port Linux services.
function acquireInstance(app) {
  let mainWindow;
  let pendingShow = false;
  function show() {
    pendingShow = true;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    pendingShow = false;
  }
  if (!app.requestSingleInstanceLock()) {
    console.error('NitroSense is already running; bringing its window forward.');
    app.exit(0);
    return false;
  }
  app.on('second-instance', show);
  app.on('browser-window-created', (_event, window) => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    mainWindow = window;
    window.once('ready-to-show', () => { if (pendingShow) show(); });
  });
  return true;
}
module.exports = { acquireInstance };
