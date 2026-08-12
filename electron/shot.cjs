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

  const shot = async (name) => {
    await sleep(400);
    const img = await win.webContents.capturePage();
    const path = join(dir, `${String(++n).padStart(2, '0')}-${name}.png`);
    writeFileSync(path, img.toPNG());
    log('SHOT', path);
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

    await run(clickByText('电子快门', '.choice'));
    await run(clickByText('无损压缩', '.choice'));
    await run(clickByText('14 bit', '.choice'));
    await run(clickByText('无镜头，机身盖', '.choice'));
    await run(checkTheBox);
    await shot('mode-complete');

    for (const [tab, label] of [['dark', '3 · 黑场对'], ['gain', '2 · ISO 增益阶梯'], ['ptc', '1 · PTC 平场对']]) {
      if (!dirs[tab]) continue;
      log(`--- tab ${tab} -> ${dirs[tab]}`);
      process.env.JPTC_PICK_DIR = dirs[tab];
      process.env.JPTC_SAVE_DIR = join(dir, `saved-${tab}`);

      await run(clickByText(label, '.tab'));
      await sleep(300);
      await run(clickByText('选择文件夹…'));
      await run(waitFor(`!!document.querySelector('table.mini') || !!document.querySelector('.panel--error')`));
      await run(`window.scrollTo(0, document.body.scrollHeight); 'scrolled'`);
      await shot(`${tab}-scanned`);

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
