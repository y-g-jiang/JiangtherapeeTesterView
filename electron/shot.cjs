/*
 * Drive the window through a real run and capture it at each step.
 *
 * Loaded from main.cjs only when JPTC_SHOT is set. It clicks actual DOM
 * elements rather than poking React state, so what it exercises is the same
 * path a person would take.
 */
const { writeFileSync, mkdirSync, appendFileSync } = require('node:fs');
const { join } = require('node:path');

// On Windows a GUI-subsystem Electron has no console attached, so stdout goes
// nowhere. Everything this driver has to say goes to a file instead.
let LOG = 'out/shots/driver.log';
const log = (...parts) => {
  const line = parts.join(' ') + '\n';
  try {
    appendFileSync(LOG, line);
  } catch {
    /* the log is a convenience, never a reason to fail the run */
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickByText = (text, selector = 'button') => `
  (() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(n => n.textContent.includes(${JSON.stringify(text)}));
    if (!el) return 'NOT FOUND: ' + ${JSON.stringify(text)};
    el.click();
    return 'clicked: ' + ${JSON.stringify(text)};
  })()
`;

const typeInto = (labelText, value) => `
  (() => {
    const field = [...document.querySelectorAll('.field')]
      .find(f => f.querySelector('label') && f.querySelector('label').textContent.includes(${JSON.stringify(labelText)}));
    const input = field && field.querySelector('input');
    if (!input) return 'NO FIELD: ' + ${JSON.stringify(labelText)};
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return ${JSON.stringify(labelText)} + ' = ' + input.value;
  })()
`;

/** For a field holding more than one input, such as width and height. */
const typeIntoNth = (labelText, index, value) => `
  (() => {
    const field = [...document.querySelectorAll('.field')]
      .find(f => f.querySelector('label') && f.querySelector('label').textContent.includes(${JSON.stringify(labelText)}));
    const input = field && field.querySelectorAll('input')[${index}];
    if (!input) return 'NO INPUT ' + ${index} + ' IN: ' + ${JSON.stringify(labelText)};
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return ${JSON.stringify(labelText)} + '[' + ${index} + '] = ' + input.value;
  })()
`;

const typeIntoLens = (value) => `
  (() => {
    const input = document.querySelector('.choice-input');
    if (!input) return 'no lens input';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'lens = ' + input.value;
  })()
`;

/** The crop inputs live in the entry card, not the mode form. */
const setCrop = (w, h) => `
  (() => {
    const inputs = [...document.querySelectorAll('.inline input[type=number]')];
    if (inputs.length === 0) return 'no crop inputs';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const put = (el, v) => {
      setter.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    put(inputs[0], ${JSON.stringify(w)});
    if (inputs[1]) put(inputs[1], ${JSON.stringify(h)});
    return 'crop = ' + inputs.map(i => i.value).join('x');
  })()
`;

const checkTheBox = `
  (() => {
    const box = document.querySelector('.check input[type=checkbox]');
    if (!box) return 'no checkbox';
    if (!box.checked) box.click();
    return 'checked=' + box.checked;
  })()
`;

const waitFor = (jsCondition, timeoutMs = 600000) => `
  (async () => {
    const start = Date.now();
    while (Date.now() - start < ${timeoutMs}) {
      if (${jsCondition}) return 'ready after ' + (Date.now() - start) + 'ms';
      await new Promise(r => setTimeout(r, 250));
    }
    return 'TIMEOUT';
  })()
`;

module.exports = async function runShots(win, app) {
  const dir = process.env.JPTC_SHOT || 'out/shots';
  mkdirSync(dir, { recursive: true });
  LOG = join(dir, 'driver.log');
  writeFileSync(LOG, `driver started ${new Date().toISOString()}
`);
  let n = 0;

  /*
   * Chromium stops producing frames for a window it thinks nobody is looking
   * at, and capturePage then hands back the last one it did produce. That is
   * worse than the empty PNG below, because a stale frame is a plausible
   * screenshot of the wrong step. So: force a repaint, and if the bytes come
   * back identical to the previous shot, say so rather than saving a lie.
   */
  let previous = null;

  const shot = async (name) => {
    await sleep(400);
    win.webContents.invalidate();
    await sleep(250);
    let png = (await win.webContents.capturePage()).toPNG();

    if (previous && png.equals(previous)) {
      win.showInactive();
      win.webContents.invalidate();
      await sleep(700);
      png = (await win.webContents.capturePage()).toPNG();
    }
    const repeated = previous !== null && png.equals(previous);
    previous = png;

    const img = { toPNG: () => png, isEmpty: () => png.length === 0, getSize: () => ({ width: 0, height: 0 }) };
    const path = join(dir, `${String(++n).padStart(2, '0')}-${name}.png`);
    writeFileSync(path, png);
    if (repeated) log('WARNING: identical to the previous frame --', path);
    /*
     * capturePage goes through the compositor, which Windows stops driving
     * when the display sleeps -- the run is fine and the PNG is zero bytes.
     * The text of the panel comes from the DOM and does not care, so it is
     * recorded alongside and is what a check should read.
     */
    log('SHOT', path, png.length === 0 ? '(EMPTY -- compositor asleep)' : `${png.length} bytes`);
    const text = await win.webContents.executeJavaScript(`
      (() => {
        const card = [...document.querySelectorAll('.card')]
          .find(c => c.querySelector('h2') && c.querySelector('h2').textContent.includes('入口'));
        return card ? card.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 900) : '(no entry card)';
      })()
    `);
    log('TEXT ----\n' + text + '\n----');
  };

  const run = async (js) => {
    const out = await win.webContents.executeJavaScript(js);
    log('  >', out);
    return out;
  };

  const dirs = JSON.parse(process.env.JPTC_PICK_DIRS || '{}');

  try {
    await sleep(1500);
    await shot('gate');

    const size = (process.env.JPTC_SHOT_SIZE || '6000x4000').split('x');
    await run(typeIntoNth('JPEG 输出像素', 0, size[0]));
    await run(typeIntoNth('JPEG 输出像素', 1, size[1]));
    await run(typeInto('快门类型', process.env.JPTC_SHOT_SHUTTER || '电子快门'));
    await run(typeInto('压缩', process.env.JPTC_SHOT_COMPRESSION || '无损压缩'));
    // The mode fields end up in the header and the filename, so a run that has
    // to match an existing set needs them set to that set's strings.
    if (process.env.JPTC_SHOT_LENS) {
      await run(clickByText('装着镜头', '.choice'));
      await run(typeIntoLens(process.env.JPTC_SHOT_LENS));
    } else {
      await run(clickByText('无镜头，机身盖', '.choice'));
    }
    await run(checkTheBox);
    await shot('mode-complete');

    for (const [tab, label] of [['dark', '3 · 黑场对'], ['gain', '2 · ISO 增益阶梯'], ['ptc', '1 · PTC 平场对']]) {
      if (!dirs[tab]) continue;
      log(`--- tab ${tab} -> ${dirs[tab]}`);
      process.env.JPTC_PICK_DIR = dirs[tab];
      process.env.JPTC_SAVE_DIR = join(dir, `saved-${tab}`);

      await run(clickByText(label, '.tab'));
      await sleep(300);
      await run(clickByText('选择 RAW 文件…'));
      await run(waitFor(`!!document.querySelector('table.mini') || !!document.querySelector('.panel--error')`));
      // What the scan had to say, before the table it found. On a long ladder
      // the notes scroll off the top, and they are the part worth reading.
      await run(`
        (() => {
          const el = document.querySelector('.panel--warn, .panel--error, .card .panel');
          if (!el) return 'nothing to scroll to';
          el.scrollIntoView({ block: 'center' });
          return 'scrolled to notes';
        })()
      `);
      await shot(`${tab}-notes`);
      await run(`window.scrollTo(0, document.body.scrollHeight); 'scrolled'`);
      await shot(`${tab}-scanned`);

      if (process.env.JPTC_SHOT_CROP) {
        const [w, h] = process.env.JPTC_SHOT_CROP.split('x');
        await run(setCrop(w, h));
      }

      const canRun = await run(`!!([...document.querySelectorAll('button')].find(b => b.textContent.includes('开始处理')))`);
      if (!canRun) { log(`  (${tab}: nothing runnable, skipping)`); continue; }

      await run(clickByText('开始处理'));
      await run(waitFor(`[...document.querySelectorAll('h3')].some(h => h.textContent.includes('结果'))`));
      await run(`window.scrollTo(0, document.body.scrollHeight); 'scrolled'`);
      await shot(`${tab}-results`);

      await run(clickByText('保存 CSV…'));
      await run(waitFor(`!!document.querySelector('.panel--ok')`, 60000));
      await run(`window.scrollTo(0, document.body.scrollHeight); 'scrolled'`);
      await shot(`${tab}-saved`);
    }
  } catch (error) {
    log('SHOT SEQUENCE FAILED:', error?.stack ?? error?.message ?? String(error));
  } finally {
    await sleep(600);
    app.quit();
  }
};
