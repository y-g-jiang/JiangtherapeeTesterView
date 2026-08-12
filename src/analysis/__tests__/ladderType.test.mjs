import { describe, expect, it } from 'vitest';
import { groupGainLadder } from '../isoGain.mjs';

/**
 * What kind of ladder a set is decides what its numbers depend on, and it is
 * written into the file. A paired group is one shutter carrying two ISOs: the
 * exposure time cancels out of the ratio. How many such groups there are
 * decides how far the chain reaches, not what kind of measurement it is.
 */
const frame = (name, iso, shutter) => ({
  name,
  path: `X:/${name}`,
  meta: {
    iso,
    shutter,
    aperture: 8,
    model: 'DC-S1RM2',
    timestamp: 0,
    centreAboveBlack: 2000,
    centreClipFrac: 0,
    quantisation: { step: 1, linearisationCurve: { isIdentity: true } },
  },
});

describe('ladder type', () => {
  it('calls a single shutter with two ISOs paired, not auto', () => {
    /*
     * This is what a supplementary shoot looks like when one ISO was missed:
     * two frames, one shutter, two ISOs. Calling it auto-shutter told the
     * analyst the result leaned on a nominal shutter time that had cancelled.
     */
    const out = groupGainLadder([frame('a.RW2', 80, 0.5), frame('b.RW2', 160, 0.5)]);
    expect(out.ladder).toBe('paired-shutter');
    expect(out.problems.some((p) => p.message.includes('自动快门'))).toBe(false);
  });

  it('calls one ISO per shutter auto', () => {
    const out = groupGainLadder([
      frame('a.RW2', 100, 0.5),
      frame('b.RW2', 200, 0.25),
      frame('c.RW2', 400, 0.125),
    ]);
    expect(out.ladder).toBe('auto-shutter');
    expect(out.problems.some((p) => p.message.includes('自动快门'))).toBe(true);
  });

  it('calls a set with both patterns mixed, and says so', () => {
    // The guide recommends shooting both. Labelling that as either one alone
    // would misdescribe half the file.
    const out = groupGainLadder([
      frame('a.RW2', 100, 0.5),
      frame('b.RW2', 200, 0.5),
      frame('c.RW2', 400, 0.125),
    ]);
    expect(out.ladder).toBe('mixed');
    expect(out.problems.some((p) => p.message.includes('两种拍法都有'))).toBe(true);
  });

  it('stays paired across many groups', () => {
    const out = groupGainLadder([
      frame('a.RW2', 100, 0.5),
      frame('b.RW2', 200, 0.5),
      frame('c.RW2', 200, 0.25),
      frame('d.RW2', 400, 0.25),
    ]);
    expect(out.ladder).toBe('paired-shutter');
  });
});
