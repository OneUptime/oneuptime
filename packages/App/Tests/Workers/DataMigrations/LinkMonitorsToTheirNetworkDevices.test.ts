import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import MonitorDeviceLinkBackfill from "Common/Server/Utils/NetworkDevice/MonitorDeviceLinkBackfill";
import logger from "Common/Server/Utils/Logger";
import LinkMonitorsToTheirNetworkDevices from "../../../FeatureSet/Workers/DataMigrations/LinkMonitorsToTheirNetworkDevices";
import fs from "fs";
import path from "path";

/*
 * The one-time pass that ties the monitors people made before OneUptime
 * issue #9545 to the network device each checks. The rule it ties by -
 * every step checks one host, and exactly one device in the project is at
 * that host - and what it reads and writes are MonitorDeviceLinkBackfill's,
 * pinned in Common's MonitorDeviceLinkBackfill tests. What is pinned here
 * is that the migration runs that pass once, is registered where the
 * runner finds it, and says what it did.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "LinkMonitorsToTheirNetworkDevices";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const mockedLogger: { info: jest.Mock } = logger as unknown as {
  info: jest.Mock;
};

describe("LinkMonitorsToTheirNetworkDevices", () => {
  const migration: LinkMonitorsToTheirNetworkDevices =
    new LinkMonitorsToTheirNetworkDevices();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    test("sits before the last slot, which AddAuditLogMcpClientColumns keeps", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.length - 1,
      );
    });

    test("is registered exactly once", () => {
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }).length,
      ).toBe(1);
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("what it does", () => {
    test("runs the backfill once and says how many monitors it read and tied", async () => {
      const run: ReturnType<typeof jest.spyOn> = jest
        .spyOn(MonitorDeviceLinkBackfill, "run")
        .mockResolvedValue({
          projects: 3,
          monitorsRead: 41,
          monitorsTied: 17,
        } as never);

      await migration.migrate();

      expect(run).toHaveBeenCalledTimes(1);
      expect(mockedLogger.info).toHaveBeenCalledWith(
        "LinkMonitorsToTheirNetworkDevices: read 41 monitor(s) in 3 project(s) with network devices, and tied 17 to the device its probes see at the address each checks.",
      );
    });

    test("a backfill that fails fails the migration, so the runner tries it again", async () => {
      jest
        .spyOn(MonitorDeviceLinkBackfill, "run")
        .mockRejectedValue(new Error("The database could not be reached."));

      await expect(migration.migrate()).rejects.toThrow(
        "The database could not be reached.",
      );
    });

    test("rolling back leaves the ties: the column goes with its schema migration", async () => {
      const run: ReturnType<typeof jest.spyOn> = jest.spyOn(
        MonitorDeviceLinkBackfill,
        "run",
      );

      await expect(migration.rollback()).resolves.toBeUndefined();
      expect(run).not.toHaveBeenCalled();
    });
  });
});
