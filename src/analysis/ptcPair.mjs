/**
 * Entry 1: PTC flat-field pairs.
 *
 * One ISO, a ladder of shutter speeds from nearly black to just clipped, two
 * frames at each. Produces the JPTC/2 rows the analysis side already expects.
 *
 * The statistics are the same three the dark entry records -- each frame's own
 * spatial standard deviation and the difference's -- because that trio is what
 * separates temporal noise from the fixed pattern. The difference alone cannot
 * see PRNU, and a single frame cannot separate it.
 */

import { CLIP_SIGMA, CLIP_VARIANCE_FACTOR, clippedStats } from './darkPair.mjs';

export const CHANNEL_POSITIONS = ['(0,0)', '(0,1)', '(1,0)', '(1,1)'];

const plainStats = (v) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  const mean = sum / v.length;
  let acc = 0;
  for (let i = 0; i < v.length; i++) acc += (v[i] - mean) ** 2;
  return { mean, std: Math.sqrt(acc / (v.length - 1)) };
};

const maskedStats = (v, keep, kept) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) if (keep[i]) sum += v[i];
  const mean = sum / kept;
  let acc = 0;
  for (let i = 0; i < v.length; i++) if (keep[i]) acc += (v[i] - mean) ** 2;
  return { mean, std: Math.sqrt(acc / (kept - 1)) };
};

/**
 * Split a mosaic crop into its four CFA positions.
 * The crop's own phase is preserved by the binding, so position (0,0) here is
 * position (0,0) on the sensor.
 */
const splitCfa = (data, size) => {
  const half = size / 2;
  const out = [0, 1, 2, 3].map(() => new Float64Array(half * half));
  for (let y = 0; y < size; y++) {
    const row = y * size;
    const oy = (y >> 1) * half;
    const top = (y & 1) * 2;
    for (let x = 0; x < size; x++) {
      out[top + (x & 1)][oy + (x >> 1)] = data[row + x];
    }
  }
  return { planes: out, planeSize: half };
};

/**
 * @param {{metadata: Function, centreCrop: Function}} rawA
 * @param {*} rawB
 * @param {{ cropSize?: number }} options  crop in MOSAIC pixels
 */
export const analysePtcPair = (rawA, rawB, options = {}) => {
  const size = options.cropSize ?? 512;
  const metaA = rawA.metadata();
  const metaB = rawB.metadata();

  const cropA = rawA.centreCrop(size);
  const cropB = rawB.centreCrop(size);
  const a = splitCfa(cropA.data, cropA.size);
  const b = splitCfa(cropB.data, cropB.size);

  const ceiling = metaA.maximum;
  const channels = [];

  for (let ch = 0; ch < 4; ch++) {
    const fa = a.planes[ch];
    const fb = b.planes[ch];
    const n = fa.length;
    const fd = new Float64Array(n);
    for (let i = 0; i < n; i++) fd[i] = fa[i] - fb[i];

    const sa = plainStats(fa);
    const sb = plainStats(fb);
    const rawDiff = plainStats(fd);
    const clipped = clippedStats(fd);
    const saMasked = maskedStats(fa, clipped.keep, clipped.kept);

    let hitCeiling = 0;
    for (let i = 0; i < n; i++) if (fa[i] >= ceiling || fb[i] >= ceiling) hitCeiling++;

    channels.push({
      position: CHANNEL_POSITIONS[ch],
      n,
      measured: {
        meanA: sa.mean,
        meanB: sb.mean,
        stdA: sa.std,
        stdB: sb.std,
        stdAMasked: saMasked.std,
        stdDiffRaw: rawDiff.std,
        stdDiffClipped: clipped.std,
        diffMean: rawDiff.mean,
        rejected: clipped.rejected,
        clipFrac: hitCeiling / n,
        n,
      },
      derived: {
        // Signal above this frame's own black level, and the temporal noise
        // the difference implies. Screen only, as everywhere else.
        signal: sa.mean - (metaA.black + (metaA.cblack[ch] ?? 0)),
        temporalStd: clipped.std / Math.SQRT2 / Math.sqrt(CLIP_VARIANCE_FACTOR),
      },
    });
  }

  return {
    camera: `${metaA.make} ${metaA.model}`,
    iso: metaA.iso,
    shutter: metaA.shutter,
    aperture: metaA.aperture,
    cfaPattern: metaA.cfaPattern,
    quantisationStep: metaA.quantisation.step,
    curveIsIdentity: metaA.quantisation.linearisationCurve.isIdentity,
    librawVersion: metaA.librawVersion,
    rawWidth: metaA.rawWidth,
    rawHeight: metaA.rawHeight,
    black: metaA.black,
    cblack: metaA.cblack,
    maximum: metaA.maximum,
    cropSize: size,
    planeSize: a.planeSize,
    clip: { sigma: CLIP_SIGMA, varianceFactor: CLIP_VARIANCE_FACTOR },
    mismatch: metaA.shutter !== metaB.shutter || metaA.iso !== metaB.iso,
    channels,
  };
};

