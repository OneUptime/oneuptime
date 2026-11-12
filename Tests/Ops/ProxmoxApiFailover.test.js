"use strict";

/**
 * agents/ProxmoxAgent: the node the agent reads the cluster from (#6844).
 *
 * The collector read the whole cluster through PVE_HOST alone, so an agent
 * whose PVE_HOST was one node went blind exactly when that node went down,
 * and Proxmox VE has no virtual IP of its own to put in front of the nodes.
 * docker-compose.yml's pve-api-failover container now checks PVE_HOST's API,
 * then each node of PVE_NODES in turn, every 15 seconds, and writes the first
 * that answers (with the API token, the first that is part of the quorate
 * cluster) where the collector's cluster scrape takes its target from
 * (file_sd_configs).
 *
 * This suite holds the container to that: how it is wired to the collector
 * and hardened, and - running its script for real under `sh`, with `curl`
 * and `sleep` replaced by stubs that play a cluster's nodes round by round -
 * what it writes and says when nodes go down, come back, lose quorum, refuse
 * the token or fail TLS, and that the token never reaches curl's command
 * line. proxmox-agent-failover-behaviour.sh runs the real containers.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "ProxmoxAgent");
const COMPOSE = yaml.load(
  fs.readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8"),
);
const CONFIG = yaml.load(
  fs.readFileSync(path.join(AGENT_DIR, "otel-collector-config.yaml"), "utf8"),
);
const FAILOVER = COMPOSE.services["pve-api-failover"];
const COLLECTOR = COMPOSE.services["oneuptime-proxmox-agent"];
const AI_AGENT = COMPOSE.services["oneuptime-proxmox-ai-agent"];

// The script as Compose leaves it to the shell: every $$ is one $.
const SCRIPT_IN_COMPOSE = FAILOVER.command[0];
const SCRIPT = SCRIPT_IN_COMPOSE.replace(/\$\$/g, "$");
const TARGET_DIR_LINE = "dir=/run/oneuptime/pve-api";

const TOKEN_ID = "monitoring@pam!oneuptime";
const TOKEN_SECRET = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";
const CANDIDATES_LINE =
  "Reading the cluster from the first of these whose Proxmox VE API answers, checked every 15 seconds:";

const scratchDirs = [];

afterAll(() => {
  for (const dir of scratchDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeExecutable(file, text) {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

/*
 * `curl`, answering as the node in its URL is set up for the round
 * $STUB_DIR/round says ($STUB_DIR/nodes.<round>, else $STUB_DIR/nodes: one
 * "<host[:port]> <state>" per line). It records its arguments, and the
 * headers it was handed on stdin, and answers with what curl prints for
 * -w '\n%{http_code}' and exits as curl does: 7 for no connection, 60 for
 * a certificate it does not trust.
 */
const CURL_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_DIR/curl.log"
url=""
nobody=0
fmt=""
stdin_headers=0
while [ $# -gt 0 ]; do
  case "$1" in
    -o) [ "$2" = /dev/null ] && nobody=1; shift 2 ;;
    -w) fmt=$2; shift 2 ;;
    -H) [ "$2" = @- ] && stdin_headers=1; shift 2 ;;
    --connect-timeout|--max-time) shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
if [ "$stdin_headers" = 1 ]; then
  cat >> "$STUB_DIR/curl.stdin"
