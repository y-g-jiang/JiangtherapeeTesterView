/**
 * One dark pair per job. Runs in a worker thread so the window stays alive and
 * so several pairs decode at once.
 *
 * Memory is the reason the pool is small rather than core-count wide: a single
 * job holds two unpacked frames plus three Float64 planes, which is a few
 * hundred megabytes. A contributor's machine may have 8 GB.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { analyseDarkPair } from '../src/analysis/darkPair.mjs';

const require = createRequire(import.meta.url);
const native = require(workerData.nativePath);

const openRaw = (path) => {
  const file = new native.RawFile();
  file.open(readFileSync(path));
  return file;
};

parentPort.on('message', (job) => {
  const started = Date.now();
  let a = null;
  let b = null;
  try {
    a = openRaw(job.pathA);
    b = openRaw(job.pathB);
    const result = analyseDarkPair(a, b, {
      cropW: job.cropW,
      cropH: job.cropH,
      window: job.window,
      spectra: job.spectra,
    });
    parentPort.postMessage({
      id: job.id,
      ok: true,
      result: { ...result, fileA: job.nameA, fileB: job.nameB },
      ms: Date.now() - started,
    });
  } catch (error) {
    parentPort.postMessage({
      id: job.id,
      ok: false,
      error: error?.message ?? String(error),
      ms: Date.now() - started,
    });
  } finally {
    try {
      a?.close();
      b?.close();
    } catch {
      /* a failed open leaves nothing to close */
    }
  }
});
