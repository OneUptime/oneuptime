import {
  FanInInsertError,
  FanInInsertTarget,
  FanInSubmitResult,
  FanInWriterOptions,
  TelemetryFanInWriter,
  TransientInsertError,
} from "../../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { runWithInsertDedup } from "../../../../Server/Utils/AnalyticsDatabase/InsertDedupContext";
import { JSONObject } from "../../../../Types/JSON";
import { setImmediate } from "timers";

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

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise: Promise<void> = new Promise<void>(
    (res: () => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

function options(
  overrides: Partial<FanInWriterOptions> = {},
): FanInWriterOptions {
  return {
    maxBatchRows: 1,
    maxPendingRows: 4,
    maxConcurrentInserts: 1,
    maxWaitMs: 60_000,
    retryMaxAttempts: 2,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
    ...overrides,
  };
}

function rows(count: number, seq: number = 0): Array<JSONObject> {
  return Array.from({ length: count }, () => {
    return { seq };
  });
}

// Complete the current microtask queue without waiting for the flush timer.
async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function gatedTarget(): {
  target: FanInInsertTarget;
  gates: Array<Deferred>;
  inserted: Array<Array<JSONObject>>;
} {
  const gates: Array<Deferred> = [];
  const inserted: Array<Array<JSONObject>> = [];
  return {
    gates,
    inserted,
    target: {
      model: { tableName: "CapacityTable" },
      insertJsonRows: async (batch: Array<JSONObject>): Promise<void> => {
        inserted.push(batch);
        const gate: Deferred = deferred();
        gates.push(gate);
        await gate.promise;
      },
    },
  };
}

async function drainGated(
  writer: TelemetryFanInWriter,
  gates: Array<Deferred>,
  submissions: Array<Promise<FanInSubmitResult>>,
): Promise<void> {
  let resolvedGates: number = 0;
  let drained: boolean = false;
  const drain: Promise<void> = writer.flushAll().then(() => {
    drained = true;
  });
  while (!drained) {
    while (resolvedGates < gates.length) {
      gates[resolvedGates++]!.resolve();
    }
    await settle();
  }
  await drain;
  const accepted: Array<FanInSubmitResult> = await Promise.all(submissions);
  await Promise.all(
    accepted.map((result: FanInSubmitResult) => {
      return result.flushed;
    }),
  );
  expect(writer.getStats()).toEqual({
    bufferedRows: 0,
    pendingRows: 0,
    activeInserts: 0,
  });
}

describe("TelemetryFanInWriter capacity reservations", () => {
  test.each([1, 4])(
    "a simultaneous burst respects the row limit with %i insert slots",
    async (maxConcurrentInserts: number) => {
      const { target, gates, inserted } = gatedTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
        options({ maxPendingRows: 8, maxConcurrentInserts }),
      );
      let accepted: number = 0;
      const submissions: Array<Promise<FanInSubmitResult>> = Array.from(
        { length: 100 },
        (_: unknown, seq: number) => {
          return writer
            .submit(target, rows(2, seq))
            .then((result: FanInSubmitResult) => {
              accepted++;
              return result;
            });
        },
      );

      // Reservations must exist before any submit continuation has resumed.
      expect(writer.getStats().pendingRows).toBe(8);
      await settle();
      expect(accepted).toBe(4);
      expect(writer.getStats().pendingRows).toBe(8);
      expect(gates).toHaveLength(maxConcurrentInserts);

      await drainGated(writer, gates, submissions);
      expect(accepted).toBe(100);
      expect(
        inserted.map((batch: Array<JSONObject>) => {
          return batch[0]!["seq"];
        }),
      ).toEqual(
        Array.from({ length: 100 }, (_: unknown, seq: number) => {
          return seq;
        }),
      );
    },
  );

  test("each released slot admits only the rows it reserved, in FIFO order", async () => {
    const { target, gates, inserted } = gatedTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options());
    const accepted: Array<number> = [];
    const submissions: Array<Promise<FanInSubmitResult>> = [];
    for (let seq: number = 0; seq < 10; seq++) {
      submissions.push(
        writer
          .submit(target, rows(4, seq))
          .then((result: FanInSubmitResult) => {
            accepted.push(seq);
            return result;
          }),
      );
    }
    await settle();
    expect(accepted).toEqual([0]);

    for (let seq: number = 1; seq < 10; seq++) {
      gates[seq - 1]!.resolve();
      await settle();
      expect(accepted).toEqual(
        Array.from({ length: seq + 1 }, (_: unknown, i: number) => {
          return i;
        }),
      );
      expect(writer.getStats().pendingRows).toBe(4);
      expect(inserted).toHaveLength(seq + 1);
    }
    await drainGated(writer, gates, submissions);
  });

  test("an insert completion admits several small submissions that fit", async () => {
    const { target, gates } = gatedTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options());
    const submissions: Array<Promise<FanInSubmitResult>> = [
      writer.submit(target, rows(4)),
    ];
    let accepted: number = 0;
    const recordAcceptance: (result: FanInSubmitResult) => FanInSubmitResult = (
      result: FanInSubmitResult,
    ): FanInSubmitResult => {
      accepted++;
      return result;
    };
    for (let seq: number = 1; seq <= 20; seq++) {
      submissions.push(
        writer.submit(target, rows(1, seq)).then(recordAcceptance),
      );
    }
    await settle();
    expect(accepted).toBe(0);
    gates[0]!.resolve();
    await settle();
    expect(accepted).toBe(4);
    expect(writer.getStats().pendingRows).toBe(4);
    await drainGated(writer, gates, submissions);
  });

  test("new submissions cannot steal capacity already granted to queued callers", async () => {
    const { target, gates, inserted } = gatedTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options());
    const first: Promise<FanInSubmitResult> = writer.submit(target, rows(4, 0));
    const second: Promise<FanInSubmitResult> = writer.submit(
      target,
      rows(4, 1),
    );
    await settle();
    gates[0]!.resolve();
    const third: Promise<FanInSubmitResult> = (await first).flushed.then(() => {
      return writer.submit(target, rows(4, 2));
    });
    await settle();
    expect(writer.getStats().pendingRows).toBe(4);
    expect(
      inserted.map((batch: Array<JSONObject>) => {
        return batch[0]!["seq"];
      }),
    ).toEqual([0, 1]);
    await drainGated(writer, gates, [first, second, third]);
    expect(
      inserted.map((batch: Array<JSONObject>) => {
        return batch[0]!["seq"];
      }),
    ).toEqual([0, 1, 2]);
  });

  test.each([0, 3])(
    "a whole oversized submission makes progress with %i existing rows and bounds overshoot",
    async (initialRows: number) => {
      const { target, gates, inserted } = gatedTarget();
      const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options());
      const submissions: Array<Promise<FanInSubmitResult>> = [];
      if (initialRows) {
        submissions.push(writer.submit(target, rows(initialRows, 0)));
      }
      let oversizedAccepted: number = 0;
      const recordAcceptance: (
        result: FanInSubmitResult,
      ) => FanInSubmitResult = (
        result: FanInSubmitResult,
      ): FanInSubmitResult => {
        oversizedAccepted++;
        return result;
      };
      for (let seq: number = 1; seq <= 20; seq++) {
        submissions.push(
          writer.submit(target, rows(10, seq)).then(recordAcceptance),
        );
      }
      await settle();
      expect(oversizedAccepted).toBe(1);
      expect(writer.getStats().pendingRows).toBe(initialRows + 10);
      await drainGated(writer, gates, submissions);
      expect(
        inserted.filter((batch: Array<JSONObject>) => {
          return batch.length === 10;
        }),
      ).toHaveLength(20);
    },
  );

  test("definitive insert failure releases its reservation for the next submission", async () => {
    const { target, gates } = gatedTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options());
    const first: FanInSubmitResult = await writer.submit(target, rows(4));
    const failed: Promise<unknown> = first.flushed.catch((error: unknown) => {
      return error;
    });
    const second: Promise<FanInSubmitResult> = writer.submit(
      target,
      rows(4, 1),
    );
    const third: Promise<FanInSubmitResult> = writer.submit(target, rows(4, 2));
    await settle();
    gates[0]!.reject(new Error("Definitive insert failure"));
    expect(await failed).toBeInstanceOf(FanInInsertError);
    await settle();
    expect(writer.getStats().pendingRows).toBe(4);
    expect(gates).toHaveLength(2);
    await drainGated(writer, gates, [second, third]);
  });

  test("retry backoff holds its reservation until success and preserves the dedup token", async () => {
    const backoff: Deferred = deferred();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      options({
        sleep: async (): Promise<void> => {
          await backoff.promise;
        },
      }),
    );
    const insertJsonRows: jest.MockedFunction<
      FanInInsertTarget["insertJsonRows"]
    > = jest
      .fn<Promise<void>, Parameters<FanInInsertTarget["insertJsonRows"]>>()
      .mockRejectedValueOnce(new TransientInsertError("overloaded"))
      .mockResolvedValue(undefined);
    const target: FanInInsertTarget = {
      model: { tableName: "CapacityTable" },
      insertJsonRows,
    };
    const first: FanInSubmitResult = await writer.submit(target, rows(4), {
      dedupToken: "first-job",
    });
    let secondAccepted: boolean = false;
    const second: Promise<FanInSubmitResult> = writer
      .submit(target, rows(4, 1), {
        dedupToken: "second-job",
      })
      .then((result: FanInSubmitResult) => {
        secondAccepted = true;
        return result;
      });
    await settle();
    expect(secondAccepted).toBe(false);
    expect(writer.getStats().pendingRows).toBe(4);
    expect(insertJsonRows).toHaveBeenCalledTimes(1);
    backoff.resolve();
    await writer.flushAll();
    await first.flushed;
    await (
      await second
    ).flushed;
    expect(
      insertJsonRows.mock.calls.map(
        (call: Parameters<FanInInsertTarget["insertJsonRows"]>) => {
          return call[1]?.dedupToken;
        },
      ),
    ).toEqual(["first-job", "first-job", "second-job"]);
    expect(writer.getStats().pendingRows).toBe(0);
  });

  test("empty submissions bypass a full writer without reserving rows", async () => {
    const { target, gates } = gatedTarget();
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(options());
    const full: Promise<FanInSubmitResult> = writer.submit(target, rows(4));
    await (
      await writer.submit(target, [])
    ).flushed;
    expect(writer.getStats().pendingRows).toBe(4);
    await drainGated(writer, gates, [full]);
  });

  test("shutdown drains thousands of concurrent submissions across tables with no lost rows or tokens", async () => {
    const totalSubmissions: number = 2000;
    const maxPendingRows: number = 23;
    const largestSubmission: number = 7;
    const writer: TelemetryFanInWriter = new TelemetryFanInWriter(
      options({
        maxBatchRows: 11,
        maxPendingRows,
        maxConcurrentInserts: 3,
      }),
    );
    const seen: Map<number, number> = new Map();
    const tokens: Set<string> = new Set();
    let peakPending: number = 0;
    const checkCapacity: () => void = () => {
      peakPending = Math.max(peakPending, writer.getStats().pendingRows);
      expect(writer.getStats().pendingRows).toBeLessThanOrEqual(
        maxPendingRows + largestSubmission - 1,
      );
    };
    const targets: Array<FanInInsertTarget> = Array.from(
      { length: 3 },
      (_: unknown, i: number) => {
        return {
          model: { tableName: `CapacityTable${i}` },
          insertJsonRows: async (
            batch: Array<JSONObject>,
            insertOptions?: { dedupToken?: string | undefined },
          ): Promise<void> => {
            checkCapacity();
            expect(insertOptions?.dedupToken).toBeTruthy();
            expect(tokens.has(insertOptions!.dedupToken!)).toBe(false);
            tokens.add(insertOptions!.dedupToken!);
            const seq: number = batch[0]!["seq"] as number;
            expect(insertOptions!.dedupToken).toBe(
              `capacity-scale-job:CapacityTable${i}:${Math.floor(seq / 3)}`,
            );
            expect(seen.has(seq)).toBe(false);
            expect(
              batch.every((row: JSONObject) => {
                return row["seq"] === seq;
              }),
            ).toBe(true);
            seen.set(seq, batch.length);
            await Promise.resolve();
          },
        };
      },
    );
    const submissions: Array<Promise<FanInSubmitResult>> = [];
    await runWithInsertDedup("capacity-scale-job", async () => {
      for (let seq: number = 0; seq < totalSubmissions; seq++) {
        submissions.push(
          writer
            .submit(
              targets[seq % targets.length]!,
              rows((seq % largestSubmission) + 1, seq),
            )
            .then((result: FanInSubmitResult) => {
              checkCapacity();
              return result;
            }),
        );
        checkCapacity();
      }
    });
    /*
     * flushAll must also wait for rows whose capacity is reserved before their
     * submit continuation buffers them, including every later admission wave.
     */
    await writer.flushAll();
    await Promise.all(
      (await Promise.all(submissions)).map((result: FanInSubmitResult) => {
        return result.flushed;
      }),
    );
    expect(seen.size).toBe(totalSubmissions);
    expect(tokens.size).toBe(totalSubmissions);
    for (let seq: number = 0; seq < totalSubmissions; seq++) {
      expect(seen.get(seq)).toBe((seq % largestSubmission) + 1);
    }
    expect(peakPending).toBeGreaterThanOrEqual(maxPendingRows);
    expect(writer.getStats()).toEqual({
      bufferedRows: 0,
      pendingRows: 0,
      activeInserts: 0,
    });
  });
});