fi
round=$(cat "$STUB_DIR/round" 2>/dev/null || echo 1)
file="$STUB_DIR/nodes.$round"
[ -f "$file" ] || file="$STUB_DIR/nodes"
hostport=\${url#https://}
hostport=\${hostport%%/*}
short=\${hostport%:8006}
state=$(awk -v h="$hostport" -v s="$short" '$1 == h || $1 == s { print $2; exit }' "$file")
code=000
rc=7
body=""
case "$state" in
  quorate) code=200; rc=0; body='{"data":[{"type":"node","name":"pve1","online":1},{"quorate":1,"type":"cluster","name":"lab","nodes":3}]}' ;;
  noquorum) code=200; rc=0; body='{"data":[{"name":"lab","nodes":3,"type":"cluster","quorate":0},{"online":1,"type":"node"}]}' ;;
  standalone) code=200; rc=0; body='{"data":[{"type":"node","name":"pve1","online":1}]}' ;;
  401|403|500|596) code=$state; rc=0; body='{"data":null}' ;;
  tls) code=000; rc=60 ;;
  *) code=000; rc=7 ;;
esac
if [ "$nobody" = 0 ] && [ -n "$body" ]; then
  printf '%s' "$body"
fi
case "$fmt" in
  *http_code*) printf '\\n%s' "$code" ;;
esac
exit "$rc"
`;

/*
 * `sleep`: each call ends a round. It keeps what the script wrote for the
 * collector in that round, then starts the next round - or, after the last,
 * stops the script as docker stop does (SIGTERM to the shell).
 */
const SLEEP_STUB = `#!/bin/sh
round=$(cat "$STUB_DIR/round" 2>/dev/null || echo 1)
cp "$OUT_DIR/target.json" "$STUB_DIR/target.$round" 2>/dev/null
if [ "$round" -ge "$STUB_ROUNDS" ]; then
  kill -TERM "$PPID"
  exit 0
fi
echo $((round + 1)) > "$STUB_DIR/round"
exit 0
`;

// The script with its target directory moved into the test's scratch dir.
function scriptWritingTo(outDir) {
  return SCRIPT.replace(`${TARGET_DIR_LINE}\n`, `dir=${outDir}\n`);
}

/*
 * Runs the script for `rounds` rounds. `nodes` is the cluster in every
 * round, or `byRound` one entry per round: { "<host>": "<state>" }.
 */
function runFailover({ env = {}, rounds = 1, nodes = {}, byRound = null }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pve-api-failover-"));
  scratchDirs.push(dir);
  const bin = path.join(dir, "bin");
  const outDir = path.join(dir, "out");
  fs.mkdirSync(bin);
  fs.mkdirSync(outDir);
  writeExecutable(path.join(bin, "curl"), CURL_STUB);
  writeExecutable(path.join(bin, "sleep"), SLEEP_STUB);

  const asLines = (cluster) => {
    return Object.entries(cluster)
      .map(([host, state]) => {
        return `${host} ${state}\n`;
      })
      .join("");
  };
  fs.writeFileSync(path.join(dir, "nodes"), asLines(nodes));
  (byRound || []).forEach((cluster, index) => {
    fs.writeFileSync(path.join(dir, `nodes.${index + 1}`), asLines(cluster));
  });

  const scriptFile = path.join(dir, "failover.sh");
  fs.writeFileSync(scriptFile, scriptWritingTo(outDir));

  const result = spawnSync("sh", [scriptFile], {
    cwd: dir,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      STUB_DIR: dir,
      OUT_DIR: outDir,
      STUB_ROUNDS: String(rounds),
      ...env,
    },
    encoding: "utf8",
    timeout: 60000,
  });

  const read = (name) => {
    const file = path.join(dir, name);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  };

  const targets = [];
  for (let round = 1; round <= rounds; round++) {
    const written = read(`target.${round}`);
    targets.push(written === null ? null : JSON.parse(written)[0].targets[0]);
  }

  return {
    status: result.status,
    signal: result.signal,
    lines: result.stdout.split("\n").filter(Boolean),
    stderr: result.stderr,
    targets,
    curlCalls: (read("curl.log") || "").split("\n").filter(Boolean),
    curlStdin: read("curl.stdin"),
    outFiles: fs.readdirSync(outDir),
    written: read(path.join("out", "target.json")),
    scratch: dir,
  };
}

function urlsOf(run) {
  return run.curlCalls.map((call) => {
    return call.split(" ").find((word) => {
      return word.startsWith("https://");
    });
  });
}

const TOKEN = {
  PVE_API_TOKEN_ID: TOKEN_ID,
  PVE_API_TOKEN_SECRET: TOKEN_SECRET,
};
const CLUSTER = {
  PVE_HOST: "10.0.0.11",
  PVE_NODES: "[10.0.0.11,10.0.0.12,10.0.0.13]",
  ...TOKEN,
};
const ALL_UP = {
  "10.0.0.11": "quorate",
  "10.0.0.12": "quorate",
  "10.0.0.13": "quorate",
};

/* ======================================================= the compose file */

describe("agents/ProxmoxAgent/docker-compose.yml, the pve-api-failover service", () => {
  test("runs the pinned curl image, by digest, as its own user, with nothing it does not need", () => {
    expect(FAILOVER.image).toMatch(
      /^curlimages\/curl:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/,
    );
    expect(FAILOVER.container_name).toBe("oneuptime-pve-api-failover");
    // tini forwards docker stop's SIGTERM to the script.
    expect(FAILOVER.init).toBe(true);
    expect(FAILOVER.user).toBe("100:101");
    expect(FAILOVER.read_only).toBe(true);
    expect(FAILOVER.cap_drop).toEqual(["ALL"]);
    expect(FAILOVER.security_opt).toEqual(["no-new-privileges:true"]);
    expect(FAILOVER.restart).toBe("unless-stopped");
    expect(FAILOVER.logging).toEqual({
      driver: "json-file",
      options: { "max-size": "10m", "max-file": "3" },
    });
    // No port, no profile: it always runs, and nothing reaches it.
    expect(FAILOVER.ports).toBeUndefined();
    expect(FAILOVER.profiles).toBeUndefined();
  });

  test("is unhealthy until it has written a node for the collector to read", () => {
    expect(FAILOVER.healthcheck.test).toEqual([
      "CMD",
      "test",
      "-s",
      "/run/oneuptime/pve-api/target.json",
    ]);
  });

  test("shares its choice with the collector through an in-memory volume it owns, which the collector only reads", () => {
    const volume = COMPOSE.volumes["pve-api-target"];
    expect(volume.driver_opts).toEqual({
      type: "tmpfs",
      device: "tmpfs",
      o: "size=64k,uid=100,gid=101,mode=0755",
    });
    // Owned by the user the container runs as.
    const [uid, gid] = FAILOVER.user.split(":");
    expect(volume.driver_opts.o).toContain(`uid=${uid},gid=${gid}`);
    expect(FAILOVER.volumes).toEqual(["pve-api-target:/run/oneuptime/pve-api"]);
    expect(COLLECTOR.volumes).toContain(
      "pve-api-target:/etc/oneuptime/pve-api:ro",
    );
    expect(COLLECTOR.depends_on).toEqual(["pve-api-failover"]);
  });

  test("writes the very file the collector's cluster scrape reads", () => {
    const clusterJob = CONFIG.receivers.prometheus.config.scrape_configs.find(
      (job) => {
        return job.job_name === "oneuptime-proxmox";
      },
    );
    const [readFile] = clusterJob.file_sd_configs[0].files;
    const collectorMount = COLLECTOR.volumes
      .find((volume) => {
        return volume.startsWith("pve-api-target:");
      })
      .split(":")[1];
    const failoverMount = FAILOVER.volumes[0].split(":")[1];

    expect(path.posix.dirname(readFile)).toBe(collectorMount);
    expect(SCRIPT).toContain(`${TARGET_DIR_LINE}\n`);
    expect(TARGET_DIR_LINE).toBe(`dir=${failoverMount}`);
    expect(SCRIPT).toContain(
      `"$dir/.target.json.tmp" && mv -f "$dir/.target.json.tmp" "$dir/${path.posix.basename(readFile)}"`,
    );
  });

  test("the cluster scrape takes the written node as the exporter's target and keeps the exporter as its instance", () => {
    const clusterJob = CONFIG.receivers.prometheus.config.scrape_configs[0];
    expect(clusterJob.job_name).toBe("oneuptime-proxmox");
    expect(clusterJob.static_configs).toBeUndefined();
    expect(clusterJob.params).toEqual({ cluster: ["1"], node: ["0"] });
    expect(clusterJob.relabel_configs).toEqual([
      { source_labels: ["__address__"], target_label: "__param_target" },
      { target_label: "__address__", replacement: "${env:PVE_EXPORTER_URL}" },
    ]);
    // No instance relabel: the scrape stays the exporter's, as it was.
    expect(
      clusterJob.relabel_configs.some((rule) => {
        return rule.target_label === "instance";
      }),
    ).toBe(false);
    // The collector reads the file again within its refresh, whatever happens to inotify.
    expect(clusterJob.file_sd_configs[0].refresh_interval).toBe("30s");
  });

  test("gets the nodes to try, in order, and the exporter's token and TLS setting - nothing else", () => {
    expect(FAILOVER.environment).toEqual([
      "PVE_HOST=${PVE_HOST:-localhost}",
      "PVE_NODES=${PVE_NODES:-[${PVE_HOST:-localhost}]}",
      "PVE_API_TOKEN_ID=${PVE_API_TOKEN_ID:-}",
      "PVE_API_TOKEN_SECRET=${PVE_API_TOKEN_SECRET:-}",
      "PVE_VERIFY_SSL=${PVE_VERIFY_SSL:-false}",
    ]);
    // The same defaults the collector's node scrape uses.
    expect(COLLECTOR.environment).toContain(
      "PVE_NODES=${PVE_NODES:-[${PVE_HOST:-localhost}]}",
    );
    // Every variable the script reads is one the service is given.
    const read = new Set(
      Array.from(SCRIPT.matchAll(/\$\{(PVE_[A-Z_]+)/g), (match) => {
        return match[1];
      }),
    );
    const given = new Set(
      FAILOVER.environment.map((entry) => {
        return entry.split("=")[0];
      }),
    );
    for (const name of read) {
      expect({ name, given: given.has(name) }).toEqual({ name, given: true });
    }
  });

  test("the AI agent gets every node's address too, to call the next when PVE_HOST cannot be reached", () => {
    expect(AI_AGENT.environment).toContain("PVE_NODES=${PVE_NODES:-}");
  });

  test("writes every $ of its script as $$, so Docker Compose leaves them all to the shell", () => {
    expect(SCRIPT_IN_COMPOSE.replace(/\$\$/g, "")).not.toContain("$");
    expect(FAILOVER.entrypoint).toEqual(["/bin/sh", "-c"]);
  });

  test("its script is a POSIX shell script that parses", () => {
    const result = spawnSync("sh", ["-n", "-c", SCRIPT], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

/* ============================================================ the script */

describe("pve-api-failover's script, run against a stand-in cluster", () => {
  test("reads the cluster from PVE_HOST while it answers, asking it alone, and says so once", () => {
    const run = runFailover({ env: CLUSTER, rounds: 3, nodes: ALL_UP });

    expect(run.status).toBe(0);
    expect(run.targets).toEqual(["10.0.0.11", "10.0.0.11", "10.0.0.11"]);
    expect(run.lines).toEqual([
      `${CANDIDATES_LINE} 10.0.0.11 10.0.0.12 10.0.0.13`,
      "Reading the cluster from 10.0.0.11.",
    ]);
    // One check a round, of PVE_HOST alone.
    expect(urlsOf(run)).toEqual([
      "https://10.0.0.11:8006/api2/json/cluster/status",
      "https://10.0.0.11:8006/api2/json/cluster/status",
      "https://10.0.0.11:8006/api2/json/cluster/status",
    ]);
  });

  test("PVE_HOST stops answering: the next node in PVE_NODES, and PVE_HOST again once it answers", () => {
    const run = runFailover({
      env: CLUSTER,
      rounds: 4,
      byRound: [
        ALL_UP,
        { ...ALL_UP, "10.0.0.11": "dead" },
        { ...ALL_UP, "10.0.0.11": "dead", "10.0.0.12": "dead" },
        ALL_UP,
      ],
    });

    expect(run.targets).toEqual([
      "10.0.0.11",
      "10.0.0.12",
      "10.0.0.13",
      "10.0.0.11",
    ]);
    expect(run.lines).toEqual([
      `${CANDIDATES_LINE} 10.0.0.11 10.0.0.12 10.0.0.13`,
      "Reading the cluster from 10.0.0.11.",
      "Reading the cluster from 10.0.0.12: 10.0.0.11 does not answer.",
      "Reading the cluster from 10.0.0.13: 10.0.0.11 does not answer; 10.0.0.12 does not answer.",
      "Reading the cluster from 10.0.0.11.",
    ]);
  });

  test("with the token, a node cut off from the quorate cluster is passed over; a standalone node has no quorum to lose", () => {
    const run = runFailover({
      env: CLUSTER,
      rounds: 2,
      byRound: [
        { ...ALL_UP, "10.0.0.11": "noquorum" },
        { ...ALL_UP, "10.0.0.11": "standalone" },
      ],
    });

    expect(run.targets).toEqual(["10.0.0.12", "10.0.0.11"]);
    expect(run.lines).toContain(
      "Reading the cluster from 10.0.0.12: 10.0.0.11 is not part of the quorate cluster.",
    );
  });

  test("when no node is part of the quorate cluster, the first node that answers at all", () => {
    const run = runFailover({
      env: CLUSTER,
      nodes: {
        "10.0.0.11": "dead",
        "10.0.0.12": "noquorum",
        "10.0.0.13": "noquorum",
      },
    });

    expect(run.targets).toEqual(["10.0.0.12"]);
    expect(run.lines).toContain(
      "No node answers as part of the quorate cluster (10.0.0.11 does not answer; 10.0.0.12 is not part of the quorate cluster; 10.0.0.13 is not part of the quorate cluster): reading the cluster from 10.0.0.12.",
    );
  });

  test("when no node answers, it keeps its last choice, and says so once", () => {
    const allDown = {
      "10.0.0.11": "dead",
      "10.0.0.12": "dead",
      "10.0.0.13": "dead",
    };
    const run = runFailover({
      env: CLUSTER,
      rounds: 4,
      byRound: [
        { ...allDown, "10.0.0.12": "quorate" },
        allDown,
        allDown,
        allDown,
      ],
    });

    expect(run.targets).toEqual([
      "10.0.0.12",
      "10.0.0.12",
      "10.0.0.12",
      "10.0.0.12",
    ]);
    expect(
      run.lines.filter((line) => {
        return line.startsWith("No node's Proxmox VE API answers");
      }),
    ).toEqual([
      "No node's Proxmox VE API answers (10.0.0.11 does not answer; 10.0.0.12 does not answer; 10.0.0.13 does not answer): still reading the cluster from 10.0.0.12.",
    ]);
  });

  test("before any node has answered, it falls back to PVE_HOST, so the collector always has a target", () => {
    const run = runFailover({ env: CLUSTER, nodes: {} });

    expect(run.targets).toEqual(["10.0.0.11"]);
  });

  test("a node that answers with an error, or refuses the token, is no node to read from while another is quorate", () => {
    const run = runFailover({
      env: CLUSTER,
      rounds: 2,
      byRound: [
        { ...ALL_UP, "10.0.0.11": "500" },
        { ...ALL_UP, "10.0.0.11": "401", "10.0.0.12": "596" },
      ],
    });

    expect(run.targets).toEqual(["10.0.0.12", "10.0.0.13"]);
    expect(run.lines).toContain(
      "Reading the cluster from 10.0.0.12: 10.0.0.11 answers HTTP 500.",
    );
    expect(run.lines).toContain(
      "Reading the cluster from 10.0.0.13: 10.0.0.11 refuses the API token (HTTP 401); 10.0.0.12 answers HTTP 596.",
    );
  });

  test("hands curl the token on stdin, never on its command line, and asks /cluster/status with it", () => {
    const run = runFailover({
      env: CLUSTER,
      rounds: 2,
      byRound: [ALL_UP, { ...ALL_UP, "10.0.0.11": "dead" }],
    });

    expect(run.curlCalls.join("\n")).not.toContain(TOKEN_SECRET);
    expect(run.curlCalls.join("\n")).not.toContain("PVEAPIToken");
    for (const call of run.curlCalls) {
      expect(call).toContain("-H @-");
    }
    expect(run.curlStdin.split("\n").filter(Boolean)).toEqual([
      `Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
      `Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
      `Authorization: PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}`,
    ]);
    // Each check is bounded: a node whose address stops answering costs seconds.
    for (const call of run.curlCalls) {
      expect(call).toContain("--connect-timeout 3 --max-time 6");
    }
  });

  test("without a token, asks /version whether a node answers, with no header, and takes a 401 as an answer", () => {
    const run = runFailover({
      env: { PVE_HOST: "10.0.0.11", PVE_NODES: "[10.0.0.11,10.0.0.12]" },
      nodes: { "10.0.0.11": "dead", "10.0.0.12": "401" },
    });

    expect(run.targets).toEqual(["10.0.0.12"]);
    expect(urlsOf(run)).toEqual([
      "https://10.0.0.11:8006/api2/json/version",
      "https://10.0.0.12:8006/api2/json/version",
    ]);
    expect(run.curlStdin).toBeNull();
    for (const call of run.curlCalls) {
      expect(call).not.toContain("-H");
      expect(call).toContain("-o /dev/null");
    }
  });

  test("checks the nodes' certificates only when the exporter does (PVE_VERIFY_SSL), and says when one fails", () => {
    const insecure = runFailover({ env: CLUSTER, nodes: ALL_UP });
    expect(insecure.curlCalls[0].split(" ")).toContain("-k");

    for (const on of ["true", "TRUE", "1", "yes", "on"]) {
      const verified = runFailover({
        env: { ...CLUSTER, PVE_VERIFY_SSL: on },
        nodes: { ...ALL_UP, "10.0.0.11": "tls" },
      });
      expect(verified.curlCalls[0].split(" ")).not.toContain("-k");
      expect(verified.targets).toEqual(["10.0.0.12"]);
      expect(verified.lines).toContain(
        "Reading the cluster from 10.0.0.12: 10.0.0.11 fails the TLS check.",
      );
    }

    const off = runFailover({
      env: { ...CLUSTER, PVE_VERIFY_SSL: "false" },
      nodes: ALL_UP,
    });
    expect(off.curlCalls[0].split(" ")).toContain("-k");
  });

  test("reads the node list as the collector does: brackets, spaces, quotes and repeats; ports and IPv6 in the address; nothing else", () => {
    const run = runFailover({
      env: {
        PVE_HOST: "pve1.lab:8443",
        PVE_NODES:
          "[pve1.lab:8443, fd00::2 ,'[fd00::3]:8443',\"pve4\",bad/host,$(touch x),pve4]",
      },
      nodes: {
        "pve1.lab:8443": "dead",
        "fd00::2": "dead",
        "[fd00::3]:8443": "dead",
        pve4: "401",
      },
    });

    expect(run.lines).toContain(
      `${CANDIDATES_LINE} pve1.lab:8443 fd00::2 [fd00::3]:8443 pve4`,
    );
    expect(run.lines).toContain(
      'Skipping "bad/host": not a host name or address.',
    );
    expect(run.lines).toContain('Skipping "$(touch": not a host name or address.');
    expect(urlsOf(run)).toEqual([
      "https://pve1.lab:8443/api2/json/version",
      "https://[fd00::2]:8006/api2/json/version",
      "https://[fd00::3]:8443/api2/json/version",
      "https://pve4:8006/api2/json/version",
    ]);
    // The node is written as listed: the exporter gets it as its target, as the node scrape does.
    expect(run.targets).toEqual(["pve4"]);
    // Nothing in the list is ever run.
    expect(fs.existsSync(path.join(run.scratch, "x"))).toBe(false);
  });

  test("an unset PVE_HOST and PVE_NODES fall back to localhost, as the collector's defaults do", () => {
    const run = runFailover({ env: {}, nodes: { localhost: "401" } });

    expect(run.lines[0]).toBe(`${CANDIDATES_LINE} localhost`);
    expect(run.targets).toEqual(["localhost"]);
  });

  test("with no node to read at all, it writes nothing and says how to fix it", () => {
    const run = runFailover({
      env: { PVE_HOST: "https://pve1/", PVE_NODES: "[pve2/api,root@pve3]" },
      nodes: {},
    });

    expect(run.status).toBe(0);
    expect(run.written).toBeNull();
    expect(run.lines).toContain(
      "Neither PVE_HOST nor PVE_NODES names a node: set PVE_HOST in .env to a node's address, then run docker compose up -d.",
    );
    expect(run.curlCalls).toEqual([]);
  });

  test("writes the collector a file_sd list it can read, through a rename, leaving nothing else behind", () => {
    const run = runFailover({ env: CLUSTER, nodes: ALL_UP });

    expect(JSON.parse(run.written)).toEqual([{ targets: ["10.0.0.11"] }]);
    expect(run.written).toBe('[{"targets":["10.0.0.11"]}]\n');
    expect(run.outFiles).toEqual(["target.json"]);
  });

  test("stops at once, and cleanly, when docker stop sends SIGTERM", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pve-api-failover-"));
    scratchDirs.push(dir);
    const bin = path.join(dir, "bin");
    const outDir = path.join(dir, "out");
    fs.mkdirSync(bin);
    fs.mkdirSync(outDir);
    // The real sleep this time: only curl is a stand-in.
    writeExecutable(path.join(bin, "curl"), CURL_STUB);
    fs.writeFileSync(path.join(dir, "nodes"), "10.0.0.11 quorate\n");
    const scriptFile = path.join(dir, "failover.sh");
    fs.writeFileSync(scriptFile, scriptWritingTo(outDir));

    const child = spawn("sh", [scriptFile], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        STUB_DIR: dir,
        PVE_HOST: "10.0.0.11",
      },
      stdio: "ignore",
    });
    const exited = new Promise((resolve) => {
      child.on("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });

    // Wait for its first choice, then stop it mid-sleep.
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(path.join(outDir, "target.json"))) {
      if (Date.now() > deadline) {
        child.kill("SIGKILL");
        throw new Error("the script never wrote its first choice");
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    const stoppedAt = Date.now();
    child.kill("SIGTERM");

    expect(await exited).toEqual({ code: 0, signal: null });
    // Within its 15-second sleep: the trap does not wait for it.
    expect(Date.now() - stoppedAt).toBeLessThan(5000);
  });
});

/* ======================================================= the real containers */

describe("the real containers' run", () => {
  test("proxmox-agent-failover-behaviour.sh runs in the Ops workflow, on the node image the workflow warms", () => {
    const workflow = fs.readFileSync(
      path.join(REPO_ROOT, ".github", "workflows", "test.ops.yaml"),
      "utf8",
    );
    const script = fs.readFileSync(
      path.join(__dirname, "proxmox-agent-failover-behaviour.sh"),
      "utf8",
    );
    const run = workflow.indexOf(
      "- run: bash Tests/Ops/proxmox-agent-failover-behaviour.sh",
    );
    const nodeImage = script.match(/^NODE_IMAGE="([^"]+)"$/m)[1];
    const warm = workflow.indexOf(`warm_base_images.sh --image ${nodeImage}`);

    expect(run).toBeGreaterThan(-1);
    expect(warm).toBeGreaterThan(-1);
    expect(warm).toBeLessThan(run);
    // It runs the shipped files, changing only how often the collector scrapes.
    expect(script).toContain(
      'cp "${AGENT_DIR}/docker-compose.yml" "${WORK_DIR}/docker-compose.yml"',
    );
    expect(script).toContain(
      "sed 's/scrape_interval: 30s/scrape_interval: 5s/'",
    );
  });

  test("proxmox-agent-failover-behaviour.sh passes bash -n", () => {
    const result = spawnSync(
      "bash",
      ["-n", path.join(__dirname, "proxmox-agent-failover-behaviour.sh")],
      { encoding: "utf8" },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
