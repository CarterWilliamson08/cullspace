const fs = require('fs');
const os = require('os');
const path = require('path');
const { createClient } = require('./smoke-lib');

(async () => {
  const c = createClient();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cullspace-folder-'));
  const nested = path.join(tmp, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  const bigPath = path.join(nested, 'big.bin');
  const smallPath = path.join(tmp, 'small.bin');
  fs.writeFileSync(bigPath, Buffer.alloc(256 * 1024, 1));
  fs.writeFileSync(smallPath, Buffer.alloc(4 * 1024, 2));

  try {
    const files = await c.call('scan_folder_files', { root: tmp, limit: 20 });
    if (!Array.isArray(files) || files.length < 2) {
      throw new Error(`scan_folder_files expected >=2 files, got ${files?.length}`);
    }
    if (!files.some((f) => String(f.path).toLowerCase() === bigPath.toLowerCase())) {
      throw new Error('scan_folder_files missed big.bin');
    }
    if (files[0].sizeBytes < files[1].sizeBytes) {
      throw new Error('scan_folder_files not size-sorted');
    }
    console.log('SMOKE OK: scan_folder_files', files.length, 'top=', files[0].path, files[0].sizeBytes);

    const drives = await c.call('list_drives', { includeNetworkOptical: false });
    const drive = (drives || []).find((d) => d.isFixed) || drives?.[0];
    if (!drive?.name) throw new Error('no drive for scan_largest_folders');

    const folders = await c.call('scan_largest_folders', {
      drives: [drive.name],
      limit: 15,
    });
    if (!Array.isArray(folders) || folders.length < 1) {
      throw new Error('scan_largest_folders returned no folders');
    }
    if (!folders.every((f) => f.isDirectory)) {
      throw new Error('scan_largest_folders entries must be directories');
    }
    console.log(
      'SMOKE OK: scan_largest_folders',
      folders.length,
      'top=',
      folders[0].path,
      folders[0].sizeBytes
    );

    // Hard-protected roots must be refused.
    const windows = process.env.SystemRoot || 'C:\\Windows';
    let refused = false;
    try {
      await c.call('scan_folder_files', { root: windows, limit: 5 });
    } catch (err) {
      refused = /refus|protect/i.test(err.message || '');
    }
    if (!refused) throw new Error('expected scan_folder_files to refuse Windows');
    console.log('SMOKE OK: scan_folder_files refuses Windows');
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
