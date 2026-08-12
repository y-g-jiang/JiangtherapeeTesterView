import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { readExifShutter } from '../exifShutter.mjs';

/** Assemble a little-endian TIFF holding the entries given. */
const makeTiff = (entries) => {
  const head = Buffer.alloc(8);
  head.write('II', 0, 'ascii');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);

  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  ifd.writeUInt16LE(entries.length, 0);
  const pool = [];
  let poolOffset = 8 + ifd.length;

  entries.forEach((e, i) => {
    const p = 2 + i * 12;
    ifd.writeUInt16LE(e.tag, p);
    ifd.writeUInt16LE(e.type, p + 2);
    ifd.writeUInt32LE(1, p + 4);
    if (e.type === 5 || e.type === 10) {
      const v = Buffer.alloc(8);
      if (e.type === 10) {
        v.writeInt32LE(e.num, 0);
        v.writeInt32LE(e.den, 4);
      } else {
        v.writeUInt32LE(e.num, 0);
        v.writeUInt32LE(e.den, 4);
      }
      ifd.writeUInt32LE(poolOffset, p + 8);
      pool.push(v);
      poolOffset += 8;
    } else {
      ifd.writeUInt32LE(e.value, p + 8);
    }
  });

  return Buffer.concat([head, ifd, ...pool]);
};

describe('readExifShutter', () => {
  it('reads ExposureTime as the rational the camera stored', () => {
    // 10/2500 is what a real Nikon writes for 1/250. Keeping the rational
    // matters: through a float it comes back as 0.004000000189989805.
    const out = readExifShutter(makeTiff([{ tag: 0x829a, type: 5, num: 10, den: 2500 }]));
    expect(out.exposureTime).toEqual({ num: 10, den: 2500, seconds: 0.004 });
    expect(out.shutterSpeedValue).toBeNull();
    expect(out.disagreementStops).toBeNull();
  });

  it('converts ShutterSpeedValue out of APEX', () => {
    // APEX 8 is 1/256, which is the exact step a camera displays as 1/250.
    const out = readExifShutter(makeTiff([{ tag: 0x9201, type: 10, num: 8, den: 1 }]));
    expect(out.shutterSpeedValue.apex).toBe(8);
    expect(out.shutterSpeedValue.seconds).toBeCloseTo(1 / 256, 12);
  });

  it('reports how far the two fields disagree, in stops', () => {
    const out = readExifShutter(
      makeTiff([
        { tag: 0x829a, type: 5, num: 1, den: 250 },
        { tag: 0x9201, type: 10, num: 8, den: 1 },
      ]),
    );
    // 1/256 against 1/250 is 2.4% and about a thirtieth of a stop -- small,
    // and exactly the size of error that quietly accumulates along a ladder.
    expect(out.disagreementStops).toBeCloseTo(Math.log2(250 / 256), 9);
    expect(Math.abs(out.disagreementStops)).toBeLessThan(0.05);
  });

  it('follows the ExifIFD pointer', () => {
    /*
     * A real file puts ExposureTime in the Exif IFD, not IFD0, so the pointer
     * has to be followed. Every offset in TIFF is absolute from byte 0 --
     * embedding a standalone TIFF at a nonzero position does not work, because
     * its internal pointers would all be short by that amount.
     */
    const head = Buffer.alloc(8);
    head.write('II', 0, 'ascii');
    head.writeUInt16LE(42, 2);
    head.writeUInt32LE(8, 4);

    const ifd0Len = 2 + 12 + 4;
    const exifIfdAt = 8 + ifd0Len;
    const exifLen = 2 + 12 + 4;
    const valueAt = exifIfdAt + exifLen;

    const ifd0 = Buffer.alloc(ifd0Len);
    ifd0.writeUInt16LE(1, 0);
    ifd0.writeUInt16LE(0x8769, 2); // ExifIFDPointer
    ifd0.writeUInt16LE(4, 4); // LONG
    ifd0.writeUInt32LE(1, 6);
    ifd0.writeUInt32LE(exifIfdAt, 10);

    const exif = Buffer.alloc(exifLen);
    exif.writeUInt16LE(1, 0);
    exif.writeUInt16LE(0x829a, 2);
    exif.writeUInt16LE(5, 4); // RATIONAL
    exif.writeUInt32LE(1, 6);
    exif.writeUInt32LE(valueAt, 10);

    const value = Buffer.alloc(8);
    value.writeUInt32LE(1, 0);
    value.writeUInt32LE(4000, 4);

    const out = readExifShutter(Buffer.concat([head, ifd0, exif, value]));
    expect(out.exposureTime).toEqual({ num: 1, den: 4000, seconds: 1 / 4000 });
  });

  it('returns nulls rather than throwing on rubbish', () => {
    for (const buf of [
      Buffer.alloc(0),
      Buffer.from('not a tiff at all'),
      Buffer.alloc(64, 0xff),
    ]) {
      const out = readExifShutter(buf);
      expect(out.exposureTime).toBeNull();
      expect(out.shutterSpeedValue).toBeNull();
    }
  });

  it('matches the real files', () => {
    const cases = [
      ['C:/Users/bcm18/Downloads/csv/P2642019.RW2', 10, 2000],
      ['I:/hjc-50f5.6-VRon/DSC_7944.NEF', 10, 2500],
    ];
    for (const [path, num, den] of cases) {
      if (!existsSync(path)) continue;
      const out = readExifShutter(readFileSync(path));
      expect(out.exposureTime).toMatchObject({ num, den });
      // Neither body writes ShutterSpeedValue, which is itself worth pinning:
      // a record that assumed both fields exist would be wrong here.
      expect(out.shutterSpeedValue).toBeNull();
    }
  });
});
