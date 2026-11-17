import {
  FanInInsertTarget,
  FanInSubmitResult,
  FanInWriterOptions,
  TelemetryFanInWriter,
  readFanInWriterOptionsFromEnv,
} from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHEN THE FAN-IN WRITER INSERTS (#6086).
 *
 * A telemetry job waits for ClickHouse to take its rows before it completes,
 * holding one of the worker's TELEMETRY_CONCURRENCY slots, so a job waits as
 * long as its rows do. Every table used to wait TELEMETRY_FANIN_MAX_WAIT_MS
 * (5 s) from its first row: one App, 100 slots, finished about 22 OTLP
 * batches a second, each job waiting about 4.5 s, its CPU half idle.
 *
 * Now every table is due once flushAtSubmissions submissions (four fifths
 * of TELEMETRY_CONCURRENCY) wait in the writer, and goes when an insert slot
 * is free for it. With every slot busy - a slow ClickHouse - a due table
 * keeps gathering and goes with the next slot that frees, or at maxWaitMs,
 * so ClickHouse still gets fewer, fuller inserts when it is struggling; and
 * a quiet worker still sends one insert a table per maxWaitMs. These tests
 * run the real class on fake timers with a mocked insert target.
 * ---------------------------------------------------------------------------
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

interface Insert {
  rows: Array<JSONObject>;
  at: number;
}

interface TestTarget extends FanInInsertTarget {
  inserts: Array<Insert>;
  // When set, each insert waits for it before it is taken.
  hold: Promise<void> | null;
  // When set, each insert takes this long (fake time) to be taken.
  latencyMs: number;
}

let now: number = 0;

function makeTarget(tableName: string): TestTarget {
  const target: TestTarget = {
    model: { tableName: tableName },
    inserts: [],
    hold: null,
    latencyMs: 0,
    insertJsonRows: async (rows: Array<JSONObject>): Promise<void> => {
      target.inserts.push({ rows: rows, at: now });
      if (target.hold) {
        await target.hold;
      }
      if (target.latencyMs > 0) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, target.latencyMs);
        });
      }
    },
  };
  return target;
}

function makeOptions(
  overrides?: Partial<FanInWriterOptions>,
): FanInWriterOptions {
  return {
    maxBatchRows: 1000,
    maxWaitMs: 5000,
    flushAtSubmissions: 4,
    maxConcurrentInserts: 4,
    maxPendingRows: 100_000,
    retryMaxAttempts: 3,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    sleep: async (): Promise<void> => {
      // no backoff
    },
    ...overrides,
  };
}

function makeRows(count: number, offset: number = 0): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (let i: number = 0; i < count; i++) {
    rows.push({ seq: offset + i });
  }
  return rows;
}

function seqs(insert: Insert | undefined): Array<number> {
  return (insert?.rows || []).map((row: JSONObject) => {
    return row["seq"] as number;
  });
}

function times(target: TestTarget): Array<number> {
  return target.inserts.map((insert: Insert) => {
    return insert.at;
  });
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/*
 * Moves fake time on in steps, letting the promises each step settles run
 * before the next (Jest 28 has no advanceTimersByTimeAsync).
 */
async function advance(ms: number, stepMs: number = 10): Promise<void> {
  for (let elapsed: number = 0; elapsed < ms; elapsed += stepMs) {
    const step: number = Math.min(stepMs, ms - elapsed);
    now += step;
    jest.advanceTimersByTime(step);
    await settle();
  }
}

function released(): {
  promise: Promise<void>;
  release: () => void;
} {
  let release: () => void = () => {};
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    release = resolve;
  });
  return { promise, release };
}

// Takes the writer's only insert slot and keeps it until released.
async function holdTheOnlySlot(writer: TelemetryFanInWriter): Promise<{
  release: () => void;
  slow: TestTarget;
}> {
  const slow: TestTarget = makeTarget("Slow");
  const hold: { promise: Promise<void>; release: () => void } = released();
  slow.hold = hold.promise;
  await writer.submit(slow, makeRows(1), { due: true });
  await settle();
  expect(slow.inserts).toHaveLength(1);
  return { release: hold.release, slow };
}

