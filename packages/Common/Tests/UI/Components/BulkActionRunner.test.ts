import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  BULK_ACTION_CONCURRENCY,
  BULK_ESTIMATE_AFTER_IN_MS,
  BULK_ITEM_CHANGED,
  BULK_PROGRESS_INTERVAL_IN_MS,
  BulkActionClock,
  BulkActionRunResult,
  BulkItemOutcome,
  bulkItemUnchanged,
  estimateBulkTimeLeftInMs,
  getBulkActionConcurrency,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionStartOptions,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";

/*
 * The per-item loop behind every bulk action (issue #5299: bulk-resolving
 * thousands of alerts took hours, one alert at a time).
 *
 * What has to hold, because the progress modal reads nothing else:
 *
 *   - every item lands in exactly one list - changed, unchanged (with its
 *     reason), failed (with the server's message) or, after a Stop, not
 *     started;
 *   - the lists come out in the order the items were selected, whatever
 *     order they finished in;
 *   - four items are worked on at once unless the action says otherwise,
 *     and never more than it says;
 *   - a Stop starts no more items, lets the ones running finish, and says
 *     which were never started;
 *   - the modal hears at most once per interval, a held-back report still
 *     reaches it once the interval has passed, and the last report always
 *     comes;
 *   - the action starts once and ends once, even when something throws.
 *
 * Time is a fake clock throughout: no test waits for real time to pass.
 */

interface Row {
  _id: string;
  name: string;
}

function rows(count: number): Array<Row> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return { _id: `row-${index + 1}`, name: `Device ${index + 1}` };
  });
}

interface Snapshot {
  successIds: Array<string>;
  failedIds: Array<string>;
  failedMessages: Array<string>;
  unchangedIds: Array<string>;
  unchangedReasons: Array<string>;
  inProgressIds: Array<string>;
  notStartedIds: Array<string>;
  totalIds: Array<string>;
  estimatedTimeLeftInMs: number | undefined;
}

function idsOf(items: Array<Row>): Array<string> {
  return items.map((item: Row): string => {
    return item._id;
  });
}

function snapshot(info: ProgressInfo<Row>): Snapshot {
  return {
    successIds: idsOf(info.successItems),
    failedIds: info.failed.map((entry: BulkActionFailed<Row>): string => {
      return entry.item._id;
    }),
    failedMessages: info.failed.map((entry: BulkActionFailed<Row>): string => {
      return String(entry.failedMessage);
    }),
    unchangedIds: (info.unchanged || []).map(
      (entry: BulkActionUnchanged<Row>): string => {
        return entry.item._id;
      },
    ),
    unchangedReasons: (info.unchanged || []).map(
      (entry: BulkActionUnchanged<Row>): string => {
        return String(entry.reason);
      },
    ),
    inProgressIds: idsOf(info.inProgressItems),
    notStartedIds: idsOf(info.notStartedItems || []),
    totalIds: idsOf(info.totalItems),
    estimatedTimeLeftInMs: info.estimatedTimeLeftInMs,
  };
}

/*
 * A clock the test moves by hand. Timers set on it fire when the test
 * advances past their time, in the order they are due.
 */
class FakeClock implements BulkActionClock {
  public time: number = 1_000_000;
  private nextId: number = 1;
  private timers: Array<{ id: number; at: number; callback: () => void }> =
    [];

  public now: () => number = (): number => {
    return this.time;
  };

  public setTimeout: (callback: () => void, delayInMs: number) => unknown = (
    callback: () => void,
    delayInMs: number,
  ): unknown => {
    const id: number = this.nextId++;
    this.timers.push({ id: id, at: this.time + delayInMs, callback: callback });
    return id;
  };

  public clearTimeout: (handle: unknown) => void = (handle: unknown): void => {
    this.timers = this.timers.filter(
      (timer: { id: number; at: number; callback: () => void }): boolean => {
        return timer.id !== handle;
      },
    );
  };

  public get pendingTimers(): number {
    return this.timers.length;
  }

