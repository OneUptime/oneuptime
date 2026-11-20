import {
  AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
  LLM_LOG_PREVIEW_NOT_KEPT,
  LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS,
} from "Common/Server/Services/AIService";
import LlmLogService from "Common/Server/Services/LlmLogService";
import logger from "Common/Server/Utils/Logger";
import LlmLogStatus from "Common/Types/LlmLogStatus";
import RedactDataSecurityIssueExplanationLogs from "../../../FeatureSet/Workers/DataMigrations/RedactDataSecurityIssueExplanationLogs";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * RedactDataSecurityIssueExplanationLogs (#10361): Explain with AI kept its
 * prompt - a Data Security issue's store, cloud id, data types and evidence
 * - and its answer as previews in the AI Logs, which every Project Member
 * and Viewer reads. The migration writes every row of that feature as a
 * call writes one now. Its statements run against a real Postgres in
 * RedactDataSecurityIssueExplanationLogsPostgres; here:
 *
 *   1. it is registered once, before the two slots kept last;
 *   2. the words it writes are the very words executeWithLogging writes,
 *      and the label it reads is Explain with AI's;
 *   3. it walks the rows that still hold something a page at a time, after
 *      the last id read, and writes each page in one statement, by id;
 *   4. a page that does not move on ends the walk; rollback changes nothing.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const MIGRATION_NAME: string = "RedactDataSecurityIssueExplanationLogs";

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

let statements: Array<Statement>;
// The pages the reads answer, in order: each a list of ids.
let pages: Array<Array<string>>;

function idOf(index: number): string {
  return `10361000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function pageOf(from: number, count: number): Array<string> {
  const ids: Array<string> = [];

  for (let index: number = from; index < from + count; index++) {
    ids.push(idOf(index));
  }

  return ids;
}

beforeEach(() => {
  statements = [];
  pages = [];

  jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<Array<{ _id: string }>> => {
        statements.push({ sql, parameters });

        if (sql.startsWith("SELECT")) {
          return (pages.shift() || []).map((id: string) => {
            return { _id: id };
          });
        }

        return [];
      },
    },
  } as never);
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function registeredMigrations(): Array<string> {
  const index: string = fs
    .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("RedactDataSecurityIssueExplanationLogs", () => {
  test("is registered once, before the two slots kept last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(new RedactDataSecurityIssueExplanationLogs().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("writes the very words a call writes now, over the rows of Explain with AI", () => {
    expect(RedactDataSecurityIssueExplanationLogs.FEATURE).toBe(
      AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
    );
    expect(RedactDataSecurityIssueExplanationLogs.PREVIEW_NOT_KEPT).toBe(
      LLM_LOG_PREVIEW_NOT_KEPT,
    );
    expect(RedactDataSecurityIssueExplanationLogs.ERROR_WITHOUT_DETAILS).toBe(
      LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS,
    );
    expect(RedactDataSecurityIssueExplanationLogs.ERROR_STATUS).toBe(
      LlmLogStatus.Error,
    );
  });

  test("reads only the rows of that feature that still hold a preview or an error, and writes them by id", async () => {
    pages = [[idOf(1), idOf(2)]];

    await new RedactDataSecurityIssueExplanationLogs().migrate();

    const words: Array<unknown> = [
      AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
      LLM_LOG_PREVIEW_NOT_KEPT,
      LlmLogStatus.Error,
      LLM_LOG_PROVIDER_ERROR_WITHOUT_DETAILS,
    ];

    expect(statements).toEqual([
      {
        sql: RedactDataSecurityIssueExplanationLogs.SELECT_FIRST_PAGE,
        parameters: words,
      },
      {
        sql: RedactDataSecurityIssueExplanationLogs.REDACT_PAGE,
        parameters: [...words, [idOf(1), idOf(2)]],
      },
    ]);
    expect(RedactDataSecurityIssueExplanationLogs.SELECT_FIRST_PAGE).toContain(
      `"feature" = $1`,
    );
    expect(RedactDataSecurityIssueExplanationLogs.REDACT_PAGE).toContain(
      `WHERE "_id" = ANY($5::uuid[]) AND "feature" = $1`,
    );
  });

  test("walks the rows a page at a time, each after the last id read", async () => {
    const size: number = RedactDataSecurityIssueExplanationLogs.PAGE_SIZE;
    pages = [pageOf(0, size), pageOf(size, size), pageOf(2 * size, 3)];

    await new RedactDataSecurityIssueExplanationLogs().migrate();

    const reads: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.sql.startsWith("SELECT");
      },
    );
    const writes: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return statement.sql.startsWith("UPDATE");
      },
    );

    expect(reads).toHaveLength(3);
    expect(reads[0]!.sql).toBe(
      RedactDataSecurityIssueExplanationLogs.SELECT_FIRST_PAGE,
    );
    expect(reads[1]!.sql).toBe(
      RedactDataSecurityIssueExplanationLogs.SELECT_PAGE,
    );
    expect(reads[1]!.parameters[4]).toBe(idOf(size - 1));
    expect(reads[2]!.parameters[4]).toBe(idOf(2 * size - 1));
    expect(
      writes.map((write: Statement): number => {
        return (write.parameters[4] as Array<string>).length;
      }),
    ).toEqual([size, size, 3]);
    expect(logger.info).toHaveBeenCalledWith(
      `${MIGRATION_NAME}: took the previews out of ${2 * size + 3} AI Logs row(s) of Explain with AI.`,
    );
  });

  test("with nothing left to take out, it reads once and writes nothing", async () => {
    await new RedactDataSecurityIssueExplanationLogs().migrate();

    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql.startsWith("SELECT")).toBe(true);
  });

  test("a full page that does not move on ends the walk, rather than reading it for ever", async () => {
    const size: number = RedactDataSecurityIssueExplanationLogs.PAGE_SIZE;
    const same: Array<string> = pageOf(0, size);
    pages = [same, [...same], [...same]];

    await new RedactDataSecurityIssueExplanationLogs().migrate();

    expect(
      statements.filter((statement: Statement): boolean => {
        return statement.sql.startsWith("SELECT");
      }),
    ).toHaveLength(2);
  });

  test("a read that fails fails the run, so it runs again on the next boot", async () => {
    jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<never> => {
          throw new Error("connection reset");
        },
      },
    } as never);

    await expect(
      new RedactDataSecurityIssueExplanationLogs().migrate(),
    ).rejects.toThrow("connection reset");
  });

  test("rollback changes nothing: the previews it took out are gone", async () => {
    await new RedactDataSecurityIssueExplanationLogs().rollback();

    expect(statements).toEqual([]);
  });
});
