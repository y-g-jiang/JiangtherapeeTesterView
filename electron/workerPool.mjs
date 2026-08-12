import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * How many frames to decode at once.
 *
 * Half the logical cores is the house rule, but a RAW job is memory-heavy
 * rather than CPU-heavy: two unpacked frames plus three Float64 planes runs to
 * a few hundred megabytes each. Twelve of those at once would ask for three
 * gigabytes on a machine that might have eight, so the pool is capped. The
 * batch is I/O bound anyway -- measured at 1132 ms to read a frame against
 * 336 ms to unpack it -- so the extra threads would mostly wait.
 */
export const defaultConcurrency = () => {
  const cores = os.cpus()?.length ?? 2;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
};

export class AnalysisPool {
  constructor({ nativePath, concurrency = defaultConcurrency() }) {
    this.nativePath = nativePath;
    this.size = concurrency;
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pending = new Map();
    this.nextId = 1;
  }

  spawn() {
    const worker = new Worker(resolve(here, 'analysisWorker.mjs'), {
      workerData: { nativePath: this.nativePath },
    });
    worker.on('message', (msg) => {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      this.idle.push(worker);
      this.drain();
      if (!entry) return;
      if (msg.ok) entry.resolve({ ...msg.result, ms: msg.ms });
      else entry.reject(new Error(msg.error));
    });
    worker.on('error', (error) => {
      // A dead worker takes its job with it; fail that job and replace it so
      // one bad file cannot stall the batch.
      for (const [id, entry] of this.pending) {
        if (entry.worker === worker) {
          this.pending.delete(id);
          entry.reject(error);
        }
      }
      this.workers = this.workers.filter((w) => w !== worker);
      this.idle = this.idle.filter((w) => w !== worker);
      if (this.workers.length < this.size) this.spawn();
      this.drain();
    });
    this.workers.push(worker);
    this.idle.push(worker);
    return worker;
  }

  drain() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop();
      const job = this.queue.shift();
      const entry = this.pending.get(job.id);
      if (entry) entry.worker = worker;
      worker.postMessage(job);
    }
  }

  run(job) {
    while (this.workers.length < this.size) this.spawn();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker: null });
      this.queue.push({ ...job, id });
      this.drain();
    });
  }

  async dispose() {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
    this.idle = [];
  }
}
