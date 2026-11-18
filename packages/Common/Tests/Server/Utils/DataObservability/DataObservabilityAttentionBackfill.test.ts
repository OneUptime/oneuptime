import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../../Models/DatabaseModels/DataPipeline";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataCheckService from "../../../../Server/Services/DataCheckService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataCheckHealthSync from "../../../../Server/Utils/DataObservability/DataCheckHealthSync";
import DataObservabilityAttentionBackfill, {
  AttentionBackfillPage,
  buildLateAtUpdate,
} from "../../../../Server/Utils/DataObservability/DataObservabilityAttentionBackfill";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { getDataAssetLateAt } from "../../../../Types/DataObservability/DataAssetFreshness";
import { getDataPipelineLateAt } from "../../../../Types/DataObservability/DataPipelineSchedule";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE ROWS THAT WERE THERE BEFORE THE COLUMNS (#6550, #6552, #6554).
 *
 * The data migration BackfillDataObservabilityAttentionColumns gives every
 * table, pipeline and check that existed before lateAt and health their
 * values, a page at a time: each page read by id after the last one, as
 * OneUptime, and written in one statement - by the same rules the writes
 * as data arrives use, so a row backfilled and a row collected agree.
 */

function id(suffix: number): string {
  return `99999999-9999-4999-8999-${String(suffix).padStart(12, "0")}`;
}

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  skip: number;
  limit: number;
  props: Record<string, unknown>;
}

// The id a page asks for rows after (QueryHelper.greaterThan), or none.
function cursorOf(query: Record<string, unknown>): string | null {
  const operator: { objectLiteralParameters?: Record<string, unknown> } = query[
    "_id"
  ] as { objectLiteralParameters?: Record<string, unknown> };

  if (!operator) {
    return null;
  }

  return String(Object.values(operator.objectLiteralParameters || {})[0]);
}

let statements: Array<{ sql: string; params: Array<string | null> }>;

function stubQueries(service: {
  getRepository: () => unknown;
}): Mock<(sql: string, params: Array<string | null>) => Promise<unknown>> {
  const query: Mock<
    (sql: string, params: Array<string | null>) => Promise<unknown>
  > = jest.fn(async (sql: string, params: Array<string | null>) => {
    statements.push({ sql, params });
    return [];
  });

  jest
    .spyOn(service as never, "getRepository" as never)
    .mockReturnValue({ manager: { query } } as never);

  return query;
}