/**
 * A PTC set is one ISO and a ladder of shutter speeds, two frames each.
 * Grouping is by shutter rather than by ISO, which is the one structural
 * difference from the dark entry.
 */
export const groupPtcPairs = (frames, options = {}) => {
  const maxGap = options.maxPairGapSec ?? 900;
  const problems = [];
  const rejected = [];
  const pairs = [];

  const bodies = new Set(frames.map((f) => f.meta.model));
  if (bodies.size > 1) {
    problems.push({
      level: 'error',
      message: `这批文件来自 ${bodies.size} 台不同机身（${[...bodies].join('、')}）。一次只处理一台。`,
    });
  }

  const isos = new Set(frames.map((f) => f.meta.iso));
  if (isos.size > 1) {
    problems.push({
      level: 'error',
      message:
        `这组里有 ${isos.size} 个不同的 ISO（${[...isos].sort((a, b) => a - b).join('、')}）。` +
        'PTC 是单一 ISO 下扫快门，请把不同 ISO 分到不同文件夹。',
    });
  }

  const buckets = new Map();
  for (const f of frames) {
    const key = f.meta.shutter.toPrecision(6);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  }

  const keys = [...buckets.keys()].sort((a, b) => Number(b) - Number(a));
  for (const key of keys) {
    const list = buckets.get(key).slice().sort((x, y) => x.meta.timestamp - y.meta.timestamp);
    const shutter = Number(key);

    if (list.length !== 2) {
      rejected.push({
        shutter,
        files: list.map((f) => f.name),
        level: 'error',
        message:
          list.length < 2
            ? `快门 ${Number(shutter.toPrecision(4))}s 只有 ${list.length} 张。每个曝光级别需要恰好两张。`
            : `快门 ${Number(shutter.toPrecision(4))}s 有 ${list.length} 张。多出来的请移出文件夹。`,
      });
      continue;
    }

    const [a, b] = list;
    const checks = [];
    if (a.meta.aperture !== b.meta.aperture) {
      checks.push({ level: 'error', message: `光圈不一致：f/${a.meta.aperture} 对 f/${b.meta.aperture}。` });
    }
    const gap = Math.abs(a.meta.timestamp - b.meta.timestamp);
    if (gap > maxGap) {
      checks.push({
        level: 'warning',
        message: `两张相隔 ${Math.round(gap / 60)} 分钟，中间光线或温度可能变了。`,
      });
    }

    if (checks.some((c) => c.level === 'error')) {
      rejected.push({ shutter, files: [a.name, b.name], level: 'error', checks });
    } else {
      pairs.push({ shutter, a, b, warnings: checks });
    }
  }

  if (pairs.length > 0 && pairs.length < 15) {
    problems.push({
      level: 'warning',
      message:
        `只有 ${pairs.length} 个曝光级别。三参数拟合在 15 级以下会很不稳，建议补到 25 级以上，` +
        '并确保覆盖从接近全黑到刚刚过曝的整个范围。',
    });
  }

  return { pairs, rejected, problems };
};