  public advance(ms: number): void {
    const until: number = this.time + ms;

    for (;;) {
      const due: Array<{ id: number; at: number; callback: () => void }> =
        this.timers
          .filter((timer: { at: number }): boolean => {
            return timer.at <= until;
          })
          .sort((a: { at: number }, b: { at: number }): number => {
            return a.at - b.at;
          });

      const next: { id: number; at: number; callback: () => void } | undefined =
        due[0];

      if (!next) {
        break;
      }

      this.timers = this.timers.filter((timer: { id: number }): boolean => {
        return timer.id !== next.id;
      });
      this.time = Math.max(this.time, next.at);
      next.callback();
    }

    this.time = until;
  }
}

interface Harness {
  props: BulkActionOnClickProps<Row>;
  snapshots: Array<Snapshot>;
  rawReports: Array<ProgressInfo<Row>>;
  startOptions: Array<BulkActionStartOptions | undefined>;
  onStart: MockFunction;
  onEnd: MockFunction;
  stop: () => void;
}

function harness(items: Array<Row>): Harness {
  const snapshots: Array<Snapshot> = [];
  const rawReports: Array<ProgressInfo<Row>> = [];
  const startOptions: Array<BulkActionStartOptions | undefined> = [];
  const onStart: MockFunction = getJestMockFunction();
  const onEnd: MockFunction = getJestMockFunction();
  const stopController: AbortController = new AbortController();

  onStart.mockImplementation((options?: BulkActionStartOptions) => {
    startOptions.push(options);
  });

  return {
    snapshots,
    rawReports,
    startOptions,
    onStart,
    onEnd,
    stop: (): void => {
      stopController.abort();
    },
    props: {
      items: items,
      stopSignal: stopController.signal,
      onProgressInfo: (info: ProgressInfo<Row>): void => {
        rawReports.push(info);
        snapshots.push(snapshot(info));
      },
      onBulkActionStart: onStart as unknown as (
        options?: BulkActionStartOptions,
      ) => void,
      onBulkActionEnd: onEnd as unknown as () => void,
    },
  };
}

interface Deferred {
  promise: Promise<BulkItemOutcome | void>;
  resolve: (value?: BulkItemOutcome) => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve: (value?: BulkItemOutcome) => void = () => {
    // replaced below
  };
  let reject: (error: unknown) => void = () => {
    // replaced below
  };
  const promise: Promise<BulkItemOutcome | void> =
    new Promise<BulkItemOutcome | void>(
      (
        res: (value: BulkItemOutcome | void) => void,
        rej: (error: unknown) => void,
      ) => {
        resolve = (value?: BulkItemOutcome): void => {
          res(value);
        };
        reject = rej;
      },
    );
  return { promise, resolve, reject };
}

