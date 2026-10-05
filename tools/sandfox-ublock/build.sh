#!/usr/bin/env bash
set -euo pipefail

UBLOCK_REPO="https://github.com/gorhill/uBlock.git"
UBLOCK_COMMIT="21f0e686506bb21b514b451c8c6cb9bf8c82d232"
WORK_DIR="${RUNNER_TEMP:-/tmp}/sandfox-ublock"

rm -rf "$WORK_DIR"
git clone --quiet --filter=blob:none "$UBLOCK_REPO" "$WORK_DIR"
git -C "$WORK_DIR" checkout --quiet "$UBLOCK_COMMIT"

python3 - "$WORK_DIR/src/js/traffic.js" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old = """const webRequest = {
    onBeforeRequest,

    start: (( ) => {
        vAPI.net = new vAPI.Net();
        if ( vAPI.Net.canSuspend() ) {
            vAPI.net.suspend();
        }

        return ( ) => {
            vAPI.net.setSuspendableListener(onBeforeRequest);
            vAPI.net.addListener('onHeadersReceived', onHeadersReceived, {
                urls: [ 'http://*/*', 'https://*/*' ]
            }, [ 'blocking', 'responseHeaders' ]);
            onResponseStarted.start();
            requestHeadersManager.start();
            vAPI.defer.once({ sec: µb.hiddenSettings.toolbarWarningTimeout }).then(( ) => {
                if ( vAPI.net.hasUnprocessedRequest() === false ) { return; }
                vAPI.net.removeUnprocessedRequest();
                return vAPI.tabs.getCurrent();
            }).then(tab => {
                if ( tab instanceof Object === false ) { return; }
                µb.updateToolbarIcon(tab.id, 0b0110);
            });
            vAPI.net.unsuspend({ all: true });
        };
    })(),
"""

new = """const webRequest = {
    onBeforeRequest,

    // SANDFOX: Brave adblock-rust is the sole network blocker.
    // Keep uBO's filtering/cosmetic engines available without registering
    // a second network observer or suspending Gecko network activity.
    start: (( ) => {
        vAPI.net = new vAPI.Net();
        vAPI.net.setSuspendableListener(() => {});
        return ( ) => {};
    })(),
"""

if old not in text:
    raise SystemExit("uBO traffic.js patch anchor not found")

path.write_text(text.replace(old, new, 1))
PY

make -C "$WORK_DIR" firefox

rm -rf app/src/main/assets/extensions/ublock_origin
mkdir -p app/src/main/assets/extensions/ublock_origin
cp -a "$WORK_DIR/dist/build/uBlock0.firefox/." app/src/main/assets/extensions/ublock_origin/

test -f app/src/main/assets/extensions/ublock_origin/manifest.json
test -f app/src/main/assets/extensions/ublock_origin/js/start.js
test -f app/src/main/assets/extensions/ublock_origin/js/contentscript.js
