import ExceptionUtil, {
  ExceptionGroupingContent,
  GROUP_FINGERPRINT_LOOKUP_RETRY_BUDGET_MS,
  GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS,
  GROUP_FINGERPRINT_LOOKUP_SQL,
  GroupFingerprintCandidate,
  OccurrenceFingerprints,
  ResolvedGroups,
  TelemetryExceptionPayload,
  clearExistingV1FingerprintCache,
  groupFingerprintKey,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import HeldExceptionOccurrences, {
  HELD_OCCURRENCE_RETRY_MS,
} from "../../FeatureSet/Telemetry/Utils/HeldExceptionOccurrences";
import { fingerprintSha256 } from "../../FeatureSet/Telemetry/Utils/FingerprintHash";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService from "Common/Server/Services/TelemetryExceptionActivityService";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionMergeResult,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionMerge";
import {
  SPLIT_HEAL_ROWS_SQL,
  SPLIT_HEAL_ROW_BY_ID_SQL,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionSplitHeal";
import KeyedExceptionFingerprint from "Common/Server/Utils/Telemetry/KeyedExceptionFingerprint";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * ONE FAILED FINGERPRINT LOOKUP NEVER SPLITS AN EXCEPTION, NOR FIRES NEW
 * EXCEPTION AGAIN (#11027).
 *
 * An occurrence belongs to the first exception that exists under one of its
 * fingerprints, read from Postgres a project at a time. Until #11027 a read
 * that failed filed every occurrence of the project's batch under its
 * grouping v1 fingerprint: for an exception made since grouping v2 nothing
 * existed there, so the upsert made one - a new exception for an old error,
 * New Exception again - and as every later occurrence tries v1 first, the
 * duplicate took every one of them, for good.
 *
 * Now the read is tried again; an occurrence whose exception this process
 * knew of goes to it; and one whose exception cannot be known is held, not
 * counted on a guess, until the read works. A duplicate the old fallback
 * made is merged back into the exception it was split from, with no alert.
 *
 * The real grouping, resolution, hold and upsert of ExceptionUtil, up to the
 * upsert's statement. Postgres is a stand-in: a table that answers the
 * lookup as GROUP_FINGERPRINT_LOOKUP_SQL does - each row's fingerprint, where
 * a moved one went, when its exception was made and what it is merged into -
 * takes the upsert as its statement does (a fingerprint nobody has is a new
 * exception, made now; a known one counts the batch's occurrences), and
 * merges as TelemetryExceptionMerge does. A New Exception monitor counts the
 * exceptions first seen in its window that are not merged, as
 * ExceptionMonitorMeasures does.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-000000011027",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "71000000-0000-4000-8000-000000011027",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "80000000-0000-4000-8000-000000011027",
);

const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;
// The ten minutes a New Exception monitor looks back over.
const MONITOR_WINDOW_MS: number = 10 * MINUTE_MS;

const NOW: number = Date.now();
// When grouping v2 shipped, and when the exceptions of each era were made.
const MADE_BEFORE_V2: number = NOW - 40 * DAY_MS;
const MADE_SINCE_V2: number = NOW - 20 * DAY_MS;
// When the fallback of before #11027 made a duplicate.
const DUPLICATE_MADE: number = NOW - 2 * DAY_MS;

/*
 * A message that grouping v1 to v4 each read differently: v3 folds the US
 * number, v4 the international one too.
 */
const SMS: ExceptionGroupingContent = {
  exceptionType: "SmsDeliveryError",
  message: "SMS to 555-123-4567 and +44 20 7946 0958 was not delivered",
  stackTrace: "",
};
const OTHER_SMS: ExceptionGroupingContent = {
  ...SMS,
  message: "SMS to 555-987-6543 and +49 30 123456 was not delivered",
};

interface Fingerprints {
  v1: string;
  keyedV1: string;
  v2: string;
  keyedV2: string;
  v3: string;
  keyedV3: string;
  v4: string;
  keyedV4: string;
}

// The fingerprints of an exception, as each grouping version gives them.
function fingerprintsOf(
  content: ExceptionGroupingContent,
  projectId: ObjectID = PROJECT_ID,
): Fingerprints {
  const input: {
    projectId: ObjectID;
    primaryEntityId: ObjectID;
    message: string;
    stackTrace: string;
    exceptionType: string;
  } = {
    projectId,
    primaryEntityId: SERVICE_ID,
    message: content.message,
    stackTrace: content.stackTrace,
    exceptionType: content.exceptionType,
  };
  const v1Text: string = ExceptionUtil.getGroupingTextV1(input);
  const texts: { v2: string; v3: string; v4: string } =
    ExceptionUtil.getGroupingTexts(input);
  const keyed: (text: string) => string = (text: string): string => {
    return KeyedExceptionFingerprint.ofGroupingText({ projectId, text });
  };

  return {
    v1: fingerprintSha256(v1Text),
    keyedV1: KeyedExceptionFingerprint.ofFirstGroupingText({
      projectId,
      text: v1Text,
    }),
    v2: fingerprintSha256(texts.v2),
    keyedV2: keyed(texts.v2),
    v3: fingerprintSha256(texts.v3),
    keyedV3: keyed(texts.v3),
    v4: fingerprintSha256(texts.v4),
    keyedV4: keyed(texts.v4),
  };
}

// One occurrence of an exception as the ingest hands it to the upsert.
function occurrence(data: {
  content?: ExceptionGroupingContent;
  at?: number;
  projectId?: ObjectID;
  release?: string;
}): TelemetryExceptionPayload {
  const content: ExceptionGroupingContent = data.content || SMS;
  const projectId: ObjectID = data.projectId || PROJECT_ID;
  const fingerprints: OccurrenceFingerprints =
    ExceptionUtil.getOccurrenceFingerprints({
      projectId,
      primaryEntityId: SERVICE_ID,
      arrived: content,
      stored: content,
    });

  return {
    fingerprint: fingerprints.fingerprint,
    fingerprintV2: fingerprints.fingerprintV2,
    fingerprintCandidates: fingerprints.fingerprintCandidates,
    projectId,
    primaryEntityId: SERVICE_ID,
    message: content.message,
    stackTrace: content.stackTrace,
    exceptionType: content.exceptionType,
    occurredAt: new Date(data.at === undefined ? NOW : data.at),
    ...(data.release !== undefined ? { release: data.release } : {}),
  };
}

// The same, as an occurrence row ClickHouse stores carries its fingerprints.
function row(
  content: ExceptionGroupingContent = SMS,
  projectId: ObjectID = PROJECT_ID,
): JSONObject {
  const fingerprints: OccurrenceFingerprints =
    ExceptionUtil.getOccurrenceFingerprints({
      projectId,
      primaryEntityId: SERVICE_ID,
      arrived: content,
      stored: content,
    });

  return {
    projectId: projectId.toString(),
    primaryEntityId: SERVICE_ID.toString(),
    fingerprint: fingerprints.fingerprint,
    fingerprintV2: fingerprints.fingerprintV2,
    fingerprintCandidates: fingerprints.fingerprintCandidates,
  };
}

// One exception of the stand-in table.
interface StoredException {
  id: string;
  projectId: string;
  fingerprint: string;
  createdAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occuranceCount: number;
  mergedInto: string | null;
  formerFingerprintOf: string | null;
}

// By project and fingerprint.
let table: Map<string, StoredException>;
let made: number;
// The exceptions the upsert made: each a New Exception for its monitor.
let insertedByIngest: Array<StoredException>;
let lookups: number;
// Whether every read fails, and the outcome of each next one, first to last.
let lookupDown: boolean;
let nextLookups: Array<"fail" | "work">;
let mergeCalls: Array<{ survivor: string; merged: Array<string> }>;
let mergeFails: boolean;
let unmergedByAPerson: Set<string>;

function tableKey(projectId: string, fingerprint: string): string {
  return `${projectId.toLowerCase()}|${fingerprint}`;
}

function byId(id: string | null): StoredException | undefined {
  return Array.from(table.values()).find((each: StoredException) => {
    return Boolean(id) && each.id.toLowerCase() === id!.toLowerCase();
  });
}

// An exception made before this test's batches.
function seed(data: {
  fingerprint: string;
  madeAt: number;
  count?: number;
  projectId?: ObjectID;
}): StoredException {
  const exception: StoredException = {
    id: `00000000-0000-4000-8000-${String(++made).padStart(12, "0")}`,
    projectId: (data.projectId || PROJECT_ID).toString(),
    fingerprint: data.fingerprint,
    createdAt: new Date(data.madeAt),
    firstSeenAt: new Date(data.madeAt),
    lastSeenAt: new Date(data.madeAt),
    occuranceCount: data.count || 1,
    mergedInto: null,
    formerFingerprintOf: null,
  };

  table.set(tableKey(exception.projectId, exception.fingerprint), exception);

  return exception;
}

function storeUpsert(params: Array<unknown>): void {
  // 14 values a row, in the statement's column order.
  for (let index: number = 0; index + 13 < params.length; index += 14) {
    const projectId: string = params[index] as string;
    const fingerprint: string = params[index + 2] as string;
    const firstSeenAt: Date = new Date(params[index + 6] as Date);
    const lastSeenAt: Date = new Date(params[index + 7] as Date);
    const count: number = Number(params[index + 8]);
    const stored: StoredException | undefined = table.get(
      tableKey(projectId, fingerprint),
    );

    if (!stored) {
      const exception: StoredException = {
        id: `00000000-0000-4000-8000-${String(++made).padStart(12, "0")}`,
        projectId,
        fingerprint,
        createdAt: new Date(),
        firstSeenAt,
        lastSeenAt,
        occuranceCount: count,
        mergedInto: null,
        formerFingerprintOf: null,
      };

      table.set(tableKey(projectId, fingerprint), exception);
      insertedByIngest.push(exception);
      continue;
    }

    stored.occuranceCount += count;
    stored.firstSeenAt =
      firstSeenAt < stored.firstSeenAt ? firstSeenAt : stored.firstSeenAt;
    stored.lastSeenAt =
      lastSeenAt > stored.lastSeenAt ? lastSeenAt : stored.lastSeenAt;
  }
}

function lookupFailsNow(): boolean {
  const next: "fail" | "work" | undefined = nextLookups.shift();

  return next ? next === "fail" : lookupDown;
}

function healRow(exception: StoredException): Record<string, unknown> {
  return {
    id: exception.id,
    fingerprint: exception.fingerprint,
    createdAt: exception.createdAt,
    mergedIntoId: exception.mergedInto,
    formerFingerprintOfId: exception.formerFingerprintOf,
  };
}

function setupPostgres(): void {
  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql === GROUP_FINGERPRINT_LOOKUP_SQL) {
          lookups++;

          if (lookupFailsNow()) {
            throw new Error("Connection terminated unexpectedly");
          }

          const projectId: string = params[0] as string;

          return (params[1] as Array<string>)
            .map((fingerprint: string) => {
              return table.get(tableKey(projectId, fingerprint));
            })
            .filter((exception: StoredException | undefined) => {
              return Boolean(exception);
            })
            .map((exception: StoredException | undefined) => {
              const owner: StoredException | undefined = byId(
                exception!.formerFingerprintOf,
              );

              return {
                fingerprint: exception!.fingerprint,
                movedTo: owner?.fingerprint || null,
                createdAt: (owner || exception!).createdAt,
                mergedInto: exception!.mergedInto,
              };
            });
        }

        if (sql.includes('INSERT INTO "TelemetryException"')) {
          storeUpsert(params);
          // Nothing was resolved, so nothing is reopened.
          return [];
        }

        // The merged exceptions of the batch (withMergedSurvivors).
        if (sql.includes(`m."mergedIntoTelemetryExceptionId" IS NOT NULL`)) {
          const projectId: string = params[0] as string;

          return (params[1] as Array<string>)
            .map((fingerprint: string) => {
              return table.get(tableKey(projectId, fingerprint));
            })
            .filter((exception: StoredException | undefined) => {
              return Boolean(exception?.mergedInto);
            })
            .map((exception: StoredException | undefined) => {
              return {
                fingerprint: exception!.fingerprint,
                primaryEntityId: SERVICE_ID.toString(),
                survivorPrimaryEntityId: SERVICE_ID.toString(),
                survivorFingerprint: byId(exception!.mergedInto)!.fingerprint,
              };
            });
        }

        if (sql === SPLIT_HEAL_ROWS_SQL) {
          const projectId: string = params[0] as string;

          return (params[2] as Array<string>)
            .map((fingerprint: string) => {
              return table.get(tableKey(projectId, fingerprint));
            })
            .filter((exception: StoredException | undefined) => {
              return Boolean(exception);
            })
            .map((exception: StoredException | undefined) => {
              return healRow(exception!);
            });
        }

        if (sql === SPLIT_HEAL_ROW_BY_ID_SQL) {
          const exception: StoredException | undefined = byId(
            params[0] as string,
          );

          return exception ? [healRow(exception)] : [];
        }

        return [];
      },
    },
  } as never);

  // A merge as TelemetryExceptionMerge makes it: the survivor takes it in.
  jest
    .spyOn(TelemetryExceptionMerge, "merge")
    .mockImplementation((async (data: {
      telemetryExceptionId: ObjectID;
      mergedTelemetryExceptionIds: Array<ObjectID>;
    }): Promise<ExceptionMergeResult> => {
      if (mergeFails) {
        throw new Error("deadlock detected");
      }

      const survivor: StoredException = byId(
        data.telemetryExceptionId.toString(),
      )!;

      mergeCalls.push({
        survivor: survivor.fingerprint,
        merged: data.mergedTelemetryExceptionIds.map((id: ObjectID) => {
          return byId(id.toString())!.fingerprint;
        }),
      });

      for (const id of data.mergedTelemetryExceptionIds) {
        const merged: StoredException = byId(id.toString())!;

        merged.mergedInto = survivor.id;
        survivor.occuranceCount += merged.occuranceCount;
        survivor.firstSeenAt =
          merged.firstSeenAt < survivor.firstSeenAt
            ? merged.firstSeenAt
            : survivor.firstSeenAt;
        survivor.lastSeenAt =
          merged.lastSeenAt > survivor.lastSeenAt
            ? merged.lastSeenAt
            : survivor.lastSeenAt;
      }

      return {
        telemetryExceptionId: survivor.id,
        merged: data.mergedTelemetryExceptionIds.map((id: ObjectID) => {
          return {
            telemetryExceptionId: id.toString(),
            outcome: ExceptionMergeOutcome.Merged,
          };
        }),
      };
    }) as never);

  jest
    .spyOn(TelemetryExceptionActivityService, "countBy")
    .mockImplementation((async (data: {
      query: { telemetryExceptionId: ObjectID };
    }): Promise<PositiveNumber> => {
      return new PositiveNumber(
        unmergedByAPerson.has(data.query.telemetryExceptionId.toString())
          ? 1
          : 0,
      );
    }) as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "info").mockImplementation((() => {
    return undefined;
  }) as never);
  // A failed read is tried again at once.
  jest.spyOn(ExceptionUtil, "pauseBeforeLookupRetry").mockResolvedValue();
}

