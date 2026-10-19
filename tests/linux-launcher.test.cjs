const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('Linux launcher defaults to real monitoring and requires explicit simulator selection', { skip: process.platform !== 'linux' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nitro-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const mock = path.join(root, 'electron');
  fs.writeFileSync(mock, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
  for (const option of [null, '--read-only', '--ui-only']) {
    const result = spawnSync('sh', [path.resolve('scripts/start-linux.sh'), ...(option ? [option] : [])], {
      encoding: 'utf8', timeout: 5000, env: { ...process.env, PATH: root + ':' + process.env.PATH, NITROSENSE_ELECTRON: mock },
    });
    assert.equal(result.status, 0, result.stderr);
    const args = result.stdout.trim().split('\n');
    assert.equal(args[0], '--no-sandbox');
    assert.equal(args[1], '--ignore-certificate-errors');
    assert.equal(args[2], path.resolve('runtime'));
    const mode = option || '--read-only';
    assert.equal(args.at(-1), mode);
    assert.equal(args.includes(mode === '--ui-only' ? '--read-only' : '--ui-only'), false);
  }
});
