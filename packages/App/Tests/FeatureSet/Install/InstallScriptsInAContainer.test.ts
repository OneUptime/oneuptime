import { createInstallFilesRouter } from "../../../FeatureSet/Install/API/InstallFiles";
import { getHostAiAgentInstallCommand } from "../../../FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentInstall";
import { getProxmoxInstallScriptCommand } from "../../../FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import { getVMwareInstallScriptCommand } from "../../../FeatureSet/Dashboard/src/Pages/VMware/Utils/DocumentationMarkdown";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  ChildProcess,
  spawn,
  spawnSync,
  SpawnSyncReturns,
} from "child_process";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

/*
 * End to end: an agent's install command, exactly as the Dashboard prints
 * it, run in a Linux container against this OneUptime's real /install
 * routes - the script downloaded with the real curl, run by the real bash,
 * downloading its files from the OneUptime it reports to, as far as an
 * install gets without a real Proxmox VE or vCenter. Docker inside the
 * container is a stub that records what it is asked to start.
 *
 * GitHub is unreachable in the container (raw.githubusercontent.com points
 * at a closed port), so an install that passes took every file from this
 * OneUptime.
 *
 * Opt-in, as it builds an image and runs containers: set
 * RUN_AGENT_INSTALL_CONTAINER_TESTS=1, with docker on the machine. The
 * suites that always run hold the same pieces apart: InstallFiles (the
 * routes), Tests/Ops/AgentInstallScriptsServed (the scripts, against a
 * local server) and Common's AgentInstallCommandsServed (the commands).
 */

const APP_DIR: string = path.join(__dirname, "..", "..", "..");
const PACKAGES_DIR: string = path.join(APP_DIR, "..");
const REPO_ROOT: string = path.join(PACKAGES_DIR, "..");

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const express: any = require(
  path.join(PACKAGES_DIR, "Common", "node_modules", "express"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const RUN: boolean = process.env["RUN_AGENT_INSTALL_CONTAINER_TESTS"] === "1";

// A Debian with curl and bash, as most hosts an agent runs on.
const IMAGE: string = "oneuptime-install-scripts-e2e:bookworm";
const DOCKERFILE: string = [
  "FROM public.ecr.aws/docker/library/debian:bookworm-slim",
  "RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*",
  "",
].join("\n");

const VERSION: string = "14.0.99-e2e";
// The longest one install may take before its container is removed.
const RUN_TIMEOUT_MS: number = 5 * 60 * 1000;
const KEY: string = "0b6a4e39-1f0e-4a7c-9d57-6c0f2a8a3b11";

// docker answers every check and records its calls; sudo runs its command (the container runs as root).
const DOCKER_STUB: string = `#!/bin/bash
printf '%s | %s\\n' "$PWD" "$*" >> /work/docker.log
case "$*" in
  "compose version"*) echo "Docker Compose version v2.29.7" ;;
esac
exit 0
`;
const SUDO_STUB: string = '#!/bin/bash\nexec "$@"\n';

interface ContainerRun {
  status: number | null;
  output: string;
  work: string;
}

interface Served {
  url: string;
  requests: Array<string>;
  close: () => Promise<void>;
}

function docker(args: Array<string>, input?: string): SpawnSyncReturns<string> {
  return spawnSync("docker", args, {
    encoding: "utf8",
    input: input,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
}

function hasDocker(): boolean {
  return docker(["version", "--format", "{{.Server.Version}}"]).status === 0;
}

const describeInContainers: typeof describe =
  RUN && hasDocker() ? describe : describe.skip;

/*
 * This OneUptime's /install routes, from this checkout's files as the image
 * holds them, on a port the container reaches (it shares the host's
 * network). Every request is recorded.
 */
function serve(): Promise<Served> {
  const app: any = express();
  const requests: Array<string> = [];

  app.use((req: any, _res: any, next: () => void): void => {
    requests.push(`${req.method} ${req.originalUrl}`);
    next();
  });
  app.use(
    "/install",
    createInstallFilesRouter({ root: REPO_ROOT, version: VERSION }),
  );

  return new Promise((resolve: (served: Served) => void): void => {
    const server: http.Server = app.listen(0, "127.0.0.1", (): void => {
      const address: any = server.address();

      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests: requests,
        close: (): Promise<void> => {
          return new Promise((done: () => void): void => {
            server.close((): void => {
              done();
            });
          });
        },
      });
    });
  });
}

function writeExecutable(file: string, text: string): void {
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o755);
}

const workDirs: Array<string> = [];

/*
 * Runs a command in a fresh container: the Dashboard's command, in /work,
 * with the stubs first on PATH, the given environment and answers on stdin.
 * Asynchronously: this process serves the files the container downloads.
 */
async function runInContainer(data: {
  command: string;
  env: Record<string, string>;
  input?: string;
}): Promise<ContainerRun> {
  const work: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "install-scripts-e2e-"),
  );
  workDirs.push(work);
  fs.mkdirSync(path.join(work, "stub"));
  writeExecutable(path.join(work, "stub", "docker"), DOCKER_STUB);
  writeExecutable(path.join(work, "stub", "sudo"), SUDO_STUB);

  const envArgs: Array<string> = Object.entries(data.env).flatMap(
    ([name, value]: [string, string]): Array<string> => {
      return ["-e", `${name}=${value}`];
    },
  );
  const name: string = `oneuptime-install-scripts-e2e-${crypto.randomBytes(4).toString("hex")}`;
  const child: ChildProcess = spawn(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--name",
      name,
      "--network",
      "host",
      // GitHub is unreachable: every file must come from this OneUptime.
      "--add-host",
      "raw.githubusercontent.com:127.0.0.1",
      "-v",
      `${work}:/work`,
      "-w",
      "/work",
      "-e",
      "PATH=/work/stub:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      ...envArgs,
      IMAGE,
      "bash",
      "-euo",
      "pipefail",
      "-c",
      data.command,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output: string = "";

  child.stdout!.on("data", (chunk: Buffer): void => {
    output += chunk.toString("utf8");
  });
  child.stderr!.on("data", (chunk: Buffer): void => {
    output += chunk.toString("utf8");
  });
  child.stdin!.end(data.input || "");

  const status: number | null = await new Promise(
    (resolve: (code: number | null) => void): void => {
      const timer: NodeJS.Timeout = setTimeout((): void => {
        output += `\n(stopped after ${RUN_TIMEOUT_MS} ms)`;
        docker(["rm", "-f", name]);
      }, RUN_TIMEOUT_MS);

      child.on("close", (code: number | null): void => {
        clearTimeout(timer);
        resolve(code);
      });
    },
  );

  return { status: status, output: output, work: work };
}

