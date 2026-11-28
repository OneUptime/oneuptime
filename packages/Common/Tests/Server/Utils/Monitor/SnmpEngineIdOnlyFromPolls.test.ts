import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A DEVICE'S SNMP ENGINE ID COMES FROM ITS OWN POLL, NEVER FROM A TRAP
 * (OneUptime issues #11172, #11405).
 *
 * NetworkDevice.snmpEngineId tells apart devices that send SNMPv3 traps
 * from one address: the trap goes to the device whose own agent answered
 * its poll as the engine the trap was sent from. That is only worth
 * something while the engine ID is read where it can be trusted - from the
 * device's own agent, at its polling address, by the device's own poll
 * (an SNMPv3 poll's discovery; since #11405 a v1 or v2c poll's snmpEngineID
 * over its community, or SNMPv3 discovery at that address). A trap is sent
 * by whoever can reach the probe, as any engine: were one to write it, a
 * neighbour could take a device's traps by sending one.
 *
 * So this reads the code that could write it and holds each file to what
 * it does with it:
 *
 *   - on the probe, only the poll's walk (SnmpMonitor) says a device's
 *     engine ID, and nothing of the trap receiver does;
 *   - on the server, only the poll's inventory update writes it, from the
 *     walk's system group (NetworkInventoryUtil); trap matching reads it.
 */

const REPOSITORY: string = path.resolve(__dirname, "../../../../../..");

const SKIPPED: ReadonlySet<string> = new Set([
  "node_modules",
  "build",
  "dist",
  "Tests",
]);

function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }

    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(full);
    }
  }

  return files;
}

// Each file that names the column, outside comments, by its repository path.
function filesNaming(directories: Array<string>): Map<string, string> {
  const named: Map<string, string> = new Map();

  for (const directory of directories) {
    for (const file of sourceFiles(path.join(REPOSITORY, directory))) {
      const code: string = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line: string): boolean => {
          const trimmed: string = line.trim();
          return !trimmed.startsWith("*") && !trimmed.startsWith("//");
        })
        .join("\n");

      if (code.includes("snmpEngineId")) {
        named.set(path.relative(REPOSITORY, file), code);
      }
    }
  }

  return named;
}

describe("on the probe", () => {
  const named: Map<string, string> = filesNaming(["packages/Probe"]);

  test("only the poll's walk says a device's engine ID: the trap receiver never does", () => {
    expect(Array.from(named.keys()).sort()).toEqual([
      "packages/Probe/Utils/Monitors/MonitorTypes/SnmpMonitor.ts",
    ]);
  });

  test("the walk says it from its own session's discovery, or from the device's agent at its polling address", () => {
    const walk: string =
      named.get("packages/Probe/Utils/Monitors/MonitorTypes/SnmpMonitor.ts") ||
      "";

    expect(walk).toContain("SnmpMonitor.readDiscoveredEngineId(session)");
    expect(walk).toContain("SnmpEngineIdReader.readForCommunityPoll({");
    expect(walk).toContain("systemInfo.snmpEngineId = snmpEngineId;");
  });

  test("the engine ID reader is the poll's: it asks the agent at the address it is polled at, and reads no trap", () => {
    const imported: Array<string> = Array.from(
      fs
        .readFileSync(
          path.join(
            REPOSITORY,
            "packages/Probe/Utils/Snmp/SnmpEngineIdReader.ts",
          ),
          "utf8",
        )
        .matchAll(/from\s+"([^"]+)"/g),
    )
      .map((match: RegExpMatchArray): string => {
        return match[1] || "";
      })
      .sort();

    // The receiver's types only for normalizeEngineId: no trap, no receiver.
    expect(imported).toEqual(
      [
        "./SnmpEngineDiscovery",
        "Common/Server/Utils/Logger",
        "Common/Types/Probe/SnmpTrapReceiver",
        "Common/Utils/OldestKeyMap",
        "net-snmp",
      ].sort(),
    );
  });
});

describe("on the server", () => {
  const named: Map<string, string> = filesNaming([
    "packages/Common/Server",
    "packages/App/FeatureSet/Telemetry",
    "packages/App/FeatureSet/Workers",
    "packages/App/FeatureSet/BaseAPI",
  ]);

  test("the files that name it are the poll's inventory update, trap matching and the migration that made it", () => {
    expect(Array.from(named.keys()).sort()).toEqual([
      "packages/Common/Server/Infrastructure/Postgres/SchemaMigrations/1809187791201-AddGlobalProbeSnmpTrapReportsAndDeviceEngineIds.ts",
      "packages/Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil.ts",
      "packages/Common/Server/Utils/Monitor/NetworkInventoryUtil.ts",
      "packages/Common/Server/Utils/Monitor/SnmpTrapDeviceSelection.ts",
    ]);
  });

  test("only the inventory update writes it, and from the poll's system group", () => {
    // How a device's columns are put in a write here: update["column"] = value.
    const payloadWrite: RegExp = /\[\s*"snmpEngineId"\s*\]\s*=(?!=)/;

    expect(
      Array.from(named.entries())
        .filter(([, code]: [string, string]): boolean => {
          return payloadWrite.test(code);
        })
        .map(([file]: [string, string]): string => {
          return file;
        }),
    ).toEqual(["packages/Common/Server/Utils/Monitor/NetworkInventoryUtil.ts"]);

    const inventory: string =
      named.get(
        "packages/Common/Server/Utils/Monitor/NetworkInventoryUtil.ts",
      ) || "";

    expect(inventory).toContain(
      "SnmpTrapReceiverUtil.normalizeEngineId(systemInfo?.snmpEngineId)",
    );
    expect(inventory).toContain('deviceUpdate["snmpEngineId"] = snmpEngineId;');
  });

  test("trap matching reads it - selects it, compares it - and writes nothing of it", () => {
    const selection: string =
      named.get(
        "packages/Common/Server/Utils/Monitor/SnmpTrapDeviceSelection.ts",
      ) || "";

    expect(selection).toContain(
      "SnmpTrapReceiverUtil.normalizeEngineId(device.snmpEngineId)",
    );
    expect(selection).not.toMatch(/update|Service\./);
  });

  test("the trap ingest never names it at all", () => {
    for (const file of named.keys()) {
      expect(file).not.toMatch(
        /ProcessProbeIngest|SnmpTrapLogWriter|SnmpTrapUnmatchedHome|ProbeIngest\//,
      );
    }
  });
});
