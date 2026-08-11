/**
 * Smoke: confirm UI copy/checks require typing DELETE (not file/app names).
 */
const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '..', 'src', 'renderer', 'renderer.js');
const src = fs.readFileSync(jsPath, 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const deleteChecks = [...src.matchAll(/typed\s*!==\s*'DELETE'/g)];
assert(deleteChecks.length >= 3, `expected >=3 DELETE checks, found ${deleteChecks.length}`);

assert(!/typed\s*!==\s*file\.name/.test(src), 'file.name confirm still present');
assert(!/typed\s*!==\s*app\.name/.test(src), 'app.name confirm still present');
assert(!/typed\s*!==\s*`CLEAN \$\{app\.name\}`/.test(src), 'CLEAN app.name confirm still present');

const deleteCopy =
  (src.match(/Type <strong>DELETE<\/strong> to confirm/g) || []).length +
  (src.match(/Type DELETE to confirm/g) || []).length;
assert(deleteCopy >= 3, `expected DELETE copy in modals, found ${deleteCopy}`);
assert(!/\balert\s*\(/.test(src), 'renderer still uses alert() for confirms');
assert(src.includes('setConfirmError'), 'inline confirm errors missing');
assert(src.includes("e.key !== 'Escape'") || src.includes('e.key === \'Escape\''), 'Escape handler missing');

console.log('SMOKE OK: delete confirms require DELETE', {
  checks: deleteChecks.length,
  copyBlocks: deleteCopy,
});