// The exceptions a list or a monitor counts: not merged, not a former fingerprint.
function exceptions(projectId: ObjectID = PROJECT_ID): Array<StoredException> {
  return Array.from(table.values()).filter((each: StoredException) => {
    return (
      each.projectId === projectId.toString() &&
      !each.mergedInto &&
      !each.formerFingerprintOf
    );
  });
}

/*
 * What a New Exception monitor that runs just after `at` counts: the
 * exceptions first seen in its ten minutes, merged ones left out.
 */
function newExceptionsAround(at: number = NOW): number {
  return exceptions().filter((exception: StoredException) => {
    const firstSeen: number = exception.firstSeenAt.getTime();

    return firstSeen > at - MONITOR_WINDOW_MS && firstSeen <= at + MINUTE_MS;
  }).length;
}

function under(fingerprint: string): StoredException | undefined {
  return table.get(tableKey(PROJECT_ID.toString(), fingerprint));
}

async function upsert(
  payloads: Array<TelemetryExceptionPayload>,
): Promise<void> {
  await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch(payloads);
}

// The occurrences ClickHouse would store, given their exceptions' fingerprints.
async function storeRows(rows: Array<JSONObject>): Promise<Array<string>> {
  await ExceptionUtil.assignRowGroupFingerprints(rows);

  return rows.map((each: JSONObject) => {
    return each["fingerprint"] as string;
  });
}