beforeEach(() => {
  now = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("TelemetryFanInWriter inserts once flushAtSubmissions submissions wait", () => {
  test("below flushAtSubmissions a table waits maxWaitMs, as it always did", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const target: TestTarget = makeTarget("Logs");

    const first: FanInSubmitResult = await writer.submit(target, makeRows(2));
    await advance(1000);
    await writer.submit(target, makeRows(1, 2));
    await writer.submit(target, makeRows(1, 3));

    let acked: boolean = false;
    void first.flushed.then(() => {
      acked = true;
    });

    await advance(3990, 30);
    expect(target.inserts).toHaveLength(0);
    expect(acked).toBe(false);

    await advance(10);
    expect(times(target)).toEqual([5000]);
    expect(seqs(target.inserts[0])).toEqual([0, 1, 2, 3]);
    expect(acked).toBe(true);
  });

  test("the submission that reaches it sends every table at once, each as one insert of all its rows in order", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const logs: TestTarget = makeTarget("Logs");
    const spans: TestTarget = makeTarget("Spans");

    const acks: Array<Promise<void>> = [];
    acks.push((await writer.submit(logs, makeRows(3, 0))).flushed);
    await advance(100);
    acks.push((await writer.submit(spans, makeRows(1, 100))).flushed);
    acks.push((await writer.submit(logs, makeRows(2, 3))).flushed);
    await advance(100);
    expect(logs.inserts).toHaveLength(0);
    expect(spans.inserts).toHaveLength(0);

    acks.push((await writer.submit(spans, makeRows(2, 101))).flushed);
    await settle();

    expect(times(logs)).toEqual([200]);
    expect(seqs(logs.inserts[0])).toEqual([0, 1, 2, 3, 4]);
    expect(times(spans)).toEqual([200]);
    expect(seqs(spans.inserts[0])).toEqual([100, 101, 102]);
    await expect(Promise.all(acks)).resolves.toBeDefined();
  });

  test("the count starts again after a flush, and the window with it", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const target: TestTarget = makeTarget("Logs");

    for (let i: number = 0; i < 4; i++) {
      await writer.submit(target, makeRows(1, i));
    }
    await settle();
    expect(target.inserts).toHaveLength(1);

    await advance(500);
    for (let i: number = 4; i < 7; i++) {
      await writer.submit(target, makeRows(1, i));
    }
    await settle();
    expect(target.inserts).toHaveLength(1);

    await writer.submit(target, makeRows(1, 7));
    await settle();
    expect(times(target)).toEqual([0, 500]);
    expect(seqs(target.inserts[1])).toEqual([4, 5, 6, 7]);

    // No window left over from the flushed rows.
    await advance(5000, 50);
    expect(target.inserts).toHaveLength(2);
  });

  test("submissions a full batch took leave the count", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 3, flushAtSubmissions: 2 }),
    );
    const logs: TestTarget = makeTarget("Logs");
    const spans: TestTarget = makeTarget("Spans");

    // A full batch on its own: cut at once.
    await writer.submit(logs, makeRows(3));
    await settle();
    expect(logs.inserts).toHaveLength(1);

    // One submission waits now, not two.
    await writer.submit(spans, makeRows(1));
    await settle();
    expect(spans.inserts).toHaveLength(0);

    await writer.submit(spans, makeRows(1, 1));
    await settle();
    expect(seqs(spans.inserts[0])).toEqual([0, 1]);
  });

  test("with every insert slot busy, a due table keeps gathering and goes with the next free slot, as one insert", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1, flushAtSubmissions: 2 }),
    );
    const { release } = await holdTheOnlySlot(writer);
    const logs: TestTarget = makeTarget("Logs");

    const first: FanInSubmitResult = await writer.submit(logs, makeRows(3, 0));
    const second: FanInSubmitResult = await writer.submit(logs, makeRows(2, 3));
    await advance(300);
    // Due, but no slot: still gathering.
    expect(logs.inserts).toHaveLength(0);

    const third: FanInSubmitResult = await writer.submit(logs, makeRows(1, 5));
    await advance(100);
    expect(logs.inserts).toHaveLength(0);

    release();
    await settle();

    expect(logs.inserts).toHaveLength(1);
    expect(seqs(logs.inserts[0])).toEqual([0, 1, 2, 3, 4, 5]);
    await expect(first.flushed).resolves.toBeUndefined();
    await expect(second.flushed).resolves.toBeUndefined();
    await expect(third.flushed).resolves.toBeUndefined();

    // Its turn over, the table is due again like any other, the slot free.
    await advance(100);
    await writer.submit(logs, makeRows(1, 6));
    await writer.submit(logs, makeRows(1, 7));
    await settle();
    expect(times(logs)).toEqual([400, 500]);
    expect(seqs(logs.inserts[1])).toEqual([6, 7]);
  });

  test("...or at maxWaitMs, when no slot frees before then: cut there, it waits for a slot as before", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({
        maxConcurrentInserts: 1,
        maxWaitMs: 1000,
        flushAtSubmissions: 2,
      }),
    );
    const { release } = await holdTheOnlySlot(writer);
    const logs: TestTarget = makeTarget("Logs");

    await writer.submit(logs, makeRows(1, 0));
    await writer.submit(logs, makeRows(1, 1));
    await advance(990);
    await writer.submit(logs, makeRows(1, 2));
    await advance(10);

    // Cut at maxWaitMs: rows after it are a batch of their own.
    await writer.submit(logs, makeRows(1, 3));
    expect(logs.inserts).toHaveLength(0);

    release();
    await settle();

    expect(logs.inserts).toHaveLength(1);
    expect(seqs(logs.inserts[0])).toEqual([0, 1, 2]);

    await advance(1000);
    expect(logs.inserts).toHaveLength(2);
    expect(seqs(logs.inserts[1])).toEqual([3]);
  });

  test("a table due at its first row, every slot busy, is still cut at maxWaitMs", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({
        maxConcurrentInserts: 1,
        maxWaitMs: 1000,
        flushAtSubmissions: 1,
      }),
    );
    const { release } = await holdTheOnlySlot(writer);
    const logs: TestTarget = makeTarget("Logs");

    await writer.submit(logs, makeRows(1, 0));
    await advance(1000);
    // Cut at maxWaitMs and queued for the slot; this row starts anew.
    await writer.submit(logs, makeRows(1, 1));

    release();
    await settle();
    await advance(10);

    expect(logs.inserts.map(seqs)).toEqual([[0], [1]]);
  });

  test("tables due while every slot is busy get one in the order they became due", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1, flushAtSubmissions: 1 }),
    );
    const { release } = await holdTheOnlySlot(writer);
    const order: Array<string> = [];
    const spans: TestTarget = makeTarget("Spans");
    const logs: TestTarget = makeTarget("Logs");

    const recordOrder: (target: TestTarget) => void = (
      target: TestTarget,
    ): void => {
      const insert: FanInInsertTarget["insertJsonRows"] =
        target.insertJsonRows.bind(target);
      target.insertJsonRows = async (rows: Array<JSONObject>) => {
        order.push(target.model.tableName);
        await insert(rows);
      };
    };
    recordOrder(spans);
    recordOrder(logs);

    await writer.submit(spans, makeRows(1));
    await advance(50);
    await writer.submit(logs, makeRows(1));
    await advance(300);
    expect(order).toEqual([]);

    release();
    await settle();
    await advance(10);

    expect(order).toEqual(["Spans", "Logs"]);
  });

  test("flushAll() inserts a table that waits for a slot", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1, flushAtSubmissions: 1 }),
    );
    const { release } = await holdTheOnlySlot(writer);
    const logs: TestTarget = makeTarget("Logs");

    await writer.submit(logs, makeRows(2));
    await advance(300);
    expect(logs.inserts).toHaveLength(0);

    const flushed: Promise<void> = writer.flushAll();
    release();
    await settle();
    await flushed;

    expect(logs.inserts).toHaveLength(1);
    expect(writer.getStats()).toEqual({
      bufferedRows: 0,
      pendingRows: 0,
      activeInserts: 0,
    });
  });

  test("with no flushAtSubmissions, rows wait for maxBatchRows or maxWaitMs, as they always did", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ flushAtSubmissions: undefined, maxWaitMs: 5000 }),
    );
    const target: TestTarget = makeTarget("Logs");

    for (let i: number = 0; i < 50; i++) {
      await writer.submit(target, makeRows(1, i));
    }
    await advance(4990, 50);
    expect(target.inserts).toHaveLength(0);
    await advance(10);
    expect(times(target)).toEqual([5000]);
    expect(target.inserts[0]!.rows).toHaveLength(50);
  });
});

