import logger from "Common/Server/Utils/Logger";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import ClearMonitorGroupOnMonitorStatusPageResources from "../../../FeatureSet/Workers/DataMigrations/ClearMonitorGroupOnMonitorStatusPageResources";
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
 * ClearMonitorGroupOnMonitorStatusPageResources clears, once, the monitor
 * group of every status page resource that named both a monitor and a
 * monitor group - rows the dashboard's Edit resource form wrote before a
 * resource could only show one (issue #6540). Such a row is shown as its
 * monitor, so the monitor is what it keeps.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs one statement, which clears monitorGroupId and nothing else,
 *      only on rows that name both, and says how many it cleared;
 *   3. a failing statement is not swallowed: the runner stops the chain and
 *      the migration runs again;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "ClearMonitorGroupOnMonitorStatusPageResources";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// The migrations as Index.ts registers them, in order.
const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

// Runs of whitespace, so the statement reads as one line.
const WHITESPACE: RegExp = /\s+/g;

type QueryFunction = (sql: string) => Promise<unknown>;

describe("ClearMonitorGroupOnMonitorStatusPageResources", () => {
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

  test("is registered once, before the last slot", () => {
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
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });

  test("has the name it is recorded under", () => {
    expect(new ClearMonitorGroupOnMonitorStatusPageResources().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("clears the monitor group of the rows that name both, in one statement", async () => {
    query.mockResolvedValue([{ count: "3" }]);

    await new ClearMonitorGroupOnMonitorStatusPageResources().migrate();

    const sql: string = statement();

    expect(sql).toContain(`UPDATE "StatusPageResource"`);
    // The group is what goes; the monitor, what the row showed, stays.
    expect(sql).toContain(`SET "monitorGroupId" = NULL`);
    expect(sql).not.toContain(`"monitorId" = NULL`);
    // Only where both are set.
    expect(sql).toContain(
      `WHERE "monitorId" IS NOT NULL AND "monitorGroupId" IS NOT NULL`,
    );
    expect(sql).toContain(`COUNT(*)`);

    expect(infoLogs.join("\n")).toContain(
      `${MIGRATION_NAME}: 3 status page resource(s) that named both a monitor and a monitor group now name only the monitor they showed.`,
    );
  });

  test("reads the count however the driver types it", async () => {
    query.mockResolvedValue([{ count: 2 }]);

    await new ClearMonitorGroupOnMonitorStatusPageResources().migrate();

    expect(infoLogs.join("\n")).toContain(": 2 status page resource(s)");
  });

  test("nothing to clear: it says so", async () => {
    query.mockResolvedValue([{ count: "0" }]);

    await new ClearMonitorGroupOnMonitorStatusPageResources().migrate();

    expect(infoLogs.join("\n")).toContain(": 0 status page resource(s)");
  });

  test("an empty result reads as nothing cleared", async () => {
    query.mockResolvedValue([]);

    await new ClearMonitorGroupOnMonitorStatusPageResources().migrate();

    expect(infoLogs.join("\n")).toContain(": 0 status page resource(s)");
  });

  test("a failing statement stops the chain rather than being swallowed", async () => {
    query.mockRejectedValue(new Error("db down"));

    await expect(
      new ClearMonitorGroupOnMonitorStatusPageResources().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    await new ClearMonitorGroupOnMonitorStatusPageResources().rollback();

    expect(query).not.toHaveBeenCalled();
  });
});
