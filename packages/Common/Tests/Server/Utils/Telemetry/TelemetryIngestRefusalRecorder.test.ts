import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryIngestRefusalRecorder, {
  MAX_PENDING_REFUSALS,
  REFUSAL_WRITE_DELAY_MS,
  REFUSAL_WRITE_INTERVAL_MS,
  TelemetryIngestRefusalCounter,
  getTelemetryIngestBillingRefusalReason,
  getTelemetryIngestRefusalKey,
  noteTelemetryIngestRefusalKey,
  recordTelemetryIngestBillingRefusal,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import TelemetryIngestionKeyRefusalService, {
  TelemetryIngestRefusalBatch,
} from "../../../../Server/Services/TelemetryIngestionKeyRefusalService";
import logger from "../../../../Server/Utils/Logger";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ProjectBlockedException from "../../../../Types/Exception/ProjectBlockedException";
import ObjectID from "../../../../Types/ObjectID";
import {
  TelemetryIngestRefusalReason,
  UNNAMED_TELEMETRY_INGEST_SURFACE,
} from "../../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * THE FENCE BETWEEN A FLOOD OF REFUSED REQUESTS AND THE DATABASE
 * (issue #6378).
 *
 * A refused sender keeps sending - an exporter retries, a collector flushes
 * every few seconds, a page loads again - so whatever counts refusals sits
 * on the hottest failure path the ingest endpoints have. What is pinned:
 *
 *   1. A FLOOD WRITES ONCE. However many refusals of one key, reason and
 *      surface arrive, the first write goes a second after the first of
 *      them, and the next not before five minutes after it.
 *   2. WRITES ARE BATCHED AND NEVER OVERLAP. Everything due goes in one
 *      write; a write in flight holds the next one back.
 *   3. NOTHING REACHES THE CALLER. Counting never throws and never waits;
 *      a write that fails is logged at most once a minute and lost.
 *   4. MEMORY IS BOUNDED. A cap on what is held, logged when it is hit.
 *   5. THE NUMBERS ARE RIGHT: each request counted once, in the right row,
 *      with the first and the latest time it was refused.
 *
 * Fake timers run the clock; the writer is a stub, so nothing here touches
 * Postgres (TelemetryIngestionKeyRefusalService.test.ts pins the SQL).
 */

jest.mock(
  "../../../../Server/Services/TelemetryIngestionKeyRefusalService",
  () => {
    return {
      __esModule: true,
      default: {
        addRefusals: jest.fn(),
      },
    };
  },
);

const T0: number = Date.parse("2026-11-09T10:00:00.000Z");

const KEY_A: ObjectID = new ObjectID("7c0f0000-0000-4000-8000-0000000000a1");
const KEY_B: ObjectID = new ObjectID("7c0f0000-0000-4000-8000-0000000000b1");
const PROJECT: ObjectID = new ObjectID("7c0f0000-0000-4000-8000-000000000001");

type WriterMock = jest.Mock<
  (batches: Array<TelemetryIngestRefusalBatch>) => Promise<void>
>;

interface Harness {
  counter: TelemetryIngestRefusalCounter;
  writer: WriterMock;
  // Each write the counter made, in order, and when it started.
  writes: Array<Array<TelemetryIngestRefusalBatch>>;
  startedAt: Array<number>;
}

function makeHarness(
  answer?: (batches: Array<TelemetryIngestRefusalBatch>) => Promise<void>,
): Harness {
  const writes: Array<Array<TelemetryIngestRefusalBatch>> = [];
  const startedAt: Array<number> = [];
  const writer: WriterMock = jest.fn(
    (batches: Array<TelemetryIngestRefusalBatch>): Promise<void> => {
      writes.push(batches);
      startedAt.push(Date.now());
      return answer ? answer(batches) : Promise.resolve();
    },
  );

  return {
    counter: new TelemetryIngestRefusalCounter(writer),
    writer,
    writes,
    startedAt,
  };
}

/*
 * Run the promise callbacks a write queues (the writer's answer, its
 * failure log, the next timer). Microtasks only: this environment (jsdom)
 * has no setImmediate, and the timers are fake.
 */
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
}

// Move the clock on, firing the timers on the way, and let writes settle.
async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

function refuse(
  counter: TelemetryIngestRefusalCounter,
  data?: {
    key?: ObjectID;
    reason?: TelemetryIngestRefusalReason;
    surface?: TelemetryIngestSurface | null;
    times?: number;
  },
): void {
  const times: number = data?.times ?? 1;

  for (let index: number = 0; index < times; index++) {
    counter.record({
      projectId: PROJECT,
      ingestionKeyId: data?.key || KEY_A,
      reason: data?.reason || TelemetryIngestRefusalReason.KeyDisabled,
      surface:
        data?.surface === undefined
          ? TelemetryIngestSurface.OtelTraces
          : data.surface,
    });
  }
}

function totalCount(writes: Array<Array<TelemetryIngestRefusalBatch>>): number {
  let total: number = 0;

  for (const write of writes) {
    for (const batch of write) {
      total += batch.count;
    }
  }

  return total;
}

function summary(batch: TelemetryIngestRefusalBatch): Record<string, unknown> {
  return {
    key: batch.telemetryIngestionKeyId.toString(),
    project: batch.projectId.toString(),
    reason: batch.reason,
    surface: batch.surface,
    count: batch.count,
    first: batch.firstRefusedAt.getTime() - T0,
    last: batch.lastRefusedAt.getTime() - T0,
  };
}

let warn: jest.SpiedFunction<typeof logger.warn>;

beforeEach(() => {
  jest.useFakeTimers({
    now: T0,
    doNotFake: ["nextTick", "queueMicrotask"],
  });
  warn = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  TelemetryIngestRefusalRecorder.reset();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("TelemetryIngestRefusalCounter: a flood writes once", () => {
  test("the first refusal is written a second later, not on the request", async () => {
    const harness: Harness = makeHarness();

    refuse(harness.counter);

    // Never on the request itself.
    expect(harness.writer).not.toHaveBeenCalled();

    await advance(REFUSAL_WRITE_DELAY_MS - 1);
    expect(harness.writer).not.toHaveBeenCalled();

    await advance(1);
    expect(
      harness.writes.map((write: Array<TelemetryIngestRefusalBatch>) => {
        return write.map(summary);
      }),
    ).toEqual([
      [
        {
          key: KEY_A.toString(),
          project: PROJECT.toString(),
          reason: TelemetryIngestRefusalReason.KeyDisabled,
          surface: TelemetryIngestSurface.OtelTraces,
          count: 1,
          first: 0,
          last: 0,
        },
      ],
    ]);
    expect(harness.counter.getPendingCount()).toBe(0);
  });

  test("10,000 refusals in a burst are one write of 10,000", async () => {
    const harness: Harness = makeHarness();

    refuse(harness.counter, { times: 10_000 });
    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writer).toHaveBeenCalledTimes(1);
    expect(harness.writes[0]!.map(summary)).toEqual([
      expect.objectContaining({ count: 10_000, first: 0, last: 0 }),
    ]);

    // Nothing more is written when nothing more is refused.
    await advance(REFUSAL_WRITE_INTERVAL_MS * 3);
    expect(harness.writer).toHaveBeenCalledTimes(1);
  });

  test("refusals after the first write wait out the interval, then go as one", async () => {
    const harness: Harness = makeHarness();

    refuse(harness.counter);
    await advance(REFUSAL_WRITE_DELAY_MS); // written at T0 + 1s

    await advance(1000);
    refuse(harness.counter, { times: 5000 }); // T0 + 2s

    await advance(4 * 60 * 1000 - 2000);
    refuse(harness.counter, { times: 5000 }); // T0 + 4min

    // Still inside the interval since the first write: nothing new.
    await advance(60 * 1000 + REFUSAL_WRITE_DELAY_MS - 1);
    expect(harness.writer).toHaveBeenCalledTimes(1);

    // Five minutes after the first write.
    await advance(1);
    expect(harness.writer).toHaveBeenCalledTimes(2);
    expect(harness.writes[1]!.map(summary)).toEqual([
      expect.objectContaining({
        count: 10_000,
        first: 2000,
        last: 4 * 60 * 1000,
      }),
    ]);
  });

  test("an hour of steady refusals is at most two writes per five minutes, and every one is counted", async () => {
    const harness: Harness = makeHarness();
    const hour: number = 60 * 60 * 1000;

    // 100 refusals every ten seconds, for an hour: 36,000 requests.
    for (let elapsed: number = 0; elapsed < hour; elapsed += 10_000) {
      refuse(harness.counter, { times: 100 });
      await advance(10_000);
    }

    await harness.counter.flushAll();

    expect(totalCount(harness.writes)).toBe(36_000);

    /*
     * The first a second in, then one per interval, then the final flush:
     * 13 writes for 36,000 refused requests.
     */
    expect(
      harness.startedAt.map((at: number): number => {
        return at - T0;
      }),
    ).toEqual([
      ...Array.from({ length: 12 }, (_value: unknown, index: number) => {
        return REFUSAL_WRITE_DELAY_MS + index * REFUSAL_WRITE_INTERVAL_MS;
      }),
      hour,
    ]);
  });

  test("a key refused again after a quiet interval is written a second later again", async () => {
    const harness: Harness = makeHarness();

    refuse(harness.counter);
    await advance(REFUSAL_WRITE_DELAY_MS);

    await advance(REFUSAL_WRITE_INTERVAL_MS + 60_000);
    refuse(harness.counter);
    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writer).toHaveBeenCalledTimes(2);
  });
});

describe("TelemetryIngestRefusalCounter: one row per key, reason and surface", () => {
  test("each key, reason and surface is counted apart, and what is due goes in one write", async () => {
    const harness: Harness = makeHarness();

    refuse(harness.counter, { times: 3 });
    refuse(harness.counter, { surface: TelemetryIngestSurface.OtelLogs });
    refuse(harness.counter, {
      reason: TelemetryIngestRefusalReason.KeyRequestsPerMinute,
      times: 2,
    });
    refuse(harness.counter, { key: KEY_B });

    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writer).toHaveBeenCalledTimes(1);
    expect(
      harness.writes[0]!.map((batch: TelemetryIngestRefusalBatch) => {
        return [
          batch.telemetryIngestionKeyId.toString(),
          batch.reason,
          batch.surface,
          batch.count,
        ];
      }),
    ).toEqual([
      [
        KEY_A.toString(),
        TelemetryIngestRefusalReason.KeyDisabled,
        TelemetryIngestSurface.OtelTraces,
        3,
      ],
      [
        KEY_A.toString(),
        TelemetryIngestRefusalReason.KeyDisabled,
        TelemetryIngestSurface.OtelLogs,
        1,
      ],
      [
        KEY_A.toString(),
        TelemetryIngestRefusalReason.KeyRequestsPerMinute,
        TelemetryIngestSurface.OtelTraces,
        2,
      ],
      [
        KEY_B.toString(),
        TelemetryIngestRefusalReason.KeyDisabled,
        TelemetryIngestSurface.OtelTraces,
        1,
      ],
    ]);
  });

  test("the legacy guard, which names no surface, is counted as unnamed", async () => {
    const harness: Harness = makeHarness();

    refuse(harness.counter, { surface: null });
    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writes[0]![0]!.surface).toBe(
      UNNAMED_TELEMETRY_INGEST_SURFACE,
    );
  });

  test("a refusal without a project or a key counts nothing", async () => {
    const harness: Harness = makeHarness();

    harness.counter.record({
      projectId: undefined as unknown as ObjectID,
      ingestionKeyId: KEY_A,
      reason: TelemetryIngestRefusalReason.KeyDisabled,
      surface: TelemetryIngestSurface.OtelTraces,
    });
    harness.counter.record({
      projectId: PROJECT,
      ingestionKeyId: null as unknown as ObjectID,
      reason: TelemetryIngestRefusalReason.KeyDisabled,
      surface: TelemetryIngestSurface.OtelTraces,
    });

    expect(harness.counter.getPendingCount()).toBe(0);

    await advance(REFUSAL_WRITE_INTERVAL_MS);
    expect(harness.writer).not.toHaveBeenCalled();
  });

  test("a count that falls due sooner pulls the timer forward; the waiting one keeps its turn", async () => {
    const harness: Harness = makeHarness();

    refuse(harness.counter); // A, written at T0 + 1s
    await advance(REFUSAL_WRITE_DELAY_MS);

    refuse(harness.counter); // A again: due at T0 + 1s + 5min
    await advance(1000);
    refuse(harness.counter, { key: KEY_B }); // B, never written: due now

    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(
      harness.writes.map((write: Array<TelemetryIngestRefusalBatch>) => {
        return write.map((batch: TelemetryIngestRefusalBatch) => {
          return batch.telemetryIngestionKeyId.toString();
        });
      }),
    ).toEqual([[KEY_A.toString()], [KEY_B.toString()]]);

    await advance(REFUSAL_WRITE_INTERVAL_MS - 2 * REFUSAL_WRITE_DELAY_MS - 1);
    expect(harness.writer).toHaveBeenCalledTimes(2);

    await advance(1);
    expect(harness.writes[2]!.map(summary)).toEqual([
      expect.objectContaining({ key: KEY_A.toString(), count: 1 }),
    ]);
  });

  test("dropping the oldest marks keeps memory bounded, and only lets a count go sooner", async () => {
    const harness: Harness = makeHarness();
    const keys: Array<ObjectID> = [];

    for (let index: number = 0; index <= MAX_PENDING_REFUSALS; index++) {
      keys.push(ObjectID.generate());
    }

    // MAX_PENDING_REFUSALS keys in one write...
    for (const key of keys.slice(0, MAX_PENDING_REFUSALS)) {
      refuse(harness.counter, { key });
    }
    await advance(REFUSAL_WRITE_DELAY_MS);

    // ...and one more a second later, which pushes the oldest mark out.
    refuse(harness.counter, { key: keys[MAX_PENDING_REFUSALS]! });
    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(harness.writer).toHaveBeenCalledTimes(2);

    // The first key lost its mark: written a second later, not five minutes.
    refuse(harness.counter, { key: keys[0]! });
    // A key that kept its mark waits its interval out.
    refuse(harness.counter, { key: keys[MAX_PENDING_REFUSALS - 1]! });
    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writer).toHaveBeenCalledTimes(3);
    expect(
      harness.writes[2]!.map((batch: TelemetryIngestRefusalBatch) => {
        return batch.telemetryIngestionKeyId.toString();
      }),
    ).toEqual([keys[0]!.toString()]);
    expect(harness.counter.getPendingCount()).toBe(1);
  });
});

