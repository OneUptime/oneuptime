/*
 * A second Proxmox cluster's agent on one machine keeps container names of
 * its own (#11434): agents/ProxmoxAgent/install.sh against the stand-in
 * engine of Utils/ComposeNamesEngine.js (Utils/AgentContainerNamesSuite.js
 * says what is held), for the collector, its API failover sidecar, its
 * bundled exporter and its AI agent, and troubleshoot.sh finding each by
 * those names.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  describeAgentContainerNames,
} = require("./Utils/AgentContainerNamesSuite");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const suite = describeAgentContainerNames({
  title: "agents/ProxmoxAgent/install.sh",
  agentDir: "ProxmoxAgent",
  installName: "proxmox-agent",
  defaultInstallDir: "/opt/oneuptime-proxmox-agent",
  noun: "cluster",
  keepsRecord: true,
  collector: {
    variable: "PROXMOX_AGENT_CONTAINER_NAME",
    service: "oneuptime-proxmox-agent",
    default: "oneuptime-proxmox-agent",
  },
  companions: [
    {
      variable: "PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME",
      service: "pve-api-failover",
      default: "oneuptime-pve-api-failover",
      role: "pve-api-failover",
    },
    {
      variable: "PROXMOX_PVE_EXPORTER_CONTAINER_NAME",
      service: "pve-exporter",
      default: "oneuptime-pve-exporter",
      role: "pve-exporter",
    },
    {
      variable: "PROXMOX_AI_AGENT_CONTAINER_NAME",
      service: "oneuptime-proxmox-ai-agent",
      default: "oneuptime-proxmox-ai-agent",
      role: "ai",
    },
  ],
  /*
   * A fresh install that asks nothing: the bundled exporter (its profile on)
   * with a read-only token, every node given, and the AI agent read-only.
   */
  env: () => {
    return {
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11",
      PROXMOX_CLUSTER_NAME: "pve",
      PVE_HOST: "10.0.0.1",
      PVE_NODES: "10.0.0.1,10.0.0.2",
      COMPOSE_PROFILES: "pve-exporter",
      PVE_API_TOKEN_ID: "monitoring@pam!oneuptime",
      PVE_API_TOKEN_SECRET: "s3cr$t'x",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
    };
  },
  running: () => {
    return [
      "oneuptime-proxmox-agent",
      "pve-api-failover",
      "pve-exporter",
      "oneuptime-proxmox-ai-agent",
    ];
  },
});

describe("agents/ProxmoxAgent/install.sh says how to reach a renamed sidecar", () => {
  test("its status commands name the AI agent's and the failover sidecar's own containers", () => {
    const dir = suite.scratch();
    const result = suite.install(dir, "cluster2");
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "AI agent status:  docker exec oneuptime-proxmox-ai-agent-cluster2 wget -qO- http://127.0.0.1:3877/status",
    );
    expect(result.output).toContain(
      "Node it reads:    docker logs oneuptime-pve-api-failover-cluster2",
    );
  });
});

/* -------------------------------------------------------- troubleshoot.sh */

describe("agents/ProxmoxAgent/troubleshoot.sh finds the agent's containers whatever they are named", () => {
  const DOCTOR = path.join(
    REPO_ROOT,
    "agents",
    "ProxmoxAgent",
    "troubleshoot.sh",
  );

  function doctor(dir, installDir) {
    return spawnSync("bash", [DOCTOR, "-d", installDir], {
      env: {
        PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
        HOME: dir,
        STUB_DIR: dir,
      },
      encoding: "utf8",
      timeout: 120000,
    });
  }

  function engineCalls(dir) {
    return fs
      .readFileSync(path.join(dir, "docker.log"), "utf8")
      .split("\n")
      .filter((line) => {
        return / \| (inspect|logs|exec)\b/.test(line);
      })
      .join("\n");
  }

  test("a second agent's collector, exporter and failover sidecar, by the names its .env gives", () => {
    const dir = suite.scratch();
    expect(suite.install(dir, "oneuptime-proxmox-agent").status).toBe(0);
    const second = suite.install(dir, "cluster2");
    expect(second.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, second.installDir);

    const calls = engineCalls(dir);
    for (const name of [
      "oneuptime-proxmox-agent-cluster2",
      "oneuptime-pve-exporter-cluster2",
      "oneuptime-pve-api-failover-cluster2",
    ]) {
      expect(calls).toContain(name);
    }
    expect(calls).not.toMatch(
      / (oneuptime-proxmox-agent|oneuptime-pve-exporter|oneuptime-pve-api-failover)( |$)/m,
    );
  });

  test("a first agent's, under the default names", () => {
    const dir = suite.scratch();
    const first = suite.install(dir, "oneuptime-proxmox-agent");
    expect(first.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, first.installDir);

    expect(engineCalls(dir)).toMatch(/ oneuptime-proxmox-agent$/m);
    expect(engineCalls(dir)).toMatch(/ oneuptime-pve-exporter$/m);
  });
});