beforeEach(() => {
  clearExistingV1FingerprintCache();
  table = new Map<string, StoredException>();
  made = 0;
  insertedByIngest = [];
  lookups = 0;
  lookupDown = false;
  nextLookups = [];
  mergeCalls = [];
  mergeFails = false;
  unmergedByAPerson = new Set<string>();
  setupPostgres();
});

afterEach(() => {
  clearExistingV1FingerprintCache();
  jest.restoreAllMocks();
});

describe("the fingerprints of the exceptions in these tests", () => {
  test("grouping v1 to v4 and their keyed ones are eight fingerprints, and the occurrence tries them in that order", () => {
    const sms: Fingerprints = fingerprintsOf(SMS);

    expect(new Set<string>(Object.values(sms)).size).toBe(8);
    expect(occurrence({}).fingerprintCandidates).toEqual([
      sms.v1,
      sms.keyedV1,
      sms.v2,
      sms.keyedV2,
      sms.v3,
      sms.keyedV3,
      sms.v4,
      sms.keyedV4,
    ]);
    // Grouping v1's is what it was filed under before #11027; v4's is made.
    expect(occurrence({}).fingerprint).toBe(sms.v1);
    expect(occurrence({}).fingerprintV2).toBe(sms.v4);
  });

  test("two numbers make two exceptions until v4, and one under it", () => {
    const sms: Fingerprints = fingerprintsOf(SMS);
    const other: Fingerprints = fingerprintsOf(OTHER_SMS);

    expect(sms.v1).not.toBe(other.v1);
    expect(sms.v2).not.toBe(other.v2);
    expect(sms.v3).not.toBe(other.v3);
    expect(sms.v4).toBe(other.v4);
  });
});