describe("a due submission (the telemetry-writer tier's)", () => {
  test("is inserted as soon as a slot is free, without waiting for more rows; other tables keep waiting", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const logs: TestTarget = makeTarget("Logs");
    const spans: TestTarget = makeTarget("Spans");

    await writer.submit(logs, makeRows(1, 0));
    await advance(100);
    const due: FanInSubmitResult = await writer.submit(spans, makeRows(2, 10), {
      dedupToken: "worker-batch-1",
      due: true,
    });
    await settle();

    expect(times(spans)).toEqual([100]);
    expect(seqs(spans.inserts[0])).toEqual([10, 11]);
    await expect(due.flushed).resolves.toBeUndefined();
    expect(logs.inserts).toHaveLength(0);

    await advance(4900, 50);
    expect(times(logs)).toEqual([5000]);
  });

  test("with every slot busy it gathers, and goes with the next free slot", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1 }),
    );
    const { release } = await holdTheOnlySlot(writer);
    const spans: TestTarget = makeTarget("Spans");

    await writer.submit(spans, makeRows(1, 0), { due: true });
    await writer.submit(spans, makeRows(1, 1), { due: true });
    await advance(200);
    expect(spans.inserts).toHaveLength(0);

    release();
    await settle();
    expect(spans.inserts).toHaveLength(1);
    expect(seqs(spans.inserts[0])).toEqual([0, 1]);
  });
});

