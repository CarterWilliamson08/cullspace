const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('./smoke-lib');

(async () => {
  const c = createClient();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cullspace-related-'));
  const target = path.join(dir, 'demo.bin');
  const sibling = path.join(dir, 'demo.txt');
  fs.writeFileSync(target, Buffer.alloc(1024, 1));
  fs.writeFileSync(sibling, 'related');
  try {
    const drives = await c.call('list_drives', { includeNetworkOptical: true });
    const root = path.parse(dir).root;
    const related = await c.call('related_files', {
      path: target,
      allowedDrives: drives.map((d) => d.name),
    });
    const paths = related.map((r) => r.path.toLowerCase());
    if (!paths.some((p) => p === target.toLowerCase())) throw new Error('missing target');
    if (!paths.some((p) => p === sibling.toLowerCase())) throw new Error('missing sibling related path');
    console.log('SMOKE OK: related_files', related.length, 'root=', root);
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e);
  process.exit(1);
});
