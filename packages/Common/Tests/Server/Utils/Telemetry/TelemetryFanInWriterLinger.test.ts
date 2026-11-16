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
 * HOW LONG ROWS WAIT IN THE FAN-IN WRITER (#6086).
 *
 * A telemetry job waits for ClickHouse to take its rows before it completes,
 * holding one of the worker's TELEMETRY_CONCURRENCY slots, so a job waits
 * as long as its rows do. Every table used to wait TELEMETRY_FANIN_MAX_WAIT_MS
 * (5 s) from its first row: one App, 100 slots, finished about 22 OTLP
 * batches a second, each job waiting about 4.5 s, its CPU half idle.
 *
 * Now a table's first row waits lingerMs (200 ms) for others to join it,
 * and the table is inserted then if an insert slot is free. With every slot
 * busy - a slow ClickHouse - it keeps gathering and goes with the next slot
 * that frees, or at maxWaitMs, so ClickHouse still gets fewer, fuller
 * inserts when it is struggling. These tests run the real class on fake
 * timers with a mocked insert target.
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
}

let now: number = 0;

function makeTarget(tableName: string): TestTarget {
  const target: TestTarget = {
    model: { tableName: tableName },
    inserts: [],
    hold: null,
    insertJsonRows: async (rows: Array<JSONObject>): Promise<void> => {
      target.inserts.push({ rows: rows, at: now });
      if (target.hold) {
        await target.hold;
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
    lingerMs: 200,
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

beforeEach(() => {
  now = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("TelemetryFanInWriter lingers, then inserts", () => {
  test("a table is inserted once its first row has waited lingerMs, not maxWaitMs", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const target: TestTarget = makeTarget("Logs");

    const submitted: FanInSubmitResult = await writer.submit(
      target,
      makeRows(3),
    );
    let acked: boolean = false;
    void submitted.flushed.then(() => {
      acked = true;
    });

    await advance(190);
    expect(target.inserts).toHaveLength(0);
    expect(acked).toBe(false);

    await advance(10);
    expect(target.inserts).toHaveLength(1);
    expect(seqs(target.inserts[0])).toEqual([0, 1, 2]);
    expect(target.inserts[0]!.at).toBe(200);
    expect(acked).toBe(true);
  });

  test("rows that arrive while the first lingers join its insert, in order; later ones start a linger of their own", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const target: TestTarget = makeTarget("Logs");

    await writer.submit(target, makeRows(3, 0));
    await advance(100);
    await writer.submit(target, makeRows(2, 3));
    await advance(50);
    await writer.submit(target, makeRows(4, 5));
    await advance(50);

    expect(target.inserts).toHaveLength(1);
    expect(seqs(target.inserts[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    await advance(50);
    await writer.submit(target, makeRows(1, 9));
    await advance(190);
    expect(target.inserts).toHaveLength(1);
    await advance(10);
    expect(target.inserts).toHaveLength(2);
    expect(seqs(target.inserts[1])).toEqual([9]);
    expect(target.inserts[1]!.at).toBe(450);
  });

  test("each table lingers on its own", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions(),
    );
    const logs: TestTarget = makeTarget("Logs");
    const spans: TestTarget = makeTarget("Spans");

    await writer.submit(logs, makeRows(1));
    await advance(120);
    await writer.submit(spans, makeRows(1));

    await advance(80);
    expect(
      logs.inserts.map((insert: Insert) => {
        return insert.at;
      }),
    ).toEqual([200]);
    expect(spans.inserts).toHaveLength(0);

    await advance(120);
    expect(
      spans.inserts.map((insert: Insert) => {
        return insert.at;
      }),
    ).toEqual([320]);
  });

  test("a table that reaches maxBatchRows is inserted at once, linger or not", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxBatchRows: 5 }),
    );
    const target: TestTarget = makeTarget("Logs");

    await writer.submit(target, makeRows(3, 0));
    await writer.submit(target, makeRows(3, 3));
    await settle();

    expect(target.inserts).toHaveLength(1);
    expect(seqs(target.inserts[0])).toEqual([0, 1, 2]);

    // The rest still goes at the first row's linger.
    await advance(200);
    expect(target.inserts).toHaveLength(2);
    expect(seqs(target.inserts[1])).toEqual([3, 4, 5]);
  });

  test("with every insert slot busy, a table past its linger keeps gathering and goes with the next free slot, as one insert", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1 }),
    );
    const slow: TestTarget = makeTarget("Slow");
    const logs: TestTarget = makeTarget("Logs");
    const hold: { promise: Promise<void>; release: () => void } = released();
    slow.hold = hold.promise;

    // The one slot, taken and held.
    await writer.submit(slow, makeRows(1));
    await advance(200);
    expect(slow.inserts).toHaveLength(1);

    const first: FanInSubmitResult = await writer.submit(logs, makeRows(3, 0));
    await advance(300);
    // Past its linger, but no slot: still gathering.
    expect(logs.inserts).toHaveLength(0);

    const second: FanInSubmitResult = await writer.submit(logs, makeRows(2, 3));
    await advance(100);
    expect(logs.inserts).toHaveLength(0);

    hold.release();
    await settle();

    expect(logs.inserts).toHaveLength(1);
    expect(seqs(logs.inserts[0])).toEqual([0, 1, 2, 3, 4]);
    await expect(first.flushed).resolves.toBeUndefined();
    await expect(second.flushed).resolves.toBeUndefined();
  });

  test("...or at maxWaitMs, when no slot frees before then: cut there, it waits for a slot as before", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1, maxWaitMs: 1000 }),
    );
    const slow: TestTarget = makeTarget("Slow");
    const logs: TestTarget = makeTarget("Logs");
    const hold: { promise: Promise<void>; release: () => void } = released();
    slow.hold = hold.promise;

    await writer.submit(slow, makeRows(1));
    await advance(200);

    await writer.submit(logs, makeRows(2, 0));
    await advance(990);
    await writer.submit(logs, makeRows(1, 2));
    await advance(10);

    // Cut at maxWaitMs: rows after it are a batch of their own.
    await writer.submit(logs, makeRows(1, 3));
    expect(logs.inserts).toHaveLength(0);

    hold.release();
    await settle();

    expect(logs.inserts).toHaveLength(1);
    expect(seqs(logs.inserts[0])).toEqual([0, 1, 2]);

    await advance(200);
    expect(logs.inserts).toHaveLength(2);
    expect(seqs(logs.inserts[1])).toEqual([3]);
  });

  test("tables waiting for a slot get one in the order they stopped lingering", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1 }),
    );
    const slow: TestTarget = makeTarget("Slow");
    const order: Array<string> = [];
    const spans: TestTarget = makeTarget("Spans");
    const logs: TestTarget = makeTarget("Logs");
    const hold: { promise: Promise<void>; release: () => void } = released();
    slow.hold = hold.promise;

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

    await writer.submit(slow, makeRows(1));
    await advance(200);

    await writer.submit(spans, makeRows(1));
    await advance(50);
    await writer.submit(logs, makeRows(1));
    await advance(300);
    expect(order).toEqual([]);

    hold.release();
    await settle();
    await advance(10);

    expect(order).toEqual(["Spans", "Logs"]);
  });

  test("flushAll() inserts a table that waits for a slot", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ maxConcurrentInserts: 1 }),
    );
    const slow: TestTarget = makeTarget("Slow");
    const logs: TestTarget = makeTarget("Logs");
    const hold: { promise: Promise<void>; release: () => void } = released();
    slow.hold = hold.promise;

    await writer.submit(slow, makeRows(1));
    await advance(200);
    await writer.submit(logs, makeRows(2));
    await advance(300);

    const flushed: Promise<void> = writer.flushAll();
    hold.release();
    await settle();
    await flushed;

    expect(logs.inserts).toHaveLength(1);
    expect(writer.getStats()).toEqual({
      bufferedRows: 0,
      pendingRows: 0,
      activeInserts: 0,
    });
  });

  test("with no lingerMs, rows wait maxWaitMs, as they always did", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ lingerMs: undefined, maxWaitMs: 5000 }),
    );
    const target: TestTarget = makeTarget("Logs");

    await writer.submit(target, makeRows(1));
    await advance(4990, 50);
    expect(target.inserts).toHaveLength(0);
    await advance(10);
    expect(
      target.inserts.map((insert: Insert) => {
        return insert.at;
      }),
    ).toEqual([5000]);
  });

  test("a lingerMs past maxWaitMs waits maxWaitMs", async () => {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      makeOptions({ lingerMs: 9000, maxWaitMs: 1000 }),
    );
    const target: TestTarget = makeTarget("Logs");

    await writer.submit(target, makeRows(1));
    await advance(1000);
    expect(
      target.inserts.map((insert: Insert) => {
        return insert.at;
      }),
    ).toEqual([1000]);
  });
});

