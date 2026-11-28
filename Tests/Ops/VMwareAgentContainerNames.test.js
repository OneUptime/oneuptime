/*
 * A second vCenter's agent on one machine keeps container names of its
 * own (#11434): agents/VMwareAgent/install.sh against the stand-in engine of
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
  title: "agents/VMwareAgent/install.sh",
  agentDir: "VMwareAgent",
  installName: "vmware-agent",
  defaultInstallDir: "/opt/oneuptime-vmware-agent",
  noun: "vCenter",
  keepsRecord: false,
  collector: {
    variable: "VMWARE_AGENT_CONTAINER_NAME",
    service: "oneuptime-vmware-agent",
    default: "oneuptime-vmware-agent",
  },
  companions: [
    {
      variable: "VMWARE_AI_AGENT_CONTAINER_NAME",
      service: "oneuptime-vmware-ai-agent",
      default: "oneuptime-vmware-ai-agent",
      role: "ai",
    },
  ],
  // A fresh install that asks nothing: the AI agent stays read-only.
  env: () => {
    return {
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11",
      VMWARE_VCENTER_NAME: "vcenter",
      VCENTER_ENDPOINT: "https://vcsa.example.com",
      VCENTER_USERNAME: "oneuptime@vsphere.local",
      VCENTER_PASSWORD: "s3cr$t'x",
      VCENTER_INSECURE_SKIP_VERIFY: "true",
      VCENTER_COLLECTION_INTERVAL: "2m",
      ONEUPTIME_AI_ALLOW_WRITES: "false",
    };
  },
  running: () => {
    return ["oneuptime-vmware-agent", "oneuptime-vmware-ai-agent"];
  },
});

describe("agents/VMwareAgent/install.sh says how to reach a renamed AI agent", () => {
  test("its status command names the AI agent's own container", () => {
    const dir = suite.scratch();
    const result = suite.install(dir, "cluster2");
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "AI agent status:  docker exec oneuptime-vmware-ai-agent-cluster2 wget -qO- http://127.0.0.1:3877/status",
    );
  });
});

/* -------------------------------------------------------- troubleshoot.sh */

describe("agents/VMwareAgent/troubleshoot.sh finds the agent's containers whatever they are named", () => {
  const DOCTOR = path.join(
    REPO_ROOT,
    "agents",
    "VMwareAgent",
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
    expect(suite.install(dir, "oneuptime-vmware-agent").status).toBe(0);
    const second = suite.install(dir, "cluster2");
    expect(second.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, second.installDir);

    const calls = inspected(dir);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.join("\n")).toContain("oneuptime-vmware-agent-cluster2");
    expect(calls.join("\n")).not.toMatch(/ oneuptime-vmware-agent$/m);
  });

  test("a first agent's, under the default names", () => {
    const dir = suite.scratch();
    const first = suite.install(dir, "oneuptime-vmware-agent");
    expect(first.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, first.installDir);

    expect(inspected(dir).join("\n")).toMatch(/ oneuptime-vmware-agent$/m);
  });
});
