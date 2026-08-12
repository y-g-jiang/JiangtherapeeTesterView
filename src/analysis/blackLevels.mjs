/**
 * The black levels a PTC table needs, taken from the dark set.
 *
 * A PTC curve is signal against noise, and signal means the level above black.
 * The collector never subtracts it -- that stays the analyst's step -- but the
 * number has to travel with the table, or the table cannot be read at all.
 *
 * It comes from entry 3, which is why entry 3 is shot first. Measured, per ISO,
 * per channel, on the same body: not the vendor's constant, which is an integer
 * and, on the body in front of me, eight DN off by ISO 51200.
 */

/**
 * The interchange order. It is by COLOUR, not by position in the CFA cell:
 * a GBRG body puts red in the bottom-left, and reading its cells in order
 * would silently label that column green.
 *
 * LibRaw's colour indices: 0 = R, 1 = the green sharing a row with red,
 * 2 = B, 3 = the other green.
 */
export const INTERCHANGE_COLORS = [0, 1, 3, 2];
export const INTERCHANGE_NAMES = ['R', 'G1', 'G2', 'B'];

/**
 * @param {Array} darkResults results of a dark run, each with iso and channels
 * @returns {Map<number, number[]>} ISO to [R, G1, G2, B] black levels
 */
export const blackLevelsByIso = (darkResults) => {
  const out = new Map();

  for (const result of darkResults ?? []) {
    if (result.failed || !Array.isArray(result.channels)) continue;

    const values = INTERCHANGE_COLORS.map((color) => {
      const channel = result.channels.find((c) => c.color === color);
      return channel?.measured?.blackA;
    });
    // All four or none: a partial header would be worse than a missing one,
    // because it would still parse.
    if (values.some((v) => !Number.isFinite(v))) continue;
    out.set(result.iso, values);
  }

  return out;
};

/**
 * Merge a fresh dark run into what is already known, keeping ISOs the new run
 * did not cover. Re-measuring an ISO replaces it: the newer measurement is on
 * the newer sensor temperature and the newer firmware.
 */
export const mergeBlackLevels = (existing, fresh, meta = {}) => {
  const isos = { ...(existing?.isos ?? {}) };
  for (const [iso, values] of fresh) isos[String(iso)] = values;
  return {
    camera: meta.camera ?? existing?.camera ?? '',
    measuredAt: meta.measuredAt ?? existing?.measuredAt ?? '',
    source: meta.source ?? existing?.source ?? '',
    isos,
  };
};

/** The four numbers for one ISO, or null if that ISO was never shot dark. */
export const blackLevelFor = (store, iso) => {
  const values = store?.isos?.[String(iso)];
  return Array.isArray(values) && values.length === 4 ? values : null;
};
