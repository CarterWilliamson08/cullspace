/**
 * Smoke-test semver helpers and update check shape (network optional).
 */
const { checkForUpdates, parseSemver, compareSemver } = require('../src/updater');

const a = parseSemver('v1.0.0');
const b = parseSemver('0.9.9');
if (!a || !b || compareSemver(a, b) <= 0) {
  console.error('SMOKE FAIL: semver compare');
  process.exit(1);
}
if (parseSemver('CullSpace-Setup-1.2.3-x64.exe')?.raw !== '1.2.3') {
  console.error('SMOKE FAIL: asset semver parse');
  process.exit(1);
}

(async () => {
  // May fail without token/network; still validates return shape.
  const result = await checkForUpdates();
  if (!result || typeof result.updateAvailable !== 'boolean' || !result.currentVersion) {
    console.error('SMOKE FAIL: unexpected check result', result);
    process.exit(1);
  }
  console.log('SMOKE OK: updater', {
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    updateAvailable: result.updateAvailable,
    error: result.error || null,
    hasToken: result.hasToken ?? null,
  });
})().catch((err) => {
  console.error('SMOKE FAIL:', err.message || err);
  process.exit(1);
});
