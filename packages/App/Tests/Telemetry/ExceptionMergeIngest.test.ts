/*
 * The fingerprint aliases of merged exceptions, at ingest.
 *
 * An exception merged into another keeps its fingerprint, and that
 * fingerprint is from then on an alias of the one it was merged into: the
 * batch upsert looks a batch's fingerprints up among the merged exceptions
 * (one read per project) and counts each occurrence of one on its survivor
 * too. Here with the database mocked; ExceptionMergePostgres.test.ts runs the
 * same against a real Postgres.
 */
import ExceptionUtil, {
  MergedExceptionSurvivor,
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);

function occurrence(
  fingerprint: string,
  overrides: Partial<TelemetryExceptionPayload> = {},
): TelemetryExceptionPayload {
  return {
    fingerprint,
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    exceptionType: "TypeError",
    message: `message of ${fingerprint}`,
    stackTrace: "TypeError: x\n    at f (a.js:1:1)",
    environment: "production",
    release: "2.0.0",
    unhandled: true,
    occurredAt: new Date("2026-10-30T11:00:00.000Z"),
    ...overrides,
  };
}

interface QueryCall {
  sql: string;
  params: Array<unknown>;
}

let calls: Array<QueryCall>;
let mergedRows: Array<Record<string, string>> | Error;

beforeEach(() => {
  calls = [];
  mergedRows = [];

  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        calls.push({ sql, params });

        if (sql.includes('"mergedIntoTelemetryExceptionId" IS NOT NULL')) {
          if (mergedRows instanceof Error) {
            throw mergedRows;
          }
          return mergedRows;
        }

        return [];
      },
    },
  } as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lookups(): Array<QueryCall> {
  return calls.filter((call: QueryCall): boolean => {
    return call.sql.includes('"mergedIntoTelemetryExceptionId" IS NOT NULL');
  });
}

function upserts(): Array<QueryCall> {
  return calls.filter((call: QueryCall): boolean => {
    return call.sql.includes("INSERT INTO");
  });
}

describe("looking a batch's fingerprints up among the merged exceptions", () => {
  test("one read per project, with every fingerprint of its batch, through the partial index's predicate", async () => {
    await ExceptionUtil.resolveMergedExceptions([
      occurrence("a"),
      occurrence("b"),
      occurrence("a"),
      occurrence("c", { projectId: OTHER_PROJECT_ID }),
    ]);

    expect(lookups()).toHaveLength(2);
    expect(lookups()[0]!.params).toEqual([PROJECT_ID.toString(), ["a", "b"]]);
    expect(lookups()[1]!.params).toEqual([OTHER_PROJECT_ID.toString(), ["c"]]);

    const sql: string = lookups()[0]!.sql;
    expect(sql).toContain('m."projectId" = $1');
    expect(sql).toContain('m."fingerprint" = ANY($2::text[])');
    expect(sql).toContain('s."_id" = m."mergedIntoTelemetryExceptionId"');
    // Deleted rows are neither aliases nor survivors.
    expect(sql).toContain('m."deletedAt" IS NULL');
    expect(sql).toContain('s."deletedAt" IS NULL');
  });

  test("each merged fingerprint points at its survivor", async () => {
    mergedRows = [
      {
        fingerprint: "b",
        primaryEntityId: SERVICE_ID.toString(),
        survivorPrimaryEntityId: SERVICE_ID.toString(),
        survivorFingerprint: "a",
      },
    ];

    const survivors: Map<string, MergedExceptionSurvivor> =
      await ExceptionUtil.resolveMergedExceptions([occurrence("b")]);

    expect(survivors.size).toBe(1);
    const survivor: MergedExceptionSurvivor = Array.from(survivors.values())[0]!;
    expect(survivor.fingerprint).toBe("a");
    expect(survivor.primaryEntityId.toString()).toBe(SERVICE_ID.toString());
  });

  test("an empty batch reads nothing", async () => {
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([]);

    expect(calls).toHaveLength(0);
  });
});

describe("counting an occurrence of a merged exception on its survivor too", () => {
  beforeEach(() => {
    mergedRows = [
      {
        fingerprint: "b",
        primaryEntityId: SERVICE_ID.toString(),
        survivorPrimaryEntityId: SERVICE_ID.toString(),
        survivorFingerprint: "a",
      },
    ];
  });

  test("the batch gains a copy under the survivor's key, with no message, stack trace, type or environment", async () => {
    const out: Array<TelemetryExceptionPayload> =
      await ExceptionUtil.withMergedSurvivors([occurrence("b")]);

    expect(out).toHaveLength(2);
    expect(out[0]!.fingerprint).toBe("b");

    const copy: TelemetryExceptionPayload = out[1]!;
    expect(copy.fingerprint).toBe("a");
    expect(copy.primaryEntityId.toString()).toBe(SERVICE_ID.toString());
    expect(copy.message).toBeUndefined();
    expect(copy.stackTrace).toBeUndefined();
    expect(copy.exceptionType).toBeUndefined();
    expect(copy.environment).toBeUndefined();
    // What it does carry: when, the release, and whether it was handled.
    expect(copy.occurredAt).toEqual(new Date("2026-10-30T11:00:00.000Z"));
    expect(copy.release).toBe("2.0.0");
    expect(copy.unhandled).toBe(true);
  });

  test("the upsert counts the merged one on its own row and on its survivor, in one statement", async () => {
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence("b"),
      occurrence("b"),
    ]);

    expect(upserts()).toHaveLength(1);
    const params: Array<unknown> = upserts()[0]!.params;
    // 14 values per row; rows are ordered by their conflict key: a, then b.
    expect(params.length).toBe(28);
    expect(params[2]).toBe("a");
    expect(params[3]).toBe("");
    expect(params[8]).toBe(2);
    expect(params[16]).toBe("b");
    expect(params[17]).toBe("message of b");
    expect(params[22]).toBe(2);
  });

  test("the survivor's own occurrences in the same batch keep its message, and the counts add", async () => {
    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence("b"),
      occurrence("a"),
    ]);

    const params: Array<unknown> = upserts()[0]!.params;
    expect(params[2]).toBe("a");
    expect(params[3]).toBe("message of a");
    expect(params[8]).toBe(2);
  });

  test("an occurrence of another exception gains nothing", async () => {
    const out: Array<TelemetryExceptionPayload> =
      await ExceptionUtil.withMergedSurvivors([
        occurrence("c"),
        occurrence("b", {
          primaryEntityId: new ObjectID("20000000-0000-4000-8000-000000000009"),
        }),
      ]);

    expect(out).toHaveLength(2);
  });
});

describe("when the lookup fails", () => {
  test("the batch is counted as it would have been before any merge, and nothing is dropped", async () => {
    mergedRows = new Error("connection reset");

    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence("b"),
    ]);

    expect(upserts()).toHaveLength(1);
    expect(upserts()[0]!.params[2]).toBe("b");
    expect(upserts()[0]!.params.length).toBe(14);
    expect(logger.warn).toHaveBeenCalled();
  });
});
