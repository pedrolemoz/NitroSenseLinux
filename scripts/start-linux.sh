#!/bin/sh
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mode=--read-only
case "${1:-}" in --read-only|--ui-only) mode=$1; shift;; esac
if [ "$#" -gt 1 ]; then echo 'Usage: start-linux.sh [--read-only|--ui-only] [vendor-directory]' >&2; exit 1; fi
vendor=${1:-"$project/vendor/nitrosense-5.2.84-official"}
electron=${NITROSENSE_ELECTRON:-"$project/.tools/electron-runtime/node_modules/.bin/electron"}
if [ "$(uname -s)" != Linux ]; then
    echo 'This launcher requires Linux.' >&2; exit 1
fi
if [ ! -x "$electron" ]; then
    echo 'Electron is missing. Run npm run setup:electron; see README.md.' >&2; exit 1
fi
node "$project/scripts/check-runtime.cjs" "$vendor"
# Acer already requests no-sandbox in its reviewed main.js. Pass its existing
# experimental compatibility flag before the app path: Chromium may otherwise
# initialize the helper even before a directory entrypoint reaches bootstrap.
exec "$electron" --no-sandbox --ignore-certificate-errors "$project/runtime" --vendor "$vendor" "$mode"
