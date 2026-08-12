import { describe, expect, it } from 'vitest';
import { shutterText } from '../shutterText.mjs';

describe('shutterText', () => {
  it('uses the reciprocal only when the reciprocal is that whole number', () => {
    expect(shutterText(1 / 200)).toBe('1/200s');
    expect(shutterText(1 / 8000)).toBe('1/8000s');
    // LibRaw's float for 1/250 is 0.004000000189989805, not exactly 1/250.
    expect(shutterText(0.004000000189989805)).toBe('1/250s');
  });

  it('does not round 0.625 s to 1/2 s', () => {
    // 1/1.6 rounds to 2, and printing "1/2s" misstates a real exposure by 25%
    // in the one place a reader checks it against their camera.
    expect(shutterText(0.625)).toBe('0.625s');
    expect(shutterText(0.4)).toBe('0.4s');
    expect(shutterText(1 / 1.6)).toBe('0.625s');
  });

  it('writes a second or more plainly', () => {
    expect(shutterText(1)).toBe('1s');
    expect(shutterText(3.200000047683716)).toBe('3.2s');
    expect(shutterText(10)).toBe('10s');
  });

  it('has something to say about nothing', () => {
    expect(shutterText(0)).toBe('—');
    expect(shutterText(undefined)).toBe('—');
  });
});
