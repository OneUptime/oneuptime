import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  BULK_ITEM_CHANGED,
  BulkActionRunResult,
  BulkItemOutcome,
  bulkItemUnchanged,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";

/*
 * The per-item loop behind the network device bulk actions (Set Site, Set
 * Device Role, Apply Vendor Template).
 *
 * What has to hold, because the progress modal reads nothing else:
 *
 *   - every item lands in exactly one of three lists - changed, unchanged
 *     (with its reason) or failed (with the server's message);
 *   - the lists come out in the order the items were selected, whatever
 *     order they finished in;
 *   - no more than `concurrency` steps are ever in flight, and one at a
 *     time unless the caller says otherwise;
 *   - the action starts once and ends once, even when something throws.
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
  totalIds: Array<string>;
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
    totalIds: idsOf(info.totalItems),
  };
}

interface Harness {
  props: BulkActionOnClickProps<Row>;
  snapshots: Array<Snapshot>;
  rawReports: Array<ProgressInfo<Row>>;
  onStart: MockFunction;
  onEnd: MockFunction;
}

function harness(items: Array<Row>): Harness {
  const snapshots: Array<Snapshot> = [];
  const rawReports: Array<ProgressInfo<Row>> = [];
  const onStart: MockFunction = getJestMockFunction();
  const onEnd: MockFunction = getJestMockFunction();

  return {
    snapshots,
    rawReports,
    onStart,
    onEnd,
    props: {
      items: items,
      onProgressInfo: (info: ProgressInfo<Row>): void => {
        rawReports.push(info);
        snapshots.push(snapshot(info));
      },
      onBulkActionStart: onStart as unknown as () => void,
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
  const promise: Promise<BulkItemOutcome | void> = new Promise<
    BulkItemOutcome | void
  >(
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
  for (let i: number = 0; i < 10; i++) {
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
      step: async (): Promise<void> => {
        // resolving with nothing means changed
      },
    });

    expect(idsOf(result.changed)).toEqual(["row-1", "row-2", "row-3"]);
    expect(result.failed).toEqual([]);
    expect(result.unchanged).toEqual([]);

    expect(h.snapshots).toHaveLength(3);
    const last: Snapshot = h.snapshots[2]!;
    expect(last.successIds).toEqual(["row-1", "row-2", "row-3"]);
    expect(last.inProgressIds).toEqual([]);
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
      step: async (row: Row): Promise<void> => {
        order.push(`step ${row._id}`);
      },
    });

    expect(order).toEqual(["start", "step row-1", "step row-2", "end"]);
    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
  });

  test("one at a time by default: the next step does not start until the last one finished", async () => {
    const items: Array<Row> = rows(3);
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
      concurrency: 4,
      step: async (): Promise<void> => {
        inFlight += 1;
        highWater = Math.max(highWater, inFlight);
        await flush();
        inFlight -= 1;
      },
    });

    expect(highWater).toBe(4);
    expect(result.changed).toHaveLength(10);
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

  test.each([0, -2, Number.NaN])(
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
    expect(result).toEqual({ changed: [], unchanged: [], failed: [] });
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
