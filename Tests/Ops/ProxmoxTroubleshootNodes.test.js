"use strict";

/**
 * agents/ProxmoxAgent/troubleshoot.sh, section 2, run for real with `docker`
 * replaced by a stub that answers the exporter scrapes the way
 * prometheus-pve-exporter does.
 *
 * pve-exporter reads start-on-boot (what Guest Down needs), replication and
 * the subscription — its node collectors — only for the node whose API
 * answers the scrape. The agent used to scrape one target with
 * cluster=1&node=1, so on a cluster the guests and replication jobs of every
 * other node never arrived. It now scrapes the cluster collectors once at
 * PVE_HOST and the node collectors once per node in PVE_NODES, and the
 * doctor checks exactly that: the same scrapes, every listed node, and a
 * cluster with more nodes than the list.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "ProxmoxAgent");
const SCRIPT = path.join(AGENT_DIR, "troubleshoot.sh");

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

// The cluster scrape: three nodes, whichever node it asks.
const CLUSTER_SCRAPE = [
  "# HELP pve_up Node/VM/CT-Status is online/running",
  'pve_up{id="node/pve1"} 1.0',
  'pve_up{id="node/pve2"} 1.0',
  'pve_up{id="node/pve3"} 1.0',
  'pve_node_info{id="node/pve1",level="",name="pve1",nodeid="1"} 1.0',
  'pve_node_info{id="node/pve2",level="",name="pve2",nodeid="2"} 1.0',
  'pve_node_info{id="node/pve3",level="",name="pve3",nodeid="3"} 1.0',
].join("\n");

/*
 * `docker` answers the runtime checks as a healthy install would, reads the
 * collector's environment from container.env, records every `docker run`
 * (the scrapes go through a curl container) and answers them: the cluster
 * collectors for any target, the node collectors only for the nodes listed
 * in $STUB_DIR/reachable-nodes.
 */
function run({ env }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proxmox-doctor-"));
  scratchDirs.push(dir);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(dir, "cluster.prom"), `${CLUSTER_SCRAPE}\n`);
  fs.writeFileSync(path.join(dir, "reachable-nodes"), "10.0.0.11\n10.0.0.12\n");
  writeExecutable(
    path.join(bin, "docker"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/docker.log"
case "$1" in
  info|compose) exit 0 ;;
  inspect)
    case "$*" in
      *Config.Env*) cat "$STUB_DIR/container.env" ;;
      *restarting*) printf 'running restarting=false restarts=0\\n' ;;
      *State.Status*) printf 'running\\n' ;;
    esac
    exit 0 ;;
  logs) exit 0 ;;
  run)
    case "$*" in
      *"cluster=1&node=0"*) cat "$STUB_DIR/cluster.prom"; exit 0 ;;
      *"cluster=0&node=1"*)
        all="$*"; target="\${all##*target=}"; target="\${target%%&*}"
        if grep -qx "$target" "$STUB_DIR/reachable-nodes"; then
          printf '# HELP pve_onboot_status Proxmox vm config onboot value\\npve_onboot_status{id="qemu/100",node="pve1",type="qemu"} 1.0\\n'
          exit 0
        fi
        echo "curl: (22) The requested URL returned error: 500"
        exit 22 ;;
      *127.0.0.1:8888/metrics*)
        printf 'otelcol_receiver_accepted_metric_points 10\\notelcol_exporter_sent_metric_points 10\\notelcol_exporter_send_failed_metric_points 0\\n' ;;
      *) printf '{}\\nOUSTATUS:200\\n' ;;
    esac
    exit 0 ;;
