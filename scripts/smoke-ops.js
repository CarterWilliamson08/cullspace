/**
 * Structural smoke for Phase 3 ops (elevated batch, leftovers, silent update, uninstall confirm).
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

const main = read('src/main.js');
const preload = read('src/preload.js');
const renderer = read('src/renderer/renderer.js');
const install = read('installer/install.js');
const silent = read('scripts/smoke-silent-setup.js');

assert(main.includes('openElevatedSession'), 'elevated session helper missing');
assert(main.includes('helper:begin-elevated'), 'begin-elevated IPC missing');
assert(main.includes('helper:end-elevated'), 'end-elevated IPC missing');
assert(main.includes('elevatedHold'), 'elevated hold/refcount missing');
assert(preload.includes('beginElevated'), 'preload beginElevated missing');
assert(preload.includes('endElevated'), 'preload endElevated missing');
assert(renderer.includes('beginElevated'), 'renderer batch elevated missing');
assert(renderer.includes('I’ve finished') || renderer.includes("I've finished"), 'leftover wait CTA missing');
assert(renderer.includes('waitForUninstallerOrUser'), 'leftover wait helper missing');
assert(preload.includes('waitForPid'), 'preload waitForPid missing');
assert(main.includes('app:wait-for-pid'), 'wait-for-pid IPC missing');
assert(main.includes('--install-dir='), 'silent update install-dir missing');
assert(main.includes('--wait-pid='), 'silent update wait-pid missing');
assert(main.includes('Silent update Setup exited'), 'silent update failure handling missing');
assert(install.includes('installAppDeferred'), 'deferred silent replace missing');
assert(install.includes('scheduleDeferredReplace'), 'deferred apply scheduler missing');
assert(renderer.includes('skipUpdateVersion') || renderer.includes('Skip this version'), 'skip version missing');
assert(install.includes('MessageBox'), 'self-uninstall confirm missing');
assert(silent.includes('--install-dir='), 'silent-setup smoke still covers install-dir');
assert(silent.includes('--wait-pid='), 'silent-setup smoke covers wait-pid');

console.log('SMOKE OK: ops reliability wiring');
