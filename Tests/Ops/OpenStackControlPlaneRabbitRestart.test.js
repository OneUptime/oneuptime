"use strict";

/**
 * The control plane rig's RabbitMQ restarts (Tests/Ops/openstack-e2e/control-plane-clusters.sh),
 * run for real against a docker that only knows three RabbitMQ nodes (#6172).
 *
 * The 14.0.105 release gate's run lost rabbit3 after the whole cluster was stopped: the three
 * nodes were started back to back, `docker start` returns before RabbitMQ has booted, so they
 * booted together, and rabbit3 - whose schema had moved on in the partition scene - crashed
 * merging it with rabbit2 while rabbit2 was still booting (Mnesia's merge_schema, BOOT FAILED).
 * It reproduced locally with the same image: once in three runs after the partition scene,
 * never without it.
 *
 * The docker here models exactly that race: a node started while another node is still
 * booting crashes. Its clock only moves when the rig sleeps, so nothing here waits. What runs
 * is the rig's own text - its helpers and the lines of each scene that start nodes - so a
 * scene that goes back to starting nodes back to back fails here first.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const RIG = path.join(__dirname, "openstack-e2e", "control-plane-clusters.sh");
const rig = fs.readFileSync(RIG, "utf8");

// A shell function's whole text, from `name() {` to the `}` that closes it at the line start.
function functionText(name) {
  const start = rig.indexOf(`\n${name}() {\n`);
  if (start < 0) {
    throw new Error(`control-plane-clusters.sh has no function ${name}`);
  }
  const end = rig.indexOf("\n}\n", start);
  return rig.slice(start + 1, end + 3);
}

// The lines of a scene between two lines of the rig, exclusive.
function linesBetween(after, before) {
  const start = rig.indexOf(after);
  if (start < 0) {
    throw new Error(`control-plane-clusters.sh has no line ${after.trim()}`);
  }
  const from = start + after.length;
  const end = rig.indexOf(before, from);
  if (end < 0) {
    throw new Error(
      `nothing in control-plane-clusters.sh after ${after.trim()} reads ${before.trim()}`,
    );
  }
  return rig.slice(from, end);
}

const CLUSTER_DOWN_RESTART = linesBetween(
  "  record rabbitmq-cluster-down\n",
  "  RECORD_GAP=10 record rabbitmq-recovered-from-cluster-down\n",
);

const NODE_DOWN_RESTART = linesBetween(
  "  record rabbitmq-node-down\n",
  "\n  # Cut one node off from the other two.",
);

// The cluster-down scene's restart before #6172, the one the gate's run failed on.
const BACK_TO_BACK_RESTART = [
  "  docker start ou-rabbit1 >/dev/null",
  "  docker start ou-rabbit2 >/dev/null",
  "  docker start ou-rabbit3 >/dev/null",
  '  wait_for "RabbitMQ\'s three nodes back" 80 rabbit_cluster_of_three',
  "",
].join("\n");

/*
 * A docker of three RabbitMQ containers, each stopped, booting (until a time), running or
 * crashed. A node started while another is booting crashes: the race the gate's run hit.
 * Nodes named in CRASH_NODES crash whenever they start. Everything it is asked is logged.
 */
const FAKE_DOCKER = `#!/usr/bin/env bash
state="$FAKE_STATE"
clock="$(cat "$state/clock")"
node_state() {
  local status done_at
  read -r status done_at <"$state/rabbit$1"
  if [ "$status" = "booting" ] && [ "$clock" -ge "$done_at" ]; then
    echo running
  else
    echo "$status"
  fi
}
echo "$clock $*" >>"$state/calls"
case "$1" in
  start)
    node="\${2#ou-rabbit}"
    echo "$clock $node" >>"$state/starts"
    for other in 1 2 3; do
      [ "$other" = "$node" ] && continue
      if [ "$(node_state "$other")" = "booting" ]; then
        echo crashed >"$state/rabbit$node"
        echo "ou-rabbit$node"
        exit 0
      fi
    done
    case " \${CRASH_NODES:-} " in
      *" $node "*) echo crashed >"$state/rabbit$node" ;;
      *) echo "booting $((clock + BOOT_SECONDS))" >"$state/rabbit$node" ;;
    esac
    echo "ou-rabbit$node"
    ;;
  exec)
    node="\${2#ou-rabbit}"
    shift 2
    case "$(node_state "$node")" in
      running) ;;
      booting)
        echo "Error: RabbitMQ on node rabbit@rabbit$node is not running or has not fully booted yet" >&2
        exit 69
        ;;
      *)
        echo "Error response from daemon: container ou-rabbit$node is not running" >&2
        exit 1
        ;;
    esac
    case "$*" in
      "rabbitmq-diagnostics -q check_running")
        echo "RabbitMQ on node rabbit@rabbit$node is fully booted and running"
        ;;
      "rabbitmqctl -q cluster_status --formatter json")
        running=""
        for other in 1 2 3; do
          [ "$(node_state "$other")" = "running" ] && running="$running\\"rabbit@rabbit$other\\","
        done
        printf '{"running_nodes":[%s]}\\n' "\${running%,}"
        ;;
      *)
        echo "fake docker: no such exec: $*" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    echo "fake docker: no such command: $*" >&2
    exit 2
    ;;
esac
`;

