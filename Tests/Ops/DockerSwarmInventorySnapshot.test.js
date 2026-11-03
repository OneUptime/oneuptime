/**
 * What the Docker Swarm agent's inventory poller writes, run for real.
 *
 * agents/DockerSwarmAgent/inventory-snapshot.sh walks a manager's Docker API
 * and writes the two files the collector reads: the inventory (one JSON line
 * per node, service, task, stack, network, secret, config and volume, which
 * OneUptime's inventory ingest reads) and the swarm's state as one OTLP JSON
 * metrics line (Node Not Ready and Service Replicas Mismatch read it). Here
 * it runs under `sh --once` against a stand-in for the manager's API
 * (Utils/DockerSwarmInventoryBehaviour.js: a `curl` first on PATH that
 * answers each endpoint from a file), so the jq that builds both files is
 * what is checked, not its text.
 *
 * The case that made it: every snapshot used to start with the swarm's
 * first node, the same bytes each time. The collector knows a file by its
 * first kilobyte, so it took each new snapshot for the one it had read: a
 * calm swarm's inventory aged out of OneUptime 15 minutes after the agent
 * started, and in a bigger swarm nothing past the first kilobyte changed in
 * OneUptime. swarm-agent-inventory-behaviour.sh runs the collector itself
 * over the files this writes; this suite checks the files.
 *
 * It needs jq, which GitHub's runners have; without it on PATH the suite is
 * skipped with the reason logged, except under CI, where it fails.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  NODE_IDS,
  SCRIPT,
  SERVICE_IDS,
  buildSwarmApi,
  readMetricPoints,
  recordsOf,
  runOnce,
  tempDir,
  writeApi,
} = require("./Utils/DockerSwarmInventoryBehaviour");

function hasJq() {
  try {
    execFileSync("jq", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const JQ = hasJq();

if (!JQ && process.env.CI) {
  throw new Error("jq is not on PATH: the Swarm poller cannot be run");
}
if (!JQ) {
  // eslint-disable-next-line no-console
  console.log("DockerSwarmInventorySnapshot: jq is not on PATH, skipped");
}

const describeWithJq = JQ ? describe : describe.skip;

// The collector's fingerprint of a file: its first kilobyte.
const FINGERPRINT_BYTES = 1000;

function snapshotOf(dir, api, env) {
  const apiDir = path.join(dir, "api");
  writeApi(apiDir, api);
  return runOnce(apiDir, path.join(dir, "out"), env);
}

describeWithJq("inventory-snapshot.sh --once, against a manager's API", () => {
  const now = Date.now();
  let result;

  beforeAll(() => {
    result = snapshotOf(tempDir("swarm-inventory-"), buildSwarmApi(now));
  });

  describe("every snapshot is read again", () => {
    test("the inventory opens with a Snapshot line: when it was taken, and an id of its own", () => {
      const first = result.inventory[0];

      expect(first["oneuptime.dockerswarm.kind"]).toBe("Snapshot");
      expect(Object.keys(first.data).sort()).toEqual(["Id", "TakenAt"]);
      expect(first.data.Id.length).toBeGreaterThanOrEqual(16);
      const takenAt = Date.parse(first.data.TakenAt);
      expect(Math.abs(takenAt - now)).toBeLessThan(5 * 60 * 1000);
      // Only the first line is the snapshot's own.
      expect(
        result.inventory.filter((record) => {
          return record["oneuptime.dockerswarm.kind"] === "Snapshot";
        }),
      ).toHaveLength(1);
    });

    test("two snapshots of a swarm where nothing changed start with different bytes", () => {
      const dir = tempDir("swarm-inventory-twice-");
      const api = buildSwarmApi(now);
      const first = snapshotOf(path.join(dir, "a"), api).inventoryText;
      const second = snapshotOf(path.join(dir, "b"), api).inventoryText;

      expect(first.length).toBeGreaterThan(FINGERPRINT_BYTES);
      expect(first.slice(0, FINGERPRINT_BYTES)).not.toBe(
        second.slice(0, FINGERPRINT_BYTES),
      );
      // Past the snapshot's own line, the same swarm reads the same.
      expect(first.slice(first.indexOf("\n"))).toBe(
        second.slice(second.indexOf("\n")),
      );
    });

    test("the metrics line carries its reading's time in its first bytes", () => {
      const firstTime = result.metricsText.indexOf('"timeUnixNano"');

      expect(firstTime).toBeGreaterThan(0);
      expect(firstTime).toBeLessThan(300);
      expect(result.metricsText.trim().split("\n")).toHaveLength(1);
    });

    test("the poller's loop re-reads the swarm every minute, and the inventory every five", () => {
      const script = fs.readFileSync(SCRIPT, "utf8");

      expect(script).toContain(
        'METRICS_INTERVAL="${DOCKER_INVENTORY_METRICS_INTERVAL_SECONDS:-60}"',
      );
      expect(script).toContain(
        'INTERVAL="${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}"',
      );
      expect(script).toContain('mv "${LOG_PATH}.tmp" "${LOG_PATH}"');
      expect(script).toContain('mv "${METRICS_PATH}.tmp" "${METRICS_PATH}"');
    });
  });

  describe("nodes", () => {
    let nodes;

    beforeAll(() => {
      nodes = new Map(
        recordsOf(result.inventory, "Node").map((node) => {
          return [node.ID, node];
        }),
      );
    });

    test("a manager says whether the others reach it, as docker node ls does", () => {
      expect(nodes.get(NODE_IDS.leader).ManagerStatus).toBe("Leader");
      expect(nodes.get(NODE_IDS.reachable).ManagerStatus).toBe("Reachable");
      // It used to read Reachable for every manager but the leader.
      expect(nodes.get(NODE_IDS.unreachable).ManagerStatus).toBe("Unreachable");
      expect(nodes.get(NODE_IDS.worker).ManagerStatus).toBe("");
    });

    test("each node's state, availability, address, size and Swarm's message", () => {
      const down = nodes.get(NODE_IDS.unreachable);

      expect(down.Status).toBe("down");
      expect(down.Message).toBe("heartbeat failure");
      expect(down.Addr).toBe("10.0.0.13");
      expect(down.NanoCPUs).toBe("4000000000");
      expect(down.MemoryBytes).toBe("8589934592");
      expect(nodes.get(NODE_IDS.worker).Availability).toBe("drain");
      expect(nodes.get(NODE_IDS.leader).Hostname).toBe("swarm-manager-01");
      expect(nodes.get(NODE_IDS.leader).Role).toBe("manager");
    });
  });

  describe("services", () => {
    let services;

    beforeAll(() => {
      services = new Map(
        recordsOf(result.inventory, "Service").map((service) => {
          return [service.ID, service];
        }),
      );
    });

    test("replicas as REPLICAS reads them, its stack, and its image without the digest Swarm pins", () => {
      const checkout = services.get(SERVICE_IDS.checkout);

      expect(checkout.Replicas).toBe("2/3");
      expect(checkout.StackNamespace).toBe("shop");
      expect(checkout.Image).toBe(
        "registry.acme-swarm.example/shop/checkout:2.7.0",
      );
      expect(services.get(SERVICE_IDS.cron).StackNamespace).toBe("");
    });

    test("the mode, the job modes included", () => {
      expect(services.get(SERVICE_IDS.checkout).Mode).toBe("replicated");
      expect(services.get(SERVICE_IDS.agent).Mode).toBe("global");
      expect(services.get(SERVICE_IDS.migrate).Mode).toBe("replicated-job");
      expect(services.get(SERVICE_IDS.migrate).CompletedTasks).toBe("1");
    });

    test("how its last rolling update went, in Docker's words", () => {
      const checkout = services.get(SERVICE_IDS.checkout);

      expect(checkout.UpdateState).toBe("paused");
      expect(checkout.UpdateMessage).toBe(
        "update paused due to failure or early termination of task x7",
      );
      expect(checkout.UpdateStartedAt).not.toBe("");
      expect(services.get(SERVICE_IDS.agent).UpdateState).toBe("");
    });

    test("the tasks that failed or were rejected in the last hour, the newest one's error first among them", () => {
      const checkout = services.get(SERVICE_IDS.checkout);

      // Rejected 20 minutes ago, failed 30 and 35: not the one three hours old.
      expect(checkout.RecentFailedTasks).toBe("3");
      expect(checkout.LastTaskState).toBe("rejected");
      expect(checkout.LastTaskError).toBe(
        "no suitable node (insufficient resources on 3 nodes)",
      );
      expect(Date.parse(checkout.LastTaskErrorAt)).toBeGreaterThan(
        now - 21 * 60 * 1000,
      );
      expect(services.get(SERVICE_IDS.agent).RecentFailedTasks).toBe("0");
      expect(services.get(SERVICE_IDS.agent).LastTaskError).toBe("");
    });

    test("a shorter window counts only what fell inside it", () => {
      const dir = tempDir("swarm-inventory-window-");
      const shorter = snapshotOf(dir, buildSwarmApi(now), {
        DOCKER_INVENTORY_FAILED_TASK_WINDOW_SECONDS: String(25 * 60),
      });
      const checkout = recordsOf(shorter.inventory, "Service").find(
        (service) => {
          return service.ID === SERVICE_IDS.checkout;
        },
      );

      expect(checkout.RecentFailedTasks).toBe("1");
    });

    test("the exit code of a failed task's container comes with its error", () => {
      const dir = tempDir("swarm-inventory-exit-");
      const api = buildSwarmApi(now);
      // Only the failures that ran, not the rejection.
      api.tasks = api.tasks.filter((task) => {
        return task.Status.State !== "rejected";
      });
      const checkout = recordsOf(
        snapshotOf(dir, api).inventory,
        "Service",
      ).find((service) => {
        return service.ID === SERVICE_IDS.checkout;
      });

      expect(checkout.LastTaskState).toBe("failed");
      expect(checkout.LastTaskError).toBe("task: non-zero exit (1)");
      expect(checkout.LastTaskExitCode).toBe("1");
    });
  });

  describe("tasks", () => {
    let tasks;

    beforeAll(() => {
      tasks = new Map(
        recordsOf(result.inventory, "Task").map((task) => {
          return [task.ID, task];
        }),
      );
    });

    test("only the ones Swarm wants running: not the ones a slot replaced, not a finished job's", () => {
      expect([...tasks.keys()].sort()).toEqual(
        [
          "t10global0000000000000000",
          "t1running0000000000000000",
          "t2running0000000000000000",
          "t3pending0000000000000000",
          "t8global00000000000000000",
          "t9global00000000000000000",
        ].sort(),
      );
    });

    test("a replicated task is named after its slot, a global one after its node, as docker service ps names them", () => {
      expect(tasks.get("t1running0000000000000000").Name).toBe(
        "shop_checkout.1",
      );
      expect(tasks.get("t8global00000000000000000").Name).toBe(
        `monitoring_node-agent.${NODE_IDS.leader}`,
      );
      expect(tasks.get("t8global00000000000000000").Service).toBe(
        "monitoring_node-agent",
      );
      expect(tasks.get("t8global00000000000000000").Slot).toBe("");
    });

    test("its node by name, its state since when, its container and Docker's error", () => {
      const pending = tasks.get("t3pending0000000000000000");

      expect(pending.CurrentState).toBe("pending");
      expect(pending.Node).toBe("");
      expect(pending.Error).toBe(
        "no suitable node (insufficient resources on 3 nodes)",
      );
      expect(Date.parse(pending.Since)).toBeGreaterThan(now - 13 * 60 * 1000);

      const running = tasks.get("t1running0000000000000000");
      expect(running.Node).toBe("swarm-manager-01");
      expect(running.ContainerID).toBe("c".repeat(64));
      expect(running.ExitCode).toBe("0");
    });
  });

  describe("the swarm's state as metrics", () => {
    let points;

    beforeAll(() => {
      points = readMetricPoints(result.metrics);
    });

    test("one docker.swarm.node.ready per node: 1 while it is ready, 0 while it is not", () => {
      const ready = points.filter((point) => {
        return point.name === "docker.swarm.node.ready";
      });

      expect(
        ready.map((point) => {
          return [point.resource["docker.swarm.node.name"], point.value];
        }),
      ).toEqual([
        ["swarm-manager-01", 1],
        ["swarm-manager-02", 1],
        ["swarm-manager-03", 0],
        // Drained is ready: it is the node's availability, not its state.
        ["swarm-worker-01", 1],
      ]);
      expect(ready[2].resource["docker.swarm.node.id"]).toBe(
        NODE_IDS.unreachable,
      );
      expect(ready[2].resource["docker.swarm.node.role"]).toBe("manager");
      expect(ready[0].unit).toBe("1");
    });

    test("each replicated and global service's replicas, wanted and running; a job's none", () => {
      const byService = new Map();
      for (const point of points) {
        if (!point.name.startsWith("docker.swarm.service.replicas.")) {
          continue;
        }
        const name = point.resource["docker.swarm.service.name"];
        byService.set(name, {
          ...(byService.get(name) || {}),
          [point.name]: point.value,
          mode: point.resource["docker.swarm.service.mode"],
          stack: point.resource["docker.swarm.stack.namespace"],
        });
      }

      expect(Object.fromEntries(byService)).toEqual({
        shop_checkout: {
          "docker.swarm.service.replicas.desired": 3,
          "docker.swarm.service.replicas.running": 2,
          mode: "replicated",
          stack: "shop",
        },
        "monitoring_node-agent": {
          "docker.swarm.service.replicas.desired": 3,
          "docker.swarm.service.replicas.running": 3,
          mode: "global",
          stack: "monitoring",
        },
        // A service of no stack carries no stack attribute.
        nightly_cleanup: {
          "docker.swarm.service.replicas.desired": 1,
          "docker.swarm.service.replicas.running": 1,
          mode: "replicated",
          stack: undefined,
        },
      });
    });

    test("every reading carries the same time, now, in nanoseconds, from the poller's own scope", () => {
      const times = new Set(
        points.map((point) => {
          return point.timeUnixNano;
        }),
      );

      expect(times.size).toBe(1);
      const nanos = [...times][0];
      expect(nanos).toMatch(/^\d{19}$/);
      expect(Math.abs(Number(nanos.slice(0, 13)) - now)).toBeLessThan(
        5 * 60 * 1000,
      );
      expect(
        new Set(
          points.map((point) => {
            return point.scope;
          }),
        ),
      ).toEqual(new Set(["oneuptime.docker-swarm.inventory"]));
    });

    test("a read that fails sends no reading: no data is not a node that is down", () => {
      const dir = tempDir("swarm-inventory-down-api-");
      const api = buildSwarmApi(now);
      api.nodes = null;
      api.services = null;
      const failed = snapshotOf(dir, api);

      expect(readMetricPoints(failed.metrics)).toEqual([]);
      expect(recordsOf(failed.inventory, "Node")).toEqual([]);
      // The snapshot's own line is still first, so the next one is read too.
      expect(failed.inventory[0]["oneuptime.dockerswarm.kind"]).toBe(
        "Snapshot",
      );
    });
  });
});
