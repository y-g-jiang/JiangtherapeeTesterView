/**
 * Writers for entry 3's three files: one scalar table and two spectrum tables.
 *
 * Everything the tool measured goes in. Nothing it derived does -- see the
 * design doc, §5.4.1. The header carries what the analyst needs in order to
 * apply corrections themselves, above all the quantisation step, which cannot
 * be recovered from any statistic once the pixels are gone.
 */
import { EXIF_SHUTTER_NOTE, exifShutterCells } from '../analysis/exifShutter.mjs';

export const CHANNEL_NAMES = ['C00', 'C01', 'C10', 'C11'];

/**
 * Significant digits for spectrum values.
 *
 * A periodogram averaged over N lines carries a relative error of about
 * 1/sqrt(N) -- 2.3% at 1950 rows. Six digits is already four orders of
 * magnitude below that, so anything more is storing noise at ~13 bytes a
 * sample. This is the single knob that decides file size.
 */
const SPECTRUM_DIGITS = 6;

/** Scalars are few and irreplaceable, so they get full precision. */
const scalar = (v) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : String(v);

const spectrumValue = (v) =>
  !Number.isFinite(v) ? '' : Number(v).toPrecision(SPECTRUM_DIGITS);

const headerLines = (meta) => {
  const lines = [
    `#Format: ${meta.format}`,
    `#Tool: jptc-collect ${meta.toolVersion}`,
    `#Decoder: LibRaw ${meta.librawVersion}`,
    `#Generated: ${meta.generated}`,
    '#',
    '# Every value below is as measured. No correction of any kind has been',
    '# applied: not Sheppard, not the /sqrt(2) on a difference, nothing that can',
    '# be recomputed from these numbers. The one irreversible step is the sigma',
    '# clip, whose inputs are all recorded here.',
    '#',
    `#Camera: ${meta.camera}`,
    // The output size the camera writes as a JPEG, declared by the operator.
    // Every normalisation downstream is per output pixel, so this is the scale
    // the whole comparison hangs on -- and it is not the RAW's size, which
    // carries masked borders the picture does not have.
    `#ImageWidth: ${meta.imageWidth ?? ''}`,
    `#ImageHeight: ${meta.imageHeight ?? ''}`,
    `#ImagePixels: ${meta.imageWidth && meta.imageHeight ? meta.imageWidth * meta.imageHeight : ''}`,
    `#Firmware: ${meta.firmware ?? ''}`,
    `#Lens: ${meta.lens ?? ''}`,
    `#ShutterType: ${meta.shutterType ?? ''}`,
    `#Compression: ${meta.compression ?? ''}`,
    `#LongExposureNR: ${meta.longExposureNr ?? ''}`,
    `#Stabilisation: ${meta.stabiliser ?? ''}`,
    '#',
    `#AdcStep: ${meta.adcStep}`,
    `#LinearisationCurve: ${meta.curveIsIdentity ? 'identity' : 'companded'}`,
    `#CfaPattern: ${meta.cfaPattern}`,
    `#CfaOrder: C00,C01,C10,C11 by position in the 2x2 cell, not by colour name`,
    `#RawSize: ${meta.rawWidth}x${meta.rawHeight}`,
    `#CropMosaic: ${meta.cropW}x${meta.cropH}`,
    `#PlanePerChannel: ${meta.planeW}x${meta.planeH}`,
    '#',
    `#ClipSigma: ${meta.clipSigma}`,
    `#ClipVarianceFactor: ${meta.clipVarianceFactor}`,
    '# StdDiff columns are the standard deviation of A-B itself. Not halved, not',
    '# divided by sqrt(2). StdDiffClipped is the same after the sigma clip; the',
    '# unclipped value is kept beside it so the clip can be judged.',
  ];
  return lines;
};

/**
 * The scalar table: one row per ISO per channel.
 * Long rather than wide, because the number of ISOs is not known in advance
 * and a long table stays readable when it grows.
 */
