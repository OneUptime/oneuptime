"use strict";

/*
 * Stands in for a JavaScript step that got out of its isolate: plain Node.js
 * code, run where a step's process runs, that tries to reach what belongs to
 * the Runner and reports what it could. The tests that start it assert that
 * every attempt failed.
 *
 * Two ways to start it:
 *
 *   - as a step's worker (SandboxProcess, in place of SandboxWorker): it
 *     reads the sandbox request on its standard input, takes its targets
 *     from the request's args ({ runnerPid, runnerFile, runnerDirectory,
 *     writeDirectory }) and answers on the result channel, fd 3, with its
 *     report as the step's output;
 *   - directly (RunnerSide.js, through the launcher in the test container):
 *       node EscapedStep.js <runner pid> <runner-only file>
 *         <runner-only directory> [--leave-process]
 *     and it writes its report as one JSON line on its standard output.
 *     With --leave-process it also leaves a process of its user running, in
 *     a session of its own, as code that got out might, for the reap to find.
 */

const childProcess = require("child_process");
const dgram = require("dgram");
const fs = require("fs");
const net = require("net");

// A write past RLIMIT_FSIZE raises SIGXFSZ; caught, the write fails instead.
process.on("SIGXFSZ", () => {});

function attempt(action) {
  try {
    const value = action();
    return { ok: true, value: value === undefined ? null : String(value) };
  } catch (error) {
    return {
      ok: false,
      code: error && error.code ? error.code : String(error),
    };
  }
}

/*
 * Whether the process can open a socket of its own at all: the one way a
 * step that got out of its isolate could reach a network. The no-network
 * filter refuses the socket() call outright; Node's permission model,
 * without leave for the network, refuses it before the call. Either way the
 * probe never reaches a host, so it needs none up: it resolves with the
 * error code, and the tests require that there always is one.
 */
function openSocket(kind) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    try {
      if (kind === "tcp") {
        const socket = new net.Socket();
        socket.on("error", (error) => {
          socket.destroy();
          done({ ok: false, code: error.code || String(error) });
        });
        socket.on("connect", () => {
          socket.destroy();
          done({ ok: true, value: "opened" });
        });
        // A port nothing answers on this host: a refusal is the socket, not the port.
        socket.connect(9, "127.0.0.1");
      } else {
        const socket = dgram.createSocket("udp4");
        socket.on("error", (error) => {
          socket.close();
          done({ ok: false, code: error.code || String(error) });
        });
        socket.bind(0, "127.0.0.1", () => {
          socket.close();
          done({ ok: true, value: "bound" });
        });
      }
    } catch (error) {
      done({ ok: false, code: error && error.code ? error.code : String(error) });
    }

    setTimeout(() => {
      done({ ok: false, code: "TIMEOUT" });
    }, 2000);
  });
}

function readStatusField(name) {
  const line = fs
    .readFileSync("/proc/self/status", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1).trim() : null;
}

// The request is the first line of standard input (SandboxProtocol v2).
function readRequest() {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        process.stdin.off("data", onData);
        try {
          resolve(JSON.parse(buffer.slice(0, newline)));
        } catch {
          resolve(null);
        }
      }
    };
    process.stdin.on("data", onData);
    process.stdin.on("error", () => {
      resolve(null);
    });
    process.stdin.on("end", () => {
      resolve(null);
    });
  });
}

async function getReport(targets) {
  const report = {
    pid: process.pid,
    uid: process.getuid(),
    gid: process.getgid(),
    groups: process.getgroups(),
    environmentNames: Object.keys(process.env).sort(),
    cwd: process.cwd(),
    seccomp: attempt(() => readStatusField("Seccomp")),
    openTcpSocket: await openSocket("tcp"),
    openUdpSocket: await openSocket("udp"),
    noNewPrivs: attempt(() => readStatusField("NoNewPrivs")),
    capEff: attempt(() => readStatusField("CapEff")),
    readRunnerEnvironment: attempt(() =>
      fs.readFileSync(`/proc/${targets.runnerPid}/environ`, "utf8"),
    ),
    readRunnerMemoryMap: attempt(() =>
      fs.readFileSync(`/proc/${targets.runnerPid}/maps`, "utf8"),
    ),
    readRunnerFile: attempt(() => fs.readFileSync(targets.runnerFile, "utf8")),
    listRunnerDirectory: attempt(() =>
      fs.readdirSync(targets.runnerDirectory).join(","),
    ),
    signalRunner: attempt(() => process.kill(Number(targets.runnerPid), 0)),
    runLauncher: attempt(() =>
      childProcess
        .execFileSync(
          "/usr/lib/oneuptime-runner/javascript-sandbox",
          ["check"],
          { stdio: "pipe" },
        )
        .toString(),
    ),
    startProcess: attempt(() =>
      childProcess.execFileSync("/bin/sh", ["-c", "echo started"]).toString(),
    ),
    writeFile: attempt(() =>
      fs.writeFileSync(
        `${targets.writeDirectory || "/tmp"}/escaped-${process.pid}`,
        "x",
      ),
    ),
  };

  if (targets.leaveProcess) {
    const left = childProcess.spawn("/bin/sleep", ["300"], {
      detached: true,
      stdio: "ignore",
    });
    left.unref();
    report.leftProcess = left.pid;
  }

  return report;
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length >= 3) {
    const report = await getReport({
      runnerPid: argv[0],
      runnerFile: argv[1],
      runnerDirectory: argv[2],
      leaveProcess: argv.includes("--leave-process"),
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  const request = await readRequest();

  if (!request || typeof request.nonce !== "string") {
    process.exit(2);
  }

  const report = await getReport(request.args || {});
  // fd 3, the result channel, written as a file: the permission model
  // refuses a socket of any kind, even around a descriptor it was given.
  const channel = fs.createWriteStream("", { fd: 3 });

  channel.end(
    JSON.stringify({
      version: 2,
      nonce: request.nonce,
      success: true,
      output: JSON.stringify(report),
    }),
    () => {
      process.exit(0);
    },
  );
}

void main();
