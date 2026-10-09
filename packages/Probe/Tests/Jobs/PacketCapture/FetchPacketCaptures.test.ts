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
  options: { schedule: string; runOnStartup: boolean };
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

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import PacketCaptureEndReason from "Common/Types/PacketCapture/PacketCaptureEndReason";
import {
  PACKET_CAPTURE_PROBE_CONCURRENCY,
  PacketCaptureJob,
  PacketCaptureListResponse,
} from "Common/Types/PacketCapture/PacketCaptureJob";
import PacketCaptureStatus from "Common/Types/PacketCapture/PacketCaptureStatus";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import {
  fetchAndRunPacketCaptures,
  FetchDependencies,
  fetchPacketCaptures,
  getRunningPacketCaptureIds,
  reportPacketCapture,
  resetPacketCaptureState,
  toReport,
  UPLOAD_TIMEOUT_IN_MS,
  waitForRunningCaptures,
} from "../../../Jobs/PacketCapture/FetchPacketCaptures";
import {
  PacketCaptureRunResult,
  RunPacketCaptureOptions,
} from "../../../Utils/PacketCapture/PacketCaptureRunner";
import { readPacketCaptureSettings } from "../../../Utils/PacketCapture/PacketCaptureSettings";

/*
 * The probe's half of packet capture, every ten seconds while captures are
 * on: ask for work - naming the captures it is running, which keeps them
 * alive on the server - stop the ones the answer names, start the new ones
 * (two at most), and answer every capture it was handed, with its file or
 * with why it failed. tcpdump is never run here: the runner is injected.
 */

const LIST_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/packet-capture/list";
const INGEST_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/packet-capture/response/ingest";

function job(
  id: string,
  overrides: Partial<PacketCaptureJob> = {},
): PacketCaptureJob {
  return {
    id: id,
    interfaceName: "eth0",
    bpfFilter: "port 53",
    maxDurationInSeconds: 60,
    maxPackets: 100,
    maxFileSizeInBytes: 1024 * 1024,
    ...overrides,
  };
}

interface Deferred {
  options: RunPacketCaptureOptions;
  resolve: (result: PacketCaptureRunResult) => void;
  reject: (error: Error) => void;
}

let runs: Array<Deferred>;
let listAnswers: Array<PacketCaptureListResponse | HTTPErrorResponse>;

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

const SETTINGS: FetchDependencies["settings"] = readPacketCaptureSettings({
  PROBE_PACKET_CAPTURE_ENABLED: "true",
  PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "600",
});

const DEPENDENCIES: FetchDependencies = {
  settings: SETTINGS,
  run: (options: RunPacketCaptureOptions): Promise<PacketCaptureRunResult> => {
    return new Promise<PacketCaptureRunResult>(
      (
        resolve: (result: PacketCaptureRunResult) => void,
        reject: (error: Error) => void,
      ) => {
        runs.push({ options, resolve, reject });
      },
    );
  },
};

const COMPLETED: PacketCaptureRunResult = {
  isFailure: false,
  pcap: Buffer.from([0xd4, 0xc3, 0xb2, 0xa1]),
  packetCount: 1,
  endReason: PacketCaptureEndReason.DurationReached,
};

type FetchCall = { url: string; body: JSONObject; options: JSONObject };

function calls(url: string): Array<FetchCall> {
  return fetchSpy.mock.calls
    .map((call: Array<unknown>): FetchCall => {
      const arg: JSONObject = call[0] as JSONObject;
      return {
        url: String(arg["url"]),
        body: arg["data"] as JSONObject,
        options: arg["options"] as JSONObject,
      };
    })
    .filter((call: FetchCall): boolean => {
      return call.url === url;
    });
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 5; index++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

beforeEach(() => {
  mockCapturedCronJobs.length = 0;
  resetPacketCaptureState();
  runs = [];
  listAnswers = [];

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async (
    request: JSONObject,
  ) => {
    if (String(request["url"]) === LIST_URL) {
      const answer: PacketCaptureListResponse | HTTPErrorResponse =
        listAnswers.shift() || { packetCaptures: [], stopPacketCaptureIds: [] };

      return answer instanceof HTTPErrorResponse
        ? answer
        : new HTTPResponse(200, answer as unknown as JSONObject, {});
    }

    return new HTTPResponse(200, { result: "ok" }, {});
  }) as never);

  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }
});

afterEach(async () => {
  for (const pending of runs) {
    pending.resolve(COMPLETED);
  }

  await waitForRunningCaptures();
  jest.restoreAllMocks();
});

