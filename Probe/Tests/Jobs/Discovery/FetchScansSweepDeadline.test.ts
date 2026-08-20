// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";
/*
 * The smallest deadline Config accepts (parseNumberWithDefault falls back to
 * the 90-minute default for anything below its 1000ms floor). Set here, before
 * the import, so these tests drive the REAL Config -> runScan wiring rather
 * than a value passed in by hand.
 */
process.env["PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS"] = "1000";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import SubnetScanner, {
  SubnetScanConfig,
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import InitJob, {
  runScan,
  scanWithDeadline,
  resetDiscoveryRunInProgress,
} from "../../../Jobs/Discovery/FetchScans";

/*
 * A sweep that never settles must not stop discovery forever.
 *
 * The discovery cron holds a single-flight guard for the WHOLE cycle — list
 * fetch, sweep, result upload — and clears it only in a `finally`. Both HTTP
 * calls carry a 45s deadline, but the sweep between them had none, and a
 * sweep is the part most likely to hang: it opens one ICMP child process and
 * one UDP SNMP session per address, up to 32,768 of them.
 *
 * One non-settling promise in there did not cost a cycle. It stranded the
 * guard set for the lifetime of the process, so the probe never asked for
 * another scan, and every scan afterwards sat in "Pending" until someone
 * restarted the container — with nothing anywhere in the product to say why.
 * That is the failure mode OneUptime issue #3287 describes.
 *
 * FetchScansGuardAndTimeout.test.ts already pins that the guard releases when
 * the FETCH fails. These pin the case it could not reach: the sweep itself.
 */

const scanId: ObjectID = ObjectID.generate();

function makeScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    cidr: "10.240-249.0-254.220-226",
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeScanResult(): SubnetScanResult {
  return {
    discoveredHosts: [],
    scannedHostCount: 254,
    scannedPort: 161,
    respondedToPingCount: 0,
    snmpErrorHostCount: 0,
    icmpFilteredFallbackHostCount: 0,
  } as unknown as SubnetScanResult;
}

const scanConfig: SubnetScanConfig = {
  cidr: "10.240-249.0-254.220-226",
};

// A sweep that never settles, exactly as a wedged ping/SNMP promise behaves.
function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Intentionally empty.
  });
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let scanSpy = jest.spyOn(SubnetScanner, "scan");
// eslint-disable-next-line @typescript-eslint/typedef
let errorSpy = jest.spyOn(logger, "error");