/*
 * Each era an exception may have been made in: before grouping v2, under
 * v1; and since, under each later version's fingerprint or its keyed one.
 */
const ERAS: Array<[string, keyof Fingerprints, number]> = [
  ["before grouping v2, under v1", "v1", MADE_BEFORE_V2],
  ["under v2", "v2", MADE_SINCE_V2],
  ["under v2's keyed fingerprint", "keyedV2", MADE_SINCE_V2],
  ["under v3", "v3", MADE_SINCE_V2],
  ["under v3's keyed fingerprint", "keyedV3", MADE_SINCE_V2],
  ["under v4", "v4", MADE_SINCE_V2],
  ["under v4's keyed fingerprint", "keyedV4", MADE_SINCE_V2],
];

describe.each(ERAS)(
  "an exception made %s",
  (_era: string, version: keyof Fingerprints, madeAt: number) => {
    let existing: StoredException;

    beforeEach(() => {
      existing = seed({
        fingerprint: fingerprintsOf(SMS)[version],
        madeAt,
        count: 10,
      });
    });

    test("a read that fails once, then works when tried again: counted on it at once, nothing held, nothing made", async () => {
      nextLookups = ["fail"];

      await upsert([occurrence({})]);

      expect(lookups).toBe(2);
      expect(existing.occuranceCount).toBe(11);
      expect(HeldExceptionOccurrences.isEmpty()).toBe(true);
      expect(insertedByIngest).toEqual([]);
      expect(newExceptionsAround()).toBe(0);
    });

    test("a read that fails every try of one batch: nothing is made, the occurrence is held, and the next batch counts it on the exception - no New Exception", async () => {
      lookupDown = true;

      await upsert([occurrence({ at: NOW - 2000 })]);

      expect(lookups).toBe(GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS.length + 1);
      expect(insertedByIngest).toEqual([]);
      expect(existing.occuranceCount).toBe(10);
      expect(HeldExceptionOccurrences.count()).toBe(1);
      // Above all, nothing under v1, which every later occurrence tries first.
      expect(under(fingerprintsOf(SMS).v1)).toBe(
        version === "v1" ? existing : undefined,
      );

      // The read works again.
      lookupDown = false;
      await upsert([occurrence({ at: NOW - 1000 })]);

      expect(existing.occuranceCount).toBe(12);
      expect(existing.lastSeenAt.getTime()).toBe(NOW - 1000);
      expect(HeldExceptionOccurrences.isEmpty()).toBe(true);
      expect(insertedByIngest).toEqual([]);
      expect(exceptions()).toEqual([existing]);
      expect(newExceptionsAround()).toBe(0);
    });

    test("a read that fails for a while: nothing is made however many batches come, and once it works every occurrence is counted on the exception, at its own time", async () => {
      lookupDown = true;

      for (let batch: number = 0; batch < 6; batch++) {
        await upsert([
          occurrence({ at: NOW - (60 - batch * 10) * 1000 }),
          occurrence({ at: NOW - (59 - batch * 10) * 1000 }),
          occurrence({ at: NOW - (58 - batch * 10) * 1000 }),
        ]);
      }

      expect(insertedByIngest).toEqual([]);
      expect(existing.occuranceCount).toBe(10);
      expect(HeldExceptionOccurrences.count()).toBe(18);
      expect(newExceptionsAround()).toBe(0);

      lookupDown = false;
      await upsert([occurrence({ at: NOW })]);

      expect(existing.occuranceCount).toBe(10 + 18 + 1);
      expect(existing.firstSeenAt.getTime()).toBe(madeAt);
      expect(existing.lastSeenAt.getTime()).toBe(NOW);
      expect(HeldExceptionOccurrences.isEmpty()).toBe(true);
      expect(insertedByIngest).toEqual([]);
      expect(newExceptionsAround()).toBe(0);
    });

    test("and once it recovers, every later occurrence keeps going to it: nothing split", async () => {
      lookupDown = true;
      await upsert([occurrence({})]);
      lookupDown = false;

      for (let batch: number = 0; batch < 5; batch++) {
        clearExistingV1FingerprintCache();
        await upsert([occurrence({}), occurrence({})]);
      }

      expect(existing.occuranceCount).toBe(10 + 10);
      expect(insertedByIngest).toEqual([]);
      expect(exceptions()).toEqual([existing]);
    });

    test("the occurrences stored while it cannot be read never go under v1, unless the exception is there", async () => {
      lookupDown = true;

      const stored: Array<string> = await storeRows([row(), row()]);

      expect(stored).toEqual([fingerprintsOf(SMS).v4, fingerprintsOf(SMS).v4]);

      // Known to this process, they go to the exception itself.
      lookupDown = false;
      await storeRows([row()]);
      lookupDown = true;

      expect(await storeRows([row()], Date.now() + 20 * MINUTE_MS)).toEqual([
        existing.fingerprint,
      ]);
    });
  },
);

