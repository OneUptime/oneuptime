"use strict";

/*
 * THE NAMES-AND-ADDRESSES MODEL'S OWN THREAD.
 *
 * Data Security's scans run the model here, in a worker thread of the worker
 * or probe process (NameAddressModelThread.ts starts it, once per process,
 * on the first scan that needs it), so a batch of word pieces never holds
 * the process's event loop, and the model's memory is the thread's.
 *
 * The thread holds the values the scanner reads, so before anything is
 * loaded every way out of it is shut (NameAddressModelNetworkLockdown.cjs).
 * The model runtime is ONNX Runtime's WebAssembly build (onnxruntime-web),
 * the same on musl and glibc, x64 and arm64: it is given its WebAssembly
 * binary and the model as bytes read from disk, so it has nothing to
 * download, and runs on one thread.
 *
 * It answers one message: "run", a batch of token ids, with the model's
 * logits and how long the model took. Errors are reported by kind and first
 * line only - ONNX Runtime's messages name shapes and operators, never
 * values.
 *
 * workerData: { modelPath }
 */

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");
const { lockDownNetwork } = require("./NameAddressModelNetworkLockdown.cjs");

lockDownNetwork((api) => {
  parentPort.postMessage({ type: "network-attempt", api: api });
});

const ort = require("onnxruntime-web");

function describe(error) {
  const name = error && error.name ? String(error.name) : "Error";
  const message =
    error && error.message ? String(error.message).split("\n")[0] : "";

  return `${name}: ${message}`.slice(0, 200);
}

let session = null;

async function start() {
  ort.env.logLevel = "error";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  // The binary beside the runtime's Node entry, read here: nothing is fetched.
  ort.env.wasm.wasmBinary = fs.readFileSync(
    path.join(
      path.dirname(require.resolve("onnxruntime-web")),
      "ort-wasm-simd-threaded.wasm",
    ),
  );

  session = await ort.InferenceSession.create(
    fs.readFileSync(workerData.modelPath),
    {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    },
  );

  parentPort.postMessage({
    type: "ready",
    inputNames: session.inputNames.slice(),
  });
}

async function run(message) {
  const dims = [message.rows, message.width];
  const feeds = {
    input_ids: new ort.Tensor("int64", message.inputIds, dims),
    attention_mask: new ort.Tensor("int64", message.attentionMask, dims),
  };

  if (session.inputNames.indexOf("token_type_ids") >= 0) {
    feeds.token_type_ids = new ort.Tensor("int64", message.tokenTypeIds, dims);
  }

  const started = performance.now();
  const output = await session.run(feeds);
  const elapsedInMs = performance.now() - started;
  const logits = output[session.outputNames[0]];
  const data = new Float32Array(logits.data);

  parentPort.postMessage(
    {
      type: "logits",
      id: message.id,
      logits: data,
      labels: logits.dims[logits.dims.length - 1],
      elapsedInMs: elapsedInMs,
    },
    [data.buffer],
  );
}

/*
 * One batch at a time, in the order sent: several scans of one process may
 * share the model, and each is charged only the time its own batches ran
 * (elapsedInMs), not the time they waited.
 */
let queue = Promise.resolve();

parentPort.on("message", (message) => {
  if (!message || message.type !== "run") {
    return;
  }

  queue = queue.then(() => {
    if (!session) {
      parentPort.postMessage({
        type: "error",
        id: message.id,
        message: "The model is not loaded.",
      });
      return undefined;
    }

    return run(message).catch((error) => {
      parentPort.postMessage({
        type: "error",
        id: message.id,
        message: describe(error),
      });
    });
  });
});

start().catch((error) => {
  parentPort.postMessage({ type: "failed", message: describe(error) });
});
