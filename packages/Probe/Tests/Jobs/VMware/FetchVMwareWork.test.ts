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
import VMwareCollectionErrorCode from "Common/Types/VMware/VMwareCollectionError";
import {
  VMWARE_PROBE_COLLECTION_CONCURRENCY,
  VMWARE_PROBE_WORK_POLL_INTERVAL_IN_SECONDS,
  VMwareCollectionJob,
  VMwareCollectionReport,
  VMwareConnectionTestJob,
  VMwareConnectionTestReport,
} from "Common/Types/VMware/VMwareProbeCollection";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import InitFetchVMwareWork, {
  FetchVMwareWorkDependencies,
  REPORT_UPLOAD_TIMEOUT_IN_MS,
  getRunningVMwareVCenterIds,
  isVMwareCollectionAllowedOnThisProbe,
  postCollectionReport,
  resetVMwareWorkState,
  runVMwareWorkTick,
  waitForRunningCollections,
} from "../../../Jobs/VMware/FetchVMwareWork";
import zlib from "zlib";

/*
 * The probe's half of collecting vCenters without an agent, every ten
 * seconds: ask for work - naming the collections still running, so none is
 * handed out twice - collect each vCenter handed out (four at most at once)
 * and report it compressed, run each connection test and report it. Every
 * vCenter and test handed out is answered, whatever happens. vCenter is
 * never contacted here: collect and test are injected.
 */

const BASE_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/vmware";
const WORK_URL: string = `${BASE_URL}/work`;
const COLLECTION_URL: string = `${BASE_URL}/collection`;
const TEST_URL: string = `${BASE_URL}/test`;

function collectionJob(id: string): VMwareCollectionJob {
  return {
    vmwareVCenterId: id,
    vcenterName: `vCenter ${id}`,
    vcenterUrl: `https://${id}.example.com`,
    username: "oneuptime@vsphere.local",
    password: "secret",
    collectionIntervalInMinutes: 2,
    settingsVersion: 3,
  };
}

function testJob(id: string): VMwareConnectionTestJob {
  return {
    vmwareVCenterConnectionTestId: id,
    vcenterUrl: "https://vcsa.example.com",
    username: "oneuptime@vsphere.local",
    password: "secret",
  };
}

function succeeded(job: VMwareCollectionJob): VMwareCollectionReport {
  return {
    vmwareVCenterId: job.vmwareVCenterId,
    settingsVersion: job.settingsVersion,
    collectedAt: "2026-10-10T12:00:00.000Z",
    status: "Succeeded",
    durationInMs: 900,
    resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }],
  };
}

interface PendingCollection {
  job: VMwareCollectionJob;
  resolve: (report: VMwareCollectionReport) => void;
  reject: (error: Error) => void;
}

let collections: Array<PendingCollection>;
let tests: Array<VMwareConnectionTestJob>;
let workAnswers: Array<JSONObject | HTTPErrorResponse | Promise<JSONObject>>;
let collectionAnswers: Array<JSONObject>;

const DEPENDENCIES: FetchVMwareWorkDependencies = {
  collect: (job: VMwareCollectionJob): Promise<VMwareCollectionReport> => {
    return new Promise<VMwareCollectionReport>(
      (
        resolve: (report: VMwareCollectionReport) => void,
        reject: (error: Error) => void,
      ) => {
        collections.push({ job, resolve, reject });
      },
    );
  },
  test: async (
    job: VMwareConnectionTestJob,
  ): Promise<VMwareConnectionTestReport> => {
    tests.push(job);

    if (job.vmwareVCenterConnectionTestId === "throws") {
      throw new Error("A bug.");
    }

    return {
      vmwareVCenterConnectionTestId: job.vmwareVCenterConnectionTestId,
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.InvalidLogin,
      errorMessage: "Refused.",
      durationInMs: 40,
    };
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
  resetVMwareWorkState();
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
        await (workAnswers.shift() || {
          collections: [],
          tests: [],
        });

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

  await waitForRunningCollections();
  jest.restoreAllMocks();
});

