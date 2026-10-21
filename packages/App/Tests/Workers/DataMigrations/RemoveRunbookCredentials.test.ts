import { beforeEach, describe, expect, test } from "@jest/globals";
import RunbookCredentialsRemoval, {
  RunbookCredentialsRemovalSummary,
} from "Common/Server/Utils/Runbook/RunbookCredentialsRemoval";
import logger from "Common/Server/Utils/Logger";
import RemoveRunbookCredentials from "../../../FeatureSet/Workers/DataMigrations/RemoveRunbookCredentials";
import fs from "fs";
import path from "path";

/*
 * Runbooks > Runners > AI Access - the runbook credentials OneUptime AI's
 * own commands reached a host or a cluster with through a Runner - is
 * removed. What the removal does is in Common (RunbookCredentialsRemoval,
 * held by its own suites, one of them on a migrated Postgres). Pinned here:
 * the data migration that runs it once is registered after the move that
 * reads the credentials, and after the schema migration that drops the
 * cluster's credential column; it logs what it did, never fails the runner
 * (a step that fails is logged and named), and puts nothing back on a
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

const MIGRATION_NAME: string = "RemoveRunbookCredentials";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const SCHEMA_MIGRATIONS_INDEX: string = path.join(
  __dirname,
  "../../../../Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
);

function summary(
  overrides: Partial<RunbookCredentialsRemovalSummary> = {},
): RunbookCredentialsRemovalSummary {
  return {
    move: {
      secretsMoved: 0,
      secretsAlreadyMoved: 0,
      secretsSkipped: 0,
      credentialsMoved: 2,
      stepsMoved: 3,
      runbooksRewritten: 1,
      projectsFailed: 0,
    },
    clusterBindingsCleared: 4,
    credentialsDeleted: 6,
    failedSteps: [],
    ...overrides,
  };
}

describe("RemoveRunbookCredentials", () => {
  const migration: RemoveRunbookCredentials = new RemoveRunbookCredentials();

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

    test("runs right after the move that reads the credentials it deletes, and before the last slot", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(
        instantiations.indexOf("MoveRunbookSecretsAndCredentialsToVariables") +
          1,
      );
      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(
        instantiations.indexOf("AddAuditLogMcpClientColumns") - 1,
      );
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });

    test("the schema migration that drops the cluster's credential column is registered: data migrations run after it", () => {
      expect(fs.readFileSync(SCHEMA_MIGRATIONS_INDEX, "utf8")).toContain(
        "RemoveRunbookCredentials1805750000000,",
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
    test("removes every credential once, and says what it did", async () => {
      const removeAll: jest.SpyInstance = jest
        .spyOn(RunbookCredentialsRemoval, "removeAll")
        .mockResolvedValue(summary());

      await migration.migrate();

      expect(removeAll).toHaveBeenCalledTimes(1);
      // Every project: no query narrows it.
      expect(removeAll.mock.calls[0]).toEqual([]);

      const info: jest.Mock = logger.info as unknown as jest.Mock;

      expect(String(info.mock.calls[0]![0])).toBe(
        "RemoveRunbookCredentials: 2 credential(s) runbook steps still named moved to variables; 3 step(s) of 1 runbook(s) rewritten; 4 Kubernetes cluster(s) bound to a Runner outside them cleared; 6 runbook credential(s) deleted.",
      );
    });

    test("names the steps that failed, and still finishes", async () => {
      jest.spyOn(RunbookCredentialsRemoval, "removeAll").mockResolvedValue(
        summary({
          move: null,
          clusterBindingsCleared: 0,
          credentialsDeleted: 0,
          failedSteps: ["move", "delete"],
        }),
      );

      await expect(migration.migrate()).resolves.toBeUndefined();

      const info: jest.Mock = logger.info as unknown as jest.Mock;

      expect(String(info.mock.calls[0]![0])).toBe(
        "RemoveRunbookCredentials: 0 credential(s) runbook steps still named moved to variables; 0 step(s) of 0 runbook(s) rewritten; 0 Kubernetes cluster(s) bound to a Runner outside them cleared; 0 runbook credential(s) deleted; failed: move, delete (logged above).",
      );
    });

    test("a second run on an installation with nothing left removes nothing, and says so", async () => {
      jest.spyOn(RunbookCredentialsRemoval, "removeAll").mockResolvedValue(
        summary({
          move: {
            secretsMoved: 0,
            secretsAlreadyMoved: 0,
            secretsSkipped: 0,
            credentialsMoved: 0,
            stepsMoved: 0,
            runbooksRewritten: 0,
            projectsFailed: 0,
          },
          clusterBindingsCleared: 0,
          credentialsDeleted: 0,
        }),
      );

      await migration.migrate();

      expect(
        String((logger.info as unknown as jest.Mock).mock.calls[0]![0]),
      ).toContain("0 runbook credential(s) deleted.");
    });
  });

  describe("rollback", () => {
    test("puts nothing back: the credentials are gone", async () => {
      const removeAll: jest.SpyInstance = jest.spyOn(
        RunbookCredentialsRemoval,
        "removeAll",
      );

      await expect(migration.rollback()).resolves.toBeUndefined();

      expect(removeAll).not.toHaveBeenCalled();
    });
  });
});
