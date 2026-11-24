import logger from "Common/Server/Utils/Logger";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import DeleteStatusPageResourcesThatShowNothing from "../../../FeatureSet/Workers/DataMigrations/DeleteStatusPageResourcesThatShowNothing";
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
import type { Mock } from "jest-mock";

/*
 * DeleteStatusPageResourcesThatShowNothing deletes, once, every status page
 * resource that names neither a monitor nor a monitor group - rows the API
 * took before a resource had to show one (issue #6558). Such a row showed
 * nothing to anyone: the public page left it out, and no incident or
 * subscriber reached it.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, after the migration that cleared the
 *      monitor group of rows naming both (#6540) and before the two slots
 *      kept last;
 *   2. it runs one statement, which deletes only the rows that name neither,
 *      and says how many it deleted and on which status pages;
 *   3. a failing statement is not swallowed: the runner stops the chain and
 *      the migration runs again;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "DeleteStatusPageResourcesThatShowNothing";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// The migrations as Index.ts registers them, in order.
const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

// Runs of whitespace, so the statement reads as one line.
const WHITESPACE: RegExp = /\s+/g;

type QueryFunction = (sql: string) => Promise<unknown>;

describe("DeleteStatusPageResourcesThatShowNothing", () => {
  let infoLogs: Array<string>;
  let query: Mock<QueryFunction>;

  beforeEach(() => {
    infoLogs = [];

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });

    query = jest.fn<QueryFunction>();

    jest
      .spyOn(StatusPageResourceService as any, "getRepository")
      .mockReturnValue({
        metadata: { tableName: "StatusPageResource" },
        manager: { query: query },
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type StatementFunction = () => string;

  const statement: StatementFunction = (): string => {
    expect(query).toHaveBeenCalledTimes(1);
    return String(query.mock.calls[0]![0]).replace(WHITESPACE, " ").trim();
  };

  test("is registered once, after the both-targets clean-up and before the two slots kept last", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("ClearMonitorGroupOnMonitorStatusPageResources"),
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 2,
    );
  });

  test("has the name it is recorded under", () => {
    expect(new DeleteStatusPageResourcesThatShowNothing().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("deletes the rows that name neither, in one statement, and says how many and where", async () => {
    query.mockResolvedValue([
      {
        count: "3",
        statusPageIds:
          "65580000-0000-4000-8000-0000000000a1, 65580000-0000-4000-8000-0000000000a2",
      },
    ]);

    await new DeleteStatusPageResourcesThatShowNothing().migrate();

    const sql: string = statement();

    expect(sql).toContain(`DELETE FROM "StatusPageResource"`);
    // Only where both are empty: a monitor's row or a group's is never touched.
    expect(sql).toContain(
      `WHERE "monitorId" IS NULL AND "monitorGroupId" IS NULL`,
    );
    expect(sql).not.toContain("IS NOT NULL");
    expect(sql).not.toContain("UPDATE");
    expect(sql).toContain(`COUNT(*)`);
    expect(sql).toContain(`STRING_AGG(DISTINCT "statusPageId"::text, ', ')`);

    expect(infoLogs.join("\n")).toContain(
      `${MIGRATION_NAME}: deleted 3 status page resource(s) that showed neither a monitor nor a monitor group, on these status pages: 65580000-0000-4000-8000-0000000000a1, 65580000-0000-4000-8000-0000000000a2.`,
    );
  });

  test("reads the count however the driver types it", async () => {
    query.mockResolvedValue([
      { count: 2, statusPageIds: "65580000-0000-4000-8000-0000000000a1" },
    ]);

    await new DeleteStatusPageResourcesThatShowNothing().migrate();

    expect(infoLogs.join("\n")).toContain(": deleted 2 status page resource(s)");
  });

  test.each([
    ["nothing to delete", [{ count: "0", statusPageIds: null }]],
    ["an empty result", []],
  ] as Array<[string, Array<unknown>]>)(
    "%s: it says every resource shows something",
    async (_case: string, result: Array<unknown>) => {
      query.mockResolvedValue(result);

      await new DeleteStatusPageResourcesThatShowNothing().migrate();

      expect(infoLogs.join("\n")).toContain(
        `${MIGRATION_NAME}: deleted 0 status page resource(s): every resource shows a monitor or a monitor group.`,
      );
    },
  );

  test("a second run, finding nothing left, deletes nothing more and says so", async () => {
    query
      .mockResolvedValueOnce([
        { count: "1", statusPageIds: "65580000-0000-4000-8000-0000000000a1" },
      ])
      .mockResolvedValueOnce([{ count: "0", statusPageIds: null }]);

    await new DeleteStatusPageResourcesThatShowNothing().migrate();
    await new DeleteStatusPageResourcesThatShowNothing().migrate();

    expect(query).toHaveBeenCalledTimes(2);
    expect(String(query.mock.calls[0]![0])).toBe(
      String(query.mock.calls[1]![0]),
    );
    expect(infoLogs[1]).toContain(": deleted 0 status page resource(s)");
  });

  test("a failing statement stops the chain rather than being swallowed", async () => {
    query.mockRejectedValue(new Error("db down"));

    await expect(
      new DeleteStatusPageResourcesThatShowNothing().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    await new DeleteStatusPageResourcesThatShowNothing().rollback();

    expect(query).not.toHaveBeenCalled();
  });
});
