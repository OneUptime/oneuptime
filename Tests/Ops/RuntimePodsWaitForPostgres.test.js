"use strict";

/**
 * The runtime pods' wait for PostgreSQL, the Helm chart's
 * oneuptime.postgres.runtimeWaitInitContainer, run as each pod runs it.
 *
 * The app, the worker, the telemetry writer and the ingress's certificate
 * sidecar connect to PostgreSQL as they start, try four times five seconds
 * apart, and exit (PostgresDatabase.connect()). On a fresh install the
 * database is still pulling its image and initializing then, and the images,
 * which run JavaScript compiled when they are built, get there within seconds,
 * so each of those pods exited and was restarted at least once: the Iron Bank
 * install check (HelmChart/Tests/suites/iron-bank-install.sh), which counts
 * restarts, failed on the app's and the ingress's. An init container now holds
 * them until PostgreSQL answers.
 *
 * It must never hold a pod for good, which a wait without an end would:
 *
 *   - in a service mesh whose sidecar starts after the init containers, every
 *     connection an init container opens goes to a proxy that is not running
 *     yet, so it reaches nothing, the Kubernetes API included. There it starts
 *     the process at once, which connects through the proxy once it runs;
 *   - when PostgreSQL does not come, it starts the process after
 *     PG_WAIT_SECONDS, which tries again itself, as before the wait.
 *
 * These render the chart (helm on PATH; CI has it), check that the four pods
 * run one and the same wait for the database itself, and run its script with
 * bash against servers on this machine's loopback: a port nothing listens on
 * refuses a connection at once, as a Service without a ready endpoint does,
 * and as a mesh's proxy port does before the proxy runs.
 * HelmChart/Public/oneuptime/tests/runtime-postgres-wait_test.yaml holds the
 * rest of what the chart renders: the database layouts, the images and the
 * security contexts.
 */

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ONEUPTIME_CHART = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
);

const RELEASE = "oneuptime";
const NAMESPACE = "oneuptime";

// The Deployments whose process connects to PostgreSQL as it starts.
const WAITING_DEPLOYMENTS = [
  `${RELEASE}-app`,
  `${RELEASE}-worker`,
  `${RELEASE}-telemetry-writer`,
  `${RELEASE}-nginx`,
];

const WAIT_CONTAINER = "wait-for-postgres";
const LOOPBACK = "127.0.0.1";

const HELM_PROBE = spawnSync("helm", ["version", "--short"], {
  encoding: "utf8",
});
const HELM_MISSING = Boolean(HELM_PROBE.error) || HELM_PROBE.status !== 0;

if (HELM_MISSING && !process.env.CI) {
  // eslint-disable-next-line no-console
  console.warn(
    "The runtime pods' PostgreSQL wait is not checked: helm is not on PATH (CI has it, see .github/workflows/test.ops.yaml).",
  );
}

const describeWithHelm =
  HELM_MISSING && !process.env.CI ? describe.skip : describe;

function render(values) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-pg-wait-"));
  const file = path.join(dir, "values.json");

  try {
    fs.writeFileSync(file, JSON.stringify(values));

    const result = spawnSync(
      "helm",
      [
        "template",
        RELEASE,
        ONEUPTIME_CHART,
        "--namespace",
        NAMESPACE,
        "--values",
        file,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    // Helm's stderr only on a failure: it also warns there, of a kubeconfig's mode.
    expect({
      status: result.status,
      error: result.status === 0 ? "" : result.stderr,
    }).toEqual({ status: 0, error: "" });

    return yaml.loadAll(result.stdout).filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Each waiting Deployment's pod spec, by its name.
function waitingPods(documents) {
  const pods = {};

  for (const document of documents) {
    if (
      document.kind === "Deployment" &&
      WAITING_DEPLOYMENTS.includes(document.metadata.name)
    ) {
      pods[document.metadata.name] = document.spec.template.spec;
    }
  }

  return pods;
}

function waitContainerOf(pod) {
  return (pod.initContainers || []).find((container) => {
    return container.name === WAIT_CONTAINER;
  });
}

function envOf(container) {
  return Object.fromEntries(
    (container.env || []).map((entry) => {
      return [entry.name, entry.value];
    }),
  );
}

// A server on the loopback that takes every connection, and closes it.
function listen(port = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.destroy();
    });
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => {
      resolve(server);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

// A loopback port nothing listens on, which refuses a connection at once.
async function refusingPort() {
  const server = await listen();
  const { port } = server.address();
  await close(server);
  return port;
}

// The scripts still running: a test that times out leaves no wait behind it.
const running = new Set();

afterEach(() => {
  for (const child of running) {
    child.kill("SIGKILL");
  }
  running.clear();
});

/*
 * The script, run by bash with only the environment given, as the pod runs it.
 * `onOutput` is called with what it has written so far, each time it writes.
 */
function run(script, environment, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn("bash", ["-c", script], {
      env: { PATH: process.env.PATH, ...environment },
    });
    running.add(child);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      onOutput(stdout);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      running.delete(child);
      resolve({
        code,
        stdout,
        stderr,
        seconds: (Date.now() - startedAt) / 1000,
      });
    });
  });
}

