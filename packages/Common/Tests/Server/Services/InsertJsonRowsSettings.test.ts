import { describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and AnalyticsDatabaseService's
 * imports reach it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import { getInsertJsonRowsSettings } from "../../../Server/Services/AnalyticsDatabaseService";
import { runWithInsertDedup } from "../../../Server/Utils/AnalyticsDatabase/InsertDedupContext";

/*
 * A DEDUP TOKEN RIDES ONLY A SYNCHRONOUS INSERT (#11536).
 *
 * OneUptime inserts into Distributed tables, and through one ClickHouse
 * dedups an async flush under its first entry's token alone: a retry under
 * a token that led an earlier flush drops a later flush it leads whole,
 * other inserts' rows with it (App's InsertDedupTokensAsyncClickhouse). A
 * synchronous insert keeps its own token for its own block. So an explicit
 * token makes the insert synchronous, an insert asked to be async is sent
 * without its token, and a telemetry job's ambient context never reaches
 * ClickHouse.
 */

describe("getInsertJsonRowsSettings", () => {
  test("no token: async, with the ack mode, as ever", () => {
    expect(getInsertJsonRowsSettings({ waitsForAsyncInsert: false })).toEqual({
      async_insert: 1,
      wait_for_async_insert: 0,
    });
    expect(getInsertJsonRowsSettings({ waitsForAsyncInsert: true })).toEqual({
      async_insert: 1,
      wait_for_async_insert: 1,
    });
  });

  test("an explicit token makes the insert synchronous, carrying it", () => {
    expect(
      getInsertJsonRowsSettings({
        dedupToken: "own-change:job:42",
        waitsForAsyncInsert: true,
      }),
    ).toEqual({
      async_insert: 0,
      insert_deduplication_token: "own-change:job:42",
    });
  });

  test("whatever else the caller asks for, a token's insert stays synchronous", () => {
    expect(
      getInsertJsonRowsSettings({
        dedupToken: "change-detection:a",
        clickhouseSettings: {
          async_insert: 0,
          insert_distributed_sync: 1,
          wait_for_async_insert: 1,
        },
        waitsForAsyncInsert: false,
      }),
    ).toEqual({
      async_insert: 0,
      insert_distributed_sync: 1,
      wait_for_async_insert: 1,
      insert_deduplication_token: "change-detection:a",
    });
  });

  test("an insert asked to be async - the fan-in writer's - is sent without its token", () => {
    for (const asked of [1, "1"] as const) {
      const settings: Record<string, unknown> = getInsertJsonRowsSettings({
        dedupToken: "fanin:MetricItemV3:019a",
        clickhouseSettings: {
          async_insert: asked as never,
          async_insert_busy_timeout_ms: 1000,
        },
        waitsForAsyncInsert: false,
      }) as Record<string, unknown>;

      expect(settings["async_insert"]).toBe(asked);
      expect(settings["async_insert_busy_timeout_ms"]).toBe(1000);
      expect(settings["wait_for_async_insert"]).toBe(0);
      expect(settings).not.toHaveProperty("insert_deduplication_token");
      expect(settings).not.toHaveProperty("async_insert_deduplicate");
    }
  });

  test("never a token on an async insert, even one the caller put in its settings", () => {
    const settings: Record<string, unknown> = getInsertJsonRowsSettings({
      clickhouseSettings: {
        insert_deduplication_token: "slipped-in",
        async_insert_deduplicate: 1,
      },
      waitsForAsyncInsert: false,
    }) as Record<string, unknown>;

    expect(settings["async_insert"]).toBe(1);
    expect(settings).not.toHaveProperty("insert_deduplication_token");
    expect(settings).not.toHaveProperty("async_insert_deduplicate");
  });

  test("a caller's settings win over the defaults of an untokened insert", () => {
    expect(
      getInsertJsonRowsSettings({
        clickhouseSettings: { wait_for_async_insert: 1, async_insert: 0 },
        waitsForAsyncInsert: false,
      }),
    ).toEqual({ async_insert: 0, wait_for_async_insert: 1 });
  });

  test("a telemetry job's ambient context is never read: its inserts stay async and untokened", async () => {
    await runWithInsertDedup("job-7", async (): Promise<void> => {
      expect(getInsertJsonRowsSettings({ waitsForAsyncInsert: false })).toEqual(
        { async_insert: 1, wait_for_async_insert: 0 },
      );
    });
  });

  test("the caller's settings object is left as it was", () => {
    const asked: Record<string, unknown> = {
      async_insert: 1,
      insert_deduplication_token: "slipped-in",
    };

    getInsertJsonRowsSettings({
      dedupToken: "x",
      clickhouseSettings: asked as never,
      waitsForAsyncInsert: false,
    });

    expect(asked).toEqual({
      async_insert: 1,
      insert_deduplication_token: "slipped-in",
    });
  });
});
