const fs = require('node:fs');
const path = require('node:path');
const { transformRenderer, RENDERER_FILE, RENDERER_SHA256 } = require('./renderer-patches.cjs');

function prepareRendererOverlay({ vendorRoot, stateDir, fsImpl = fs }) {
  if (!path.isAbsolute(vendorRoot) || !path.isAbsolute(stateDir)) throw new Error('Absolute vendor/state directories required');
  const originalPath = path.join(vendorRoot, 'resources/app.asar', RENDERER_FILE);
  const { source, patches } = transformRenderer(fsImpl.readFileSync(originalPath, 'utf8'));
  const directory = path.join(stateDir, 'renderer-overlay');
  fsImpl.mkdirSync(directory, { recursive: true });
  const overlayPath = path.join(directory, path.basename(RENDERER_FILE));
  fsImpl.writeFileSync(overlayPath, source, { mode: 0o600 });
  return { originalPath, overlayPath, originalSha256: RENDERER_SHA256, patches,
    mapPath: file => typeof file === 'string' && path.normalize(file) === path.normalize(originalPath) ? overlayPath : file };
}

function createFsFacade(original, mapPath) {
  const copy = { ...original };
  for (const name of ['readFileSync', 'writeFileSync', 'existsSync', 'statSync', 'lstatSync', 'mkdirSync', 'readdirSync',
    'readFile', 'writeFile', 'stat', 'lstat', 'mkdir', 'readdir', 'appendFileSync', 'unlinkSync', 'createReadStream', 'open', 'openSync']) {
    if (typeof original[name] === 'function') copy[name] = (first, ...args) => original[name](mapPath(first), ...args);
  }
  if (original.promises) copy.promises = createFsFacade(original.promises, mapPath);
  return copy;
}
module.exports = { prepareRendererOverlay, createFsFacade };