describe("jobs that wait for their rows are no longer held for maxWaitMs", () => {
  /*
   * 100 workers, as TELEMETRY_CONCURRENCY runs them, and a backlog of 1,000
   * jobs: each worker takes a job, hands the writer its rows for one to
   * three tables (logs, spans, metric points), waits for every ack, and
   * takes the next. An insert takes 100 ms; CPU is free here, so how long
   * the jobs take is how long they wait for the writer. firstNineHundredMs
   * leaves out the last jobs, which nothing comes after to fill the count:
   * they wait out the window, as the last rows of any burst do.
   */
  interface JobsRun {
    firstNineHundredMs: number;
    elapsedMs: number;
    inserts: number;
  }

  async function runJobs(
    options: FanInWriterOptions,
    tablesPerJob: number = 3,
  ): Promise<JobsRun> {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options);
    const tables: Array<TestTarget> = [
      makeTarget("Logs"),
      makeTarget("Spans"),
      makeTarget("Metrics"),
    ].slice(0, tablesPerJob);
    for (const table of tables) {
      table.latencyMs = 100;
    }
    let remaining: number = 1000;
    let finished: number = 0;

    const worker: () => Promise<void> = async (): Promise<void> => {
      while (remaining > 0) {
        remaining--;
        const acks: Array<Promise<void>> = [];
        for (const table of tables) {
          const result: FanInSubmitResult = await writer.submit(
            table,
            makeRows(25),
          );
          acks.push(result.flushed);
        }
        await Promise.all(acks);
        finished++;
      }
    };

    const workers: Array<Promise<void>> = Array.from({ length: 100 }, () => {
      return worker();
    });

    let firstNineHundredMs: number = -1;
    while (finished < 1000) {
      await advance(50, 50);
      if (firstNineHundredMs < 0 && finished >= 900) {
        firstNineHundredMs = now;
      }
    }

    await Promise.all(workers);
    return {
      firstNineHundredMs: firstNineHundredMs,
      elapsedMs: now,
      inserts: tables.reduce((sum: number, table: TestTarget) => {
        return sum + table.inserts.length;
      }, 0),
    };
  }

  // The writer's own defaults: no batch fills before its time is up.
  const PRODUCTION: Partial<FanInWriterOptions> = {
    maxBatchRows: 100_000,
    maxPendingRows: 200_000,
    maxConcurrentInserts: 4,
    maxWaitMs: 5000,
  };

  test("three tables a job: 900 jobs in about two seconds, in few inserts", async () => {
    const run: JobsRun = await runJobs(
      makeOptions({ ...PRODUCTION, flushAtSubmissions: 80 }),
    );

    // 1,850 ms, and all 1,000 in 2,050 ms, when written.
    expect(run.firstNineHundredMs).toBeLessThanOrEqual(2500);
    /*
     * Each insert the rows of many jobs: the 3,000 submissions went in 50
     * (the window below: 30).
     */
    expect(run.inserts).toBeLessThanOrEqual(60);
  });

  test("one table a job, the count reached only with four fifths of the workers waiting: still about a second", async () => {
    const run: JobsRun = await runJobs(
      makeOptions({ ...PRODUCTION, flushAtSubmissions: 80 }),
      1,
    );

    /*
     * 1,250 ms when written; the last jobs, fewer than the count, then
     * waited out the window: all 1,000 in 6,250 ms.
     */
    expect(run.firstNineHundredMs).toBeLessThanOrEqual(2500);
  });

  test("the same jobs, with rows waiting maxWaitMs as before, took a window per hundred", async () => {
    const run: JobsRun = await runJobs(
      makeOptions({ ...PRODUCTION, flushAtSubmissions: undefined }),
    );

    expect(run.firstNineHundredMs).toBeGreaterThanOrEqual(9 * 5000);
    expect(run.elapsedMs).toBeGreaterThanOrEqual(10 * 5000);
  });
});

