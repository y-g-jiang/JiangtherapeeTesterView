import { describe, expect, it } from 'vitest';
import { EMPTY_MODE, modeIsComplete, parseDimension } from '../ModeForm.jsx';

/**
 * The output size is the scale every comparison is normalised against, so the
 * gate has to reject the ways it can arrive wrong -- all of which look like a
 * filled-in field.
 */
describe('parseDimension', () => {
  it('takes a whole number of pixels', () => {
    expect(parseDimension('6000')).toBe(6000);
    expect(parseDimension(' 4000 ')).toBe(4000);
  });

  it('refuses everything that is not one', () => {
    for (const bad of ['', '   ', '0', '-4000', '4000.5', 'abc', '4,000', '6000x4000', null, undefined]) {
      expect(parseDimension(bad)).toBeNull();
    }
  });

  it('refuses a number too large to be a picture', () => {
    // A pasted total pixel count instead of one side.
    expect(parseDimension('24000000')).toBeNull();
  });
});

describe('modeIsComplete', () => {
  const filled = {
    ...EMPTY_MODE,
    shutterType: '机械快门',
    compression: '无损压缩',
    lens: 'none-bodycap',
    declaredOff: true,
    imageWidth: '6000',
    imageHeight: '4000',
  };

  it('passes only when every required field is there', () => {
    expect(modeIsComplete(filled)).toBe(true);
  });

  it('stays locked without the output size', () => {
    expect(modeIsComplete({ ...filled, imageWidth: '' })).toBe(false);
    expect(modeIsComplete({ ...filled, imageHeight: '' })).toBe(false);
    expect(modeIsComplete({ ...filled, imageHeight: '0' })).toBe(false);
    expect(modeIsComplete(EMPTY_MODE)).toBe(false);
  });

  it('still requires the fields it required before', () => {
    expect(modeIsComplete({ ...filled, shutterType: '  ' })).toBe(false);
    expect(modeIsComplete({ ...filled, compression: '' })).toBe(false);
    expect(modeIsComplete({ ...filled, lens: '' })).toBe(false);
    expect(modeIsComplete({ ...filled, declaredOff: false })).toBe(false);
  });

  it('has one declaration, covering both switches', () => {
    /*
     * Long-exposure NR and stabilisation are both settings no file reliably
     * records, and both have to be off for the same run. One tick, one field:
     * two checkboxes would let a set go out half-declared, and the CSV would
     * have no way to say which half.
     */
    expect(Object.keys(EMPTY_MODE).filter((k) => k.toLowerCase().includes('nr'))).toEqual([
      'highIsoNr',
    ]);
    expect('declaredOff' in EMPTY_MODE).toBe(true);
  });
});