describeWithHelm("the runtime pods' wait for PostgreSQL", () => {
  let pods;
  let script;

  // A render of the whole chart takes seconds.
  beforeAll(() => {
    pods = waitingPods(
      render({ worker: { enabled: true }, telemetryWriter: { enabled: true } }),
    );
    script = waitContainerOf(pods[`${RELEASE}-app`]).command[2];
  }, 120000);

  test("the pods that connect to PostgreSQL as they start each wait for it first, in their own image", () => {
    expect(Object.keys(pods).sort()).toEqual([...WAITING_DEPLOYMENTS].sort());

    for (const [name, pod] of Object.entries(pods)) {
      const wait = waitContainerOf(pod);

      expect({ name, waits: Boolean(wait) }).toEqual({ name, waits: true });
      expect({ name, image: wait.image }).toEqual({
        name,
        image: pod.containers[0].image,
      });
      expect({ name, command: wait.command }).toEqual({
        name,
        command: ["bash", "-c", script],
      });
      expect({ name, env: envOf(wait) }).toEqual({
        name,
        env: {
          PGHOST: `${RELEASE}-postgresql.${NAMESPACE}.svc.cluster.local`,
          PGPORT: "5432",
          PG_WAIT_SECONDS: "300",
        },
      });
    }
  });

  describe("its script, run by bash", () => {
    let kubernetesApi;

    beforeAll(async () => {
      kubernetesApi = await listen();
    });

    afterAll(async () => {
      await close(kubernetesApi);
    });

    function environment(postgresPort, extra = {}) {
      return {
        PGHOST: LOOPBACK,
        PGPORT: String(postgresPort),
        PG_WAIT_SECONDS: "300",
        KUBERNETES_SERVICE_HOST: LOOPBACK,
        KUBERNETES_SERVICE_PORT: String(kubernetesApi.address().port),
        ...extra,
      };
    }

    test("starts the process as soon as PostgreSQL answers", async () => {
      const postgres = await listen();
      const { port } = postgres.address();

      try {
        const result = await run(script, environment(port));

        expect(result).toMatchObject({
          code: 0,
          stdout: `postgres reachable at ${LOOPBACK}:${port}\n`,
          stderr: "",
        });
        expect(result.seconds).toBeLessThan(3);
      } finally {
        await close(postgres);
      }
    }, 30000);

    // PostgreSQL comes up once the script has found it down and said so.
    test("waits while PostgreSQL starts, and starts the process once it answers", async () => {
      const port = await refusingPort();
      let starting = null;

      try {
        const result = await run(script, environment(port), (output) => {
          if (!starting && output.includes("waiting for postgres")) {
            starting = listen(port);
          }
        });

        expect(result.code).toBe(0);
        expect(result.stdout).toBe(
          `waiting for postgres at ${LOOPBACK}:${port} ...\npostgres reachable at ${LOOPBACK}:${port}\n`,
        );
      } finally {
        if (starting) {
          await close(await starting);
        }
      }
    }, 30000);

    test("starts the process at once when the Kubernetes API does not answer either, as behind a mesh's proxy that is not running yet", async () => {
      const port = await refusingPort();
      const result = await run(
        script,
        environment(port, {
          KUBERNETES_SERVICE_PORT: String(await refusingPort()),
        }),
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        `Neither postgres at ${LOOPBACK}:${port} nor the Kubernetes API answers`,
      );
      expect(result.stdout).not.toContain("waiting for postgres");
      expect(result.seconds).toBeLessThan(3);
    }, 30000);

    test("starts the process after PG_WAIT_SECONDS when PostgreSQL does not answer", async () => {
      const port = await refusingPort();
      const result = await run(
        script,
        environment(port, { PG_WAIT_SECONDS: "1" }),
      );

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(
        `waiting for postgres at ${LOOPBACK}:${port} ...\npostgres at ${LOOPBACK}:${port} did not answer in 1 s. Starting the process, which tries again itself.\n`,
      );
    }, 30000);

    test("without the Kubernetes API's address it waits for PostgreSQL alone, up to PG_WAIT_SECONDS", async () => {
      const port = await refusingPort();
      const result = await run(script, {
        PGHOST: LOOPBACK,
        PGPORT: String(port),
        PG_WAIT_SECONDS: "0",
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toBe(
        `postgres at ${LOOPBACK}:${port} did not answer in 0 s. Starting the process, which tries again itself.\n`,
      );
    }, 30000);
  });
});
