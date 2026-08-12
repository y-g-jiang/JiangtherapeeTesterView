/**
 * The order channels are written in, and what they are called.
 *
 * By COLOUR, not by position in the CFA cell: the crop hands over positions,
 * but a GBRG body puts red in the bottom-left, and reading cells in order
 * would silently label that column green.
 *
 * LibRaw's colour indices: 0 = R, 1 = the green sharing a row with red,
 * 2 = B, 3 = the other green.
 */
export const INTERCHANGE_COLORS = [0, 1, 3, 2];
export const INTERCHANGE_NAMES = ['R', 'G1', 'G2', 'B'];
