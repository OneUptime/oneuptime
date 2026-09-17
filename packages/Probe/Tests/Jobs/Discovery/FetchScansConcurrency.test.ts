process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
process.env["PROBE_DISCOVERY_MAX_CONCURRENT_SCANS"] = "2";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API, { APIFetchOptions } from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import { PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS } from "../../../Config";
import SubnetScanner, {
  SubnetScanConfig,
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import InitJob, {
  fetchAndRunScans,
  resetDiscoveryRunInProgress,
} from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

type CapturedCronJob = {
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

// Drive the exact closure registered in production without a real scheduler.
jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

const cleanupResolvers: Array<() => void> = [];
const pendingTicks: Array<Promise<void>> = [];
const listedBatches: Array<JSONArray> = [];

function deferred<T>(cleanupValue: T): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => {};
  let rejectPromise: (reason: Error) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (resolve: (value: T) => void, reject: (reason: Error) => void): void => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );
  cleanupResolvers.push((): void => {
    resolvePromise(cleanupValue);
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function scanRow(cidr: string): JSONObject {
  return { _id: ObjectID.generate().toString(), cidr };
}

function scanResult(): SubnetScanResult {
  return {
    discoveredHosts: [],
    scannedHostCount: 254,
    respondedToPingCount: 0,
    scannedPorts: [161],
    responderCountByConfigId: {},
    snmpErrorHostCount: 0,
    icmpFilteredFallbackHostCount: 0,
  };
}

function startTick(run: PromiseVoidFunction): Promise<void> {
  const tick: Promise<void> = run();
  pendingTicks.push(tick);
  return tick;
}

function capturedRunFunction(): PromiseVoidFunction {
  InitJob();
  const captured: CapturedCronJob | undefined = mockCapturedCronJobs.pop();
  if (!captured) {
    throw new Error("InitJob did not register the discovery cron job");
  }
  return captured.runFunction;
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setImmediate(resolve);
  });
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let scanSpy = jest.spyOn(SubnetScanner, "scan");

function listCalls(): Array<APIFetchOptions> {
  return fetchSpy.mock.calls
    .map((call: [APIFetchOptions]): APIFetchOptions => {
      return call[0];
    })
    .filter((call: APIFetchOptions): boolean => {
      return String(call.url).endsWith("/discovery-scan/list");
    });
}

function resultBodies(): Array<JSONObject> {
  return fetchSpy.mock.calls
    .filter((call: [APIFetchOptions]): boolean => {
      return String(call[0].url).endsWith("/discovery-scan/result");
    })
    .map((call: [APIFetchOptions]): JSONObject => {
      return call[0].data as JSONObject;
    });
}

beforeEach((): void => {
  resetDiscoveryRunInProgress();
  mockCapturedCronJobs.length = 0;
  listedBatches.length = 0;
  fetchSpy = jest
    .spyOn(API, "fetch")
    .mockImplementation((request: APIFetchOptions) => {
      return Promise.resolve({
        data: String(request.url).endsWith("/discovery-scan/list")
          ? listedBatches.shift() || []
          : [],
      }) as never;
    });
  scanSpy = jest.spyOn(SubnetScanner, "scan").mockResolvedValue(scanResult());
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

// Every started operation is settled before spies and scheduler state reset.
afterEach(async (): Promise<void> => {
  for (const resolve of cleanupResolvers.splice(0)) {
    resolve();
  }
  await Promise.allSettled(pendingTicks.splice(0));
  resetDiscoveryRunInProgress();
  jest.useRealTimers();
});

afterEach((): void => {
  jest.restoreAllMocks();
});

stubReverseDnsAsResolvingNothing();

describe("discovery scheduling across overlapping cron ticks (#3597)", () => {
  test("a later tick completes a small scan while an earlier large scan is still running", async (): Promise<void> => {
    const run: PromiseVoidFunction = capturedRunFunction();
    const large: JSONObject = scanRow("192.0.2.0/24");
    const small: JSONObject = scanRow("198.51.100.0/30");
    const largeSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    listedBatches.push([large], [small]);
    scanSpy.mockImplementation((config: SubnetScanConfig) => {
      return config.cidr === large["cidr"]
        ? largeSweep.promise
        : Promise.resolve(scanResult());
    });

    let firstTickFinished: boolean = false;
    const firstTick: Promise<void> = startTick(run).then((): void => {
      firstTickFinished = true;
    });
    await flushMicrotasks();
    await startTick(run);

    expect(firstTickFinished).toBe(false);
    expect(listCalls()).toHaveLength(2);
    expect((listCalls()[1]!.data as JSONObject)["excludeScanIds"]).toEqual([
      large["_id"],
    ]);
    expect(scanSpy).toHaveBeenCalledTimes(2);
    expect(resultBodies()).toEqual([
      expect.objectContaining({ scanId: small["_id"], success: true }),
    ]);

    largeSweep.resolve(scanResult());
    await firstTick;
    expect(resultBodies()).toHaveLength(2);
    expect(resultBodies()[1]).toEqual(
      expect.objectContaining({ scanId: large["_id"], success: true }),
    );

    await startTick(run);
    expect(
      (listCalls()[2]!.data as JSONObject)["excludeScanIds"] || [],
    ).toEqual([]);
  });

  test("all cron registrations and direct callers share one in-flight list request", async (): Promise<void> => {
    const firstRun: PromiseVoidFunction = capturedRunFunction();
    const secondRun: PromiseVoidFunction = capturedRunFunction();
    const list: Deferred<{ data: JSONArray }> = deferred({
      data: [] as JSONArray,
    });
    const scan: JSONObject = scanRow("192.0.2.0/30");
    fetchSpy.mockReturnValueOnce(list.promise as never);

    const firstTick: Promise<void> = startTick(firstRun);
    await flushMicrotasks();
    await startTick(secondRun);
    await startTick(fetchAndRunScans);

    expect(listCalls()).toHaveLength(1);
    expect(scanSpy).not.toHaveBeenCalled();

    list.resolve({ data: [scan] });
    await firstTick;
    expect(scanSpy).toHaveBeenCalledTimes(1);
    expect(resultBodies()[0]).toEqual(
      expect.objectContaining({ scanId: scan["_id"], success: true }),
    );

    await startTick(secondRun);
    expect(listCalls()).toHaveLength(2);
  });

  test("scans returned in one batch run concurrently and queued scans start when a slot opens", async (): Promise<void> => {
    const rows: Array<JSONObject> = Array.from(
      { length: 5 },
      (_value: unknown, index: number): JSONObject => {
        return scanRow(`192.0.2.${index * 4}/30`);
      },
    );
    const sweeps: Array<Deferred<SubnetScanResult>> = rows.map(
      (): Deferred<SubnetScanResult> => {
        return deferred(scanResult());
      },
    );
    listedBatches.push(rows);
    scanSpy.mockImplementation((config: SubnetScanConfig) => {
      const index: number = rows.findIndex((row: JSONObject): boolean => {
        return row["cidr"] === config.cidr;
      });
      return sweeps[index]!.promise;
    });

    let batchFinished: boolean = false;
    const batch: Promise<void> = startTick(fetchAndRunScans).then((): void => {
      batchFinished = true;
    });
    await flushMicrotasks();
    expect(scanSpy).toHaveBeenCalledTimes(2);

    await startTick(capturedRunFunction());
    expect(listCalls()).toHaveLength(1);

    sweeps[0]!.resolve(scanResult());
    await flushMicrotasks();
    expect(scanSpy).toHaveBeenCalledTimes(3);
    expect(resultBodies()).toHaveLength(1);
    expect(batchFinished).toBe(false);

    sweeps[2]!.resolve(scanResult());
    await flushMicrotasks();
    expect(scanSpy).toHaveBeenCalledTimes(4);

    sweeps[1]!.resolve(scanResult());
    await flushMicrotasks();
    expect(scanSpy).toHaveBeenCalledTimes(5);
    expect(batchFinished).toBe(false);

    sweeps[3]!.resolve(scanResult());
    sweeps[4]!.resolve(scanResult());
    await batch;

    expect(resultBodies()).toHaveLength(5);
    expect(
      new Set(
        resultBodies().map((body: JSONObject): string => {
          return String(body["scanId"]);
        }),
      ).size,
    ).toBe(5);
  });

  test("the cap applies across batches and polling resumes as soon as one scan finishes", async (): Promise<void> => {
    const run: PromiseVoidFunction = capturedRunFunction();
    const first: JSONObject = scanRow("192.0.2.0/24");
    const second: JSONObject = scanRow("198.51.100.0/24");
    const third: JSONObject = scanRow("203.0.113.0/30");
    const firstSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    const secondSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    listedBatches.push([first], [second], [third]);
    scanSpy.mockImplementation((config: SubnetScanConfig) => {
      if (config.cidr === first["cidr"]) {
        return firstSweep.promise;
      }
      if (config.cidr === second["cidr"]) {
        return secondSweep.promise;
      }
      return Promise.resolve(scanResult());
    });

    const firstTick: Promise<void> = startTick(run);
    await flushMicrotasks();
    const secondTick: Promise<void> = startTick(run);
    await flushMicrotasks();
    await startTick(run);

    expect(listCalls()).toHaveLength(2);
    expect(scanSpy).toHaveBeenCalledTimes(2);

    secondSweep.resolve(scanResult());
    await secondTick;
    await startTick(run);

    expect(listCalls()).toHaveLength(3);
    expect(scanSpy).toHaveBeenCalledTimes(3);
    expect(resultBodies()).toEqual([
      expect.objectContaining({ scanId: second["_id"], success: true }),
      expect.objectContaining({ scanId: third["_id"], success: true }),
    ]);

    firstSweep.resolve(scanResult());
    await firstTick;
  });

  test("a duplicate active scan in a later list does not run twice or consume the free slot", async (): Promise<void> => {
    const run: PromiseVoidFunction = capturedRunFunction();
    const active: JSONObject = scanRow("192.0.2.0/24");
    const next: JSONObject = scanRow("198.51.100.0/30");
    const activeSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    listedBatches.push([active], [active, active, next, next]);
    scanSpy.mockImplementation((config: SubnetScanConfig) => {
      return config.cidr === active["cidr"]
        ? activeSweep.promise
        : Promise.resolve(scanResult());
    });

    const firstTick: Promise<void> = startTick(run);
    await flushMicrotasks();
    await startTick(run);

    expect(scanSpy).toHaveBeenCalledTimes(2);
    expect(resultBodies()).toEqual([
      expect.objectContaining({ scanId: next["_id"], success: true }),
    ]);

    activeSweep.resolve(scanResult());
    await firstTick;
    expect(resultBodies()).toHaveLength(2);
  });

  test("duplicates of queued scans are deduplicated before the scan starts", async (): Promise<void> => {
    const first: JSONObject = scanRow("192.0.2.0/24");
    const second: JSONObject = scanRow("198.51.100.0/24");
    const queued: JSONObject = scanRow("203.0.113.0/30");
    const firstSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    const secondSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    listedBatches.push([first, second, queued, queued]);
    scanSpy
      .mockReturnValueOnce(firstSweep.promise)
      .mockReturnValueOnce(secondSweep.promise);

    const batch: Promise<void> = startTick(fetchAndRunScans);
    await flushMicrotasks();
    expect(scanSpy).toHaveBeenCalledTimes(2);

    firstSweep.resolve(scanResult());
    secondSweep.resolve(scanResult());
    await batch;

    expect(scanSpy).toHaveBeenCalledTimes(3);
    expect(
      resultBodies().filter((body: JSONObject): boolean => {
        return body["scanId"] === queued["_id"];
      }),
    ).toHaveLength(1);
  });

  test("a recurring scan with the same ID can run again after its previous result was reported", async (): Promise<void> => {
    const recurring: JSONObject = scanRow("192.0.2.0/30");
    listedBatches.push([recurring], [recurring]);

    await startTick(fetchAndRunScans);
    await startTick(capturedRunFunction());

    expect(listCalls()).toHaveLength(2);
    expect(scanSpy).toHaveBeenCalledTimes(2);
    expect(resultBodies()).toEqual([
      expect.objectContaining({ scanId: recurring["_id"], success: true }),
      expect.objectContaining({ scanId: recurring["_id"], success: true }),
    ]);
  });

  test("a transient list failure leaves an active scan alone and the next tick can fetch new work", async (): Promise<void> => {
    const run: PromiseVoidFunction = capturedRunFunction();
    const active: JSONObject = scanRow("192.0.2.0/24");
    const next: JSONObject = scanRow("198.51.100.0/30");
    const activeSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    listedBatches.push([active], [next]);
    scanSpy.mockReturnValueOnce(activeSweep.promise);

    const firstTick: Promise<void> = startTick(run);
    await flushMicrotasks();
    fetchSpy.mockRejectedValueOnce(new Error("ingest temporarily unavailable"));

    await expect(startTick(run)).resolves.toBeUndefined();
    expect(resultBodies()).toHaveLength(0);
    expect(scanSpy).toHaveBeenCalledTimes(1);

    await startTick(run);
    expect(listCalls()).toHaveLength(3);
    expect(scanSpy).toHaveBeenCalledTimes(2);
    expect(resultBodies()).toEqual([
      expect.objectContaining({ scanId: next["_id"], success: true }),
    ]);

    activeSweep.resolve(scanResult());
    await firstTick;
  });

  test("a scan retains its slot until its final result upload completes", async (): Promise<void> => {
    const run: PromiseVoidFunction = capturedRunFunction();
    const first: JSONObject = scanRow("192.0.2.0/30");
    const second: JSONObject = scanRow("198.51.100.0/30");
    const third: JSONObject = scanRow("203.0.113.0/30");
    const firstUpload: Deferred<{ data: JSONArray }> = deferred({
      data: [] as JSONArray,
    });
    const secondUpload: Deferred<{ data: JSONArray }> = deferred({
      data: [] as JSONArray,
    });
    listedBatches.push([first, second], [third]);
    fetchSpy.mockImplementation((request: APIFetchOptions) => {
      if (String(request.url).endsWith("/discovery-scan/list")) {
        return Promise.resolve({ data: listedBatches.shift() || [] }) as never;
      }
      const body: JSONObject = request.data as JSONObject;
      if (body["scanId"] === first["_id"]) {
        return firstUpload.promise as never;
      }
      if (body["scanId"] === second["_id"]) {
        return secondUpload.promise as never;
      }
      return Promise.resolve({ data: [] }) as never;
    });

    const firstTick: Promise<void> = startTick(run);
    await flushMicrotasks();
    expect(scanSpy).toHaveBeenCalledTimes(2);
    expect(resultBodies()).toHaveLength(2);

    await startTick(run);
    expect(listCalls()).toHaveLength(1);

    secondUpload.resolve({ data: [] });
    await flushMicrotasks();
    await startTick(run);
    expect(listCalls()).toHaveLength(2);
    expect((listCalls()[1]!.data as JSONObject)["excludeScanIds"]).toEqual([
      first["_id"],
    ]);
    expect(scanSpy).toHaveBeenCalledTimes(3);
    expect(resultBodies()[2]).toEqual(
      expect.objectContaining({ scanId: third["_id"], success: true }),
    );

    firstUpload.resolve({ data: [] });
    await firstTick;
  });

  test.each([true, false])(
    "a rejected result upload releases its slot after a sweep with success=%s",
    async (success: boolean): Promise<void> => {
      const run: PromiseVoidFunction = capturedRunFunction();
      const active: JSONObject = scanRow("192.0.2.0/24");
      const reported: JSONObject = scanRow("198.51.100.0/30");
      const next: JSONObject = scanRow("203.0.113.0/30");
      const activeSweep: Deferred<SubnetScanResult> = deferred(scanResult());
      const report: Deferred<{ data: JSONArray }> = deferred({
        data: [] as JSONArray,
      });
      listedBatches.push([active, reported], [next]);
      scanSpy.mockImplementation((config: SubnetScanConfig) => {
        if (config.cidr === active["cidr"]) {
          return activeSweep.promise;
        }
        if (config.cidr === reported["cidr"] && !success) {
          return Promise.reject(new Error("sweep failed"));
        }
        return Promise.resolve(scanResult());
      });
      fetchSpy.mockImplementation((request: APIFetchOptions) => {
        if (String(request.url).endsWith("/discovery-scan/list")) {
          return Promise.resolve({
            data: listedBatches.shift() || [],
          }) as never;
        }
        if ((request.data as JSONObject)["scanId"] === reported["_id"]) {
          return report.promise as never;
        }
        return Promise.resolve({ data: [] }) as never;
      });

      const firstTick: Promise<void> = startTick(run);
      await flushMicrotasks();
      await startTick(run);
      expect(listCalls()).toHaveLength(1);

      report.reject(new Error("result upload timed out"));
      await flushMicrotasks();
      await startTick(run);

      expect(listCalls()).toHaveLength(2);
      expect(scanSpy).toHaveBeenCalledTimes(3);
      expect(
        resultBodies().filter((body: JSONObject): boolean => {
          return body["scanId"] === reported["_id"];
        }),
      ).toEqual([expect.objectContaining({ success })]);
      expect(resultBodies()[1]).toEqual(
        expect.objectContaining({ scanId: next["_id"], success: true }),
      );

      activeSweep.resolve(scanResult());
      await firstTick;
    },
  );

  test("a sweep deadline releases only that scan's slot and observes its late rejection", async (): Promise<void> => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "performance"] });
    const run: PromiseVoidFunction = capturedRunFunction();
    const expired: JSONObject = scanRow("192.0.2.0/24");
    const active: JSONObject = scanRow("198.51.100.0/24");
    const next: JSONObject = scanRow("203.0.113.0/30");
    const expiredSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    const activeSweep: Deferred<SubnetScanResult> = deferred(scanResult());
    listedBatches.push([expired], [active], [next]);
    scanSpy
      .mockReturnValueOnce(expiredSweep.promise)
      .mockReturnValueOnce(activeSweep.promise);

    const firstTick: Promise<void> = startTick(run);
    await flushMicrotasks();
    jest.advanceTimersByTime(1);
    const secondTick: Promise<void> = startTick(run);
    await flushMicrotasks();
    await startTick(run);
    expect(listCalls()).toHaveLength(2);

    jest.advanceTimersByTime(PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS - 1);
    await firstTick;
    expect(resultBodies()).toEqual([
      expect.objectContaining({ scanId: expired["_id"], success: false }),
    ]);
    expect(String(resultBodies()[0]!["statusMessage"])).toContain(
      "did not finish within",
    );

    await startTick(run);
    expect(listCalls()).toHaveLength(3);
    expect((listCalls()[2]!.data as JSONObject)["excludeScanIds"]).toEqual([
      active["_id"],
    ]);
    expect(resultBodies()[1]).toEqual(
      expect.objectContaining({ scanId: next["_id"], success: true }),
    );

    /*
     * The deadline's Promise.race must retain a rejection handler on the
     * abandoned sweep, and it must never upload a second terminal result.
     */
    expiredSweep.reject(new Error("late sweep failure"));
    await flushMicrotasks();
    expect(resultBodies()).toHaveLength(2);

    activeSweep.resolve(scanResult());
    await secondTick;
    expect(jest.getTimerCount()).toBe(0);
  });
});
