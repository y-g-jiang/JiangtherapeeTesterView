/**
 * Entry 2: the ISO gain ladder.
 *
 * A fixed scene through a fixed aperture gives, per channel,
 *
 *     DN - BL = Phi * t / g
 *
 * so for any two frames
 *
 *     g1 / g2 = (t1 / t2) * (DN2 - BL2) / (DN1 - BL1)
 *
 * The collector records the levels and nothing else. It does not subtract a
 * black level -- that comes from the dark set, at analysis time -- and it does
 * not compute a ratio, because which chain to walk and how to weight it will
 * change, while a measured level will not.
 *
 * Note what the formula does *not* require: that any exposure be "correct".
 * Assuming equal levels instead of measuring them turns a third of a stop of
 * metering error into a 26% error in the gain ratio.
 */

const CHANNELS = 4;

/** Fraction of samples at or above the sensor's saturation code. */
const clipFraction = (data, ceiling) => {
  let hit = 0;
  for (let i = 0; i < data.length; i++) if (data[i] >= ceiling) hit++;
  return hit / data.length;
};

const stats = (data) => {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  let acc = 0;
  for (let i = 0; i < data.length; i++) {
    const d = data[i] - mean;
    acc += d * d;
  }
  return { mean, std: Math.sqrt(acc / (data.length - 1)) };
};

/**
 * One frame. Unlike the other two entries this needs no pair -- the ladder is
 * built from single frames, and the pairing that matters happens between
 * *ISO settings*, not between frames.
 *
 * @param {{metadata: Function, channelPlane: Function}} raw
 * @param {{cropW: number, cropH: number}} options
 */
export const analyseGainFrame = (raw, options) => {
  const meta = raw.metadata();
  const ceiling = meta.maximum;
  const channels = [];

  for (let ch = 0; ch < CHANNELS; ch++) {
    const plane = raw.channelPlane(ch, options.cropW, options.cropH);
    const s = stats(plane.data);
    channels.push({
      color: plane.color,
      width: plane.width,
      height: plane.height,
      n: plane.data.length,
      measured: {
        mean: s.mean,
        std: s.std,
        clipFrac: clipFraction(plane.data, ceiling),
        n: plane.data.length,
      },
      // Screen only: how far above its own black level this frame sits, which
      // is what tells "usable exposure" from "buried in the floor".
      derived: {
        aboveBlack: s.mean - (meta.black + (meta.cblack[ch] ?? 0)),
        fractionOfFull: (s.mean - meta.black) / Math.max(1, ceiling - meta.black),
      },
    });
  }

  return {
    camera: `${meta.make} ${meta.model}`,
    iso: meta.iso,
    shutter: meta.shutter,
    aperture: meta.aperture,
    lens: meta.lens,
    timestamp: meta.timestamp,
    cfaPattern: meta.cfaPattern,
    quantisationStep: meta.quantisation.step,
    curveIsIdentity: meta.quantisation.linearisationCurve.isIdentity,
    librawVersion: meta.librawVersion,
    rawWidth: meta.rawWidth,
    rawHeight: meta.rawHeight,
    maximum: ceiling,
    black: meta.black,
    channels,
  };
};

/** Shutter times within this relative tolerance count as "the same setting". */
const SHUTTER_TOLERANCE = 1e-4;

const sameShutter = (a, b) => Math.abs(a - b) <= SHUTTER_TOLERANCE * Math.max(a, b);

/**
 * Sort a ladder into its shutter groups and say which protocol it looks like.
 *
 * Paired-shutter is the one worth having: two adjacent ISOs at the same
 * shutter time, chained up the ladder, so the shutter cancels out of the
 * arithmetic entirely. That matters because the RAW records the *nominal*
 * shutter time and a mechanical shutter's real one departs from it in a way
 * nothing can read back.
 */