export const writeDarkScalarCsv = (entries, meta) => {
  const lines = headerLines({ ...meta, format: 'JPTC-DARK/1' });
  lines.push('#', ...EXIF_SHUTTER_NOTE);
  lines.push(
    [
      'ISO',
      'ShutterSec',
      'ExposureTimeExif',
      'ShutterApexExif',
      'Channel',
      'ColorIndex',
      'N',
      'FileA',
      'FileB',
      'BlackA',
      'BlackB',
      'StdA',
      'StdB',
      'StdAMasked',
      'StdDiff',
      'StdDiffClipped',
      'DiffMean',
      'Rejected',
      // The spectra's own reference variances. See the OneSided note above.
      'WithinRowVarSingle',
      'WithinColVarSingle',
      'WithinRowVarDiff',
      'WithinColVarDiff',
    ].join(','),
  );

  for (const e of entries) {
    e.channels.forEach((c, i) => {
      const m = c.measured;
      lines.push(
        [
          e.iso,
          e.shutter,
          ...exifShutterCells(e.exifShutter),
          CHANNEL_NAMES[i],
          c.color,
          m.n,
          e.fileA,
          e.fileB,
          scalar(m.blackA),
          scalar(m.blackB),
          scalar(m.stdA),
          scalar(m.stdB),
          scalar(m.stdAMasked),
          scalar(m.stdDiffRaw),
          scalar(m.stdDiffClipped),
          scalar(m.diffMean),
          m.rejected,
          scalar(m.withinRowVarSingle),
          scalar(m.withinColVarSingle),
          scalar(m.withinRowVarDiff),
          scalar(m.withinColVarDiff),
        ].join(','),
      );
    });
  }
  return lines.join('\n') + '\n';
};

/**
 * One spectrum table per axis, because the horizontal and vertical transforms
 * have different lengths and therefore different bin counts.
 *
 * Rows are frequency bins; columns are (ISO, channel, source). Frequency is in
 * cycles per channel-plane pixel, which is what the transform actually did --
 * doubling it to sensor pixels is left to the analyst, like every other
 * conversion.
 */
export const writeDarkSpectrumCsv = (entries, meta, axis) => {
  if (entries.length === 0) throw new Error('no entries');

  const n = axis === 'h' ? meta.planeW : meta.planeH;
  const bins = entries[0].channels[0].spectra.single[axis].length;

  for (const e of entries) {
    for (const c of e.channels) {
      if (c.spectra.single[axis].length !== bins) {
        throw new Error(
          'The entries disagree on bin count, so they cannot share one table. ' +
            'Every frame in a set must use the same crop.',
        );
      }
    }
  }

  const lines = headerLines({ ...meta, format: 'JPTC-SPECTRUM/1' });
  lines.push(
    `#Axis: ${axis === 'h' ? 'horizontal' : 'vertical'}`,
    `#TransformLength: ${n}`,
    `#Window: ${meta.window}`,
    '#Normalisation: |Y(k)|^2 / (N * sum(w^2)), averaged over lines',
    '#OneSided: bins 1..N/2-1 are NOT doubled. To integrate a column back to a',
    '#  variance, double every bin except DC and, for even N, Nyquist. Adding a',
    '#  column up as it stands lands exactly a factor of two low, and nothing in',
    '#  a plot of it would look wrong.',
    '#Verification: with a rectangular window that doubled sum equals the',
    '#  within-line variance exactly -- an identity that holds for any data, and',
    '#  the check a normalisation slip cannot hide from. Under the Hann window',
    '#  used here it comes out a few percent short, because the lines are not',
    '#  stationary. The reference itself is the WithinRowVar / WithinColVar',
    '#  columns of the scalar table: NOT StdA^2, which is the whole plane and so',
    '#  also carries the line-to-line spread a periodogram cannot see.',
    `#FreqUnit: cycles per channel-plane pixel (bin k -> k/${n}); x2 for sensor pixels`,
    '#DiffPowerFactor: 2   (the difference spectrum is NOT halved here)',
    `#LinesAveraged: ${axis === 'h' ? meta.planeH : meta.planeW}`,
    `#SignificantDigits: ${SPECTRUM_DIGITS}`,
    '#Note: single minus half the difference gives the fixed-pattern spectrum.',
  );

  const cols = ['bin', 'freq'];
  for (const e of entries) {
    for (let i = 0; i < 4; i++) {
      cols.push(`iso${e.iso}_${CHANNEL_NAMES[i]}_single`);
      cols.push(`iso${e.iso}_${CHANNEL_NAMES[i]}_diff`);
    }
  }
  lines.push(cols.join(','));

  const series = [];
  for (const e of entries) {
    for (let i = 0; i < 4; i++) {
      series.push(e.channels[i].spectra.single[axis]);
      series.push(e.channels[i].spectra.diff[axis]);
    }
  }

  const row = new Array(2 + series.length);
  for (let k = 0; k < bins; k++) {
    row[0] = k;
    row[1] = (k / n).toPrecision(SPECTRUM_DIGITS);
    for (let s = 0; s < series.length; s++) row[2 + s] = spectrumValue(series[s][k]);
    lines.push(row.join(','));
  }

  return lines.join('\n') + '\n';
};
