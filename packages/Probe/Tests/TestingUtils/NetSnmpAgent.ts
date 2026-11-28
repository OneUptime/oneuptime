import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { findFreeUdpPort } from "./SnmpTrapListenerHarness";

/*
 * Net-SNMP's own agent, snmpd, as a test polls it: the agent most network
 * gear's SNMP stacks are built on or tested against, so what it answers is
 * what a device answers.
 *
 * Where it comes from, in order:
 *
 *   - snmpd on PATH (`apt-get install snmpd`, `apk add net-snmp`);
 *   - a Docker image that has it, named by NET_SNMP_TOOLS_DOCKER_IMAGE (as
 *     the tools' suites take it), run with the host's network:
 *
 *       printf 'FROM alpine:3.22\nRUN apk add --no-cache net-snmp net-snmp-tools\n' \
 *         | docker build -t net-snmp-tools -
 *       NET_SNMP_TOOLS_DOCKER_IMAGE=net-snmp-tools npx jest <test>
 *
 * Neither: the tests that need it are skipped, and say why.
 */

export interface NetSnmpAgent {
  // How it is run, for the test's own log line.
  describe: string;
  port: number;
  stop: () => void;
}

function hasCommand(command: string): boolean {
  const result: SpawnSyncReturns<Buffer> = spawnSync("sh", [
    "-c",
    `command -v ${command}`,
  ]);
  return result.status === 0;
}

function dockerImage(): string {
  return (process.env["NET_SNMP_TOOLS_DOCKER_IMAGE"] || "").trim();
}

export function canStartNetSnmpAgent(): boolean {
  return hasCommand("snmpd") || Boolean(dockerImage() && hasCommand("docker"));
}

/*
 * Starts snmpd on a free loopback port with `config` (agentAddress is
 * written in), and returns once it is started. The caller stops it.
 */
export async function startNetSnmpAgent(
  config: Array<string>,
): Promise<NetSnmpAgent> {
  const port: number = await findFreeUdpPort();
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-snmpd-"),
  );
  const file: string = path.join(directory, "snmpd.conf");

  fs.writeFileSync(
    file,
    [`agentAddress udp:127.0.0.1:${port}`, ...config, ""].join("\n"),
  );
  fs.chmodSync(directory, 0o755);
  fs.chmodSync(file, 0o644);

  if (hasCommand("snmpd")) {
    const started: SpawnSyncReturns<Buffer> = spawnSync(
      "snmpd",
      [
        "-C",
        "-c",
        file,
        "-Lf",
        path.join(directory, "snmpd.log"),
        "-p",
        path.join(directory, "snmpd.pid"),
      ],
      { timeout: 30000 },
    );

    if (started.status !== 0) {
      throw new Error(`snmpd did not start: ${started.stderr?.toString()}`);
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 1000);
    });

    return {
      describe: "snmpd on PATH",
      port: port,
      stop: (): void => {
        const pid: string = fs
          .readFileSync(path.join(directory, "snmpd.pid"), "utf8")
          .trim();
        spawnSync("kill", [pid]);
        fs.rmSync(directory, { recursive: true, force: true });
      },
    };
  }

  const name: string = `oneuptime-snmpd-${port}`;
  const started: SpawnSyncReturns<Buffer> = spawnSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--network",
      "host",
      "-v",
      `${directory}:/cfg:ro`,
      dockerImage(),
      "sh",
      "-c",
      "cp /cfg/snmpd.conf /tmp/snmpd.conf && exec snmpd -f -Lo -C -c /tmp/snmpd.conf",
    ],
    { timeout: 60000 },
  );

  if (started.status !== 0) {
    throw new Error(`snmpd did not start: ${started.stderr?.toString()}`);
  }

  // Until it reads its configuration and binds.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 2000);
  });

  return {
    describe: `snmpd in Docker image ${dockerImage()}`,
    port: port,
    stop: (): void => {
      spawnSync("docker", ["rm", "-f", name], { timeout: 60000 });
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}
