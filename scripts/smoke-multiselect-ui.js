/**
 * Smoke: multi-select UI wiring (no live mass-delete).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'src', 'renderer', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles.css'), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(html.includes('id="fileSelectAll"'), 'file select-all missing');
assert(html.includes('id="folderSelectAll"'), 'folder select-all missing');
assert(html.includes('id="appSelectAll"'), 'app select-all missing');
assert(html.includes('btnRemoveSelectedFiles'), 'file batch remove missing');
assert(html.includes('btnRemoveSelectedFolders'), 'folder batch remove missing');
assert(html.includes('btnUninstallSelectedApps'), 'app batch uninstall missing');

assert(js.includes('selectedFilePaths'), 'selectedFilePaths missing');
assert(js.includes('selectedFolderPaths'), 'selectedFolderPaths missing');
assert(js.includes('selectedAppKeys'), 'selectedAppKeys missing');
assert(js.includes('confirmBatchDelete'), 'confirmBatchDelete missing');
assert(js.includes('runSequentialPathRemoves'), 'runSequentialPathRemoves missing');
assert(js.includes('runSequentialAppUninstalls'), 'runSequentialAppUninstalls missing');
assert(js.includes('Removing ${i + 1} of ${items.length}'), 'path progress copy missing');
assert(
  js.includes('Launching uninstaller ${i + 1} of ${apps.length}') ||
    js.includes('Starting uninstaller ${i + 1} of ${apps.length}'),
  'app progress copy missing'
);

assert(css.includes('32px 1fr 110px 110px'), 'checkbox grid missing');
assert(css.includes('.selection-bar'), 'selection-bar styles missing');

console.log('SMOKE OK: multi-select UI wiring');