describe("asking for work", () => {
  test("names the captures it runs, and how many more it can take", async () => {
    await fetchPacketCaptures({
      limit: 1,
      runningPacketCaptureIds: ["a"],
    });

    const [list] = calls(LIST_URL);

    expect(list!.body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(list!.body["probeKey"]).toBe("test-probe-key");
    expect(list!.body["limit"]).toBe(1);
    expect(list!.body["runningPacketCaptureIds"]).toEqual(["a"]);
  });

  test("reads the captures to start and the ids to stop", async () => {
    listAnswers.push({
      packetCaptures: [job("a")],
      stopPacketCaptureIds: ["b", 7 as unknown as string],
    });

    expect(
      await fetchPacketCaptures({ limit: 2, runningPacketCaptureIds: [] }),
    ).toEqual({ packetCaptures: [job("a")], stopPacketCaptureIds: ["b"] });
  });

  test("a server older than packet capture, or no server at all, is no work - logged", async () => {
    listAnswers.push(new HTTPErrorResponse(404, { message: "Not Found" }, {}));

    expect(
      await fetchPacketCaptures({ limit: 2, runningPacketCaptureIds: [] }),
    ).toEqual({ packetCaptures: [], stopPacketCaptureIds: [] });
    expect(String((logger.warn as jest.Mock).mock.calls[0]![0])).toContain(
      "HTTP 404",
    );

    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED") as never);

    expect(
      await fetchPacketCaptures({ limit: 2, runningPacketCaptureIds: [] }),
    ).toEqual({ packetCaptures: [], stopPacketCaptureIds: [] });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("answering a capture", () => {
  test("a finished capture is Completed, with its file as base64 and why it stopped", () => {
    expect(
      toReport("a", {
        ...COMPLETED,
        endReason: PacketCaptureEndReason.CaptureToolStopped,
        statusMessage: "tcpdump stopped by itself: gone",
      }),
    ).toEqual({
      packetCaptureId: "a",
      status: PacketCaptureStatus.Completed,
      endReason: PacketCaptureEndReason.CaptureToolStopped,
      statusMessage: "tcpdump stopped by itself: gone",
      pcapBase64: COMPLETED.pcap!.toString("base64"),
    });
  });

  test("one that matched nothing is Completed with no file", () => {
    expect(
      toReport("a", { isFailure: false, pcap: null, packetCount: 0 }),
    ).toEqual({
      packetCaptureId: "a",
      status: PacketCaptureStatus.Completed,
      endReason: undefined,
    });
  });

  test("one that could not run is Failed, with why", () => {
    expect(
      toReport("a", {
        isFailure: true,
        failureMessage: "tcpdump could not use the filter.",
        pcap: null,
        packetCount: 0,
      }),
    ).toEqual({
      packetCaptureId: "a",
      status: PacketCaptureStatus.Failed,
      statusMessage: "tcpdump could not use the filter.",
    });
    expect(
      toReport("a", { isFailure: true, pcap: null, packetCount: 0 })
        .statusMessage,
    ).toBe("The probe could not run this capture.");
  });

  test("is posted with room for a large file: a long deadline and no body cap", async () => {
    await reportPacketCapture(toReport("a", COMPLETED));

    const [report] = calls(INGEST_URL);

    expect(report!.body).toMatchObject({
      probeId: "11111111-2222-3333-4444-555555555555",
      probeKey: "test-probe-key",
      packetCaptureId: "a",
      status: PacketCaptureStatus.Completed,
    });
    expect(Number(report!.options["timeout"])).toBeGreaterThanOrEqual(
      UPLOAD_TIMEOUT_IN_MS,
    );
    expect(report!.options["maxBodyLength"]).toBe(Infinity);
    expect(UPLOAD_TIMEOUT_IN_MS).toBe(8 * 60 * 1000);
  });

  test("a refused report is logged, not retried", async () => {
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "No running packet capture with this id for this probe. It may have been stopped, deleted or timed out.",
        },
        {},
      ) as never,
    );

    await reportPacketCapture(toReport("a", COMPLETED));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String((logger.error as jest.Mock).mock.calls[0]![0])).toContain(
      "Packet capture a report was rejected: HTTP 400",
    );
  });
});

describe("one tick", () => {
  test("starts what it was handed with the probe's limits, and reports each as it ends", async () => {
    listAnswers.push({ packetCaptures: [job("a")], stopPacketCaptureIds: [] });

    await fetchAndRunPacketCaptures(DEPENDENCIES);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.options.job).toEqual(job("a"));
    expect(runs[0]!.options.limits).toEqual(SETTINGS.limits);
    expect(getRunningPacketCaptureIds()).toEqual(["a"]);

    runs[0]!.resolve(COMPLETED);
    await waitForRunningCaptures();

    expect(calls(INGEST_URL)).toHaveLength(1);
    expect(calls(INGEST_URL)[0]!.body).toMatchObject({
      packetCaptureId: "a",
      status: PacketCaptureStatus.Completed,
      endReason: PacketCaptureEndReason.DurationReached,
    });
    expect(getRunningPacketCaptureIds()).toEqual([]);
  });

  test("names its running captures on every tick, and asks only for the slots it has free", async () => {
    listAnswers.push({ packetCaptures: [job("a")], stopPacketCaptureIds: [] });
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    await fetchAndRunPacketCaptures(DEPENDENCIES);

    const second: FetchCall = calls(LIST_URL)[1]!;

    expect(second.body["runningPacketCaptureIds"]).toEqual(["a"]);
    expect(second.body["limit"]).toBe(PACKET_CAPTURE_PROBE_CONCURRENCY - 1);
  });

  test("a capture being uploaded is still named, so the server knows it is alive", async () => {
    listAnswers.push({ packetCaptures: [job("a")], stopPacketCaptureIds: [] });
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    // The run is over; its report is on its way and has not been answered.
    let answerReport: () => void = (): void => {};
    fetchSpy.mockImplementation((async (request: JSONObject) => {
      if (String(request["url"]) === INGEST_URL) {
        await new Promise<void>((resolve: () => void) => {
          answerReport = resolve;
        });
      }

      return new HTTPResponse(
        200,
        { packetCaptures: [], stopPacketCaptureIds: [] },
        {},
      );
    }) as never);

    runs[0]!.resolve(COMPLETED);
    await settle();

    await fetchAndRunPacketCaptures(DEPENDENCIES);

    expect(calls(LIST_URL).pop()!.body["runningPacketCaptureIds"]).toEqual([
      "a",
    ]);

    answerReport();
    await waitForRunningCaptures();

    expect(getRunningPacketCaptureIds()).toEqual([]);
  });

  test("stops a running capture the server names", async () => {
    listAnswers.push({ packetCaptures: [job("a")], stopPacketCaptureIds: [] });
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    const signal: AbortSignal = runs[0]!.options.signal!;

    expect(signal.aborted).toBe(false);

    listAnswers.push({ packetCaptures: [], stopPacketCaptureIds: ["a", "zz"] });
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    expect(signal.aborted).toBe(true);
  });

  test("never runs more than two at once: a capture past that is answered Failed, not dropped", async () => {
    listAnswers.push({
      packetCaptures: [job("a"), job("b"), job("c")],
      stopPacketCaptureIds: [],
    });

    await fetchAndRunPacketCaptures(DEPENDENCIES);

    expect(runs).toHaveLength(PACKET_CAPTURE_PROBE_CONCURRENCY);
    expect(calls(INGEST_URL)[0]!.body).toMatchObject({
      packetCaptureId: "c",
      status: PacketCaptureStatus.Failed,
      statusMessage: "The probe is already running 2 captures.",
    });
  });

  test("a capture it is already running is not started twice", async () => {
    listAnswers.push({ packetCaptures: [job("a")], stopPacketCaptureIds: [] });
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    listAnswers.push({ packetCaptures: [job("a")], stopPacketCaptureIds: [] });
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    expect(runs).toHaveLength(1);
  });

  test("a capture handed out with no id is skipped, with a line in the log", async () => {
    listAnswers.push({
      packetCaptures: [job("")],
      stopPacketCaptureIds: [],
    });

    await fetchAndRunPacketCaptures(DEPENDENCIES);

    expect(runs).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "Skipping a packet capture the server handed out with no id.",
    );
  });

  test("a run that throws is answered Failed with why", async () => {
    listAnswers.push({ packetCaptures: [job("a")], stopPacketCaptureIds: [] });
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    runs[0]!.reject(new Error("out of memory"));
    await waitForRunningCaptures();

    expect(calls(INGEST_URL)[0]!.body).toMatchObject({
      packetCaptureId: "a",
      status: PacketCaptureStatus.Failed,
      statusMessage: "The probe could not run this capture: out of memory",
    });
  });

  test("a tick while the last one's request is still out is skipped", async () => {
    let answerList: () => void = (): void => {};

    fetchSpy.mockImplementation((async () => {
      await new Promise<void>((resolve: () => void) => {
        answerList = resolve;
      });

      return new HTTPResponse(
        200,
        { packetCaptures: [], stopPacketCaptureIds: [] },
        {},
      );
    }) as never);

    const first: Promise<void> = fetchAndRunPacketCaptures(DEPENDENCIES);
    await settle();
    await fetchAndRunPacketCaptures(DEPENDENCIES);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    answerList();
    await first;
  });
});