function readIn(run: ContainerRun, file: string): string {
  const full: string = path.join(run.work, file);

  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
}

function agentFile(directory: string, file: string): string {
  return fs.readFileSync(
    path.join(REPO_ROOT, "agents", directory, file),
    "utf8",
  );
}

describeInContainers("an agent's install command, run in a container", () => {
  let served: Served;

  beforeAll(
    async () => {
      const build: SpawnSyncReturns<string> = docker(
        ["build", "-t", IMAGE, "-"],
        DOCKERFILE,
      );

      if (build.status !== 0) {
        throw new Error(`docker build failed:\n${build.stderr}`);
      }

      served = await serve();
    },
    15 * 60 * 1000,
  );

  afterAll(async () => {
    if (served) {
      await served.close();
    }

    // Files the container wrote as root, removed as root.
    for (const work of workDirs) {
      docker([
        "run",
        "--rm",
        "-v",
        `${work}:/work`,
        IMAGE,
        "sh",
        "-c",
        "rm -rf /work/* /work/.[!.]*",
      ]);
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  test(
    "Proxmox: the guide's command downloads the script and the agent's files from this OneUptime, and starts the agent",
    async () => {
      const command: string = getProxmoxInstallScriptCommand({
        oneuptimeUrl: served.url,
        apiKey: KEY,
        hasApiKey: true,
      });
      const before: number = served.requests.length;

      expect(command).toBe(
        `curl -fsSL ${served.url}/install/proxmox-agent -o install.sh\nONEUPTIME_URL=${served.url} ONEUPTIME_TELEMETRY_INGESTION_KEY=${KEY} bash install.sh`,
      );

      // The answers the maintainer's screenshot lists, in the script's order.
      const run: ContainerRun = await runInContainer({
        command: command,
        env: { INSTALL_DIR: "/work/agent" },
        input: [
          "my-proxmox-cluster", // Cluster name
          "127.0.0.1:9", // Proxmox VE API host: nothing answers, as without a real cluster
          "Y", // Bundled prometheus-pve-exporter
          "monitoring@pam!oneuptime", // API token id
          "0d1e2f3a-4b5c-6d7e-8f90-a1b2c3d4e5f6", // and its secret
          "", // Every node's address: the API host
          "N", // The AI agent stays read-only
          "",
        ].join("\n"),
      });

      expect({ status: run.status, output: run.output }).toEqual({
        status: 0,
        output: expect.stringContaining("OneUptime Proxmox Agent is running!"),
      });
      expect(served.requests.slice(before)).toEqual([
        "GET /install/proxmox-agent",
        "GET /install/proxmox-agent/docker-compose.yml",
        "GET /install/proxmox-agent/otel-collector-config.yaml",
      ]);
      expect(readIn(run, "install.sh")).toBe(
        agentFile("ProxmoxAgent", "install.sh"),
      );
      expect(readIn(run, "agent/docker-compose.yml")).toBe(
        agentFile("ProxmoxAgent", "docker-compose.yml"),
      );
      expect(readIn(run, "agent/otel-collector-config.yaml")).toBe(
        agentFile("ProxmoxAgent", "otel-collector-config.yaml"),
      );

      const env: string = readIn(run, "agent/.env");

      // The agent reports to the OneUptime its files came from.
      expect(env).toContain(`ONEUPTIME_URL='${served.url}'`);
      expect(env).toContain(`ONEUPTIME_TELEMETRY_INGESTION_KEY='${KEY}'`);
      expect(env).toContain("PROXMOX_CLUSTER_NAME='my-proxmox-cluster'");
      expect(env).toContain("COMPOSE_PROFILES='pve-exporter'");
      expect(readIn(run, "docker.log")).toContain(
        "/work/agent | compose up -d --force-recreate",
      );
      expect(run.output).not.toContain("Downloading them from GitHub instead.");
    },
    10 * 60 * 1000,
  );

  test(
    "VMware: the same, with the vCenter settings from the environment",
    async () => {
      const command: string = getVMwareInstallScriptCommand({
        oneuptimeUrl: served.url,
        apiKey: KEY,
        hasApiKey: true,
      });
      const before: number = served.requests.length;

      const run: ContainerRun = await runInContainer({
        command: command,
        env: {
          INSTALL_DIR: "/work/agent",
          VMWARE_VCENTER_NAME: "vcsa-prod",
          VCENTER_ENDPOINT: "https://vcsa.example.com",
          VCENTER_USERNAME: "oneuptime@vsphere.local",
          VCENTER_PASSWORD: "s3cret",
          VCENTER_INSECURE_SKIP_VERIFY: "true",
          VCENTER_COLLECTION_INTERVAL: "2m",
          ONEUPTIME_AI_ALLOW_WRITES: "false",
        },
      });

      expect({ status: run.status, output: run.output }).toEqual({
        status: 0,
        output: expect.stringContaining("OneUptime VMware Agent is running!"),
      });
      expect(served.requests.slice(before)).toEqual([
        "GET /install/vmware-agent",
        "GET /install/vmware-agent/docker-compose.yml",
        "GET /install/vmware-agent/otel-collector-config.yaml",
      ]);
      expect(readIn(run, "agent/docker-compose.yml")).toBe(
        agentFile("VMwareAgent", "docker-compose.yml"),
      );
      expect(readIn(run, "agent/.env")).toContain(
        `ONEUPTIME_URL='${served.url}'`,
      );
      expect(readIn(run, "docker.log")).toContain("compose up -d");
      // The diagnostic it suggests is on the same OneUptime.
      expect(run.output).toContain(
        `curl -fsSL ${served.url}/install/vmware-agent/troubleshoot.sh | bash`,
      );
    },
    10 * 60 * 1000,
  );

  test(
    "Host AI agent: the AI agent page's command, run as root",
    async () => {
      const command: string = getHostAiAgentInstallCommand(served.url);
      const before: number = served.requests.length;

      expect(command).toBe(
        `curl -fsSL ${served.url}/install/host-ai-agent -o install.sh\nsudo bash install.sh`,
      );

      const run: ContainerRun = await runInContainer({
        command: command,
        env: {
          INSTALL_DIR: "/work/agent",
          ONEUPTIME_URL: served.url,
          ONEUPTIME_TELEMETRY_INGESTION_KEY: KEY,
          HOST_NAME: "web-1",
          ONEUPTIME_AI_ALLOW_WRITES: "false",
        },
      });

      expect(run.status).toBe(0);
      expect(served.requests.slice(before)).toEqual([
        "GET /install/host-ai-agent",
        "GET /install/host-ai-agent/docker-compose.yml",
        "GET /install/host-ai-agent/systemd/oneuptime-host-ai-agent.service",
      ]);
      expect(readIn(run, "agent/docker-compose.yml")).toBe(
        agentFile("HostAIAgent", "docker-compose.yml"),
      );
    },
    10 * 60 * 1000,
  );

  test(
    "a OneUptime that does not serve the agent stops the install: nothing is started",
    async () => {
      const run: ContainerRun = await runInContainer({
        command: `curl -fsSL ${served.url}/install/no-such-agent -o install.sh && bash install.sh`,
        env: {},
      });

      // curl -f: the 404's text is never saved as a script, and nothing runs.
      expect(run.status).toBe(22);
      expect(readIn(run, "install.sh")).toBe("");
      expect(readIn(run, "docker.log")).toBe("");
    },
    10 * 60 * 1000,
  );
});
