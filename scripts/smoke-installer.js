/**
 * Smoke-test install logic against the unpacked Setup resources (no UI).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { installApp } = require('../installer/install');

(async () => {
  const resourcesPath = path.join(
    __dirname,
    '..',
    'dist-installer',
    'win-unpacked',
    'resources'
  );
  const payload = path.join(resourcesPath, 'app-payload', 'CullSpace.exe');
  if (!fs.existsSync(payload)) {
    throw new Error(`Missing payload app at ${payload}. Build installer first.`);
  }

  const installDir = path.join(os.tmpdir(), `cullspace-smoke-install-${process.pid}`);
  fs.rmSync(installDir, { recursive: true, force: true });

  const result = await installApp({
    resourcesPath,
    installDir,
    onProgress: (p) => process.stdout.write(`\r${p.percent}% ${p.message || ''}`.padEnd(80)),
  });
  process.stdout.write('\n');

  const helper = path.join(installDir, 'resources', 'helper', 'CullSpace.Helper.exe');
  if (!fs.existsSync(result.exePath)) throw new Error('exe missing after install');
  if (!fs.existsSync(helper)) throw new Error('helper missing after install');
  if (!fs.existsSync(path.join(installDir, 'Uninstall CullSpace.cmd'))) {
    throw new Error('uninstall cmd missing');
  }

  console.log('SMOKE OK: installer logic', {
    exe: result.exePath,
    helper,
    desktop: fs.existsSync(result.desktop),
    startMenu: fs.existsSync(result.startMenu),
  });

  // Cleanup smoke install + shortcuts created in real Desktop/Start Menu
  try {
    if (fs.existsSync(result.desktop)) fs.unlinkSync(result.desktop);
    if (fs.existsSync(result.startMenu)) fs.unlinkSync(result.startMenu);
    const uninstallLnk = path.join(
      process.env.APPDATA || '',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Uninstall CullSpace.lnk'
    );
    if (fs.existsSync(uninstallLnk)) fs.unlinkSync(uninstallLnk);
  } catch {
    // ignore
  }
  fs.rmSync(installDir, { recursive: true, force: true });
})().catch((err) => {
  console.error('SMOKE FAIL:', err.message || err);
  process.exit(1);
});
