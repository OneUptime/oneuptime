import DiscoveryScanScheduler from "../../../Utils/Discovery/DiscoveryScanScheduler";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
    },
  };
});

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (error: Error) => void;
}

type FetchScans = (
  excludeScanIds: Array<string>,
) => Promise<Array<NetworkDeviceDiscoveryScan>>;
type RunScan = (scan: NetworkDeviceDiscoveryScan) => Promise<void>;

interface ControlledScans {
  runScan: jest.MockedFunction<RunScan>;
  started: Array<NetworkDeviceDiscoveryScan>;
  active: number;
  peak: number;
  complete: (scan: NetworkDeviceDiscoveryScan) => void;
  fail: (scan: NetworkDeviceDiscoveryScan, error: Error) => void;
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void = (): void => {};
  let reject: (error: Error) => void = (): void => {};
  const promise: Promise<Value> = new Promise<Value>(
    (
      promiseResolve: (value: Value) => void,
      promiseReject: (error: Error) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise, resolve, reject };
}

function makeScan(
  id: ObjectID = ObjectID.generate(),
): NetworkDeviceDiscoveryScan {
  return { id } as NetworkDeviceDiscoveryScan;
}

function createControlledScans(): ControlledScans {
  const gates: Map<string, Deferred<void>> = new Map();

  function getGate(scan: NetworkDeviceDiscoveryScan): Deferred<void> {
    const id: string = scan.id!.toString();
    let gate: Deferred<void> | undefined = gates.get(id);
    if (!gate) {
      gate = createDeferred<void>();
      gates.set(id, gate);
    }
    return gate;
  }

  const controller: ControlledScans = {
    started: [],
    active: 0,
    peak: 0,
    runScan: jest.fn(
      async (scan: NetworkDeviceDiscoveryScan): Promise<void> => {
        controller.started.push(scan);
        controller.active++;
        controller.peak = Math.max(controller.peak, controller.active);
        try {
          await getGate(scan).promise;
        } finally {
          controller.active--;
        }
      },
    ),
    complete: (scan: NetworkDeviceDiscoveryScan): void => {
      getGate(scan).resolve();
    },
    fail: (scan: NetworkDeviceDiscoveryScan, error: Error): void => {
      getGate(scan).reject(error);
    },
  };

  return controller;
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

describe("DiscoveryScanScheduler", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("runs an oversized batch at the configured limit and drains it in FIFO order", async () => {
    const scans: Array<NetworkDeviceDiscoveryScan> = Array.from(
      { length: 5 },
      (): NetworkDeviceDiscoveryScan => {
        return makeScan();
      },
    );
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValue(scans);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 2,
      fetchScans,
      runScan: work.runScan,
    });

    let settled: boolean = false;
    const run: Promise<void> = scheduler.run().then(() => {
      settled = true;
    });
    await flushPromises();
    expect(work.started).toEqual(scans.slice(0, 2));
    expect(settled).toBe(false);

    work.complete(scans[1]!);
    await flushPromises();
    expect(work.started).toEqual(scans.slice(0, 3));
    work.complete(scans[2]!);
    await flushPromises();
    expect(work.started).toEqual(scans.slice(0, 4));
    work.complete(scans[0]!);
    await flushPromises();
    expect(work.started).toEqual(scans);
    expect(settled).toBe(false);

    work.complete(scans[3]!);
    work.complete(scans[4]!);
    await run;
    expect(work.peak).toBe(2);
    expect(work.active).toBe(0);
    expect(settled).toBe(true);
  });

