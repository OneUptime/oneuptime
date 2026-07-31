import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";

/*
 * Contract under test — the thing that makes drop-filter drops visible.
 *
 * A drop filter used to discard telemetry with no record of any kind: no log
 * line, no metric, no counter, and the ingest path's own `totalLogsProcessed`
 * counted survivors only. So when a customer reported missing logs, there was
 * literally nothing to look at — support had to read the project's filter
 * rows out of Postgres and reason about what they would have matched.
 *
 * The recorder has two outputs for two audiences: an OTel counter for
 * whoever operates the instance, and persisted per-filter counters for the
 * customer. The hard constraint is that it sits on the PER-RECORD ingest
 * path, so it must batch: one atomic UPDATE per filter per flush window, no
 * matter how many records were dropped.
 */

interface RecordedMetric {
  count: number;
  attributes: Record<string, string>;
}

const recordedMetrics: Array<RecordedMetric> = [];
let metricThrows: boolean = false;

const logFlushCalls: Array<{
  id: string;
  count: number;
  lastDroppedAt?: Date | undefined;
}> = [];
const traceFlushCalls: Array<{ id: string; count: number }> = [];

let logFlushImpl: ((data: any) => Promise<void>) | null = null;
let traceFlushImpl: ((data: any) => Promise<void>) | null = null;

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getIngestDroppedCounter: (): unknown => {
        return {
          add: (count: number, attributes: Record<string, string>): void => {
            if (metricThrows) {
              throw new Error("meter provider not wired up");
            }
            recordedMetrics.push({ count, attributes });
          },
        };
      },
    },
  };
});

jest.mock("Common/Server/Services/LogDropFilterService", () => {
  return {
    __esModule: true,
    default: {
      addToDroppedCount: async (data: any): Promise<void> => {
        logFlushCalls.push({
          id: data.id.toString(),
          count: data.count,
          lastDroppedAt: data.lastDroppedAt,
        });
        if (logFlushImpl) {
          await logFlushImpl(data);
        }
      },
    },
  };
});

jest.mock("Common/Server/Services/TraceDropFilterService", () => {
  return {
    __esModule: true,
    default: {
      addToDroppedCount: async (data: any): Promise<void> => {
        traceFlushCalls.push({ id: data.id.toString(), count: data.count });
        if (traceFlushImpl) {
          await traceFlushImpl(data);
        }
      },
    },
  };
});

import {
  DropFilterSignal,
  FLUSH_INTERVAL_MS,
  flushDroppedCounts,
  getPendingDropCountForTests,
  recordDroppedRecord,
  resetDropRecorderForTests,
} from "../../FeatureSet/Telemetry/Utils/DropFilterDropRecorder";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LOG_FILTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_LOG_FILTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TRACE_FILTER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

// Lets the `void flushDroppedCounts()` fire-and-forget settle.
async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

function recordLogDrop(
  filterId: ObjectID = LOG_FILTER_ID,
  action: string = "drop",
): void {
  recordDroppedRecord({
    projectId: PROJECT_ID,
    filterId,
    signal: DropFilterSignal.Logs,
    action,
  });
}

