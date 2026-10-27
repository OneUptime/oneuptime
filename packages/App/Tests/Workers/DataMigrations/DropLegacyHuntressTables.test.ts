import { beforeEach, describe, expect, test } from "@jest/globals";
import HuntressConnectionsToWorkflows from "Common/Server/Utils/Huntress/HuntressConnectionsToWorkflows";
import logger from "Common/Server/Utils/Logger";
import DropLegacyHuntressTables from "../../../FeatureSet/Workers/DataMigrations/DropLegacyHuntressTables";
import fs from "fs";
import path from "path";

/*
 * The legacy Huntress tables go once every Huntress connection has its
 * workflow: what decides it, and the SQL, are in Common
 * (HuntressConnectionsToWorkflows.dropLegacyTables, held by its own suites,
 * one of them on a migrated Postgres). Pinned here: the data migration
 * that runs it is registered right after the move that reads those tables,
 * under its own name, says in the log what it did - and, when it keeps
 * them, how many connections have no workflow - lets a failure reach the
 * runner to be tried again, and puts nothing back on a rollback.
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

const MIGRATION_NAME: string = "DropLegacyHuntressTables";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("DropLegacyHuntressTables", () => {
  const migration: DropLegacyHuntressTables = new DropLegacyHuntressTables();

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

    test("is imported and instantiated once in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    test("runs right after the move that reads the tables it drops, and before the last slot", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(
        instantiations.indexOf("MoveHuntressConnectionsToWorkflows") + 1,
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.indexOf("AddAuditLogMcpClientColumns"),
      );
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on a clustered ClickHouse too: it touches Postgres only", () => {
      expect(migration.runsInClusterMode()).toBe(true);
    });
  });

  describe("migrate", () => {
    test("every connection has its workflow: the tables were dropped, and the log says so", async () => {
      const dropLegacyTables: jest.SpyInstance = jest
        .spyOn(HuntressConnectionsToWorkflows, "dropLegacyTables")
        .mockResolvedValue({ outcome: "dropped", unmoved: 0 });

      await migration.migrate();

      expect(dropLegacyTables).toHaveBeenCalledTimes(1);
      expect(
        String((logger.info as unknown as jest.Mock).mock.calls[0]![0]),
      ).toBe(
        "DropLegacyHuntressTables: every Huntress connection has its workflow, so the legacy Huntress tables were dropped.",
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    test("connections without a workflow keep them: a warning says how many, and nothing fails", async () => {
      jest
        .spyOn(HuntressConnectionsToWorkflows, "dropLegacyTables")
        .mockResolvedValue({ outcome: "kept", unmoved: 3 });

      await expect(migration.migrate()).resolves.toBeUndefined();

      expect(
        String((logger.warn as unknown as jest.Mock).mock.calls[0]![0]),
      ).toBe(
        "DropLegacyHuntressTables: 3 Huntress connection(s) have no workflow - their move failed, or the workflow was deleted since - so the legacy Huntress tables are kept, and nothing of theirs is lost.",
      );
    });

    test("an install without the tables says there was nothing to drop", async () => {
      jest
        .spyOn(HuntressConnectionsToWorkflows, "dropLegacyTables")
        .mockResolvedValue({ outcome: "no-tables", unmoved: 0 });

      await migration.migrate();

      expect(
        String((logger.info as unknown as jest.Mock).mock.calls[0]![0]),
      ).toBe("DropLegacyHuntressTables: no legacy Huntress tables to drop.");
    });

    test("never moves a connection again: it would make again a workflow someone deleted", async () => {
      jest
        .spyOn(HuntressConnectionsToWorkflows, "dropLegacyTables")
        .mockResolvedValue({ outcome: "dropped", unmoved: 0 });
      const moveAll: jest.SpyInstance = jest.spyOn(
        HuntressConnectionsToWorkflows,
        "moveAll",
      );

      await migration.migrate();

      expect(moveAll).not.toHaveBeenCalled();
    });

    test("a failure to read or drop reaches the runner, to be tried again", async () => {
      jest
        .spyOn(HuntressConnectionsToWorkflows, "dropLegacyTables")
        .mockRejectedValue(new Error("the database is down"));

      await expect(migration.migrate()).rejects.toThrow("the database is down");
    });
  });

  describe("rollback", () => {
    test("puts nothing back: the workflows hold what the tables held", async () => {
      const dropLegacyTables: jest.SpyInstance = jest.spyOn(
        HuntressConnectionsToWorkflows,
        "dropLegacyTables",
      );

      await migration.rollback();

      expect(dropLegacyTables).not.toHaveBeenCalled();
    });
  });
});
