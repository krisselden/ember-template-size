const {
  Worker,
  MessageChannel,
  isMainThread,
  parentPort,
  workerData
} = require("worker_threads");
const fs = require("fs");
const {
  cancellableRace,
  combineRaceCancellation,
  throwIfCancelled,
  disposablePromise
} = require("race-cancellation");
const util = require("./util");

if (isMainThread) {
  // on the main thread, export a function that starts the workers
  module.exports = compileTemplates;
} else {
  const { gzipSync, brotliCompressSync, constants } = require("zlib");
  const sharedCompilers = getCompilers(workerData);
  const { port1, port2 } = new MessageChannel();
  if (parentPort === null) throw new Error("parentPort missing");
  parentPort.postMessage(port1, [port1]);
  port2.on("message", filename => {
    const buffer = fs.readFileSync(filename);
    const original = buffer.length;
    const source = buffer.toString("utf8");
    /** @type {CompileResult[]} */
    try {
      const results = sharedCompilers.map(compiler => {
        const compiled = Buffer.from(compiler.precompile(source), "utf8");
        const gzip = gzipSync(compiled, {
          level: constants.Z_BEST_COMPRESSION
        }).length;
        const brotli = brotliCompressSync(compiled, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
            [constants.BROTLI_PARAM_SIZE_HINT]: compiled.length
          }
        }).length;
        return {
          filename,
          version: compiler.version,
          original,
          compiled: compiled.length,
          gzip,
          brotli
        };
      });
      port2.postMessage(results);
    } catch (err) {
      throw Object.assign(new Error(`failed to compile ${filename}`), {
        original: err,
        filename
      });
    }
  });
}

/**
 * @param {SharedCode[]} sharedCompilers
 */
function getCompilers(sharedCompilers) {
  return sharedCompilers.map(shared => ({
    version: shared.version,
    precompile: util.templateCompilerFromShared(shared)
  }));
}

/**
 * @param {string[]} queue
 * @returns {Promise<CompileResult[]>}
 */
async function compileTemplates(queue) {
  const versions = util.compilerVersions();

  const [raceCancellation, cancel] = cancellableRace();
  const sigHandler = () => cancel("SIGINT");
  process.on("SIGINT", sigHandler);
  try {
    const [first, ...rest] = await Promise.all(
      startWorkers(queue, versions, raceCancellation)
    );
    return first.concat(...rest);
  } finally {
    // allow default behavior with no handler to resume
    process.off("SIGINT", sigHandler);
    cancel("Promise.all short circuited branch");
  }
}

/**
 * @param {string[]} queue
 * @param {string[]} versions
 * @param {import("race-cancellation").RaceCancellation} raceCancellation
 */
function* startWorkers(queue, versions, raceCancellation) {
  const sharedCompilers = versions.map(util.sharedTemplateCompilerCode);
  const numWorkers = Math.min(
    Math.floor(queue.length / 5),
    require("os").cpus().length
  );
  for (let i = 0; i < numWorkers; i++) {
    yield startWorker(queue, sharedCompilers, raceCancellation);
  }
}

/**
 * @param {string[]} queue
 * @param {SharedCode[]} sharedCompilers
 * @param {import("race-cancellation").RaceCancellation} raceCancellation
 */
async function startWorker(queue, sharedCompilers, raceCancellation) {
  const worker = new Worker(__filename, {
    workerData: sharedCompilers
  });
  const [raceExit, onExit] = cancellableRace();
  worker.on("exit", () => onExit("worker exited early"));
  worker.on("error", err => onExit(`worker error: ${err.stack}`));
  try {
    return await useWorker(
      queue,
      worker,
      combineRaceCancellation(raceCancellation, raceExit)
    );
  } finally {
    // terminate sometimes doesn't unref all the internal ports
    await worker.terminate();
  }
}

/**
 * @param {string[]} queue
 * @param {import("worker_threads").Worker} worker
 * @param {import("race-cancellation").RaceCancellation} raceCancellation
 */
async function useWorker(queue, worker, raceCancellation) {
  /** @type {CompileResult[]} */
  const results = [];
  /** @type {import("worker_threads").MessagePort} */
  const port = await nextMessage(worker, raceCancellation);
  try {
    while (queue.length > 0) {
      port.postMessage(queue.pop());
      results.push(...(await nextMessage(port, raceCancellation)));
    }
  } finally {
    port.close();
  }
  return results;
}

/**
 * @template T
 * @param {NodeJS.EventEmitter} emitter
 * @param {import("race-cancellation").RaceCancellation =} raceCancellation
 * @returns {Promise<T>}
 */
async function nextMessage(emitter, raceCancellation) {
  return /** @type {T} */ (throwIfCancelled(
    await disposablePromise(resolve => {
      emitter.on("message", resolve);
      return () => emitter.off("message", resolve);
    }, raceCancellation)
  ));
}
