/**
 * Per-channel mean and sigma of a centre crop, for the scan.
 *
 * The scan already reads a 512x512 mosaic out of every frame to decide whether
 * it is dark, flat or clipped. Splitting that crop into its four CFA positions
 * costs one more pass over a quarter of a megapixel and answers a question the
 * whole-mosaic numbers cannot: whether an exposure SATURATED.
 *
 * Saturation has two signatures and they fail in opposite directions.
 * `clipFrac` counts pixels at the vendor's stated maximum, which is exact when
 * that number is right and silent when it is not. Sigma collapsing towards
 * zero is a property of the pixels themselves -- a channel pinned at its
 * ceiling has no noise left -- and needs no metadata to be believed. Both are
 * recorded so neither has to be trusted alone.
 */

/** Cell order (0,0) (0,1) (1,0) (1,1), the same split the analysis uses. */
export const centreChannelStats = (data, size, maximum) => {
  const half = size >> 1;
  const n = half * half;
  const sum = [0, 0, 0, 0];
  const sumSq = [0, 0, 0, 0];
  const clipped = [0, 0, 0, 0];

  for (let y = 0; y < size; y++) {
    const row = y * size;
    const top = (y & 1) * 2;
    for (let x = 0; x < size; x++) {
      const value = data[row + x];
      const c = top + (x & 1);
      sum[c] += value;
      sumSq[c] += value * value;
      if (value >= maximum) clipped[c]++;
    }
  }

  return [0, 1, 2, 3].map((c) => {
    const mean = sum[c] / n;
    // Sums of squares, not two passes: this runs on every frame of a scan and
    // the values are integers well inside the range where it stays exact.
    const variance = Math.max(0, sumSq[c] / n - mean * mean);
    return { mean, sigma: Math.sqrt(variance), clipFrac: clipped[c] / n };
  });
};
