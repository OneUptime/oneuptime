import {
  FanInInsertError,
  FanInInsertTarget,
  FanInSubmitResult,
  FanInWriterOptions,
  TelemetryFanInWriter,
  TransientInsertError,
  isRetryableInsertError,
  pushObservedAck,
  readFanInWriterOptionsFromEnv,
} from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { runWithInsertDedup } from "../../../../Server/Utils/AnalyticsDatabase/InsertDedupContext";
import { JSONObject } from "../../../../Types/JSON";
import { ClickHouseError, type ClickHouseSettings } from "@clickhouse/client";
import { describe, expect, test } from "@jest/globals";

/*
 * The fan-in writer is the single funnel between telemetry ingest jobs and
 * ClickHouse. These tests exercise the real class with tiny limits, real
 * (short) timers, an injectable no-op backoff sleep, and a fully mocked
 * insert target — no ClickHouse involved.
 */

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

type InsertRowsOptions = {
  dedupToken?: string | undefined;
  clickhouseSettings?: ClickHouseSettings | undefined;
};

type InsertImpl = (
  rows: Array<JSONObject>,
  options?: InsertRowsOptions,
) => Promise<void>;

interface TestTarget extends FanInInsertTarget {
  insertJsonRows: jest.Mock;
}

function makeTarget(data?: {
  tableName?: string;
  impl?: InsertImpl;
}): TestTarget {
  const impl: InsertImpl =
    data?.impl ??
    (async (): Promise<void> => {
      // durable by default
    });
  return {
    model: { tableName: data?.tableName ?? "TestTable" },
    insertJsonRows: jest.fn(impl),
  };
}

function makeOptions(
  overrides?: Partial<FanInWriterOptions>,
): FanInWriterOptions {
  const defaults: FanInWriterOptions = {
    maxBatchRows: 10,
    maxWaitMs: 20,
    maxConcurrentInserts: 4,
    maxPendingRows: 1000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    sleep: async (): Promise<void> => {
      // no-op backoff so retry tests are instant
    },
  };
  return { ...defaults, ...overrides };
}

function makeRows(count: number, offset: number = 0): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (let i: number = 0; i < count; i++) {
    rows.push({ seq: offset + i });
  }
  return rows;
}

function rowSeqs(rows: Array<JSONObject>): Array<number> {
  return rows.map((row: JSONObject) => {
    return row["seq"] as number;
  });
}

/** Rows the mock received on call `callIndex`. */
function callRows(target: TestTarget, callIndex: number): Array<JSONObject> {
  return target.insertJsonRows.mock.calls[callIndex]![0] as Array<JSONObject>;
}

/** Options the mock received on call `callIndex`. */
function callOptions(target: TestTarget, callIndex: number): InsertRowsOptions {
  return target.insertJsonRows.mock.calls[callIndex]![1] as InsertRowsOptions;
}

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: Error) => void;
};

function deferred(): Deferred {
  let resolveFn: () => void = () => {};
  let rejectFn: (err: Error) => void = () => {};
  const promise: Promise<void> = new Promise<void>(
    (resolve: () => void, reject: (err: Error) => void) => {
      resolveFn = resolve;
      rejectFn = reject;
    },
  );
  return { promise, resolve: resolveFn, reject: rejectFn };
}

/** Real-timer sleep — the writer itself uses real setTimeout. */
function tick(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

/**
 * True if the promise is still unsettled after `ms` of real time.
 * Also swallows rejections so unhandled-rejection warnings never fire.
 */
async function stillPendingAfter(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let pending: boolean = true;
  const mark: () => void = () => {
    pending = false;
  };
  promise.then(mark, mark);
  await tick(ms);
  return pending;
}

/** Await a promise that MUST reject; returns the rejection error. */
function captureRejection(promise: Promise<void>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("Expected the promise to reject, but it resolved.");
    },
    (err: Error) => {
      return err;
    },
  );
}

function clickHouseError(code: string, message?: string): ClickHouseError {
  return new ClickHouseError({
    message: message ?? `simulated server error with code ${code}`,
    code,
    type: "SIMULATED",
  });
}

/** Insert impl that fails `failures` times with `err`, then succeeds. */
function failNTimesImpl(failures: number, err: Error): InsertImpl {
  let calls: number = 0;
  return async (): Promise<void> => {
    calls++;
    if (calls <= failures) {
      throw err;
    }
  };
}

