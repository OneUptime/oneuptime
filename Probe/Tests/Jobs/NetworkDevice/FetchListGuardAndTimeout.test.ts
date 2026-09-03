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

import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import PingMonitor from "../../../Utils/Monitors/MonitorTypes/PingMonitor";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import InitJob, {
  resetDevicePollRunInProgress,
} from "../../../Jobs/NetworkDevice/FetchList";

/*
 * The polling logic itself is covered by FetchList.test.ts. These tests pin
 * the liveness fixes on the device-poll job:
 *
 *   - the list fetch carries an explicit deadline (axios's default timeout
 *     is 0 = infinite, so a hung fetch used to pile up one new request per
 *     minute forever), and
 *   - the single-flight guard covers ONLY the fetch: the server claims due
 *     devices atomically when handing out the list, so overlapping ticks
 *     poll disjoint device sets — a fleet whose poll cycle exceeds a minute
 *     must keep fetching at its cadence, not degrade to one fetch per
 *     cycle.
 */

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

beforeEach(() => {
  // A wedged in-flight fetch from a previous test must never leak in.
  resetDevicePollRunInProgress();
  mockCapturedCronJobs.length = 0;
  fetchSpy = jest
    .spyOn(API, "fetch")
    .mockResolvedValue({ data: { devices: [] } } as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    // Keep test output clean.
  });
  /*
   * Every poll now pings its device before anything else. Never let that
   * reach the OS ping binary from a test: it would fork a real process
   * against 10.0.0.5 and outlive the test.
   */
  jest.spyOn(PingMonitor, "checkReachability").mockResolvedValue({
    isOnline: true,
    avgRttMs: 1,
    packetLossPercent: 0,
    failureCause: "",
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function capturedRunFunction(): PromiseVoidFunction {
  InitJob();
  const captured: CapturedCronJob | undefined =
    mockCapturedCronJobs[mockCapturedCronJobs.length - 1];
  if (!captured) {
    throw new Error("InitJob did not register a cron job");
  }
  return captured.runFunction;
}

describe("network-device job — deadline and fetch-only overlap guard", () => {
  test("the device list fetch carries the 45s deadline", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    await runFunction();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const arg: JSONObject = fetchSpy.mock.calls[0]![0] as unknown as JSONObject;
    expect(String(arg["url"])).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/network-device/list",
    );

    const body: JSONObject = arg["data"] as JSONObject;
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");

    /*
     * THE timeout pin: this fetch used to go out with no options object at
     * all, so an unresponsive server hung it forever while node-cron
     * stacked a new one every minute.
     */
    expect((arg["options"] as JSONObject)["timeout"]).toBe(45000);
  });

  /*
   * The capability gate. The server hands credential-less (ping-only)
   * devices only to probes that declare they can ping them; a probe that
   * stops sending this silently loses every ping-only device in its fleet
   * (they stay Pending server-side) with no error anywhere.
   */
  test("the device list fetch declares the networkDevicePing capability", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    await runFunction();

    const arg: JSONObject = fetchSpy.mock.calls[0]![0] as unknown as JSONObject;
    const body: JSONObject = arg["data"] as JSONObject;
    expect(body["probeCapabilities"]).toEqual(["networkDevicePing"]);
  });

  test("a tick that arrives while the list fetch is still in flight is skipped", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockReturnValue(
      new Promise<never>(() => {
        // Never settles — a list fetch stuck on an unresponsive server.
      }) as never,
    );

    const firstTick: Promise<void> = runFunction();
    await flushMicrotasks();

    await runFunction();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Never settles by design; the beforeEach reset unwedges the next test.
    void firstTick;
  });

  test("a failed list fetch releases the guard — the next tick fetches again", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    // The job catches and logs internally; the tick itself must resolve.
    await expect(runFunction()).resolves.toBeUndefined();
    await expect(runFunction()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  /*
   * The guard covers ONLY the fetch. The server claims due devices
   * atomically, so overlapping poll cycles walk disjoint sets — a slow
   * device fleet (5s SNMP timeouts, retries) whose cycle exceeds the
   * minute must not throttle the fetch cadence down to one per cycle.
   */
  test("an in-flight poll cycle does not block the next tick's fetch", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockResolvedValue({
      data: {
        devices: [
          {
            networkDeviceId: "device-1",
            projectId: "project-1",
            collectEndpoints: false,
            snmpMonitor: { hostname: "10.0.0.5" },
          },
        ],
      },
    } as never);

    // eslint-disable-next-line @typescript-eslint/typedef
    const querySpy = jest.spyOn(SnmpMonitor, "query").mockReturnValue(
      new Promise<never>(() => {
        // Never settles — an SNMP walk mid-flight.
      }) as never,
    );

    const firstTick: Promise<void> = runFunction();
    await flushMicrotasks();

    // The walk is still running, but the guard was already released...
    const secondTick: Promise<void> = runFunction();
    await flushMicrotasks();

    // ...so the second tick fetched a fresh device list.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(querySpy).toHaveBeenCalled();

    // Never settle by design; module state dies with this test file.
    void firstTick;
    void secondTick;
  });

  /*
   * Same liveness property for a ping-only device: the ping runs inside the
   * poll, not the fetch, so a slow ping must not hold the guard either.
   */
  test("an in-flight ping does not block the next tick's fetch", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockResolvedValue({
      data: {
        devices: [
          {
            networkDeviceId: "device-1",
            projectId: "project-1",
            hostname: "10.0.0.5",
            pollMode: "ping",
            collectEndpoints: false,
          },
        ],
      },
    } as never);

    // eslint-disable-next-line @typescript-eslint/typedef
    const pingSpy = jest
      .spyOn(PingMonitor, "checkReachability")
      .mockReturnValue(
        new Promise<never>(() => {
          // Never settles — a ping mid-flight.
        }),
      );

    const firstTick: Promise<void> = runFunction();
    await flushMicrotasks();

    const secondTick: Promise<void> = runFunction();
    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(pingSpy).toHaveBeenCalled();

    void firstTick;
    void secondTick;
  });
});
