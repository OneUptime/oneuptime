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
import ObjectID from "Common/Types/ObjectID";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import InitJob, {
  resetMonitorTestRunInProgress,
} from "../../../Jobs/Monitor/FetchMonitorTest";

/*
 * The monitor-test job fires EVERY_TEN_SECONDS and node-cron does not wait
 * for the previous run — against a slow server that is 6 new hung requests
 * per minute, the fastest-growing pile-up of all the probe's cron jobs.
 * These tests pin the two liveness fixes: an explicit deadline on the list
 * fetch (axios's default timeout is 0 = infinite) and a skip-tick overlap
 * guard.
 */

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

beforeEach(() => {
  mockCapturedCronJobs.length = 0;
  // A test that wedges a run in flight must never leak into the next case.
  resetMonitorTestRunInProgress();
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
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

describe("monitor-test job — deadline and overlap guard", () => {
  test("the list fetch is authenticated as this probe and carries the 45s deadline", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    await runFunction();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const arg: JSONObject = fetchSpy.mock.calls[0]![0] as unknown as JSONObject;
    expect(String(arg["url"])).toBe(
      "https://oneuptime.example.com/probe-ingest/monitor-test/list",
    );

    const body: JSONObject = arg["data"] as JSONObject;
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");
    expect(body["limit"]).toBe(100);

    /*
     * THE timeout pin: this fetch used to go out with no options, so an
     * unresponsive server hung it forever — at 6 ticks a minute, forever
     * adds up fast.
     */
    expect((arg["options"] as JSONObject)["timeout"]).toBe(45000);
  });

  test("a failed list fetch releases the guard — the next tick fetches again", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });

    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    // The job catches and logs internally; the tick itself must resolve.
    await expect(runFunction()).resolves.toBeUndefined();
    await expect(runFunction()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("a tick that arrives while the previous run is still in flight is skipped", async () => {
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

    // Never settles by design; module state dies with this test file.
    void firstTick;
  });

  /*
   * The guard covers ONLY the list fetch. The server hands each test out
   * exactly once, so overlapping ticks execute disjoint batches — and
   * "Test monitor" is an interactive flow: a long-running synthetic test
   * (legitimately up to minutes) must not delay the pickup of the next
   * user's test by even one tick.
   */
  test("a long-running test batch does not block the next tick's fetch", async () => {
    const runFunction: PromiseVoidFunction = capturedRunFunction();

    fetchSpy.mockResolvedValue({
      data: [{ _id: ObjectID.generate().toString() }],
    } as never);

    // eslint-disable-next-line @typescript-eslint/typedef
    const probeSpy = jest
      .spyOn(MonitorUtil, "probeMonitorTest")
      .mockReturnValue(
        new Promise<never>(() => {
          // Never settles — a synthetic test mid-run.
        }) as never,
      );

    const firstTick: Promise<void> = runFunction();
    await flushMicrotasks();

    // The batch is still probing, but the guard was already released...
    const secondTick: Promise<void> = runFunction();
    await flushMicrotasks();

    // ...so the second tick fetched a fresh list.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(probeSpy).toHaveBeenCalled();

    // Never settle by design; module state dies with this test file.
    void firstTick;
    void secondTick;
  });
});
