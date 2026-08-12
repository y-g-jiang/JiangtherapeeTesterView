import { describe, expect, it } from 'vitest';
import { writePtcCsv } from '../entryCsv.mjs';
import { blackLevelFor, blackLevelsByIso, mergeBlackLevels } from '../../analysis/blackLevels.mjs';

/**
 * The PTC table is the one file another program has to read, so its shape is a
 * contract rather than a preference. ptc-compare finds channels by column name
 * and refuses a file with no #BlackLevel at all.
 */

const META = {
  toolVersion: '0.1.0', librawVersion: '0.22.2', generated: '2026-08-12T00:00:00Z',
  camera: 'Panasonic DC-S5M2', imageWidth: 6000, imageHeight: 4000,
  cfaPattern: 'RGBG', adcStep: 1, curveIsIdentity: true,
  rawWidth: 6008, rawHeight: 4008, black: 512, maximum: 16319,
  cropSize: 512, planeSize: 256, iso: 100, clipSigma: 3.5, clipVarianceFactor: 0.9938884,
};

const measured = (mean) => ({
  n: 65536, meanA: mean, meanB: mean + 0.1, stdA: mean / 40, stdB: mean / 40 + 0.1,
  stdAMasked: mean / 41, stdDiffRaw: mean / 28, stdDiffClipped: mean / 29,
  diffMean: -0.1, rejected: 3, clipFrac: 0,
});

/** Levels chosen so each colour is identifiable by its value. */
const pair = (channels) => ({
  iso: 100, shutter: 0.01, aperture: 8, fileA: 'A.RW2', fileB: 'B.RW2', channels,
});

const RGGB = [
  { color: 0, measured: measured(1000) },
  { color: 1, measured: measured(2000) },
  { color: 3, measured: measured(3000) },
  { color: 2, measured: measured(4000) },
];

const table = (csv) => {
  const lines = csv.trimEnd().split('\n');
  const header = lines.find((l) => !l.startsWith('#')).split(',');
  const body = lines.filter((l) => !l.startsWith('#')).slice(1).map((l) => l.split(','));
  const at = (row, name) => row[header.indexOf(name)];
  return { header, body, at, meta: lines.filter((l) => l.startsWith('#')) };
};