describe("an exception no one has seen, while its project's exceptions cannot be read", () => {
  test("is made once the read works - one New Exception, first seen when it first happened", async () => {
    lookupDown = true;

    await upsert([occurrence({ at: NOW - 30000 })]);
    await upsert([
      occurrence({ at: NOW - 20000 }),
      occurrence({ at: NOW - 10000 }),
    ]);

    expect(insertedByIngest).toEqual([]);
    expect(newExceptionsAround()).toBe(0);

    lookupDown = false;
    await upsert([occurrence({ at: NOW })]);

    expect(insertedByIngest).toHaveLength(1);
    expect(insertedByIngest[0]!.fingerprint).toBe(fingerprintsOf(SMS).v4);
    expect(insertedByIngest[0]!.occuranceCount).toBe(4);
    expect(insertedByIngest[0]!.firstSeenAt.getTime()).toBe(NOW - 30000);
    expect(insertedByIngest[0]!.lastSeenAt.getTime()).toBe(NOW);
    expect(newExceptionsAround()).toBe(1);

    // And never again.
    await upsert([occurrence({ at: NOW + 1000 })]);
    expect(insertedByIngest).toHaveLength(1);
    expect(newExceptionsAround()).toBe(1);
  });

  test("its occurrences stored meanwhile are under the fingerprint it is then made under, so its page shows them", async () => {
    lookupDown = true;

    const stored: Array<string> = await storeRows([row()]);

    lookupDown = false;
    await upsert([occurrence({})]);

    expect(stored).toEqual([insertedByIngest[0]!.fingerprint]);
  });

  test("two numbers held meanwhile become one exception under v4, as they would have", async () => {
    lookupDown = true;
    await upsert([
      occurrence({ content: SMS, at: NOW - 2000 }),
      occurrence({ content: OTHER_SMS, at: NOW - 1000 }),
    ]);

    lookupDown = false;
    await upsert([occurrence({ content: OTHER_SMS })]);

    expect(insertedByIngest).toHaveLength(1);
    expect(insertedByIngest[0]!.occuranceCount).toBe(3);
    expect(newExceptionsAround()).toBe(1);
  });
});

describe("what this process knew settles what the read cannot", () => {
  test("an exception it read before, however long ago, gets the occurrence at once: nothing held", async () => {
    const existing: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v2,
      madeAt: MADE_SINCE_V2,
    });

    await upsert([occurrence({})]);
    expect(existing.occuranceCount).toBe(2);

    // Twenty minutes on, past the cache's ten, the read fails.
    lookupDown = true;
    await ExceptionUtil.assignPayloadGroupFingerprints(
      [occurrence({})],
      NOW + 20 * MINUTE_MS,
    ).then(async (ready: Array<TelemetryExceptionPayload>) => {
      expect(ready).toHaveLength(1);
      expect(ready[0]!.fingerprint).toBe(existing.fingerprint);
    });

    expect(HeldExceptionOccurrences.isEmpty()).toBe(true);
  });

  test("an exception it knew moved to a private fingerprint gets it where it went", async () => {
    const moved: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).keyedV2,
      madeAt: MADE_SINCE_V2,
    });
    const former: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v2,
      madeAt: NOW - DAY_MS,
    });
    former.formerFingerprintOf = moved.id;
    former.mergedInto = moved.id;

    await upsert([occurrence({})]);
    expect(moved.occuranceCount).toBe(2);

    lookupDown = true;

    const ready: Array<TelemetryExceptionPayload> =
      await ExceptionUtil.assignPayloadGroupFingerprints(
        [occurrence({})],
        NOW + 20 * MINUTE_MS,
      );

    expect(
      ready.map((each: TelemetryExceptionPayload) => {
        return each.fingerprint;
      }),
    ).toEqual([moved.fingerprint]);
  });

  test("what it knew to be absent never makes one: absent before, unknown after, it is held", async () => {
    // Read once: none of them existed then.
    await ExceptionUtil.resolveGroupFingerprints([
      {
        projectId: PROJECT_ID.toString(),
        v1: occurrence({}).fingerprint,
        v2: "made-elsewhere",
        candidates: [occurrence({}).fingerprint],
      },
    ]);

    lookupDown = true;

    const resolved: ResolvedGroups = await ExceptionUtil.resolveGroups(
      [candidateOf(occurrence({}))],
      NOW + 20 * MINUTE_MS,
    );

    expect(resolved.unknown.size).toBe(1);
    expect(resolved.chosen.size).toBe(0);
  });

  test("candidates this read knows in full are grouped as ever, though another of the project's could not be read", async () => {
    const existing: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v3,
      madeAt: MADE_SINCE_V2,
    });

    // SMS is read now, and known for ten minutes.
    await upsert([occurrence({})]);
    expect(lookups).toBe(1);

    lookupDown = true;

    const resolved: ResolvedGroups = await ExceptionUtil.resolveGroups([
      candidateOf(occurrence({})),
      candidateOf(occurrence({ content: OTHER_SMS })),
    ]);

    expect(Array.from(resolved.chosen.values())).toEqual([
      existing.fingerprint,
    ]);
    expect(Array.from(resolved.unknown.keys())).toEqual([
      groupFingerprintKey(candidateOf(occurrence({ content: OTHER_SMS }))),
    ]);
  });

  test("one project's failed read leaves another project's batch as it is", async () => {
    const existing: StoredException = seed({
      fingerprint: fingerprintsOf(SMS, OTHER_PROJECT_ID).v2,
      madeAt: MADE_SINCE_V2,
      projectId: OTHER_PROJECT_ID,
    });

    // The first project's read fails three times, the other's works.
    nextLookups = ["fail", "fail", "fail", "work"];

    await upsert([occurrence({}), occurrence({ projectId: OTHER_PROJECT_ID })]);

    expect(existing.occuranceCount).toBe(2);
    expect(HeldExceptionOccurrences.count()).toBe(1);
    expect(insertedByIngest).toEqual([]);
  });
});

