/**
 * A shutter time as a photographer writes it.
 *
 * Reciprocal form only when the reciprocal really is that whole number:
 * 0.625 s is 1/1.6, and rounding that to "1/2s" misstates the exposure by 25%
 * in the one place a reader would check it against their camera.
 */
export const shutterText = (t) => {
  if (!(t > 0)) return '—';
  if (t >= 1) return `${Number(t.toFixed(3))}s`;
  const inverse = 1 / t;
  const whole = Math.round(inverse);
  if (whole >= 2 && Math.abs(inverse - whole) < 0.02 * inverse) return `1/${whole}s`;
  return `${Number(t.toPrecision(3))}s`;
};
