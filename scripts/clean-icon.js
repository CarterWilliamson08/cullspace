/**
 * Make logo background fully transparent.
 * Keeps green/teal body + enclosed white crescent; removes white/black plates and halos.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('./png-lite');

const root = path.join(__dirname, '..');
const input =
  process.argv[2] ||
  path.join(root, 'assets', 'icon-source.png');
const output = process.argv[3] || path.join(root, 'assets', 'icon.png');

if (!fs.existsSync(input)) {
  // fallback to existing icon.png
  if (!fs.existsSync(path.join(root, 'assets', 'icon.png'))) {
    throw new Error('No icon source found');
  }
}

const srcPath = fs.existsSync(input) ? input : path.join(root, 'assets', 'icon.png');
const { width, height, data } = PNG.decode(fs.readFileSync(srcPath));

function at(x, y) {
  return (y * width + x) * 4;
}

function isGreen(i) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const a = data[i + 3];
  return a > 20 && g > 80 && g >= r + 8 && g >= b - 20;
}

function isBackgroundCandidate(i) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const a = data[i + 3];
  if (a < 8) return true;
  if (isGreen(i)) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  // white / gray / black plates
  if (max <= 40) return true; // near black
  if (max >= 185 && sat <= 0.22) return true; // near white/gray
  // checkerboard-ish mid grays with no chroma
  if (sat <= 0.08 && max >= 90 && max <= 210) return true;
  return false;
}

function clear(i) {
  data[i] = 0;
  data[i + 1] = 0;
  data[i + 2] = 0;
  data[i + 3] = 0;
}

const visited = new Uint8Array(width * height);
const queue = [];

function push(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const p = y * width + x;
  if (visited[p]) return;
  const i = p * 4;
  if (!isBackgroundCandidate(i)) return;
  visited[p] = 1;
  queue.push(p);
}

for (let x = 0; x < width; x += 1) {
  push(x, 0);
  push(x, height - 1);
}
for (let y = 0; y < height; y += 1) {
  push(0, y);
  push(width - 1, y);
}

while (queue.length) {
  const p = queue.pop();
  const x = p % width;
  const y = (p / width) | 0;
  clear(p * 4);
  push(x + 1, y);
  push(x - 1, y);
  push(x, y + 1);
  push(x, y - 1);
}

// Erode white/gray halo around the logo silhouette.
for (let pass = 0; pass < 4; pass += 1) {
  const toClear = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = at(x, y);
      if (data[i + 3] < 8 || isGreen(i)) continue;
      if (!isBackgroundCandidate(i)) continue;
      let greenN = 0;
      let clearN = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            clearN += 1;
            continue;
          }
          const ni = at(nx, ny);
          if (data[ni + 3] < 8) clearN += 1;
          else if (isGreen(ni)) greenN += 1;
        }
      }
      // Keep enclosed crescent whites (lots of green nearby, little empty space).
      if (clearN >= 2 && greenN < 6) toClear.push(i);
    }
  }
  for (const i of toClear) clear(i);
}

// Soft-trim semi-opaque fringe on the outer edge of greens touching transparency.
for (let y = 1; y < height - 1; y += 1) {
  for (let x = 1; x < width - 1; x += 1) {
    const i = at(x, y);
    if (!isGreen(i)) continue;
    let clearN = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const ni = at(x + dx, y + dy);
        if (data[ni + 3] < 8) clearN += 1;
      }
    }
    if (clearN >= 4 && data[i + 3] < 180) clear(i);
  }
}

fs.writeFileSync(output, PNG.encode(width, height, data));

// Also copy into renderer for reliable UI loading.
const rendererCopy = path.join(root, 'src', 'renderer', 'icon.png');
fs.copyFileSync(output, rendererCopy);
console.log('Wrote', output);
console.log('Wrote', rendererCopy);