describe("the cron registration", () => {
  type JobModule = { default: () => void };

  /*
   * Config reads the probe's environment once, when it is first imported,
   * so each case imports the job afresh with the environment it is about.
   */
  function initJobWith(enabled: string | undefined): void {
    jest.isolateModules(() => {
      if (enabled === undefined) {
        delete process.env["PROBE_PACKET_CAPTURE_ENABLED"];
      } else {
        process.env["PROBE_PACKET_CAPTURE_ENABLED"] = enabled;
      }

      jest
        .requireActual<JobModule>(
          "../../../Jobs/PacketCapture/FetchPacketCaptures",
        )
        .default();

      delete process.env["PROBE_PACKET_CAPTURE_ENABLED"];
    });
  }

  test("is the operator's to turn on: with captures off nothing is scheduled", () => {
    initJobWith(undefined);
    initJobWith("false");
    initJobWith("1");

    expect(mockCapturedCronJobs).toHaveLength(0);
  });

  test("with captures on, asks every ten seconds, starting at once", () => {
    initJobWith("true");

    expect(mockCapturedCronJobs).toHaveLength(1);
    expect(mockCapturedCronJobs[0]!.jobName).toBe("Probe:PacketCaptures");
    expect(mockCapturedCronJobs[0]!.options).toEqual({
      schedule: EVERY_TEN_SECONDS,
      runOnStartup: true,
    });
  });
});
