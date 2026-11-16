"use strict";

/**
 * What a running OneUptime server has loaded, asked over its inspector: how
 * many modules, which of them are TypeScript (a .ts, .tsx, .mts or .cts
 * file), and whether ts-node or TypeScript itself is among them. Every image
 * runs the JavaScript its build compiled
 * (packages/Common/Server/Utils/TsNode/Precompile.js), so a server that
 * loaded any of these does not run as its image should.
 *
 * CHECK_SCRIPT runs with `node -e` beside the server: in its container
 * (`docker exec`, or `docker compose exec`), as the server's user. It finds
 * the server's process (the node whose last argument is its entry, Index.js),
 * opens the server's inspector with SIGUSR1 (on 127.0.0.1:9229, in the
 * container's own network; LOADED_MODULES_PORT for a server started with
 * --inspect-port, as one on the host's network must be), checks that the
 * inspector it reached is the server's own (by its pid), lists every module
 * the server's require() loaded (Module._cache), and prints one line:
 * "LOADED_MODULES <json>", or "LOADED_MODULES_FAILED <why>". The inspector
 * stays open on the loopback address until the server stops: it is for
 * containers a test starts.
 *
 * Used by AppImageRuntime.test.js and RunnerImageRuntime.test.js on the
 * images they boot, and tested in ImagesRunJavaScript.test.js on a local
 * process.
 */

const CHECK_SCRIPT = String.raw`
"use strict";
const fs = require("fs");
const entry = process.env.LOADED_MODULES_ENTRY || "Index.js";
const port = Number(process.env.LOADED_MODULES_PORT || 9229);
const timeoutInMs = Number(process.env.LOADED_MODULES_TIMEOUT_MS || 30000);
const finish = (line, code) => {
  process.stdout.write(line + "\n", () => {
    process.exit(code);
  });
};
const fail = (message) => {
  finish("LOADED_MODULES_FAILED " + message, 1);
};
let server = null;
for (const name of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(name) || Number(name) === process.pid) {
    continue;
  }
  let argv = [];
  try {
    argv = fs.readFileSync("/proc/" + name + "/cmdline", "utf8").split("\0").filter(Boolean);
  } catch {
    continue;
  }
  if (argv.length > 1 && /(^|\/)node$/.test(argv[0]) && argv[argv.length - 1] === entry) {
    server = Number(name);
    break;
  }
}
if (server === null) {
  fail("no node process runs " + entry);
} else {
  process.kill(server, "SIGUSR1");
  const deadline = Date.now() + timeoutInMs;
  const debuggerUrl = async () => {
    for (;;) {
      try {
        const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
        if (targets.length > 0) {
          return targets[0].webSocketDebuggerUrl;
        }
      } catch {
        // Not open yet.
      }
      if (Date.now() > deadline) {
        throw new Error("the inspector did not open on 127.0.0.1:" + port);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
    }
  };
  const EXPRESSION = 'JSON.stringify({ pid: process.pid, modules: Object.keys(process.getBuiltinModule("module")._cache) })';
  debuggerUrl()
    .then((url) => {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.onopen = () => {
          socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPRESSION, returnByValue: true } }));
        };
        socket.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.id !== 1) {
            return;
          }
          socket.close();
          const value = message.result && message.result.result && message.result.result.value;
          if (typeof value === "string") {
            resolve(JSON.parse(value));
          } else {
            reject(new Error("the inspector answered " + String(event.data).slice(0, 500)));
          }
        };
        socket.onerror = () => {
          reject(new Error("the inspector's socket failed"));
        };
      });
    })
    .then(
      (answer) => {
        // On a host network, another process may hold the port.
        if (answer.pid !== server) {
          fail("the inspector on 127.0.0.1:" + port + " is process " + answer.pid + "'s, not the server's (" + server + ")");
          return;
        }
        const modules = answer.modules;
        finish(
          "LOADED_MODULES " +
            JSON.stringify({
              pid: server,
              modules: modules.length,
              typeScript: modules.filter((file) => {
                return /\.(ts|tsx|mts|cts)$/.test(file);
              }),
              tooling: modules.filter((file) => {
                return /[\\/]node_modules[\\/](typescript|ts-node)[\\/]/.test(file);
              }),
            }),
          0,
        );
      },
      (error) => {
        fail(error.message);
      },
    );
}
`;

/**
 * What CHECK_SCRIPT printed: its report, or null with why.
 * @param {string} output
 * @returns {{report: (object|null), problem: (string|null)}}
 */
function parseReport(output) {
  const lines = String(output || "").split("\n");
  const failed = lines.find((line) => {
    return line.startsWith("LOADED_MODULES_FAILED ");
  });
  if (failed) {
    return {
      report: null,
      problem: failed.slice("LOADED_MODULES_FAILED ".length),
    };
  }
  const line = lines.find((candidate) => {
    return candidate.startsWith("LOADED_MODULES ");
  });
  if (!line) {
    return {
      report: null,
      problem: `it printed no LOADED_MODULES line: ${String(output).slice(-2000)}`,
    };
  }
  return {
    report: JSON.parse(line.slice("LOADED_MODULES ".length)),
    problem: null,
  };
}

module.exports = { CHECK_SCRIPT, parseReport };
