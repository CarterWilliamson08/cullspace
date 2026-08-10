/**
 * Build a classic multi-size Windows .ico from assets/icon.png
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('./png-lite');

const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'assets', 'icon.png');
const icoPath = process.argv[2] || path.join(root, 'assets', 'cullspace.ico');

if (!fs.existsSync(pngPath)) {
  console.error('Missing', pngPath);
  process.exit(1);
}

const src = PNG.decode(fs.readFileSync(pngPath));
const sizes = [16, 32, 48, 64, 128, 256];

function resizeNearest(srcPng, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.min(srcPng.width - 1, Math.floor((x / size) * srcPng.width));
      const sy = Math.min(srcPng.height - 1, Math.floor((y / size) * srcPng.height));
      const si = (sy * srcPng.width + sx) * 4;
      const di = (y * size + x) * 4;
      out[di] = srcPng.data[si];
      out[di + 1] = srcPng.data[si + 1];
      out[di + 2] = srcPng.data[si + 2];
      out[di + 3] = srcPng.data[si + 3];
    }
  }
  return { width: size, height: size, data: out };
}

const images = sizes.map((size) => {
  const resized = resizeNearest(src, size);
  return { size, pngBytes: PNG.encode(resized.width, resized.height, resized.data) };
});

const headerSize = 6 + 16 * images.length;
let offset = headerSize;
const dir = Buffer.alloc(headerSize);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2);
dir.writeUInt16LE(images.length, 4);

images.forEach((img, i) => {
  const o = 6 + i * 16;
  dir[o] = img.size >= 256 ? 0 : img.size;
  dir[o + 1] = img.size >= 256 ? 0 : img.size;
  dir[o + 2] = 0;
  dir[o + 3] = 0;
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(img.pngBytes.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += img.pngBytes.length;
});

const out = Buffer.concat([dir, ...images.map((i) => i.pngBytes)]);
fs.writeFileSync(icoPath, out);
// Keep legacy filename in sync too.
fs.writeFileSync(path.join(root, 'assets', 'icon.ico'), out);
console.log('Wrote', icoPath, out.length, 'bytes');
