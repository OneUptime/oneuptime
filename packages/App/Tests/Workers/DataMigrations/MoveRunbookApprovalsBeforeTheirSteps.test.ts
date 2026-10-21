import { beforeEach, describe, expect, test } from "@jest/globals";
import RunbookApprovalsMove from "Common/Server/Utils/Runbook/RunbookApprovalsMove";
import logger from "Common/Server/Utils/Logger";
import MoveRunbookApprovalsBeforeTheirSteps from "../../../FeatureSet/Workers/DataMigrations/MoveRunbookApprovalsBeforeTheirSteps";
import fs from "fs";
import path from "path";

/*
 * A runbook step's approval moved to the step it guards; the move of every
 * stored runbook is in Common (RunbookApprovalsMove, held by its own
 * suites, one of them on a migrated Postgres). Pinned here: the data
 * migration that runs it once is registered once, in its place above the
 * two slots that keep the end of the list, under its own name; it logs what
 * it moved, lets a failed read reach the runner (so the move is tried again
 * on the next start), and leaves runbooks as they are on a rollback.
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

const MIGRATION_NAME: string = "MoveRunbookApprovalsBeforeTheirSteps";

const REGISTERED_MIGRATION: RegExp = /new\s+(\w+)\(\)/g;

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("MoveRunbookApprovalsBeforeTheirSteps", () => {
  const migration: MoveRunbookApprovalsBeforeTheirSteps =
    new MoveRunbookApprovalsBeforeTheirSteps();

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
      return Array.from(indexSource.matchAll(REGISTERED_MIGRATION)).map(
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

    test("sits right above the runbook variables move, which keeps its place before the last slot", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(
        instantiations.indexOf("MoveRunbookSecretsAndCredentialsToVariables") -
          1,
      );
      expect(
        instantiations.indexOf("MoveRunbookSecretsAndCredentialsToVariables"),
      ).toBe(instantiations.indexOf("AddAuditLogMcpClientColumns") - 1);
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
    test("moves every stored runbook's approvals, and says how much", async () => {
      const moveAll: jest.SpyInstance = jest
        .spyOn(RunbookApprovalsMove, "moveAll")
        .mockResolvedValue({
          runbooksMoved: 7,
          approvalsMoved: 9,
          approvalStepsAdded: 2,
          runbooksChangedMeanwhile: 1,
          runbooksFailed: 1,
        });

      await migration.migrate();

      expect(moveAll).toHaveBeenCalledTimes(1);

      const info: jest.Mock = logger.info as unknown as jest.Mock;

      expect(String(info.mock.calls[0]![0])).toBe(
        "MoveRunbookApprovalsBeforeTheirSteps: 9 approval(s) of 7 runbook(s) moved before the step they guard, 2 of them after a last step became a Manual step at the end; 1 runbook(s) saved meanwhile were left as saved; 1 runbook(s) could not be moved (logged above).",
      );
    });

    test("a failure to read the runbooks at all reaches the runner, to be tried again", async () => {
      jest
        .spyOn(RunbookApprovalsMove, "moveAll")
        .mockRejectedValue(new Error("the database is down"));

      await expect(migration.migrate()).rejects.toThrow("the database is down");
    });
  });

  describe("rollback", () => {
    test("leaves the approvals before their steps: that is what runbooks run with now", async () => {
      const moveAll: jest.SpyInstance = jest.spyOn(
        RunbookApprovalsMove,
        "moveAll",
      );

      await migration.rollback();

      expect(moveAll).not.toHaveBeenCalled();
    });
  });
});
