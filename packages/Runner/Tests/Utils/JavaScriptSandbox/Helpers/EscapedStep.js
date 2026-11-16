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

function readStatusField(name) {
  const line = fs
    .readFileSync("/proc/self/status", "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${name}:`));
  return line ? line.slice(name.length + 1).trim() : null;
}

function readRequest() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      chunks.push(chunk);
    });
    process.stdin.on("error", () => {
      resolve(null);
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
  });
}

function getReport(targets) {
  const report = {
    pid: process.pid,
    uid: process.getuid(),
    gid: process.getgid(),
    groups: process.getgroups(),
    environmentNames: Object.keys(process.env).sort(),
    cwd: process.cwd(),
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
    const report = getReport({
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

  const report = getReport(request.args || {});
  const channel = new net.Socket({ fd: 3, readable: false, writable: true });

  channel.end(
    JSON.stringify({
      version: 1,
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
