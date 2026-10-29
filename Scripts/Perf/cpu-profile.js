// A V8 CPU profile of a running Node process (the App started with
// APP_NODE_FLAGS=--inspect=127.0.0.1:<port>), taken over the inspector while
// a command runs - cpu-sample.py, a load, or a sleep - and written to a file
// profile-summary.js reads.
//
// Usage: node cpu-profile.js <inspectorPort> <out.cpuprofile> <command> [args...]
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");

const port = Number(process.argv[2]);
const out = process.argv[3];
const command = process.argv.slice(4);

async function main() {
  if (!Number.isInteger(port) || !out || command.length === 0) {
    throw new Error(
      "usage: node cpu-profile.js <inspectorPort> <out.cpuprofile> <command> [args...]",
    );
  }

  const targets = await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
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

  await send("Profiler.enable");
  // 500 microseconds: enough samples for a few minutes, little overhead.
  await send("Profiler.setSamplingInterval", { interval: 500 });
  await send("Profiler.start");

  const exitCode = await new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit" });
    child.on("exit", resolve);
  });

  const stopped = await send("Profiler.stop");
  fs.writeFileSync(out, JSON.stringify(stopped.result.profile));
  console.log(`profile written to ${out}; the command exited with ${exitCode}`);
  socket.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
