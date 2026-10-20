import { beforeEach, describe, expect, test } from "@jest/globals";
import RunbookVariablesMove from "Common/Server/Utils/Runbook/RunbookVariablesMove";
import logger from "Common/Server/Utils/Logger";
import MoveRunbookSecretsAndCredentialsToVariables from "../../../FeatureSet/Workers/DataMigrations/MoveRunbookSecretsAndCredentialsToVariables";
import fs from "fs";
import path from "path";

/*
 * Runbook variables took the place of runbook secrets and of the
 * credentials runbook steps used; the move is in Common
 * (RunbookVariablesMove, held by its own suites, one of them on a migrated
 * Postgres). Pinned here: the data migration that runs it once is
 * registered, after the schema migration that makes the variables' tables,
 * in its place and under its own name; it logs what it moved, lets nothing
 * per project fail the runner, and leaves the variables on a rollback.
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

const MIGRATION_NAME: string = "MoveRunbookSecretsAndCredentialsToVariables";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const SCHEMA_MIGRATIONS_INDEX: string = path.join(
  __dirname,
  "../../../../Common/Server/Infrastructure/Postgres/SchemaMigrations/Index.ts",
);

describe("MoveRunbookSecretsAndCredentialsToVariables", () => {
  const migration: MoveRunbookSecretsAndCredentialsToVariables =
    new MoveRunbookSecretsAndCredentialsToVariables();

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

    test("sits right before AddAuditLogMcpClientColumns, the last slot", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(
        instantiations.indexOf("AddAuditLogMcpClientColumns") - 1,
      );
      expect(instantiations[instantiations.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });

    test("the schema migration that makes the variables' tables is registered: data migrations run after it", () => {
      expect(fs.readFileSync(SCHEMA_MIGRATIONS_INDEX, "utf8")).toContain(
        "AddRunbookVariable1804265000000,",
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("migrate", () => {
    test("moves every project's secrets and credentials, and says how much", async () => {
      const moveAll: jest.SpyInstance = jest
        .spyOn(RunbookVariablesMove, "moveAll")
        .mockResolvedValue({
          secretsMoved: 4,
          secretsAlreadyMoved: 1,
          secretsSkipped: 2,
          credentialsMoved: 3,
          stepsMoved: 9,
          runbooksRewritten: 5,
          projectsFailed: 1,
        });

      await migration.migrate();

      expect(moveAll).toHaveBeenCalledTimes(1);

      const info: jest.Mock = logger.info as unknown as jest.Mock;

      expect(String(info.mock.calls[0]![0])).toBe(
        "MoveRunbookSecretsAndCredentialsToVariables: 4 runbook secret(s) moved to variables, 1 already moved, 2 with no value skipped; 3 credential(s) runbook steps named moved to variables; 9 step(s) of 5 runbook(s) rewritten; 1 project(s) could not be moved (logged above).",
      );
    });

    test("a failure to read what to move at all reaches the runner, to be tried again", async () => {
      jest
        .spyOn(RunbookVariablesMove, "moveAll")
        .mockRejectedValue(new Error("the database is down"));

      await expect(migration.migrate()).rejects.toThrow("the database is down");
    });
  });

  describe("rollback", () => {
    test("leaves the variables: they are what runbooks run with now", async () => {
      const moveAll: jest.SpyInstance = jest.spyOn(
        RunbookVariablesMove,
        "moveAll",
      );

      await migration.rollback();

      expect(moveAll).not.toHaveBeenCalled();
    });
  });
});
