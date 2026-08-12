/**
 * Read the shutter fields straight out of the EXIF, as rationals.
 *
 * LibRaw resolves them into a single float, and which field it took depends on
 * the camera: ExposureTime normally, ShutterSpeedValue when that is absent, and
 * for several vendors a maker-note field instead -- Canon computes 2^(-i/32),
 * and one path reads a nanosecond counter. So the same column can hold the
 * camera's tidy nominal value on one body and its real measured one on another,
 * with nothing in the record to say which.
 *
 * On top of that, the float loses the rational. A file storing 10/2500 comes
 * back as 0.004000000189989805; that tail is float32 rounding, not information
 * from the camera.
 *
 * So both raw fields are recorded verbatim alongside LibRaw's resolved value,
 * and the analyst gets to see whether they agree. Same rule as everywhere else:
 * record, do not decide.
 */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const EXPOSURE_TIME = 0x829a;
const SHUTTER_SPEED_VALUE = 0x9201;
/** Pointers worth following: ExifIFD, SubIFDs, Interoperability. */
const POINTER_TAGS = new Set([0x8769, 0x014a, 0xa005]);

const walkIfd = (buf, offset, le, found, depth, visited) => {
  if (depth > 5 || offset <= 0 || offset + 2 > buf.length || visited.has(offset)) return;
  visited.add(offset);

  const rd16 = (p) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
  const rd32 = (p) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));
  const rds32 = (p) => (le ? buf.readInt32LE(p) : buf.readInt32BE(p));

  const count = rd16(offset);
  // A plausible IFD, not a random run of bytes that happened to look like one.
  if (count === 0 || count > 4096 || offset + 2 + count * 12 + 4 > buf.length) return;

  for (let i = 0; i < count; i++) {
    const p = offset + 2 + i * 12;
    const tag = rd16(p);
    const type = rd16(p + 2);
    const n = rd32(p + 4);
    const size = (TYPE_SIZE[type] ?? 0) * n;
    if (!size) continue;

    if (POINTER_TAGS.has(tag) && (type === 4 || type === 13)) {
      const many = size <= 4 ? [rd32(p + 8)] : [];
      if (size > 4) {
        const base = rd32(p + 8);
        for (let k = 0; k < Math.min(n, 8); k++) {
          if (base + k * 4 + 4 <= buf.length) many.push(rd32(base + k * 4));
        }
      }
      for (const child of many) walkIfd(buf, child, le, found, depth + 1, visited);
      continue;
    }

    if (tag !== EXPOSURE_TIME && tag !== SHUTTER_SPEED_VALUE) continue;
    if ((type !== 5 && type !== 10) || n < 1) continue;

    const at = size <= 4 ? p + 8 : rd32(p + 8);
    if (at + 8 > buf.length) continue;
    const num = type === 10 ? rds32(at) : rd32(at);
    const den = type === 10 ? rds32(at + 4) : rd32(at + 4);
    if (den === 0) continue;

    // The first IFD to carry a tag wins; later duplicates live in thumbnails
    // and previews, which describe the same exposure less precisely.
    if (tag === EXPOSURE_TIME && !found.exposureTime) {
      found.exposureTime = { num, den, seconds: num / den };
    } else if (tag === SHUTTER_SPEED_VALUE && !found.shutterSpeedValue) {
      const apex = num / den;
      found.shutterSpeedValue = { num, den, apex, seconds: Math.pow(2, -apex) };
    }
  }

  const next = rd32(offset + 2 + count * 12);
  if (next && next !== offset) walkIfd(buf, next, le, found, depth + 1, visited);
};

/**
 * @param {Buffer} buf the whole RAW file
 * @returns {{exposureTime: {num,den,seconds}|null,
 *            shutterSpeedValue: {num,den,apex,seconds}|null,
 *            disagreementStops: number|null}}
 */
export const readExifShutter = (buf) => {
  const found = { exposureTime: null, shutterSpeedValue: null };
  if (buf.length > 8) {
    const order = buf.readUInt16LE(0);
    const le = order === 0x4949;
    // Panasonic's RW2 uses its own magic but is otherwise a little-endian TIFF.
    if (le || order === 0x4d4d) {
      const first = le ? buf.readUInt32LE(4) : buf.readUInt32BE(4);
      walkIfd(buf, first, le, found, 0, new Set());
    }
  }

  let disagreementStops = null;
  if (found.exposureTime && found.shutterSpeedValue) {
    disagreementStops = Math.log2(found.shutterSpeedValue.seconds / found.exposureTime.seconds);
  }
  return { ...found, disagreementStops };
};

/**
 * "10/2500" for a CSV cell, empty when the camera did not write the field.
 * The fraction is kept whole rather than split into two columns: it is one
 * quantity, and it never contains a comma.
 */
export const rationalText = (r) => (r ? `${r.num}/${r.den}` : '');

/** The two CSV cells for a frame, in column order. */
export const exifShutterCells = (exif) => [
  rationalText(exif?.exposureTime),
  rationalText(exif?.shutterSpeedValue),
];

/** Header block explaining what those two columns are for. Same in all three files. */
export const EXIF_SHUTTER_NOTE = [
  '# ShutterSec is what LibRaw resolved the shutter to, and which EXIF field it',
  '# took depends on the camera: ExposureTime normally, ShutterSpeedValue when',
  '# that is missing, and for some vendors a maker-note field instead. It is also',
  '# a float, so a stored 10/2500 comes back as 0.004000000189989805 -- that tail',
  '# is float32 rounding, not information from the camera.',
  '# ExposureTimeExif (0x829A) and ShutterApexExif (0x9201, APEX, t = 2^-v) are',
  '# therefore recorded verbatim as the fractions the file holds, empty when the',
  '# camera wrote no such field. Which of them to trust is an analysis decision.',
];
