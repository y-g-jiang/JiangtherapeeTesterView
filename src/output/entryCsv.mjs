/**
 * Writers for entries 1 and 2.
 *
 * Same rule as the dark entry: only what needed the pixels goes in, and
 * nothing is corrected. Levels rather than ratios, standard deviations rather
 * than read noise -- the arithmetic that turns one into the other belongs to
 * whoever is doing the analysis, and will outlive any particular version of it.
 */
import { EXIF_SHUTTER_NOTE, exifShutterCells } from '../analysis/exifShutter.mjs';
import { INTERCHANGE_COLORS, INTERCHANGE_NAMES } from '../analysis/channelOrder.mjs';

export const CHANNEL_NAMES = ['C00', 'C01', 'C10', 'C11'];

const scalar = (v) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : String(v);

const commonHeader = (meta, format) => [
  `#Format: ${format}`,
  `#Tool: jptc-collect ${meta.toolVersion}`,
  `#Decoder: LibRaw ${meta.librawVersion}`,
  `#Generated: ${meta.generated}`,
  '#',
  '# Every value below is as measured. No correction of any kind has been',
  '# applied, and no black level has been subtracted. The black level belongs',
  '# to the dark set, which is why that one is shot first.',
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
  '#CfaOrder: C00,C01,C10,C11 by position in the 2x2 cell, not by colour name',
  `#RawSize: ${meta.rawWidth}x${meta.rawHeight}`,
  `#SensorBlackTag: ${meta.black}`,
  `#SensorMaximum: ${meta.maximum}`,
];

/**
 * Entry 2. One row per frame per channel: the level, and nothing derived from
 * it.
 *
 * Deliberately no gain ratio. Which chain to walk up the ladder, and how to
 * weight it, is an analysis decision that will change; the level will not.
 */
export const writeIsoGainCsv = (frames, meta) => {
  const lines = commonHeader(meta, 'JPTC-ISOGAIN/1');
  lines.push(
    `#Ladder: ${meta.ladder}`,
    `#CropMosaic: ${meta.cropW}x${meta.cropH}`,
    `#PlanePerChannel: ${meta.planeW}x${meta.planeH}`,
    '# ShutterSec is the NOMINAL time from the file. A mechanical shutter',
    '# departs from it systematically and unreadably, which is what the',
    '# paired-shutter ladder exists to sidestep.',
    ...EXIF_SHUTTER_NOTE,
    '#',
    '# g1/g2 = (t1/t2) * (Mean2 - BL2) / (Mean1 - BL1), with BL from the dark set.',
  );
  lines.push(
    [
      'ISO', 'ShutterSec', 'ExposureTimeExif', 'ShutterApexExif',
      'Aperture', 'ShutterGroup', 'File', 'Channel',
      'ColorIndex', 'N', 'Mean', 'Std', 'ClipFrac',
    ].join(','),
  );

  for (const f of frames) {
    f.channels.forEach((c, i) => {
      lines.push(
        [
          f.iso,
          f.shutter,
          ...exifShutterCells(f.exifShutter),
          f.aperture,
          f.shutterGroup,
          f.file,
          CHANNEL_NAMES[i],
          c.color,
          c.measured.n,
          scalar(c.measured.mean),
          scalar(c.measured.std),
          scalar(c.measured.clipFrac),
        ].join(','),
      );
    });
  }
  return lines.join('\n') + '\n';
};

/**
 * Entry 1, in the JPTC/2 schema.
 *
 * One row per exposure, four channels across -- the layout ptc-compare's
 * parser reads. It looks for R_Mean and R_Std by name, so a long table with a
 * Channel column, however tidy, simply does not load there. Everything the
 * long form carried is still here, one column group per statistic.
 *
 * Channels are named by COLOUR (R, G1, G2, B), not by cell position, because
 * that is what the interchange format means by them and a GBRG body would
 * otherwise have its red column labelled green.
 *
 * StdDiff is the standard deviation of A-B itself: not halved, not divided by
 * sqrt(2), not Sheppard-corrected. StdA and StdB sit beside it because the
 * three together separate temporal noise from the fixed pattern, which
 * neither statistic can do alone.
 */
export const writePtcCsv = (pairs, meta) => {
  const lines = commonHeader(meta, 'JPTC/2');

  lines.push(
    `#Pairing: Differential`,
    `#CropMosaic: ${meta.cropSize}x${meta.cropSize}`,
    `#PlanePerChannel: ${meta.planeSize}x${meta.planeSize}`,
    `#ISO: ${meta.iso}`,
    `#ClipSigma: ${meta.clipSigma}`,
    `#ClipVarianceFactor: ${meta.clipVarianceFactor}`,
    '#ChannelOrder: R,G1,G2,B by colour. G1 shares its row with red.',
    '# Levels are raw. No black level has been subtracted, and none is quoted:',
    '# the black level is a measurement of its own and lives in the dark set,',
    '# which travels in the same submission. Joining the two is an analysis',
    '# step, and doing it here would make one entry depend on another having',
    '# been processed first -- a rule the person shooting should not have to know.',
    '# StdDiff is the standard deviation of A-B. Not halved, not corrected.',
    '# StdDiffClipped is the same after the sigma clip; the unclipped value is',
    '# kept beside it so the clip can be judged rather than trusted.',
    '#',
    ...EXIF_SHUTTER_NOTE,
    '# The two frames of a pair are grouped on an identical ShutterSec, so the',
    '# fractions below are the ones frame A holds.',
  );

  /*
   * Mean and Std lead, and every other statistic is named so that it cannot be
   * mistaken for them: the reader matches on a token, and a column ending in
   * "Mean" would answer to a search for the mean.
   */
  const groups = [
    ['Mean', (m) => scalar(m.meanA)],
    ['Std', (m) => scalar(m.stdA)],
    ['MeanB', (m) => scalar(m.meanB)],
    ['StdB', (m) => scalar(m.stdB)],
    ['StdMasked', (m) => scalar(m.stdAMasked)],
    ['StdDiff', (m) => scalar(m.stdDiffRaw)],
    ['StdDiffClipped', (m) => scalar(m.stdDiffClipped)],
    ['DiffOffset', (m) => scalar(m.diffMean)],
    ['Rejected', (m) => m.rejected],
    ['ClipFrac', (m) => scalar(m.clipFrac)],
  ];

  const header = [
    'ISO', 'ShutterSec', 'ExposureTimeExif', 'ShutterApexExif',
    'Aperture', 'Filename', 'FileB', 'N',
  ];
  for (const [suffix] of groups) {
    for (const name of INTERCHANGE_NAMES) header.push(`${name}_${suffix}`);
  }
  lines.push(header.join(','));

  for (const p of pairs) {
    // By colour, so the column labelled R is red on every CFA layout.
    const byColour = INTERCHANGE_COLORS.map((color) =>
      p.channels.find((c) => c.color === color),
    );

    const row = [
      p.iso, p.shutter, ...exifShutterCells(p.exifShutter),
      p.aperture, p.fileA, p.fileB, byColour[0]?.measured?.n ?? '',
    ];
    for (const [, read] of groups) {
      for (const channel of byColour) row.push(channel ? read(channel.measured) : '');
    }
    lines.push(row.join(','));
  }

  return lines.join('\n') + '\n';
};