describe("TelemetryFanInWriter", () => {
  describe("flush triggers", () => {
    test("size-triggered flush: reaching maxBatchRows inserts immediately without waiting maxWaitMs", async () => {
      const target: TestTarget = makeTarget();
      // maxWaitMs is huge on purpose: if the flush waited for the timer, the test would time out.
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 5, maxWaitMs: 60_000 }),
      );

      const startedAt: number = Date.now();
      const first: FanInSubmitResult = await writer.submit(target, makeRows(2));
      const second: FanInSubmitResult = await writer.submit(
        target,
        makeRows(3, 2),
      );

      await Promise.all([first.flushed, second.flushed]);

      expect(Date.now() - startedAt).toBeLessThan(2000);
      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(rowSeqs(callRows(target, 0))).toEqual([0, 1, 2, 3, 4]);
      expect(writer.getStats()).toEqual({
        bufferedRows: 0,
        pendingRows: 0,
        activeInserts: 0,
      });
    });

    test("time-triggered flush: a below-threshold submission inserts after ~maxWaitMs", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 100, maxWaitMs: 25 }),
      );

      const startedAt: number = Date.now();
      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(3),
      );

      // Below threshold: nothing dispatched yet.
      expect(target.insertJsonRows).not.toHaveBeenCalled();
      expect(writer.getStats().bufferedRows).toBe(3);

      await result.flushed;

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(rowSeqs(callRows(target, 0))).toEqual([0, 1, 2]);
    });

    test("cross-submission batching: several small submissions collapse into one insert with all rows in order", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 100, maxWaitMs: 25 }),
      );

      const first: FanInSubmitResult = await writer.submit(target, makeRows(2));
      const second: FanInSubmitResult = await writer.submit(
        target,
        makeRows(3, 2),
      );
      const third: FanInSubmitResult = await writer.submit(
        target,
        makeRows(4, 5),
      );

      await Promise.all([first.flushed, second.flushed, third.flushed]);

      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(rowSeqs(callRows(target, 0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    test("a submission is never split: batch cut stops at maxBatchRows on submission boundaries", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 3, maxWaitMs: 15 }),
      );

      /*
       * 2 + 2 rows: the size trigger fires at 4 >= 3, but the second
       * submission does not fit in the first batch, so it flushes later
       * (via the timer) as its own batch.
       */
      const first: FanInSubmitResult = await writer.submit(target, makeRows(2));
      const second: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2, 2),
      );

      await Promise.all([first.flushed, second.flushed]);

      expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
      expect(rowSeqs(callRows(target, 0))).toEqual([0, 1]);
      expect(rowSeqs(callRows(target, 1))).toEqual([2, 3]);
    });

    test("oversized single submission (rows > maxBatchRows) inserts as one batch", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 3, maxWaitMs: 60_000 }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(8),
      );
      await result.flushed;

      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(rowSeqs(callRows(target, 0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    test("per-table isolation: two targets with different tableNames never share an insert", async () => {
      const targetA: TestTarget = makeTarget({ tableName: "TableA" });
      const targetB: TestTarget = makeTarget({ tableName: "TableB" });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 100, maxWaitMs: 60_000 }),
      );

      const fromA: FanInSubmitResult = await writer.submit(
        targetA,
        makeRows(3),
      );
      const fromB: FanInSubmitResult = await writer.submit(
        targetB,
        makeRows(2, 100),
      );

      await writer.flushAll();
      await Promise.all([fromA.flushed, fromB.flushed]);

      expect(targetA.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(targetB.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(rowSeqs(callRows(targetA, 0))).toEqual([0, 1, 2]);
      expect(rowSeqs(callRows(targetB, 0))).toEqual([100, 101]);

      const tokenA: string | undefined = callOptions(targetA, 0).dedupToken;
      const tokenB: string | undefined = callOptions(targetB, 0).dedupToken;
      expect(tokenA).toMatch(/^fanin:TableA:/);
      expect(tokenB).toMatch(/^fanin:TableB:/);
    });

    test("empty rows array: resolves immediately with zero insert calls", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions(),
      );

      const result: FanInSubmitResult = await writer.submit(target, []);
      await result.flushed;

      expect(target.insertJsonRows).not.toHaveBeenCalled();
      expect(writer.getStats()).toEqual({
        bufferedRows: 0,
        pendingRows: 0,
        activeInserts: 0,
      });
    });

    test("flushAll(): buffered below-threshold rows are flushed and awaited", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 100, maxWaitMs: 60_000 }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(3),
      );
      expect(target.insertJsonRows).not.toHaveBeenCalled();

      await writer.flushAll();

      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(rowSeqs(callRows(target, 0))).toEqual([0, 1, 2]);
      await result.flushed; // already settled — must not hang
      expect(writer.getStats()).toEqual({
        bufferedRows: 0,
        pendingRows: 0,
        activeInserts: 0,
      });
    });

    test("flushAll() with nothing buffered resolves immediately", async () => {
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions(),
      );
      await writer.flushAll();
      expect(writer.getStats()).toEqual({
        bufferedRows: 0,
        pendingRows: 0,
        activeInserts: 0,
      });
    });
  });

  describe("acks", () => {
    test("ack-after-flush: flushed stays pending until the insert resolves, then resolves", async () => {
      const gate: Deferred = deferred();
      const target: TestTarget = makeTarget({
        impl: (): Promise<void> => {
          return gate.promise;
        },
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 2, maxWaitMs: 60_000 }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
      );

      expect(await stillPendingAfter(result.flushed, 25)).toBe(true);
      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(writer.getStats().activeInserts).toBe(1);
      // Rows are in flight, not buffered — but still count against the high-water mark.
      expect(writer.getStats().bufferedRows).toBe(0);
      expect(writer.getStats().pendingRows).toBe(2);

      gate.resolve();
      await result.flushed;
      await writer.flushAll();
      expect(writer.getStats().activeInserts).toBe(0);
      expect(writer.getStats().pendingRows).toBe(0);
    });

    test("a batch failure rejects exactly the submissions in that batch; a later submission still succeeds", async () => {
      let shouldFail: boolean = true;
      const target: TestTarget = makeTarget({
        impl: async (): Promise<void> => {
          if (shouldFail) {
            throw clickHouseError("60", "Table does not exist");
          }
        },
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 4, maxWaitMs: 60_000 }),
      );

      const first: FanInSubmitResult = await writer.submit(target, makeRows(2));
      const second: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2, 2),
      );

      const [errFirst, errSecond]: [Error, Error] = await Promise.all([
        captureRejection(first.flushed),
        captureRejection(second.flushed),
      ]);

      expect(errFirst).toBeInstanceOf(FanInInsertError);
      expect(errFirst.name).toBe("FanInInsertError");
      expect(errFirst.message).toContain("TestTable");
      expect(errFirst.message).toContain("after 1 attempt(s)");
      expect(errFirst.message).toContain("Table does not exist");
      // Same batch → the very same error instance for every submission in it.
      expect(errSecond).toBe(errFirst);

      // The failed rows are gone from the pending count — no wedged capacity.
      expect(writer.getStats()).toEqual({
        bufferedRows: 0,
        pendingRows: 0,
        activeInserts: 0,
      });

      shouldFail = false;
      const third: FanInSubmitResult = await writer.submit(
        target,
        makeRows(4, 100),
      );
      await third.flushed;

      expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
      expect(rowSeqs(callRows(target, 1))).toEqual([100, 101, 102, 103]);
    });
  });

  describe("retries", () => {
    test("ClickHouseError code 202 is retried with the SAME dedup token until success", async () => {
      const target: TestTarget = makeTarget({
        impl: failNTimesImpl(
          2,
          clickHouseError(
            "202",
            "Too many simultaneous queries. Maximum: 1000",
          ),
        ),
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({
          maxBatchRows: 2,
          maxWaitMs: 60_000,
          retryMaxAttempts: 5,
        }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
      );
      await result.flushed;

      expect(target.insertJsonRows).toHaveBeenCalledTimes(3);

      const tokens: Array<string | undefined> = [0, 1, 2].map(
        (callIndex: number) => {
          return callOptions(target, callIndex).dedupToken;
        },
      );
      expect(tokens[0]).toMatch(/^fanin:TestTable:/);
      expect(tokens[1]).toBe(tokens[0]);
      expect(tokens[2]).toBe(tokens[0]);

      // Every attempt re-sends the identical row set.
      expect(rowSeqs(callRows(target, 0))).toEqual([0, 1]);
      expect(rowSeqs(callRows(target, 1))).toEqual([0, 1]);
      expect(rowSeqs(callRows(target, 2))).toEqual([0, 1]);
    });

    test("retry exhaustion: always-202 rejects flushed with FanInInsertError after retryMaxAttempts calls", async () => {
      const target: TestTarget = makeTarget({
        impl: async (): Promise<void> => {
          throw clickHouseError("202");
        },
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({
          maxBatchRows: 2,
          maxWaitMs: 60_000,
          retryMaxAttempts: 3,
        }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
      );
      const err: Error = await captureRejection(result.flushed);

      expect(err).toBeInstanceOf(FanInInsertError);
      expect(err.message).toContain("after 3 attempt(s)");
      expect(target.insertJsonRows).toHaveBeenCalledTimes(3);
      expect(writer.getStats().pendingRows).toBe(0);
    });

    test("non-retryable ClickHouse code (60) fails after exactly 1 attempt", async () => {
      const target: TestTarget = makeTarget({
        impl: async (): Promise<void> => {
          throw clickHouseError("60", "Unknown table");
        },
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({
          maxBatchRows: 2,
          maxWaitMs: 60_000,
          retryMaxAttempts: 5,
        }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
      );
      const err: Error = await captureRejection(result.flushed);

      expect(err).toBeInstanceOf(FanInInsertError);
      expect(err.message).toContain("after 1 attempt(s)");
      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
    });

    test("a plain error with no matching code or message fails after exactly 1 attempt", async () => {
      const target: TestTarget = makeTarget({
        impl: async (): Promise<void> => {
          throw new Error("schema mismatch: column type is wrong");
        },
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({
          maxBatchRows: 2,
          maxWaitMs: 60_000,
          retryMaxAttempts: 5,
        }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
      );
      const err: Error = await captureRejection(result.flushed);

      expect(err).toBeInstanceOf(FanInInsertError);
      expect(err.message).toContain("schema mismatch");
      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
    });

    test("plain Error('Timeout error.') is retried", async () => {
      const target: TestTarget = makeTarget({
        impl: failNTimesImpl(1, new Error("Timeout error.")),
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 2, maxWaitMs: 60_000 }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
      );
      await result.flushed;

      expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
    });

    test("Error with code ECONNRESET is retried", async () => {
      const socketError: Error = Object.assign(new Error("read ECONNRESET"), {
        code: "ECONNRESET",
      });
      const target: TestTarget = makeTarget({
        impl: failNTimesImpl(1, socketError),
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 2, maxWaitMs: 60_000 }),
      );

      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
      );
      await result.flushed;

      expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
      // Retry reused the same dedup token.
      expect(callOptions(target, 1).dedupToken).toBe(
        callOptions(target, 0).dedupToken,
      );
    });
  });

  describe("concurrency and backpressure", () => {
    test("semaphore: with maxConcurrentInserts 1, two ready tables never insert concurrently", async () => {
      let active: number = 0;
      let maxActive: number = 0;
      let firstCall: boolean = true;
      const gate: Deferred = deferred();

      const impl: InsertImpl = async (): Promise<void> => {
        active++;
        maxActive = Math.max(maxActive, active);
        if (firstCall) {
          firstCall = false;
          await gate.promise; // slow first insert holds the only slot
        } else {
          await tick(5);
        }
        active--;
      };

      const targetA: TestTarget = makeTarget({ tableName: "TableA", impl });
      const targetB: TestTarget = makeTarget({ tableName: "TableB", impl });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({
          maxBatchRows: 2,
          maxWaitMs: 60_000,
          maxConcurrentInserts: 1,
        }),
      );

      // Both tables hit the size trigger and are ready to insert simultaneously.
      const fromA: FanInSubmitResult = await writer.submit(
        targetA,
        makeRows(2),
      );
      const fromB: FanInSubmitResult = await writer.submit(
        targetB,
        makeRows(2),
      );

      await tick(25);
      expect(active).toBe(1);
      expect(targetA.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(targetB.insertJsonRows).not.toHaveBeenCalled();
      expect(writer.getStats().activeInserts).toBe(1);

      gate.resolve();
      await Promise.all([fromA.flushed, fromB.flushed]);

      expect(maxActive).toBe(1);
      expect(targetB.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(writer.getStats().activeInserts).toBe(0);
    });

    test("semaphore actually allows parallelism up to maxConcurrentInserts", async () => {
      let active: number = 0;
      let maxActive: number = 0;
      const gate: Deferred = deferred();

      const impl: InsertImpl = async (): Promise<void> => {
        active++;
        maxActive = Math.max(maxActive, active);
        await gate.promise;
        active--;
      };

      const targetA: TestTarget = makeTarget({ tableName: "TableA", impl });
      const targetB: TestTarget = makeTarget({ tableName: "TableB", impl });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({
          maxBatchRows: 2,
          maxWaitMs: 60_000,
          maxConcurrentInserts: 2,
        }),
      );

      const fromA: FanInSubmitResult = await writer.submit(
        targetA,
        makeRows(2),
      );
      const fromB: FanInSubmitResult = await writer.submit(
        targetB,
        makeRows(2),
      );

      await tick(15);
      expect(maxActive).toBe(2);

      gate.resolve();
      await Promise.all([fromA.flushed, fromB.flushed]);
    });

    test("backpressure: submit() acceptance blocks at maxPendingRows and resumes after the insert completes", async () => {
      const gate: Deferred = deferred();
      let blockedOnce: boolean = false;
      const target: TestTarget = makeTarget({
        impl: async (): Promise<void> => {
          if (!blockedOnce) {
            blockedOnce = true;
            await gate.promise;
          }
        },
      });
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({
          maxBatchRows: 5,
          maxWaitMs: 10,
          maxPendingRows: 5,
        }),
      );

      // Fills the high-water mark exactly and dispatches into the blocked insert.
      const first: FanInSubmitResult = await writer.submit(target, makeRows(5));
      expect(writer.getStats().pendingRows).toBe(5);

      let accepted: boolean = false;
      const secondAcceptance: Promise<FanInSubmitResult> = writer
        .submit(target, makeRows(3, 100))
        .then((result: FanInSubmitResult) => {
          accepted = true;
          return result;
        });

      await tick(30);
      expect(accepted).toBe(false);
      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);

      gate.resolve();
      const second: FanInSubmitResult = await secondAcceptance;
      expect(accepted).toBe(true);

      await first.flushed;
      await second.flushed;
      await writer.flushAll();

      expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
      expect(rowSeqs(callRows(target, 1))).toEqual([100, 101, 102]);
      expect(writer.getStats()).toEqual({
        bufferedRows: 0,
        pendingRows: 0,
        activeInserts: 0,
      });
    });
  });

  describe("dedup tokens and settings", () => {
    test("two different batches get different dedup tokens with the fanin:<table>: prefix", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 3, maxWaitMs: 60_000 }),
      );

      const first: FanInSubmitResult = await writer.submit(target, makeRows(3));
      await first.flushed;
      const second: FanInSubmitResult = await writer.submit(
        target,
        makeRows(3, 3),
      );
      await second.flushed;

      expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
      const tokenFirst: string | undefined = callOptions(target, 0).dedupToken;
      const tokenSecond: string | undefined = callOptions(target, 1).dedupToken;
      expect(tokenFirst).toMatch(/^fanin:TestTable:/);
      expect(tokenSecond).toMatch(/^fanin:TestTable:/);
      expect(tokenSecond).not.toBe(tokenFirst);
    });

    test("clickhouseSettings pass through to insertJsonRows", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 2, maxWaitMs: 60_000 }),
      );

      const settings: ClickHouseSettings = {
        async_insert: 1,
        wait_for_async_insert: 1,
      };
      const result: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
        { clickhouseSettings: settings },
      );
      await result.flushed;

      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(callOptions(target, 0).clickhouseSettings).toBe(settings);
    });

    test("a mixed batch applies the FIRST submission's clickhouseSettings", async () => {
      const target: TestTarget = makeTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        makeOptions({ maxBatchRows: 4, maxWaitMs: 60_000 }),
      );

      const settingsFirst: ClickHouseSettings = { async_insert: 1 };
      const settingsSecond: ClickHouseSettings = { async_insert: 0 };

      const first: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2),
        { clickhouseSettings: settingsFirst },
      );
      const second: FanInSubmitResult = await writer.submit(
        target,
        makeRows(2, 2),
        { clickhouseSettings: settingsSecond },
      );
      await Promise.all([first.flushed, second.flushed]);

      expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
      expect(callOptions(target, 0).clickhouseSettings).toBe(settingsFirst);
    });
  });
});