describe("FetchVMwareWork", () => {
  test("runs every ten seconds, from the probe's start", () => {
    InitFetchVMwareWork();

    expect(mockCapturedCronJobs).toHaveLength(1);
    expect(mockCapturedCronJobs[0]).toMatchObject({
      jobName: "Probe:VMwareWork",
      options: { schedule: EVERY_TEN_SECONDS, runOnStartup: true },
    });
    expect(VMWARE_PROBE_WORK_POLL_INTERVAL_IN_SECONDS).toBe(10);
  });

  test("a global probe of the hosted product never collects a vCenter; every other probe does", () => {
    expect(
      isVMwareCollectionAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: true,
      }),
    ).toBe(false);

    // A self-hosted instance's own global probe, and any probe a customer runs.
    expect(
      isVMwareCollectionAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: false,
      }),
    ).toBe(true);
    expect(
      isVMwareCollectionAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: false,
        isBillingEnabled: true,
      }),
    ).toBe(true);
    expect(
      isVMwareCollectionAllowedOnThisProbe({
        isAutoRegisteredGlobalProbe: false,
        isBillingEnabled: false,
      }),
    ).toBe(true);
  });

  test("asks for work as this probe, naming the vCenters it is collecting", async () => {
    workAnswers.push({
      collections: [
        collectionJob("a"),
        collectionJob("b"),
      ] as unknown as JSONObject,
      tests: [],
    });

    await runVMwareWorkTick(DEPENDENCIES);

    const [first] = calls(WORK_URL);
    expect(first!.body).toMatchObject({
      probeKey: "test-probe-key",
      probeId: "11111111-2222-3333-4444-555555555555",
      runningVMwareVCenterIds: [],
    });
    expect(getRunningVMwareVCenterIds()).toEqual(["a", "b"]);

    // The next tick names both - and a vCenter handed out again is not collected twice.
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });
    await runVMwareWorkTick(DEPENDENCIES);

    expect(calls(WORK_URL)[1]!.body["runningVMwareVCenterIds"]).toEqual([
      "a",
      "b",
    ]);
    expect(
      collections.map((pending: PendingCollection) => {
        return pending.job.vmwareVCenterId;
      }),
    ).toEqual(["a", "b"]);
  });

  test("reports each collection compressed, with its metrics, and then frees its slot", async () => {
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runVMwareWorkTick(DEPENDENCIES);
    expect(calls(COLLECTION_URL)).toHaveLength(0);

    collections[0]!.resolve(succeeded(collections[0]!.job));
    await waitForRunningCollections();

    const [report] = calls(COLLECTION_URL);
    expect(report!.headers).toEqual({
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
    });
    expect(report!.body).toMatchObject({
      probeKey: "test-probe-key",
      probeId: "11111111-2222-3333-4444-555555555555",
      vmwareVCenterId: "a",
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
    expect(JSON.stringify(report!.body)).not.toContain("secret");

    expect(getRunningVMwareVCenterIds()).toEqual([]);
  });

  test("never collects more than four vCenters at once", async () => {
    workAnswers.push({
      collections: ["a", "b", "c", "d", "e", "f"].map(
        collectionJob,
      ) as unknown as JSONObject,
      tests: [],
    });

    await runVMwareWorkTick(DEPENDENCIES);

    expect(VMWARE_PROBE_COLLECTION_CONCURRENCY).toBe(4);
    expect(getRunningVMwareVCenterIds()).toEqual(["a", "b", "c", "d"]);
    expect(collections).toHaveLength(4);
  });

  test("a collection that throws is still answered, as Failed with the reason", async () => {
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runVMwareWorkTick(DEPENDENCIES);
    collections[0]!.reject(new Error("Out of memory."));
    collections = [];
    await waitForRunningCollections();

    expect(calls(COLLECTION_URL)[0]!.body).toMatchObject({
      vmwareVCenterId: "a",
      settingsVersion: 3,
      status: "Failed",
      errorMessage: "The probe hit an unexpected error: Out of memory.",
    });
    expect(getRunningVMwareVCenterIds()).toEqual([]);
  });

  test("connection tests run at once and are answered - a test that throws as Failed", async () => {
    workAnswers.push({
      collections: [],
      tests: [testJob("t-1"), testJob("throws")] as unknown as JSONObject,
    });

    await runVMwareWorkTick(DEPENDENCIES);
    await settle();

    expect(
      tests.map((job: VMwareConnectionTestJob) => {
        return job.vmwareVCenterConnectionTestId;
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
      vmwareVCenterConnectionTestId: "t-1",
      status: "Failed",
      errorCode: VMwareCollectionErrorCode.InvalidLogin,
    });
    expect(reports[1]).toMatchObject({
      vmwareVCenterConnectionTestId: "throws",
      status: "Failed",
      errorMessage: "The probe hit an unexpected error: A bug.",
    });
  });

  test("a server older than VMware collection, or none at all, is no work", async () => {
    workAnswers.push(new HTTPErrorResponse(404, { message: "Not Found" }, {}));

    await runVMwareWorkTick(DEPENDENCIES);

    expect(collections).toHaveLength(0);
    expect(tests).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "VMware work request failed: HTTP 404 - Not Found. A server older than VMware collection answers 404 here.",
    );
  });

  test("asks one question at a time: a tick while the last is unanswered asks nothing", async () => {
    let answer: (value: JSONObject) => void = (): void => {};
    workAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        answer = resolve;
      }),
    );

    const first: Promise<void> = runVMwareWorkTick(DEPENDENCIES);
    await settle();
    await runVMwareWorkTick(DEPENDENCIES);

    expect(calls(WORK_URL)).toHaveLength(1);

    answer({ collections: [], tests: [] });
    await first;

    await runVMwareWorkTick(DEPENDENCIES);
    expect(calls(WORK_URL)).toHaveLength(2);
  });

  test("a report the server refuses is logged, not sent again", async () => {
    collectionAnswers.push({
      accepted: false,
      reason: "Another probe collects it now.",
    });

    expect(await postCollectionReport(succeeded(collectionJob("a")))).toBe(
      false,
    );
    expect(calls(COLLECTION_URL)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "The collection report of vCenter a was not accepted: Another probe collects it now.",
    );
  });
});
