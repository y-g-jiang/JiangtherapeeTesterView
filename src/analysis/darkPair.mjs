/**
 * Entry 3: a pair of dark frames at one ISO.
 *
 * The pair earns its keep three times: the means give the black level, the
 * difference gives the temporal read noise, and the differenced planes give the
 * noise spectrum. Only the third was the stated reason for shooting them.
 */

import { rowColumnSpectra, spectrumPowerSum } from '../dsp/spectrum.mjs';

/** Iterative sigma clip threshold. Below 3 the iteration over-converges and
 *  the closed-form correction below stops applying. */
export const CLIP_SIGMA = 3.5;

/** Variance retained by a standard normal restricted to |z| < CLIP_SIGMA. */
export const CLIP_VARIANCE_FACTOR = truncatedVarianceFactor(CLIP_SIGMA);

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normalCdf(x) {
  // Abramowitz & Stegun 7.1.26 on erf, good to ~1.5e-7 -- far tighter than the
  // 0.1% we claim for the clip correction.
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

export function truncatedVarianceFactor(k) {
  return 1 - (2 * k * normalPdf(k)) / (2 * normalCdf(k) - 1);
}

/**
 * Iterative sigma clip. Hot and stuck pixels carry a fixed offset and have
 * already cancelled in the difference, so what a large excursion here means is
 * a genuinely noisy pixel or a cosmic ray -- which is why this belongs on the
 * difference and not on a single frame.
 *
 * @param {Float64Array} d
 * @returns {{ std: number, mean: number, kept: number, rejected: number }}
 */
export const clippedStats = (d, k = CLIP_SIGMA, rounds = 6) => {
  const n = d.length;
  let keep = new Uint8Array(n).fill(1);
  let kept = n;
  let mean = 0;
  let std = 0;
  let lastGoodKeep = keep;

  for (let round = 0; round < rounds; round++) {
    let sum = 0;
    for (let i = 0; i < n; i++) if (keep[i]) sum += d[i];
    mean = sum / kept;
    let acc = 0;
    for (let i = 0; i < n; i++) if (keep[i]) acc += (d[i] - mean) ** 2;
    std = Math.sqrt(acc / (kept - 1));
    if (!(std > 0)) break;

    const limit = k * std;
    const next = new Uint8Array(n);
    let nextKept = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(d[i] - mean) < limit) {
        next[i] = 1;
        nextKept++;
      }
    }
    if (nextKept === kept || nextKept < 16) break;
    keep = next;
    kept = nextKept;
    lastGoodKeep = keep;
  }

  return { std, mean, kept, rejected: n - kept, keep: lastGoodKeep };
};

/** Mean and std of `v` over the pixels the mask keeps. */
const maskedStats = (v, keep, kept) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) if (keep[i]) sum += v[i];
  const mean = sum / kept;
  let acc = 0;
  for (let i = 0; i < v.length; i++) if (keep[i]) acc += (v[i] - mean) ** 2;
  return { mean, std: Math.sqrt(acc / (kept - 1)) };
};

const plainStats = (v) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  const mean = sum / v.length;
  let acc = 0;
  for (let i = 0; i < v.length; i++) acc += (v[i] - mean) ** 2;
  return { mean, std: Math.sqrt(acc / (v.length - 1)) };
};

export const CHANNEL_POSITIONS = ['(0,0)', '(0,1)', '(1,0)', '(1,1)'];

/**
 * @param {{ open: Function, metadata: Function, channelPlane: Function, close: Function }} rawA
 * @param {*} rawB
 * @param {{ cropW: number, cropH: number, window?: 'hann'|'none', spectra?: boolean }} options
 */
