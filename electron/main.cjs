/*
 * The main process is CommonJS on purpose.
 *
 * Electron 33 on this machine cannot load an ESM main at all -- even a file
 * containing nothing but `import { app } from 'electron'` dies in the CJS
 * preparse. The main process is a thin shell anyway, so it is CJS and the
 * compute modules, which stay ESM, are pulled in with dynamic import().
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { join, resolve, basename, extname } = require('node:path');
const {
  readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, appendFileSync,
} = require('node:fs');

/**
 * A GUI-subsystem Electron on Windows has no console attached, so console.log
 * from the main process goes nowhere. Anything worth diagnosing goes here.
 */
const bootLog = (...parts) => {
  if (!process.env.JPTC_LOG) return;
  try {
    appendFileSync(process.env.JPTC_LOG, parts.join(' ') + '\n');
  } catch {
    /* diagnostics must never be the thing that breaks the run */
  }
};
bootLog('main start', process.versions.electron, 'shot=', process.env.JPTC_SHOT ?? '(unset)');
process.on('uncaughtException', (e) => bootLog('UNCAUGHT', e?.stack ?? String(e)));

const { resolveNativePath } = require('../src/nativePath.cjs');
const NATIVE_PATH = resolveNativePath();
bootLog('native path', NATIVE_PATH);

let native;
try {
  native = require(NATIVE_PATH);
  bootLog('native loaded', native.version);
} catch (error) {
  // A throw during the main module's own evaluation escapes the
  // uncaughtException handler and kills the process with nothing on screen, so
  // this failure has to be reported here or the app looks like it vanished.
  bootLog('NATIVE LOAD FAILED', error?.message ?? String(error));
  const { dialog: d } = require('electron');
  app.whenReady().then(() => {
    d.showErrorBox(
      'LibRaw 插件加载失败',
      `${error?.message ?? error}\n\n` +
        `路径: ${NATIVE_PATH}\n\n` +
        '多半是插件针对的 Node ABI 与 Electron 不一致。请运行:\n' +
        '  npm run build:native:electron',
    );
    app.quit();
  });
}

const RAW_EXTENSIONS = new Set([
  '.nef', '.nrw', '.cr2', '.cr3', '.crw', '.arw', '.srf', '.sr2', '.rw2',
  '.raf', '.orf', '.pef', '.dng', '.raw', '.rwl', '.iiq', '.3fr', '.mos',
  '.erf', '.mrw', '.kdc', '.dcr', '.x3f',
]);

/** Lazily loaded ESM modules, cached after the first await. */
let esm = null;
const loadEsm = async () => {
  if (esm) return esm;
  const [poolMod, pairing, darkCsv, isoGain, ptcPair, entryCsv] = await Promise.all([
    import('./workerPool.mjs'),
    import('../src/analysis/pairing.mjs'),
    import('../src/output/darkCsv.mjs'),
    import('../src/analysis/isoGain.mjs'),
    import('../src/analysis/ptcPair.mjs'),
    import('../src/output/entryCsv.mjs'),
  ]);
  esm = { ...poolMod, ...pairing, ...darkCsv, ...isoGain, ...ptcPair, ...entryCsv };
  return esm;
};

let pool = null;
let win = null;
let lastRun = null;

