import { describe, expect, it } from 'vitest';
import { writeDarkScalarCsv } from '../darkCsv.mjs';
import { writeIsoGainCsv, writePtcCsv } from '../entryCsv.mjs';

/**
 * These writers build the header row and the data rows in two separate places,
 * so the one mistake they can make is a column landing under the wrong name.
 * Nothing downstream would notice: every cell is a number.
 */

const META = {
  toolVersion: '0.1.0', librawVersion: '0.22.2', generated: '2026-08-12T00:00:00Z',
  camera: 'Panasonic DC-S5M2', cfaPattern: 'RGGB', adcStep: 1, curveIsIdentity: true,
  rawWidth: 6000, rawHeight: 4000, black: 128, maximum: 4095,
  cropW: 512, cropH: 512, planeW: 256, planeH: 256, cropSize: 512, planeSize: 256,
  clipSigma: 3.5, clipVarianceFactor: 0.9938884, window: 'hann', ladder: 'auto-shutter',
  iso: 100,
};

const channels = (measured) => [0, 1, 2, 3].map((color) => ({ color, measured }));

const rows = (csv) => {
  const lines = csv.trimEnd().split('\n').filter((l) => !l.startsWith('#'));
  return { header: lines[0].split(','), body: lines.slice(1).map((l) => l.split(',')) };
};

/** The header names a column; find what the first data row put under it. */
const cell = (csv, name) => {
  const { header, body } = rows(csv);
  const i = header.indexOf(name);
  expect(i, `no column named ${name}`).toBeGreaterThanOrEqual(0);
  for (const r of body) expect(r.length).toBe(header.length);
  return body[0][i];
};

const EXIF = {
  exposureTime: { num: 10, den: 2500, seconds: 0.004 },
  shutterSpeedValue: null,
  disagreementStops: null,
};

describe('the EXIF shutter columns line up with their headers', () => {
  it('dark scalars', () => {
    const csv = writeDarkScalarCsv(
      [{
        iso: 100, shutter: 0.004000000189989805, fileA: 'a.RW2', fileB: 'b.RW2',
        exifShutter: EXIF,
        channels: channels({
          n: 65536, blackA: 128.4, blackB: 128.3, stdA: 2.1, stdB: 2.2,
          stdAMasked: 2.05, stdDiffRaw: 3.0, stdDiffClipped: 2.95, diffMean: 0.01,
          rejected: 12,
        }),
      }],
      META,
    );
    expect(cell(csv, 'ShutterSec')).toBe('0.004000000189989805');
    expect(cell(csv, 'ExposureTimeExif')).toBe('10/2500');
    expect(cell(csv, 'ShutterApexExif')).toBe('');
    expect(cell(csv, 'BlackA')).toBe('128.4');
    expect(cell(csv, 'Rejected')).toBe('12');
  });

  it('ISO gain levels', () => {
    const csv = writeIsoGainCsv(
      [{
        iso: 200, shutter: 0.5, aperture: 5.6, shutterGroup: '0.500000', file: 'g.NEF',
        exifShutter: { ...EXIF, shutterSpeedValue: { num: 1, den: 1, apex: 1, seconds: 0.5 } },
        channels: channels({ n: 65536, mean: 1024.5, std: 9.1, clipFrac: 0 }),
      }],
      META,
    );
    expect(cell(csv, 'ShutterSec')).toBe('0.5');
    expect(cell(csv, 'ExposureTimeExif')).toBe('10/2500');
    expect(cell(csv, 'ShutterApexExif')).toBe('1/1');
    expect(cell(csv, 'Aperture')).toBe('5.6');
    expect(cell(csv, 'Mean')).toBe('1024.5');
  });

  it('PTC pairs', () => {
    const csv = writePtcCsv(
      [{
        iso: 100, shutter: 0.004000000189989805, aperture: 8, fileA: 'a.RW2', fileB: 'b.RW2',
        exifShutter: EXIF,
        channels: channels({
          n: 65536, meanA: 2000.1, meanB: 2000.2, stdA: 45.1, stdB: 45.2,
          stdAMasked: 45.0, stdDiffRaw: 63.7, stdDiffClipped: 63.5, diffMean: -0.1,
          rejected: 3, clipFrac: 0,
        }),
      }],
      META,
    );
    expect(cell(csv, 'ShutterSec')).toBe('0.004000000189989805');
    expect(cell(csv, 'ExposureTimeExif')).toBe('10/2500');
    expect(cell(csv, 'FileA')).toBe('a.RW2');
    expect(cell(csv, 'MeanA')).toBe('2000.1');
    expect(cell(csv, 'StdDiffClipped')).toBe('63.5');
  });

  it('leaves both cells empty when the camera wrote neither field', () => {
    const csv = writePtcCsv(
      [{
        iso: 100, shutter: 1, aperture: 8, fileA: 'a', fileB: 'b',
        exifShutter: null,
        channels: channels({ n: 4, meanA: 1, meanB: 1, stdA: 1, stdB: 1, stdAMasked: 1,
          stdDiffRaw: 1, stdDiffClipped: 1, diffMean: 0, rejected: 0, clipFrac: 0 }),
      }],
      META,
    );
    expect(cell(csv, 'ExposureTimeExif')).toBe('');
    expect(cell(csv, 'ShutterApexExif')).toBe('');
  });
});
