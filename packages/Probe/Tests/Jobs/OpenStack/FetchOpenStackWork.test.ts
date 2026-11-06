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
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import {
  OPENSTACK_PROBE_COLLECTION_CONCURRENCY,
  OPENSTACK_PROBE_WORK_POLL_INTERVAL_IN_SECONDS,
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import InitFetchOpenStackWork, {
  FetchOpenStackWorkDependencies,
  REPORT_UPLOAD_TIMEOUT_IN_MS,
  fetchOpenStackWork,
  getRunningOpenStackCloudIds,
  isOpenStackCollectionAllowedOnThisProbe,
  postCollectionReport,
  postTestReport,
  resetOpenStackWorkState,
  runOpenStackWorkTick,
  waitForRunningCollections,
} from "../../../Jobs/OpenStack/FetchOpenStackWork";
import zlib from "zlib";

/*
 * The probe's half of collecting clouds without an agent, every ten seconds: ask for work,
 * naming the collections still running so none is handed out twice, collect each cloud
 * handed out (four at most at once) and report it compressed, run each connection test
 * and report it. Every cloud and test handed out is answered, whatever happens. No cloud
 * is contacted here: collect and test are injected.
 */

const BASE_URL: string =
  "https://oneuptime.example.com/probe-ingest/probe/openstack";
const WORK_URL: string = `${BASE_URL}/work`;
const COLLECTION_URL: string = `${BASE_URL}/collection`;
const TEST_URL: string = `${BASE_URL}/test`;

const SECRET: string = "the-credential-secret";

function collectionJob(id: string): OpenStackCollectionJob {
  return {
    openStackCloudId: id,
    cloudName: `Cloud ${id}`,
    authUrl: `https://${id}.example.com:5000`,
    credential: {
      kind: "applicationCredential",
      id: "credential-id",
      secret: SECRET,
    },
    regions: ["RegionOne"],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
    collectionIntervalInMinutes: 2,
    settingsVersion: 3,
  };
}

function testJob(id: string): OpenStackConnectionTestJob {
  return {
    openStackCloudConnectionTestId: id,
    authUrl: "https://keystone.example.com:5000",
    credential: {
      kind: "applicationCredential",
      id: "credential-id",
      secret: SECRET,
    },
    regions: [],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
  };
}

function succeeded(job: OpenStackCollectionJob): OpenStackCollectionReport {
  return {
    openStackCloudId: job.openStackCloudId,
    settingsVersion: job.settingsVersion,
    collectedAt: "2026-11-04T12:00:00.000Z",
    status: "Succeeded",
    durationInMs: 900,
    resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }],
  };
}

interface PendingCollection {
  job: OpenStackCollectionJob;
  resolve: (report: OpenStackCollectionReport) => void;
  reject: (error: Error) => void;
}

let collections: Array<PendingCollection>;
let tests: Array<OpenStackConnectionTestJob>;
let workAnswers: Array<
  JSONObject | HTTPErrorResponse | Promise<JSONObject> | Error
>;
let collectionAnswers: Array<JSONObject | HTTPErrorResponse | Error>;
let testAnswers: Array<JSONObject | HTTPErrorResponse | Error>;

