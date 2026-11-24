"use strict";

/*
 * THE NAMES-AND-ADDRESSES MODEL'S OWN THREAD.
 *
 * Data Security's scans run the model here, in a worker thread of the worker
 * or probe process (NameAddressModelThread.ts starts it, once per process,
 * on the first scan that needs it), so a batch of word pieces never holds the
 * process's event loop, and the model's memory is the thread's.
 *
 * The thread holds the values the scanner reads, so before anything is
 * loaded every way out of it is shut: fetch and the other web APIs, the
 * net, tls, http, https, http2, dns and dgram modules, and child processes
 * all throw here, and say so to the scanner, which logs the attempt (never a
 * value). The model runtime is ONNX Runtime's WebAssembly build
 * (onnxruntime-web), the same on musl and glibc, x64 and arm64: it is given
 * its WebAssembly binary and the model as bytes read from disk, so it has
 * nothing to download, and runs on one thread.
 *
 * It answers one message: "run", a batch of token ids, with the model's
 * logits. Errors are reported by kind and first line only - ONNX Runtime's
 * messages name shapes and operators, never values.
 *
 * workerData: { modelPath, runtimePath? } - runtimePath replaces
 * onnxruntime-web for tests.
 */

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const NETWORK_REFUSED =
  "The names-and-addresses model may not use the network.";

function refuse(api) {
  return function refused() {
    parentPort.postMessage({ type: "network-attempt", api: api });
    throw new Error(NETWORK_REFUSED);
  };
}

function shut(target, names, prefix) {
  for (const name of names) {
    if (target && typeof target[name] === "function") {
      target[name] = refuse(prefix + name);
    }
  }
}

function lockDownNetwork() {
  for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
    if (name in globalThis) {
      globalThis[name] = refuse(name);
    }
  }

  const net = require("net");

  shut(net, ["connect", "createConnection", "createServer"], "net.");
  shut(net.Socket.prototype, ["connect"], "net.Socket.");
  shut(require("tls"), ["connect", "createServer"], "tls.");
  shut(require("http"), ["request", "get", "createServer"], "http.");
  shut(require("https"), ["request", "get", "createServer"], "https.");
  shut(require("http2"), ["connect", "createServer"], "http2.");

  const dns = require("dns");
  const lookups = [
    "lookup",
    "lookupService",
    "resolve",
    "resolve4",
    "resolve6",
    "resolveAny",
    "resolveCaa",
    "resolveCname",
    "resolveMx",
    "resolveNaptr",
    "resolveNs",
    "resolvePtr",
    "resolveSoa",
    "resolveSrv",
    "resolveTxt",
    "reverse",
  ];

  shut(dns, lookups, "dns.");
  shut(dns.promises, lookups, "dns.promises.");
  shut(require("dgram"), ["createSocket"], "dgram.");
  shut(
    require("child_process"),
    [
      "spawn",
      "spawnSync",
      "exec",
      "execSync",
      "execFile",
      "execFileSync",
      "fork",
    ],
    "child_process.",
  );
}

lockDownNetwork();

function describe(error) {
  const name = error && error.name ? String(error.name) : "Error";
  const message =
    error && error.message ? String(error.message).split("\n")[0] : "";

  return `${name}: ${message}`.slice(0, 200);
}

let ort = null;
let session = null;

async function start() {
  ort = workerData.runtimePath
    ? require(workerData.runtimePath)
    : require("onnxruntime-web");

  ort.env.logLevel = "error";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;

  if (!workerData.runtimePath) {
    // The binary beside the runtime's Node entry, read here: nothing is fetched.
    const distribution = path.dirname(require.resolve("onnxruntime-web"));

    ort.env.wasm.wasmBinary = fs.readFileSync(
      path.join(distribution, "ort-wasm-simd-threaded.wasm"),
    );
  }

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
