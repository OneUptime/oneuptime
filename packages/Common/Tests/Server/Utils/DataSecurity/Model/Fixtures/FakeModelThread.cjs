"use strict";

/*
 * A stand-in for the names-and-addresses model's thread, speaking the same
 * messages (NameAddressModelWorker.cjs), so NameAddressModelThread can be
 * held to them without the model. workerData.mode chooses how it behaves:
 *
 *   "ok"       ready, then logits for every batch: label 3 (B-PER) for
 *              token id 5, O for the rest, and the time it says it took;
 *   "fail"     the model could not load;
 *   "hang"     ready, then never answers a batch;
 *   "error"    ready, then an error for every batch;
 *   "network"  says it tried the network, then ready;
 *   "exit"     ready, then ends on the first batch;
 *   "slowload" never says it is ready.
 */

const { parentPort, workerData } = require("worker_threads");

const LABELS = 9;
// The scanner hands a thread only the model's path: the tests put the mode there.
const mode = workerData.mode || workerData.modelPath || "ok";

if (mode === "fail") {
  parentPort.postMessage({
    type: "failed",
    message: "Error: the model file is damaged",
  });
} else if (mode !== "slowload") {
  if (mode === "network") {
    parentPort.postMessage({ type: "network-attempt", api: "fetch" });
  }

  parentPort.postMessage({ type: "ready", inputNames: ["input_ids"] });
}

parentPort.on("message", (message) => {
  if (!message || message.type !== "run") {
    return;
  }

  if (mode === "hang") {
    return;
  }

  if (mode === "exit") {
    process.exit(3);
  }

  if (mode === "error") {
    parentPort.postMessage({
      type: "error",
      id: message.id,
      message: "Error: shapes do not match",
    });
    return;
  }

  const logits = new Float32Array(message.rows * message.width * LABELS);

  for (let position = 0; position < message.rows * message.width; position++) {
    const label = Number(message.inputIds[position]) === 5 ? 3 : 0;

    logits[position * LABELS + label] = 10;
  }

  parentPort.postMessage(
    {
      type: "logits",
      id: message.id,
      logits,
      labels: LABELS,
      elapsedInMs: 7,
    },
    [logits.buffer],
  );
});
