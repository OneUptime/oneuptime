"use strict";

/**
 * Runtime counterpart to ContainerAgentDockerApiVersion.test.js.
 *
 * That suite pins the SHAPE of the DOCKER_API_VERSION plumbing by reading files.
 * This one pins the BEHAVIOUR the shape exists to produce, by running the real
 * pinned collector image against a real Docker daemon:
 *
 *   - a version above the daemon's maximum kills the collector (the bug this
 *     plumbing exists to let operators fix),
 *   - a version below the daemon's minimum kills it too (the other direction,
 *     which is why the version is pinned at all rather than left off),
 *   - an EMPTY value is safe and starts fine, because the receiver falls back to
 *     Docker SDK auto-negotiation rather than to some too-old default. This is
 *     the fact the configs, the READMEs and the docs all now assert, and it is
 *     the one most likely to be quietly wrong after an upstream bump.
 *
 * This is the check that would have caught the stale "the receiver default is
 * 1.25" claim, and the one that will notice if a future collector release
 * changes what an empty api_version means.
 *
 * It needs a working Docker daemon and pulls an image, so it is OFF by default
 * and never runs in the normal `npm test` / CI path. Enable it explicitly:
 *
 *   RUN_CONTAINER_AGENT_RUNTIME_TESTS=1 npm test
 *
 * It is deliberately written to adapt to whatever daemon it finds: the API
 * version bounds are read from that daemon, and any case the daemon cannot
 * demonstrate is skipped with a reason rather than failed.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Same tag both Dockerfile.tpl files and DockerSwarmAgent/docker-compose.yml pin. */
const COLLECTOR_IMAGE = "otel/opentelemetry-collector-contrib:0.154.0";

const ENABLED = process.env.RUN_CONTAINER_AGENT_RUNTIME_TESTS === "1";

function docker(args, options) {
  return spawnSync("docker", args, {
    encoding: "utf8",
    ...options,
  });
}

function daemonBounds() {
  const result = docker([
    "version",
    "--format",
    "{{.Server.APIVersion}} {{.Server.MinAPIVersion}}",
  ]);

  if (result.status !== 0) {
    return null;
  }

  const [max, min] = result.stdout.trim().split(/\s+/);

  if (!/^\d+\.\d+$/.test(max || "")) {
    return null;
  }

  return { max, min: /^\d+\.\d+$/.test(min || "") ? min : null };
}

const BOUNDS = ENABLED ? daemonBounds() : null;
const AVAILABLE = Boolean(BOUNDS);

/** Only describe/run when explicitly enabled AND a daemon answered. */
const describeRuntime = AVAILABLE ? describe : describe.skip;

function compare(a, b) {
  const [aMajor, aMinor] = a.split(".").map(Number);
  const [bMajor, bMinor] = b.split(".").map(Number);

  return aMajor - bMajor || aMinor - bMinor;
}

let workDir = null;
let configPath = null;

/**
 * A minimal config carrying the same receiver line the agents ship. The agents'
 * own configs also export to OneUptime and tail host log paths, which a local
 * run cannot satisfy; `otelcol validate` covers those in
 * validate-collector-configs.sh. What matters here is the api_version line, and
 * a test below asserts it is byte-identical to the shipped one.
 */
const API_VERSION_LINE = 'api_version: "${env:DOCKER_API_VERSION}"';

function writeConfig() {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "oneuptime-apiversion-"));
  configPath = path.join(workDir, "config.yaml");

  fs.writeFileSync(
    configPath,
    [
      "receivers:",
      "  docker_stats:",
      "    endpoint: unix:///var/run/docker.sock",
      `    ${API_VERSION_LINE}`,
      "    collection_interval: 5s",
      "exporters:",
      "  debug:",
      "    verbosity: basic",
      "service:",
      "  pipelines:",
      "    metrics:",
      "      receivers: [docker_stats]",
      "      exporters: [debug]",
      "",
    ].join("\n"),
  );
}

/**
 * Run the collector with a given DOCKER_API_VERSION and report what happened.
 *
 * `apiVersion === undefined` leaves the variable unset; `""` sets it to the
 * empty string. The two are different inputs to confmap and the distinction is
 * the whole point of the `${VAR-default}` pass-throughs, so the helper keeps
 * them separate.
 */
function runCollector(apiVersion) {
  const name = `oneuptime-apiversion-test-${process.pid}`;

  docker(["rm", "-f", name]);

  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--user",
    "0:0",
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock",
    "-v",
    `${configPath}:/etc/otelcol-contrib/config.yaml:ro`,
  ];

  if (apiVersion !== undefined) {
    args.push("-e", `DOCKER_API_VERSION=${apiVersion}`);
  }

  args.push(COLLECTOR_IMAGE);

  const started = docker(args);

  if (started.status !== 0) {
    throw new Error(`docker run failed: ${started.stderr}`);
  }

  // Give it long enough to either fail its pipeline start or scrape once.
  let state = null;

  for (let attempt = 0; attempt < 30; attempt++) {
    state = docker([
      "inspect",
      "-f",
      "{{.State.Status}} {{.State.ExitCode}}",
      name,
    ]).stdout.trim();

    if (state.startsWith("exited")) {
      break;
    }

    execFileSync("sh", ["-c", "sleep 1"]);
  }

  const logs = docker(["logs", name]);
  const output = `${logs.stdout}\n${logs.stderr}`;

  docker(["rm", "-f", name]);

  const [status, exitCode] = state.split(/\s+/);

  return { status, exitCode: Number(exitCode), logs: output };
}