let directory;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rabbit-restart-"));
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

/*
 * Runs the rig's helpers and then `commands` in bash, with the fake docker first on PATH and
 * `sleep` moving the fake clock instead of waiting. `nodes` is each node's state at the start.
 */
function runRig(commands, { nodes, bootSeconds = 20, crashNodes = "" }) {
  const state = path.join(directory, "state");
  const bin = path.join(directory, "bin");
  const recording = path.join(directory, "recording");
  fs.mkdirSync(state);
  fs.mkdirSync(bin);
  fs.mkdirSync(recording);
  fs.writeFileSync(path.join(state, "clock"), "0\n");
  fs.writeFileSync(path.join(state, "starts"), "");
  fs.writeFileSync(path.join(state, "calls"), "");
  for (const node of [1, 2, 3]) {
    fs.writeFileSync(path.join(state, `rabbit${node}`), `${nodes[node]}\n`);
  }
  fs.writeFileSync(path.join(bin, "docker"), FAKE_DOCKER, { mode: 0o755 });

  const script = [
    "set -uo pipefail",
    `RECORDING=${JSON.stringify(recording)}`,
    ': >"$RECORDING/problems.txt"',
    'sleep() { echo "$(( $(cat "$FAKE_STATE/clock") + ${1%.*} ))" >"$FAKE_STATE/clock"; }',
    functionText("problem"),
    functionText("wait_for"),
    functionText("rabbit_cluster_of_three"),
    functionText("rabbit_running"),
    functionText("start_rabbits_in_turn"),
    commands,
  ].join("\n");

  const result = spawnSync("bash", ["-c", script], {
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      FAKE_STATE: state,
      BOOT_SECONDS: String(bootSeconds),
      CRASH_NODES: crashNodes,
    },
    encoding: "utf8",
  });

  const read = (name) => {
    return fs.readFileSync(path.join(state, name), "utf8").trim();
  };
  const clock = Number(read("clock"));

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    problems: fs
      .readFileSync(path.join(recording, "problems.txt"), "utf8")
      .split("\n")
      .filter(Boolean),
    starts: read("starts")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [clock, node] = line.split(" ").map(Number);
        return { clock, node };
      }),
    // What each node is when the commands are done: running once its boot time has passed.
    nodes: [1, 2, 3].map((node) => {
      const [status, doneAt] = read(`rabbit${node}`).split(" ");
      return status === "booting" && clock >= Number(doneAt)
        ? "running"
        : status;
    }),
    clock,
  };
}

const ALL_STOPPED = { 1: "stopped", 2: "stopped", 3: "stopped" };

