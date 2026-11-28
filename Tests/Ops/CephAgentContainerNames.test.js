/*
 * A second Ceph cluster's agent on one machine keeps container names of its
 * own (#11434): agents/CephAgent/install.sh against the stand-in engine of
 * Utils/ComposeNamesEngine.js (Utils/AgentContainerNamesSuite.js says what
 * is held), and troubleshoot.sh finding the containers by them.
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
  title: "agents/CephAgent/install.sh",
  agentDir: "CephAgent",
  installName: "ceph-agent",
  defaultInstallDir: "/opt/oneuptime-ceph-agent",
  noun: "cluster",
  keepsRecord: true,
  collector: {
    variable: "CEPH_AGENT_CONTAINER_NAME",
    service: "oneuptime-ceph-agent",
    default: "oneuptime-ceph-agent",
  },
  companions: [
    {
      variable: "CEPH_AI_AGENT_CONTAINER_NAME",
      service: "oneuptime-ceph-ai-agent",
      default: "oneuptime-ceph-ai-agent",
      role: "ai",
    },
  ],
  // A fresh install that asks nothing: the AI agent stays read-only.
  env: () => {
    return {
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11",
      CEPH_CLUSTER_NAME: "ceph",
      CEPH_MGR_ENDPOINTS: "[mon1:9283,mon2:9283]",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
    };
  },
  // No ceph CLI that works: the AI agent's client is not offered.
  stubs: (bin) => {
    fs.writeFileSync(path.join(bin, "ceph"), "#!/bin/sh\nexit 1\n", {
      mode: 0o755,
    });
  },
  running: () => {
    return ["oneuptime-ceph-agent", "oneuptime-ceph-ai-agent"];
  },
});

describe("agents/CephAgent/install.sh says how to reach a renamed AI agent", () => {
  test("its status command names the AI agent's own container", () => {
    const dir = suite.scratch();
    const result = suite.install(dir, "cluster2");
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "AI agent status:  docker exec oneuptime-ceph-ai-agent-cluster2 wget -qO- http://127.0.0.1:3877/status",
    );
  });
});

/* -------------------------------------------------------- troubleshoot.sh */

describe("agents/CephAgent/troubleshoot.sh finds the agent's containers whatever they are named", () => {
  const DOCTOR = path.join(REPO_ROOT, "agents", "CephAgent", "troubleshoot.sh");

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

  function inspected(dir) {
    return fs
      .readFileSync(path.join(dir, "docker.log"), "utf8")
      .split("\n")
      .filter((line) => {
        return / \| (inspect|logs)\b/.test(line);
      });
  }

  test("a second agent's, by the names its .env gives, not the first agent's", () => {
    const dir = suite.scratch();
    expect(suite.install(dir, "oneuptime-ceph-agent").status).toBe(0);
    const second = suite.install(dir, "cluster2");
    expect(second.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, second.installDir);

    const calls = inspected(dir);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.join("\n")).toContain("oneuptime-ceph-agent-cluster2");
    expect(calls.join("\n")).not.toMatch(/ oneuptime-ceph-agent$/m);
  });

  test("a first agent's, under the default names", () => {
    const dir = suite.scratch();
    const first = suite.install(dir, "oneuptime-ceph-agent");
    expect(first.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, first.installDir);

    expect(inspected(dir).join("\n")).toMatch(/ oneuptime-ceph-agent$/m);
  });
});