describe("jobs that wait for their rows are no longer held for maxWaitMs", () => {
  /*
   * 100 workers, as TELEMETRY_CONCURRENCY runs them: each takes a job,
   * hands the writer its logs, spans and metric points, waits for all
   * three acks, and takes the next. CPU is free here, so how long 1,000
   * jobs take is how long jobs wait for the writer.
   */
  async function runJobs(options: FanInWriterOptions): Promise<number> {
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options);
    const tables: Array<TestTarget> = [
      makeTarget("Logs"),
      makeTarget("Spans"),
      makeTarget("Metrics"),
    ];
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

    while (finished < 1000) {
      await advance(50, 50);
    }

    await Promise.all(workers);
    return now;
  }

  // The writer's own defaults: no batch fills before its time is up.
  const PRODUCTION: Partial<FanInWriterOptions> = {
    maxBatchRows: 100_000,
    maxPendingRows: 200_000,
    maxConcurrentInserts: 4,
    maxWaitMs: 5000,
  };

  test("1,000 jobs on 100 workers take about ten lingers, not ten maxWaitMs", async () => {
    const lingered: number = await runJobs(
      makeOptions({ ...PRODUCTION, lingerMs: 200 }),
    );

    // 10 rounds of 100 jobs, each waiting about one 200 ms linger.
    expect(lingered).toBeGreaterThanOrEqual(10 * 200);
    expect(lingered).toBeLessThanOrEqual(10 * 250);
  });

  test("the same jobs, with rows waiting maxWaitMs as before, took ten times five seconds", async () => {
    const waited: number = await runJobs(
      makeOptions({ ...PRODUCTION, lingerMs: undefined }),
    );

    expect(waited).toBeGreaterThanOrEqual(10 * 5000);
  });
});

