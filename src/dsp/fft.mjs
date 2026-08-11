/**
 * Exact DFT for arbitrary lengths.
 *
 * Radix-2 where the length allows it; Bluestein (chirp-z) otherwise, which is
 * what makes an arbitrary window length exact rather than a zero-padded
 * approximation. Ported from the main project's utils/math.ts so both agree.
 *
 * The distinction that matters: Bluestein does pad its internal *convolution*
 * to a power of two, but the output is the exact N-point DFT. Padding the
 * signal itself would change the transform, which is the thing to avoid.
 */

const isPowerOfTwo = (n) => n > 0 && (n & (n - 1)) === 0;

class Radix2 {
  constructor(n) {
    if (!isPowerOfTwo(n)) throw new Error(`Radix2 needs a power of two, got ${n}`);
    this.n = n;
    this.levels = Math.log2(n) | 0;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < this.levels; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
  }

  /** In-place forward transform of the given real/imag pair. */
  transform(re, im) {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  }
}

export class Fft {
  /**
   * @param {number} n transform length, any positive integer
   */
  constructor(n) {
    if (!Number.isInteger(n) || n < 2) throw new Error(`Fft length must be >= 2, got ${n}`);
    this.n = n;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);

    if (isPowerOfTwo(n)) {
      this.mode = 'radix2';
      this.inner = new Radix2(n);
      return;
    }

    this.mode = 'bluestein';
    let m = 1;
    while (m < 2 * n - 1) m *= 2;
    this.m = m;
    this.inner = new Radix2(m);

    // chirp[k] = exp(-i pi k^2 / n), computed on k^2 mod 2n so the angle stays
    // small enough for the trig to keep its digits at large n.
    this.chirpRe = new Float64Array(n);
    this.chirpIm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i * i) % (2 * n);
      const angle = (Math.PI * j) / n;
      this.chirpRe[i] = Math.cos(angle);
      this.chirpIm[i] = -Math.sin(angle);
    }

    // B is the conjugate chirp, zero-padded and pre-transformed once.
    this.bRe = new Float64Array(m);
    this.bIm = new Float64Array(m);
    this.bRe[0] = this.chirpRe[0];
    this.bIm[0] = -this.chirpIm[0];
    for (let i = 1; i < n; i++) {
      this.bRe[i] = this.bRe[m - i] = this.chirpRe[i];
      this.bIm[i] = this.bIm[m - i] = -this.chirpIm[i];
    }
    this.inner.transform(this.bRe, this.bIm);

    this.aRe = new Float64Array(m);
    this.aIm = new Float64Array(m);
  }

  /**
   * Forward transform of a real signal. Results land in this.re / this.im.
   * @param {Float64Array|Float32Array} signal length n
   */
  forwardReal(signal) {
    const { n } = this;
    if (this.mode === 'radix2') {
      this.re.set(signal.subarray(0, n));
      this.im.fill(0);
      this.inner.transform(this.re, this.im);
      return;
    }

    const { m, aRe, aIm, chirpRe, chirpIm, bRe, bIm, inner } = this;
    aRe.fill(0);
    aIm.fill(0);
    for (let i = 0; i < n; i++) {
      const x = signal[i];
      aRe[i] = x * chirpRe[i];
      aIm[i] = x * chirpIm[i];
    }
    inner.transform(aRe, aIm);

    for (let i = 0; i < m; i++) {
      const ar = aRe[i];
      const ai = aIm[i];
      aRe[i] = ar * bRe[i] - ai * bIm[i];
      aIm[i] = ar * bIm[i] + ai * bRe[i];
    }

    // Inverse via conjugation, folded into the final chirp multiply.
    for (let i = 0; i < m; i++) aIm[i] = -aIm[i];
    inner.transform(aRe, aIm);

    const invM = 1 / m;
    for (let i = 0; i < n; i++) {
      const cr = aRe[i] * invM;
      const ci = -aIm[i] * invM;
      this.re[i] = cr * chirpRe[i] - ci * chirpIm[i];
      this.im[i] = cr * chirpIm[i] + ci * chirpRe[i];
    }
  }
}

/** Hann window and the sum of its squares, which is the PSD normaliser. */
export const hann = (n) => {
  const w = new Float64Array(n);
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    w[i] = v;
    sumSq += v * v;
  }
  return { w, sumSq };
};
