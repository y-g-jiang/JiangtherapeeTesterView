import { Fft, hann } from './fft.mjs';

/**
 * Row- and column-averaged periodograms of a dense channel plane.
 *
 * Each row is transformed at its full length -- no segmentation, no padding --
 * and the power spectra are averaged over all rows. With two thousand rows the
 * averaging alone is variance reduction enough; Welch segmentation would only
 * throw away resolution.
 *
 * Hann by default. Removing the row mean kills DC, but low-frequency content
 * (amp glow in a dark frame, vignetting in a flat) leaks across the whole
 * spectrum unwindowed, and banding is exactly the narrowband thing that
 * leakage buries.
 */

/**
 * @param {Float64Array} plane row-major, width*height
 * @param {number} width
 * @param {number} height
 * @param {{ window?: 'hann' | 'none' }} [options]
 * @returns {{ h: Float64Array, v: Float64Array, rowsAveraged: number, colsAveraged: number }}
 */
export const rowColumnSpectra = (plane, width, height, options = {}) => {
  const useHann = (options.window ?? 'hann') === 'hann';

  const fftH = new Fft(width);
  const fftV = new Fft(height);
  const winH = useHann ? hann(width) : { w: null, sumSq: width };
  const winV = useHann ? hann(height) : { w: null, sumSq: height };

  const binsH = (width >> 1) + 1;
  const binsV = (height >> 1) + 1;
  const accH = new Float64Array(binsH);
  const accV = new Float64Array(binsV);

  const bufH = new Float64Array(width);
  const bufV = new Float64Array(height);

  // The reference these spectra must integrate back to. A row periodogram
  // measures the variance *within* a row, after that row's own mean is
  // removed -- not the variance of the whole plane, which also carries the
  // row-to-row spread. Comparing against the wrong one makes a correct
  // spectrum look broken (and can hide a real normalisation slip).
  let withinRowVar = 0;
  let withinColVar = 0;

  // --- horizontal: one transform per row ---
  for (let y = 0; y < height; y++) {
    const off = y * width;
    let sum = 0;
    for (let x = 0; x < width; x++) sum += plane[off + x];
    const mean = sum / width;
    let acc = 0;
    if (winH.w) {
      for (let x = 0; x < width; x++) {
        const d = plane[off + x] - mean;
        acc += d * d;
        bufH[x] = d * winH.w[x];
      }
    } else {
      for (let x = 0; x < width; x++) {
        const d = plane[off + x] - mean;
        acc += d * d;
        bufH[x] = d;
      }
    }
    withinRowVar += acc / width;
    fftH.forwardReal(bufH);
    const { re, im } = fftH;
    for (let k = 0; k < binsH; k++) accH[k] += re[k] * re[k] + im[k] * im[k];
  }

  // --- vertical: one transform per column ---
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) sum += plane[y * width + x];
    const mean = sum / height;
    let acc = 0;
    if (winV.w) {
      for (let y = 0; y < height; y++) {
        const d = plane[y * width + x] - mean;
        acc += d * d;
        bufV[y] = d * winV.w[y];
      }
    } else {
      for (let y = 0; y < height; y++) {
        const d = plane[y * width + x] - mean;
        acc += d * d;
        bufV[y] = d;
      }
    }
    withinColVar += acc / height;
    fftV.forwardReal(bufV);
    const { re, im } = fftV;
    for (let k = 0; k < binsV; k++) accV[k] += re[k] * re[k] + im[k] * im[k];
  }

  /*
   * Parseval gives sum_k |Y(k)|^2 = N * sum_n y(n)^2 over all N bins, so with
   * y = (x - mean) * w the estimator that integrates back to the variance is
   *
   *     P(k) = mean_over_rows( |Y(k)|^2 ) / (N * sum(w^2))
   *
   * The N was missing before, which put every value out by a factor of the
   * transform length.
   */
  const normH = 1 / (winH.sumSq * height * width);
  const normV = 1 / (winV.sumSq * width * height);
  for (let k = 0; k < binsH; k++) accH[k] *= normH;
  for (let k = 0; k < binsV; k++) accV[k] *= normV;

  return {
    h: accH,
    v: accV,
    rowsAveraged: height,
    colsAveraged: width,
    withinRowVar: withinRowVar / height,
    withinColVar: withinColVar / width,
  };
};

/**
 * Parseval check: the summed one-sided power should equal the signal's
 * variance. It is the cheapest way to catch a normalisation slip, and a
 * normalisation slip is invisible in a plot.
 */
export const spectrumPowerSum = (spectrum, n) => {
  let total = spectrum[0];
  const last = n % 2 === 0 ? spectrum.length - 1 : -1;
  for (let k = 1; k < spectrum.length; k++) {
    total += k === last ? spectrum[k] : 2 * spectrum[k];
  }
  return total;
};