describe("every node back after the whole cluster was down", () => {
  test("starts the last to stop first, and each of the others once the one before it runs", () => {
    const run = runRig(CLUSTER_DOWN_RESTART, { nodes: ALL_STOPPED });

    expect(run.problems).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.nodes).toEqual(["running", "running", "running"]);
    expect(
      run.starts.map((start) => {
        return start.node;
      }),
    ).toEqual([1, 2, 3]);
    // Each start comes once the node before it had booted: 20 seconds on this clock.
    for (let index = 1; index < run.starts.length; index++) {
      expect(run.starts[index].clock).toBeGreaterThanOrEqual(
        run.starts[index - 1].clock + 20,
      );
    }
    expect(run.output).toContain("rabbit1 running: ready");
    expect(run.output).toContain("rabbit2 running: ready");
    expect(run.output).toContain("rabbit3 running: ready");
    expect(run.output).toContain("RabbitMQ's three nodes back: ready");
  });

  test("the back-to-back starts the gate's run failed on lose a node under the same race", () => {
    // Proves the docker here reproduces the failure, so the test above is worth its pass.
    const run = runRig(BACK_TO_BACK_RESTART, { nodes: ALL_STOPPED });

    // rabbit1 boots alone; the two started while it booted crashed.
    expect(run.nodes).toEqual(["running", "crashed", "crashed"]);
    expect(run.status).not.toBe(0);
    expect(run.problems).toEqual([
      "RabbitMQ's three nodes back never became ready",
    ]);
  });

  test("a node slow to boot still has the others wait for it, within the scene's wait", () => {
    // 60 checks 3 seconds apart: a node that takes two and a half minutes is still waited for.
    const run = runRig(CLUSTER_DOWN_RESTART, {
      nodes: ALL_STOPPED,
      bootSeconds: 150,
    });

    expect(run.problems).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.nodes).toEqual(["running", "running", "running"]);
    for (let index = 1; index < run.starts.length; index++) {
      expect(run.starts[index].clock).toBeGreaterThanOrEqual(
        run.starts[index - 1].clock + 150,
      );
    }
  });

  test("a node that never runs is named, and the next one still starts, so the scene records what is there", () => {
    const run = runRig(CLUSTER_DOWN_RESTART, {
      nodes: ALL_STOPPED,
      crashNodes: "2",
    });

    expect(
      run.starts.map((start) => {
        return start.node;
      }),
    ).toEqual([1, 2, 3]);
    expect(run.nodes).toEqual(["running", "crashed", "running"]);
    expect(run.problems).toEqual([
      "rabbit2 running never became ready",
      "RabbitMQ's three nodes back never became ready",
    ]);
    expect(run.status).not.toBe(0);
  });

  test("a node that never runs is waited for no longer than the scene allows", () => {
    const run = runRig(CLUSTER_DOWN_RESTART, {
      nodes: ALL_STOPPED,
      crashNodes: "1 2 3",
    });

    // Three nodes at 60 checks 3 seconds apart, then the cluster's 80: no wait without end.
    expect(run.clock).toBe(3 * 60 * 3 + 80 * 3);
    expect(run.problems).toEqual([
      "rabbit1 running never became ready",
      "rabbit2 running never became ready",
      "rabbit3 running never became ready",
      "RabbitMQ's three nodes back never became ready",
    ]);
  });
});

describe("one node back while the others run", () => {
  test("rabbit3 rejoins the two that ran on", () => {
    const run = runRig(NODE_DOWN_RESTART, {
      nodes: { 1: "booting 0", 2: "booting 0", 3: "stopped" },
    });

    expect(run.problems).toEqual([]);
    expect(run.status).toBe(0);
    expect(
      run.starts.map((start) => {
        return start.node;
      }),
    ).toEqual([3]);
    expect(run.output).toContain("rabbit3 back in the cluster: ready");
  });
});

describe("how the rig starts RabbitMQ", () => {
  test("every start of a stopped node goes through start_rabbits_in_turn", () => {
    const helper = functionText("start_rabbits_in_turn");
    const starts = rig.split("\n").filter((line) => {
      return (
        !line.trim().startsWith("#") && /docker start\b.*rabbit/.test(line)
      );
    });

    expect(starts).toEqual(['    docker start "ou-rabbit$node" >/dev/null']);
    expect(helper).toContain(starts[0]);
    // ...and it waits for each node before it starts the next.
    expect(helper).toContain(
      'wait_for "rabbit$node running" 60 rabbit_running "$node"',
    );
  });

  test("the cluster comes back in the reverse of the order it went down", () => {
    const scene = linesBetween(
      "  # One at a time, and back in the opposite order",
      "  RECORD_GAP=10 record rabbitmq-recovered-from-cluster-down\n",
    );
    const stopped = Array.from(
      scene.matchAll(/docker stop ou-rabbit(\d)/g),
    ).map((match) => {
      return Number(match[1]);
    });
    const startLine = scene.match(/start_rabbits_in_turn ([\d ]+)\n/);

    expect(startLine).not.toBeNull();
    const started = startLine[1].trim().split(" ").map(Number);

    expect(stopped).toEqual([3, 2, 1]);
    expect(started).toEqual([...stopped].reverse());
  });

  test("rabbit_running asks the node itself whether its RabbitMQ has booted", () => {
    expect(functionText("rabbit_running")).toContain(
      'docker exec "ou-rabbit$1" rabbitmq-diagnostics -q check_running',
    );
  });

  test("the rig is valid bash", () => {
    const result = spawnSync("bash", ["-n", RIG], { encoding: "utf8" });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
