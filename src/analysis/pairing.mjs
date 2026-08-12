/**
 * Grouping a folder of frames into pairs, and refusing the ones that cannot be
 * used.
 *
 * The whole point of doing this in the collector is that a problem found here
 * costs one reshoot, while the same problem found after the files are mailed
 * costs a round trip and the contributor's patience.
 */

import { shutterText } from './shutterText.mjs';
export const CHECK_LEVELS = { error: 'error', warning: 'warning' };

/**
 * A dark frame should be as short as the body can manage.
 *
 * Not mainly for dark current -- at these times that is a hundredth of an
 * electron. It is the light leak. A body cap is not a lid and the mount is not
 * a seal, and whatever gets past them accumulates in proportion to the
 * exposure: 1/200 s is twenty times more of it than 1/4000 s. The leak is also
 * the one contamination that looks like a perfectly ordinary noise floor,
 * which is why it gets said loudly rather than caught later.
 *
 * Slower than this and the set gets a prominent note. It is never a refusal:
 * a cap that really is opaque gives the same numbers at any speed, and asking
 * for a reshoot on a suspicion would cost more than it is worth.
 */
export const DARK_FAST_SHUTTER_SEC = 1 / 1000;


/**
 * @param {{name: string, meta: object}[]} frames  one entry per RAW, metadata already read
 * @param {{ requireDark?: boolean, maxPairGapSec?: number }} [options]
 */