describe("isRetryableInsertError", () => {
  test.each([["202"], ["209"], ["210"], ["241"], ["252"], ["319"]])(
    "ClickHouseError code %s is retryable",
    (code: string) => {
      expect(isRetryableInsertError(clickHouseError(code))).toBe(true);
    },
  );

  test.each([["60"], ["81"], ["1000"], ["404"]])(
    "ClickHouseError code %s is NOT retryable",
    (code: string) => {
      expect(isRetryableInsertError(clickHouseError(code))).toBe(false);
    },
  );

  test.each([
    ["ECONNRESET"],
    ["ECONNREFUSED"],
    ["ECONNABORTED"],
    ["ETIMEDOUT"],
    ["EPIPE"],
    ["EAI_AGAIN"],
  ])("socket code %s on a plain Error is retryable", (code: string) => {
    const err: Error = Object.assign(new Error(`syscall failed: ${code}`), {
      code,
    });
    expect(isRetryableInsertError(err)).toBe(true);
  });

  test("unknown socket code (ENOENT) is not retryable", () => {
    const err: Error = Object.assign(new Error("no such file"), {
      code: "ENOENT",
    });
    expect(isRetryableInsertError(err)).toBe(false);
  });

  test("duck-typed numeric-string code on a plain Error follows the ClickHouse code list", () => {
    const retryable: Error = Object.assign(new Error("duplicated package"), {
      code: "202",
    });
    const notRetryable: Error = Object.assign(new Error("duplicated package"), {
      code: "57",
    });
    expect(isRetryableInsertError(retryable)).toBe(true);
    expect(isRetryableInsertError(notRetryable)).toBe(false);
  });

  test("a NUMERIC (non-string) code does not match and falls through to the message checks", () => {
    const err: Error = Object.assign(new Error("some failure"), { code: 202 });
    expect(isRetryableInsertError(err)).toBe(false);
  });

  test("plain Error('Timeout error.') is retryable", () => {
    expect(isRetryableInsertError(new Error("Timeout error."))).toBe(true);
  });

  test("message containing 'socket hang up' is retryable", () => {
    expect(isRetryableInsertError(new Error("socket hang up"))).toBe(true);
  });

  test("ordinary errors and non-errors are not retryable", () => {
    expect(isRetryableInsertError(new Error("something else"))).toBe(false);
    expect(isRetryableInsertError(null)).toBe(false);
    expect(isRetryableInsertError(undefined)).toBe(false);
    expect(isRetryableInsertError("Timeout error.")).toBe(false);
    expect(isRetryableInsertError(42)).toBe(false);
    expect(isRetryableInsertError({ code: "202" })).toBe(false);
  });
});

