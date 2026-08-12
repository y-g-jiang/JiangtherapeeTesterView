import { describe, expect, it } from 'vitest';
import { inflateRawSync, crc32 } from 'node:zlib';
import { buildZip } from '../zip.mjs';

/**
 * Parse the archive back out of the bytes, using only the central directory —
 * which is what a real extractor reads. If the offsets or the flags are wrong
 * this fails here rather than on a contributor's machine.
 */
const readZip = (buf) => {
  const EOCD_SIG = 0x06054b50;
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== EOCD_SIG) eocd--;
  expect(eocd).toBeGreaterThanOrEqual(0);

  const count = buf.readUInt16LE(eocd + 10);
  const centralSize = buf.readUInt32LE(eocd + 12);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  expect(centralOffset + centralSize).toBe(eocd);

  const files = [];
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const storedCrc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    expect(buf.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const payload = buf.slice(dataStart, dataStart + compSize);
    const data = method === 8 ? inflateRawSync(payload) : payload;

    files.push({ name, data, flags, method, storedCrc, rawSize, compSize });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
};

describe('buildZip', () => {
  it('round-trips content exactly', () => {
    const inputs = [
      { name: 'a.csv', data: 'ISO,Mean\n100,511.68229552368535\n' },
      { name: 'b.csv', data: 'x'.repeat(50000) },
    ];
    const files = readZip(buildZip(inputs, { date: new Date('2026-08-12T00:00:00Z') }));

    expect(files.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
    for (let i = 0; i < inputs.length; i++) {
      expect(files[i].data.toString('utf8')).toBe(inputs[i].data);
      expect(files[i].rawSize).toBe(Buffer.byteLength(inputs[i].data));
    }
  });

  it('stores a CRC that matches the uncompressed bytes', () => {
    // A wrong CRC does not stop the archive from being written; it stops it
    // from being opened, somewhere else, later.
    const data = 'ISO,值\n100,511.68\n';
    const [file] = readZip(buildZip([{ name: '中文.csv', data }]));
    expect(file.storedCrc >>> 0).toBe(crc32(Buffer.from(data, 'utf8')) >>> 0);
  });

  it('marks names as UTF-8 so non-ASCII survives extraction', () => {
    const name = 'Panasonic-DC-S5M2_iso100_电子快门_无损压缩_dark.csv';
    const [file] = readZip(buildZip([{ name, data: 'x' }]));
    expect(file.name).toBe(name);
    expect(file.flags & 0x0800).toBe(0x0800);
  });

  it('stores rather than deflates when compression would grow the entry', () => {
    // Random bytes do not compress; claiming deflate would make the file
    // bigger than the data it holds.
    const random = Buffer.from(
      Array.from({ length: 4096 }, (_, i) => (i * 2654435761) % 256),
    );
    const [file] = readZip(buildZip([{ name: 'r.bin', data: random }]));
    expect(file.data.equals(random)).toBe(true);
    expect(file.compSize).toBeLessThanOrEqual(random.length);
  });

  it('compresses numeric CSV to a fraction of its size', () => {
    const csv =
      'bin,freq,power\n' +
      Array.from({ length: 5000 }, (_, k) => `${k},${(k / 2950).toPrecision(6)},1.00${k % 100}e-3`)
        .join('\n');
    const zip = buildZip([{ name: 's.csv', data: csv }]);
    expect(zip.length).toBeLessThan(csv.length * 0.5);
    expect(readZip(zip)[0].data.toString('utf8')).toBe(csv);
  });

  it('handles an empty file and an empty archive', () => {
    const [file] = readZip(buildZip([{ name: 'empty.csv', data: '' }]));
    expect(file.rawSize).toBe(0);
    expect(file.data.length).toBe(0);
    expect(readZip(buildZip([]))).toEqual([]);
  });
});
