/*
 * How a worker batch's exception occurrences become one upsert row per
 * exception group (ExceptionUtil.aggregateExceptions), and the statement that
 * writes them.
 *
 * The group's first and last seen are its occurrences' own times, so a
 * backed-up queue neither moves them forward nor reopens an exception
 * resolved after the occurrences happened. Its releases are the earliest and
 * latest occurrences' own: the batch used to keep whichever event came
 * first, which during a rollout is often the old release, as the release the
 * exception was "last seen in".
 *
 * What the statement does to an existing row - reopening, Regressed,
 * Resolve in next release - is executed against Postgres in
 * ExceptionRegressionPostgres.test.ts; here it is the batch.
 */
import ExceptionUtil, {
  AggregatedException,
  clampOccurrenceTime,
  MAX_OCCURRENCE_AGE_MS,
  REOPENS_RESOLVED_EXCEPTION_SQL,
  STAYS_RESOLVED_SQL,
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-10-30T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE_MS);
}

function occurrence(
  overrides: Partial<TelemetryExceptionPayload> = {},
): TelemetryExceptionPayload {
  return {
    fingerprint: "fp-checkout",
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    exceptionType: "TypeError",
    message: "Cannot read properties of undefined",
    stackTrace: "TypeError: x\n    at checkout (cart.js:10:5)",
    ...overrides,
  };
}

function onlyGroup(
  payloads: Array<TelemetryExceptionPayload>,
): AggregatedException {
  const groups: Map<string, AggregatedException> =
    ExceptionUtil.aggregateExceptions(payloads, NOW);

  expect(groups.size).toBe(1);

  return Array.from(groups.values())[0]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an occurrence's time", () => {
  test("is believed when it is in the last 30 days and not in the future", () => {
    expect(clampOccurrenceTime(minutesAgo(5), NOW)).toEqual(minutesAgo(5));
    expect(
      clampOccurrenceTime(
        new Date(NOW.getTime() - MAX_OCCURRENCE_AGE_MS + 1),
        NOW,
      ),
    ).toEqual(new Date(NOW.getTime() - MAX_OCCURRENCE_AGE_MS + 1));
  });

  test("the worker's own time stands in for a missing, future, ancient or broken one", () => {
    expect(clampOccurrenceTime(undefined, NOW)).toBe(NOW);
    expect(clampOccurrenceTime(minutesAgo(-1), NOW)).toBe(NOW);
    expect(clampOccurrenceTime(new Date(0), NOW)).toBe(NOW);
    expect(
      clampOccurrenceTime(
        new Date(NOW.getTime() - MAX_OCCURRENCE_AGE_MS - 1),
        NOW,
      ),
    ).toBe(NOW);
    expect(clampOccurrenceTime(new Date("not a date"), NOW)).toBe(NOW);
  });

  test("30 days is the limit", () => {
    expect(MAX_OCCURRENCE_AGE_MS).toBe(30 * 24 * 60 * MINUTE_MS);
  });
});

