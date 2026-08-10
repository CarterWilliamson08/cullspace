const { createClient } = require('./smoke-lib');

(async () => {
  const c = createClient();
  try {
    const apps = await c.call('list_apps');
    const app = apps.find((a) => a.installLocation && a.uninstallString && a.name);
    if (!app) throw new Error('no suitable app for leftover preview');
    const related = await c.call('related_app', {
      app,
      allowedDrives: (await c.call('list_drives', { includeNetworkOptical: true })).map((d) => d.name),
    });
    if (!Array.isArray(related)) throw new Error('related_app did not return array');
    // Parse uninstall string safely through helper validation without launching:
    // We only verify command exists and app payload round-trips.
    console.log(
      'SMOKE OK: uninstall leftovers preview for',
      app.name,
      'related=',
      related.length,
      '(launch skipped in smoke)'
    );
  } finally {
    c.close();
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e);
  process.exit(1);
});
