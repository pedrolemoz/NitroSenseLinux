const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { acquireInstance } = require('./single-instance.cjs');
function fixture() {
  const app = new EventEmitter(), window = new EventEmitter(), calls = [];
  app.requestSingleInstanceLock = () => true;
  Object.assign(window, { isDestroyed: () => false, isMinimized: () => true,
    restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') });
  return { app, window, calls };
}
test('repeat launch restores, shows and focuses the existing main window', () => {
  const { app, window, calls } = fixture();
  assert.equal(acquireInstance(app), true);
  app.emit('browser-window-created', {}, window);
  app.emit('second-instance');
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});
test('repeat launch during startup shows the main window when it becomes ready', () => {
  const { app, window, calls } = fixture();
  acquireInstance(app);
  app.emit('second-instance');
  app.emit('browser-window-created', {}, window);
  assert.deepEqual(calls, []);
  window.emit('ready-to-show');
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});