describe("DropFilterDropRecorder", () => {
  beforeEach(() => {
    resetDropRecorderForTests();
    recordedMetrics.length = 0;
    logFlushCalls.length = 0;
    traceFlushCalls.length = 0;
    metricThrows = false;
    logFlushImpl = null;
    traceFlushImpl = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetDropRecorderForTests();
  });

  describe("metric emission", () => {
    test("emits one counter point per dropped record", () => {
      recordLogDrop();
      recordLogDrop();

      expect(recordedMetrics).toHaveLength(2);
      expect(recordedMetrics[0]!.count).toBe(1);
    });

    /*
     * The project and filter ids are the whole point. Without them the
     * counter says only "something dropped telemetry", which is exactly the
     * unanswerable state this replaces.
     */
    test("attributes identify the signal, action, project and filter", () => {
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: LOG_FILTER_ID,
        signal: DropFilterSignal.Logs,
        action: "sample",
      });

      expect(recordedMetrics[0]!.attributes).toEqual({
        "telemetry.signal": "logs",
        "oneuptime.drop_filter.action": "sample",
        "oneuptime.project.id": PROJECT_ID.toString(),
        "oneuptime.drop_filter.id": LOG_FILTER_ID.toString(),
      });
    });

    test("distinguishes the trace signal from the log signal", () => {
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: TRACE_FILTER_ID,
        signal: DropFilterSignal.Traces,
        action: "drop",
      });

      expect(recordedMetrics[0]!.attributes["telemetry.signal"]).toBe("traces");
    });

    test("carries an explicit count through to the metric", () => {
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: LOG_FILTER_ID,
        signal: DropFilterSignal.Logs,
        action: "drop",
        count: 7,
      });

      expect(recordedMetrics[0]!.count).toBe(7);
    });

    /*
     * Telemetry about telemetry must never break ingest. A partially booted
     * process with no meter provider is a normal state, not an error worth
     * failing an ingest batch over.
     */
    test("a broken meter provider does not stop the DB accumulation", () => {
      metricThrows = true;

      expect(() => {
        recordLogDrop();
      }).not.toThrow();

      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(1);
    });
  });

  describe("accumulation", () => {
    test("sums repeated drops for the same filter", () => {
      for (let i: number = 0; i < 5; i++) {
        recordLogDrop();
      }

      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(5);
    });

    test("keeps different filters separate", () => {
      recordLogDrop(LOG_FILTER_ID);
      recordLogDrop(OTHER_LOG_FILTER_ID);
      recordLogDrop(OTHER_LOG_FILTER_ID);

      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(1);
      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, OTHER_LOG_FILTER_ID),
      ).toBe(2);
    });

    /*
     * The two signals write to different tables, so an id colliding across
     * them must not merge their counts.
     */
    test("keeps the same id separate across signals", () => {
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: LOG_FILTER_ID,
        signal: DropFilterSignal.Logs,
        action: "drop",
      });
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: LOG_FILTER_ID,
        signal: DropFilterSignal.Traces,
        action: "drop",
      });

      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(1);
      expect(
        getPendingDropCountForTests(DropFilterSignal.Traces, LOG_FILTER_ID),
      ).toBe(1);
    });

    test("ignores a zero or negative count", () => {
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: LOG_FILTER_ID,
        signal: DropFilterSignal.Logs,
        action: "drop",
        count: 0,
      });
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: LOG_FILTER_ID,
        signal: DropFilterSignal.Logs,
        action: "drop",
        count: -5,
      });

      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(0);
      expect(recordedMetrics).toHaveLength(0);
    });
  });

  describe("flush", () => {
    /*
     * The batching guarantee: 250 dropped records become ONE update, not 250.
     * This is what keeps the recorder off the per-record IO path.
     */
    test("collapses many drops into a single update per filter", async () => {
      for (let i: number = 0; i < 250; i++) {
        recordLogDrop();
      }

      await flushDroppedCounts();

      expect(logFlushCalls).toHaveLength(1);
      expect(logFlushCalls[0]).toMatchObject({
        id: LOG_FILTER_ID.toString(),
        count: 250,
      });
    });

    test("routes each signal to its own service", async () => {
      recordLogDrop();
      recordDroppedRecord({
        projectId: PROJECT_ID,
        filterId: TRACE_FILTER_ID,
        signal: DropFilterSignal.Traces,
        action: "drop",
      });

      await flushDroppedCounts();

      expect(logFlushCalls).toEqual([
        expect.objectContaining({ id: LOG_FILTER_ID.toString(), count: 1 }),
      ]);
      expect(traceFlushCalls).toEqual([
        { id: TRACE_FILTER_ID.toString(), count: 1 },
      ]);
    });

    test("writes one update per distinct filter", async () => {
      recordLogDrop(LOG_FILTER_ID);
      recordLogDrop(OTHER_LOG_FILTER_ID);
      recordLogDrop(OTHER_LOG_FILTER_ID);

      await flushDroppedCounts();

      expect(logFlushCalls).toHaveLength(2);
      const byId: Record<string, number> = {};
      for (const call of logFlushCalls) {
        byId[call.id] = call.count;
      }
      expect(byId[LOG_FILTER_ID.toString()]).toBe(1);
      expect(byId[OTHER_LOG_FILTER_ID.toString()]).toBe(2);
    });

    test("passes a lastDroppedAt timestamp through", async () => {
      recordLogDrop();
      await flushDroppedCounts();

      expect(logFlushCalls[0]!.lastDroppedAt).toBeInstanceOf(Date);
    });

    test("empties the accumulator so counts are never written twice", async () => {
      recordLogDrop();
      await flushDroppedCounts();

      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(0);

      logFlushCalls.length = 0;
      await flushDroppedCounts();
      expect(logFlushCalls).toHaveLength(0);
    });

    /*
     * The reason the batch is taken out of the map BEFORE awaiting: a drop
     * that lands mid-flush belongs to the next window. Clearing after the
     * await would silently discard it.
     */
    test("a drop that lands during an in-flight flush is kept for the next one", async () => {
      let releaseFlush: () => void = (): void => {};
      const flushGate: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          releaseFlush = resolve;
        },
      );

      recordLogDrop();

      logFlushImpl = async (): Promise<void> => {
        await flushGate;
      };

      const inFlight: Promise<void> = flushDroppedCounts();
      await settle();

      // Lands while the first flush is still awaiting its UPDATE.
      recordLogDrop();

      releaseFlush();
      await inFlight;

      expect(logFlushCalls).toHaveLength(1);
      expect(logFlushCalls[0]!.count).toBe(1);
      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(1);

      logFlushImpl = null;
      await flushDroppedCounts();

      expect(logFlushCalls).toHaveLength(2);
      expect(logFlushCalls[1]!.count).toBe(1);
    });

    /*
     * The expected benign failure is a filter deleted between the drop and
     * the flush. It must not throw into ingest, and it must not stop the
     * other filters in the same batch from being written.
     */
    test("one filter failing does not throw or block the others", async () => {
      recordLogDrop(LOG_FILTER_ID);
      recordLogDrop(OTHER_LOG_FILTER_ID);

      logFlushImpl = async (data: any): Promise<void> => {
        if (data.id.toString() === LOG_FILTER_ID.toString()) {
          throw new Error("row was deleted");
        }
      };

      await expect(flushDroppedCounts()).resolves.toBeUndefined();

      // Both were attempted; the healthy one is not skipped.
      expect(logFlushCalls).toHaveLength(2);
    });

    test("does not retry a failed delta forever", async () => {
      recordLogDrop();

      logFlushImpl = async (): Promise<void> => {
        throw new Error("unwritable");
      };

      await flushDroppedCounts();

      /*
       * Putting the delta back would grow the map without bound on a
       * permanently unwritable row. The metric already carries the signal.
       */
      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(0);
    });

    test("is a no-op when nothing has been dropped", async () => {
      await expect(flushDroppedCounts()).resolves.toBeUndefined();
      expect(logFlushCalls).toHaveLength(0);
      expect(traceFlushCalls).toHaveLength(0);
    });
  });

  describe("throttle", () => {
    test("does not write to the database on every dropped record", async () => {
      for (let i: number = 0; i < 100; i++) {
        recordLogDrop();
      }
      await settle();

      expect(logFlushCalls).toHaveLength(0);
      expect(
        getPendingDropCountForTests(DropFilterSignal.Logs, LOG_FILTER_ID),
      ).toBe(100);
    });

    /*
     * The clock is seeded on the first drop rather than treating "never
     * flushed" as "long overdue" — otherwise the very first dropped record of
     * a process would trigger an immediate single-row UPDATE.
     */
    test("the first drop seeds the clock instead of flushing immediately", async () => {
      const start: number = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockReturnValue(start);

      recordLogDrop();
      await settle();

      expect(logFlushCalls).toHaveLength(0);
    });

    test("flushes once the interval has elapsed", async () => {
      const start: number = 1_700_000_000_000;
      const nowSpy: any = jest.spyOn(Date, "now").mockReturnValue(start);

      recordLogDrop(); // seeds the clock
      await settle();
      expect(logFlushCalls).toHaveLength(0);

      nowSpy.mockReturnValue(start + FLUSH_INTERVAL_MS + 1);
      recordLogDrop();
      await settle();

      expect(logFlushCalls).toHaveLength(1);
      expect(logFlushCalls[0]!.count).toBe(2);
    });

    test("does not flush before the interval has elapsed", async () => {
      const start: number = 1_700_000_000_000;
      const nowSpy: any = jest.spyOn(Date, "now").mockReturnValue(start);

      recordLogDrop();
      await settle();

      nowSpy.mockReturnValue(start + FLUSH_INTERVAL_MS - 1);
      recordLogDrop();
      await settle();

      expect(logFlushCalls).toHaveLength(0);
    });
  });
});
