/*
 * A second OpenStack cloud's agent on one machine keeps container names of
 * its own (#11434): agents/OpenStackAgent/install.sh, with Docker, against
 * the stand-in engine of Utils/ComposeNamesEngine.js
 * (Utils/AgentContainerNamesSuite.js says what is held), for the collector,
 * its four exporters and its AI agent; an install without Docker, which runs
 * no container, writes none; and troubleshoot.sh finds each container by
 * the names .env gives.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  describeAgentContainerNames,
} = require("./Utils/AgentContainerNamesSuite");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Keystone's answer to a login: a catalog with one region.
const CATALOG = JSON.stringify({
  token: {
    project: { id: "own-project" },
    catalog: [
      {
        type: "compute",
        name: "nova",
        endpoints: [
          {
            id: "compute-RegionOne",
            interface: "public",
            region_id: "RegionOne",
            region: "RegionOne",
            url: "https://nova.example.com/RegionOne",
          },
        ],
      },
    ],
  },
});

const suite = describeAgentContainerNames({
  title: "agents/OpenStackAgent/install.sh",
  agentDir: "OpenStackAgent",
  installName: "openstack-agent",
  defaultInstallDir: "/opt/oneuptime-openstack-agent",
  noun: "cloud",
  keepsRecord: true,
  collector: {
    variable: "OPENSTACK_AGENT_CONTAINER_NAME",
    service: "oneuptime-openstack-agent",
    default: "oneuptime-openstack-agent",
  },
  companions: [
    {
      variable: "OPENSTACK_EXPORTER_CONTAINER_NAME",
      service: "openstack-exporter",
      default: "oneuptime-openstack-exporter",
      role: "exporter",
    },
    {
      variable: "OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME",
      service: "openstack-quota-exporter",
      default: "oneuptime-openstack-quota-exporter",
      role: "quota-exporter",
    },
    {
      variable: "OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME",
      service: "openstack-database-exporter",
      default: "oneuptime-openstack-database-exporter",
      role: "database-exporter",
    },
    {
      variable: "OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME",
      service: "openstack-worker-state-exporter",
      default: "oneuptime-openstack-worker-state-exporter",
      role: "worker-state-exporter",
    },
    {
      variable: "OPENSTACK_AI_AGENT_CONTAINER_NAME",
      service: "oneuptime-openstack-ai-agent",
      default: "oneuptime-openstack-ai-agent",
      role: "ai",
    },
  ],
  // A fresh install that asks nothing: every answer an environment variable.
  env: () => {
    return {
      ONEUPTIME_URL: "https://oneuptime.example.com",
      ONEUPTIME_TELEMETRY_INGESTION_KEY: "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11",
      OPENSTACK_CLOUD_NAME: "prod",
      OPENSTACK_AUTH_URL: "https://keystone.example.com:5000/v3",
      OPENSTACK_EXPORTER_CLOUDS: "RegionOne",
      OPENSTACK_APPLICATION_CREDENTIAL_ID: "4c2f7bd8a1e94f6b8d3c0e5a7f1b2c3d",
      OPENSTACK_APPLICATION_CREDENTIAL_SECRET: "s3cr$t'x",
    };
  },
  // Keystone takes the credential; uid 1000; chown records its calls.
  curlCases: `case "$url" in
  */auth/tokens)
    cat > /dev/null
    cat "$STUB_DIR/keystone-catalog.json"
    printf '\\n201'
    exit 0
    ;;
esac`,
  stubs: (bin, dir) => {
    fs.writeFileSync(
      path.join(bin, "id"),
      '#!/usr/bin/env bash\ncase "$1" in -u|-g) echo 1000 ;; *) exit 1 ;; esac\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(path.join(bin, "chown"), "#!/usr/bin/env bash\nexit 0\n", {
      mode: 0o755,
    });
    fs.writeFileSync(path.join(dir, "keystone-catalog.json"), CATALOG);
  },
  // The bundled exporter and the AI agent beside the collector (their profiles).
  running: () => {
    return [
      "oneuptime-openstack-agent",
      "openstack-exporter",
      "oneuptime-openstack-ai-agent",
    ];
  },
});

describe("agents/OpenStackAgent/install.sh names no container without Docker", () => {
  test("the container names are written with Docker only", () => {
    const script = fs.readFileSync(
      path.join(REPO_ROOT, "agents/OpenStackAgent/install.sh"),
      "utf8",
    );
    expect(script)
      .toContain(`# The containers' names, with Docker (CONTAINER_NAME_NAMES).
if [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then
    cat >> "$ENV_FILE" <<CONTAINER_NAMES_EOF`);
    expect(script).toContain(`CONTAINER_NAME_SOURCE=""
if [ "$RUNS_WITHOUT_DOCKER" = 0 ]; then`);
  });
});

/* -------------------------------------------------------- troubleshoot.sh */

describe("agents/OpenStackAgent/troubleshoot.sh finds the agent's containers whatever they are named", () => {
  const DOCTOR = path.join(
    REPO_ROOT,
    "agents",
    "OpenStackAgent",
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
      timeout: 180000,
    });
  }

  function engineCalls(dir) {
    return fs
      .readFileSync(path.join(dir, "docker.log"), "utf8")
      .split("\n")
      .filter((line) => {
        return / \| (inspect|logs|exec|run)\b/.test(line);
      })
      .join("\n");
  }

  test("a second agent's collector and exporter, by the names its .env gives", () => {
    const dir = suite.scratch();
    expect(suite.install(dir, "oneuptime-openstack-agent").status).toBe(0);
    const second = suite.install(dir, "cloud2");
    expect(second.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, second.installDir);

    const calls = engineCalls(dir);
    expect(calls).toContain("oneuptime-openstack-agent-cloud2");
    expect(calls).toContain("oneuptime-openstack-exporter-cloud2");
    expect(calls).not.toMatch(
      / (oneuptime-openstack-agent|oneuptime-openstack-exporter)( |$)/m,
    );
  });

  test("a first agent's, under the default names", () => {
    const dir = suite.scratch();
    const first = suite.install(dir, "oneuptime-openstack-agent");
    expect(first.status).toBe(0);
    fs.writeFileSync(path.join(dir, "docker.log"), "");

    doctor(dir, first.installDir);

    expect(engineCalls(dir)).toMatch(/ oneuptime-openstack-agent$/m);
  });
});