describe("TelemetryIngestRefusalCounter: writes never overlap", () => {
  test("a write in flight holds the next one back; what fell due goes when it ends", async () => {
    let finishFirst: () => void = () => {};
    let calls: number = 0;
    const harness: Harness = makeHarness((): Promise<void> => {
      calls += 1;

      if (calls === 1) {
        return new Promise<void>((resolve: () => void) => {
          finishFirst = resolve;
        });
      }

      return Promise.resolve();
    });

    refuse(harness.counter);
    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(harness.writer).toHaveBeenCalledTimes(1);

    // B falls due while A's write hangs: its timer fires, and waits.
    refuse(harness.counter, { key: KEY_B });
    await advance(REFUSAL_WRITE_DELAY_MS * 5);
    expect(harness.writer).toHaveBeenCalledTimes(1);
    expect(harness.counter.getPendingCount()).toBe(1);

    finishFirst();
    await settle();
    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writer).toHaveBeenCalledTimes(2);
    expect(harness.writes[1]![0]!.telemetryIngestionKeyId.toString()).toBe(
      KEY_B.toString(),
    );
  });

  test("writes start at least a second apart however refusals arrive", async () => {
    const harness: Harness = makeHarness();
    const startedAt: Array<number> = harness.startedAt;

    // A new key every 100ms for ten seconds: each one due at once.
    for (let index: number = 0; index < 100; index++) {
      refuse(harness.counter, { key: ObjectID.generate() });
      await advance(100);
    }

    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(totalCount(harness.writes)).toBe(100);

    for (let index: number = 1; index < startedAt.length; index++) {
      expect(startedAt[index]! - startedAt[index - 1]!).toBeGreaterThanOrEqual(
        REFUSAL_WRITE_DELAY_MS,
      );
    }
  });

  test("flushAll writes what is held, due or not, after the write in flight", async () => {
    let finishFirst: () => void = () => {};
    let calls: number = 0;
    const harness: Harness = makeHarness((): Promise<void> => {
      calls += 1;

      if (calls === 1) {
        return new Promise<void>((resolve: () => void) => {
          finishFirst = resolve;
        });
      }

      return Promise.resolve();
    });

    refuse(harness.counter);
    await advance(REFUSAL_WRITE_DELAY_MS);

    // Not due for five minutes.
    refuse(harness.counter, { times: 4 });

    let flushed: boolean = false;
    const flush: Promise<void> = harness.counter.flushAll().then(() => {
      flushed = true;
    });

    await settle();
    expect(flushed).toBe(false);
    expect(harness.writer).toHaveBeenCalledTimes(1);

    finishFirst();
    await flush;

    expect(harness.writer).toHaveBeenCalledTimes(2);
    expect(harness.writes[1]!.map(summary)).toEqual([
      expect.objectContaining({ count: 4 }),
    ]);
    expect(harness.counter.getPendingCount()).toBe(0);
  });
});

