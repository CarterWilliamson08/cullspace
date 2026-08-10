const { createClient } = require('./smoke-lib');

(async () => {
  const c = createClient();
  try {
    const drives = await c.call('list_drives', { includeNetworkOptical: false });
    if (!Array.isArray(drives) || drives.length < 1) throw new Error('no drives');
    const drive = drives.find((d) => d.isFixed) || drives[0];
    console.log('SMOKE drives:', drives.map((d) => d.name).join(', '));

    const files = await c.call('scan_files', { drives: [drive.name], limit: 20 });
    if (!Array.isArray(files) || files.length < 1) throw new Error('scan returned no files');
    const sorted = [...files].sort((a, b) => b.sizeBytes - a.sizeBytes);
    if (sorted[0].path !== files[0].path) throw new Error('results not size-sorted');
    console.log('SMOKE OK: scan_files', files.length, 'top=', files[0].path, files[0].sizeBytes);
  } finally {
    c.close();
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e);
  process.exit(1);
});
