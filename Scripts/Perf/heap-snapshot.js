// The memory of a running Node process (the App started with
// APP_NODE_FLAGS=--inspect=127.0.0.1:<port>), read over the inspector:
// process.memoryUsage() and V8's heap spaces after a full garbage collection,
// and with an output path a heap snapshot too, which heap-summary.js reads.
//
// Usage: node heap-snapshot.js <inspectorPort> [out.heapsnapshot] [--no-gc]
//   prints JSON: rss, heapUsed, external, arrayBuffers (MB), each heap
//   space's used MB, code and bytecode MB, and how many modules are loaded.
"use strict";

const fs = require("fs");

const port = Number(process.argv[2]);
const out =
  process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
const collect = !process.argv.includes("--no-gc");

const MEMORY_EXPRESSION = `(() => {
  const v8 = require("v8");
  const mb = (n) => Math.round((n / 1048576) * 10) / 10;
  const usage = process.memoryUsage();
  const spaces = {};
  for (const space of v8.getHeapSpaceStatistics()) {
    if (space.space_used_size > 0) {
      spaces[space.space_name] = mb(space.space_used_size);
    }
  }
  const code = v8.getHeapCodeStatistics();
  const modules = Object.keys(require.cache);
  return {
    rss: mb(usage.rss),
    heapTotal: mb(usage.heapTotal),
    heapUsed: mb(usage.heapUsed),
    external: mb(usage.external),
    arrayBuffers: mb(usage.arrayBuffers),
    spaces,
    codeAndMetadata: mb(code.code_and_metadata_size),
    bytecodeAndMetadata: mb(code.bytecode_and_metadata_size),
    modules: modules.length,
    nodeModulesModules: modules.filter((m) => m.includes("/node_modules/")).length,
  };
})()`;

async function main() {
  if (!Number.isInteger(port)) {
    throw new Error(
      "usage: node heap-snapshot.js <inspectorPort> [out.heapsnapshot] [--no-gc]",
    );
  }

  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  let file = null;
  let written = 0;

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "HeapProfiler.addHeapSnapshotChunk") {
      fs.writeSync(file, message.params.chunk);
      written += message.params.chunk.length;
      return;
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };

  await new Promise((resolve) => {
    socket.onopen = resolve;
  });

  const send = (method, params) => {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params: params || {} }));
    });
  };

  await send("HeapProfiler.enable");

  if (collect) {
    // Twice: the first collection can leave what a finalizer frees.
    await send("HeapProfiler.collectGarbage");
    await send("HeapProfiler.collectGarbage");
  }

  const memory = await send("Runtime.evaluate", {
    expression: MEMORY_EXPRESSION,
    returnByValue: true,
    includeCommandLineAPI: true,
  });

  if (memory.result.exceptionDetails) {
    throw new Error(JSON.stringify(memory.result.exceptionDetails));
  }

  const result = memory.result.result.value;

  if (out) {
    file = fs.openSync(out, "w");
    const started = Date.now();
    await send("HeapProfiler.takeHeapSnapshot", {
      reportProgress: false,
      captureNumericValue: false,
    });
    fs.closeSync(file);
    result.snapshot = {
      path: out,
      mb: Math.round(written / 1048576),
      seconds: Math.round((Date.now() - started) / 100) / 10,
    };
  }

  console.log(JSON.stringify(result, null, 1));
  socket.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
