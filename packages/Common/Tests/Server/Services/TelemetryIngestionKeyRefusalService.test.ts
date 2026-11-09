import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
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

import TelemetryIngestionKeyRefusalService, {
  MAX_TELEMETRY_INGEST_REFUSAL_ROWS_PER_STATEMENT,
  MAX_TELEMETRY_INGEST_REFUSED_COUNT,
  TelemetryIngestRefusalBatch,
  TelemetryIngestRefusalUpsert,
  buildTelemetryIngestRefusalUpsert,
  mergeTelemetryIngestRefusalBatches,
  toTelemetryIngestRefusedCount,
} from "../../../Server/Services/TelemetryIngestionKeyRefusalService";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE ONE STATEMENT REFUSED TELEMETRY IS COUNTED WITH (issue #6378).
 *
 * TelemetryIngestRefusalRecorder hands over batches - one per key, reason
 * and surface it counted - and this adds each to its row. Pinned here:
 *
 *   - batches that share a row are added together before the statement
 *     (Postgres refuses an ON CONFLICT that updates one row twice);
 *   - the statement inserts or adds, keeps the earliest first and the
 *     latest last, stops the count at the column's bound, and skips a key
 *     that is gone or belongs to another project rather than failing;
 *   - a big write goes as statements of at most 500 rows, one after
 *     another, and a failure stops the rest.
 *
 * The statement itself was run against Postgres when it was written (the
 * PR says how); here the repository is a stub.
 */

const KEY_A: ObjectID = new ObjectID("8d1f0000-0000-4000-8000-0000000000a1");
const KEY_B: ObjectID = new ObjectID("8d1f0000-0000-4000-8000-0000000000b1");
const PROJECT: ObjectID = new ObjectID("8d1f0000-0000-4000-8000-000000000001");

const AT: Date = new Date("2026-11-09T10:00:00.000Z");

function minutesAfter(minutes: number): Date {
  return new Date(AT.getTime() + minutes * 60 * 1000);
}

function batch(
  overrides: Partial<TelemetryIngestRefusalBatch> = {},
): TelemetryIngestRefusalBatch {
  return {
    projectId: PROJECT,
    telemetryIngestionKeyId: KEY_A,
    reason: "key-disabled",
    surface: "otel-traces",
    count: 1,
    firstRefusedAt: AT,
    lastRefusedAt: AT,
    ...overrides,
  };
}

function mockQuery(answer?: () => Promise<unknown>): jest.Mock {
  const query: jest.Mock = jest.fn(() => {
    return answer ? answer() : Promise.resolve([]);
  });

  jest
    .spyOn(TelemetryIngestionKeyRefusalService, "getRepository")
    .mockReturnValue({ manager: { query } } as never);

  return query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("toTelemetryIngestRefusedCount", () => {
  test("a count is a whole number from 1 to the integer column's bound", () => {
    expect(toTelemetryIngestRefusedCount(1)).toBe(1);
    expect(toTelemetryIngestRefusedCount(42)).toBe(42);
    expect(toTelemetryIngestRefusedCount(2.9)).toBe(2);
    expect(toTelemetryIngestRefusedCount(0)).toBe(1);
    expect(toTelemetryIngestRefusedCount(-5)).toBe(1);
    expect(toTelemetryIngestRefusedCount(Number.NaN)).toBe(1);
    expect(toTelemetryIngestRefusedCount(Number.POSITIVE_INFINITY)).toBe(1);
    expect(toTelemetryIngestRefusedCount(1e12)).toBe(
      MAX_TELEMETRY_INGEST_REFUSED_COUNT,
    );
    expect(MAX_TELEMETRY_INGEST_REFUSED_COUNT).toBe(2147483647);
  });
});

describe("mergeTelemetryIngestRefusalBatches", () => {
  test("batches of one key, reason and surface become one: counts added, earliest first, latest last", () => {
    const merged: Array<TelemetryIngestRefusalBatch> =
      mergeTelemetryIngestRefusalBatches([
        batch({
          count: 3,
          firstRefusedAt: minutesAfter(5),
          lastRefusedAt: minutesAfter(6),
        }),
        batch({
          count: 4,
          firstRefusedAt: minutesAfter(1),
          lastRefusedAt: minutesAfter(2),
        }),
        batch({
          count: 2,
          firstRefusedAt: minutesAfter(3),
          lastRefusedAt: minutesAfter(9),
        }),
      ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.count).toBe(9);
    expect(merged[0]!.firstRefusedAt).toEqual(minutesAfter(1));
    expect(merged[0]!.lastRefusedAt).toEqual(minutesAfter(9));
  });

  test("another key, reason or surface stays its own row, in the order first seen", () => {
    const merged: Array<TelemetryIngestRefusalBatch> =
      mergeTelemetryIngestRefusalBatches([
        batch(),
        batch({ telemetryIngestionKeyId: KEY_B }),
        batch({ reason: "origin-not-allowed" }),
        batch({ surface: "otel-logs" }),
        batch({ count: 5 }),
      ]);

    expect(
      merged.map((row: TelemetryIngestRefusalBatch) => {
        return [
          row.telemetryIngestionKeyId.toString(),
          row.reason,
          row.surface,
          row.count,
        ];
      }),
    ).toEqual([
      [KEY_A.toString(), "key-disabled", "otel-traces", 6],
      [KEY_B.toString(), "key-disabled", "otel-traces", 1],
      [KEY_A.toString(), "origin-not-allowed", "otel-traces", 1],
      [KEY_A.toString(), "key-disabled", "otel-logs", 1],
    ]);
  });

  test("an added count stops at the bound, and the batches handed in are left as they were", () => {
    const first: TelemetryIngestRefusalBatch = batch({
      count: MAX_TELEMETRY_INGEST_REFUSED_COUNT - 1,
    });
    const second: TelemetryIngestRefusalBatch = batch({ count: 10 });

    const merged: Array<TelemetryIngestRefusalBatch> =
      mergeTelemetryIngestRefusalBatches([first, second]);

    expect(merged[0]!.count).toBe(MAX_TELEMETRY_INGEST_REFUSED_COUNT);
    expect(first.count).toBe(MAX_TELEMETRY_INGEST_REFUSED_COUNT - 1);
    expect(second.count).toBe(10);
  });
});

describe("buildTelemetryIngestRefusalUpsert", () => {
  test("seven typed parameters a row, numbered on from the row before", () => {
    const upsert: TelemetryIngestRefusalUpsert =
      buildTelemetryIngestRefusalUpsert([
        batch({ count: 3, lastRefusedAt: minutesAfter(2) }),
        batch({ telemetryIngestionKeyId: KEY_B, surface: "unnamed" }),
      ]);

    expect(upsert.parameters).toEqual([
      PROJECT.toString(),
      KEY_A.toString(),
      "key-disabled",
      "otel-traces",
      3,
      AT,
      minutesAfter(2),
      PROJECT.toString(),
      KEY_B.toString(),
      "key-disabled",
      "unnamed",
      1,
      AT,
      AT,
    ]);

    expect(upsert.query).toContain(
      "($1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::integer, $6::timestamptz, $7::timestamptz), ($8::uuid, $9::uuid, $10::varchar, $11::varchar, $12::integer, $13::timestamptz, $14::timestamptz)",
    );
    expect(upsert.query).not.toContain("$15");
  });

  test("inserts or adds on the unique (key, reason, surface), keeping the earliest first and the latest last", () => {
    const query: string = buildTelemetryIngestRefusalUpsert([batch()]).query;

    expect(query).toMatch(/^INSERT INTO "TelemetryIngestionKeyRefusal" \(/);
    expect(query).toContain(
      'ON CONFLICT ("telemetryIngestionKeyId", "reason", "surface") DO UPDATE SET',
    );
    expect(query).toContain(
      `"refusedCount" = LEAST("TelemetryIngestionKeyRefusal"."refusedCount"::bigint + EXCLUDED."refusedCount", ${MAX_TELEMETRY_INGEST_REFUSED_COUNT})`,
    );
    expect(query).toContain(
      '"firstRefusedAt" = LEAST("TelemetryIngestionKeyRefusal"."firstRefusedAt", EXCLUDED."firstRefusedAt")',
    );
    expect(query).toContain(
      '"lastRefusedAt" = GREATEST("TelemetryIngestionKeyRefusal"."lastRefusedAt", EXCLUDED."lastRefusedAt")',
    );
    expect(query).toContain('"updatedAt" = now()');
  });

  test("a key that is gone, or not of the row's project, is skipped rather than failing the statement", () => {
    const query: string = buildTelemetryIngestRefusalUpsert([batch()]).query;

    expect(query).toContain(
      'WHERE EXISTS (SELECT 1 FROM "TelemetryIngestionKey" AS ingestionKey WHERE ingestionKey."_id" = refused."telemetryIngestionKeyId" AND ingestionKey."projectId" = refused."projectId")',
    );
  });

  test("a count out of range is put in range in the parameters too", () => {
    const upsert: TelemetryIngestRefusalUpsert =
      buildTelemetryIngestRefusalUpsert([
        batch({ count: 0 }),
        batch({ telemetryIngestionKeyId: KEY_B, count: 1e15 }),
      ]);

    expect(upsert.parameters[4]).toBe(1);
    expect(upsert.parameters[11]).toBe(MAX_TELEMETRY_INGEST_REFUSED_COUNT);
  });
});

describe("TelemetryIngestionKeyRefusalService.addRefusals", () => {
  test("one statement for a small write, with the batches that share a row added together", async () => {
    const query: jest.Mock = mockQuery();

    await TelemetryIngestionKeyRefusalService.addRefusals([
      batch({ count: 2 }),
      batch({ count: 3, lastRefusedAt: minutesAfter(4) }),
      batch({ telemetryIngestionKeyId: KEY_B }),
    ]);

    expect(query).toHaveBeenCalledTimes(1);

    const parameters: Array<unknown> = query.mock
      .calls[0]![1] as Array<unknown>;
    expect(parameters).toHaveLength(14);
    expect(parameters[4]).toBe(5);
    expect(parameters[6]).toEqual(minutesAfter(4));
  });

  test("a big write goes as statements of at most 500 rows, one after another", async () => {
    let running: number = 0;
    let mostAtOnce: number = 0;
    const query: jest.Mock = mockQuery(async (): Promise<unknown> => {
      running += 1;
      mostAtOnce = Math.max(mostAtOnce, running);
      await Promise.resolve();
      running -= 1;
      return [];
    });

    const batches: Array<TelemetryIngestRefusalBatch> = [];
    for (let index: number = 0; index < 1201; index++) {
      batches.push(batch({ surface: `surface-${index}` }));
    }

    await TelemetryIngestionKeyRefusalService.addRefusals(batches);

    expect(MAX_TELEMETRY_INGEST_REFUSAL_ROWS_PER_STATEMENT).toBe(500);
    expect(
      query.mock.calls.map((call: Array<unknown>): number => {
        return (call[1] as Array<unknown>).length / 7;
      }),
    ).toEqual([500, 500, 201]);
    expect(mostAtOnce).toBe(1);
  });

  test("a statement that fails stops the rest and reaches the caller (the recorder logs it)", async () => {
    let calls: number = 0;
    const query: jest.Mock = mockQuery((): Promise<unknown> => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("connection terminated"))
        : Promise.resolve([]);
    });

    const batches: Array<TelemetryIngestRefusalBatch> = [];
    for (let index: number = 0; index < 600; index++) {
      batches.push(batch({ surface: `surface-${index}` }));
    }

    await expect(
      TelemetryIngestionKeyRefusalService.addRefusals(batches),
    ).rejects.toThrow("connection terminated");
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("nothing to add is no statement at all", async () => {
    const query: jest.Mock = mockQuery();

    await TelemetryIngestionKeyRefusalService.addRefusals([]);

    expect(query).not.toHaveBeenCalled();
  });
});