describe("FanInInsertError", () => {
  test("formats table, attempts, and an Error cause (with chained stack)", () => {
    const cause: Error = new Error("underlying failure");
    const err: FanInInsertError = new FanInInsertError({
      tableName: "MetricSum",
      attempts: 4,
      cause,
    });

    expect(err.name).toBe("FanInInsertError");
    expect(err.message).toBe(
      "Fan-in insert into MetricSum failed after 4 attempt(s): underlying failure",
    );
    expect(err.stack).toContain("Caused by:");
  });

  test("stringifies a non-Error cause", () => {
    const err: FanInInsertError = new FanInInsertError({
      tableName: "LogItems",
      attempts: 1,
      cause: "boom",
    });
    expect(err.message).toBe(
      "Fan-in insert into LogItems failed after 1 attempt(s): boom",
    );
  });
});

describe("readFanInWriterOptionsFromEnv", () => {
  const ENV_KEYS: Array<string> = [
    "TELEMETRY_FANIN_MAX_BATCH_ROWS",
    "TELEMETRY_FANIN_MAX_WAIT_MS",
    "TELEMETRY_FANIN_MAX_CONCURRENT_INSERTS",
    "TELEMETRY_FANIN_MAX_PENDING_ROWS",
    "TELEMETRY_FANIN_RETRY_MAX_ATTEMPTS",
    "TELEMETRY_FANIN_RETRY_BASE_DELAY_MS",
    "TELEMETRY_FANIN_RETRY_MAX_DELAY_MS",
  ];

  function withEnv(
    env: Record<string, string | undefined>,
    run: () => void,
  ): void {
    const saved: Record<string, string | undefined> = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
    try {
      for (const key of ENV_KEYS) {
        const value: string | undefined = env[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      run();
    } finally {
      for (const key of ENV_KEYS) {
        const value: string | undefined = saved[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  }

  test("returns documented defaults when nothing is set", () => {
    withEnv({}, () => {
      const options: FanInWriterOptions = readFanInWriterOptionsFromEnv();
      expect(options.maxBatchRows).toBe(5000);
      expect(options.maxWaitMs).toBe(1000);
      expect(options.maxConcurrentInserts).toBe(4);
      expect(options.maxPendingRows).toBe(100_000);
      expect(options.retryMaxAttempts).toBe(6);
      expect(options.retryBaseDelayMs).toBe(250);
      expect(options.retryMaxDelayMs).toBe(10_000);
    });
  });

  test("reads positive integer overrides from the environment", () => {
    withEnv(
      {
        TELEMETRY_FANIN_MAX_BATCH_ROWS: "123",
        TELEMETRY_FANIN_MAX_CONCURRENT_INSERTS: "2",
      },
      () => {
        const options: FanInWriterOptions = readFanInWriterOptionsFromEnv();
        expect(options.maxBatchRows).toBe(123);
        expect(options.maxConcurrentInserts).toBe(2);
        expect(options.maxWaitMs).toBe(1000); // untouched default
      },
    );
  });

  test("non-numeric, zero, and negative values fall back to defaults", () => {
    withEnv(
      {
        TELEMETRY_FANIN_MAX_BATCH_ROWS: "not-a-number",
        TELEMETRY_FANIN_MAX_WAIT_MS: "0",
        TELEMETRY_FANIN_MAX_PENDING_ROWS: "-5",
      },
      () => {
        const options: FanInWriterOptions = readFanInWriterOptionsFromEnv();
        expect(options.maxBatchRows).toBe(5000);
        expect(options.maxWaitMs).toBe(1000);
        expect(options.maxPendingRows).toBe(100_000);
      },
    );
  });
});

/*
 * The blocks below cover the adversarial-review rework: flushAll's re-cut
 * loop with the acceptingSubmits guard (rows that buffer only after the
 * drain begins must still be drained), the deterministic per-job dedup
 * tokens captured from runWithInsertDedup at submit time, and
 * pushObservedAck's pre-observed durability acks.
 */

describe("flushAll strand regressions", () => {
  test("capacity-parked submit: flushAll also drains rows that buffer only after its first pass releases capacity", async () => {
    const gate: Deferred = deferred();
    let firstInsertCall: boolean = true;
    const target: TestTarget = makeTarget({
      impl: async (): Promise<void> => {
        if (firstInsertCall) {
          firstInsertCall = false;
          await gate.promise;
        }
      },
    });
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({
        maxPendingRows: 5,
        maxBatchRows: 100,
        maxWaitMs: 60_000,
      }),
    );

    // A fills the high-water mark exactly and stays buffered (below maxBatchRows).
    const first: FanInSubmitResult = await writer.submit(target, makeRows(5));
    expect(target.insertJsonRows).not.toHaveBeenCalled();
    expect(writer.getStats().bufferedRows).toBe(5);

    // B parks in waitForCapacity — its rows are not buffered anywhere yet.
    let accepted: boolean = false;
    const secondAcceptance: Promise<FanInSubmitResult> = writer
      .submit(target, makeRows(3, 100))
      .then((result: FanInSubmitResult) => {
        accepted = true;
        return result;
      });

    let insertCallsWhenFlushAllResolved: number = -1;
    const flushPromise: Promise<void> = writer.flushAll().then((): void => {
      insertCallsWhenFlushAllResolved = target.insertJsonRows.mock.calls.length;
    });

    // flushAll dispatched A into the gated insert; B is still parked.
    await tick(25);
    expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
    expect(rowSeqs(callRows(target, 0))).toEqual([0, 1, 2, 3, 4]);
    expect(accepted).toBe(false);
    expect(await stillPendingAfter(flushPromise, 5)).toBe(true);

    /*
     * A lands → its dispatch releases capacity → B wakes and buffers its
     * rows WITHOUT creating a dispatch (3 < maxBatchRows; its flush timer
     * is 60s and unref'd). flushAll must re-cut and drain B too — this
     * previously stranded B's rows.
     */
    gate.resolve();
    await flushPromise;

    expect(insertCallsWhenFlushAllResolved).toBe(2);
    expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
    expect(rowSeqs(callRows(target, 1))).toEqual([100, 101, 102]);
    expect(writer.getStats().bufferedRows).toBe(0);

    // BOTH durability acks resolved — B's rows were not stranded.
    const second: FanInSubmitResult = await secondAcceptance;
    expect(accepted).toBe(true);
    await first.flushed;
    await second.flushed;
    expect(writer.getStats()).toEqual({
      bufferedRows: 0,
      pendingRows: 0,
      activeInserts: 0,
    });
  });

  test("un-awaited submit: flushAll waits out a submit still parked on its acceptance microtask", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 100, maxWaitMs: 60_000 }),
    );

    /*
     * No await between submit() and flushAll(): the submit has not yet
     * buffered its rows (it is parked on waitForCapacity's fast-path
     * microtask). flushAll previously concluded the drain before those
     * rows landed in the buffer, returning with them stranded.
     */
    const submitPromise: Promise<FanInSubmitResult> = writer.submit(
      target,
      makeRows(3),
    );
    await writer.flushAll();

    expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
    expect(rowSeqs(callRows(target, 0))).toEqual([0, 1, 2]);
    expect(writer.getStats().bufferedRows).toBe(0);

    const result: FanInSubmitResult = await submitPromise;
    await result.flushed;
    expect(writer.getStats()).toEqual({
      bufferedRows: 0,
      pendingRows: 0,
      activeInserts: 0,
    });
  });
});