function candidateOf(
  payload: TelemetryExceptionPayload,
): GroupFingerprintCandidate {
  return {
    projectId: payload.projectId.toString(),
    primaryEntityId: payload.primaryEntityId.toString(),
    v1: payload.fingerprint,
    v2: payload.fingerprintV2!,
    candidates: payload.fingerprintCandidates!,
  };
}

describe("how a failed read is tried again", () => {
  test("after each pause, at most three tries", async () => {
    const pauses: Array<number> = [];

    jest
      .spyOn(ExceptionUtil, "pauseBeforeLookupRetry")
      .mockImplementation(async (ms: number) => {
        pauses.push(ms);
      });
    lookupDown = true;

    await ExceptionUtil.resolveGroups([candidateOf(occurrence({}))]);

    expect(pauses).toEqual([...GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS]);
    expect(lookups).toBe(3);
  });

  test("the second try works: one pause", async () => {
    const pauses: Array<number> = [];

    jest
      .spyOn(ExceptionUtil, "pauseBeforeLookupRetry")
      .mockImplementation(async (ms: number) => {
        pauses.push(ms);
      });
    nextLookups = ["fail", "work"];

    const resolved: ResolvedGroups = await ExceptionUtil.resolveGroups([
      candidateOf(occurrence({})),
    ]);

    expect(pauses).toEqual([GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS[0]]);
    expect(resolved.unknown.size).toBe(0);
  });

  test("a read that took as long as the budget, as one that ran out the statement timeout does, is not tried again", async () => {
    let clock: number = NOW;

    jest.spyOn(Date, "now").mockImplementation(() => {
      return clock;
    });
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<unknown> => {
          lookups++;
          clock += GROUP_FINGERPRINT_LOOKUP_RETRY_BUDGET_MS;
          throw new Error("canceling statement due to statement timeout");
        },
      },
    } as never);

    const resolved: ResolvedGroups = await ExceptionUtil.resolveGroups(
      [candidateOf(occurrence({}))],
      NOW,
    );

    expect(lookups).toBe(1);
    expect(resolved.unknown.size).toBe(1);
  });

  test("the budget is the delays' and more: a fast failure is tried every time", () => {
    expect(
      GROUP_FINGERPRINT_LOOKUP_RETRY_DELAYS_MS.reduce(
        (total: number, ms: number) => {
          return total + ms;
        },
        0,
      ),
    ).toBeLessThan(GROUP_FINGERPRINT_LOOKUP_RETRY_BUDGET_MS);
  });

  test("the pause really waits", async () => {
    jest.restoreAllMocks();

    const started: number = Date.now();
    await ExceptionUtil.pauseBeforeLookupRetry(20);

    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});