describe("one group per project, resource and fingerprint", () => {
  test("first and last seen are the earliest and latest occurrences, whatever order they arrive in", () => {
    const group: AggregatedException = onlyGroup([
      occurrence({ occurredAt: minutesAgo(3) }),
      occurrence({ occurredAt: minutesAgo(30) }),
      occurrence({ occurredAt: minutesAgo(1) }),
      occurrence({ occurredAt: minutesAgo(10) }),
    ]);

    expect(group.firstSeenAt).toEqual(minutesAgo(30));
    expect(group.lastSeenAt).toEqual(minutesAgo(1));
    expect(group.occuranceCount).toBe(4);
  });

  test("an occurrence without a time counts as now", () => {
    const group: AggregatedException = onlyGroup([
      occurrence({ occurredAt: minutesAgo(30) }),
      occurrence({}),
    ]);

    expect(group.firstSeenAt).toEqual(minutesAgo(30));
    expect(group.lastSeenAt).toEqual(NOW);
  });

  /*
   * Regression: the batch kept the FIRST event's release as the release the
   * group was last seen in. A rolling deploy's batch holds the old release
   * and the new one, and the new one is the one that matters.
   */
  test("the last seen release is the latest occurrence's, not the first to arrive", () => {
    const group: AggregatedException = onlyGroup([
      occurrence({ occurredAt: minutesAgo(5), release: "2.3.1" }),
      occurrence({ occurredAt: minutesAgo(1), release: "2.3.2" }),
      occurrence({ occurredAt: minutesAgo(3), release: "2.3.1" }),
    ]);

    expect(group.lastSeenInRelease).toBe("2.3.2");
    expect(group.firstSeenInRelease).toBe("2.3.1");
  });

  test("the first seen release is the earliest occurrence's, even when it arrives last", () => {
    const group: AggregatedException = onlyGroup([
      occurrence({ occurredAt: minutesAgo(2), release: "2.3.2" }),
      occurrence({ occurredAt: minutesAgo(9), release: "2.3.0" }),
    ]);

    expect(group.firstSeenInRelease).toBe("2.3.0");
    expect(group.lastSeenInRelease).toBe("2.3.2");
  });

  test("an occurrence that names no release never blanks one that did", () => {
    const group: AggregatedException = onlyGroup([
      occurrence({ occurredAt: minutesAgo(5), release: "2.3.1" }),
      occurrence({ occurredAt: minutesAgo(1) }),
      occurrence({ occurredAt: minutesAgo(30) }),
    ]);

    expect(group.firstSeenInRelease).toBe("2.3.1");
    expect(group.lastSeenInRelease).toBe("2.3.1");
    expect(group.firstSeenAt).toEqual(minutesAgo(30));
    expect(group.lastSeenAt).toEqual(minutesAgo(1));
  });

  test("occurrences at the same time keep the release that arrived first, as before", () => {
    const group: AggregatedException = onlyGroup([
      occurrence({ occurredAt: minutesAgo(1), release: "a" }),
      occurrence({ occurredAt: minutesAgo(1), release: "b" }),
    ]);

    expect(group.firstSeenInRelease).toBe("a");
    expect(group.lastSeenInRelease).toBe("a");
  });

  test("unhandled is sticky, and the first non-empty message, stack and type are kept", () => {
    const group: AggregatedException = onlyGroup([
      occurrence({ unhandled: false, message: "", stackTrace: "" }),
      occurrence({ unhandled: true, message: "second", stackTrace: "stack" }),
      occurrence({ unhandled: false, message: "third" }),
    ]);

    expect(group.unhandled).toBe(true);
    expect(group.message).toBe("second");
    expect(group.stackTrace).toBe("stack");
  });

  test("different fingerprints, resources or projects are different groups", () => {
    const groups: Map<string, AggregatedException> =
      ExceptionUtil.aggregateExceptions(
        [
          occurrence({}),
          occurrence({ fingerprint: "fp-other" }),
          occurrence({ primaryEntityId: ObjectID.generate() }),
          occurrence({ projectId: ObjectID.generate() }),
        ],
        NOW,
      );

    expect(groups.size).toBe(4);
  });

  test("a payload without its key is skipped, not fatal", () => {
    const groups: Map<string, AggregatedException> =
      ExceptionUtil.aggregateExceptions(
        [occurrence({ fingerprint: "" }), occurrence({})],
        NOW,
      );

    expect(groups.size).toBe(1);
  });
});

describe("the upsert statement", () => {
  test("carries each group's occurrence times and releases as its parameters", async () => {
    const calls: Array<{ sql: string; params: Array<unknown> }> = [];

    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string, params: Array<unknown>): Promise<void> => {
          // The upsert; the merged-exception lookup before it finds none.
          if (sql.includes("INSERT INTO")) {
            calls.push({ sql, params });
          }
        },
      },
    } as never);

    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([
      occurrence({ occurredAt: minutesAgo(9), release: "2.3.1" }),
      occurrence({ occurredAt: minutesAgo(2), release: "2.3.2" }),
    ]);

    expect(calls).toHaveLength(1);

    const params: Array<unknown> = calls[0]!.params;
    /*
     * projectId, primaryEntityId, fingerprint, message, stackTrace, type,
     * firstSeenAt, lastSeenAt, count, firstSeenInRelease, lastSeenInRelease.
     */
    expect(params[6]).toEqual(minutesAgo(9));
    expect(params[7]).toEqual(minutesAgo(2));
    expect(params[8]).toBe(2);
    expect(params[9]).toBe("2.3.1");
    expect(params[10]).toBe("2.3.2");
  });

  test("reopens a resolved row only as REOPENS_RESOLVED_EXCEPTION_SQL says, stamping regressedAt", async () => {
    const calls: Array<string> = [];

    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string): Promise<void> => {
          if (sql.includes("INSERT INTO")) {
            calls.push(sql);
          }
        },
      },
    } as never);

    await ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch([occurrence({})]);

    const sql: string = calls[0]!;

    expect(STAYS_RESOLVED_SQL).toContain(REOPENS_RESOLVED_EXCEPTION_SQL);
    expect(sql).toContain(`"isResolved" = ${STAYS_RESOLVED_SQL}`);
    expect(sql).toContain('"regressedAt" = CASE');
    expect(sql).toContain('"resolvedInReleaseAfter" = CASE');
    // Never the old unconditional reopen.
    expect(sql).not.toContain('"isResolved" = false');
    expect(sql).not.toContain('"markedAsResolvedAt" = NULL,');
  });
});
