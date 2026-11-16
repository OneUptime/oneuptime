"use strict";

/**
 * The heap rule every Node.js service image's start script opens with
 * (Tests/Ops/NodeImageHeapLimit.test.js says what it is and why), and a way
 * to run a start script up to node against cgroup files a test writes.
 *
 * The rule reads the container's memory limit from /proc/self/cgroup and
 * /sys/fs/cgroup only. A test writes the files of one case into a directory
 * of its own and points the script's reads there (localized), then runs the
 * script with node swapped for one that prints the NODE_OPTIONS it was given
 * and the heap limit V8 took from them (reporting).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/*
 * The services whose image runs package.json's start script: through sh as
 * its CMD (Tests/Ops/NodeImageStartCommand.test.js), or, in the ingress
 * image, through run.sh.
 */
const SERVICES = ["App", "Home", "Nginx", "Probe", "Runner", "TestServer"];

// Where the rule reads the container's memory limit.
const PROC_SELF_CGROUP = "/proc/self/cgroup";
const SYS_FS_CGROUP = "/sys/fs/cgroup";

// Where the rule ends and the script hands the heap it chose to node.
const HAND_OVER = 'export NODE_OPTIONS="--max-old-space-size=$heap';

// The heap where the container has no memory limit, as before the rule.
const NO_LIMIT_HEAP_MB = 8096;

const MB = 1024 * 1024;

/*
 * What node prints in place of the service: the NODE_OPTIONS the script gave
 * it and the heap limit V8 made of them. No single quote, so it fits in one
 * on sh's command line.
 */
const REPORT = [
  "console.log(JSON.stringify({",
  'nodeOptions: process.env.NODE_OPTIONS || "",',
  'heapSizeLimitMb: require("v8").getHeapStatistics().heap_size_limit / 1048576',
  "}))",
].join(" ");

function scriptsOf(service) {
  return JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, "packages", service, "package.json"),
      "utf8",
    ),
  ).scripts;
}

// The rule a script opens with: everything before it hands the heap to node.
function heapRuleOf(script) {
  const at = script.indexOf(HAND_OVER);
  if (at === -1) {
    throw new Error(`No heap rule hands a heap to node in: ${script}`);
  }
  return script.slice(0, at);
}

// The script, with the node it execs swapped for one that reports.
function reporting(script) {
  const at = script.lastIndexOf(" && exec node ");
  if (at === -1) {
    throw new Error(`The script does not exec node: ${script}`);
  }
  return `${script.slice(0, at)} && exec node -e '${REPORT}'`;
}

/*
 * One case's cgroup files, in a directory of its own: procSelfCgroup is the
 * text of /proc/self/cgroup (null: no such file), and files maps each path
 * under /sys/fs/cgroup to its text. Returns the directory.
 */
function writeCgroups({ procSelfCgroup = null, files = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-heap-"));
  fs.mkdirSync(path.join(directory, "sys-fs-cgroup"));
  if (procSelfCgroup !== null) {
    fs.writeFileSync(
      path.join(directory, "proc-self-cgroup"),
      `${procSelfCgroup}\n`,
    );
  }
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(directory, "sys-fs-cgroup", file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${text}\n`);
  }
  return directory;
}

// The script, reading a case's files where it reads the container's.
function localized(script, directory) {
  return script
    .split(PROC_SELF_CGROUP)
    .join(path.join(directory, "proc-self-cgroup"))
    .split(SYS_FS_CGROUP)
    .join(path.join(directory, "sys-fs-cgroup"));
}

function parseReport(result, what) {
  const line = (result.stdout || "")
    .split("\n")
    .filter((text) => {
      return text.startsWith("{");
    })
    .pop();
  if (result.status !== 0 || !line) {
    throw new Error(
      `${what} exited ${String(result.status)} without a report:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return JSON.parse(line);
}

// The environment a script runs in: this one's, with NODE_OPTIONS as asked.
function environment(nodeOptions) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (nodeOptions !== undefined) {
    env.NODE_OPTIONS = nodeOptions;
  }
  return env;
}

/*
 * Runs a start script up to node under a shell (a command and its first
 * arguments: ["sh"], ["busybox", "sh"]), against one case's cgroup files,
 * and returns what node reports.
 */
function runScript(script, { shell = ["sh"], cgroups, nodeOptions } = {}) {
  const [command, ...args] = shell;
  const directory = writeCgroups(cgroups);
  try {
    return parseReport(
      spawnSync(
        command,
        [...args, "-c", localized(reporting(script), directory)],
        {
          encoding: "utf8",
          env: environment(nodeOptions),
          timeout: 60000,
        },
      ),
      `${shell.join(" ")} -c <the start script>`,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

// The heap limit V8 takes from a --max-old-space-size of this many MB.
function heapSizeLimitMbFor(oldSpaceMb) {
  return parseReport(
    spawnSync("node", [`--max-old-space-size=${oldSpaceMb}`, "-e", REPORT], {
      encoding: "utf8",
      env: environment(undefined),
      timeout: 60000,
    }),
    "node",
  ).heapSizeLimitMb;
}

// The heap the rule gives a container with this memory limit, in MB.
function expectedHeapMb(limitBytes) {
  if (limitBytes === null) {
    return NO_LIMIT_HEAP_MB;
  }
  const threeQuarters = Math.floor((Math.floor(limitBytes / MB) * 3) / 4);
  return Math.min(Math.max(threeQuarters, 256), NO_LIMIT_HEAP_MB);
}

module.exports = {
  REPO_ROOT,
  SERVICES,
  PROC_SELF_CGROUP,
  SYS_FS_CGROUP,
  HAND_OVER,
  NO_LIMIT_HEAP_MB,
  MB,
  REPORT,
  scriptsOf,
  heapRuleOf,
  reporting,
  writeCgroups,
  localized,
  parseReport,
  environment,
  runScript,
  heapSizeLimitMbFor,
  expectedHeapMb,
};
