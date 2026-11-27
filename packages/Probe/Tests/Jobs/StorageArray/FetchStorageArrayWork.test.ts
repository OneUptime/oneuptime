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
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ProbeKeyHeaders from "Common/Types/Probe/ProbeKeyHeaders";
import ProbeReportOpening from "Common/Server/Utils/Probe/ProbeReportOpening";
import StorageArrayCollectionErrorCode from "Common/Types/StorageArray/Collection/StorageArrayCollectionErrorCode";
import {
  STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY,
  StorageArrayCollectionJob,
  StorageArrayCollectionReport,
  StorageArrayConnectionTestJob,
  StorageArrayConnectionTestReport,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import InitFetchStorageArrayWork, {
  FetchStorageArrayWorkDependencies,
  REPORT_UPLOAD_TIMEOUT_IN_MS,
  getRunningStorageArrayConnectionIds,
  postStorageArrayCollectionReport,
  postStorageArrayTestReport,
  resetStorageArrayWorkState,
  runStorageArrayWorkTick,
  waitForRunningStorageArrayCollections,
} from "../../../Jobs/StorageArray/FetchStorageArrayWork";
import { StorageArrayPoller } from "../../../Utils/StorageArray/StorageArrayPoller";
import StorageArrayPollers from "../../../Utils/StorageArray/StorageArrayPollers";
import zlib from "zlib";

/*
 * The probe's half of reading storage arrays from their management server
 * (#11004), every ten seconds: ask for work - naming the collections still
 * running, so none is handed out twice - collect each connection with its
 * platform's poller (two at most at once) and report it compressed, run
 * each connection test and report it. Every connection and test handed out
 * is answered, whatever happens; the password is never reported back. No
 * Unisphere is contacted here: the pollers are injected.
 */

const BASE_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/storage-array";
const WORK_URL: string = `${BASE_URL}/work`;
const COLLECTION_URL: string = `${BASE_URL}/collection`;
const TEST_URL: string = `${BASE_URL}/test`;

const SECRET: string = "Uni$phere-R3ad-0nly-2026!";

function collectionJob(
  id: string,
  storageSystem: string = "dell.powermax",
): StorageArrayCollectionJob {
  return {
    storageArrayConnectionId: id,
    connectionName: `Unisphere ${id}`,
    storageSystem: storageSystem,
    address: `https://${id}.example.com:8443`,
    username: "oneuptime-monitor",
    password: SECRET,
    collectionIntervalInMinutes: 5,
    settingsVersion: 3,
  };
}

function testJob(
  id: string,
  storageSystem: string = "dell.powermax",
): StorageArrayConnectionTestJob {
  return {
    storageArrayConnectionTestId: id,
    storageSystem: storageSystem,
    address: "https://unisphere.example.com:8443",
    username: "oneuptime-monitor",
    password: SECRET,
  };
}

function succeeded(
  job: StorageArrayCollectionJob,
): StorageArrayCollectionReport {
  return {
    storageArrayConnectionId: job.storageArrayConnectionId,
    settingsVersion: job.settingsVersion,
    collectedAt: "2026-11-26T10:00:00.000Z",
    status: "Succeeded",
    durationInMs: 900,
    summary: { arrays: [], warnings: [] },
    resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }],
  };
}

interface PendingCollection {
  job: StorageArrayCollectionJob;
  resolve: (report: StorageArrayCollectionReport) => void;
  reject: (error: Error) => void;
}

let collections: Array<PendingCollection>;
let tests: Array<StorageArrayConnectionTestJob>;
let workAnswers: Array<JSONObject | HTTPErrorResponse | Promise<JSONObject>>;
let collectionAnswers: Array<JSONObject>;

const POLLER: StorageArrayPoller = {
  storageSystem: "dell.powermax",
  collect: (
    job: StorageArrayCollectionJob,
  ): Promise<StorageArrayCollectionReport> => {
    return new Promise<StorageArrayCollectionReport>(
      (
        resolve: (report: StorageArrayCollectionReport) => void,
        reject: (error: Error) => void,
      ) => {
        collections.push({ job, resolve, reject });
      },
    );
  },
  test: async (
    job: StorageArrayConnectionTestJob,
  ): Promise<StorageArrayConnectionTestReport> => {
    tests.push(job);
    if (job.storageArrayConnectionTestId === "throws") {
      throw new Error("A bug.");
    }
    return {
      storageArrayConnectionTestId: job.storageArrayConnectionTestId,
      status: "Failed",
      errorCode: StorageArrayCollectionErrorCode.InvalidLogin,
      errorMessage: "Refused.",
      durationInMs: 40,
    };
  },
};

