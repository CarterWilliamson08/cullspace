const { createClient } = require('./smoke-lib');

(async () => {
  const c = createClient();
  try {
    const apps = await c.call('list_apps');
    if (!Array.isArray(apps) || apps.length < 1) throw new Error('no apps');
    const withName = apps.filter((a) => a.name && a.uninstallString);
    if (withName.length < 1) throw new Error('apps missing uninstall strings');
    const q = 'microsoft';
    const filtered = apps.filter((a) => (a.name || '').toLowerCase().includes(q));
    console.log('SMOKE OK: list_apps', apps.length, 'filter(microsoft)=', filtered.length);
  } finally {
    c.close();
  }
})().catch((e) => {
  console.error('SMOKE FAIL:', e.message || e);
  process.exit(1);
});