const createWindow = () => {
  win = new BrowserWindow({
    width: 1180,
    height: 880,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#f2f2ef',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(join(__dirname, '../dist/renderer/index.html'));
  }
};

app.whenReady().then(() => {
  bootLog('ready');
  createWindow();
  bootLog('window created');
  if (process.env.JPTC_SHOT) {
    win.webContents.on('did-finish-load', () => {
      bootLog('did-finish-load; starting driver');
      require('./shot.cjs')(win, app).catch((e) => bootLog('driver threw', e?.stack ?? String(e)));
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) =>
      bootLog('did-fail-load', code, desc, url),
    );
  }
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', async () => {
  await pool?.dispose();
  app.quit();
});

// --------------------------------------------------------------------------
// scanning
// --------------------------------------------------------------------------

const listRawFiles = (dir) =>
  readdirSync(dir)
    .filter((name) => RAW_EXTENSIONS.has(extname(name).toLowerCase()))
    .map((name) => join(dir, name))
    .sort();

/**
 * Read enough of a frame to sort and judge it: metadata, the measured
 * quantisation step, and how far a centre sample sits above the frame's own
 * black level -- which is what separates a real dark frame from a lens cap
 * that was not on.
 */
const scanFrame = (path) => {
  const file = new native.RawFile();
  file.open(readFileSync(path));
  try {
    const meta = file.metadata();
    const crop = file.centreCrop(512);
    let sum = 0;
    let clipped = 0;
    for (let i = 0; i < crop.data.length; i++) {
      sum += crop.data[i];
      if (crop.data[i] >= meta.maximum) clipped++;
    }
    const mean = sum / crop.data.length;
    const black = meta.black + (meta.cblack[0] ?? 0);
    return {
      ...meta,
      centreAboveBlack: mean - black,
      centreClipFrac: clipped / crop.data.length,
    };
  } finally {
    file.close();
  }
};

ipcMain.handle('pick-folder', async () => {
  // Test seam: a native dialog cannot be driven from a script, so an
  // environment variable stands in for the user's choice when one is set.
  if (process.env.JPTC_PICK_DIR) return process.env.JPTC_PICK_DIR;
  const res = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: '选择放着 RAW 的文件夹',
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('scan-folder', async (_event, dir, entry = 'dark') => {
  const { groupDarkPairs, groupGainLadder, groupPtcPairs } = await loadEsm();
  const paths = listRawFiles(dir);
  if (paths.length === 0) {
    return { dir, frames: [], pairs: [], rejected: [], problems: [], failures: [],
      error: '这个文件夹里没有找到 RAW 文件。' };
  }

  const frames = [];
  const failures = [];
  for (let i = 0; i < paths.length; i++) {
    const name = basename(paths[i]);
    win?.webContents.send('scan-progress', { done: i, total: paths.length, name });
    try {
      frames.push({ name, path: paths[i], meta: scanFrame(paths[i]) });
    } catch (error) {
      failures.push({ name, message: error?.message ?? String(error) });
    }
  }
  win?.webContents.send('scan-progress', { done: paths.length, total: paths.length, name: '' });

  const grouped =
    entry === 'gain' ? groupGainLadder(frames)
    : entry === 'ptc' ? groupPtcPairs(frames)
    : groupDarkPairs(frames);
  return { dir, entry, frames, failures, ...grouped };
});

// --------------------------------------------------------------------------
// running
// --------------------------------------------------------------------------

ipcMain.handle('run-entry', async (_event, request) => {
  const { AnalysisPool, defaultConcurrency } = await loadEsm();
  pool ??= new AnalysisPool({
    nativePath: NATIVE_PATH,
    concurrency: request.concurrency || defaultConcurrency(),
  });

  const results = [];
  let done = 0;
  const total = request.jobs.length;

  await Promise.all(
    request.jobs.map(async (job) => {
      try {
        results.push(await pool.run({ ...job, kind: request.entry }));
      } catch (error) {
        results.push({ ...job, failed: error?.message ?? String(error) });
      } finally {
        done++;
        win?.webContents.send('run-progress', { done, total });
      }
    }),
  );

  const order = request.entry === 'gain'
    ? (a, b) => a.iso - b.iso || b.shutter - a.shutter
    : request.entry === 'ptc'
      ? (a, b) => b.shutter - a.shutter
      : (a, b) => a.iso - b.iso;
  results.sort(order);
  lastRun = { entry: request.entry, results, request };

  // Spectra are megabytes; the window only needs the scalars.
  const light = results.map((r) =>
    r.failed || !r.channels
      ? r
      : {
          ...r,
          channels: r.channels.map(({ spectra, ...rest }) => ({
            ...rest,
            bins: spectra ? { h: spectra.single.h.length, v: spectra.single.v.length } : null,
          })),
        },
  );
  return { entry: request.entry, results: light, concurrency: pool.size };
});

const baseMeta = (first, mode, request) => ({
  toolVersion: app.getVersion(),
  librawVersion: first.librawVersion,
  generated: new Date().toISOString(),
  camera: first.camera,
  firmware: mode.firmware,
  lens: mode.lens,
  shutterType: mode.shutterType,
  compression: mode.compression,
  longExposureNr: mode.longExposureNr ? 'off (declared)' : 'NOT DECLARED OFF',
  ambientC: mode.ambientC,
  cfaPattern: first.cfaPattern,
  adcStep: first.quantisationStep,
  curveIsIdentity: first.curveIsIdentity,
  rawWidth: first.rawWidth,
  rawHeight: first.rawHeight,
  black: first.black,
  maximum: first.maximum,
  ...request,
});

ipcMain.handle('save-results', async (_event, { mode, outDir }) => {
  const esmMods = await loadEsm();
  const { buildFileStem, writeDarkScalarCsv, writeDarkSpectrumCsv,
          writeIsoGainCsv, writePtcCsv } = esmMods;
  if (!lastRun) throw new Error('还没有可保存的结果。');
  const ok = lastRun.results.filter((r) => !r.failed);
  if (ok.length === 0) throw new Error('没有成功的结果可以保存。');

  let target = outDir || process.env.JPTC_SAVE_DIR;
  if (!target) {
    const res = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '保存到哪个文件夹',
    });
    if (res.canceled) return null;
    target = res.filePaths[0];
  }
  mkdirSync(target, { recursive: true });

  const first = ok[0];
  const isos = [...new Set(ok.map((r) => r.iso))].sort((a, b) => a - b);
  const isoRange = isos.length > 1 ? `${isos[0]}-${isos[isos.length - 1]}` : String(isos[0]);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const stem = buildFileStem(mode, first.camera, isoRange, lastRun.entry, date);

  const files = [];
  const put = (suffix, text) => {
    const p = join(target, `${stem}_${suffix}.csv`);
    writeFileSync(p, text);
    files.push({ path: p, name: basename(p), size: statSync(p).size });
  };

  const req = lastRun.request;
  if (lastRun.entry === 'dark') {
    const meta = baseMeta(first, mode, {
      cropW: req.cropW, cropH: req.cropH,
      planeW: first.channels[0].width, planeH: first.channels[0].height,
      clipSigma: first.clip.sigma, clipVarianceFactor: first.clip.varianceFactor,
      window: req.window,
    });
    put('scalars', writeDarkScalarCsv(ok, meta));
    put('spectrum-h', writeDarkSpectrumCsv(ok, meta, 'h'));
    put('spectrum-v', writeDarkSpectrumCsv(ok, meta, 'v'));
  } else if (lastRun.entry === 'gain') {
    const meta = baseMeta(first, mode, {
      ladder: req.ladder, cropW: req.cropW, cropH: req.cropH,
      planeW: first.channels[0].width, planeH: first.channels[0].height,
    });
    put('levels', writeIsoGainCsv(ok, meta));
  } else {
    const meta = baseMeta(first, mode, {
      iso: first.iso, cropSize: first.cropSize, planeSize: first.planeSize,
      clipSigma: first.clip.sigma, clipVarianceFactor: first.clip.varianceFactor,
    });
    put('ptc', writePtcCsv(ok, meta));
  }

  return { dir: target, files };
});

ipcMain.handle('reveal', async (_event, path) => shell.showItemInFolder(path));

ipcMain.handle('system-info', async () => {
  const { defaultConcurrency } = await loadEsm();
  return { libraw: native.version, concurrency: defaultConcurrency(), version: app.getVersion() };
});