const DEPENDENCIES: FetchStorageArrayWorkDependencies = {
  getPoller: (storageSystem: string): StorageArrayPoller | null => {
    return storageSystem === POLLER.storageSystem ? POLLER : null;
  },
};

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

type FetchCall = {
  url: string;
  body: JSONObject;
  headers: JSONObject;
  options: JSONObject;
};

function calls(url: string): Array<FetchCall> {
  return fetchSpy.mock.calls
    .map((call: Array<unknown>): FetchCall => {
      const arg: JSONObject = call[0] as JSONObject;
      const data: unknown = arg["data"];
      return {
        url: String(arg["url"]),
        // A collection report travels gzip-compressed.
        body: Buffer.isBuffer(data)
          ? (JSON.parse(zlib.gunzipSync(data).toString("utf8")) as JSONObject)
          : (data as JSONObject),
        headers: arg["headers"] as JSONObject,
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
  resetStorageArrayWorkState();
  collections = [];
  tests = [];
  workAnswers = [];
  collectionAnswers = [];

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async (
    request: JSONObject,
  ) => {
    const url: string = String(request["url"]);

    if (url === WORK_URL) {
      const answer: JSONObject | HTTPErrorResponse =
        await (workAnswers.shift() || { collections: [], tests: [] });
      return answer instanceof HTTPErrorResponse
        ? answer
        : new HTTPResponse(200, answer, {});
    }

    if (url === COLLECTION_URL) {
      return new HTTPResponse(
        200,
        collectionAnswers.shift() || { accepted: true },
        {},
      );
    }

    return new HTTPResponse(200, { accepted: true }, {});
  }) as never);

  for (const level of ["info", "warn", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }
});

afterEach(async () => {
  for (const pending of collections) {
    pending.resolve(succeeded(pending.job));
  }
  await waitForRunningStorageArrayCollections();
  jest.restoreAllMocks();
});

describe("FetchStorageArrayWork", () => {
  test("runs every ten seconds, from the probe's start", () => {
    InitFetchStorageArrayWork();

    expect(mockCapturedCronJobs).toHaveLength(1);
    expect(mockCapturedCronJobs[0]).toMatchObject({
      jobName: "Probe:StorageArrayWork",
      options: { schedule: EVERY_TEN_SECONDS, runOnStartup: true },
    });
  });

  test("the probe reads PowerMax: its poller is registered for dell.powermax", () => {
    expect(StorageArrayPollers.getStorageSystems()).toEqual(["dell.powermax"]);
    expect(StorageArrayPollers.getPoller("dell.powermax")!.storageSystem).toBe(
      "dell.powermax",
    );
    expect(StorageArrayPollers.getPoller("netapp.ontap")).toBeNull();
    expect(StorageArrayPollers.getPoller("")).toBeNull();
    expect(StorageArrayPollers.getPoller(undefined)).toBeNull();
  });

  test("asks for work as this probe, naming the connections it is collecting", async () => {
    workAnswers.push({
      collections: [
        collectionJob("a"),
        collectionJob("b"),
      ] as unknown as JSONObject,
      tests: [],
    });

    await runStorageArrayWorkTick(DEPENDENCIES);

    const [first] = calls(WORK_URL);
    expect(first!.body).toMatchObject({
      probeKey: "test-probe-key",
      probeId: "11111111-2222-3333-4444-555555555555",
      runningStorageArrayConnectionIds: [],
    });
    expect(getRunningStorageArrayConnectionIds()).toEqual(["a", "b"]);

    // The next tick names both - and one handed out again is not collected twice.
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });
    await runStorageArrayWorkTick(DEPENDENCIES);

    expect(
      calls(WORK_URL)[1]!.body["runningStorageArrayConnectionIds"],
    ).toEqual(["a", "b"]);
    expect(
      collections.map((pending: PendingCollection) => {
        return pending.job.storageArrayConnectionId;
      }),
    ).toEqual(["a", "b"]);
  });

  test("reports each collection compressed, with its metrics, and then frees its slot", async () => {
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runStorageArrayWorkTick(DEPENDENCIES);
    expect(calls(COLLECTION_URL)).toHaveLength(0);

    collections[0]!.resolve(succeeded(collections[0]!.job));
    await waitForRunningStorageArrayCollections();

    const [report] = calls(COLLECTION_URL);
    expect(report!.headers).toEqual({
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      "x-oneuptime-probe-id": "11111111-2222-3333-4444-555555555555",
      "x-oneuptime-probe-key": "test-probe-key",
    });
    expect(report!.body).toMatchObject({
      probeKey: "test-probe-key",
      probeId: "11111111-2222-3333-4444-555555555555",
      storageArrayConnectionId: "a",
      settingsVersion: 3,
      status: "Succeeded",
      resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }],
    });
    // Megabytes over a slow link: a long upload, and no body cap.
    expect(report!.options["timeout"]).toBeGreaterThanOrEqual(
      REPORT_UPLOAD_TIMEOUT_IN_MS,
    );
    expect(report!.options["maxBodyLength"]).toBe(Infinity);
    // The report never carries the password back.
    expect(JSON.stringify(report!.body)).not.toContain(SECRET);
    expect(getRunningStorageArrayConnectionIds()).toEqual([]);
  });

  test("a report carries the probe's id and key in headers, and first in its body", async () => {
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runStorageArrayWorkTick(DEPENDENCIES);
    collections[0]!.resolve(succeeded(collections[0]!.job));
    await waitForRunningStorageArrayCollections();

    const sent: JSONObject = fetchSpy.mock.calls
      .map((call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      })
      .find((request: JSONObject): boolean => {
        return String(request["url"]) === COLLECTION_URL;
      })!;

    expect(
      ProbeKeyHeaders.read(sent["headers"] as unknown as Dictionary<string>),
    ).toEqual({
      probeId: "11111111-2222-3333-4444-555555555555",
      probeKey: "test-probe-key",
    });

    const text: Buffer = zlib.gunzipSync(sent["data"] as unknown as Buffer);
    expect(
      text
        .toString("utf8")
        .startsWith(
          '{"probeKey":"test-probe-key","probeId":"11111111-2222-3333-4444-555555555555",',
        ),
    ).toBe(true);
    expect(ProbeReportOpening.read(text)).toEqual({
      probeId: "11111111-2222-3333-4444-555555555555",
      probeKey: "test-probe-key",
    });
  });

  test("never collects more connections at once than its share", async () => {
    workAnswers.push({
      collections: ["a", "b", "c", "d"].map((id: string) => {
        return collectionJob(id);
      }) as unknown as JSONObject,
      tests: [],
    });

    await runStorageArrayWorkTick(DEPENDENCIES);

    expect(STORAGE_ARRAY_PROBE_COLLECTION_CONCURRENCY).toBe(2);
    expect(getRunningStorageArrayConnectionIds()).toEqual(["a", "b"]);
    expect(collections).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      "Storage array collection of c skipped: 2 collections are already running.",
    );
  });

  test("a collection that throws is still answered, as Failed with the reason", async () => {
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runStorageArrayWorkTick(DEPENDENCIES);
    collections[0]!.reject(new Error("Out of memory."));
    collections = [];
    await waitForRunningStorageArrayCollections();

    expect(calls(COLLECTION_URL)[0]!.body).toMatchObject({
      storageArrayConnectionId: "a",
      settingsVersion: 3,
      status: "Failed",
      errorCode: StorageArrayCollectionErrorCode.Internal,
      errorMessage: "The probe hit an unexpected error: Out of memory.",
    });
    expect(getRunningStorageArrayConnectionIds()).toEqual([]);
  });

  test("a platform this probe has no poller for is answered, never left waiting", async () => {
    workAnswers.push({
      collections: [
        collectionJob("n", "netapp.ontap"),
      ] as unknown as JSONObject,
      tests: [testJob("t-n", "netapp.ontap")] as unknown as JSONObject,
    });

    await runStorageArrayWorkTick(DEPENDENCIES);
    await waitForRunningStorageArrayCollections();
    await settle();

    expect(calls(COLLECTION_URL)[0]!.body).toMatchObject({
      storageArrayConnectionId: "n",
      status: "Failed",
      errorCode: StorageArrayCollectionErrorCode.PlatformNotSupported,
      errorMessage:
        "This probe cannot read netapp.ontap. Update the probe to the latest OneUptime version.",
    });
    expect(calls(TEST_URL)[0]!.body).toMatchObject({
      storageArrayConnectionTestId: "t-n",
      status: "Failed",
      errorCode: StorageArrayCollectionErrorCode.PlatformNotSupported,
    });
  });

  test("connection tests run at once and are answered - a test that throws as Failed", async () => {
    workAnswers.push({
      collections: [],
      tests: [testJob("t-1"), testJob("throws")] as unknown as JSONObject,
    });

    await runStorageArrayWorkTick(DEPENDENCIES);
    await settle();

    expect(
      tests.map((job: StorageArrayConnectionTestJob) => {
        return job.storageArrayConnectionTestId;
      }),
    ).toEqual(["t-1", "throws"]);

    const reports: Array<JSONObject> = calls(TEST_URL).map(
      (call: FetchCall) => {
        return call.body;
      },
    );
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      probeKey: "test-probe-key",
      storageArrayConnectionTestId: "t-1",
      status: "Failed",
      errorCode: StorageArrayCollectionErrorCode.InvalidLogin,
    });
    expect(reports[1]).toMatchObject({
      storageArrayConnectionTestId: "throws",
      status: "Failed",
      errorCode: StorageArrayCollectionErrorCode.Internal,
      errorMessage: "The probe hit an unexpected error: A bug.",
    });
    for (const report of reports) {
      expect(JSON.stringify(report)).not.toContain(SECRET);
    }
  });

  test("a server older than storage array collection, or none at all, is no work", async () => {
    workAnswers.push(new HTTPErrorResponse(404, { message: "Not Found" }, {}));

    await runStorageArrayWorkTick(DEPENDENCIES);

    expect(collections).toHaveLength(0);
    expect(tests).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "Storage array work request failed: HTTP 404 - Not Found. A server older than storage array collection answers 404 here.",
    );
  });

  test("a work request that fails outright is no work", async () => {
    fetchSpy.mockImplementationOnce((async () => {
      throw new Error("socket hang up");
    }) as never);

    await runStorageArrayWorkTick(DEPENDENCIES);

    expect(collections).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      "Error fetching storage array work",
    );
  });

  test("asks one question at a time: a tick while the last is unanswered asks nothing", async () => {
    let answer: (value: JSONObject) => void = (): void => {};
    workAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        answer = resolve;
      }),
    );

    const first: Promise<void> = runStorageArrayWorkTick(DEPENDENCIES);
    await settle();
    await runStorageArrayWorkTick(DEPENDENCIES);

    expect(calls(WORK_URL)).toHaveLength(1);

    answer({ collections: [], tests: [] });
    await first;

    await runStorageArrayWorkTick(DEPENDENCIES);
    expect(calls(WORK_URL)).toHaveLength(2);
  });

  test("a collection report the server refuses is logged, not sent again", async () => {
    collectionAnswers.push({
      accepted: false,
      reason: "Another probe collects it now.",
    });

    expect(
      await postStorageArrayCollectionReport(succeeded(collectionJob("a"))),
    ).toBe(false);
    expect(calls(COLLECTION_URL)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "The collection report of storage array connection a was not accepted: Another probe collects it now.",
    );
  });

  test("a report the server answers with an error is not accepted", async () => {
    fetchSpy.mockImplementation((async () => {
      return new HTTPErrorResponse(413, { message: "Payload Too Large" }, {});
    }) as never);

    expect(
      await postStorageArrayCollectionReport(succeeded(collectionJob("a"))),
    ).toBe(false);
    expect(
      await postStorageArrayTestReport({
        storageArrayConnectionTestId: "t-1",
        status: "Succeeded",
        durationInMs: 1,
      }),
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      "The collection report of storage array connection a was not accepted: HTTP 413 - Payload Too Large.",
    );
  });

  test("an upload that fails is logged with the connection, never its password", async () => {
    fetchSpy.mockImplementation((async () => {
      throw new Error("ECONNRESET");
    }) as never);

    expect(
      await postStorageArrayCollectionReport(succeeded(collectionJob("a"))),
    ).toBe(false);

    const logged: string = JSON.stringify(
      (logger.error as unknown as { mock: { calls: Array<unknown> } }).mock
        .calls,
    );
    expect(logged).toContain("storage array connection a");
    expect(logged).not.toContain(SECRET);
  });
});