  test("supports an explicit limit of one", async () => {
    const first: NetworkDeviceDiscoveryScan = makeScan();
    const second: NetworkDeviceDiscoveryScan = makeScan();
    const work: ControlledScans = createControlledScans();
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 1,
      fetchScans: async (): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        return [first, second];
      },
      runScan: work.runScan,
    });

    const run: Promise<void> = scheduler.run();
    await flushPromises();
    expect(work.started).toEqual([first]);
    work.complete(first);
    await flushPromises();
    expect(work.started).toEqual([first, second]);
    work.complete(second);
    await run;
    expect(work.peak).toBe(1);
  });

  test("skips overlapping fetches and allows polling again after an empty response", async () => {
    const response: Deferred<Array<NetworkDeviceDiscoveryScan>> =
      createDeferred<Array<NetworkDeviceDiscoveryScan>>();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockReturnValueOnce(response.promise)
      .mockResolvedValue([]);
    const work: ControlledScans = createControlledScans();
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 4,
      fetchScans,
      runScan: work.runScan,
    });

    const firstRun: Promise<void> = scheduler.run();
    await Promise.all([scheduler.run(), scheduler.run(), scheduler.run()]);
    expect(fetchScans).toHaveBeenCalledTimes(1);
    expect(fetchScans).toHaveBeenNthCalledWith(1, []);
    expect(work.runScan).not.toHaveBeenCalled();

    response.resolve([]);
    await firstRun;
    await scheduler.run();
    expect(fetchScans).toHaveBeenCalledTimes(2);
    expect(fetchScans).toHaveBeenNthCalledWith(2, []);
  });

  test("fills a spare slot on a later poll while an earlier scan is still running", async () => {
    const first: NetworkDeviceDiscoveryScan = makeScan();
    const second: NetworkDeviceDiscoveryScan = makeScan();
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second]);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 2,
      fetchScans,
      runScan: work.runScan,
    });

    let firstSettled: boolean = false;
    const firstRun: Promise<void> = scheduler.run().then(() => {
      firstSettled = true;
    });
    await flushPromises();
    const secondRun: Promise<void> = scheduler.run();
    await flushPromises();

    expect(work.started).toEqual([first, second]);
    expect(work.peak).toBe(2);
    expect(fetchScans).toHaveBeenNthCalledWith(1, []);
    expect(fetchScans).toHaveBeenNthCalledWith(2, [first.id!.toString()]);
    work.complete(second);
    await secondRun;
    expect(firstSettled).toBe(false);
    expect(work.active).toBe(1);

    work.complete(first);
    await firstRun;
  });

  test("skips polling while all slots are held and resumes when one is released", async () => {
    const first: NetworkDeviceDiscoveryScan = makeScan();
    const second: NetworkDeviceDiscoveryScan = makeScan();
    const third: NetworkDeviceDiscoveryScan = makeScan();
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([third]);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 2,
      fetchScans,
      runScan: work.runScan,
    });

    const firstRun: Promise<void> = scheduler.run();
    await flushPromises();
    await scheduler.run();
    expect(fetchScans).toHaveBeenCalledTimes(1);

    work.complete(second);
    await flushPromises();
    const secondRun: Promise<void> = scheduler.run();
    await flushPromises();
    expect(fetchScans).toHaveBeenCalledTimes(2);
    expect(fetchScans).toHaveBeenNthCalledWith(2, [first.id!.toString()]);
    expect(work.started).toEqual([first, second, third]);
    expect(work.peak).toBe(2);
    work.complete(first);
    work.complete(third);
    await Promise.all([firstRun, secondRun]);
  });

  test("reserves queued scans so repeated ticks cannot grow an oversized backlog", async () => {
    const scans: Array<NetworkDeviceDiscoveryScan> = [
      makeScan(),
      makeScan(),
      makeScan(),
    ];
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValue(scans);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 1,
      fetchScans,
      runScan: work.runScan,
    });

    const run: Promise<void> = scheduler.run();
    await flushPromises();
    await scheduler.run();
    work.complete(scans[0]!);
    await flushPromises();
    await scheduler.run();
    expect(fetchScans).toHaveBeenCalledTimes(1);
    expect(work.started).toEqual(scans.slice(0, 2));

    work.complete(scans[1]!);
    await flushPromises();
    await scheduler.run();
    expect(fetchScans).toHaveBeenCalledTimes(1);
    work.complete(scans[2]!);
    await run;
    expect(work.started).toEqual(scans);
  });

  test("snapshots excluded IDs for each request and drops completed IDs from later requests", async () => {
    const first: NetworkDeviceDiscoveryScan = makeScan();
    const second: NetworkDeviceDiscoveryScan = makeScan();
    const third: NetworkDeviceDiscoveryScan = makeScan();
    const delayedResponse: Deferred<Array<NetworkDeviceDiscoveryScan>> =
      createDeferred<Array<NetworkDeviceDiscoveryScan>>();
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValueOnce([first, second])
      .mockReturnValueOnce(delayedResponse.promise)
      .mockResolvedValue([]);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 3,
      fetchScans,
      runScan: work.runScan,
    });

    const firstRun: Promise<void> = scheduler.run();
    await flushPromises();
    const secondRun: Promise<void> = scheduler.run();
    await flushPromises();
    const requestSnapshot: Array<string> = fetchScans.mock.calls[1]![0];
    expect(requestSnapshot).toEqual([
      first.id!.toString(),
      second.id!.toString(),
    ]);

    /*
     * Finishing work while the HTTP request is pending must not change the
     * exclusions already handed to that request.
     */
    work.complete(first);
    await flushPromises();
    expect(requestSnapshot).toEqual([
      first.id!.toString(),
      second.id!.toString(),
    ]);
    await scheduler.run();
    expect(fetchScans).toHaveBeenCalledTimes(2);

    delayedResponse.resolve([third]);
    await flushPromises();
    await scheduler.run();
    expect(fetchScans).toHaveBeenNthCalledWith(3, [
      second.id!.toString(),
      third.id!.toString(),
    ]);
    expect(requestSnapshot).toEqual([
      first.id!.toString(),
      second.id!.toString(),
    ]);

    work.complete(second);
    work.complete(third);
    await Promise.all([firstRun, secondRun]);
    await scheduler.run();
    expect(fetchScans).toHaveBeenNthCalledWith(4, []);
  });

  test("deduplicates active and queued IDs by value within the same response", async () => {
    const first: NetworkDeviceDiscoveryScan = makeScan();
    const second: NetworkDeviceDiscoveryScan = makeScan();
    const duplicateFirst: NetworkDeviceDiscoveryScan = makeScan(
      new ObjectID(first.id!.toString()),
    );
    const duplicateSecond: NetworkDeviceDiscoveryScan = makeScan(
      new ObjectID(second.id!.toString()),
    );
    const work: ControlledScans = createControlledScans();
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 1,
      fetchScans: async (): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        return [first, duplicateFirst, second, duplicateSecond];
      },
      runScan: work.runScan,
    });

    const run: Promise<void> = scheduler.run();
    await flushPromises();
    work.complete(first);
    await flushPromises();
    work.complete(second);
    await run;
    expect(work.started).toEqual([first, second]);
    expect(work.peak).toBe(1);
  });

  test("ignores an active ID returned again on a later poll without waiting for it", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    const duplicate: NetworkDeviceDiscoveryScan = makeScan(
      new ObjectID(scan.id!.toString()),
    );
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValueOnce([scan])
      .mockResolvedValueOnce([duplicate]);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 2,
      fetchScans,
      runScan: work.runScan,
    });

    const firstRun: Promise<void> = scheduler.run();
    await flushPromises();
    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(work.started).toEqual([scan]);
    expect(work.active).toBe(1);
    work.complete(scan);
    await firstRun;
  });

  test("bounds a later oversized response using slots shared with earlier polls", async () => {
    const scans: Array<NetworkDeviceDiscoveryScan> = [
      makeScan(),
      makeScan(),
      makeScan(),
    ];
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValueOnce([scans[0]!])
      .mockResolvedValueOnce([scans[1]!, scans[2]!]);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 2,
      fetchScans,
      runScan: work.runScan,
    });

    const firstRun: Promise<void> = scheduler.run();
    await flushPromises();
    let secondSettled: boolean = false;
    const secondRun: Promise<void> = scheduler.run().then(() => {
      secondSettled = true;
    });
    await flushPromises();
    expect(work.started).toEqual(scans.slice(0, 2));

    work.complete(scans[0]!);
    await firstRun;
    await flushPromises();
    expect(work.started).toEqual(scans);
    expect(secondSettled).toBe(false);
    expect(work.peak).toBe(2);
    work.complete(scans[1]!);
    work.complete(scans[2]!);
    await secondRun;
  });

  test.each(["synchronous", "asynchronous"])(
    "releases the fetch guard after %s fetch failures",
    async (failureType: string) => {
      const error: Error = new Error("list request failed");
      const scan: NetworkDeviceDiscoveryScan = makeScan();
      const runScan: jest.MockedFunction<RunScan> = jest
        .fn<ReturnType<RunScan>, Parameters<RunScan>>()
        .mockResolvedValue(undefined);
      const fetchScans: jest.MockedFunction<FetchScans> = jest
        .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
        .mockImplementationOnce(
          (): Promise<Array<NetworkDeviceDiscoveryScan>> => {
            if (failureType === "synchronous") {
              throw error;
            }
            return Promise.reject(error);
          },
        )
        .mockResolvedValueOnce([scan]);
      const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
        maxConcurrentScans: 2,
        fetchScans,
        runScan,
      });

      await expect(scheduler.run()).rejects.toBe(error);
      await expect(scheduler.run()).resolves.toBeUndefined();
      expect(fetchScans).toHaveBeenCalledTimes(2);
      expect(runScan).toHaveBeenCalledTimes(1);
      expect(runScan).toHaveBeenCalledWith(scan);
    },
  );

  test("a rejected scan releases its slot, logs the error, and does not stop queued work", async () => {
    const first: NetworkDeviceDiscoveryScan = makeScan();
    const second: NetworkDeviceDiscoveryScan = makeScan();
    const third: NetworkDeviceDiscoveryScan = makeScan();
    const work: ControlledScans = createControlledScans();
    const fetchScans: jest.MockedFunction<FetchScans> = jest
      .fn<ReturnType<FetchScans>, Parameters<FetchScans>>()
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([third]);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 1,
      fetchScans,
      runScan: work.runScan,
    });

    const firstRun: Promise<void> = scheduler.run();
    await flushPromises();
    work.fail(first, new Error("scan failed"));
    await flushPromises();
    expect(work.started).toEqual([first, second]);
    expect(logger.error).toHaveBeenCalled();
    work.complete(second);
    await expect(firstRun).resolves.toBeUndefined();

    const nextRun: Promise<void> = scheduler.run();
    await flushPromises();
    expect(work.started).toEqual([first, second, third]);
    work.complete(third);
    await nextRun;
    expect(work.peak).toBe(1);
    expect(work.active).toBe(0);
  });

  test("a synchronous scan exception does not lose other scans in the response", async () => {
    const first: NetworkDeviceDiscoveryScan = makeScan();
    const second: NetworkDeviceDiscoveryScan = makeScan();
    const error: Error = new Error("invalid scan");
    const runScan: jest.MockedFunction<RunScan> = jest
      .fn<ReturnType<RunScan>, Parameters<RunScan>>()
      .mockImplementationOnce((): Promise<void> => {
        throw error;
      })
      .mockResolvedValue(undefined);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 1,
      fetchScans: async (): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        return [first, second];
      },
      runScan,
    });

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(runScan).toHaveBeenNthCalledWith(1, first);
    expect(runScan).toHaveBeenNthCalledWith(2, second);
    expect(logger.error).toHaveBeenCalled();
  });

  test("releases completed IDs so a later retry can execute", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    const runScan: jest.MockedFunction<RunScan> = jest
      .fn<ReturnType<RunScan>, Parameters<RunScan>>()
      .mockRejectedValueOnce(new Error("first attempt failed"))
      .mockResolvedValue(undefined);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 1,
      fetchScans: async (): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        return [scan];
      },
      runScan,
    });

    await scheduler.run();
    await scheduler.run();
    await scheduler.run();
    expect(runScan).toHaveBeenCalledTimes(3);
  });

  test("skips records without an ID and continues running valid records", async () => {
    const scan: NetworkDeviceDiscoveryScan = makeScan();
    const missingId: NetworkDeviceDiscoveryScan =
      {} as NetworkDeviceDiscoveryScan;
    const runScan: jest.MockedFunction<RunScan> = jest
      .fn<ReturnType<RunScan>, Parameters<RunScan>>()
      .mockResolvedValue(undefined);
    const scheduler: DiscoveryScanScheduler = new DiscoveryScanScheduler({
      maxConcurrentScans: 1,
      fetchScans: async (): Promise<Array<NetworkDeviceDiscoveryScan>> => {
        return [missingId, scan, missingId];
      },
      runScan,
    });

    await expect(scheduler.run()).resolves.toBeUndefined();
    expect(runScan).toHaveBeenCalledTimes(1);
    expect(runScan).toHaveBeenCalledWith(scan);
    expect(logger.error).toHaveBeenCalled();
  });
});
