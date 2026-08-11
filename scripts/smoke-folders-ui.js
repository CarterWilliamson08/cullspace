/**
 * Structural + helper smoke for Folders tab (no interactive Browse dialog).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('./smoke-lib');

const root = path.join(__dirname, '..');

function assertIncludes(file, needle, label) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}

(async () => {
  const html = path.join(root, 'src', 'renderer', 'index.html');
  const js = path.join(root, 'src', 'renderer', 'renderer.js');
  const preload = path.join(root, 'src', 'preload.js');
  const main = path.join(root, 'src', 'main.js');

  assertIncludes(html, 'data-tab="folders"', 'index.html');
  assertIncludes(html, 'id="foldersPane"', 'index.html');
  assertIncludes(html, 'id="btnScanFolderFiles"', 'index.html');
  assertIncludes(html, 'id="btnScanLargeFolders"', 'index.html');
  assertIncludes(js, 'scan_folder_files', 'renderer.js');
  assertIncludes(js, 'scan_largest_folders', 'renderer.js');
  assertIncludes(js, 'setFoldersMode', 'renderer.js');
  assertIncludes(preload, 'pickFolder', 'preload.js');
  assertIncludes(main, 'app:pick-folder', 'main.js');
  assertIncludes(main, 'scan_folder_files', 'main.js');
  console.log('SMOKE OK: Folders UI wiring present');

  const c = createClient();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cullspace-ui-folder-'));
  try {
    fs.writeFileSync(path.join(tmp, 'chunk.bin'), Buffer.alloc(128 * 1024, 7));
    const files = await c.call('scan_folder_files', { root: tmp, limit: 10 });
    if (!files?.length) throw new Error('scan_folder_files empty for UI smoke');
    const drives = await c.call('list_drives', { includeNetworkOptical: false });
    const drive = drives.find((d) => d.isFixed) || drives[0];
    const folders = await c.call('scan_largest_folders', { drives: [drive.name], limit: 5 });
    if (!folders?.length) throw new Error('scan_largest_folders empty for UI smoke');
    console.log('SMOKE OK: Folders helper path for UI', files.length, 'files /', folders.length, 'folders');
  } finally {
    c.close();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e);
  process.exit(1);
});
