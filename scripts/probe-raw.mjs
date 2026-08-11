/**
 * Open a RAW, print what the binding sees, and check it against itself.
 *
 *   node scripts/probe-raw.mjs <file.nef> [more files...]
 *
 * This is the end-to-end proof for the foundation: mosaic, EXIF, quantisation
 * step, and the CFA labelling. Everything above it depends on these being
 * right, and none of it is checkable once the numbers reach a CSV.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const native = require('../native/build/Release/libraw_binding.node');

const CROP = 512;

const stats = (data) => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  let acc = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const d = data[i] - mean;
    acc += d * d;
    if (data[i] < lo) lo = data[i];
    if (data[i] > hi) hi = data[i];
  }
  return { mean, std: Math.sqrt(acc / (data.length - 1)), lo, hi, n: data.length };
};

/** Split a mosaic crop into the four CFA positions. */
const splitCfa = (data, size) => {
  const half = size / 2;
  const out = [0, 1, 2, 3].map(() => new Uint16Array(half * half));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const q = (y & 1) * 2 + (x & 1);
      out[q][(y >> 1) * half + (x >> 1)] = data[y * size + x];
    }
  }
  return out;
};

const f = (v, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : String(v));

console.log(`LibRaw ${native.version}\n`);

for (const path of process.argv.slice(2)) {
  const t0 = performance.now();
  const bytes = readFileSync(path);
  const tRead = performance.now();

  const raw = new native.RawFile();
  raw.open(bytes);
  const tUnpack = performance.now();

  const m = raw.metadata();
  const crop = raw.centreCrop(CROP);
  const tCrop = performance.now();

  console.log('='.repeat(76));
  console.log(`${basename(path)}   ${(bytes.length / 1048576).toFixed(1)} MB`);
  console.log('='.repeat(76));
  console.log(`  ${m.make} ${m.model}   CFA ${m.cfaPattern}   colors=${m.colors}`);
  console.log(
    `  raw ${m.rawWidth}x${m.rawHeight}   visible ${m.width}x${m.height}   ` +
      `margins l=${m.leftMargin} t=${m.topMargin}`,
  );
  console.log(
    `  ISO ${m.iso}   ${m.shutter >= 1 ? m.shutter + 's' : '1/' + Math.round(1 / m.shutter) + 's'}` +
      `   f/${m.aperture}   ${m.focalLen}mm   ${m.lens || '(no lens tag)'}`,
  );
  console.log(
    `  black ${m.black}  cblack [${m.cblack.join(', ')}]` +
      `  pattern ${m.cblackPatternRows}x${m.cblackPatternCols}` +
      `  maximum ${m.maximum}`,
  );

  const q = m.quantisation;
  const impliedBits = Math.log2((q.maxCode + 1) / q.step);
  console.log(
    `  quantisation step ${q.step}   codes [${q.minCode}, ${q.maxCode}]   ` +
      `distinct sampled ${q.distinctSampled}   => about ${impliedBits.toFixed(1)} effective bits`,
  );
  if (q.step > 1) {
    console.log(
      `    step > 1 means the samples were scaled into a wider container. Sheppard's`,
    );
    console.log(
      `    correction uses q^2/12 = ${((q.step * q.step) / 12).toFixed(2)} DN^2, not 0.083.`,
    );
  }

  const curve = q.linearisationCurve;
  if (curve.isIdentity) {
    console.log(
      `  linearisation curve: identity (length ${curve.length}) — quantisation is uniform`,
    );
  } else {
    console.log(
      `  linearisation curve: NOT identity (length ${curve.length}) — the file is companded,`,
    );
    console.log(
      `    so the step grows with signal and no single q exists. value:localStep along the curve:`,
    );
    console.log(`      ${curve.ladder.map((p) => `${p.value}:${p.localStep}`).join('  ')}`);
    console.log(
      `    Sheppard's correction needs q(S) here. The declared compression must say lossy.`,
    );
  }

  console.log(
    `  timing: read ${(tRead - t0).toFixed(0)} ms   unpack ${(tUnpack - tRead).toFixed(0)} ms   ` +
      `crop+meta ${(tCrop - tUnpack).toFixed(0)} ms`,
  );

  const planes = splitCfa(crop.data, crop.size);
  console.log(`  centre ${CROP}x${CROP} mosaic at (${crop.x0}, ${crop.y0}), ` +
    `origin colour index ${crop.originColor}`);
  console.log(`      ${'pos'.padEnd(5)} ${'mean'.padStart(11)} ${'std'.padStart(9)} ` +
    `${'min'.padStart(7)} ${'max'.padStart(7)}   n`);
  planes.forEach((p, i) => {
    const s = stats(p);
    const pos = `(${i >> 1},${i & 1})`;
    console.log(
      `      ${pos.padEnd(5)} ${f(s.mean, 4).padStart(11)} ${f(s.std, 4).padStart(9)} ` +
        `${String(s.lo).padStart(7)} ${String(s.hi).padStart(7)}   ${s.n}`,
    );
  });

  // Independent check on the quantisation step: every code in the crop must be
  // a multiple of it, offset by the minimum.
  let ok = true;
  for (const p of planes) {
    for (let i = 0; i < p.length; i++) {
      if ((p[i] - q.minCode) % q.step !== 0) {
        ok = false;
        break;
      }
    }
    if (!ok) break;
  }
  console.log(`  step consistency over the crop: ${ok ? 'every code is a multiple' : 'FAILED'}`);

  raw.close();
  console.log();
}
