import { beforeEach, describe, expect, test } from "@jest/globals";
import HuntressConnectionsToWorkflows from "Common/Server/Utils/Huntress/HuntressConnectionsToWorkflows";
import logger from "Common/Server/Utils/Logger";
import MoveHuntressConnectionsToWorkflows from "../../../FeatureSet/Workers/DataMigrations/MoveHuntressConnectionsToWorkflows";
import fs from "fs";
import path from "path";

/*
 * Huntress became a workflow trigger, and each Huntress connection becomes
 * the workflow that does what it did: the move is in Common
 * (HuntressConnectionsToWorkflows, held by its own suites, one of them on a
 * migrated Postgres). Pinned here: the data migration that runs it once is
 * registered, in its place, under its own name, logs what it moved, lets
 * nothing per connection fail the runner, and leaves the workflows on a
 * rollback.
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

const MIGRATION_NAME: string = "MoveHuntressConnectionsToWorkflows";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const SCHEMA_MIGRATIONS_INDEX: string = path.join(
  __dirname,
  "../../../../Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
);

describe("MoveHuntressConnectionsToWorkflows", () => {
  const migration: MoveHuntressConnectionsToWorkflows =
    new MoveHuntressConnectionsToWorkflows();

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

    // The runner decides what to run by position: before the last slot, which asserts itself.
    test("sits before AddAuditLogMcpClientColumns, the last slot", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBeGreaterThan(-1);
      expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
        instantiations.indexOf("AddAuditLogMcpClientColumns"),
      );
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });

    test("the schema migration that gives workflows their signing secret is registered: data migrations run after it", () => {
      expect(fs.readFileSync(SCHEMA_MIGRATIONS_INDEX, "utf8")).toContain(
        "AddWorkflowWebhookSigningSecret1803400000000",
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("migrate", () => {
    test("moves every connection, and says how many", async () => {
      const moveAll: jest.SpyInstance = jest
        .spyOn(HuntressConnectionsToWorkflows, "moveAll")
        .mockResolvedValue({
          moved: 3,
          alreadyMoved: 1,
          failed: 1,
          incidentsLinked: 12,
          ownersTold: 2,
        });

      await migration.migrate();

      expect(moveAll).toHaveBeenCalledTimes(1);

      const info: jest.Mock = logger.info as unknown as jest.Mock;

      expect(String(info.mock.calls[0]![0])).toBe(
        "MoveHuntressConnectionsToWorkflows: 3 Huntress connection(s) moved to workflows, 1 already moved, 1 could not be moved (logged above); 12 incident(s) given their Huntress report's number; owners of 2 project(s) told their plan runs no workflows.",
      );
    });

    test("a failure to read the connections at all reaches the runner, to be tried again", async () => {
      jest
        .spyOn(HuntressConnectionsToWorkflows, "moveAll")
        .mockRejectedValue(new Error("the database is down"));

      await expect(migration.migrate()).rejects.toThrow("the database is down");
    });
  });

  describe("rollback", () => {
    test("leaves the workflows: they are what Huntress is set up with now", async () => {
      const moveAll: jest.SpyInstance = jest.spyOn(
        HuntressConnectionsToWorkflows,
        "moveAll",
      );

      await migration.rollback();

      expect(moveAll).not.toHaveBeenCalled();
    });
  });
});
