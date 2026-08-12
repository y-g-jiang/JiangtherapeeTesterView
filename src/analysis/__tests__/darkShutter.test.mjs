import { describe, expect, it } from 'vitest';
import { DARK_FAST_SHUTTER_SEC, groupDarkPairs } from '../pairing.mjs';

/**
 * A slow dark frame is a suspicion, not a fault. It says loudly and does not
 * refuse: a body cap that is genuinely opaque gives the same numbers at any
 * shutter speed, and demanding a reshoot on a suspicion costs more than it is
 * worth.
 */
const pair = (iso, shutter, extra = {}) =>
  [0, 1].map((i) => ({
    name: `iso${iso}-${i}.RW2`,
    path: `X:/iso${iso}-${i}.RW2`,
    meta: {
      iso,
      shutter,
      aperture: 0,
      model: 'DC-S5M2',
      timestamp: i,
      rawWidth: 6008,
      rawHeight: 4008,
      black: 512,
      centreAboveBlack: 0.01,
      quantisation: { step: 1, linearisationCurve: { isIdentity: true } },
      ...extra,
    },
  }));

const warningsOf = (result) => result.problems.filter((p) => p.level === 'warning');

describe('a dark set shot at a slow shutter', () => {
  it('is accepted, with a note, at 1/200', () => {
    const out = groupDarkPairs(pair(100, 1 / 200));
    expect(out.pairs.length).toBe(1);
    expect(out.rejected).toEqual([]);

    const note = warningsOf(out).find((p) => p.message.includes('最快快门'));
    expect(note).toBeDefined();
    expect(note.message).toContain('1/200s');
    // The reason has to be the one that matters. Dark current at 5 ms is a
    // hundredth of an electron; a light leak is proportional to the same 5 ms.
    expect(note.message).toContain('漏进来的光按曝光时间累积');
    expect(note.message).toContain('不必重拍');
    // 1/200 is twenty times the exposure of 1/4000.
    expect(note.message).toContain('20 倍');
  });

  it('says nothing at a genuinely fast shutter', () => {
    const out = groupDarkPairs(pair(100, 1 / 4000));
    expect(warningsOf(out).some((p) => p.message.includes('最快快门'))).toBe(false);
    expect(out.pairs[0].warnings).toEqual([]);
  });

  it('draws the line where the constant says', () => {
    const justFast = groupDarkPairs(pair(100, DARK_FAST_SHUTTER_SEC));
    const justSlow = groupDarkPairs(pair(100, DARK_FAST_SHUTTER_SEC * 1.5));
    expect(warningsOf(justFast).some((p) => p.message.includes('最快快门'))).toBe(false);
    expect(warningsOf(justSlow).some((p) => p.message.includes('最快快门'))).toBe(true);
  });

  it('counts how many of the set are slow, and names the worst', () => {
    // A mixed set: the summary must not read as though all of it were slow.
    const out = groupDarkPairs([
      ...pair(100, 1 / 4000),
      ...pair(200, 1 / 200),
      ...pair(400, 1 / 60),
    ]);
    const note = warningsOf(out).find((p) => p.message.includes('最快快门'));
    expect(note.message).toContain('2/3 对');
    expect(note.message).toContain('1/60s');
    expect(note.message).toContain('ISO 400');
    expect(note.message).not.toContain('全部');
  });

  it('marks the individual pairs too, so the table shows which', () => {
    const out = groupDarkPairs([...pair(100, 1 / 4000), ...pair(200, 1 / 200)]);
    expect(out.pairs[0].warnings).toEqual([]);
    expect(out.pairs[1].warnings.some((w) => w.message.includes('1/200s'))).toBe(true);
  });

  it('still refuses what it refused before', () => {
    // The new note must not soften a frame that is not dark at all.
    const out = groupDarkPairs(pair(100, 1 / 200, { centreAboveBlack: 40 }));
    expect(out.pairs).toEqual([]);
    expect(out.rejected[0].checks.some((c) => c.message.includes('这不是黑场'))).toBe(true);
  });
});