describe("deterministic per-job dedup tokens (runWithInsertDedup)", () => {
  test("tokened submissions insert separately under '<jobId>:<table>:<chunkIndex>' and re-derive byte-identical tokens on a simulated BullMQ retry", async () => {
    type JobRunner = (
      writer: TelemetryFanInWriter,
      target: TestTarget,
    ) => Promise<Array<Promise<void>>>;

    /*
     * Simulates one queue job processing a fixed payload: chunk tokens are
     * a pure function of (jobId, table, submit order), so a retry that
     * re-processes the same payload must re-issue the same tokens.
     */
    const runIdenticalJob: JobRunner = async (
      writer: TelemetryFanInWriter,
      target: TestTarget,
    ): Promise<Array<Promise<void>>> => {
      const acks: Array<Promise<void>> = [];
      await runWithInsertDedup("job1", async (): Promise<void> => {
        acks.push((await writer.submit(target, makeRows(3))).flushed);
        acks.push((await writer.submit(target, makeRows(2, 3))).flushed);
      });
      return acks;
    };

    // First attempt: the second submit reaches maxBatchRows and triggers the flush.
    const firstTarget: TestTarget = makeTarget();
    const firstWriter: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 5, maxWaitMs: 60_000 }),
    );
    await Promise.all(await runIdenticalJob(firstWriter, firstTarget));

    // Two SEPARATE inserts — tokened submissions are never merged.
    expect(firstTarget.insertJsonRows).toHaveBeenCalledTimes(2);
    expect(rowSeqs(callRows(firstTarget, 0))).toEqual([0, 1, 2]);
    expect(rowSeqs(callRows(firstTarget, 1))).toEqual([3, 4]);
    const firstTokens: Array<string | undefined> = [0, 1].map(
      (callIndex: number) => {
        return callOptions(firstTarget, callIndex).dedupToken;
      },
    );
    expect(firstTokens).toEqual(["job1:TestTable:0", "job1:TestTable:1"]);

    // Simulated BullMQ retry: identical payload, fresh writer instance.
    const retryTarget: TestTarget = makeTarget();
    const retryWriter: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 5, maxWaitMs: 60_000 }),
    );
    await Promise.all(await runIdenticalJob(retryWriter, retryTarget));

    expect(retryTarget.insertJsonRows).toHaveBeenCalledTimes(2);
    const retryTokens: Array<string | undefined> = [0, 1].map(
      (callIndex: number) => {
        return callOptions(retryTarget, callIndex).dedupToken;
      },
    );
    // Byte-identical across retries — what lets ClickHouse drop duplicates.
    expect(retryTokens).toEqual(["job1:TestTable:0", "job1:TestTable:1"]);
    expect(retryTokens).toEqual(firstTokens);
  });

  test("mixed batch: tokened rows insert under their deterministic token; untokened rows under a minted fanin token", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 100, maxWaitMs: 60_000 }),
    );

    const acks: Array<Promise<void>> = [];
    await runWithInsertDedup("job2", async (): Promise<void> => {
      acks.push((await writer.submit(target, makeRows(2))).flushed);
    });
    acks.push((await writer.submit(target, makeRows(3, 100))).flushed);

    expect(target.insertJsonRows).not.toHaveBeenCalled();
    await writer.flushAll();
    await Promise.all(acks);

    expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
    // The tokened submission inserts first, alone, under its per-job token …
    expect(rowSeqs(callRows(target, 0))).toEqual([0, 1]);
    expect(callOptions(target, 0).dedupToken).toBe("job2:TestTable:0");
    // … and the untokened one inserts separately under a minted batch token.
    expect(rowSeqs(callRows(target, 1))).toEqual([100, 101, 102]);
    expect(callOptions(target, 1).dedupToken).toMatch(/^fanin:TestTable:/);
  });

  test("failure isolation: a non-retryable failure on one token group rejects only that group's ack", async () => {
    const target: TestTarget = makeTarget({
      impl: async (
        rows: Array<JSONObject>,
        options?: InsertRowsOptions,
      ): Promise<void> => {
        if (options?.dedupToken?.endsWith(":0")) {
          throw clickHouseError("60", `Unknown table (${rows.length} rows)`);
        }
      },
    });
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 100, maxWaitMs: 60_000 }),
    );

    const acks: Array<Promise<void>> = [];
    await runWithInsertDedup("job3", async (): Promise<void> => {
      acks.push((await writer.submit(target, makeRows(2))).flushed);
      acks.push((await writer.submit(target, makeRows(2, 2))).flushed);
    });

    // Handler attached BEFORE the flush so the rejection is always observed.
    const firstOutcome: Promise<Error> = captureRejection(acks[0]!);
    await writer.flushAll();

    const err: Error = await firstOutcome;
    expect(err).toBeInstanceOf(FanInInsertError);
    expect(err.message).toContain("after 1 attempt(s)");
    expect(err.message).toContain("Unknown table");

    // The sibling token group in the SAME batch still lands and resolves.
    await acks[1]!;
    expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
    expect(callOptions(target, 0).dedupToken).toBe("job3:TestTable:0");
    expect(callOptions(target, 1).dedupToken).toBe("job3:TestTable:1");
    expect(writer.getStats()).toEqual({
      bufferedRows: 0,
      pendingRows: 0,
      activeInserts: 0,
    });
  });

  test("tokened retry: transient 202 failures retry with the SAME deterministic token, never a fanin token", async () => {
    const target: TestTarget = makeTarget({
      impl: failNTimesImpl(
        2,
        clickHouseError("202", "Too many simultaneous queries. Maximum: 1000"),
      ),
    });
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({
        maxBatchRows: 2,
        maxWaitMs: 60_000,
        retryMaxAttempts: 5,
      }),
    );

    const acks: Array<Promise<void>> = [];
    await runWithInsertDedup("job4", async (): Promise<void> => {
      acks.push((await writer.submit(target, makeRows(2))).flushed);
    });
    await Promise.all(acks);

    expect(target.insertJsonRows).toHaveBeenCalledTimes(3);
    const tokens: Array<string | undefined> = [0, 1, 2].map(
      (callIndex: number) => {
        return callOptions(target, callIndex).dedupToken;
      },
    );
    expect(tokens).toEqual([
      "job4:TestTable:0",
      "job4:TestTable:0",
      "job4:TestTable:0",
    ]);
    expect(tokens[0]).not.toMatch(/^fanin:/);
    // Every attempt re-sends the identical row set.
    expect(rowSeqs(callRows(target, 2))).toEqual([0, 1]);
  });
});

