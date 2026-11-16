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
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import { FetchListAndProbe } from "../../Jobs/Monitor/FetchList";
import InitMonitorTestJob from "../../Jobs/Monitor/FetchMonitorTest";
import { fetchDeviceList } from "../../Jobs/NetworkDevice/FetchList";
import MonitorUtil from "../../Utils/Monitors/Monitor";
import { PROBE_CAPABILITIES } from "../../Utils/ProbeAPIRequest";
import ServerBusy, {
  DEFAULT_SERVER_BUSY_BACK_OFF_MS,
  MAX_SERVER_BUSY_BACK_OFF_MS,
  SERVER_BUSY_WARNING_EVERY_MS,
} from "../../Utils/ServerBusy";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

/*
 * A busy answer from a scheduling endpoint (#7920). The server runs a
 * bounded number of probe scheduling requests at once, so they can never
 * take the database connections sign-ins need; a request past that bound
 * is answered 429 - this probe declares "retryWhenBusy" - and has claimed
 * nothing. The monitor, monitor test and network device fetches read it as
 * "ask again at the next tick": no error, nothing probed, one warning a
 * minute at most.
 */

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

function busyAnswer(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    429,
    {
      message:
        "This OneUptime server is busy handing out work to probes. The probe asks again at its next tick.",
    },
    { "retry-after": "10" },
  );
}

// eslint-disable-next-line @typescript-eslint/typedef
let warnSpy = jest.spyOn(logger, "warn");
// eslint-disable-next-line @typescript-eslint/typedef
let errorSpy = jest.spyOn(logger, "error");