export const groupDarkPairs = (frames, options = {}) => {
  const maxGap = options.maxPairGapSec ?? 900;
  const requireDark = options.requireDark ?? true;

  const problems = [];
  const groups = new Map();

  for (const frame of frames) {
    const key = String(frame.meta.iso);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(frame);
  }

  const pairs = [];
  const rejected = [];

  const sortedIsos = [...groups.keys()].sort((a, b) => Number(a) - Number(b));

  for (const iso of sortedIsos) {
    const list = groups.get(iso).slice().sort((x, y) => x.meta.timestamp - y.meta.timestamp);

    if (list.length !== 2) {
      rejected.push({
        iso: Number(iso),
        files: list.map((f) => f.name),
        level: CHECK_LEVELS.error,
        message:
          list.length < 2
            ? `ISO ${iso} 只有 ${list.length} 张。每个 ISO 需要恰好两张——差分需要一对。`
            : `ISO ${iso} 有 ${list.length} 张。每个 ISO 需要恰好两张；多出来的请从选择里去掉。`,
      });
      continue;
    }

    const [a, b] = list;
    const checks = [];

    const same = (field, label, format = (v) => v) => {
      if (a.meta[field] !== b.meta[field]) {
        checks.push({
          level: CHECK_LEVELS.error,
          message: `${label}不一致：${format(a.meta[field])} 对 ${format(b.meta[field])}。一对之内必须完全相同。`,
        });
      }
    };

    same('model', '机身');
    same('shutter', '快门', shutterText);
    same('aperture', '光圈', (v) => `f/${v}`);
    same('rawWidth', 'RAW 宽度');
    same('rawHeight', 'RAW 高度');
    same('black', '黑电平');
    if (a.meta.quantisation.step !== b.meta.quantisation.step) {
      checks.push({
        level: CHECK_LEVELS.error,
        message: `量化步长不一致：${a.meta.quantisation.step} 对 ${b.meta.quantisation.step}。两张可能不是同一种压缩设置。`,
      });
    }

    const gap = Math.abs(a.meta.timestamp - b.meta.timestamp);
    if (gap > maxGap) {
      checks.push({
        level: CHECK_LEVELS.warning,
        message: `两张相隔 ${Math.round(gap / 60)} 分钟。传感器温度会在这段时间里变化，暗电流跟着变；建议连拍。`,
      });
    }

    if (requireDark) {
      // "Is it actually dark" — the frame's own mean should sit on the black
      // level. A light leak or a forgotten lens cap shows up here and nowhere
      // else until the numbers are already wrong.
      for (const f of [a, b]) {
        const above = f.meta.centreAboveBlack;
        if (above !== undefined && above > 8) {
          checks.push({
            level: CHECK_LEVELS.error,
            message: `${f.name} 比黑电平高 ${above.toFixed(1)} DN，这不是黑场。请盖好机身盖，并确认没有漏光。`,
          });
        } else if (above !== undefined && above > 1.5) {
          checks.push({
            level: CHECK_LEVELS.warning,
            message: `${f.name} 比黑电平高 ${above.toFixed(2)} DN。可能有轻微漏光，或者是长曝光的暗电流。`,
          });
        }
      }
    }

    if (a.meta.shutter > DARK_FAST_SHUTTER_SEC) {
      checks.push({
        level: CHECK_LEVELS.warning,
        message:
          `快门 ${shutterText(a.meta.shutter)}，比建议的慢。黑场请用机身能到的最快快门。`,
      });
    }

    if (!a.meta.quantisation.linearisationCurve.isIdentity) {
      checks.push({
        level: CHECK_LEVELS.warning,
        message:
          '这个文件是压缩过的（线性化曲线不是恒等），量化步长随信号变化。数据仍然可用，但请把压缩类型如实填成有损。',
      });
    }

    const errors = checks.filter((c) => c.level === CHECK_LEVELS.error);
    if (errors.length > 0) {
      rejected.push({ iso: Number(iso), files: [a.name, b.name], level: CHECK_LEVELS.error, checks });
    } else {
      pairs.push({
        iso: Number(iso),
        shutter: a.meta.shutter,
        a,
        b,
        warnings: checks.filter((c) => c.level === CHECK_LEVELS.warning),
      });
    }
  }

  // A ladder with holes is still usable, but the gap should be visible.
  if (pairs.length >= 2) {
    const isos = pairs.map((p) => p.iso);
    for (let i = 1; i < isos.length; i++) {
      const ratio = isos[i] / isos[i - 1];
      if (ratio > 2.2) {
        problems.push({
          level: CHECK_LEVELS.warning,
          message: `ISO ${isos[i - 1]} 到 ${isos[i]} 之间跨了 ${Math.log2(ratio).toFixed(1)} 档。中间缺档不影响已有数据，但曲线会有空洞。`,
        });
      }
    }
  }

  const slow = pairs.filter((p) => p.shutter > DARK_FAST_SHUTTER_SEC);
  if (slow.length > 0) {
    const slowest = slow.reduce((worst, p) => (p.shutter > worst.shutter ? p : worst), slow[0]);
    problems.push({
      level: CHECK_LEVELS.warning,
      message:
        `${slow.length === pairs.length ? '这组黑场全部' : `${slow.length}/${pairs.length} 对`}` +
        `用了比 ${shutterText(DARK_FAST_SHUTTER_SEC)} 慢的快门，最慢 ${shutterText(slowest.shutter)}` +
        `（ISO ${slowest.iso}）。黑场请用机身能达到的最快快门：机身盖不是密封件，` +
        `漏进来的光按曝光时间累积，${shutterText(slowest.shutter)} 是 1/4000s 的 ` +
        `${Math.round(slowest.shutter * 4000)} 倍。数据照常可用，不必重拍——` +
        `但如果黑电平或读噪偏高，先怀疑这里。`,
    });
  }

  const bodies = new Set(frames.map((f) => f.meta.model));
  if (bodies.size > 1) {
    problems.push({
      level: CHECK_LEVELS.error,
      message: `这批文件来自 ${bodies.size} 台不同机身（${[...bodies].join('、')}）。一次只处理一台。`,
    });
  }

  return { pairs, rejected, problems };
};

/**
 * The output file name. Mode travels in the name as well as the header; when
 * they disagree the header wins, because a name gets edited and a header does
 * not.
 */
export const buildFileStem = (mode, camera, isoRange, entry, date) => {
  /*
   * Strip only what a filesystem actually forbids, and keep the rest.
   *
   * An ASCII-only filter looked tidy right up until shutter type and
   * compression became free text: a Chinese entry was reduced to an empty
   * string and then dropped, so the name quietly lost the two fields it exists
   * to carry. The header still holds the authoritative copy either way.
   */
  const clean = (s) =>
    String(s ?? '')
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/^[-_.]+|[-_.]+$/g, '') || 'na';

  return [
    clean(camera),
    clean(mode.firmware ? `fw${mode.firmware}` : ''),
    `iso${clean(isoRange)}`,
    clean(mode.shutterType),
    clean(mode.compression),
    clean(entry),
    clean(date),
  ]
    .filter((p) => p && p !== 'na')
    .join('_');
};
