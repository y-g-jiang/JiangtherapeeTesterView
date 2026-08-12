import { describe, expect, it } from 'vitest';
import { groupPtcPairs } from '../ptcPair.mjs';

/**
 * A PTC shoot is allowed to be untidy in two specific ways -- several pairs at
 * one shutter, several ISOs in one go -- and must still refuse to mix anything
 * that would change what the curve means.
 */
const frame = (name, { iso = 100, shutter = 0.01, aperture = 8, t = 0, model = 'DC-S5M2' } = {}) => ({
  name,
  path: `X:/${name}`,
  meta: { iso, shutter, aperture, timestamp: t, model },
});

const shutters = (pairs) => pairs.map((p) => p.shutter);

describe('groupPtcPairs', () => {
  it('pairs consecutive files at one shutter', () => {
    const { pairs, rejected, problems } = groupPtcPairs([
      frame('P001.RW2'), frame('P002.RW2'), frame('P003.RW2'), frame('P004.RW2'),
    ]);
    expect(rejected).toEqual([]);
    expect(pairs.map((p) => [p.a.name, p.b.name])).toEqual([
      ['P001.RW2', 'P002.RW2'],
      ['P003.RW2', 'P004.RW2'],
    ]);
    expect(problems.some((p) => p.message.includes('两两配对'))).toBe(true);
  });

  it('uses filename order, numerically, not string order', () => {
    /*
     * P264299 and P2642100 are consecutive frames on the same card. Sorted as
     * strings, "P2642100" comes before "P264299" and the pairing shifts by one
     * -- which pairs frames from different exposures and produces a difference
     * that is not a difference.
     */
    const { pairs } = groupPtcPairs([
      frame('P2642100.RW2'), frame('P264299.RW2'), frame('P264298.RW2'), frame('P2642101.RW2'),
    ]);
    expect(pairs.map((p) => [p.a.name, p.b.name])).toEqual([
      ['P264298.RW2', 'P264299.RW2'],
      ['P2642100.RW2', 'P2642101.RW2'],
    ]);
  });

  it('does not fall back on the timestamp', () => {
    // A body with a wrong clock still numbers its files in order.
    const { pairs } = groupPtcPairs([
      frame('A1.RW2', { t: 500 }), frame('A2.RW2', { t: 100 }),
      frame('A3.RW2', { t: 400 }), frame('A4.RW2', { t: 200 }),
    ]);
    expect(pairs.map((p) => [p.a.name, p.b.name])).toEqual([
      ['A1.RW2', 'A2.RW2'],
      ['A3.RW2', 'A4.RW2'],
    ]);
  });

  it('rejects only the odd frame out, keeping the pairs before it', () => {
    const { pairs, rejected } = groupPtcPairs([
      frame('A1.RW2'), frame('A2.RW2'), frame('A3.RW2'),
    ]);
    expect(pairs.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].files).toEqual(['A3.RW2']);
    expect(rejected[0].message).toContain('落了单');
  });

  it('keeps several ISOs apart instead of refusing them', () => {
    const frames = [];
    for (const iso of [100, 640, 6400]) {
      for (let i = 0; i < 4; i++) {
        frames.push(frame(`iso${iso}-${i}.RW2`, { iso, shutter: i < 2 ? 0.01 : 0.02 }));
      }
    }
    const { pairs, rejected, problems, isos } = groupPtcPairs(frames);
    expect(rejected).toEqual([]);
    expect(isos).toEqual([100, 640, 6400]);
    expect(pairs.length).toBe(6);
    for (const pair of pairs) {
      expect(pair.a.meta.iso).toBe(pair.iso);
      expect(pair.b.meta.iso).toBe(pair.iso);
    }
    expect(problems.some((p) => p.level === 'error')).toBe(false);
    expect(problems.some((p) => p.message.includes('各自存成一个 CSV'))).toBe(true);
  });

  it('never pairs across ISO or shutter', () => {
    // Same count as a valid set, but every frame is its own bucket.
    const { pairs, rejected } = groupPtcPairs([
      frame('A1.RW2', { iso: 100, shutter: 0.01 }),
      frame('A2.RW2', { iso: 200, shutter: 0.01 }),
      frame('A3.RW2', { iso: 100, shutter: 0.02 }),
      frame('A4.RW2', { iso: 200, shutter: 0.02 }),
    ]);
    expect(pairs).toEqual([]);
    expect(rejected.length).toBe(4);
  });

  it('counts exposure levels per ISO, not pairs', () => {
    /*
     * Twenty pairs all at one shutter is one point measured twenty times. The
     * three-parameter fit needs levels, so the warning must not be silenced by
     * repetition.
     */
    const frames = [];
    for (let i = 0; i < 40; i++) frames.push(frame(`A${String(i).padStart(3, '0')}.RW2`));
    const { pairs, problems } = groupPtcPairs(frames);
    expect(pairs.length).toBe(20);
    expect(problems.some((p) => p.message.includes('只有 1 个曝光级别'))).toBe(true);
  });

  it('warns per ISO, so a good ISO does not cover for a thin one', () => {
    const frames = [];
    for (let level = 0; level < 20; level++) {
      for (let i = 0; i < 2; i++) {
        frames.push(frame(`a-${level}-${i}.RW2`, { iso: 100, shutter: 0.001 * (level + 1) }));
      }
    }
    for (let level = 0; level < 3; level++) {
      for (let i = 0; i < 2; i++) {
        frames.push(frame(`b-${level}-${i}.RW2`, { iso: 800, shutter: 0.001 * (level + 1) }));
      }
    }
    const { problems } = groupPtcPairs(frames);
    const thin = problems.filter((p) => p.message.includes('曝光级别。三参数拟合'));
    expect(thin.length).toBe(1);
    expect(thin[0].message).toContain('ISO 800');
  });

  it('still refuses two bodies', () => {
    const { problems } = groupPtcPairs([
      frame('A1.RW2'), frame('A2.RW2', { model: 'Z f' }),
    ]);
    expect(problems.some((p) => p.level === 'error' && p.message.includes('机身'))).toBe(true);
  });

  it('rejects a pair whose aperture changed', () => {
    const { pairs, rejected } = groupPtcPairs([
      frame('A1.RW2', { aperture: 8 }), frame('A2.RW2', { aperture: 11 }),
    ]);
    expect(pairs).toEqual([]);
    expect(rejected[0].checks[0].message).toContain('光圈不一致');
  });

  it('orders pairs by ISO, then brightest exposure first', () => {
    const frames = [];
    for (const iso of [800, 100]) {
      for (const shutter of [0.001, 0.01]) {
        frames.push(frame(`i${iso}-s${shutter}-1.RW2`, { iso, shutter }));
        frames.push(frame(`i${iso}-s${shutter}-2.RW2`, { iso, shutter }));
      }
    }
    const { pairs } = groupPtcPairs(frames);
    expect(pairs.map((p) => p.iso)).toEqual([100, 100, 800, 800]);
    expect(shutters(pairs)).toEqual([0.01, 0.001, 0.01, 0.001]);
  });
});