const DEPENDENCIES: FetchOpenStackWorkDependencies = {
  collect: (
    job: OpenStackCollectionJob,
  ): Promise<OpenStackCollectionReport> => {
    return new Promise<OpenStackCollectionReport>(
      (
        resolve: (report: OpenStackCollectionReport) => void,
        reject: (error: Error) => void,
      ) => {
        collections.push({ job, resolve, reject });
      },
    );
  },
  test: async (
    job: OpenStackConnectionTestJob,
  ): Promise<OpenStackConnectionTestReport> => {
    tests.push(job);

    if (job.openStackCloudConnectionTestId === "throws") {
      throw new Error("A bug.");
    }

    return {
      openStackCloudConnectionTestId: job.openStackCloudConnectionTestId,
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
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

function toAnswer(
  answer: JSONObject | HTTPErrorResponse | Error,
): HTTPResponse<JSONObject> | HTTPErrorResponse {
  if (answer instanceof Error) {
    throw answer;
  }

  return answer instanceof HTTPErrorResponse
    ? answer
    : new HTTPResponse(200, answer, {});
}

beforeEach(() => {
  mockCapturedCronJobs.length = 0;
  resetOpenStackWorkState();
  collections = [];
  tests = [];
  workAnswers = [];
  collectionAnswers = [];
  testAnswers = [];

  fetchSpy = jest.spyOn(API, "fetch").mockImplementation((async (
    request: JSONObject,
  ) => {
    const url: string = String(request["url"]);

    if (url === WORK_URL) {
      return toAnswer(
        await (workAnswers.shift() || {
          collections: [],
          tests: [],
        }),
      );
    }

    if (url === COLLECTION_URL) {
      return toAnswer(collectionAnswers.shift() || { accepted: true });
    }

    if (url === TEST_URL) {
      return toAnswer(testAnswers.shift() || { accepted: true });
    }

    throw new Error(`Nothing should ask ${url}.`);
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

describe("how often, and on which probes", () => {
  test("every ten seconds, from the probe's start", () => {
    const wasBilling: string | undefined = process.env["BILLING_ENABLED"];

    InitFetchOpenStackWork();

    expect(mockCapturedCronJobs).toHaveLength(1);
    expect(mockCapturedCronJobs[0]).toMatchObject({
      jobName: "Probe:OpenStackWork",
      options: { schedule: EVERY_TEN_SECONDS, runOnStartup: true },
    });
    expect(OPENSTACK_PROBE_WORK_POLL_INTERVAL_IN_SECONDS).toBe(10);
    expect(process.env["BILLING_ENABLED"]).toBe(wasBilling);
  });

  test("a tick that throws never takes the cron with it", async () => {
    InitFetchOpenStackWork();

    workAnswers.push(new Error("The network is gone."));

    await expect(
      mockCapturedCronJobs[0]!.runFunction(),
    ).resolves.toBeUndefined();
  });

  test.each([
    // The one a credential must never reach: every sign-up shares it.
    [true, true, false],
    // A self-hosted instance's own global probe.
    [true, false, true],
    // Any probe a customer runs.
    [false, true, true],
    [false, false, true],
  ])(
    "a global probe %s, billing %s: collects %s",
    (
      isAutoRegisteredGlobalProbe: boolean,
      isBillingEnabled: boolean,
      isAllowed: boolean,
    ) => {
      expect(
        isOpenStackCollectionAllowedOnThisProbe({
          isAutoRegisteredGlobalProbe: isAutoRegisteredGlobalProbe,
          isBillingEnabled: isBillingEnabled,
        }),
      ).toBe(isAllowed);
    },
  );
});

describe("asking for work", () => {
  test("as this probe, naming the clouds it is collecting, so none stacks", async () => {
    workAnswers.push({
      collections: [
        collectionJob("a"),
        collectionJob("b"),
      ] as unknown as JSONObject,
      tests: [],
    });

    await runOpenStackWorkTick(DEPENDENCIES);

    const [first] = calls(WORK_URL);

    expect(first!.body).toMatchObject({
      probeKey: "test-probe-key",
      probeId: "11111111-2222-3333-4444-555555555555",
      runningOpenStackCloudIds: [],
    });
    expect(getRunningOpenStackCloudIds()).toEqual(["a", "b"]);

    // The next tick names both, and a cloud handed out again is not collected twice.
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runOpenStackWorkTick(DEPENDENCIES);

    expect(calls(WORK_URL)[1]!.body["runningOpenStackCloudIds"]).toEqual([
      "a",
      "b",
    ]);
    expect(
      collections.map((pending: PendingCollection) => {
        return pending.job.openStackCloudId;
      }),
    ).toEqual(["a", "b"]);
  });

  test("one question at a time: a tick while the last is unanswered asks nothing", async () => {
    let answer: (value: JSONObject) => void = (): void => {};

    workAnswers.push(
      new Promise<JSONObject>((resolve: (value: JSONObject) => void) => {
        answer = resolve;
      }),
    );

    const first: Promise<void> = runOpenStackWorkTick(DEPENDENCIES);

    await settle();
    await runOpenStackWorkTick(DEPENDENCIES);

    expect(calls(WORK_URL)).toHaveLength(1);

    answer({ collections: [], tests: [] });
    await first;

    await runOpenStackWorkTick(DEPENDENCIES);

    expect(calls(WORK_URL)).toHaveLength(2);
  });

  test("a server older than OpenStack collection is no work, and says so", async () => {
    workAnswers.push(new HTTPErrorResponse(404, { message: "Not Found" }, {}));

    await runOpenStackWorkTick(DEPENDENCIES);

    expect(collections).toHaveLength(0);
    expect(tests).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      "OpenStack work request failed: HTTP 404 - Not Found. A server older than OpenStack collection answers 404 here.",
    );
  });

  test("no answer at all is no work, and the next tick asks again", async () => {
    workAnswers.push(new Error("Connection refused."));

    await expect(fetchOpenStackWork()).resolves.toEqual({
      collections: [],
      tests: [],
    });

    await runOpenStackWorkTick(DEPENDENCIES);

    expect(calls(WORK_URL)).toHaveLength(2);
  });

  test.each([
    ["nothing", {}],
    ["the wrong shapes", { collections: "many", tests: 3 }],
  ])("an answer of %s is no work", async (_name: string, body: JSONObject) => {
    workAnswers.push(body);

    await expect(fetchOpenStackWork()).resolves.toEqual({
      collections: [],
      tests: [],
    });
  });
});

describe("collecting", () => {
  test("each is reported compressed, with its metrics, and then frees its slot", async () => {
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runOpenStackWorkTick(DEPENDENCIES);

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
      openStackCloudId: "a",
      settingsVersion: 3,
      status: "Succeeded",
      resourceMetrics: [{ resource: { attributes: [] }, scopeMetrics: [] }],
    });
    // Megabytes over a slow link: a long upload, and no body cap.
    expect(report!.options["timeout"]).toBeGreaterThanOrEqual(
      REPORT_UPLOAD_TIMEOUT_IN_MS,
    );
    expect(report!.options["maxBodyLength"]).toBe(Infinity);
    // The report never carries the secret back.
    expect(JSON.stringify(report!.body)).not.toContain(SECRET);

    expect(getRunningOpenStackCloudIds()).toEqual([]);
  });

  test("never more than four clouds at once, and the rest wait their turn", async () => {
    workAnswers.push({
      collections: ["a", "b", "c", "d", "e", "f"].map(
        collectionJob,
      ) as unknown as JSONObject,
      tests: [],
    });

    await runOpenStackWorkTick(DEPENDENCIES);

    expect(OPENSTACK_PROBE_COLLECTION_CONCURRENCY).toBe(4);
    expect(getRunningOpenStackCloudIds()).toEqual(["a", "b", "c", "d"]);
    expect(collections).toHaveLength(4);
    expect(logger.warn).toHaveBeenCalledWith(
      "OpenStack collection of e skipped: 4 collections are already running.",
    );
  });

  test("a collection that throws is still answered, as Failed with the reason", async () => {
    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runOpenStackWorkTick(DEPENDENCIES);

    collections[0]!.reject(new Error("Out of memory."));
    collections = [];
    await waitForRunningCollections();

    expect(calls(COLLECTION_URL)[0]!.body).toMatchObject({
      openStackCloudId: "a",
      settingsVersion: 3,
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.Internal,
      errorMessage: "The probe hit an unexpected error: Out of memory.",
    });
    expect(getRunningOpenStackCloudIds()).toEqual([]);
  });

  test("a report that cannot be delivered still frees the slot", async () => {
    collectionAnswers.push(new Error("The server is gone."));

    workAnswers.push({
      collections: [collectionJob("a")] as unknown as JSONObject,
      tests: [],
    });

    await runOpenStackWorkTick(DEPENDENCIES);

    collections[0]!.resolve(succeeded(collections[0]!.job));
    await waitForRunningCollections();

    expect(getRunningOpenStackCloudIds()).toEqual([]);
  });
});

describe("connection tests", () => {
  test("run at once and are answered, a test that throws as Failed", async () => {
    workAnswers.push({
      collections: [],
      tests: [testJob("t-1"), testJob("throws")] as unknown as JSONObject,
    });

    await runOpenStackWorkTick(DEPENDENCIES);
    await settle();

    expect(
      tests.map((job: OpenStackConnectionTestJob) => {
        return job.openStackCloudConnectionTestId;
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
      openStackCloudConnectionTestId: "t-1",
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.InvalidCredential,
    });
    expect(reports[1]).toMatchObject({
      openStackCloudConnectionTestId: "throws",
      status: "Failed",
      errorCode: OpenStackCollectionErrorCode.Internal,
      errorMessage: "The probe hit an unexpected error: A bug.",
    });
  });

  test("a person is waiting: a test runs beside the collections, and is not held up by them", async () => {
    workAnswers.push({
      collections: ["a", "b", "c", "d"].map(
        collectionJob,
      ) as unknown as JSONObject,
      tests: [testJob("t-1")] as unknown as JSONObject,
    });

    await runOpenStackWorkTick(DEPENDENCIES);
    await settle();

    expect(collections).toHaveLength(4);
    expect(calls(COLLECTION_URL)).toHaveLength(0);
    expect(calls(TEST_URL)).toHaveLength(1);
  });

  test("the same test handed out while it runs is run once", async () => {
    let finish: (
      report: OpenStackConnectionTestReport,
    ) => void = (): void => {};
    let started: number = 0;

    const slowTest: FetchOpenStackWorkDependencies = {
      collect: DEPENDENCIES.collect,
      test: (): Promise<OpenStackConnectionTestReport> => {
        started++;

        return new Promise<OpenStackConnectionTestReport>(
          (resolve: (report: OpenStackConnectionTestReport) => void) => {
            finish = resolve;
          },
        );
      },
    };

    workAnswers.push({
      collections: [],
      tests: [testJob("t-1")] as unknown as JSONObject,
    });
    await runOpenStackWorkTick(slowTest);

    workAnswers.push({
      collections: [],
      tests: [testJob("t-1")] as unknown as JSONObject,
    });
    await runOpenStackWorkTick(slowTest);
    await settle();

    expect(started).toBe(1);

    finish({
      openStackCloudConnectionTestId: "t-1",
      status: "Succeeded",
      durationInMs: 1,
    });
    await settle();

    expect(calls(TEST_URL)).toHaveLength(1);
  });
});

describe("reports the server does not take", () => {
  test("a collection report it refuses is logged, not sent again", async () => {
    collectionAnswers.push({
      accepted: false,
      reason: "Another probe collects it now.",
    });

    expect(await postCollectionReport(succeeded(collectionJob("a")))).toBe(
      false,
    );
    expect(calls(COLLECTION_URL)).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "The collection report of cloud a was not accepted: Another probe collects it now.",
    );
  });

  test("a collection report it answers with an error is the same", async () => {
    collectionAnswers.push(
      new HTTPErrorResponse(413, { message: "Too large" }, {}),
    );

    expect(await postCollectionReport(succeeded(collectionJob("a")))).toBe(
      false,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "The collection report of cloud a was not accepted: HTTP 413 - Too large.",
    );
  });

  test("a collection report it takes is said to be taken", async () => {
    await expect(
      postCollectionReport(succeeded(collectionJob("a"))),
    ).resolves.toBe(true);
  });

  test("a report that never arrives is logged", async () => {
    collectionAnswers.push(new Error("The server is gone."));

    expect(await postCollectionReport(succeeded(collectionJob("a")))).toBe(
      false,
    );
    expect(logger.error).toHaveBeenCalledWith(
      "Error reporting the collection of cloud a",
    );
  });

  test.each([
    ["it refuses", { accepted: false }, false],
    ["it takes", { accepted: true }, true],
    ["answers with an error", new HTTPErrorResponse(500, {}, {}), false],
    ["never arrives", new Error("Gone."), false],
  ])(
    "a test report %s",
    async (
      _name: string,
      answer: JSONObject | HTTPErrorResponse | Error,
      isTaken: boolean,
    ) => {
      testAnswers.push(answer);

      await expect(
        postTestReport({
          openStackCloudConnectionTestId: "t-1",
          status: "Succeeded",
          durationInMs: 1,
        }),
      ).resolves.toBe(isTaken);
    },
  );
});
