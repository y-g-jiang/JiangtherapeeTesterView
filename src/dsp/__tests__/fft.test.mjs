import { describe, expect, it } from 'vitest';
import { Fft, hann } from '../fft.mjs';
import { rowColumnSpectra, spectrumPowerSum } from '../spectrum.mjs';

/** Reference DFT, O(n^2), for lengths small enough to brute force. */
const naiveDft = (x) => {
  const n = x.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const a = (-2 * Math.PI * k * t) / n;
      sr += x[t] * Math.cos(a);
      si += x[t] * Math.sin(a);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
};

const rng = (seed) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff - 0.5;
};

describe('Fft', () => {
  it('matches a brute-force DFT at a power of two', () => {
    const r = rng(1);
    const x = Float64Array.from({ length: 64 }, r);
    const fft = new Fft(64);
    fft.forwardReal(x);
    const ref = naiveDft(x);
    for (let k = 0; k < 64; k++) {
      expect(fft.re[k]).toBeCloseTo(ref.re[k], 9);
      expect(fft.im[k]).toBeCloseTo(ref.im[k], 9);
    }
  });

  it('matches a brute-force DFT at awkward lengths, via Bluestein', () => {
    // 59 and 101 are prime; 2950 is the real per-channel row length of a
    // 5900-wide crop and factors as 2 * 5^2 * 59.
    for (const n of [3, 7, 59, 101, 150]) {
      const r = rng(n);
      const x = Float64Array.from({ length: n }, r);
      const fft = new Fft(n);
      expect(fft.mode).toBe('bluestein');
      fft.forwardReal(x);
      const ref = naiveDft(x);
      for (let k = 0; k < n; k++) {
        expect(fft.re[k]).toBeCloseTo(ref.re[k], 8);
        expect(fft.im[k]).toBeCloseTo(ref.im[k], 8);
      }
    }
  });

  it('is exact, not a zero-padded approximation', () => {
    // A tone at exactly bin 7 of a 59-point transform must land in bin 7 with
    // nothing anywhere else. Zero-padding to 64 would smear it across bins.
    const n = 59;
    const x = Float64Array.from({ length: n }, (_, t) =>
      Math.cos((2 * Math.PI * 7 * t) / n),
    );
    const fft = new Fft(n);
    fft.forwardReal(x);
    const power = Array.from({ length: n }, (_, k) => fft.re[k] ** 2 + fft.im[k] ** 2);
    const inBin = power[7] + power[n - 7];
    const total = power.reduce((a, b) => a + b, 0);
    expect(inBin / total).toBeGreaterThan(0.999999);
  });
});

describe('rowColumnSpectra', () => {
  const makePlane = (w, h, seed) => {
    const r = rng(seed);
    const p = new Float64Array(w * h);
    for (let i = 0; i < p.length; i++) p[i] = 100 + 5 * r();
    return p;
  };

  it('satisfies Parseval exactly with a rectangular window', () => {
    // This is an algebraic identity, not a statistical one: it must hold to
    // floating-point precision for any data whatsoever. It is the invariant
    // that catches a normalisation slip, which is otherwise invisible.
    for (const [w, h] of [
      [64, 32],
      [59, 41],
      [150, 98],
    ]) {
      const plane = makePlane(w, h, w + h);
      const s = rowColumnSpectra(plane, w, h, { window: 'none' });
      expect(spectrumPowerSum(s.h, w) / s.withinRowVar).toBeCloseTo(1, 10);
      expect(spectrumPowerSum(s.v, h) / s.withinColVar).toBeCloseTo(1, 10);
    }
  });

  it('recovers the variance of white noise as a flat spectrum', () => {
    const w = 128;
    const h = 96;
    const plane = makePlane(w, h, 7);
    const s = rowColumnSpectra(plane, w, h, { window: 'none' });
    const interior = Array.from(s.h.slice(1, s.h.length - 1));
    const mean = interior.reduce((a, b) => a + b, 0) / interior.length;
    // Flat to within the scatter of a periodogram averaged over 96 rows.
    const rel = interior.map((v) => Math.abs(v / mean - 1));
    rel.sort((a, b) => a - b);
    expect(rel[Math.floor(rel.length / 2)]).toBeLessThan(0.15);
  });

  it('puts a planted stripe in the bin it belongs to', () => {
    // A vertical stripe pattern is a tone along the row, so it lands in the
    // horizontal spectrum and leaves the vertical one alone.
    const w = 120;
    const h = 80;
    const plane = makePlane(w, h, 3);
    const k = 9;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        plane[y * w + x] += 20 * Math.cos((2 * Math.PI * k * x) / w);
      }
    }
    const s = rowColumnSpectra(plane, w, h, { window: 'none' });
    const peak = s.h.indexOf(Math.max(...s.h));
    expect(peak).toBe(k);
    // The vertical spectrum should not have grown a peak of its own.
    const vSorted = [...s.v].sort((a, b) => b - a);
    expect(vSorted[0] / vSorted[Math.floor(vSorted.length / 2)]).toBeLessThan(12);
  });

  it('reports how much variance is line-to-line rather than within a line', () => {
    const w = 100;
    const h = 100;
    const plane = makePlane(w, h, 11);
    // Give every row its own offset. That variance is invisible to a row
    // periodogram, which removes each row's mean before transforming.
    const r = rng(99);
    for (let y = 0; y < h; y++) {
      const off = 30 * r();
      for (let x = 0; x < w; x++) plane[y * w + x] += off;
    }
    const s = rowColumnSpectra(plane, w, h, { window: 'none' });

    let sum = 0;
    for (let i = 0; i < plane.length; i++) sum += plane[i];
    const mean = sum / plane.length;
    let total = 0;
    for (let i = 0; i < plane.length; i++) total += (plane[i] - mean) ** 2;
    const planeVar = total / (plane.length - 1);

    // Row offsets dominate, so the within-row variance is a small share of it.
    expect(s.withinRowVar / planeVar).toBeLessThan(0.5);
    // Columns, on the other hand, carry the offsets, so removing a column mean
    // leaves them behind and the within-column variance stays large.
    expect(s.withinColVar / planeVar).toBeGreaterThan(0.5);
  });
});

describe('hann', () => {
  it('reports the sum of squares the PSD normalisation needs', () => {
    const { w, sumSq } = hann(1000);
    let s = 0;
    for (const v of w) s += v * v;
    expect(sumSq).toBeCloseTo(s, 9);
    // Hann's noise-equivalent factor is 3/8 of the length.
    expect(sumSq / 1000).toBeCloseTo(0.375, 2);
  });
});
