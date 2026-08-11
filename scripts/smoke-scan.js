const fs = require('fs');
const path = require('path');
const { createClient } = require('./smoke-lib');

function unwrapItems(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.items)) return result.items;
  return null;
}

function isUnderPath(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  if (process.platform === 'win32') {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
  return child.startsWith(parent + path.sep) || child === parent;
}

function programFilesRoots() {
  const roots = [];
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  if (fs.existsSync(pf)) roots.push(pf);
  if (fs.existsSync(pfx86)) roots.push(pfx86);
  return roots;
}

(async () => {
  const c = createClient();
  const profile = process.env.USERPROFILE;
  const smokeDir = profile ? path.join(profile, 'CullSpaceSmoke') : null;
  const bigPath = smokeDir ? path.join(smokeDir, 'big.bin') : null;

  try {
    const drives = await c.call('list_drives', { includeNetworkOptical: false });
    if (!Array.isArray(drives) || drives.length < 1) throw new Error('no drives');
    const drive = drives.find((d) => d.isFixed) || drives[0];
    console.log('SMOKE drives:', drives.map((d) => d.name).join(', '));

    // Seed a large file under the user profile so drive scans can surface profile paths.
    if (smokeDir && bigPath) {
      fs.mkdirSync(smokeDir, { recursive: true });
      fs.writeFileSync(bigPath, Buffer.alloc(2 * 1024 * 1024, 0xab));
    }

    const raw = await c.call('scan_files', { drives: [drive.name], limit: 200 });
    const files = unwrapItems(raw);
    if (!files || files.length < 1) throw new Error('scan returned no files');
    const sorted = [...files].sort((a, b) => b.sizeBytes - a.sizeBytes);
    if (sorted[0].path !== files[0].path) throw new Error('results not size-sorted');
    if (raw && raw.stats && typeof raw.stats.scannedFiles !== 'number') {
      throw new Error('scan_files stats.scannedFiles missing');
    }
    console.log('SMOKE OK: scan_files', files.length, 'top=', files[0].path, files[0].sizeBytes);

    if (profile && fs.existsSync(profile)) {
      const underProfile = files.some((f) => isUnderPath(f.path, profile));
      const underSmoke = bigPath && files.some((f) => isUnderPath(f.path, smokeDir));
      if (!underProfile && !underSmoke) {
        throw new Error('expected scan_files on system drive to include user profile paths');
      }
      console.log('SMOKE OK: scan_files includes user profile paths');
    }

    const pfRoots = programFilesRoots();
    if (pfRoots.length > 0) {
      const noPf = await c.call('scan_files', {
        drives: [drive.name],
        limit: 200,
        includeProgramFiles: false,
      });
      const noPfFiles = unwrapItems(noPf) || [];
      const hitPf = noPfFiles.some((f) =>
        pfRoots.some((root) => isUnderPath(f.path, root))
      );
      if (hitPf) {
        throw new Error('includeProgramFiles:false returned Program Files paths');
      }
      console.log('SMOKE OK: includeProgramFiles:false excludes Program Files');

      const withPfPromise = c.call('scan_files', {
        drives: [drive.name],
        limit: 20,
        includeProgramFiles: true,
      });
      await new Promise((r) => setTimeout(r, 1500));
      await c.call('cancel_scan');
      const withPf = await withPfPromise;
      const withPfFiles = unwrapItems(withPf);
      if (!withPf || !Array.isArray(withPfFiles)) {
        throw new Error('includeProgramFiles:true returned invalid result');
      }
      console.log('SMOKE OK: includeProgramFiles:true + cancel_scan');
    }
  } finally {
    c.close();
    if (bigPath) {
      try {
        fs.rmSync(path.dirname(bigPath), { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e);
  process.exit(1);
});