describe("TelemetryIngestRefusalCounter: nothing reaches the caller", () => {
  test("a write that fails is lost and logged, at most once a minute", async () => {
    const harness: Harness = makeHarness((): Promise<void> => {
      return Promise.reject(new Error("database unavailable"));
    });

    refuse(harness.counter);
    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writer).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "TelemetryIngestRefusalRecorder: could not write refused telemetry counts",
    );
    expect(harness.counter.getPendingCount()).toBe(0);

    const logged: number = warn.mock.calls.length;

    // Another failure ten seconds later: not logged again.
    await advance(10_000);
    refuse(harness.counter, { key: KEY_B });
    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(harness.writer).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.length).toBe(logged);

    // A minute on, it is.
    await advance(60_000);
    refuse(harness.counter, {
      key: KEY_B,
      surface: TelemetryIngestSurface.OtelLogs,
    });
    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(harness.writer).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls.length).toBeGreaterThan(logged);
  });

  test("a writer that throws instead of rejecting is handled the same", async () => {
    const harness: Harness = makeHarness();

    harness.writer.mockImplementation((): Promise<void> => {
      throw new Error("thrown, not rejected");
    });

    expect(() => {
      refuse(harness.counter);
    }).not.toThrow();

    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(harness.writer).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "TelemetryIngestRefusalRecorder: could not write refused telemetry counts",
    );

    // And the counter keeps working.
    harness.writer.mockImplementation((): Promise<void> => {
      return Promise.resolve();
    });
    refuse(harness.counter, { key: KEY_B });
    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(harness.writer).toHaveBeenCalledTimes(2);
  });

  test("record() never throws, whatever it is given", () => {
    const harness: Harness = makeHarness();

    expect(() => {
      harness.counter.record({
        projectId: PROJECT,
        ingestionKeyId: {
          toString: (): string => {
            throw new Error("broken id");
          },
        } as unknown as ObjectID,
        reason: TelemetryIngestRefusalReason.KeyDisabled,
        surface: TelemetryIngestSurface.OtelTraces,
      });
    }).not.toThrow();

    expect(warn).toHaveBeenCalledWith(
      "TelemetryIngestRefusalRecorder: could not count a refusal",
    );
  });
});

