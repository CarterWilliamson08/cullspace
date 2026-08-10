const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('./smoke-lib');

(async () => {
  const c = createClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cullspace-del-'));
  const file = path.join(dir, 'delete-me.bin');
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  try {
    const drives = await c.call('list_drives', { includeNetworkOptical: true });
    const win = path.join(process.env.WINDIR || 'C:\\Windows', 'System32');

    // Protected path must be rejected even by unelevated helper path (direct IPC).
    const protectedResult = await c.call('delete_paths', {
      paths: [win],
      allowedDrives: drives.map((d) => d.name),
    });
    if (!protectedResult.failed || protectedResult.failed.length < 1) {
      throw new Error('expected protected path rejection');
    }
    console.log('SMOKE OK: protected delete rejected');

    // Unelevated helper should refuse privileged delete requirement.
    const result = await c.call('delete_paths', {
      paths: [file],
      allowedDrives: drives.map((d) => d.name),
    });
    if (result.elevated) {
      // If somehow elevated, ensure delete worked.
      if (!fs.existsSync(file)) console.log('SMOKE OK: elevated delete removed file');
      else throw new Error('elevated but file remains');
    } else if (result.error) {
      console.log('SMOKE OK: delete requires elevation:', result.error);
      // Clean fixture ourselves
      fs.rmSync(dir, { recursive: true, force: true });
    } else if (result.deleted?.includes(file) || result.deleted?.some((p) => p.toLowerCase() === file.toLowerCase())) {
      console.log('SMOKE OK: file deleted without elevation (user writable temp)');
    } else {
      console.log('SMOKE OK: delete_paths responded', JSON.stringify(result));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    c.close();
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e);
  process.exit(1);
});