export const groupGainLadder = (frames, options = {}) => {
  const problems = [];
  const rejected = [];

  const bodies = new Set(frames.map((f) => f.meta.model));
  if (bodies.size > 1) {
    problems.push({
      level: 'error',
      message: `这批文件来自 ${bodies.size} 台不同机身（${[...bodies].join('、')}）。一次只处理一台。`,
    });
  }

  const apertures = new Set(frames.map((f) => f.meta.aperture.toFixed(2)));
  if (apertures.size > 1) {
    problems.push({
      level: 'error',
      message:
        `光圈不一致：${[...apertures].map((a) => `f/${a}`).join('、')}。` +
        '整组必须固定光圈，否则进光量变了，比值就没有意义。',
    });
  }

  // Bucket by shutter time.
  const buckets = [];
  for (const f of frames) {
    const bucket = buckets.find((b) => sameShutter(b.shutter, f.meta.shutter));
    if (bucket) bucket.frames.push(f);
    else buckets.push({ shutter: f.meta.shutter, frames: [f] });
  }
  buckets.sort((a, b) => b.shutter - a.shutter);

  /*
   * What makes a measurement paired is that one shutter carries two ISOs, so
   * the time cancels out of the ratio. Whether there are two such groups or
   * twenty decides how far the chain reaches, not what kind of measurement it
   * is -- a single group is a perfectly good link between two ISOs, and that
   * is exactly what a supplementary shoot to patch one missing ISO looks like.
   *
   * Requiring two groups labelled such a shoot 'auto-shutter', which then told
   * the analyst the number depends on a nominal shutter time that had in fact
   * cancelled.
   */
  const pairedGroups = buckets.filter((b) => new Set(b.frames.map((f) => f.meta.iso)).size >= 2);
  const pairedFrames = new Set(pairedGroups.flatMap((b) => b.frames));
  const ladder =
    pairedGroups.length === 0
      ? 'auto-shutter'
      : pairedFrames.size === frames.length
        ? 'paired-shutter'
        : 'mixed';

  // Anything at the same ISO *and* the same shutter is a duplicate.
  for (const bucket of buckets) {
    const byIso = new Map();
    for (const f of bucket.frames) {
      const list = byIso.get(f.meta.iso) ?? [];
      list.push(f);
      byIso.set(f.meta.iso, list);
    }
    for (const [iso, list] of byIso) {
      if (list.length > 1) {
        problems.push({
          level: 'warning',
          message:
            `ISO ${iso} 在同一快门（${shutterLabel(bucket.shutter)}）下有 ${list.length} 张：` +
            `${list.map((f) => f.name).join('、')}。重复帧会被一并记录，分析时可以平均，也可以挑一张。`,
        });
      }
    }
  }

  // A frame that clipped, or one buried in the floor, cannot carry a level.
  for (const f of frames) {
    const above = f.meta.centreAboveBlack;
    const clip = f.meta.centreClipFrac;
    if (clip !== undefined && clip > 0.0005) {
      rejected.push({
        name: f.name,
        iso: f.meta.iso,
        level: 'error',
        message: `${(clip * 100).toFixed(2)}% 的像素已经过曝。过曝的帧测不出电平，请压暗重拍这一张。`,
      });
    } else if (above !== undefined && above < 200) {
      rejected.push({
        name: f.name,
        iso: f.meta.iso,
        level: 'error',
        message: `只比黑电平高 ${above.toFixed(0)} DN，太暗了。电平会被读噪淹没，请拍亮一点。`,
      });
    }
  }

  const rejectedNames = new Set(rejected.map((r) => r.name));
  const usable = frames.filter((f) => !rejectedNames.has(f.name));

  if (ladder === 'mixed' && usable.length > 0) {
    problems.push({
      level: 'info',
      message:
        `这组里两种拍法都有：${pairedGroups.length} 个快门下拍了不止一档 ISO（同快门配对，快门被约掉），` +
        '其余是单张扫 ISO（吃快门标称值）。两条链都会记下来，分析时可以分别算、也可以对照着看。',
    });
  }

  if (ladder === 'auto-shutter' && usable.length > 0) {
    problems.push({
      level: 'warning',
      message:
        '这组看起来是「自动快门扫 ISO」。可用，但它依赖 RAW 里记录的快门标称值，' +
        '而机械快门的实际时间与标称值有系统性偏差。若能补一组「同快门配对」会更可靠。',
    });
  }

  return { ladder, buckets, usable, rejected, problems };
};

export const shutterLabel = (s) =>
  s >= 1 ? `${Number(s.toFixed(3))}s` : `1/${Math.round(1 / s)}s`;