// Lets every pending promise callback run.
async function flush(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe("runBulkAction", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("puts every item a step resolves for in the changed list, in selection order", async () => {
    const h: Harness = harness(rows(3));

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      progressIntervalInMs: 0,
      step: async (): Promise<void> => {
        // resolving with nothing means changed
      },
    });

    expect(idsOf(result.changed)).toEqual(["row-1", "row-2", "row-3"]);
    expect(result.failed).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.notStarted).toEqual([]);

    expect(h.snapshots).toHaveLength(3);
    const last: Snapshot = h.snapshots[2]!;
    expect(last.successIds).toEqual(["row-1", "row-2", "row-3"]);
    expect(last.inProgressIds).toEqual([]);
    expect(last.notStartedIds).toEqual([]);
    expect(last.totalIds).toEqual(["row-1", "row-2", "row-3"]);
  });

  test("an explicit CHANGED outcome reads the same as resolving with nothing", async () => {
    const h: Harness = harness(rows(2));

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: async (): Promise<BulkItemOutcome> => {
        return BULK_ITEM_CHANGED;
      },
    });

    expect(idsOf(result.changed)).toEqual(["row-1", "row-2"]);
  });

  test("an item left alone is listed as unchanged with its reason - neither succeeded nor failed", async () => {
    const h: Harness = harness(rows(3));

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: async (row: Row): Promise<BulkItemOutcome> => {
        return row._id === "row-2"
          ? bulkItemUnchanged("Nothing polls this device.")
          : BULK_ITEM_CHANGED;
      },
    });

    expect(idsOf(result.changed)).toEqual(["row-1", "row-3"]);
    expect(result.failed).toEqual([]);
    expect(
      result.unchanged.map((entry: BulkActionUnchanged<Row>) => {
        return [entry.item._id, entry.reason];
      }),
    ).toEqual([["row-2", "Nothing polls this device."]]);

    const last: Snapshot = h.snapshots[h.snapshots.length - 1]!;
    expect(last.unchangedIds).toEqual(["row-2"]);
    expect(last.unchangedReasons).toEqual(["Nothing polls this device."]);
    expect(last.successIds).toEqual(["row-1", "row-3"]);
    expect(last.failedIds).toEqual([]);
  });

  test("a step that throws fails its item with the error's own message and the rest carry on", async () => {
    const h: Harness = harness(rows(3));

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: async (row: Row): Promise<void> => {
        if (row._id === "row-1") {
          throw new Error(
            "You need the Edit Network Device permission to do this.",
          );
        }
      },
    });

    expect(idsOf(result.changed)).toEqual(["row-2", "row-3"]);
    expect(
      result.failed.map((entry: BulkActionFailed<Row>) => {
        return [entry.item._id, entry.failedMessage];
      }),
    ).toEqual([
      ["row-1", "You need the Edit Network Device permission to do this."],
    ]);
  });

  test("one failure among items running at once fails only its own item", async () => {
    const items: Array<Row> = rows(8);
    const h: Harness = harness(items);

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: async (row: Row): Promise<void> => {
        await flush();

        if (row._id === "row-3" || row._id === "row-6") {
          throw new Error(`Could not change ${row.name}.`);
        }
      },
    });

    expect(idsOf(result.changed)).toEqual([
      "row-1",
      "row-2",
      "row-4",
      "row-5",
      "row-7",
      "row-8",
    ]);
    expect(
      result.failed.map((entry: BulkActionFailed<Row>) => {
        return [entry.item._id, entry.failedMessage];
      }),
    ).toEqual([
      ["row-3", "Could not change Device 3."],
      ["row-6", "Could not change Device 6."],
    ]);
  });

  test("a server error reads as the server's message, through API.getFriendlyMessage", async () => {
    const h: Harness = harness(rows(1));

    const serverError: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      {
        message:
          "Device-Specific Health OIDs: 205 OIDs is more than the limit of 200.",
      },
      {},
    );

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: async (): Promise<void> => {
        throw serverError;
      },
    });

    expect(result.failed[0]!.failedMessage).toBe(
      "Device-Specific Health OIDs: 205 OIDs is more than the limit of 200.",
    );
  });

  test("starts once before the first step and ends once after the last", async () => {
    const h: Harness = harness(rows(2));
    const order: Array<string> = [];

    (h.onStart as MockFunction).mockImplementation(() => {
      order.push("start");
    });
    (h.onEnd as MockFunction).mockImplementation(() => {
      order.push("end");
    });

    await runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 1,
      step: async (row: Row): Promise<void> => {
        order.push(`step ${row._id}`);
      },
    });

    expect(order).toEqual(["start", "step row-1", "step row-2", "end"]);
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  test("tells the modal at the start that the run can be stopped", async () => {
    const h: Harness = harness(rows(2));

    await runBulkAction<Row>({
      actionProps: h.props,
      step: async (): Promise<void> => {
        // changed
      },
    });

    expect(h.startOptions).toEqual([{ isStoppable: true }]);
  });

  test(`works on ${BULK_ACTION_CONCURRENCY} items at once by default`, async () => {
    const items: Array<Row> = rows(10);
    const h: Harness = harness(items);
    let inFlight: number = 0;
    let highWater: number = 0;

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: async (): Promise<void> => {
        inFlight += 1;
        highWater = Math.max(highWater, inFlight);
        await flush();
        inFlight -= 1;
      },
    });

    expect(BULK_ACTION_CONCURRENCY).toBe(4);
    expect(highWater).toBe(BULK_ACTION_CONCURRENCY);
    expect(result.changed).toHaveLength(10);
  });

  test("starts the first four at once and the fifth as soon as one of them is done", async () => {
    const items: Array<Row> = rows(6);
    const h: Harness = harness(items);
    const gates: Array<Deferred> = items.map(() => {
      return deferred();
    });
    const started: Array<string> = [];

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: h.props,
      step: (row: Row): Promise<BulkItemOutcome | void> => {
        started.push(row._id);
        return gates[items.indexOf(row)]!.promise;
      },
    });

    await flush();
    expect(started).toEqual(["row-1", "row-2", "row-3", "row-4"]);

    // The third finishes first: the next item takes its place at once.
    gates[2]!.resolve();
    await flush();
    expect(started).toEqual(["row-1", "row-2", "row-3", "row-4", "row-5"]);

    gates.forEach((gate: Deferred) => {
      gate.resolve();
    });

    const result: BulkActionRunResult<Row> = await run;
    expect(started).toHaveLength(6);
    expect(idsOf(result.changed)).toEqual(idsOf(items));
  });

  test("one at a time when the action says so: the next step does not start until the last one finished", async () => {
    const items: Array<Row> = rows(3);
    const h: Harness = harness(items);
    const gates: Array<Deferred> = items.map(() => {
      return deferred();
    });
    const started: Array<string> = [];

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 1,
      step: (row: Row): Promise<BulkItemOutcome | void> => {
        started.push(row._id);
        return gates[items.indexOf(row)]!.promise;
      },
    });

    await flush();
    expect(started).toEqual(["row-1"]);

    gates[0]!.resolve();
    await flush();
    expect(started).toEqual(["row-1", "row-2"]);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await run;
    expect(started).toEqual(["row-1", "row-2", "row-3"]);
  });

  test("never has more steps in flight than the concurrency allows", async () => {
    const items: Array<Row> = rows(10);
    const h: Harness = harness(items);
    let inFlight: number = 0;
    let highWater: number = 0;

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 3,
      progressIntervalInMs: 0,
      step: async (): Promise<void> => {
        inFlight += 1;
        highWater = Math.max(highWater, inFlight);
        await flush();
        inFlight -= 1;
      },
    });

    expect(highWater).toBe(3);
    expect(result.changed).toHaveLength(10);
    // One report per item at an interval of nothing: nine, then the last.
    expect(h.snapshots).toHaveLength(10);
  });

  test("keeps selection order in every list even when items finish out of order", async () => {
    const items: Array<Row> = rows(4);
    const h: Harness = harness(items);
    const gates: Array<Deferred> = items.map(() => {
      return deferred();
    });

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 4,
      progressIntervalInMs: 0,
      step: (row: Row): Promise<BulkItemOutcome | void> => {
        return gates[items.indexOf(row)]!.promise;
      },
    });

    await flush();

    // Last first.
    gates[3]!.resolve(bulkItemUnchanged("already there"));
    await flush();
    gates[2]!.reject(new Error("refused"));
    await flush();
    gates[1]!.resolve();
    await flush();
    gates[0]!.resolve(bulkItemUnchanged("nothing to do"));

    const result: BulkActionRunResult<Row> = await run;

    expect(idsOf(result.changed)).toEqual(["row-2"]);
    expect(
      result.unchanged.map((entry: BulkActionUnchanged<Row>) => {
        return entry.item._id;
      }),
    ).toEqual(["row-1", "row-4"]);
    expect(
      result.failed.map((entry: BulkActionFailed<Row>) => {
        return entry.item._id;
      }),
    ).toEqual(["row-3"]);

    // The first report already had row-4 done and the others still running.
    expect(h.snapshots[0]!.unchangedIds).toEqual(["row-4"]);
    expect(h.snapshots[0]!.inProgressIds).toEqual(["row-1", "row-2", "row-3"]);
    expect(h.snapshots[3]!.inProgressIds).toEqual([]);
  });

  test("reports fresh lists every time, so an earlier report never changes after the fact", async () => {
    const h: Harness = harness(rows(3));

    await runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 1,
      progressIntervalInMs: 0,
      step: async (): Promise<void> => {
        // changed
      },
    });

    expect(idsOf(h.rawReports[0]!.successItems)).toEqual(["row-1"]);
    expect(idsOf(h.rawReports[1]!.successItems)).toEqual(["row-1", "row-2"]);
    expect(h.rawReports[0]!.successItems).not.toBe(
      h.rawReports[1]!.successItems,
    );
  });

  test.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    "a concurrency of %p is treated as one at a time",
    async (concurrency: number) => {
      const h: Harness = harness(rows(3));
      let inFlight: number = 0;
      let highWater: number = 0;

      await runBulkAction<Row>({
        actionProps: h.props,
        concurrency: concurrency,
        step: async (): Promise<void> => {
          inFlight += 1;
          highWater = Math.max(highWater, inFlight);
          await flush();
          inFlight -= 1;
        },
      });

      expect(highWater).toBe(1);
    },
  );

  test("an empty selection starts and ends without reporting progress", async () => {
    const h: Harness = harness([]);
    const step: MockFunction = getJestMockFunction();

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: step as unknown as (row: Row) => Promise<void>,
    });

    expect(step).not.toHaveBeenCalled();
    expect(h.snapshots).toEqual([]);
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      changed: [],
      unchanged: [],
      failed: [],
      notStarted: [],
    });
  });

  test("the same item selected twice is worked on twice, once per row", async () => {
    const row: Row = { _id: "row-1", name: "Device 1" };
    const h: Harness = harness([row, row]);
    const step: MockFunction = getJestMockFunction();
    step.mockImplementation(async (): Promise<void> => {
      // changed
    });

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: step as unknown as (row: Row) => Promise<void>,
    });

    expect(step).toHaveBeenCalledTimes(2);
    expect(result.changed).toHaveLength(2);
  });

  test("ends the action even when reporting progress throws", async () => {
    const onEnd: MockFunction = getJestMockFunction();

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: {
        items: rows(2),
        onProgressInfo: (): void => {
          throw new Error("the modal went away");
        },
        onBulkActionStart: (): void => {
          // started
        },
        onBulkActionEnd: onEnd as unknown as () => void,
      },
      step: async (): Promise<void> => {
        // changed
      },
    });

    await expect(run).rejects.toThrow("the modal went away");
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("runBulkAction: Stop", () => {
  test("starts no more items, lets the ones running finish, and lists the rest as not started", async () => {
    const items: Array<Row> = rows(6);
    const h: Harness = harness(items);
    const gates: Array<Deferred> = items.map(() => {
      return deferred();
    });
    const started: Array<string> = [];

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 2,
      step: (row: Row): Promise<BulkItemOutcome | void> => {
        started.push(row._id);
        return gates[items.indexOf(row)]!.promise;
      },
    });

    await flush();
    expect(started).toEqual(["row-1", "row-2"]);

    // Stop while two run: they finish, and nothing else starts.
    h.stop();
    gates[0]!.resolve();
    gates[1]!.reject(new Error("refused"));

    const result: BulkActionRunResult<Row> = await run;

    expect(started).toEqual(["row-1", "row-2"]);
    expect(idsOf(result.changed)).toEqual(["row-1"]);
    expect(
      result.failed.map((entry: BulkActionFailed<Row>) => {
        return entry.item._id;
      }),
    ).toEqual(["row-2"]);
    expect(idsOf(result.notStarted)).toEqual([
      "row-3",
      "row-4",
      "row-5",
      "row-6",
    ]);

    // The last report says so, and nothing reads as still running.
    const last: Snapshot = h.snapshots[h.snapshots.length - 1]!;
    expect(last.notStartedIds).toEqual(["row-3", "row-4", "row-5", "row-6"]);
    expect(last.inProgressIds).toEqual([]);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  test("a Stop before the first item starts nothing", async () => {
    const h: Harness = harness(rows(3));
    const step: MockFunction = getJestMockFunction();

    h.stop();

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      step: step as unknown as (row: Row) => Promise<void>,
    });

    expect(step).not.toHaveBeenCalled();
    expect(idsOf(result.notStarted)).toEqual(["row-1", "row-2", "row-3"]);
    expect(result.changed).toEqual([]);
    expect(h.snapshots[h.snapshots.length - 1]!.notStartedIds).toEqual([
      "row-1",
      "row-2",
      "row-3",
    ]);
  });

  test("a Stop once every item has started leaves nothing out", async () => {
    const items: Array<Row> = rows(3);
    const h: Harness = harness(items);
    const gates: Array<Deferred> = items.map(() => {
      return deferred();
    });

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: h.props,
      step: (row: Row): Promise<BulkItemOutcome | void> => {
        return gates[items.indexOf(row)]!.promise;
      },
    });

    await flush();
    h.stop();
    gates.forEach((gate: Deferred) => {
      gate.resolve();
    });

    const result: BulkActionRunResult<Row> = await run;

    expect(idsOf(result.changed)).toEqual(["row-1", "row-2", "row-3"]);
    expect(result.notStarted).toEqual([]);
    expect(h.snapshots[h.snapshots.length - 1]!.notStartedIds).toEqual([]);
  });

  test("an action that cannot stop says so at its start and runs every item", async () => {
    const h: Harness = harness(rows(3));
    const step: MockFunction = getJestMockFunction();
    step.mockImplementation(async (): Promise<void> => {
      // changed
    });

    h.stop();

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      isStoppable: false,
      step: step as unknown as (row: Row) => Promise<void>,
    });

    expect(h.startOptions).toEqual([{ isStoppable: false }]);
    expect(step).toHaveBeenCalledTimes(3);
    expect(result.notStarted).toEqual([]);
    expect(result.changed).toHaveLength(3);
  });
});

