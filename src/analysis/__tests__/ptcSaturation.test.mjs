import { describe, expect, it } from 'vitest';
import { groupPtcPairs } from '../ptcPair.mjs';

/**
 * A photon transfer curve with no saturated frame has no top. Full well goes
 * unmeasured and the fitted saturation point silently becomes "whatever the
 * brightest frame happened to be" -- a curve that looks entirely healthy and
 * is simply shorter than the sensor.
 */
const MAX = 16383;

/**
 * @param mean   level of the brightest channel
 * @param sigma  its noise; the other three are scaled down from it
 * @param clip   clipped fraction in the brightest channel
 */
const frame = (name, { iso = 100, shutter = 0.01, mean, sigma, clip = 0 }) => ({
  name,
  path: `X:/${name}`,
  meta: {
    iso,
    shutter,
    aperture: 8,
    model: 'DC-S5M2',
    timestamp: 0,
    maximum: MAX,
    centreChannels: [
      { mean: mean * 0.6, sigma: sigma * 0.7, clipFrac: 0 },
      { mean, sigma, clipFrac: clip },
      { mean, sigma, clipFrac: clip },
      { mean: mean * 0.7, sigma: sigma * 0.8, clipFrac: 0 },
    ],
  },
});

/** A ladder of pairs; shot noise, so sigma grows as the root of the level. */
const ladder = (levels, extra = []) => {
  const frames = [];
  levels.forEach((level, i) => {
    for (const half of [0, 1]) {
      frames.push(
        frame(`L${String(i).padStart(2, '0')}-${half}.RW2`, {
          shutter: 0.0001 * (i + 1),
          mean: level,
          sigma: Math.sqrt(level) * 2,
        }),
      );
    }
  });
  return [...frames, ...extra];
};

const notSaturated = (out) => out.problems.filter((p) => p.message.includes('没有一张过曝'));

describe('the saturated-frame check', () => {
  it('warns when the brightest frame is still climbing', () => {
    const out = groupPtcPairs(ladder([100, 400, 1600, 6400]));
    const warn = notSaturated(out);
    expect(warn.length).toBe(1);
    // 6400 of 16383.
    expect(warn[0].message).toContain('39%');
    expect(warn[0].message).toContain('至少有一个通道过曝');
  });

  it('says nothing once a channel clips', () => {
    // clipFrac on the green pair alone: one channel is the whole requirement.
    const out = groupPtcPairs(
      ladder(
        [100, 400, 1600, 6400],
        [
          frame('TOP-0.RW2', { shutter: 1, mean: 16000, sigma: 3, clip: 0.4 }),
          frame('TOP-1.RW2', { shutter: 1, mean: 16000, sigma: 3, clip: 0.4 }),
        ],
      ),
    );
    expect(notSaturated(out)).toEqual([]);
  });

  it('sees saturation from the sigma alone, with no clipFrac to help', () => {
    /*
     * The vendor maximum can be quoted too high, and then nothing ever counts
     * as clipped. A channel pinned at its ceiling has no noise left, and that
     * is visible without believing any metadata.
     */
    const out = groupPtcPairs(
      ladder(
        [100, 400, 1600, 6400],
        [
          frame('TOP-0.RW2', { shutter: 1, mean: 15000, sigma: 4, clip: 0 }),
          frame('TOP-1.RW2', { shutter: 1, mean: 15000, sigma: 4, clip: 0 }),
        ],
      ),
    );
    expect(notSaturated(out)).toEqual([]);
  });

  it('is not fooled by a bright frame that is merely noisy', () => {
    // Brighter and louder is the curve doing what it should, not saturation.
    const out = groupPtcPairs(ladder([100, 400, 1600, 6400, 12000]));
    expect(notSaturated(out).length).toBe(1);
  });

  it('checks each ISO on its own', () => {
    /*
     * Each ISO is fitted separately, so each one needs its own top. One ISO
     * shot properly must not vouch for another that was not.
     */
    const good = ladder([100, 1600]).map((f) => ({ ...f, meta: { ...f.meta, iso: 100 } }));
    good.push(
      ...[0, 1].map((i) => frame(`G-${i}.RW2`, { iso: 100, shutter: 1, mean: 16000, sigma: 3, clip: 0.5 })),
    );
    const bad = ladder([100, 1600]).map((f, i) => ({
      ...f,
      name: `b${i}.RW2`,
      meta: { ...f.meta, iso: 800 },
    }));

    const warn = notSaturated(groupPtcPairs([...good, ...bad]));
    expect(warn.length).toBe(1);
    expect(warn[0].message).toContain('ISO 800');
  });

  it('stays quiet when the scan carried no per-channel statistics', () => {
    // Older data, or a path that did not measure them: say nothing rather
    // than accuse a set on the strength of a missing field.
    const plain = ladder([100, 400]).map((f) => ({
      ...f,
      meta: { ...f.meta, centreChannels: undefined },
    }));
    expect(notSaturated(groupPtcPairs(plain))).toEqual([]);
  });
});