export const analyseDarkPair = (rawA, rawB, options) => {
  const { cropW, cropH } = options;
  const wantSpectra = options.spectra !== false;
  const metaA = rawA.metadata();
  const metaB = rawB.metadata();

  const channels = [];

  for (let ch = 0; ch < 4; ch++) {
    const a = rawA.channelPlane(ch, cropW, cropH);
    const b = rawB.channelPlane(ch, cropW, cropH);
    if (a.width !== b.width || a.height !== b.height) {
      throw new Error('The two frames disagree on plane size; are they the same camera and mode?');
    }

    const n = a.width * a.height;
    const fa = new Float64Array(n);
    const fb = new Float64Array(n);
    const fd = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      fa[i] = a.data[i];
      fb[i] = b.data[i];
      fd[i] = fa[i] - fb[i];
    }

    const sa = plainStats(fa);
    const sb = plainStats(fb);
    const rawDiff = plainStats(fd);
    const clipped = clippedStats(fd);

    /*
     * Everything below is split into `measured` and `derived` on purpose.
     *
     * `measured` is what goes into the file: numbers this tool is the only
     * thing in the pipeline able to produce, because they need the pixels.
     *
     * `derived` is arithmetic on those numbers -- the /sqrt(2), the clip's
     * own bite put back, the fixed-pattern subtraction. It is shown on screen
     * so the operator can see whether a pair looks sane, and it is NOT
     * written out. Anyone downstream can recompute it, and baking it in would
     * take that choice away from them.
     *
     * Sheppard's correction is not applied anywhere in this tool, by
     * instruction: it is a correction, it is exactly reversible, and it
     * belongs to whoever is doing the analysis.
     *
     * The clip is the one thing that has to happen here rather than later,
     * because it needs the individual pixels. So its inputs are all recorded
     * -- k, the unclipped std, and the rejected count -- and it stays
     * auditable even though it cannot be undone.
     */
    const temporal = clipped.std / Math.SQRT2 / Math.sqrt(CLIP_VARIANCE_FACTOR);

    /*
     * Var(A) - Var(D)/2 = fixed pattern; shot noise and q^2/12 both cancel.
     *
     * Both terms must come from the same pixels. Subtracting a clipped
     * difference variance from an unclipped single-frame one counts the
     * outliers on one side only and inflates the answer -- on this sensor by
     * a factor of nearly four. So A is measured over the mask the clip
     * produced, and the clip's own bite is restored on both sides, where it
     * cancels in the subtraction anyway.
     */
    const saMasked = maskedStats(fa, clipped.keep, clipped.kept);
    const fpnVar = saMasked.std ** 2 - clipped.std ** 2 / 2;

    const entry = {
      position: CHANNEL_POSITIONS[ch],
      color: a.color,
      width: a.width,
      height: a.height,
      n,

      /** Written to the file. Needs the pixels; nothing downstream can redo it. */
      measured: {
        blackA: sa.mean,
        blackB: sb.mean,
        stdA: sa.std,
        stdB: sb.std,
        stdAMasked: saMasked.std,
        stdDiffRaw: rawDiff.std,
        stdDiffClipped: clipped.std,
        diffMean: rawDiff.mean,
        rejected: clipped.rejected,
        n,
      },

      /** Screen only. Pure arithmetic on `measured`; recomputable by anyone. */
      derived: {
        temporalStd: temporal,
        fpnStd: fpnVar > 0 ? Math.sqrt(fpnVar) : null,
        rejectedFrac: clipped.rejected / n,
      },
    };

    if (wantSpectra) {
      const specSingle = rowColumnSpectra(fa, a.width, a.height, options);
      const specDiff = rowColumnSpectra(fd, a.width, a.height, options);
      entry.spectra = { single: specSingle, diff: specDiff };
      // Parseval: the summed one-sided power must match the variance the
      // spatial statistics already reported. A normalisation slip is otherwise
      // invisible.
      entry.parseval = {
        singleH: spectrumPowerSum(specSingle.h, a.width) / specSingle.withinRowVar,
        singleV: spectrumPowerSum(specSingle.v, a.height) / specSingle.withinColVar,
        diffH: spectrumPowerSum(specDiff.h, a.width) / specDiff.withinRowVar,
        diffV: spectrumPowerSum(specDiff.v, a.height) / specDiff.withinColVar,
      };
      /*
       * How much of the plane's variance is row-to-row (or column-to-column)
       * rather than within a line. A row periodogram cannot see this part, so
       * it is worth reporting rather than leaving as an unexplained gap
       * between the spectrum and the spatial statistics.
       */
      entry.lineToLine = {
        rowFraction: 1 - specSingle.withinRowVar / sa.std ** 2,
        colFraction: 1 - specSingle.withinColVar / sa.std ** 2,
      };
    }

    channels.push(entry);
  }

  return {
    camera: `${metaA.make} ${metaA.model}`,
    iso: metaA.iso,
    shutter: metaA.shutter,
    cfaPattern: metaA.cfaPattern,
    quantisationStep: metaA.quantisation.step,
    curveIsIdentity: metaA.quantisation.linearisationCurve.isIdentity,
    librawVersion: metaA.librawVersion,
    mismatches: describeMismatches(metaA, metaB),
    clip: { sigma: CLIP_SIGMA, varianceFactor: CLIP_VARIANCE_FACTOR },
    channels,
  };
};

/** A pair must agree on everything that changes the statistics. */
const describeMismatches = (a, b) => {
  const out = [];
  const check = (key, label) => {
    if (a[key] !== b[key]) out.push(`${label}: ${a[key]} vs ${b[key]}`);
  };
  check('model', '机身');
  check('iso', 'ISO');
  check('shutter', '快门');
  check('aperture', '光圈');
  check('rawWidth', 'raw 宽');
  check('rawHeight', 'raw 高');
  check('black', '黑电平');
  if (a.quantisation.step !== b.quantisation.step) {
    out.push(`量化步长: ${a.quantisation.step} vs ${b.quantisation.step}`);
  }
  const dt = Math.abs(a.timestamp - b.timestamp);
  if (dt > 600) out.push(`拍摄间隔 ${Math.round(dt)} s（超过 10 分钟，可能有温漂）`);
  return out;
};
