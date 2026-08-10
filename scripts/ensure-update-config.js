/**
 * Writes update-config.json for packaging (gitignored).
 * Uses CULLSPACE_GH_TOKEN when present; otherwise empty token.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dest = path.join(root, 'update-config.json');
const token = (process.env.CULLSPACE_GH_TOKEN || '').trim();

fs.writeFileSync(
  dest,
  `${JSON.stringify(
    {
      githubToken: token,
    },
    null,
    2
  )}\n`,
  'utf8'
);

if (token) {
  console.log('Wrote update-config.json with GitHub token (for private release checks).');
} else {
  console.log(
    'Wrote update-config.json without token. Set CULLSPACE_GH_TOKEN before packaging for private-repo updates.'
  );
}
