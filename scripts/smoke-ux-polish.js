/**
 * Structural smoke for Phase 1 UX polish + Phase 2 scan UI wiring.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const renderer = read('src/renderer/renderer.js');
const html = read('src/renderer/index.html');
const preload = read('src/preload.js');
const main = read('src/main.js');
const installerHtml = read('installer/renderer/index.html');

assert(!/\balert\s*\(/.test(renderer), 'renderer still calls alert(');
assert(renderer.includes('emptyStateHtml'), 'empty states helper missing');
assert(renderer.includes('showSafetyCard'), 'safety card missing');
assert(renderer.includes('refreshAfterDelete'), 'context refresh missing');
assert(renderer.includes('Showing ${shown} of ${total}') || renderer.includes('Showing '), 'apps N of M missing');
assert(renderer.includes('btnShowMoreApps') || renderer.includes('Show more'), 'apps show more missing');
assert(renderer.includes('includeProgramFiles'), 'PF toggle wiring missing');
assert(renderer.includes('dedupeDeepest'), 'folder dedupe wiring missing');
assert(renderer.includes('cancel_scan'), 'cancel scan wiring missing');
assert(renderer.includes('normalizeScanResult'), 'scan result unwrap missing');
assert(renderer.includes('formatStats'), 'skip stats display missing');
assert(html.includes('id="includeProgramFiles"'), 'PF checkbox missing');
assert(html.includes('id="dedupeDeepest"'), 'dedupe checkbox missing');
assert(preload.includes('onScanProgress'), 'preload scan progress missing');
assert(main.includes('helper:progress'), 'main progress forward missing');
assert(main.includes('SCAN_TIMEOUT_MS') || main.includes('30 * 60 * 1000'), 'scan timeout missing');
assert(installerHtml.toLowerCase().includes('uninstall'), 'installer uninstall mention missing');
assert(renderer.includes('aria-selected'), 'tab aria-selected missing');
assert(renderer.includes("role', 'dialog'") || renderer.includes('role="dialog"') || renderer.includes("setAttribute('role', 'dialog')"), 'dialog role missing');

console.log('SMOKE OK: UX polish + scan UI wiring');
