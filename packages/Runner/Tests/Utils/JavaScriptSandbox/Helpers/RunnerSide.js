"use strict";

/*
 * Plays the Runner inside the launcher's test container: it holds a key in
 * its environment, a private file and a private directory, as a Runner does
 * during a code fix, then starts EscapedStep.js through the launcher as a
 * sandbox user and prints what the step could reach, and what the reap and
 * the parent-death signal leave.
 *
 *   node RunnerSide.js <scenario>
 *
 * Scenarios: escape (the step's report), reap (a process the step left,
 * before and after the reap), pdeathsig (a step whose launcher is killed).
 */

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const LAUNCHER = "/usr/lib/oneuptime-runner/javascript-sandbox";
const STEP = path.join(__dirname, "EscapedStep.js");
const UID = 61007;

function liveProcessesOf(uid) {
  return fs
    .readdirSync("/proc")
    .filter((entry) => /^\d+$/.test(entry))
    .filter((entry) => {
      try {
        const status = fs.readFileSync(`/proc/${entry}/status`, "utf8");
        const uidLine = status.split("\n").find((l) => l.startsWith("Uid:"));
        const stateLine = status
          .split("\n")
          .find((l) => l.startsWith("State:"));
        return (
          uidLine &&
          uidLine
            .split(/\s+/)
            .slice(1)
            .some((v) => Number(v) === uid) &&
          !/^State:\s+[ZX]/.test(stateLine || "")
        );
      } catch {
        return false;
      }
    })
    .map(Number);
}

function prepareRunnerSecrets() {
  const directory = fs.mkdtempSync("/tmp/runner-workspace-");
  fs.chmodSync(directory, 0o700);
  fs.writeFileSync(path.join(directory, "repository-file"), "private code");
  const file = path.join("/tmp", `runner-secret-${process.pid}`);
  fs.writeFileSync(file, "runner secret", { mode: 0o600 });
  return { directory, file };
}

function runStep(args) {
  return childProcess.spawnSync(
    LAUNCHER,
    ["run", String(UID), process.execPath, STEP, ...args],
    {
      env: {
        PATH: process.env.PATH,
        ONEUPTIME_RUNNER_KEY: process.env.ONEUPTIME_RUNNER_KEY,
        NODE_OPTIONS: "--require=/nonexistent/injected.js",
        LANG: "C.UTF-8",
      },
      encoding: "utf8",
    },
  );
}

const scenario = process.argv[2];
const secrets = prepareRunnerSecrets();

if (scenario === "escape") {
  const result = runStep([
    String(process.pid),
    secrets.file,
    secrets.directory,
  ]);
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      stderr: result.stderr,
      report: JSON.parse(result.stdout.trim().split("\n").pop()),
    }),
  );
} else if (scenario === "reap") {
  const result = runStep([
    String(process.pid),
    secrets.file,
    secrets.directory,
    "--leave-process",
  ]);
  const before = liveProcessesOf(UID);
  const reap = childProcess.spawnSync(LAUNCHER, ["reap", String(UID)]);
  const after = liveProcessesOf(UID);
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      before,
      reapStatus: reap.status,
      after,
    }),
  );
} else if (scenario === "pdeathsig") {
  const step = childProcess.spawn(
    LAUNCHER,
    ["run", String(UID), process.execPath, "-e", "setInterval(() => {}, 1000)"],
    { env: { PATH: process.env.PATH }, stdio: "ignore" },
  );
  setTimeout(() => {
    const before = liveProcessesOf(UID);
    step.kill("SIGKILL");
    setTimeout(() => {
      process.stdout.write(
        JSON.stringify({ before, after: liveProcessesOf(UID) }),
      );
    }, 500);
  }, 1000);
} else {
  process.stderr.write(`Unknown scenario ${scenario}\n`);
  process.exit(64);
}