beforeEach(() => {
  statements = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("one statement for a page (buildLateAtUpdate)", () => {
  test("each row's id and time, as parameters - never written into the SQL", () => {
    const update: { sql: string; params: Array<string | null> } =
      buildLateAtUpdate("DataAsset", [
        { id: id(1), lateAt: new Date("2026-11-03T14:00:00.000Z") },
        { id: id(2), lateAt: new Date("2026-11-03T15:30:00.000Z") },
      ]);

    expect(update.params).toEqual([
      id(1),
      "2026-11-03T14:00:00.000Z",
      id(2),
      "2026-11-03T15:30:00.000Z",
    ]);
    expect(update.sql).toContain('UPDATE "DataAsset" AS target_row');
    expect(update.sql).toContain('SET "lateAt" = page_row."lateAt"');
    expect(update.sql).toContain(
      "VALUES ($1::uuid, $2::timestamptz), ($3::uuid, $4::timestamptz)",
    );
    expect(update.sql).toContain('WHERE target_row."_id" = page_row."id"');
    expect(update.sql).not.toContain(id(1));
  });

  test("the pipelines' table, the same way", () => {
    expect(
      buildLateAtUpdate("DataPipeline", [
        { id: id(1), lateAt: new Date("2026-11-03T14:00:00.000Z") },
      ]).sql,
    ).toContain('UPDATE "DataPipeline" AS target_row');
  });
});

describe("a page of tables", () => {
  let reads: Array<FindByArgs>;

  function asset(suffix: number, fields: Partial<DataAsset> = {}): DataAsset {
    const row: DataAsset = new DataAsset(new ObjectID(id(suffix)));
    row.assetKind = DataAssetKind.Table;
    row.lastChangedAt = new Date("2026-11-03T12:00:00.000Z");
    row.updateIntervalInSeconds = 3600;
    Object.assign(row, fields);
    return row;
  }

  function stubTables(rows: Array<DataAsset>): void {
    jest.spyOn(DataAssetService, "findBy").mockImplementation((async (
      args: FindByArgs,
    ) => {
      reads.push(args);
      return rows;
    }) as never);
  }

  beforeEach(() => {
    reads = [];
  });

  test("the first page is read from the start, by id, as OneUptime", async () => {
    stubTables([]);
    stubQueries(DataAssetService);

    const page: AttentionBackfillPage =
      await DataObservabilityAttentionBackfill.backfillAssetPage({
        limit: 500,
      });

    expect(reads).toHaveLength(1);
    expect(reads[0]!.query).toEqual({});
    expect(reads[0]!.sort).toEqual({ _id: SortOrder.Ascending });
    expect(reads[0]!.skip).toBe(0);
    expect(reads[0]!.limit).toBe(500);
    expect(reads[0]!.props).toEqual({ isRoot: true });
    expect(reads[0]!.select).toEqual({
      _id: true,
      assetKind: true,
      lastChangedAt: true,
      updateIntervalInSeconds: true,
    });
    // Nothing read: nothing written, and no next page.
    expect(page).toEqual({ read: 0, written: 0, lastId: undefined });
    expect(statements).toEqual([]);
  });

  test("a later page starts after the last id of the one before", async () => {
    stubTables([]);
    stubQueries(DataAssetService);

    await DataObservabilityAttentionBackfill.backfillAssetPage({
      afterId: id(500),
      limit: 500,
    });

    expect(cursorOf(reads[0]!.query)).toBe(id(500));
  });

  test("each table's lateAt is the one collection writes, in one statement; a table never late is left as it is", async () => {
    const view: DataAsset = asset(2, { assetKind: DataAssetKind.View });
    const unlearned: DataAsset = asset(3, {
      updateIntervalInSeconds: undefined,
    });

    stubTables([asset(1), view, unlearned]);
    stubQueries(DataAssetService);

    const page: AttentionBackfillPage =
      await DataObservabilityAttentionBackfill.backfillAssetPage({ limit: 3 });

    expect(statements).toHaveLength(1);
    expect(statements[0]!.params).toEqual([
      id(1),
      getDataAssetLateAt({
        kind: DataAssetKind.Table,
        lastChangedAt: new Date("2026-11-03T12:00:00.000Z"),
        updateIntervalInSeconds: 3600,
      })!.toISOString(),
    ]);
    expect(statements[0]!.params[1]).toBe("2026-11-03T14:00:00.000Z");
    // The next page starts after the last table read, written or not.
    expect(page).toEqual({ read: 3, written: 1, lastId: id(3) });
  });

  test("a page with no table to write runs no statement, and still moves on", async () => {
    stubTables([asset(7, { lastChangedAt: undefined })]);
    stubQueries(DataAssetService);

    expect(
      await DataObservabilityAttentionBackfill.backfillAssetPage({ limit: 1 }),
    ).toEqual({ read: 1, written: 0, lastId: id(7) });
    expect(statements).toEqual([]);
  });

  test("a statement that fails fails the page, so the migration tries it again", async () => {
    stubTables([asset(1)]);
    jest.spyOn(DataAssetService, "getRepository").mockReturnValue({
      manager: {
        query: async () => {
          throw new Error("lock timeout");
        },
      },
    } as never);

    await expect(
      DataObservabilityAttentionBackfill.backfillAssetPage({ limit: 1 }),
    ).rejects.toThrow("lock timeout");
  });
});

describe("a page of pipelines", () => {
  test("each pipeline's lateAt is the one a run writes, from its last start and expected interval", async () => {
    const reads: Array<FindByArgs> = [];
    const scheduled: DataPipeline = new DataPipeline(new ObjectID(id(1)));
    scheduled.lastRunStartedAt = new Date("2026-11-03T12:00:00.000Z");
    scheduled.expectedRunIntervalInSeconds = 3600;
    // Never run on a schedule: never late.
    const unscheduled: DataPipeline = new DataPipeline(new ObjectID(id(2)));
    unscheduled.lastRunStartedAt = new Date("2026-11-03T12:00:00.000Z");

    jest.spyOn(DataPipelineService, "findBy").mockImplementation((async (
      args: FindByArgs,
    ) => {
      reads.push(args);
      return [scheduled, unscheduled];
    }) as never);
    stubQueries(DataPipelineService);

    const page: AttentionBackfillPage =
      await DataObservabilityAttentionBackfill.backfillPipelinePage({
        afterId: id(0),
        limit: 2,
      });

    expect(cursorOf(reads[0]!.query)).toBe(id(0));
    expect(reads[0]!.select).toEqual({
      _id: true,
      lastRunStartedAt: true,
      expectedRunIntervalInSeconds: true,
    });
    expect(reads[0]!.props).toEqual({ isRoot: true });
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toContain('UPDATE "DataPipeline"');
    expect(statements[0]!.params).toEqual([
      id(1),
      getDataPipelineLateAt({
        lastRunStartedAt: scheduled.lastRunStartedAt,
        expectedRunIntervalInSeconds: 3600,
      })!.toISOString(),
    ]);
    expect(statements[0]!.params[1]).toBe("2026-11-03T13:15:00.000Z");
    expect(page).toEqual({ read: 2, written: 1, lastId: id(2) });
  });
});

describe("a page of checks", () => {
  test("each check's health is worked out as an alert or a run works it out, and written by the same writer", async () => {
    const reads: Array<FindByArgs> = [];
    const checks: Array<DataCheck> = [1, 2].map((suffix: number) => {
      return new DataCheck(new ObjectID(id(suffix)));
    });

    jest.spyOn(DataCheckService, "findBy").mockImplementation((async (
      args: FindByArgs,
    ) => {
      reads.push(args);
      return checks;
    }) as never);
    const write: ReturnType<typeof jest.spyOn> = jest
      .spyOn(DataCheckHealthSync, "writeHealthOf")
      .mockResolvedValue(1 as never);

    const page: AttentionBackfillPage =
      await DataObservabilityAttentionBackfill.backfillCheckPage({
        afterId: id(0),
        limit: 2,
      });

    expect(cursorOf(reads[0]!.query)).toBe(id(0));
    expect(reads[0]!.select).toBe(DataCheckHealthSync.SELECT);
    expect(reads[0]!.sort).toEqual({ _id: SortOrder.Ascending });
    expect(reads[0]!.props).toEqual({ isRoot: true });
    expect(write).toHaveBeenCalledWith(checks);
    expect(page).toEqual({ read: 2, written: 1, lastId: id(2) });
  });

  test("no checks left: nothing written, and no next page", async () => {
    jest.spyOn(DataCheckService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(DataCheckHealthSync, "writeHealthOf")
      .mockResolvedValue(0 as never);

    expect(
      await DataObservabilityAttentionBackfill.backfillCheckPage({
        limit: 500,
      }),
    ).toEqual({ read: 0, written: 0, lastId: undefined });
  });
});
