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
import { shutterText } from './shutterText.mjs';

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
      // Which colour sits at this cell position. Not assumed: a GBRG body puts
      // red where an RGGB body puts a green.
      color: metaA.cfaColors?.[ch] ?? ch,
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
 * Did this exposure ladder ever reach saturation?
 *
 * A photon transfer curve without a saturated frame has no top: full well is
 * unmeasured, and the fit's saturation signal becomes whatever the brightest
 * frame happened to be. The curve still looks perfectly healthy -- it is just
 * shorter than the sensor -- so nothing downstream can tell.
 *
 * Two signatures, because they fail in opposite directions:
 *
 *   clipFrac  counts pixels at the vendor's stated maximum. Exact when that
 *             number is right, silent when it is too high.
 *   sigma     collapses towards zero once a channel is pinned at its ceiling.
 *             It is a property of the pixels and needs no metadata, but it
 *             only means something relative to the same channel's own peak.
 *
 * ONE CHANNEL IS ENOUGH. On a neutral field green saturates well before red
 * and blue, and green saturating is the end of the usable range: the curve
 * cannot go further without one of its channels being pinned.
 */
const CLIP_FRACTION = 0.001;
const SIGMA_COLLAPSE = 0.5;

const saturationOf = (frames) => {
  const channels = frames[0]?.meta?.centreChannels?.length ?? 0;
  if (channels === 0) return null;

  let reached = false;
  let bestFraction = 0;

  for (let c = 0; c < channels; c++) {
    const stats = frames
      .map((f) => ({ frame: f, ...f.meta.centreChannels[c] }))
      .filter((s) => Number.isFinite(s.mean) && Number.isFinite(s.sigma));
    if (stats.length === 0) continue;

    const peakSigma = Math.max(...stats.map((s) => s.sigma));
    const atPeak = stats.find((s) => s.sigma === peakSigma);

    for (const s of stats) {
      const clipped = s.clipFrac > CLIP_FRACTION;
      // Brighter than the noise peak but quieter than it: the only way that
      // happens is the channel running out of range.
      const collapsed =
        atPeak !== undefined && s.mean > atPeak.mean && s.sigma < SIGMA_COLLAPSE * peakSigma;
      if (clipped || collapsed) reached = true;
    }

    const maximum = frames[0].meta.maximum;
    if (maximum > 0) {
      bestFraction = Math.max(bestFraction, Math.max(...stats.map((s) => s.mean)) / maximum);
    }
  }

  return { reached, bestFraction };
};

/**
 * Filename order, with runs of digits compared as numbers.
 *
 * Cameras number frames sequentially, so filename order is shooting order --
 * and unlike the timestamp it survives a body whose clock is wrong. Plain
 * string order would put P2642100 before P264299, which is exactly the case
 * where a set rolls over and the pairing silently changes.
 */
const byName = (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });

