"use strict";

/*
 * Stands in for a JavaScript step that got out of its isolate: plain Node.js
 * code, run by the launcher (or SandboxProcess) where a step's process runs,
 * that tries to reach what belongs to the Runner and reports what it could.
 * The tests that start it assert that every attempt failed.
 *
 *   node EscapedStep.js <runner pid> <runner-only file> <runner-only directory>
 *     [--leave-process]
 *
 * It writes its report as one JSON line on its standard output. With
 * --leave-process it also leaves a process of its user running, in a
 * session of its own, as code that got out might, for the reap to find.
 */

const childProcess = require("child_process");
const fs = require("fs");

const [runnerPid, runnerFile, runnerDirectory] = process.argv.slice(2);
const leaveProcess = process.argv.includes("--leave-process");

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

const report = {
  uid: process.getuid(),
  gid: process.getgid(),
  groups: process.getgroups(),
  environmentNames: Object.keys(process.env).sort(),
  cwd: process.cwd(),
  noNewPrivs: attempt(() => readStatusField("NoNewPrivs")),
  capEff: attempt(() => readStatusField("CapEff")),
  readRunnerEnvironment: attempt(() =>
    fs.readFileSync(`/proc/${runnerPid}/environ`, "utf8"),
  ),
  readRunnerMemoryMap: attempt(() =>
    fs.readFileSync(`/proc/${runnerPid}/maps`, "utf8"),
  ),
  readRunnerFile: attempt(() => fs.readFileSync(runnerFile, "utf8")),
  listRunnerDirectory: attempt(() => fs.readdirSync(runnerDirectory).join(",")),
  signalRunner: attempt(() => process.kill(Number(runnerPid), 0)),
  runLauncher: attempt(() =>
    childProcess
      .execFileSync("/usr/lib/oneuptime-runner/javascript-sandbox", ["check"], {
        stdio: "pipe",
      })
      .toString(),
  ),
  writeFile: attempt(() =>
    fs.writeFileSync(`/tmp/escaped-${process.pid}`, "x"),
  ),
};

if (leaveProcess) {
  const left = childProcess.spawn("/bin/sleep", ["300"], {
    detached: true,
    stdio: "ignore",
  });
  left.unref();
  report.leftProcess = left.pid;
}

process.stdout.write(`${JSON.stringify(report)}\n`);