describe("TelemetryIngestRefusalCounter: what it holds is bounded", () => {
  test("past MAX_PENDING_REFUSALS counts, a new one is dropped and logged once a minute; held ones still count", async () => {
    const harness: Harness = makeHarness();

    for (let index: number = 0; index < MAX_PENDING_REFUSALS; index++) {
      refuse(harness.counter, { key: ObjectID.generate() });
    }
    expect(harness.counter.getPendingCount()).toBe(MAX_PENDING_REFUSALS);

    refuse(harness.counter, { key: KEY_A });
    refuse(harness.counter, { key: KEY_B });
    expect(harness.counter.getPendingCount()).toBe(MAX_PENDING_REFUSALS);

    const overflowLines: Array<unknown> = warn.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(call[0]).includes("refusal counts are waiting");
      },
    );
    expect(overflowLines).toHaveLength(1);

    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(harness.writer).toHaveBeenCalledTimes(1);
    expect(harness.writes[0]).toHaveLength(MAX_PENDING_REFUSALS);
    expect(
      harness.writes[0]!.some((batch: TelemetryIngestRefusalBatch) => {
        return batch.telemetryIngestionKeyId.toString() === KEY_A.toString();
      }),
    ).toBe(false);

    // Room again once they are written.
    refuse(harness.counter, { key: KEY_A });
    expect(harness.counter.getPendingCount()).toBe(1);
  });
});