describe("pushObservedAck", () => {
  class WrappedStorageError extends Error {
    public constructor(message: string) {
      super(message);
      this.name = "WrappedStorageError";
    }
  }

  test("a rejected flushed promise fires no unhandledRejection and delivers the wrapped error at the await point", async () => {
    const unhandledReasons: Array<unknown> = [];
    const onUnhandledRejection: (reason: unknown) => void = (
      reason: unknown,
    ): void => {
      unhandledReasons.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      const pendingAcks: Array<Promise<void>> = [];
      const flushed: Promise<void> = Promise.reject(
        new Error("insert definitively failed"),
      );

      pushObservedAck(pendingAcks, flushed, (err: Error): Error => {
        return new WrappedStorageError(
          `Telemetry write failed: ${err.message}`,
        );
      });
      expect(pendingAcks).toHaveLength(1);

      // An unobserved rejection would surface within a few macrotasks.
      await tick(30);
      expect(unhandledReasons).toEqual([]);

      // …but it is still delivered for real at the job's await point.
      const settled: Array<PromiseSettledResult<void>> =
        await Promise.allSettled(pendingAcks);
      const firstSettled: PromiseSettledResult<void> = settled[0]!;
      expect(firstSettled.status).toBe("rejected");
      if (firstSettled.status !== "rejected") {
        throw new Error("Expected the ack to be rejected.");
      }
      expect(firstSettled.reason).toBeInstanceOf(WrappedStorageError);
      expect((firstSettled.reason as Error).message).toBe(
        "Telemetry write failed: insert definitively failed",
      );
    } finally {
      process.removeListener("unhandledRejection", onUnhandledRejection);
    }
  });

  test("a resolved flushed promise pushes a resolving ack", async () => {
    const pendingAcks: Array<Promise<void>> = [];
    pushObservedAck(pendingAcks, Promise.resolve(), (err: Error): Error => {
      return new WrappedStorageError(err.message);
    });

    expect(pendingAcks).toHaveLength(1);
    await expect(Promise.all(pendingAcks)).resolves.toEqual([undefined]);
  });
});

