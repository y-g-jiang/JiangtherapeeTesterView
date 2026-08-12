/**
 * Writers for entries 1 and 2.
 *
 * Same rule as the dark entry: only what needed the pixels goes in, and
 * nothing is corrected. Levels rather than ratios, standard deviations rather
 * than read noise -- the arithmetic that turns one into the other belongs to
 * whoever is doing the analysis, and will outlive any particular version of it.
 */

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
  `#Firmware: ${meta.firmware ?? ''}`,
  `#Lens: ${meta.lens ?? ''}`,
  `#ShutterType: ${meta.shutterType ?? ''}`,
  `#Compression: ${meta.compression ?? ''}`,
  `#BitDepth: ${meta.bitDepth ?? ''}`,
  `#LongExposureNR: ${meta.longExposureNr ?? ''}`,
  `#AmbientC: ${meta.ambientC ?? ''}`,
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
    '#',
    '# g1/g2 = (t1/t2) * (Mean2 - BL2) / (Mean1 - BL1), with BL from the dark set.',
  );
  lines.push(
    [
      'ISO', 'ShutterSec', 'Aperture', 'ShutterGroup', 'File', 'Channel',
      'ColorIndex', 'N', 'Mean', 'Std', 'ClipFrac',
    ].join(','),
  );

  for (const f of frames) {
    f.channels.forEach((c, i) => {
      lines.push(
        [
          f.iso,
          f.shutter,
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
 * Entry 1, in the JPTC/2 schema the analysis side already reads.
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
    '# StdDiff is the standard deviation of A-B. Not halved, not corrected.',
    '# StdDiffClipped is the same after the sigma clip; the unclipped value is',
    '# kept beside it so the clip can be judged rather than trusted.',
  );
  lines.push(
    [
      'ISO', 'ShutterSec', 'Aperture', 'FileA', 'FileB', 'Channel', 'N',
      'MeanA', 'MeanB', 'StdA', 'StdB', 'StdAMasked',
      'StdDiff', 'StdDiffClipped', 'DiffMean', 'Rejected', 'ClipFrac',
    ].join(','),
  );

  for (const p of pairs) {
    p.channels.forEach((c, i) => {
      const m = c.measured;
      lines.push(
        [
          p.iso, p.shutter, p.aperture, p.fileA, p.fileB, CHANNEL_NAMES[i], m.n,
          scalar(m.meanA), scalar(m.meanB), scalar(m.stdA), scalar(m.stdB),
          scalar(m.stdAMasked), scalar(m.stdDiffRaw), scalar(m.stdDiffClipped),
          scalar(m.diffMean), m.rejected, scalar(m.clipFrac),
        ].join(','),
      );
    });
  }
  return lines.join('\n') + '\n';
};
