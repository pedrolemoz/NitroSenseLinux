const path = require('node:path');

// HTTPS-loaded Acer pages resolve Node modules relative to Electron's renderer
// init, not the vendor ASAR. Route only the missing bridge to the shipped copy.
function createRendererRequire(rendererRequire, vendorRequire) {
  function routed(request) {
    return request === '@electron/remote' ? vendorRequire(request) : rendererRequire(request);
  }
  Object.assign(routed, rendererRequire);
  routed.resolve = request => request === '@electron/remote'
    ? vendorRequire.resolve(request) : rendererRequire.resolve(request);
  return routed;
}

function rendererPreloadSource(vendorRoot) {
  if (!path.isAbsolute(vendorRoot)) throw new Error('Absolute vendor root required');
  return `const { createRequire } = require('node:module');\n` +
    `const { createRendererRequire } = require(${JSON.stringify(__filename)});\n` +
    `const vendorRequire = createRequire(${JSON.stringify(path.join(vendorRoot, 'resources/app.asar/package.json'))});\n` +
    `window.require = createRendererRequire(window.require || require, vendorRequire);\n`;
}
module.exports = { createRendererRequire, rendererPreloadSource };