/**
 * A PTC set is a ladder of shutter speeds with two frames at each level.
 *
 * Two things are allowed that the dark entry does not allow, both because
 * they save a shoot rather than because they are tidier:
 *
 *   - Several pairs at the SAME shutter. They are independent measurements of
 *     the same exposure and all of them belong in the fit. Consecutive files
 *     in filename order make a pair: 1+2, 3+4, and so on.
 *   - Several ISOs at once. Each ISO is its own curve and gets its own file;
 *     nothing is ever mixed across ISOs, since gain is what the curve measures.
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

  const isos = [...new Set(frames.map((f) => f.meta.iso))].sort((a, b) => a - b);

  const buckets = new Map();
  for (const f of frames) {
    const key = `${f.meta.iso}|${f.meta.shutter.toPrecision(6)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(f);
  }

  const keys = [...buckets.keys()].sort((x, y) => {
    const [isoX, shutterX] = x.split('|').map(Number);
    const [isoY, shutterY] = y.split('|').map(Number);
    return isoX - isoY || shutterY - shutterX;
  });

  for (const key of keys) {
    const [iso, shutter] = key.split('|').map(Number);
    const list = buckets.get(key).slice().sort(byName);
    const label = `ISO ${iso} 快门 ${shutterText(shutter)}`;

    // An odd frame out is the one thing that cannot be paired. Everything
    // before it still can, so only the leftover is refused.
    if (list.length % 2 === 1) {
      const leftover = list.pop();
      rejected.push({
        iso,
        shutter,
        files: [leftover.name],
        level: 'error',
        message:
          list.length === 0
            ? `${label} 只有 1 张。每个曝光级别需要成对。`
            : `${label} 有奇数张，${leftover.name} 落了单。每个曝光级别需要成对。`,
      });
    }

    for (let i = 0; i + 1 < list.length; i += 2) {
      const a = list[i];
      const b = list[i + 1];
      const checks = [];
      if (a.meta.aperture !== b.meta.aperture) {
        checks.push({
          level: 'error',
          message: `光圈不一致：f/${a.meta.aperture} 对 f/${b.meta.aperture}。`,
        });
      }
      const gap = Math.abs(a.meta.timestamp - b.meta.timestamp);
      if (gap > maxGap) {
        checks.push({
          level: 'warning',
          message: `两张相隔 ${Math.round(gap / 60)} 分钟，中间光线或温度可能变了。`,
        });
      }

      if (checks.some((c) => c.level === 'error')) {
        rejected.push({ iso, shutter, files: [a.name, b.name], level: 'error', checks });
      } else {
        pairs.push({ iso, shutter, a, b, warnings: checks });
      }
    }
  }

  /*
   * The fit needs exposure LEVELS, not pairs -- five pairs at one shutter is
   * one point measured five times, which is a better point and not a longer
   * curve. So the count that matters is the number of distinct shutters, and
   * it has to be counted per ISO, since each ISO is fitted on its own.
   */
  const levelsByIso = new Map();
  for (const pair of pairs) {
    if (!levelsByIso.has(pair.iso)) levelsByIso.set(pair.iso, new Set());
    levelsByIso.get(pair.iso).add(pair.shutter);
  }

  for (const [iso, levels] of [...levelsByIso].sort((a, b) => a[0] - b[0])) {
    if (levels.size < 15) {
      problems.push({
        level: 'warning',
        message:
          `ISO ${iso} 只有 ${levels.size} 个曝光级别。三参数拟合在 15 级以下会很不稳。` +
          '按流程从过曝扫到近黑、每 2 个 1/3 档快门一级，通常能得到 18 级左右——' +
          '级别不够多半是量程没扫完，而不是拍得不够密。',
      });
    }
  }

  // Per ISO: each curve is fitted on its own, so each one needs its own top.
  const framesByIso = new Map();
  for (const f of frames) {
    framesByIso.set(f.meta.iso, [...(framesByIso.get(f.meta.iso) ?? []), f]);
  }
  for (const [iso, isoFrames] of [...framesByIso].sort((a, b) => a[0] - b[0])) {
    const saturation = saturationOf(isoFrames);
    if (!saturation || saturation.reached) continue;
    problems.push({
      level: 'warning',
      message:
        `ISO ${iso} 这一组没有一张过曝：最亮的一张也只到满量程的 ` +
        `${(saturation.bestFraction * 100).toFixed(0)}%，四个通道的 σ 都还在往上走，` +
        '没有任何一个通道被顶住。这样测不到满阱，拟合出来的饱和点只会是「你最亮那张恰好是多少」。' +
        '请在亮端补拍，直到至少有一个通道过曝为止——均匀面上绿色通道通常最先到。',
    });
  }

  if (levelsByIso.size > 1) {
    problems.push({
      level: 'info',
      message:
        `这批里有 ${levelsByIso.size} 个 ISO（${[...levelsByIso.keys()]
          .sort((a, b) => a - b)
          .join('、')}）。每个 ISO 是一条独立的曲线，会各自存成一个 CSV，不会混在一起。`,
    });
  }

  const repeated = [...pairs.reduce((map, p) => {
    const key = `${p.iso}|${p.shutter}`;
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map()).values()].filter((count) => count > 1).length;

  if (repeated > 0) {
    problems.push({
      level: 'info',
      message: `有 ${repeated} 个曝光级别拍了不止一对，已按文件名顺序两两配对，全部进入拟合。`,
    });
  }

  return { pairs, rejected, problems, isos };
};