describe("explicit dedup tokens (writer-tier passthrough)", () => {
  test("submit honors options.dedupToken outside any dedup scope", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );

    const submission: FanInSubmitResult = await writer.submit(
      target,
      makeRows(3),
      { dedupToken: "job-9:TestTable:2" },
    );
    await writer.flushAll();
    await submission.flushed;

    expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
    expect(callOptions(target, 0).dedupToken).toBe("job-9:TestTable:2");
  });

  test("explicit token wins over the ambient dedup context", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );

    await runWithInsertDedup("ambient-job", async (): Promise<void> => {
      await writer.submit(target, makeRows(2), {
        dedupToken: "explicit-token",
      });
    });
    await writer.flushAll();

    expect(callOptions(target, 0).dedupToken).toBe("explicit-token");
  });

  test("distinct explicit tokens in one batch insert individually", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 100 }),
    );

    await writer.submit(target, makeRows(2, 0), { dedupToken: "token-a" });
    await writer.submit(target, makeRows(2, 2), { dedupToken: "token-b" });
    await writer.flushAll();

    expect(target.insertJsonRows).toHaveBeenCalledTimes(2);
    expect(callOptions(target, 0).dedupToken).toBe("token-a");
    expect(callOptions(target, 1).dedupToken).toBe("token-b");
    expect(rowSeqs(callRows(target, 0))).toEqual([0, 1]);
    expect(rowSeqs(callRows(target, 1))).toEqual([2, 3]);
  });
});