describe("readFanInWriterOptionsFromEnv: TELEMETRY_FANIN_LINGER_MS", () => {
  function readWith(value: string | undefined): FanInWriterOptions {
    const before: string | undefined = process.env["TELEMETRY_FANIN_LINGER_MS"];

    try {
      if (value === undefined) {
        delete process.env["TELEMETRY_FANIN_LINGER_MS"];
      } else {
        process.env["TELEMETRY_FANIN_LINGER_MS"] = value;
      }
      return readFanInWriterOptionsFromEnv();
    } finally {
      if (before === undefined) {
        delete process.env["TELEMETRY_FANIN_LINGER_MS"];
      } else {
        process.env["TELEMETRY_FANIN_LINGER_MS"] = before;
      }
    }
  }

  test("200 ms unless set; maxWaitMs stays 5 s, the most a row waits", () => {
    expect(readWith(undefined).lingerMs).toBe(200);
    expect(readWith(undefined).maxWaitMs).toBe(5000);
  });

  test("a positive number is taken; anything else is the default", () => {
    expect(readWith("50").lingerMs).toBe(50);
    expect(readWith("0").lingerMs).toBe(200);
    expect(readWith("-5").lingerMs).toBe(200);
    expect(readWith("soon").lingerMs).toBe(200);
  });
});