beforeEach(() => {
  resetDiscoveryRunInProgress();
  mockCapturedCronJobs.length = 0;
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  scanSpy = jest
    .spyOn(SubnetScanner, "scan")
    .mockResolvedValue(makeScanResult() as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    // Keep test output clean.
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function loggedErrors(): string {
  return errorSpy.mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
}

describe("scanWithDeadline — a sweep that finishes", () => {
  test("returns the sweep's own result untouched", async () => {
    const result: SubnetScanResult = makeScanResult();
    scanSpy.mockResolvedValue(result as never);

    await expect(scanWithDeadline(scanConfig, "scan-1", 5000)).resolves.toBe(
      result,
    );
  });

  test("passes the config straight through to the scanner", async () => {
    await scanWithDeadline(scanConfig, "scan-1", 5000);

    expect(scanSpy).toHaveBeenCalledWith(scanConfig);
  });

  /*
   * The deadline here is up to 90 minutes. An un-cleared timer of that length
   * keeps the Node event loop alive after an otherwise healthy sweep, which
   * on a probe that is shutting down looks like a hung container.
   */
  test("clears its timer, so a healthy sweep leaves nothing pending", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const clearSpy = jest.spyOn(global, "clearTimeout");

    await scanWithDeadline(scanConfig, "scan-1", 5000);

    expect(clearSpy).toHaveBeenCalled();
  });

  test("a sweep that REJECTS still clears its timer", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const clearSpy = jest.spyOn(global, "clearTimeout");
    scanSpy.mockRejectedValue(new Error("target is malformed") as never);

    await expect(scanWithDeadline(scanConfig, "scan-1", 5000)).rejects.toThrow(
      "target is malformed",
    );

    expect(clearSpy).toHaveBeenCalled();
  });

  test("a sweep's own failure is passed through, not replaced by the deadline", async () => {
    scanSpy.mockRejectedValue(new Error("ICMP ping is not usable") as never);

    await expect(scanWithDeadline(scanConfig, "scan-1", 5000)).rejects.toThrow(
      "ICMP ping is not usable",
    );
  });
});

describe("scanWithDeadline — a sweep that never settles", () => {
  test("rejects instead of hanging forever", async () => {
    scanSpy.mockImplementation(() => {
      return neverSettles<SubnetScanResult>() as never;
    });

    await expect(
      scanWithDeadline(scanConfig, "scan-1", 50),
    ).rejects.toBeInstanceOf(Error);
  });

  /*
   * The message becomes the scan's statusMessage, so it is the only thing the
   * operator sees on the row. It has to name the target (which of several
   * scans this was) and the way out.
   */
  test("names the scan target and the knob that raises the deadline", async () => {
    scanSpy.mockImplementation(() => {
      return neverSettles<SubnetScanResult>() as never;
    });

    await expect(scanWithDeadline(scanConfig, "scan-1", 50)).rejects.toThrow(
      /10\.240-249\.0-254\.220-226/,
    );
    await expect(scanWithDeadline(scanConfig, "scan-1", 50)).rejects.toThrow(
      /PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS/,
    );
  });

  test("logs which scan stopped settling, at error level", async () => {
    scanSpy.mockImplementation(() => {
      return neverSettles<SubnetScanResult>() as never;
    });

    await expect(scanWithDeadline(scanConfig, "scan-42", 50)).rejects.toThrow();

    expect(loggedErrors()).toContain("scan-42");
  });
});

describe("runScan — a wedged sweep is reported, not swallowed", () => {
  test("reports the scan as failed with the deadline as the reason", async () => {
    scanSpy.mockImplementation(() => {
      return neverSettles<SubnetScanResult>() as never;
    });

    await runScan(makeScan());

    /*
     * The failure report is what moves the row off "In Progress". Without it
     * the scan waits for the server's 2-hour reaper with no explanation.
     */
    const uploads: Array<JSONObject> = fetchSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as JSONObject)["data"] as JSONObject;
      },
    );

    expect(uploads).toHaveLength(1);
    expect(uploads[0]!["success"]).toBe(false);
    expect(String(uploads[0]!["statusMessage"])).toContain("did not finish");
    expect(uploads[0]!["scanId"]).toBe(scanId.toString());
  });

  test("uses the configured deadline, not an unbounded wait", async () => {
    scanSpy.mockImplementation(() => {
      return neverSettles<SubnetScanResult>() as never;
    });

    const startedAt: number = Date.now();
    await runScan(makeScan());

    /*
     * PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS is 1000 for this file. The upper
     * bound is generous — the point is that it returned at all.
     */
    expect(Date.now() - startedAt).toBeLessThan(20000);
  });
});

describe("the overlap guard survives a wedged sweep", () => {
  function capturedRunFunction(): PromiseVoidFunction {
    InitJob();
    const captured: CapturedCronJob | undefined =
      mockCapturedCronJobs[mockCapturedCronJobs.length - 1];
    if (!captured) {
      throw new Error("InitJob did not register a cron job");
    }
    return captured.runFunction;
  }

  /*
   * THE regression test for issue #3287's failure mode. Before the deadline,
   * this second tick returned immediately without fetching — and so did every
   * tick after it, forever.
   */
  test("a tick whose sweep never settles still releases the guard, so the next tick fetches again", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockResolvedValue({
      data: [{ _id: scanId.toString(), cidr: "10.0.0.0/30" }],
    } as never);
    scanSpy.mockImplementation(() => {
      return neverSettles<SubnetScanResult>() as never;
    });

    await expect(runFunction()).resolves.toBeUndefined();

    const callsAfterFirstTick: number = fetchSpy.mock.calls.length;

    await expect(runFunction()).resolves.toBeUndefined();

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstTick);
  });

  test("and the scan that wedged it is reported failed rather than left silent", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockResolvedValue({
      data: [{ _id: scanId.toString(), cidr: "10.0.0.0/30" }],
    } as never);
    scanSpy.mockImplementation(() => {
      return neverSettles<SubnetScanResult>() as never;
    });

    await runFunction();

    const failureReports: Array<JSONObject> = fetchSpy.mock.calls
      .map((call: Array<unknown>) => {
        return (call[0] as JSONObject)["data"] as JSONObject;
      })
      .filter((body: JSONObject) => {
        return body["success"] === false;
      });

    expect(failureReports).toHaveLength(1);
  });
});
