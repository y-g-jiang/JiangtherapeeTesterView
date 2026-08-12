/**
 * A minimal ZIP writer.
 *
 * The collector's job ends with "give the contributor one thing to send", and
 * a run produces up to three CSVs. Rather than take a dependency for it, this
 * writes the format directly: Node already provides both halves that are
 * awkward to hand-roll, raw deflate and CRC-32.
 *
 * Deliberately not general. No ZIP64, no directories, no encryption, no
 * streaming -- a whole run is single-digit megabytes of text, so everything
 * fits in memory and the 4 GB limits cannot be reached.
 */

import { deflateRawSync, crc32 } from 'node:zlib';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** MS-DOS date and time, which is what the format stores. */
const dosStamp = (date) => {
  const time =
    (Math.floor(date.getSeconds() / 2) & 0x1f) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((date.getHours() & 0x1f) << 11);
  const day =
    (date.getDate() & 0x1f) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    ((Math.max(0, date.getFullYear() - 1980) & 0x7f) << 9);
  return { time, day };
};

/**
 * @param {{name: string, data: Buffer|string}[]} files
 * @param {{ date?: Date }} [options]
 * @returns {Buffer}
 */
export const buildZip = (files, options = {}) => {
  const stamp = dosStamp(options.date ?? new Date());
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const deflated = deflateRawSync(raw, { level: 9 });

    // Only claim compression when it actually helped; a stored entry is
    // smaller than a deflated one for data that will not compress.
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    chunks.push(local, nameBytes, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(CENTRAL_SIG, 0);
    entry.writeUInt16LE(0x031e, 4); // made by: 3.0, unix
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(stamp.time, 12);
    entry.writeUInt16LE(stamp.day, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // disk
    entry.writeUInt16LE(0, 36); // internal attrs
    entry.writeUInt32LE(0o644 << 16, 38); // external attrs
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...chunks, centralBuf, eocd]);
};