describeRuntime("docker_stats api_version, against a real daemon", () => {
  beforeAll(() => {
    writeConfig();

    const pulled = docker(["pull", COLLECTOR_IMAGE], { timeout: 600000 });

    if (pulled.status !== 0) {
      throw new Error(`could not pull ${COLLECTOR_IMAGE}: ${pulled.stderr}`);
    }
  }, 660000);

  afterAll(() => {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  test("the config under test uses the same api_version line the agents ship", () => {
    for (const agent of ["DockerAgent", "PodmanAgent", "DockerSwarmAgent"]) {
      const shipped = yaml.load(
        fs.readFileSync(
          path.join(REPO_ROOT, agent, "otel-collector-config.yaml"),
          "utf8",
        ),
      );

      expect(shipped.receivers.docker_stats.api_version).toBe(
        "${env:DOCKER_API_VERSION}",
      );
    }

    expect(fs.readFileSync(configPath, "utf8")).toContain(API_VERSION_LINE);
  });

  /*
   * The reported bug, reproduced: a client newer than the daemon's maximum is
   * refused, the receiver cannot start, and the collector exits rather than
   * running degraded — which is why the container restart-loops.
   */
  test("a version above the daemon's maximum kills the collector", () => {
    const tooNew = `${BOUNDS.max.split(".")[0]}.${
      Number(BOUNDS.max.split(".")[1]) + 30
    }`;

    const result = runCollector(tooNew);

    expect(result.status).toBe("exited");
    expect(result.exitCode).not.toBe(0);
    expect(result.logs).toContain("is too new");
    expect(result.logs).toContain("docker_stats");
  }, 120000);

  /*
   * The other direction, and the reason a version is pinned at all rather than
   * simply deleted. Skipped on daemons whose floor is low enough to accept 1.25.
   */
  test("a version below the daemon's minimum also kills the collector", () => {
    if (!BOUNDS.min || compare("1.25", BOUNDS.min) >= 0) {
      console.log(
        `skipped: this daemon's minimum API version (${
          BOUNDS.min || "unknown"
        }) accepts 1.25`,
      );

      return;
    }

    const result = runCollector("1.25");

    expect(result.status).toBe("exited");
    expect(result.exitCode).not.toBe(0);
    expect(result.logs).toContain("is too old");
  }, 120000);

  test("the daemon's own maximum is accepted", () => {
    const result = runCollector(BOUNDS.max);

    expect(result.status).toBe("running");
  }, 120000);

  /*
   * THE ESCAPE HATCH. An empty value does not fall back to some too-old default:
   * the receiver auto-negotiates with the daemon, so the collector comes up on
   * any daemon. The docs tell operators they can use this instead of looking
   * their maximum up, and this is what makes that promise true.
   */
  test("an explicitly empty version starts fine, via auto-negotiation", () => {
    const result = runCollector("");

    expect(result.status).toBe("running");
    expect(result.logs).not.toContain("is too new");
    expect(result.logs).not.toContain("is too old");
  }, 120000);

  /*
   * The same fallback covers a deployment that forgets to pass the variable at
   * all — an unset variable degrades to negotiation, not to a broken pin.
   */
  test("an unset variable starts fine too", () => {
    const result = runCollector(undefined);

    expect(result.status).toBe("running");
    expect(result.logs).toContain("unset environment variable");
    expect(result.logs).not.toContain("is too new");
    expect(result.logs).not.toContain("is too old");
  }, 120000);

  /*
   * The shipped default itself, on whatever daemon is running the suite. Skipped
   * rather than failed on a daemon that cannot serve 1.44, since that is a fact
   * about the host and not about this repo.
   */
  test("the shipped default 1.44 works on this daemon", () => {
    const withinBounds =
      compare("1.44", BOUNDS.max) <= 0 &&
      (!BOUNDS.min || compare("1.44", BOUNDS.min) >= 0);

    if (!withinBounds) {
      console.log(
        `skipped: this daemon serves ${BOUNDS.min || "?"}..${
          BOUNDS.max
        }, which does not include the shipped default 1.44`,
      );

      return;
    }

    const result = runCollector("1.44");

    expect(result.status).toBe("running");
  }, 120000);
});

/*
 * A always-running guard so the suite cannot rot into permanent silence: if the
 * opt-in flag is set but no daemon answered, that is worth saying out loud.
 */
describe("container agent runtime tests", () => {
  test("are opt-in, and report why they are not running", () => {
    if (!ENABLED) {
      expect(AVAILABLE).toBe(false);

      return;
    }

    if (!AVAILABLE) {
      throw new Error(
        "RUN_CONTAINER_AGENT_RUNTIME_TESTS=1 was set but no Docker daemon answered `docker version`.",
      );
    }

    expect(BOUNDS.max).toMatch(/^\d+\.\d+$/);
  });
});
