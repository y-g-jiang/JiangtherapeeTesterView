/**
 * One job per message. Runs in a worker thread so the window stays alive and
 * so several frames decode at once.
 *
 * Memory is why the pool is small rather than core-count wide: a dark job
 * holds two unpacked frames plus three Float64 planes, a few hundred megabytes.
 * A contributor's machine may have 8 GB.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyseDarkPair } from '../src/analysis/darkPair.mjs';
import { analyseGainFrame } from '../src/analysis/isoGain.mjs';
import { analysePtcPair } from '../src/analysis/ptcPair.mjs';

const require = createRequire(import.meta.url);
const native = require(workerData.nativePath);

const openRaw = (path) => {
  const file = new native.RawFile();
  file.open(readFileSync(path));
  return file;
};

const handlers = {
  dark: (job) => {
    const a = openRaw(job.pathA);
    const b = openRaw(job.pathB);
    try {
      return {
        ...analyseDarkPair(a, b, {
          cropW: job.cropW,
          cropH: job.cropH,
          window: job.window,
          spectra: job.spectra,
        }),
        fileA: job.nameA,
        fileB: job.nameB,
      };
    } finally {
      a.close();
      b.close();
    }
  },

  gain: (job) => {
    const a = openRaw(job.path);
    try {
      return {
        ...analyseGainFrame(a, { cropW: job.cropW, cropH: job.cropH }),
        file: job.name,
        shutterGroup: job.shutterGroup,
      };
    } finally {
      a.close();
    }
  },

  ptc: (job) => {
    const a = openRaw(job.pathA);
    const b = openRaw(job.pathB);
    try {
      return {
        ...analysePtcPair(a, b, { cropSize: job.cropSize }),
        fileA: job.nameA,
        fileB: job.nameB,
      };
    } finally {
      a.close();
      b.close();
    }
  },
};

parentPort.on('message', (job) => {
  const started = Date.now();
  try {
    const handler = handlers[job.kind];
    if (!handler) throw new Error(`unknown job kind: ${job.kind}`);
    parentPort.postMessage({ id: job.id, ok: true, result: handler(job), ms: Date.now() - started });
  } catch (error) {
    parentPort.postMessage({
      id: job.id,
      ok: false,
      error: error?.message ?? String(error),
      ms: Date.now() - started,
    });
  }
});