describe("billing refusals: the key the exception was thrown for", () => {
  test("a noted exception gives back its key; anything else gives none", () => {
    const err: PaymentRequiredException = new PaymentRequiredException(
      "Payment required",
    );

    expect(getTelemetryIngestRefusalKey(err)).toBeNull();

    noteTelemetryIngestRefusalKey(err, {
      projectId: PROJECT,
      ingestionKeyId: KEY_A,
    });

    expect(getTelemetryIngestRefusalKey(err)).toEqual({
      projectId: PROJECT,
      ingestionKeyId: KEY_A,
    });

    // Another exception, a string, nothing: no key.
    expect(
      getTelemetryIngestRefusalKey(new PaymentRequiredException("Other")),
    ).toBeNull();
    noteTelemetryIngestRefusalKey("not an object", {
      projectId: PROJECT,
      ingestionKeyId: KEY_A,
    });
    expect(getTelemetryIngestRefusalKey("not an object")).toBeNull();
    expect(getTelemetryIngestRefusalKey(null)).toBeNull();
    expect(getTelemetryIngestRefusalKey(undefined)).toBeNull();
  });

  test("a blocked project and a missing payment method are their own reasons; other errors none", () => {
    expect(
      getTelemetryIngestBillingRefusalReason(new ProjectBlockedException()),
    ).toBe(TelemetryIngestRefusalReason.ProjectBlocked);
    expect(
      getTelemetryIngestBillingRefusalReason(
        new PaymentRequiredException("Payment required"),
      ),
    ).toBe(TelemetryIngestRefusalReason.PaymentRequired);

    // A 403 that is not a block is not a billing refusal.
    expect(
      getTelemetryIngestBillingRefusalReason(
        new ForbiddenException("Forbidden"),
      ),
    ).toBeNull();
    expect(
      getTelemetryIngestBillingRefusalReason(new BadDataException("Bad")),
    ).toBeNull();
    expect(getTelemetryIngestBillingRefusalReason(new Error("x"))).toBeNull();
    expect(getTelemetryIngestBillingRefusalReason(undefined)).toBeNull();
  });

  test("recordTelemetryIngestBillingRefusal counts a noted billing exception on the surface it was thrown on", async () => {
    const harness: Harness = makeHarness();
    const blocked: ProjectBlockedException = new ProjectBlockedException();

    noteTelemetryIngestRefusalKey(blocked, {
      projectId: PROJECT,
      ingestionKeyId: KEY_B,
    });

    expect(
      recordTelemetryIngestBillingRefusal({
        err: blocked,
        surface: TelemetryIngestSurface.OtelMetrics,
        counter: harness.counter,
      }),
    ).toBe(true);

    await advance(REFUSAL_WRITE_DELAY_MS);
    expect(harness.writes[0]!.map(summary)).toEqual([
      expect.objectContaining({
        key: KEY_B.toString(),
        project: PROJECT.toString(),
        reason: TelemetryIngestRefusalReason.ProjectBlocked,
        surface: TelemetryIngestSurface.OtelMetrics,
        count: 1,
      }),
    ]);
  });

  test("recordTelemetryIngestBillingRefusal counts nothing without a noted key or a billing reason", async () => {
    const harness: Harness = makeHarness();

    // A billing exception nobody noted a key on: an unknown key's, say.
    expect(
      recordTelemetryIngestBillingRefusal({
        err: new PaymentRequiredException("Payment required"),
        surface: TelemetryIngestSurface.OtelTraces,
        counter: harness.counter,
      }),
    ).toBe(false);

    // A noted exception that is not about billing.
    const other: BadDataException = new BadDataException("Bad payload");
    noteTelemetryIngestRefusalKey(other, {
      projectId: PROJECT,
      ingestionKeyId: KEY_A,
    });
    expect(
      recordTelemetryIngestBillingRefusal({
        err: other,
        surface: TelemetryIngestSurface.OtelTraces,
        counter: harness.counter,
      }),
    ).toBe(false);

    expect(harness.counter.getPendingCount()).toBe(0);
    await advance(REFUSAL_WRITE_INTERVAL_MS);
    expect(harness.writer).not.toHaveBeenCalled();
  });

  test("the shared recorder writes through TelemetryIngestionKeyRefusalService.addRefusals", async () => {
    const addRefusals: jest.Mock =
      TelemetryIngestionKeyRefusalService.addRefusals as unknown as jest.Mock;
    addRefusals.mockImplementation(() => {
      return Promise.resolve();
    });

    TelemetryIngestRefusalRecorder.record({
      projectId: PROJECT,
      ingestionKeyId: KEY_A,
      reason: TelemetryIngestRefusalReason.OriginNotAllowed,
      surface: TelemetryIngestSurface.SessionReplay,
    });
    await advance(REFUSAL_WRITE_DELAY_MS);

    expect(addRefusals).toHaveBeenCalledTimes(1);
    expect(
      (addRefusals.mock.calls[0]![0] as Array<TelemetryIngestRefusalBatch>).map(
        summary,
      ),
    ).toEqual([
      expect.objectContaining({
        key: KEY_A.toString(),
        reason: TelemetryIngestRefusalReason.OriginNotAllowed,
        surface: TelemetryIngestSurface.SessionReplay,
        count: 1,
      }),
    ]);
  });
});