describe("held occurrences, once the read works", () => {
  test("go with the next batch of their project", async () => {
    const existing: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v2,
      madeAt: MADE_SINCE_V2,
    });

    lookupDown = true;
    await upsert([occurrence({})]);
    lookupDown = false;

    await upsert([occurrence({})]);

    expect(existing.occuranceCount).toBe(3);
  });

  test("wait for HELD_OCCURRENCE_RETRY_MS when only another project's batches come, then go with any", async () => {
    const existing: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v2,
      madeAt: MADE_SINCE_V2,
    });

    lookupDown = true;
    await upsert([occurrence({})]);
    lookupDown = false;

    // Another project's batch, at once: this project's held one waits.
    await upsert([occurrence({ projectId: OTHER_PROJECT_ID })]);
    expect(existing.occuranceCount).toBe(1);

    // Once it has waited, from when it was held, another project's batch takes it along.
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + HELD_OCCURRENCE_RETRY_MS + 1000);
    await upsert([occurrence({ projectId: OTHER_PROJECT_ID })]);

    expect(existing.occuranceCount).toBe(2);
  });

  test("with no batch at all, a timer counts them after HELD_OCCURRENCE_RETRY_MS, and keeps no process alive", async () => {
    const existing: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v2,
      madeAt: MADE_SINCE_V2,
    });
    const timers: Array<{ run: () => void; ms: number; unref: jest.Mock }> = [];

    jest.spyOn(global, "setTimeout").mockImplementation(((
      run: () => void,
      ms: number,
    ) => {
      const timer: { run: () => void; ms: number; unref: jest.Mock } = {
        run,
        ms,
        unref: jest.fn(),
      };
      timers.push(timer);
      return timer;
    }) as never);
    const batches: jest.SpyInstance = jest.spyOn(
      ExceptionUtil,
      "saveOrUpdateTelemetryExceptionsBatch",
    );

    lookupDown = true;
    await upsert([occurrence({})]);

    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(HELD_OCCURRENCE_RETRY_MS);
    expect(timers[0]!.unref).toHaveBeenCalled();

    // One timer at a time, however many batches hold.
    await upsert([occurrence({})]);
    expect(timers).toHaveLength(1);

    lookupDown = false;
    // Once it has waited, from when it was held.
    jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + HELD_OCCURRENCE_RETRY_MS + 1000);
    timers[0]!.run();
    await batches.mock.results[batches.mock.results.length - 1]!.value;

    expect(existing.occuranceCount).toBe(3);
    expect(HeldExceptionOccurrences.isEmpty()).toBe(true);
  });

  test("are counted once: a batch that takes them leaves none behind to count again", async () => {
    const existing: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v2,
      madeAt: MADE_SINCE_V2,
    });

    lookupDown = true;
    await upsert([occurrence({}), occurrence({})]);
    lookupDown = false;

    for (let batch: number = 0; batch < 4; batch++) {
      await upsert([occurrence({})]);
    }

    expect(existing.occuranceCount).toBe(1 + 2 + 4);
  });

  test("an upsert of nothing, with nothing held, does nothing", async () => {
    await upsert([]);

    expect(lookups).toBe(0);
    expect(insertedByIngest).toEqual([]);
  });
});

/*
 * A DUPLICATE THE FALLBACK OF BEFORE #11027 MADE, MERGED BACK.
 *
 * The exception was made since grouping v2; one batch's read failed, and
 * its occurrences made a duplicate under v1, which has had every occurrence
 * since. Once an occurrence finds it while the read works, it is merged
 * into the exception it was split from, the older one kept, with no alert.
 */
describe.each(
  ERAS.filter((era: [string, keyof Fingerprints, number]) => {
    return era[1] !== "v1";
  }),
)(
  "a duplicate made under v1 of an exception made %s",
  (_era: string, version: keyof Fingerprints) => {
    let original: StoredException;
    let duplicate: StoredException;

    beforeEach(() => {
      original = seed({
        fingerprint: fingerprintsOf(SMS)[version],
        madeAt: MADE_SINCE_V2,
        count: 100,
      });
      duplicate = seed({
        fingerprint: fingerprintsOf(SMS).v1,
        madeAt: DUPLICATE_MADE,
        count: 40,
      });
    });

    test("is merged into it by the next occurrence, the older one kept, the occurrence counted on both", async () => {
      await upsert([occurrence({})]);

      expect(mergeCalls).toEqual([
        { survivor: original.fingerprint, merged: [duplicate.fingerprint] },
      ]);
      expect(duplicate.mergedInto).toBe(original.id);
      // Its own 40, the duplicate's 40 taken in, and the occurrence's copy.
      expect(original.occuranceCount).toBe(100 + 40 + 1);
      // The duplicate keeps counting its own, so an unmerge gives it back.
      expect(duplicate.occuranceCount).toBe(41);
      expect(exceptions()).toEqual([original]);
    });

    test("and no alert: nothing is made, the survivor's first seen is as it was, and the duplicate leaves the count", async () => {
      expect(newExceptionsAround(DUPLICATE_MADE)).toBe(1);

      await upsert([occurrence({})]);

      expect(insertedByIngest).toEqual([]);
      expect(original.firstSeenAt.getTime()).toBe(MADE_SINCE_V2);
      expect(newExceptionsAround(DUPLICATE_MADE)).toBe(0);
      expect(newExceptionsAround()).toBe(0);
    });

    test("once, whatever the batches that follow", async () => {
      for (let batch: number = 0; batch < 5; batch++) {
        await upsert([occurrence({}), occurrence({})]);
      }

      expect(mergeCalls).toHaveLength(1);
      expect(original.occuranceCount).toBe(100 + 40 + 10);
    });

    test("not while the read fails, even from what this process knew: once it works", async () => {
      const heals: jest.SpyInstance = jest.spyOn(
        ExceptionUtil,
        "healSplitByFailedLookup",
      );

      // Read twenty minutes ago, when the merge could not be made.
      mergeFails = true;
      await ExceptionUtil.resolveGroups(
        [candidateOf(occurrence({}))],
        NOW - 20 * MINUTE_MS,
      );
      expect(heals).toHaveBeenCalledTimes(1);
      mergeFails = false;

      // The read fails: the occurrence goes where this process knew, and nothing is merged.
      lookupDown = true;
      const resolved: ResolvedGroups = await ExceptionUtil.resolveGroups(
        [candidateOf(occurrence({}))],
        NOW,
      );

      expect(Array.from(resolved.chosen.values())).toEqual([
        duplicate.fingerprint,
      ]);
      expect(heals).toHaveBeenCalledTimes(1);
      expect(duplicate.mergedInto).toBeNull();

      // It works again: merged.
      lookupDown = false;
      await upsert([occurrence({})]);

      expect(heals).toHaveBeenCalledTimes(2);
      expect(mergeCalls).toHaveLength(1);
      expect(duplicate.mergedInto).toBe(original.id);
    });

    test("not while the read fails, when this process knew nothing: the occurrence waits, then the merge", async () => {
      lookupDown = true;
      await upsert([occurrence({})]);

      expect(mergeCalls).toEqual([]);
      expect(HeldExceptionOccurrences.count()).toBe(1);

      lookupDown = false;
      await upsert([occurrence({})]);

      expect(mergeCalls).toHaveLength(1);
      expect(duplicate.mergedInto).toBe(original.id);
      // Both occurrences counted on the duplicate, and copied to the survivor.
      expect(duplicate.occuranceCount).toBe(42);
      expect(original.occuranceCount).toBe(100 + 40 + 2);
      expect(insertedByIngest).toEqual([]);
    });

    test("found by the occurrences ClickHouse stores too, which go where they went", async () => {
      expect(await storeRows([row()])).toEqual([duplicate.fingerprint]);
      expect(mergeCalls).toHaveLength(1);
      expect(duplicate.mergedInto).toBe(original.id);
    });

    test("a merge that fails is tried again after ten minutes, not by every batch", async () => {
      mergeFails = true;

      await ExceptionUtil.resolveGroups([candidateOf(occurrence({}))], NOW);
      await ExceptionUtil.resolveGroups([candidateOf(occurrence({}))], NOW);

      expect(duplicate.mergedInto).toBeNull();

      mergeFails = false;
      await ExceptionUtil.resolveGroups(
        [candidateOf(occurrence({}))],
        NOW + 5 * MINUTE_MS,
      );
      expect(duplicate.mergedInto).toBeNull();

      await ExceptionUtil.resolveGroups(
        [candidateOf(occurrence({}))],
        NOW + 11 * MINUTE_MS,
      );
      expect(duplicate.mergedInto).toBe(original.id);
    });

    test("one a person took out of a merge is left as it is", async () => {
      unmergedByAPerson.add(duplicate.id);

      await upsert([occurrence({})]);

      expect(mergeCalls).toEqual([]);
      expect(duplicate.mergedInto).toBeNull();
    });

    test("one a person merged elsewhere is left as it is", async () => {
      const elsewhere: StoredException = seed({
        fingerprint: "e".repeat(64),
        madeAt: MADE_SINCE_V2,
      });
      duplicate.mergedInto = elsewhere.id;

      await upsert([occurrence({})]);

      expect(mergeCalls).toEqual([]);
      expect(duplicate.mergedInto).toBe(elsewhere.id);
    });
  },
);

