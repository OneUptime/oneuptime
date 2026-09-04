// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import URL from "Common/Types/API/URL";
import API from "Common/Utils/API";
import SubnetScanner, {
  SubnetScanConfig,
  SubnetScanProgress,
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import {
  ScanProgressReporter,
  buildScanProgressMessage,
  runScan,
} from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * The probe's half of incremental discovery results (OneUptime issues #3598
 * and #3599).
 *
 * A sweep used to hold every host it found in memory until the whole range was
 * covered. On the reported 15,360-address scan that meant: "0 of 15360" in the
 * product for as long as the sweep ran; a sweep abandoned at the deadline
 * reporting nothing at all despite having confirmed hundreds of devices; and
 * an auto-import worker with nothing to import from, because the results it
 * reads only exist once a scan has reported.
 *
 * The probe now posts a cumulative partial result as it goes. Two properties
 * make that safe to do from inside a sweep, and both are pinned here:
 *
 *   - it never BLOCKS the sweep (the sweep runs inside a deadline race, so
 *     time spent uploading is time charged against the sweep), and
 *   - it never FAILS the sweep (a partial is a convenience; the final upload
 *     is the one that has to land).
 */

const scanId: ObjectID = ObjectID.generate();

const RESULT_URL: URL = URL.fromString(
  "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/result",
);

function makeScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    cidr: "10.0.0.0/24",
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeProgress(
  overrides: Partial<SubnetScanProgress> = {},
): SubnetScanProgress {
  return {
    sweptHostCount: 512,
    totalHostCount: 15360,
    discoveredHosts: [
      { ipAddress: "10.0.0.5", sysName: "sw1", snmpReachable: true },
      { ipAddress: "10.0.0.9", snmpReachable: false },
    ],
    snmpResponderCount: 1,
    respondedToPingCount: 2,
    isIcmpOnlySweep: false,
    ...overrides,
  };
}

function makeScanResult(
  overrides?: Partial<SubnetScanResult>,
): SubnetScanResult {
  return {
    discoveredHosts: [
      { ipAddress: "10.0.0.5", sysName: "sw1", snmpReachable: true },
    ],
    scannedHostCount: 254,
    scannedPorts: [161],
    responderCountByConfigId: { legacy: 1 },
    respondedToPingCount: 12,
    ...overrides,
  } as SubnetScanResult;
}

/*
 * The bodies of every POST the probe made, in order.
 *
 * Typed structurally rather than as a jest spy: the spy's own generic type is
 * unwieldy here (API.fetch is generic over its response model) and nothing in
 * this file needs more than the recorded calls.
 */
type CallRecorder = { mock: { calls: Array<Array<unknown>> } };

function postedBodies(fetchSpy: unknown): Array<JSONObject> {
  return (fetchSpy as CallRecorder).mock.calls.map(
    (call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    },
  );
}

function partialBodies(fetchSpy: unknown): Array<JSONObject> {
  return postedBodies(fetchSpy).filter((body: JSONObject) => {
    return body["isPartial"] === true;
  });
}

stubReverseDnsAsResolvingNothing();

describe("buildScanProgressMessage", () => {
  /*
   * The sentence lands in the scan's statusMessage while it is still running,
   * so it is what an operator reads on a scan that will not finish for another
   * twenty minutes. Its one job the final summary does not have: to say that
   * the numbers beside it are a running total.
   */
  test("says the numbers are a running total, and names both ends of it", () => {
    const message: string = buildScanProgressMessage(
      makeProgress({ sweptHostCount: 1024, totalHostCount: 15360 }),
    );

    expect(message).toContain("Scan in progress");
    expect(message).toContain("1,024 of 15,360 addresses swept so far");
    expect(message).toContain("update as the sweep continues");
  });

  test("reports both answer counts on an SNMP sweep", () => {
    const message: string = buildScanProgressMessage(
      makeProgress({ respondedToPingCount: 7, snmpResponderCount: 3 }),
    );

    expect(message).toContain("7 answered ICMP ping");
    expect(message).toContain("3 answered SNMP");
  });

  /*
   * The same rule the final summary follows: an SNMP count on a scan that
   * asked nothing about SNMP is a finding about a question nobody put.
   */
  test("an ICMP-only sweep is never described as having asked for SNMP", () => {
    const message: string = buildScanProgressMessage(
      makeProgress({
        isIcmpOnlySweep: true,
        snmpResponderCount: 0,
        respondedToPingCount: 12,
      }),
    );

    expect(message).toContain("12 answered ICMP ping");
    expect(message).toContain("Check SNMP is off for this scan");
    expect(message).not.toContain("answered SNMP");
  });

  /*
   * A count over an unknown subset of the range is not a count, so it is
   * omitted rather than shown as zero — which would read as "nothing on this
   * subnet answers ping".
   */
  test("omits the ICMP tally once the pre-sweep has broken", () => {
    const message: string = buildScanProgressMessage(
      makeProgress({ respondedToPingCount: undefined }),
    );

    expect(message).toContain("ICMP pre-sweep is unavailable");
    expect(message).not.toContain("answered ICMP ping");
  });

  // statusMessage is a varchar(500); the probe keeps itself inside it.
  test("fits the statusMessage column", () => {
    const message: string = buildScanProgressMessage(
      makeProgress({
        sweptHostCount: 32768,
        totalHostCount: 32768,
        respondedToPingCount: undefined,
      }),
    );

    expect(message.length).toBeLessThanOrEqual(500);
  });
});

describe("ScanProgressReporter", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let fetchSpy = jest.spyOn(API, "fetch");

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeReporter(intervalInMs: number = 0): ScanProgressReporter {
    return new ScanProgressReporter({
      scanId: scanId.toString(),
      resultUrl: RESULT_URL,
      intervalInMs: intervalInMs,
    });
  }

  test("posts the running result to the same result endpoint, flagged partial", async () => {
    const reporter: ScanProgressReporter = makeReporter();

    reporter.report(makeProgress());
    await reporter.settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const call: { url: URL; data: JSONObject } = fetchSpy.mock
      .calls[0]![0] as unknown as { url: URL; data: JSONObject };

    expect(call.url.toString()).toBe(RESULT_URL.toString());
    /*
     * The flag is what stops the server reading this as a finished run: it
     * keeps the scan In Progress and leaves completedAt and the recurrence
     * schedule alone.
     */
    expect(call.data["isPartial"]).toBe(true);
    expect(call.data["success"]).toBe(true);
    expect(call.data["scanId"]).toBe(scanId.toString());
  });

  test("uploads the hosts found so far and the addresses swept so far", async () => {
    const reporter: ScanProgressReporter = makeReporter();

    reporter.report(
      makeProgress({ sweptHostCount: 2048, totalHostCount: 15360 }),
    );
    await reporter.settle();

    const body: JSONObject = postedBodies(fetchSpy)[0]!;

    expect(body["discoveredDevices"]).toHaveLength(2);
    /*
     * Swept so far, NOT the size of the range: the message beside it says
     * which of the two the number is, and the scans list renders the two
     * together.
     */
    expect(body["scannedHostCount"]).toBe(2048);
    expect(String(body["statusMessage"])).toContain(
      "2,048 of 15,360 addresses swept so far",
    );
  });

  test("carries the probe's own credentials, like every other ingest call", async () => {
    const reporter: ScanProgressReporter = makeReporter();

    reporter.report(makeProgress());
    await reporter.settle();

    const body: JSONObject = postedBodies(fetchSpy)[0]!;

    expect(body["probeKey"]).toBe("test-probe-key");
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
  });

  describe("throttling", () => {
    test("does not upload before the interval has passed", async () => {
      // A one-minute interval, and no time passes inside this test.
      const reporter: ScanProgressReporter = makeReporter(60_000);

      reporter.report(makeProgress());
      reporter.report(makeProgress({ sweptHostCount: 1024 }));
      await reporter.settle();

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("uploads again once the interval has passed", async () => {
      // eslint-disable-next-line @typescript-eslint/typedef
      const nowSpy = jest.spyOn(Date, "now");
      nowSpy.mockReturnValue(1_000_000);

      const reporter: ScanProgressReporter = makeReporter(30_000);

      // Same instant as construction: too soon.
      reporter.report(makeProgress());
      await reporter.settle();
      expect(fetchSpy).not.toHaveBeenCalled();

      nowSpy.mockReturnValue(1_000_000 + 30_000);
      reporter.report(makeProgress({ sweptHostCount: 1024 }));
      await reporter.settle();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // And immediately after, it is throttled again.
      reporter.report(makeProgress({ sweptHostCount: 1536 }));
      await reporter.settle();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * A slow server must not build a backlog of stale uploads: the second
     * report is DROPPED rather than queued, because the next one carries a
     * superset of it anyway.
     */
    test("drops a report that arrives while an upload is still in flight", async () => {
      let releaseUpload: (value: unknown) => void = () => {};

      fetchSpy.mockImplementation((): never => {
        return new Promise((resolve: (value: unknown) => void) => {
          releaseUpload = resolve;
        }) as never;
      });

      const reporter: ScanProgressReporter = makeReporter();

      reporter.report(makeProgress({ sweptHostCount: 512 }));
      reporter.report(makeProgress({ sweptHostCount: 1024 }));
      reporter.report(makeProgress({ sweptHostCount: 1536 }));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(postedBodies(fetchSpy)[0]!["scannedHostCount"]).toBe(512);

      releaseUpload({ data: [] });
      await reporter.settle();
    });
  });

  describe("it can never break the sweep", () => {
    test("report() returns without waiting for the network", async () => {
      let releaseUpload: (value: unknown) => void = () => {};

      fetchSpy.mockImplementation((): never => {
        return new Promise((resolve: (value: unknown) => void) => {
          releaseUpload = resolve;
        }) as never;
      });

      const reporter: ScanProgressReporter = makeReporter();

      const returnedSynchronously: boolean = ((): boolean => {
        reporter.report(makeProgress());
        return true;
      })();

      /*
       * The upload is still open — report() did not await it. That is the
       * property: the sweep runs inside a deadline race, so an upload that
       * blocked would spend the sweep's own budget.
       */
      expect(returnedSynchronously).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      releaseUpload({ data: [] });
      await reporter.settle();
    });

    test("a rejected upload is swallowed, not thrown at the sweep", async () => {
      fetchSpy.mockRejectedValue(new Error("connect ECONNREFUSED") as never);

      const reporter: ScanProgressReporter = makeReporter();

      reporter.report(makeProgress());

      await expect(reporter.settle()).resolves.toBeUndefined();
    });

    /*
     * API.fetch RETURNS a 4xx/5xx rather than throwing, so this path is not
     * covered by the rejection case above.
     */
    test("a rejected-by-the-server upload is swallowed too", async () => {
      fetchSpy.mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: "Discovery scan not found" },
          {},
        ) as never,
      );

      const reporter: ScanProgressReporter = makeReporter();

      reporter.report(makeProgress());

      await expect(reporter.settle()).resolves.toBeUndefined();
    });

    test("settle() is safe when nothing has ever been reported", async () => {
      const reporter: ScanProgressReporter = makeReporter();

      await expect(reporter.settle()).resolves.toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("runScan — the sweep reports progress and then its result", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let fetchSpy = jest.spyOn(API, "fetch");
  // eslint-disable-next-line @typescript-eslint/typedef
  let scanSpy = jest.spyOn(SubnetScanner, "scan");

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: [] } as never);
    scanSpy = jest
      .spyOn(SubnetScanner, "scan")
      .mockResolvedValue(makeScanResult() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("hands the sweep a progress callback", async () => {
    await runScan(makeScan());

    const config: SubnetScanConfig = scanSpy.mock
      .calls[0]![0] as SubnetScanConfig;

    expect(typeof config.onProgress).toBe("function");
  });

  test("a progress report from the sweep reaches the ingest endpoint", async () => {
    /*
     * Time is moved forward between the reporter's construction and the
     * report, because the reporter starts its clock when the scan is claimed —
     * a partial one segment later would only rewrite the emptiness the claim
     * just wrote.
     */
    // eslint-disable-next-line @typescript-eslint/typedef
    const nowSpy = jest.spyOn(Date, "now");
    let currentTime: number = 1_000_000;
    nowSpy.mockImplementation((): number => {
      return currentTime;
    });

    scanSpy.mockImplementation(
      async (config: SubnetScanConfig): Promise<SubnetScanResult> => {
        currentTime += 10 * 60 * 1000;
        await config.onProgress?.(
          makeProgress({ sweptHostCount: 4096, totalHostCount: 15360 }),
        );
        return makeScanResult();
      },
    );

    await runScan(makeScan());

    const partials: Array<JSONObject> = partialBodies(fetchSpy);

    expect(partials).toHaveLength(1);
    expect(partials[0]!["scanId"]).toBe(scanId.toString());
    expect(partials[0]!["scannedHostCount"]).toBe(4096);
    expect(partials[0]!["discoveredDevices"]).toHaveLength(2);
  });

  /*
   * Ordering matters more than it looks: a partial that landed AFTER the
   * final upload would replace a finished scan's results — reverse-DNS names
   * and all — with the snapshot that preceded them.
   */
  test("the final result is uploaded after any in-flight partial has settled", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const nowSpy = jest.spyOn(Date, "now");
    let currentTime: number = 1_000_000;
    nowSpy.mockImplementation((): number => {
      return currentTime;
    });

    const completedUploads: Array<string> = [];
    let releasePartial: (value: unknown) => void = () => {};

    fetchSpy.mockImplementation((request: unknown): never => {
      const body: JSONObject = (request as { data: JSONObject }).data;

      if (body["isPartial"] === true) {
        return new Promise((resolve: (value: unknown) => void) => {
          releasePartial = (value: unknown): void => {
            completedUploads.push("partial");
            resolve(value);
          };
        }) as never;
      }

      completedUploads.push("final");
      return Promise.resolve({ data: [] }) as never;
    });

    scanSpy.mockImplementation(
      async (config: SubnetScanConfig): Promise<SubnetScanResult> => {
        currentTime += 10 * 60 * 1000;
        await config.onProgress?.(makeProgress());
        return makeScanResult();
      },
    );

    const run: Promise<void> = runScan(makeScan());

    // The final upload cannot have happened while the partial is open.
    await Promise.resolve();
    expect(completedUploads).toEqual([]);

    releasePartial({ data: [] });
    await run;

    expect(completedUploads).toEqual(["partial", "final"]);
  });

  test("a failure report is sent after any in-flight partial has settled too", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const nowSpy = jest.spyOn(Date, "now");
    let currentTime: number = 1_000_000;
    nowSpy.mockImplementation((): number => {
      return currentTime;
    });

    const completedUploads: Array<string> = [];
    let releasePartial: (value: unknown) => void = () => {};

    fetchSpy.mockImplementation((request: unknown): never => {
      const body: JSONObject = (request as { data: JSONObject }).data;

      if (body["isPartial"] === true) {
        return new Promise((resolve: (value: unknown) => void) => {
          releasePartial = (value: unknown): void => {
            completedUploads.push("partial");
            resolve(value);
          };
        }) as never;
      }

      completedUploads.push("failure");
      return Promise.resolve({ data: [] }) as never;
    });

    scanSpy.mockImplementation(
      async (config: SubnetScanConfig): Promise<SubnetScanResult> => {
        currentTime += 10 * 60 * 1000;
        await config.onProgress?.(makeProgress());
        throw new Error("The sweep of 10.0.0.0/24 did not finish in time");
      },
    );

    const run: Promise<void> = runScan(makeScan());

    await Promise.resolve();
    expect(completedUploads).toEqual([]);

    releasePartial({ data: [] });
    await run;

    expect(completedUploads).toEqual(["partial", "failure"]);

    const failureBody: JSONObject = postedBodies(fetchSpy).filter(
      (body: JSONObject) => {
        return body["success"] === false;
      },
    )[0]!;

    expect(failureBody["isPartial"]).toBeUndefined();
  });

  test("a sweep shorter than the progress interval posts only its final result", async () => {
    await runScan(makeScan());

    /*
     * The reporter's clock starts when the scan is claimed, so a sweep that
     * finishes inside the interval never sends a partial — the final upload
     * says everything there is to say.
     */
    expect(partialBodies(fetchSpy)).toHaveLength(0);
    expect(postedBodies(fetchSpy)).toHaveLength(1);
    expect(postedBodies(fetchSpy)[0]!["success"]).toBe(true);
  });
});