describe("runBulkAction: how often the modal hears", () => {
  test(`reports at most once every ${BULK_PROGRESS_INTERVAL_IN_MS} ms, the first item at once and the end always`, async () => {
    const items: Array<Row> = rows(5);
    const h: Harness = harness(items);
    const clock: FakeClock = new FakeClock();
    const gates: Array<Deferred> = items.map(() => {
      return deferred();
    });

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 5,
      clock: clock,
      step: (row: Row): Promise<BulkItemOutcome | void> => {
        return gates[items.indexOf(row)]!.promise;
      },
    });

    await flush();

    // The first one done is reported at once.
    gates[0]!.resolve();
    await flush();
    expect(h.snapshots).toHaveLength(1);
    expect(h.snapshots[0]!.successIds).toEqual(["row-1"]);

    // Two more within the interval: held back, not lost.
    clock.advance(10);
    gates[1]!.resolve();
    await flush();
    clock.advance(10);
    gates[2]!.resolve();
    await flush();
    expect(h.snapshots).toHaveLength(1);
    expect(clock.pendingTimers).toBe(1);

    // Once the interval has passed, the held report is sent - with both.
    clock.advance(BULK_PROGRESS_INTERVAL_IN_MS);
    expect(h.snapshots).toHaveLength(2);
    expect(h.snapshots[1]!.successIds).toEqual(["row-1", "row-2", "row-3"]);
    expect(h.snapshots[1]!.inProgressIds).toEqual(["row-4", "row-5"]);

    // The last two finish together: one final report, the held one dropped.
    gates[3]!.resolve();
    gates[4]!.resolve();
    await run;

    const last: Snapshot = h.snapshots[h.snapshots.length - 1]!;
    expect(last.successIds).toEqual(idsOf(items));
    expect(last.inProgressIds).toEqual([]);
    expect(clock.pendingTimers).toBe(0);
  });

  test("a burst of thousands of items builds its lists a handful of times, not once per item", async () => {
    const items: Array<Row> = rows(2000);
    const h: Harness = harness(items);
    const clock: FakeClock = new FakeClock();

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: h.props,
      clock: clock,
      step: async (): Promise<BulkItemOutcome> => {
        return bulkItemUnchanged("Already resolved.");
      },
    });

    expect(result.unchanged).toHaveLength(2000);
    // The first item at once and the end: nothing in between in no time.
    expect(h.snapshots.length).toBeLessThanOrEqual(2);
    expect(h.snapshots[h.snapshots.length - 1]!.unchangedIds).toHaveLength(
      2000,
    );
    expect(clock.pendingTimers).toBe(0);
  });

  test("a held report never arrives after the end", async () => {
    const items: Array<Row> = rows(3);
    const h: Harness = harness(items);
    const clock: FakeClock = new FakeClock();

    await runBulkAction<Row>({
      actionProps: h.props,
      clock: clock,
      step: async (): Promise<void> => {
        // changed
      },
    });

    const reportsAtEnd: number = h.snapshots.length;
    clock.advance(BULK_PROGRESS_INTERVAL_IN_MS * 10);

    expect(h.snapshots).toHaveLength(reportsAtEnd);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("runBulkAction: time left", () => {
  test("says nothing before it has run long enough, then the rate so far applied to what is left", async () => {
    const items: Array<Row> = rows(100);
    const h: Harness = harness(items);
    const clock: FakeClock = new FakeClock();
    const gates: Array<Deferred> = items.map(() => {
      return deferred();
    });

    const run: Promise<BulkActionRunResult<Row>> = runBulkAction<Row>({
      actionProps: h.props,
      concurrency: 100,
      clock: clock,
      step: (row: Row): Promise<BulkItemOutcome | void> => {
        return gates[items.indexOf(row)]!.promise;
      },
    });

    await flush();

    // One done after a second: too early to say.
    clock.advance(1000);
    gates[0]!.resolve();
    await flush();
    expect(h.snapshots[h.snapshots.length - 1]!.estimatedTimeLeftInMs).toBe(
      undefined,
    );

    // Ten done after four seconds: 0.4 s each, 90 left - 36 seconds.
    clock.advance(3000);
    for (let i: number = 1; i < 10; i++) {
      gates[i]!.resolve();
    }
    await flush();
    clock.advance(BULK_PROGRESS_INTERVAL_IN_MS);

    const estimate: number | undefined =
      h.snapshots[h.snapshots.length - 1]!.estimatedTimeLeftInMs;
    expect(estimate).toBeGreaterThan(30_000);
    expect(estimate).toBeLessThan(40_000);

    gates.forEach((gate: Deferred) => {
      gate.resolve();
    });
    await run;

    // Nothing is left to estimate at the end.
    expect(h.snapshots[h.snapshots.length - 1]!.estimatedTimeLeftInMs).toBe(
      undefined,
    );
  });

  test("estimateBulkTimeLeftInMs", () => {
    expect(
      estimateBulkTimeLeftInMs({
        doneCount: 0,
        totalCount: 10,
        elapsedInMs: 60_000,
      }),
    ).toBe(undefined);
    expect(
      estimateBulkTimeLeftInMs({
        doneCount: 10,
        totalCount: 10,
        elapsedInMs: 60_000,
      }),
    ).toBe(undefined);
    expect(
      estimateBulkTimeLeftInMs({
        doneCount: 5,
        totalCount: 10,
        elapsedInMs: BULK_ESTIMATE_AFTER_IN_MS - 1,
      }),
    ).toBe(undefined);
    expect(
      estimateBulkTimeLeftInMs({
        doneCount: 1432,
        totalCount: 4594,
        elapsedInMs: 1432 * 2200,
      }),
    ).toBe(3162 * 2200);
    expect(
      estimateBulkTimeLeftInMs({
        doneCount: 4,
        totalCount: 10,
        elapsedInMs: Number.NaN,
      }),
    ).toBe(undefined);
  });
});

describe("getBulkActionConcurrency", () => {
  test("is BULK_ACTION_CONCURRENCY when the action says nothing", () => {
    expect(getBulkActionConcurrency(undefined)).toBe(BULK_ACTION_CONCURRENCY);
  });

  test.each([
    [1, 1],
    [2, 2],
    [2.9, 2],
    [12, 12],
    [0, 1],
    [-3, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])("%p runs %p at once", (asked: number, expected: number) => {
    expect(getBulkActionConcurrency(asked)).toBe(expected);
  });
});
