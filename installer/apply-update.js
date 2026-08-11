/**
 * Detached apply helper for silent updates.
 * Usage (Node): node apply-update.js --staging-dir=... --install-dir=... [--launch] [--wait-pid=N]
 * Usage (Electron Setup): CullSpaceSetup.exe --apply-update --staging-dir=... ...
 */
const { runDeferredApply } = require('./install');

function parseArgs(argv) {
  const opts = {
    stagingDir: null,
    installDir: null,
    launch: false,
    waitPid: null,
  };
  for (const raw of argv) {
    if (raw === '--launch') opts.launch = true;
    else if (raw.startsWith('--staging-dir=')) {
      opts.stagingDir = raw.slice('--staging-dir='.length).trim() || null;
    } else if (raw.startsWith('--install-dir=')) {
      opts.installDir = raw.slice('--install-dir='.length).trim() || null;
    } else if (raw.startsWith('--wait-pid=')) {
      const n = Number(raw.slice('--wait-pid='.length).trim());
      opts.waitPid = Number.isFinite(n) && n > 0 ? n : null;
    }
  }
  return opts;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.stagingDir || !opts.installDir) {
    console.error('apply-update requires --staging-dir and --install-dir');
    process.exit(2);
  }
  await runDeferredApply(opts);
  process.exit(0);
})().catch((err) => {
  console.error('apply-update failed:', err?.message || err);
  process.exit(1);
});