esac
exit 0
`,
  );

  const envText = `${[
    "ONEUPTIME_URL=https://oneuptime.example.com",
    "ONEUPTIME_TELEMETRY_INGESTION_KEY=0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11",
    "PROXMOX_CLUSTER_NAME=pve-prod",
    "PVE_HOST=10.0.0.11",
    "PVE_EXPORTER_URL=pve-exporter:9221",
    ...env,
  ].join("\n")}\n`;
  fs.writeFileSync(path.join(dir, "container.env"), envText);

  const installDir = path.join(dir, "agent");
  fs.mkdirSync(installDir);
  for (const file of ["docker-compose.yml", "otel-collector-config.yaml"]) {
    fs.copyFileSync(path.join(AGENT_DIR, file), path.join(installDir, file));
  }
  fs.writeFileSync(path.join(installDir, ".env"), envText);

  const result = spawnSync(
    "bash",
    [SCRIPT, "-d", installDir, "--no-color", "--skip-egress"],
    {
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_DIR: dir },
      encoding: "utf8",
      timeout: 60000,
    },
  );

  return {
    output: `${result.stdout}${result.stderr}`,
    scrapes: fs
      .readFileSync(path.join(dir, "docker.log"), "utf8")
      .split("\n")
      .filter((line) => {
        return line.startsWith("run ") && line.includes("/pve?");
      })
      .map((line) => {
        return line.slice(line.indexOf("http://"));
      }),
  };
}

describe("agents/ProxmoxAgent/troubleshoot.sh, the exporter scrapes", () => {
  test("scrapes as the collector does: the cluster once at PVE_HOST, the node collectors once per listed node", () => {
    const result = run({ env: ["PVE_NODES=[10.0.0.11,10.0.0.12]"] });

    expect(result.scrapes).toEqual([
      "http://pve-exporter:9221/pve?target=10.0.0.11&cluster=1&node=0",
      "http://pve-exporter:9221/pve?target=10.0.0.11&cluster=0&node=1",
      "http://pve-exporter:9221/pve?target=10.0.0.12&cluster=0&node=1",
    ]);
    expect(result.output).toContain(
      "✔ Node 10.0.0.11 answers the node collectors (start-on-boot, replication).",
    );
    expect(result.output).toContain(
      "✔ Node 10.0.0.12 answers the node collectors (start-on-boot, replication).",
    );
  });

  test("warns when the cluster has more nodes than PVE_NODES lists", () => {
    const result = run({ env: ["PVE_NODES=[10.0.0.11,10.0.0.12]"] });

    expect(result.output).toContain(
      "▲ The cluster has 3 nodes but PVE_NODES lists 2 — Guest Down and Replication Failing never see the guests and jobs of the others.",
    );
  });

  test("names a listed node the exporter cannot read", () => {
    const result = run({
      env: ["PVE_NODES=[10.0.0.11, 10.0.0.12, 10.0.0.13]"],
    });

    expect(result.output).toContain(
      "▲ Node 10.0.0.13 does not answer the node collectors — its guests' start-on-boot and its replication jobs are missing.",
    );
    // All three are listed, so the count matches the cluster's.
    expect(result.output).not.toContain("but PVE_NODES lists");
  });

  test("with no PVE_NODES, reads PVE_HOST alone, as docker-compose.yml does", () => {
    const result = run({ env: [] });

    expect(result.scrapes).toEqual([
      "http://pve-exporter:9221/pve?target=10.0.0.11&cluster=1&node=0",
      "http://pve-exporter:9221/pve?target=10.0.0.11&cluster=0&node=1",
    ]);
    expect(result.output).toContain(
      "▲ The cluster has 3 nodes but PVE_NODES lists 1",
    );
    expect(
      fs.readFileSync(path.join(AGENT_DIR, "docker-compose.yml"), "utf8"),
    ).toContain("- PVE_NODES=${PVE_NODES:-[${PVE_HOST:-localhost}]}");
  });

  test("a list without its square brackets is the error that stops the collector", () => {
    const result = run({ env: ["PVE_NODES=10.0.0.11,10.0.0.12"] });

    expect(result.output).toContain(
      "✗ PVE_NODES is '10.0.0.11,10.0.0.12' — not a list in square brackets, so the collector refuses to start.",
    );
    expect(
      result.scrapes.filter((url) => {
        return url.includes("cluster=0&node=1");
      }),
    ).toEqual([]);
  });
});
