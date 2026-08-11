/**
 * Run entry 3's compute chain on one dark pair and print what it found.
 *
 *   node scripts/dark-pair.mjs <A.raw> <B.raw> [cropW] [cropH] [--no-spectra]
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createRequire } from 'node:module';
import { analyseDarkPair } from '../src/analysis/darkPair.mjs';

const require = createRequire(import.meta.url);
const native = require('../native/build/Release/libraw_binding.node');

const args = process.argv.slice(2);
const noSpectra = args.includes('--no-spectra');
const positional = args.filter((a) => !a.startsWith('--'));
const [pathA, pathB] = positional;
const cropW = Number(positional[2] ?? 5900);
const cropH = Number(positional[3] ?? 3900);

if (!pathA || !pathB) {
  console.error('usage: node scripts/dark-pair.mjs <A.raw> <B.raw> [cropW] [cropH] [--no-spectra]');
  process.exit(1);
}

const open = (p) => {
  const f = new native.RawFile();
  f.open(readFileSync(p));
  return f;
};

const t0 = performance.now();
const a = open(pathA);
const b = open(pathB);
const tOpen = performance.now();

const win = args.includes('--window=none') ? 'none' : 'hann';
const result = analyseDarkPair(a, b, { cropW, cropH, spectra: !noSpectra, window: win });
const tDone = performance.now();

const f = (v, d = 4) => (v === null || !Number.isFinite(v) ? '—' : v.toFixed(d));

console.log('='.repeat(84));
console.log(`${basename(pathA)}  /  ${basename(pathB)}`);
console.log('='.repeat(84));
console.log(`  ${result.camera}   ISO ${result.iso}   CFA ${result.cfaPattern}`);
console.log(
  `  crop ${cropW}x${cropH} mosaic -> ${result.channels[0].width}x${result.channels[0].height} per channel` +
    `   (${result.channels[0].n.toLocaleString()} samples)`,
);
console.log(
  `  quantisation step ${result.quantisationStep}` +
    `   curve ${result.curveIsIdentity ? 'identity' : 'COMPANDED'}` +
    `   LibRaw ${result.librawVersion}`,
);
console.log(
  `  clip k=${result.clip.sigma}, variance factor ${result.clip.varianceFactor.toFixed(6)}` +
    `  (measured std divided by its square root)`,
);
if (result.mismatches.length) {
  console.log('  !! 这一对不匹配:');
  for (const m of result.mismatches) console.log(`     ${m}`);
} else {
  console.log('  pair agrees on model, ISO, shutter, aperture, size, black level, step');
}
console.log();

console.log('  MEASURED — this is what the file carries. No correction is applied to it.');
console.log(
  `  ${'pos'.padEnd(6)} ${'BL(A)'.padStart(10)} ${'BL(B)'.padStart(10)} ` +
    `${'std A'.padStart(8)} ${'std B'.padStart(8)} ${'std D'.padStart(8)} ` +
    `${'std D 剪切后'.padStart(12)} ${'剔除'.padStart(8)}`,
);
for (const c of result.channels) {
  const m = c.measured;
  console.log(
    `  ${c.position.padEnd(6)} ${f(m.blackA).padStart(10)} ${f(m.blackB).padStart(10)} ` +
      `${f(m.stdA, 4).padStart(8)} ${f(m.stdB, 4).padStart(8)} ${f(m.stdDiffRaw, 4).padStart(8)} ` +
      `${f(m.stdDiffClipped, 4).padStart(12)} ${String(m.rejected).padStart(8)}`,
  );
}

console.log();
console.log('  DERIVED — screen only, not written out. Plain arithmetic on the row above,');
console.log('  shown so a bad pair is visible here rather than after it is mailed.');
console.log(
  `  ${'pos'.padEnd(6)} ${'时域RN'.padStart(10)} ${'FPN'.padStart(10)} ${'剔除比例'.padStart(10)}`,
);
for (const c of result.channels) {
  const d = c.derived;
  console.log(
    `  ${c.position.padEnd(6)} ${f(d.temporalStd).padStart(10)} ${f(d.fpnStd).padStart(10)} ` +
      `${(d.rejectedFrac * 100).toFixed(3).padStart(9)}%`,
  );
}
console.log(
  `    时域RN = std D 剪切后 / √2 / √${result.clip.varianceFactor.toFixed(6)}` +
    `   FPN² = std A(同掩码)² − std D 剪切后²/2`,
);

if (result.channels[0].spectra) {
  console.log();
  console.log('  Parseval check (summed one-sided power / within-line variance, must be 1.000):');
  console.log(
    `  ${'pos'.padEnd(6)} ${'single H'.padStart(10)} ${'single V'.padStart(10)} ` +
      `${'diff H'.padStart(10)} ${'diff V'.padStart(10)}   ${'bins H/V'.padStart(12)}`,
  );
  for (const c of result.channels) {
    const p = c.parseval;
    console.log(
      `  ${c.position.padEnd(6)} ${p.singleH.toFixed(5).padStart(10)} ${p.singleV.toFixed(5).padStart(10)} ` +
        `${p.diffH.toFixed(5).padStart(10)} ${p.diffV.toFixed(5).padStart(10)}   ` +
        `${`${c.spectra.single.h.length}/${c.spectra.single.v.length}`.padStart(12)}`,
    );
  }

  console.log();
  console.log('  Share of the single-frame variance that is line-to-line rather than');
  console.log('  within a line (a row periodogram is blind to it by construction):');
  for (const c of result.channels) {
    console.log(
      `  ${c.position.padEnd(6)} row-to-row ${(c.lineToLine.rowFraction * 100).toFixed(2).padStart(6)}%` +
        `    col-to-col ${(c.lineToLine.colFraction * 100).toFixed(2).padStart(6)}%`,
    );
  }

  // Where the difference spectrum sits relative to white, per octave band.
  console.log();
  console.log('  Difference spectrum, mean power per band, normalised to the whole-band mean');
  console.log('  (1.000 everywhere = white noise; a peak = structure at that frequency)');
  const bands = [
    [0.0, 0.01],
    [0.01, 0.05],
    [0.05, 0.15],
    [0.15, 0.3],
    [0.3, 0.5],
  ];
  const head = bands.map(([lo, hi]) => `${lo}-${hi}`.padStart(9)).join(' ');
  console.log(`  ${'pos/axis'.padEnd(12)} ${head}`);
  for (const c of result.channels) {
    for (const axis of ['h', 'v']) {
      const s = c.spectra.diff[axis];
      const total = s.reduce((acc, v, i) => acc + (i === 0 ? 0 : v), 0) / (s.length - 1);
      const row = bands
        .map(([lo, hi]) => {
          const a0 = Math.max(1, Math.round(lo * 2 * (s.length - 1)));
          const a1 = Math.round(hi * 2 * (s.length - 1));
          let sum = 0;
          let cnt = 0;
          for (let k = a0; k < a1 && k < s.length; k++) {
            sum += s[k];
            cnt++;
          }
          return (cnt ? sum / cnt / total : NaN).toFixed(3).padStart(9);
        })
        .join(' ');
      console.log(`  ${`${c.position} ${axis}`.padEnd(12)} ${row}`);
    }
  }
}

console.log();
console.log(
  `  timing: decode ${(tOpen - t0).toFixed(0)} ms   analysis ${(tDone - tOpen).toFixed(0)} ms`,
);

a.close();
b.close();