describe("insert transport hook", () => {
  test("an installed transport replaces the direct insert and receives token + settings", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const transportCalls: Array<{
      tableName: string;
      rows: Array<JSONObject>;
      dedupToken: string;
      clickhouseSettings: ClickHouseSettings | undefined;
    }> = [];
    writer.setInsertTransport(
      async (
        transportTarget: FanInInsertTarget,
        rows: Array<JSONObject>,
        options: {
          dedupToken: string;
          clickhouseSettings: ClickHouseSettings | undefined;
        },
      ): Promise<void> => {
        transportCalls.push({
          tableName: transportTarget.model.tableName,
          rows,
          dedupToken: options.dedupToken,
          clickhouseSettings: options.clickhouseSettings,
        });
      },
    );

    const submission: FanInSubmitResult = await writer.submit(
      target,
      makeRows(2),
      {
        dedupToken: "remote-token",
        clickhouseSettings: { async_insert: 1 },
      },
    );
    await writer.flushAll();
    await submission.flushed;

    expect(target.insertJsonRows).not.toHaveBeenCalled();
    expect(transportCalls).toHaveLength(1);
    expect(transportCalls[0]!.tableName).toBe("TestTable");
    expect(transportCalls[0]!.dedupToken).toBe("remote-token");
    expect(transportCalls[0]!.clickhouseSettings).toEqual({ async_insert: 1 });
    expect(rowSeqs(transportCalls[0]!.rows)).toEqual([0, 1]);
  });

  test("TransientInsertError from the transport retries with the SAME token", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const seenTokens: Array<string> = [];
    let attempts: number = 0;
    writer.setInsertTransport(
      async (
        _transportTarget: FanInInsertTarget,
        _rows: Array<JSONObject>,
        options: {
          dedupToken: string;
          clickhouseSettings: ClickHouseSettings | undefined;
        },
      ): Promise<void> => {
        seenTokens.push(options.dedupToken);
        attempts++;
        if (attempts < 3) {
          throw new TransientInsertError("writer tier is shedding load (429)");
        }
      },
    );

    const submission: FanInSubmitResult = await writer.submit(
      target,
      makeRows(1),
      { dedupToken: "sticky-token" },
    );
    await writer.flushAll();
    await expect(submission.flushed).resolves.toBeUndefined();

    expect(seenTokens).toEqual([
      "sticky-token",
      "sticky-token",
      "sticky-token",
    ]);
  });

  test("a permanent transport error fails the ack after one attempt", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    let attempts: number = 0;
    writer.setInsertTransport(async (): Promise<void> => {
      attempts++;
      throw new Error("writer returned 400: unknown table");
    });

    const submission: FanInSubmitResult = await writer.submit(
      target,
      makeRows(1),
      { dedupToken: "token" },
    );
    await writer.flushAll();

    const err: Error = await captureRejection(submission.flushed);
    expect(err).toBeInstanceOf(FanInInsertError);
    expect(attempts).toBe(1);
  });

  test("clearing the transport restores the direct insert path", async () => {
    const target: TestTarget = makeTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    writer.setInsertTransport(async (): Promise<void> => {
      throw new Error("should not be used");
    });
    writer.setInsertTransport(null);
    expect(writer.hasInsertTransport()).toBe(false);

    const submission: FanInSubmitResult = await writer.submit(
      target,
      makeRows(1),
      { dedupToken: "token" },
    );
    await writer.flushAll();
    await submission.flushed;

    expect(target.insertJsonRows).toHaveBeenCalledTimes(1);
  });
});

describe("isRetryableInsertError — TransientInsertError", () => {
  test("TransientInsertError is retryable", () => {
    expect(isRetryableInsertError(new TransientInsertError("shed"))).toBe(true);
  });

  test("duck-typed TransientInsertError (duplicate module instance) is retryable", () => {
    const err: Error = new Error("shed");
    err.name = "TransientInsertError";
    expect(isRetryableInsertError(err)).toBe(true);
  });

  test("FanInInsertError keeps its structured cause", () => {
    const cause: TransientInsertError = new TransientInsertError("503");
    const err: FanInInsertError = new FanInInsertError({
      tableName: "T",
      attempts: 3,
      cause,
    });
    expect(err.causeError).toBe(cause);
    expect(isRetryableInsertError(err.causeError)).toBe(true);
  });
});