describe('writePtcCsv', () => {
  it('is one row per exposure, four channels across', () => {
    const csv = writePtcCsv([pair(RGGB), { ...pair(RGGB), shutter: 0.02 }], META);
    const { header, body, at } = table(csv);

    expect(body.length).toBe(2);
    for (const row of body) expect(row.length).toBe(header.length);
    expect(at(body[0], 'ISO')).toBe('100');
    expect(at(body[0], 'N')).toBe('65536');
    expect(at(body[1], 'ShutterSec')).toBe('0.02');
  });

  it('names channels by colour, not by cell position', () => {
    /*
     * The cell order is what the crop hands over; the colour under each cell is
     * what the file has to be labelled with. On a body that is not RGGB these
     * two disagree, and labelling by position would put red under G1 with
     * nothing to show for it.
     */
    const GBRG = [
      { color: 1, measured: measured(2000) },
      { color: 2, measured: measured(4000) },
      { color: 0, measured: measured(1000) },
      { color: 3, measured: measured(3000) },
    ];
    for (const channels of [RGGB, GBRG]) {
      const { body, at } = table(writePtcCsv([pair(channels)], META));
      expect(at(body[0], 'R_Mean')).toBe('1000');
      expect(at(body[0], 'G1_Mean')).toBe('2000');
      expect(at(body[0], 'G2_Mean')).toBe('3000');
      expect(at(body[0], 'B_Mean')).toBe('4000');
    }
  });

  it('keeps every statistic the long form carried', () => {
    const { body, at } = table(writePtcCsv([pair(RGGB)], META));
    const m = measured(1000);
    expect(at(body[0], 'R_Std')).toBe(String(m.stdA));
    expect(at(body[0], 'R_MeanB')).toBe(String(m.meanB));
    expect(at(body[0], 'R_StdB')).toBe(String(m.stdB));
    expect(at(body[0], 'R_StdMasked')).toBe(String(m.stdAMasked));
    expect(at(body[0], 'R_StdDiff')).toBe(String(m.stdDiffRaw));
    expect(at(body[0], 'R_StdDiffClipped')).toBe(String(m.stdDiffClipped));
    expect(at(body[0], 'R_DiffOffset')).toBe(String(m.diffMean));
    expect(at(body[0], 'R_Rejected')).toBe('3');
    expect(at(body[0], 'R_ClipFrac')).toBe('0');
  });

  it('has no other column that could be mistaken for Mean or Std', () => {
    /*
     * The reader matches on a token: a column ending in "Mean" answers a search
     * for the mean, and whichever comes first wins. So no other column may end
     * that way -- this is why the difference's offset is not called DiffMean.
     */
    const { header } = table(writePtcCsv([pair(RGGB)], META));
    for (const name of header) {
      const tokens = name.toLowerCase().split('_');
      if (tokens.length < 2) continue;
      const tail = tokens[tokens.length - 1];
      if (tail === 'mean' || tail === 'std') {
        expect(['r_mean', 'g1_mean', 'g2_mean', 'b_mean', 'r_std', 'g1_std', 'g2_std', 'b_std'])
          .toContain(name.toLowerCase());
      }
    }
  });

  it('writes the black level it was given, and says where it came from', () => {
    const csv = writePtcCsv([pair(RGGB)], {
      ...META,
      blackLevel: [511.67, 511.54, 511.55, 511.69],
      blackLevelSource: 'dark set measured 2026-08-12',
    });
    expect(csv).toContain('#BlackLevel: 511.67,511.54,511.55,511.69');
    expect(csv).toContain('#BlackLevelSource: dark set measured 2026-08-12');
    expect(csv).not.toContain('#BlackLevelMissing');
  });

  it('says so loudly when there is none, rather than inventing one', () => {
    // A guessed black level would parse and be wrong by the amount guessed.
    const csv = writePtcCsv([pair(RGGB)], META);
    expect(csv).toContain('#BlackLevelMissing');
    expect(csv).not.toMatch(/^#BlackLevel:/m);
  });
});

describe('black levels from the dark set', () => {
  const darkResult = (iso, base) => ({
    iso,
    channels: [0, 1, 3, 2].map((color, i) => ({
      color,
      measured: { blackA: base + i / 100 },
    })),
  });

  it('collects them per ISO in interchange order', () => {
    const map = blackLevelsByIso([darkResult(100, 511), darkResult(640, 510)]);
    expect([...map.keys()]).toEqual([100, 640]);
    expect(map.get(100)).toEqual([511, 511.01, 511.02, 511.03]);
  });

  it('reorders a body whose cells are not RGGB', () => {
    const gbrg = {
      iso: 100,
      channels: [
        { color: 1, measured: { blackA: 2 } },
        { color: 2, measured: { blackA: 4 } },
        { color: 0, measured: { blackA: 1 } },
        { color: 3, measured: { blackA: 3 } },
      ],
    };
    expect(blackLevelsByIso([gbrg]).get(100)).toEqual([1, 2, 3, 4]);
  });

  it('drops an ISO it cannot fill completely', () => {
    // Three of four would still parse downstream, and be wrong in one channel.
    const partial = { iso: 100, channels: [{ color: 0, measured: { blackA: 511 } }] };
    expect(blackLevelsByIso([partial]).size).toBe(0);
    expect(blackLevelsByIso([{ iso: 100, failed: 'boom' }]).size).toBe(0);
  });

  it('merges a new run without losing ISOs it did not cover', () => {
    const first = mergeBlackLevels(null, blackLevelsByIso([darkResult(100, 511)]), {
      camera: 'X', measuredAt: '2026-08-01',
    });
    const second = mergeBlackLevels(first, blackLevelsByIso([darkResult(640, 510)]), {
      measuredAt: '2026-08-12',
    });
    expect(Object.keys(second.isos).sort()).toEqual(['100', '640']);
    expect(second.camera).toBe('X');
    expect(second.measuredAt).toBe('2026-08-12');
  });

  it('lets a re-measured ISO replace the older one', () => {
    const first = mergeBlackLevels(null, blackLevelsByIso([darkResult(100, 511)]));
    const second = mergeBlackLevels(first, blackLevelsByIso([darkResult(100, 509)]));
    expect(blackLevelFor(second, 100)[0]).toBe(509);
  });

  it('returns null for an ISO that was never shot dark', () => {
    const store = mergeBlackLevels(null, blackLevelsByIso([darkResult(100, 511)]));
    expect(blackLevelFor(store, 6400)).toBeNull();
    expect(blackLevelFor(null, 100)).toBeNull();
  });
});
