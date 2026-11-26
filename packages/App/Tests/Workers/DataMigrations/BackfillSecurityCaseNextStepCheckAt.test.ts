import { afterEach, describe, expect, jest, test } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import SecurityCaseService from "Common/Server/Services/SecurityCaseService";
import logger from "Common/Server/Utils/Logger";
import BackfillSecurityCaseNextStepCheckAt, {
  PAGE_SIZE,
  SCHEDULE_OPEN_CASES_SQL,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillSecurityCaseNextStepCheckAt";
import fs from "fs";
import path from "path";

/*
 * BackfillSecurityCaseNextStepCheckAt schedules the first check of the
 * Response Plan's steps (#10340) of every security case that was open
 * before OneUptime checked them, each within the next half hour - a case
 * opened from now on is scheduled as it opens. Pinned here:
 *
 *   1. it is named after itself and registered once, before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it pages the open cases by id, and writes only a case still open,
 *      not deleted and not scheduled yet - one the step checks scheduled
 *      meanwhile keeps its time;
 *   3. a page that fails is logged and the next one is still scheduled.
 */

const MIGRATION_NAME: string = "BackfillSecurityCaseNextStepCheckAt";

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

function caseIds(from: number, count: number): Array<string> {
  return Array.from({ length: count }, (_: unknown, index: number): string => {
    return `cccccccc-cccc-4ccc-8ccc-${String(from + index).padStart(12, "0")}`;
  });
}

function stubRepository(data: {
  openCaseIds: Array<string>;
  failingPage?: number;
}): Array<Statement> {
  const statements: Array<Statement> = [];
  let page: number = 0;

  const query: jest.Mock = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      statements.push({
        sql: String(sql),
        parameters: parameters as Array<unknown>,
      });

      if (String(sql) === SCHEDULE_OPEN_CASES_SQL) {
        page++;

        if (page === data.failingPage) {
          throw new Error("lock timeout");
        }

        const ids: Array<string> = (parameters as Array<Array<string>>)[0]!;
        return [
          ids.map((id: string): { _id: string } => {
            return { _id: id };
          }),
          ids.length,
        ];
      }

      const [limit, after] = parameters as [number, string | undefined];

      return data.openCaseIds
        .filter((id: string): boolean => {
          return !after || id > after;
        })
        .slice(0, limit)
        .map((id: string): { _id: string } => {
          return { _id: id };
        });
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(
      SecurityCaseService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "SecurityCase" },
      manager: { query },
    } as never);

  return statements;
}

function schedules(statements: Array<Statement>): Array<Array<string>> {
  return statements
    .filter((statement: Statement): boolean => {
      return statement.sql === SCHEDULE_OPEN_CASES_SQL;
    })
    .map((statement: Statement): Array<string> => {
      return statement.parameters[0] as Array<string>;
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("BackfillSecurityCaseNextStepCheckAt", () => {
  test("is named after itself, and registered once before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(
        path.resolve(
          __dirname,
          "../../../FeatureSet/Workers/DataMigrations/Index.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(new BackfillSecurityCaseNextStepCheckAt().name).toBe(MIGRATION_NAME);
    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("writes only a case still open, not deleted and not scheduled, each within the next half hour", () => {
    expect(SCHEDULE_OPEN_CASES_SQL).toContain(`"nextStepCheckAt" IS NULL`);
    expect(SCHEDULE_OPEN_CASES_SQL).toContain(`"closedAt" IS NULL`);
    expect(SCHEDULE_OPEN_CASES_SQL).toContain(`"deletedAt" IS NULL`);
    expect(SCHEDULE_OPEN_CASES_SQL).toContain(
      "now() + random() * interval '30 minutes'",
    );
  });

  test("pages the open cases by id, a page at a time", async () => {
    const openCaseIds: Array<string> = caseIds(1, PAGE_SIZE + 3);
    const statements: Array<Statement> = stubRepository({ openCaseIds });

    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    await new BackfillSecurityCaseNextStepCheckAt().migrate();

    expect(schedules(statements)).toEqual([
      openCaseIds.slice(0, PAGE_SIZE),
      openCaseIds.slice(PAGE_SIZE),
    ]);
    // The second page reads after the first one's last id.
    expect(statements[2]!.parameters).toEqual([
      PAGE_SIZE,
      openCaseIds[PAGE_SIZE - 1],
    ]);
  });

  test("a page that fails is logged, and the next is still scheduled", async () => {
    const openCaseIds: Array<string> = caseIds(1, PAGE_SIZE + 3);
    const statements: Array<Statement> = stubRepository({
      openCaseIds,
      failingPage: 1,
    });
    const errors: Array<string> = [];

    jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
      errors.push(String(message));
    });
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return undefined;
    });

    await new BackfillSecurityCaseNextStepCheckAt().migrate();

    expect(schedules(statements)).toHaveLength(2);
    expect(errors[0]).toContain(MIGRATION_NAME);
  });

  test("counts the rows an UPDATE ... RETURNING answers, as TypeORM hands them back", () => {
    expect(BackfillSecurityCaseNextStepCheckAt.countRows([[{}, {}], 2])).toBe(
      2,
    );
    expect(BackfillSecurityCaseNextStepCheckAt.countRows([{}, {}, {}])).toBe(3);
    expect(BackfillSecurityCaseNextStepCheckAt.countRows(undefined)).toBe(0);
  });

  test("rolling back changes nothing", async () => {
    await expect(
      new BackfillSecurityCaseNextStepCheckAt().rollback(),
    ).resolves.toBeUndefined();
  });
});