describe("readFanInWriterOptionsFromEnv: flushAtSubmissions", () => {
  function readWith(concurrency: string | undefined): FanInWriterOptions {
    const before: string | undefined = process.env["TELEMETRY_CONCURRENCY"];

    try {
      if (concurrency === undefined) {
        delete process.env["TELEMETRY_CONCURRENCY"];
      } else {
        process.env["TELEMETRY_CONCURRENCY"] = concurrency;
      }
      return readFanInWriterOptionsFromEnv();
    } finally {
      if (before === undefined) {
        delete process.env["TELEMETRY_CONCURRENCY"];
      } else {
        process.env["TELEMETRY_CONCURRENCY"] = before;
      }
    }
  }

  test("four fifths of TELEMETRY_CONCURRENCY (100 by default); maxWaitMs stays 5 s", () => {
    expect(readWith(undefined).flushAtSubmissions).toBe(80);
    expect(readWith(undefined).maxWaitMs).toBe(5000);
    expect(readWith("300").flushAtSubmissions).toBe(240);
    expect(readWith("24").flushAtSubmissions).toBe(19);
  });

  test("never below one; a concurrency the worker would not take is its default", () => {
    expect(readWith("1").flushAtSubmissions).toBe(1);
    expect(readWith("3").flushAtSubmissions).toBe(2);
    expect(readWith("0").flushAtSubmissions).toBe(80);
    expect(readWith("-5").flushAtSubmissions).toBe(80);
    expect(readWith("lots").flushAtSubmissions).toBe(80);
  });
});
