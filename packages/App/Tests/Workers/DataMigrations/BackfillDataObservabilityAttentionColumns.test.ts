import DataObservabilityAttentionBackfill, {
  AttentionBackfillPage,
} from "Common/Server/Utils/DataObservability/DataObservabilityAttentionBackfill";
import logger from "Common/Server/Utils/Logger";
import BackfillDataObservabilityAttentionColumns, {
  PAGE_ATTEMPTS,
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillDataObservabilityAttentionColumns";
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
 * BackfillDataObservabilityAttentionColumns gives every table, pipeline and
 * check made before DataAsset.lateAt, DataPipeline.lateAt and DataCheck's
 * health its value (#6550, #6552, #6554): Tables' Late filter, Checks'
 * order and the menu's count read them on the server.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts once, before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it walks the tables, then the pipelines, then the checks, a page of
 *      PAGE_SIZE at a time, each page after the last id of the one before,
 *      until a page reads fewer than a page;
 *   3. a page that fails is tried again, and one that keeps failing fails
 *      the run - not recorded as done, so the next boot does it again;
 *   4. rollback changes nothing: the columns go with the schema migration.
 */

const MIGRATION_NAME: string = "BackfillDataObservabilityAttentionColumns";

const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

type PageArgs = { afterId?: string | undefined; limit: number };

function id(suffix: number): string {
  return `99999999-9999-4999-8999-${String(suffix).padStart(12, "0")}`;
}

// Pages of a table of `rows` rows, by id, as the backfill reads them.
function pagesOf(
  rows: number,
): (args: PageArgs) => Promise<AttentionBackfillPage> {
  return async (args: PageArgs): Promise<AttentionBackfillPage> => {
    const start: number = args.afterId
      ? Number(args.afterId.slice(-12)) + 1
      : 1;
    const end: number = Math.min(rows, start + args.limit - 1);
    const read: number = Math.max(0, end - start + 1);

    return {
      read,
      written: read,
      lastId: read > 0 ? id(end) : undefined,
    };
  };
}

describe("BackfillDataObservabilityAttentionColumns", () => {
  let calls: Array<{ what: string; args: PageArgs }>;
  let infoLogs: Array<string>;
  let warnLogs: Array<string>;

  function stubPages(data: {
    tables: (args: PageArgs) => Promise<AttentionBackfillPage>;
    pipelines: (args: PageArgs) => Promise<AttentionBackfillPage>;
    checks: (args: PageArgs) => Promise<AttentionBackfillPage>;
  }): void {
    jest
      .spyOn(DataObservabilityAttentionBackfill, "backfillAssetPage")
      .mockImplementation(async (args: PageArgs) => {
        calls.push({ what: "tables", args: { ...args } });
        return await data.tables(args);
      });
    jest
      .spyOn(DataObservabilityAttentionBackfill, "backfillPipelinePage")
      .mockImplementation(async (args: PageArgs) => {
        calls.push({ what: "pipelines", args: { ...args } });
        return await data.pipelines(args);
      });
    jest
      .spyOn(DataObservabilityAttentionBackfill, "backfillCheckPage")
      .mockImplementation(async (args: PageArgs) => {
        calls.push({ what: "checks", args: { ...args } });
        return await data.checks(args);
      });
  }

  beforeEach(() => {
    calls = [];
    infoLogs = [];
    warnLogs = [];

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((message: unknown): void => {
      warnLogs.push(String(message));
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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
    expect(new BackfillDataObservabilityAttentionColumns().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("walks the tables, then the pipelines, then the checks, a page at a time by id", async () => {
    stubPages({
      tables: pagesOf(PAGE_SIZE * 2 + 3),
      pipelines: pagesOf(PAGE_SIZE),
      checks: pagesOf(0),
    });

    await new BackfillDataObservabilityAttentionColumns().migrate();

    expect(
      calls.map((call: { what: string; args: PageArgs }): string => {
        return `${call.what} after ${call.args.afterId ?? "the start"}`;
      }),
    ).toEqual([
      "tables after the start",
      `tables after ${id(PAGE_SIZE)}`,
      `tables after ${id(PAGE_SIZE * 2)}`,
      "pipelines after the start",
      // A full page may not be the last: one more is read, and it is empty.
      `pipelines after ${id(PAGE_SIZE)}`,
      "checks after the start",
    ]);

    for (const call of calls) {
      expect(call.args.limit).toBe(PAGE_SIZE);
    }

    expect(infoLogs).toEqual([
      `BackfillDataObservabilityAttentionColumns: ${PAGE_SIZE * 2 + 3} tables read, ${PAGE_SIZE * 2 + 3} written, in 3 pages.`,
      `BackfillDataObservabilityAttentionColumns: ${PAGE_SIZE} pipelines read, ${PAGE_SIZE} written, in 2 pages.`,
      "BackfillDataObservabilityAttentionColumns: 0 checks read, 0 written, in 1 pages.",
    ]);
  });

  test("a page that fails is tried again, from the same place", async () => {
    let failures: number = 0;
    const tables: (args: PageArgs) => Promise<AttentionBackfillPage> =
      pagesOf(PAGE_SIZE + 1);

    stubPages({
      tables: async (args: PageArgs) => {
        if (args.afterId && failures < PAGE_ATTEMPTS - 1) {
          failures++;
          throw new Error("lock timeout");
        }

        return await tables(args);
      },
      pipelines: pagesOf(0),
      checks: pagesOf(0),
    });

    await new BackfillDataObservabilityAttentionColumns().migrate();

    const tablePages: Array<string | undefined> = calls
      .filter((call: { what: string }): boolean => {
        return call.what === "tables";
      })
      .map((call: { args: PageArgs }): string | undefined => {
        return call.args.afterId;
      });

    expect(tablePages).toEqual([
      undefined,
      ...Array.from({ length: PAGE_ATTEMPTS }, () => {
        return id(PAGE_SIZE);
      }),
    ]);
    expect(warnLogs.join("\n")).toContain(
      `a page of tables after ${id(PAGE_SIZE)} failed (attempt 1 of ${PAGE_ATTEMPTS})`,
    );
  });

  test("a page that keeps failing fails the run, and nothing after it is read", async () => {
    stubPages({
      tables: async () => {
        throw new Error("connection lost");
      },
      pipelines: pagesOf(0),
      checks: pagesOf(0),
    });

    await expect(
      new BackfillDataObservabilityAttentionColumns().migrate(),
    ).rejects.toThrow("connection lost");

    expect(
      calls.filter((call: { what: string }): boolean => {
        return call.what === "tables";
      }),
    ).toHaveLength(PAGE_ATTEMPTS);
    expect(
      calls.some((call: { what: string }): boolean => {
        return call.what !== "tables";
      }),
    ).toBe(false);
  });

  test("a page that names no last row ends the walk, whatever it read", async () => {
    stubPages({
      tables: async () => {
        return { read: PAGE_SIZE, written: 0, lastId: undefined };
      },
      pipelines: pagesOf(0),
      checks: pagesOf(0),
    });

    await new BackfillDataObservabilityAttentionColumns().migrate();

    expect(
      calls.filter((call: { what: string }): boolean => {
        return call.what === "tables";
      }),
    ).toHaveLength(1);
  });

  test("rollback changes nothing", async () => {
    stubPages({
      tables: pagesOf(0),
      pipelines: pagesOf(0),
      checks: pagesOf(0),
    });

    await new BackfillDataObservabilityAttentionColumns().rollback();

    expect(calls).toEqual([]);
  });
});