describe("what is not a duplicate a failed lookup made", () => {
  test("an exception made before grouping v2, under v1, beside one made since under a later fingerprint: both kept", async () => {
    const before: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v1,
      madeAt: MADE_BEFORE_V2,
    });
    const since: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v4,
      madeAt: MADE_SINCE_V2,
    });

    await upsert([occurrence({})]);

    expect(mergeCalls).toEqual([]);
    expect(before.occuranceCount).toBe(2);
    expect(since.occuranceCount).toBe(1);
    expect(exceptions()).toHaveLength(2);
  });

  test("one found under a fingerprint after v1 is no duplicate, whatever exists after it", async () => {
    seed({ fingerprint: fingerprintsOf(SMS).v2, madeAt: DUPLICATE_MADE });
    seed({ fingerprint: fingerprintsOf(SMS).v4, madeAt: MADE_SINCE_V2 });

    await upsert([occurrence({})]);

    expect(mergeCalls).toEqual([]);
  });

  test("an exception under v1 with none after it is the exception", async () => {
    const only: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v1,
      madeAt: DUPLICATE_MADE,
    });

    await upsert([occurrence({})]);

    expect(mergeCalls).toEqual([]);
    expect(only.occuranceCount).toBe(2);
  });

  test("a merged-already duplicate is not merged again", async () => {
    const original: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v3,
      madeAt: MADE_SINCE_V2,
    });
    const duplicate: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v1,
      madeAt: DUPLICATE_MADE,
    });
    duplicate.mergedInto = original.id;

    await upsert([occurrence({})]);

    expect(mergeCalls).toEqual([]);
    // Counted on both, as any merged exception's occurrence is.
    expect(duplicate.occuranceCount).toBe(2);
    expect(original.occuranceCount).toBe(2);
  });

  test("the first exception tried after the duplicate is the one it is merged into, not a later one", async () => {
    const v2: StoredException = seed({
      fingerprint: fingerprintsOf(SMS).v2,
      madeAt: MADE_SINCE_V2,
    });
    seed({ fingerprint: fingerprintsOf(SMS).v4, madeAt: MADE_SINCE_V2 + 1000 });
    seed({ fingerprint: fingerprintsOf(SMS).v1, madeAt: DUPLICATE_MADE });

    await upsert([occurrence({})]);

    expect(mergeCalls).toEqual([
      { survivor: v2.fingerprint, merged: [fingerprintsOf(SMS).v1] },
    ]);
  });

  test("an exception whose age the read does not give is never taken for one", async () => {
    seed({ fingerprint: fingerprintsOf(SMS).v2, madeAt: MADE_SINCE_V2 });
    seed({ fingerprint: fingerprintsOf(SMS).v1, madeAt: DUPLICATE_MADE });

    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          if (sql === GROUP_FINGERPRINT_LOOKUP_SQL) {
            // As a read of before #11027 answered: no times.
            return (params[1] as Array<string>)
              .filter((fingerprint: string) => {
                return Boolean(under(fingerprint));
              })
              .map((fingerprint: string) => {
                return { fingerprint, movedTo: null };
              });
          }

          return [];
        },
      },
    } as never);

    await ExceptionUtil.resolveGroups([candidateOf(occurrence({}))]);

    expect(mergeCalls).toEqual([]);
  });
});
