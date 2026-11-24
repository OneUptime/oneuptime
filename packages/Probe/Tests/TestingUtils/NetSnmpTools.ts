import { spawn, spawnSync, SpawnSyncReturns } from "child_process";

/*
 * Net-SNMP's own command-line tools - snmptrap and snmpinform - as a test
 * sends real SNMP notifications with them: the stack most network gear's
 * SNMP agents are built on or tested against, so what they send is what a
 * device sends.
 *
 * Where they come from, in order:
 *
 *   - snmptrap and snmpinform on PATH (`apt-get install snmp`,
 *     `apk add net-snmp-tools`);
 *   - a Docker image that has them, named by NET_SNMP_TOOLS_DOCKER_IMAGE,
 *     run with the host's network so 127.0.0.1 is the test's receiver:
 *
 *       printf 'FROM alpine:3.22\nRUN apk add --no-cache net-snmp-tools\n' \
 *         | docker build -t net-snmp-tools -
 *       NET_SNMP_TOOLS_DOCKER_IMAGE=net-snmp-tools npx jest <test>
 *
 * Neither: the tests that need them are skipped, and say why.
 */

export interface NetSnmpToolResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface NetSnmpTools {
  // How the tools are run, for the test's own log line.
  describe: string;
  // The protocols this build's -a and -x take, from its own help.
  authProtocols: Array<string>;
  privProtocols: Array<string>;
  run: (
    tool: "snmptrap" | "snmpinform",
    args: Array<string>,
    timeoutMs?: number,
  ) => Promise<NetSnmpToolResult>;
}

function hasCommand(command: string): boolean {
  const result: SpawnSyncReturns<Buffer> = spawnSync("sh", [
    "-c",
    `command -v ${command}`,
  ]);
  return result.status === 0;
}

function prefixFor(): Array<string> | null {
  if (hasCommand("snmptrap") && hasCommand("snmpinform")) {
    return [];
  }

  const image: string = (process.env["NET_SNMP_TOOLS_DOCKER_IMAGE"] || "").trim();

  if (image && hasCommand("docker")) {
    return ["docker", "run", "--rm", "--network", "host", image];
  }

  return null;
}

function readProtocols(helpText: string, flag: "-a" | "-x"): Array<string> {
  const line: string | undefined = helpText.split("\n").find((text: string) => {
    return text.trim().startsWith(`${flag} PROTOCOL`);
  });

  const match: RegExpMatchArray | null = line
    ? line.match(/\(([^)]*)\)/)
    : null;

  return match && match[1] ? match[1].split("|") : [];
}

export function findNetSnmpTools(): NetSnmpTools | null {
  const prefix: Array<string> | null = prefixFor();

  if (!prefix) {
    return null;
  }

  const command: (tool: string, args: Array<string>) => Array<string> = (
    tool: string,
    args: Array<string>,
  ): Array<string> => {
    return [...prefix, tool, ...args];
  };

  const help: SpawnSyncReturns<Buffer> = spawnSync(
    command("snmptrap", ["-h"])[0]!,
    command("snmptrap", ["-h"]).slice(1),
    { timeout: 60000 },
  );
  const helpText: string = `${help.stdout?.toString() || ""}${help.stderr?.toString() || ""}`;

  return {
    describe:
      prefix.length === 0
        ? "Net-SNMP tools on PATH"
        : `Net-SNMP tools in Docker image ${prefix[prefix.length - 1]}`,
    authProtocols: readProtocols(helpText, "-a"),
    privProtocols: readProtocols(helpText, "-x"),
    run: (
      tool: "snmptrap" | "snmpinform",
      args: Array<string>,
      timeoutMs: number = 30000,
    ): Promise<NetSnmpToolResult> => {
      const argv: Array<string> = command(tool, args);

      return new Promise(
        (resolve: (result: NetSnmpToolResult) => void): void => {
          const child: ReturnType<typeof spawn> = spawn(
            argv[0]!,
            argv.slice(1),
          );
          let stdout: string = "";
          let stderr: string = "";

          child.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
          });
          child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });

          const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
            child.kill("SIGKILL");
          }, timeoutMs);

          child.on("close", (code: number | null) => {
            clearTimeout(timer);
            resolve({ exitCode: code, stdout: stdout, stderr: stderr });
          });
        },
      );
    },
  };
}
