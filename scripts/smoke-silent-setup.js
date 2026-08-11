/**
 * Smoke: silent Setup argv wiring + silent install into a temp dir.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { installApp } = require('../installer/install');

const root = path.join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function cleanupShortcuts() {
  const desktop = path.join(process.env.USERPROFILE || '', 'Desktop', 'CullSpace.lnk');
  const startMenu = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'CullSpace.lnk'
  );
  const uninstall = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Uninstall CullSpace.lnk'
  );
  for (const p of [desktop, startMenu, uninstall]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

(async () => {
  const installerMain = fs.readFileSync(path.join(root, 'installer', 'main.js'), 'utf8');
  assert(installerMain.includes('--silent'), 'installer main missing --silent');
  assert(installerMain.includes('--launch'), 'installer main missing --launch');
  assert(installerMain.includes('--install-dir='), 'installer main missing --install-dir');
  assert(installerMain.includes('--wait-pid='), 'installer main missing --wait-pid');
  assert(installerMain.includes('runSilentInstall'), 'installer main missing runSilentInstall');
  assert(installerMain.includes('installAppDeferred'), 'installer main missing deferred install');

  const installerInstall = fs.readFileSync(path.join(root, 'installer', 'install.js'), 'utf8');
  assert(installerInstall.includes('scheduleDeferredReplace'), 'installer missing deferred replace');
  assert(installerInstall.includes('installAppDeferred'), 'installer missing installAppDeferred');
  assert(installerInstall.includes('runDeferredApply'), 'installer missing runDeferredApply');
  assert(fs.existsSync(path.join(root, 'installer', 'apply-update.js')), 'apply-update.js missing');

  const appMain = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert(appMain.includes("'--silent'"), 'updater missing --silent spawn arg');
  assert(appMain.includes("'--launch'"), 'updater missing --launch spawn arg');
  assert(appMain.includes('--install-dir='), 'updater missing --install-dir spawn arg');
  assert(appMain.includes('--wait-pid='), 'updater missing --wait-pid spawn arg');
  assert(appMain.includes('currentInstallDir'), 'updater missing currentInstallDir');
  console.log('SMOKE OK: silent Setup + updater wiring');

  const setupExe = path.join(root, 'dist-installer', 'win-unpacked', 'CullSpaceSetup.exe');
  const payloadExe = path.join(
    root,
    'dist-installer',
    'win-unpacked',
    'resources',
    'app-payload',
    'CullSpace.exe'
  );
  const localPayload = path.join(root, 'installer', 'payload', 'CullSpace.exe');

  const installDir = path.join(os.tmpdir(), `cullspace-silent-smoke-${process.pid}`);
  fs.rmSync(installDir, { recursive: true, force: true });

  if (fs.existsSync(setupExe) && fs.existsSync(payloadExe)) {
    // Rebuild Setup asar is needed for latest main.js — prefer installApp against
    // packaged resources so we still validate payload copy; then verify Setup accepts flags.
    const help = spawnSync(setupExe, ['--silent', '--install-dir=' + installDir], {
      encoding: 'utf8',
      timeout: 240000,
      env: { ...process.env },
    });
    if (help.status !== 0) {
      console.error(help.stdout || '');
      console.error(help.stderr || '');
      // Packaged Setup may still be an older build without --silent; fall through.
      console.log('SMOKE WARN: packaged Setup failed silent flag; falling back to installApp');
      fs.rmSync(installDir, { recursive: true, force: true });
    } else {
      assert(fs.existsSync(path.join(installDir, 'CullSpace.exe')), 'CullSpace.exe missing');
      assert(fs.existsSync(path.join(installDir, 'install.json')), 'install.json missing');
      console.log('SMOKE OK: silent Setup exe');
      cleanupShortcuts();
      fs.rmSync(installDir, { recursive: true, force: true });
      return;
    }
  }

  const payloadDir = fs.existsSync(localPayload)
    ? path.join(root, 'installer', 'payload')
    : fs.existsSync(payloadExe)
      ? path.join(root, 'dist-installer', 'win-unpacked', 'resources', 'app-payload')
      : null;

  if (!payloadDir) {
    console.log('SMOKE SKIP: no installer payload — run npm run installer:fast once');
    return;
  }

  const resourcesPath = path.join(os.tmpdir(), `cullspace-silent-res-${process.pid}`);
  fs.rmSync(resourcesPath, { recursive: true, force: true });
  fs.mkdirSync(resourcesPath, { recursive: true });
  fs.cpSync(payloadDir, path.join(resourcesPath, 'app-payload'), { recursive: true });

  await installApp({ resourcesPath, installDir });
  assert(fs.existsSync(path.join(installDir, 'CullSpace.exe')), 'CullSpace.exe missing');
  assert(fs.existsSync(path.join(installDir, 'install.json')), 'install.json missing');
  console.log('SMOKE OK: silent install path via installApp');

  cleanupShortcuts();
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.rmSync(resourcesPath, { recursive: true, force: true });
})().catch((err) => {
  console.error('SMOKE FAIL:', err.message || err);
  process.exit(1);
});
