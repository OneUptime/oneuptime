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
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

/*
 * BasicCron would hand the runFunction to node-cron; capturing it instead
 * lets these tests drive the exact closure production runs — overlap guard
 * included — without a real scheduler.
 */
jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import SubnetScanner, {
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import InitJob, {
  fetchAndRunScans,
  runScan,
  resetDiscoveryRunInProgress,
} from "../../../Jobs/Discovery/FetchScans";
import { stubReverseDnsAsResolvingNothing } from "../../TestingUtils/StubReverseDns";

/*
 * The request-contract half of this job is covered by
 * FetchScansLifecycle.test.ts. These tests pin the liveness fixes:
 *
 *   - every control-plane request carries an explicit deadline (axios's
 *     default timeout is 0 = infinite, and a hung list fetch is exactly what
 *     wedged the customer's probe), and
 *   - one discovery cycle at a time: a subnet sweep legitimately runs many
 *     minutes (up to 4096 hosts), and before the guard every minutely tick
 *     stacked another fetch/sweep on top of the one still in flight.
 */

const scanId: ObjectID = ObjectID.generate();

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

function makeScanResult(): SubnetScanResult {
  return {
    discoveredHosts: [],
    scannedHostCount: 254,
    respondedToPingCount: 0,
  } as unknown as SubnetScanResult;
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let scanSpy = jest.spyOn(SubnetScanner, "scan");

beforeEach(() => {
  // A wedged in-flight run from a previous test must never leak in.
  resetDiscoveryRunInProgress();
  mockCapturedCronJobs.length = 0;
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  scanSpy = jest
    .spyOn(SubnetScanner, "scan")
    .mockResolvedValue(makeScanResult() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

type FetchCall = {
  url: string;
  body: JSONObject;
  options: JSONObject;
};

function fetchCalls(): Array<FetchCall> {
  return fetchSpy.mock.calls.map((call: Array<unknown>) => {
    const arg: JSONObject = call[0] as JSONObject;
    return {
      url: String(arg["url"]),
      body: arg["data"] as JSONObject,
      options: arg["options"] as JSONObject,
    };
  });
}

/*
 * Reverse DNS (issue #3529) runs at the end of scanWithDeadline, on whatever
 * hosts the sweep returned — including the hosts a MOCKED SubnetScanner.scan
 * hands back. Stubbed for this whole file so no test here queries the
 * machine's real resolver; ReverseDnsStubIntegrity.test.ts fails the build if
 * a file that drives this path forgets.
 */
stubReverseDnsAsResolvingNothing();

describe("request deadlines — no discovery request may hang forever", () => {
  test("the pending-scan list fetch carries the 45s deadline", async () => {
    await fetchAndRunScans();

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/list",
    );
    /*
     * This exact request hanging 45+s is the customer's field failure:
     * without a deadline the fetch never returned and (pre-guard) every
     * subsequent tick stacked another one.
     */
    expect(calls[0]!.options["timeout"]).toBe(45000);
  });

  test("the result report carries the deadline", async () => {
    await runScan(makeScan());

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/result",
    );
    expect(calls[0]!.body["success"]).toBe(true);
    expect(calls[0]!.options["timeout"]).toBe(45000);
  });

  test("the failure report carries the deadline too", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    scanSpy.mockRejectedValue(new Error("CIDR too large") as never);

    await runScan(makeScan());

    /*
     * The failure-report POST is the easiest call to forget: it exists so a
     * failed sweep does not strand the scan In Progress, and a hung failure
     * report would defeat that purpose just as thoroughly.
     */
    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body["success"]).toBe(false);
    expect(calls[0]!.options["timeout"]).toBe(45000);
  });

  /*
   * The deadline on the RESULT upload cuts both ways: the client can now
   * give up on an upload the server is actually still processing. The
   * client's abort does not cancel the server-side handler, so a
   * success:false report fired from that failure would race the sweep's
   * own Completed write — and, landing last, flip a finished scan to
   * Failed and wipe its discovered hosts. An upload failure must be logged
   * and dropped: the server's stale-In-Progress reaper self-heals a truly
   * lost result.
   */
  test("a failed RESULT upload does not fire a success:false overwrite", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    scanSpy.mockResolvedValue(makeScanResult() as never);
    fetchSpy.mockRejectedValue(
      new Error("timeout of 45000ms exceeded") as never,
    );

    await expect(runScan(makeScan())).resolves.toBeUndefined();

    // Exactly ONE fetch: the failed upload itself. No follow-up report.
    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body["success"]).toBe(true);
  });
});

describe("overlap guard — one discovery cycle at a time", () => {
  function capturedRunFunction(): PromiseVoidFunction {
    InitJob();
    const captured: CapturedCronJob | undefined =
      mockCapturedCronJobs[mockCapturedCronJobs.length - 1];
    if (!captured) {
      throw new Error("InitJob did not register a cron job");
    }
    return captured.runFunction;
  }

  test("a tick that arrives while the previous run is still in flight is skipped", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockReturnValue(
      new Promise<never>(() => {
        // Never settles — a list fetch stuck on an unresponsive server.
      }) as never,
    );

    /*
     * A subnet sweep legitimately runs for many minutes; before the guard
     * every minutely tick stacked another fetch/sweep on top of the stuck
     * one. The second tick must return without fetching.
     */
    const firstTick: Promise<void> = runFunction();
    await flushMicrotasks();

    await runFunction();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Never settles by design; the beforeEach guard reset un-wedges the file.
    void firstTick;
  });

  test("the guard releases after a completed run — the next tick fetches again", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    await runFunction();
    await runFunction();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("the guard releases after a failed run — one bad fetch cannot wedge discovery forever", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });

    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    // The runFunction catches and logs; the tick itself must resolve.
    await expect(runFunction()).resolves.toBeUndefined();
    await expect(runFunction()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });
});