beforeEach(() => {
  ServerBusy.reset();
  mockCapturedCronJobs.length = 0;
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  // The monitor fetch sleeps up to 45 s first to spread workers out.
  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ServerBusy", () => {
  test("a 429 is a busy answer; any other answer is not", () => {
    expect(ServerBusy.isBusyAnswer(busyAnswer())).toBe(true);
    expect(
      ServerBusy.isBusyAnswer(new HTTPErrorResponse(500, { message: "x" }, {})),
    ).toBe(false);
    expect(
      ServerBusy.isBusyAnswer(new HTTPErrorResponse(400, { message: "x" }, {})),
    ).toBe(false);
    expect(
      ServerBusy.isBusyAnswer(new HTTPResponse<JSONArray>(200, [], {})),
    ).toBe(false);
  });

  test("this probe tells the server it reads a 429 that way", () => {
    expect(PROBE_CAPABILITIES).toContain("retryWhenBusy");
    // From every work fetch, not only these three (issue #8051).
    expect(PROBE_CAPABILITIES).toContain("retryAllWorkWhenBusy");
  });

  test("a busy answer asks the fetch to wait its Retry-After, in seconds or as a date", () => {
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    expect(ServerBusy.backOffMs(busyAnswer())).toBe(10_000);
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(429, {}, { "retry-after": "25" }),
      ),
    ).toBe(25_000);
    // "0" waits a second: never at once.
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(429, {}, { "retry-after": "0" }),
      ),
    ).toBe(1_000);
    // Not every client lower-cases a header.
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(429, {}, { "Retry-After": "3" }),
      ),
    ).toBe(3_000);
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(
          429,
          {},
          { "retry-after": new Date(1_000_000 + 7_000).toUTCString() },
        ),
      ),
    ).toBe(7_000);
    // A date gone by - a server clock behind this one - waits a second.
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(
          429,
          {},
          { "retry-after": new Date(1_000_000 - 60_000).toUTCString() },
        ),
      ),
    ).toBe(1_000);
  });

  test("the obsolete RFC 850 and asctime dates are read too, asctime as UTC (issue #8928)", () => {
    // Thu, 01 Jan 1970 00:16:40 GMT.
    jest.spyOn(Date, "now").mockReturnValue(1_000_000);

    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(
          429,
          {},
          { "retry-after": "Thursday, 01-Jan-70 00:17:00 GMT" },
        ),
      ),
    ).toBe(20_000);
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(
          429,
          {},
          { "retry-after": "Thu Jan  1 00:16:52 1970" },
        ),
      ),
    ).toBe(12_000);
  });

  test("no Retry-After, or one that cannot be read, waits the server's ten seconds; none waits more than a minute", () => {
    expect(ServerBusy.backOffMs(new HTTPErrorResponse(429, {}, {}))).toBe(
      DEFAULT_SERVER_BUSY_BACK_OFF_MS,
    );
    expect(ServerBusy.backOffMs(undefined)).toBe(
      DEFAULT_SERVER_BUSY_BACK_OFF_MS,
    );
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(429, {}, { "retry-after": "soon" }),
      ),
    ).toBe(DEFAULT_SERVER_BUSY_BACK_OFF_MS);
    // Date.parse alone would read these as days in 2001, gone by: no wait.
    for (const unreadable of ["-5", "1.5", "5 seconds"]) {
      expect(
        ServerBusy.backOffMs(
          new HTTPErrorResponse(429, {}, { "retry-after": unreadable }),
        ),
      ).toBe(DEFAULT_SERVER_BUSY_BACK_OFF_MS);
    }
    // A proxy's hour would stall the work for an hour.
    expect(
      ServerBusy.backOffMs(
        new HTTPErrorResponse(429, {}, { "retry-after": "3600" }),
      ),
    ).toBe(MAX_SERVER_BUSY_BACK_OFF_MS);
  });

  test("a fetch backs off until its wait has passed, and only the fetch of the work that was refused", () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    expect(ServerBusy.isBackingOff("monitors")).toBe(false);

    ServerBusy.note("monitors", busyAnswer());

    expect(ServerBusy.isBackingOff("monitors")).toBe(true);
    expect(ServerBusy.isBackingOff("network devices")).toBe(false);

    now += 9_999;
    expect(ServerBusy.isBackingOff("monitors")).toBe(true);

    now += 1;
    expect(ServerBusy.isBackingOff("monitors")).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("is said at most once a minute for each kind of work, with how many fetches were answered busy since", () => {
    // The probe's Jest cannot fake timers on this Node; the clock is enough.
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    ServerBusy.note("monitors");
    ServerBusy.note("monitors");
    ServerBusy.note("monitors");
    ServerBusy.note("network devices");
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      "busy handing out monitors: 1 fetch(es)",
    );

    now += SERVER_BUSY_WARNING_EVERY_MS - 1;
    ServerBusy.note("monitors");
    expect(warnSpy).toHaveBeenCalledTimes(2);

    now += 1;
    ServerBusy.note("monitors");
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(String(warnSpy.mock.calls[2]![0])).toContain(
      "busy handing out monitors: 4 fetch(es) answered busy since the last report",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("the fetches, answered busy", () => {
  test("the monitor fetch probes nothing and logs no error", async () => {
    jest.spyOn(API, "fetch").mockResolvedValue(busyAnswer() as never);
    // eslint-disable-next-line @typescript-eslint/typedef
    const probe = jest.spyOn(MonitorUtil, "probeMonitor");

    await new FetchListAndProbe("Worker 1").run();

    expect(probe).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      "busy handing out monitors",
    );
  });

  test("the monitor test fetch probes nothing and logs no error", async () => {
    jest.spyOn(API, "fetch").mockResolvedValue(busyAnswer() as never);
    // eslint-disable-next-line @typescript-eslint/typedef
    const probe = jest.spyOn(MonitorUtil, "probeMonitorTest");

    InitMonitorTestJob();
    await mockCapturedCronJobs[mockCapturedCronJobs.length - 1]!.runFunction();

    expect(probe).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      "busy handing out monitor tests",
    );
  });

  test("the network device fetch hands out no devices", async () => {
    jest.spyOn(API, "fetch").mockResolvedValue(busyAnswer() as never);

    expect(await fetchDeviceList()).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      "busy handing out network devices",
    );
  });

  test("an older server's empty batch still reads as nothing due, quietly", async () => {
    jest
      .spyOn(API, "fetch")
      .mockResolvedValue(new HTTPResponse(200, { devices: [] }, {}) as never);

    expect(await fetchDeviceList()).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("each waits out the Retry-After before it asks again (issue #8051)", async () => {
    let now: number = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });
    jest
      .spyOn(MonitorUtil, "probeMonitorTest")
      .mockResolvedValue(undefined as never);
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(busyAnswer() as never);

    InitMonitorTestJob();
    const monitorTestTick: PromiseVoidFunction =
      mockCapturedCronJobs[mockCapturedCronJobs.length - 1]!.runFunction;

    await new FetchListAndProbe("Worker 1").run();
    await monitorTestTick();
    await fetchDeviceList();
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // Their next ticks come before the ten seconds the server asked for.
    now += 9_999;
    await new FetchListAndProbe("Worker 2").run();
    await monitorTestTick();
    expect(await fetchDeviceList()).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    now += 1;
    fetchSpy.mockResolvedValue(new HTTPResponse(200, [], {}) as never);
    await new FetchListAndProbe("Worker 2").run();
    await monitorTestTick();
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("every fetch declares the capability, so the server knows it may answer 429", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(new HTTPResponse(200, [], {}) as never);

    await new FetchListAndProbe("Worker 1").run();
    await fetchDeviceList();

    for (const call of fetchSpy.mock.calls) {
      const body: JSONObject = (call[0] as unknown as JSONObject)[
        "data"
      ] as JSONObject;
      expect(body["probeCapabilities"]).toContain("retryWhenBusy");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
