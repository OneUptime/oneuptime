import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Probe from "Common/Models/DatabaseModels/Probe";
import Response from "Common/Server/Utils/Response";
import { OpenStackCollectionReportOutcome } from "Common/Server/Utils/OpenStack/OpenStackProbeCollectionStore";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_PROBE_COLLECTION_CONCURRENCY,
  OPENSTACK_PROBE_TEST_BATCH_SIZE,
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackConnectionTestJob,
  OpenStackConnectionTestReport,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Each router the module makes records its own routes, because the module makes one for its
 * default export as it is imported, and each test here makes another over a fake store.
 */
interface RecordedRoute {
  middlewares: Array<unknown>;
  handler: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void>;
}

interface RecordingRouter {
  routes: Map<string, RecordedRoute>;
  post: (uri: string, ...handlers: Array<unknown>) => void;
}

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: (): RecordingRouter => {
        const routes: Map<string, RecordedRoute> = new Map();

        return {
          routes: routes,
          post: (uri: string, ...handlers: Array<unknown>): void => {
            routes.set(uri, {
              middlewares: handlers.slice(0, -1),
              handler: handlers[
                handlers.length - 1
              ] as RecordedRoute["handler"],
            });
          },
        };
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/TelemetryIngestionDisabled", () => {
  return {
    __esModule: true,
    default: {
      isDisabled: jest.fn(),
    },
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addMetricIngestJob: jest.fn(),
      },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * The probe's side of collecting clouds: the work it is handed, and what it reports. What
 * these protect:
 *
 *   - every route is behind probe authentication and keys every read and write on the
 *     AUTHENTICATED probe, never a probe id in the body, so a probe is only handed, and only
 *     heard about, its own clouds and tests;
 *   - a probe is handed no more collections than it has free slots for, and none while
 *     telemetry ingestion is off on the instance;
 *   - a collection's metrics enter the very ingest the agent's do, as one job, stamped with
 *     the cloud's name by the server, and that holds for a failed collection too, whose
 *     series are what says a cloud is failing;
 *   - a gzip-compressed report is read as the JSON it is.
 *
 * The real store comes with the phase's model, so these run on a fake of the interface.
 */
import OpenStackCollectionRouter, {
  OPENSTACK_PROBE_WORK_STORE_WITHOUT_COLUMNS,
  OpenStackProbeWorkStore,
  createOpenStackCollectionRouter,
  getCollectionClaimLimit,
  parseInflatedJsonBody,
  readRunningOpenStackCloudIds,
} from "../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection";

const ingestion: { isDisabled: jest.Mock } =
  TelemetryIngestionDisabled as unknown as { isDisabled: jest.Mock };

const queue: { addMetricIngestJob: jest.Mock } =
  TelemetryQueueService as unknown as { addMetricIngestJob: jest.Mock };

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

const WORK_URI: string = "/probe/openstack/work";
const COLLECTION_URI: string = "/probe/openstack/collection";
const TEST_URI: string = "/probe/openstack/test";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CLOUD_ID: string = "44444444-4444-4444-8444-444444444444";
const RUNNING_ID: string = "55555555-5555-4555-8555-555555555555";
const TEST_ID: string = "66666666-6666-4666-8666-666666666666";

const mockResponse: ExpressResponse = {} as ExpressResponse;

function makeRequest(data: {
  probeId?: ObjectID | null | undefined;
  body?: unknown;
}): ExpressRequest {
  const req: JSONObject = {
    body: (data.body === undefined ? {} : data.body) as JSONObject,
  };

  if (data.probeId !== null) {
    req["probe"] = new Probe(data.probeId || PROBE_ID);
  }

  return req as unknown as ExpressRequest;
}

type NextSpy = ReturnType<typeof jest.fn>;

function sentBody(): JSONObject {
  expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

function refusal(): string {
  expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);

  const error: unknown = responseUtil.sendErrorResponse.mock.calls[0]![2];

  expect(error).toBeInstanceOf(BadDataException);

  return (error as Error).message;
}

function collectionJob(): OpenStackCollectionJob {
  return {
    openStackCloudId: CLOUD_ID,
    cloudName: "Production",
    authUrl: "https://keystone.example.com:5000",
    credential: {
      kind: "applicationCredential",
      id: "an-id",
      secret: "a-secret",
    },
    regions: ["RegionOne"],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
    collectionIntervalInMinutes: 2,
    settingsVersion: 3,
  };
}

function testJob(): OpenStackConnectionTestJob {
  return {
    openStackCloudConnectionTestId: TEST_ID,
    authUrl: "https://keystone.example.com:5000",
    credential: {
      kind: "applicationCredential",
      id: "an-id",
      secret: "a-secret",
    },
    regions: [],
    endpointInterface: "public",
    trustedCertificateFingerprints: [],
  };
}

function resourceMetrics(): JSONArray {
  return [
    {
      resource: {
        attributes: [
          // A probe never says which cloud, or what it is.
          {
            key: "openstack.cloud.name",
            value: { stringValue: "Someone else's" },
          },
          { key: "service.name", value: { stringValue: "a phantom" } },
          {
            key: "oneuptime.agent.version",
            value: { stringValue: "pretending" },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "oneuptime-probe-openstack", version: "1" },
          metrics: [
            {
              name: "openstack_nova_up",
              description: "up",
              gauge: {
                dataPoints: [
                  {
                    asDouble: 1,
                    timeUnixNano: "1",
                    attributes: [
                      {
                        key: "openstack.region.name",
                        value: { stringValue: "RegionOne" },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ];
}

function collectionReport(overrides: JSONObject = {}): JSONObject {
  return {
    openStackCloudId: CLOUD_ID,
    settingsVersion: 3,
    collectedAt: "2026-11-04T12:00:00.000Z",
    status: "Succeeded",
    durationInMs: 900,
    resourceMetrics: resourceMetrics(),
    ...overrides,
  };
}

interface FakeStore {
  store: OpenStackProbeWorkStore;
  claimForCollection: jest.Mock;
  recordCollectionReport: jest.Mock;
  claimPendingTests: jest.Mock;
  recordTestReport: jest.Mock;
}

function fakeStore(): FakeStore {
  const claimForCollection: jest.Mock = jest.fn(async () => {
    return [collectionJob()];
  });
  const recordCollectionReport: jest.Mock = jest.fn(
    async (): Promise<OpenStackCollectionReportOutcome> => {
      return {
        accepted: true,
        projectId: PROJECT_ID,
        cloudName: "Production",
        isCurrent: true,
      };
    },
  );
  const claimPendingTests: jest.Mock = jest.fn(async () => {
    return [testJob()];
  });
  const recordTestReport: jest.Mock = jest.fn(async () => {
    return true;
  });

  return {
    claimForCollection: claimForCollection,
    recordCollectionReport: recordCollectionReport,
    claimPendingTests: claimPendingTests,
    recordTestReport: recordTestReport,
    store: {
      claimForCollection:
        claimForCollection as unknown as OpenStackProbeWorkStore["claimForCollection"],
      recordCollectionReport:
        recordCollectionReport as unknown as OpenStackProbeWorkStore["recordCollectionReport"],
      claimPendingTests:
        claimPendingTests as unknown as OpenStackProbeWorkStore["claimPendingTests"],
      recordTestReport:
        recordTestReport as unknown as OpenStackProbeWorkStore["recordTestReport"],
    },
  };
}

let fake: FakeStore;
let router: RecordingRouter;

async function call(
  uri: string,
  req: ExpressRequest,
): Promise<{ next: NextSpy }> {
  const next: NextSpy = jest.fn();

  await router.routes
    .get(uri)!
    .handler(req, mockResponse, next as unknown as NextFunction);

  return { next };
}

beforeEach(() => {
  jest.clearAllMocks();
  ingestion.isDisabled.mockReturnValue(false as never);
  queue.addMetricIngestJob.mockResolvedValue(undefined as never);
  fake = fakeStore();
  router = createOpenStackCollectionRouter(
    fake.store,
  ) as unknown as RecordingRouter;
});

describe("wiring", () => {
  test.each([WORK_URI, COLLECTION_URI, TEST_URI])(
    "%s is a POST behind probe authentication",
    (uri: string) => {
      expect(router.routes.get(uri)?.middlewares).toContain(
        ProbeAuthorization.isAuthorizedServiceMiddleware,
      );
    },
  );

  test("a compressed collection report is read as JSON before the probe is authenticated from it", () => {
    expect(router.routes.get(COLLECTION_URI)?.middlewares).toEqual([
      parseInflatedJsonBody,
      ProbeAuthorization.isAuthorizedServiceMiddleware,
    ]);
  });

  test.each([WORK_URI, COLLECTION_URI, TEST_URI])(
    "%s refuses a request no probe was authenticated for",
    async (uri: string) => {
      await call(uri, makeRequest({ probeId: null }));

      expect(refusal()).toBe("Probe not found");
    },
  );

  test("the Telemetry feature set mounts the routes under the probe ingest prefixes", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../FeatureSet/Telemetry/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import ProbeIngestOpenStackCollectionAPI from "./API/ProbeIngest/OpenStackCollection";',
    );
    expect(index).toContain(
      "app.use(PROBE_INGEST_PREFIXES, ProbeIngestOpenStackCollectionAPI);",
    );
  });

  test("the module's own routes are there to be mounted", () => {
    expect(
      Array.from(
        (OpenStackCollectionRouter as unknown as RecordingRouter).routes.keys(),
      ).sort(),
    ).toEqual([COLLECTION_URI, TEST_URI, WORK_URI]);
  });
});

/*
 * Until the model has its collection columns no cloud can be collected, and a probe has to
 * be told so in a way it already understands: an older server says 404, this one says there
 * is nothing to do.
 */
describe("before the model has its columns", () => {
  test("there is no work", async () => {
    await expect(
      OPENSTACK_PROBE_WORK_STORE_WITHOUT_COLUMNS.claimForCollection({
        probeId: PROBE_ID,
        runningOpenStackCloudIds: [],
        limit: 4,
      }),
    ).resolves.toEqual([]);
    await expect(
      OPENSTACK_PROBE_WORK_STORE_WITHOUT_COLUMNS.claimPendingTests({
        probeId: PROBE_ID,
        limit: 5,
      }),
    ).resolves.toEqual([]);
  });

  test("and no report is heard", async () => {
    await expect(
      OPENSTACK_PROBE_WORK_STORE_WITHOUT_COLUMNS.recordCollectionReport({
        probeId: PROBE_ID,
        report: collectionReport() as unknown as OpenStackCollectionReport,
      }),
    ).resolves.toEqual({
      accepted: false,
      reason: "OpenStack collection is not set up on this server yet.",
    });
    await expect(
      OPENSTACK_PROBE_WORK_STORE_WITHOUT_COLUMNS.recordTestReport({
        probeId: PROBE_ID,
        report: {
          openStackCloudConnectionTestId: TEST_ID,
          status: "Succeeded",
          durationInMs: 1,
        },
      }),
    ).resolves.toBe(false);
  });
});

describe("what a probe says it is running", () => {
  test("ids only: nothing else reaches a query", () => {
    expect(
      readRunningOpenStackCloudIds([
        CLOUD_ID,
        ` ${RUNNING_ID} `,
        "not-an-id",
        "'; DROP TABLE x; --",
        7,
        null,
      ]),
    ).toEqual([CLOUD_ID, RUNNING_ID]);
  });

  test.each([[null], [undefined], ["x"], [{}], [7]])(
    "%j is nothing",
    (value: unknown) => {
      expect(readRunningOpenStackCloudIds(value)).toEqual([]);
    },
  );

  test("bounded, whatever it says", () => {
    expect(
      readRunningOpenStackCloudIds(
        Array.from({ length: 1000 }, () => {
          return CLOUD_ID;
        }),
      ),
    ).toHaveLength(100);
  });
});

describe("how many collections a probe may start", () => {
  test.each([
    [0, OPENSTACK_PROBE_COLLECTION_CONCURRENCY],
    [1, OPENSTACK_PROBE_COLLECTION_CONCURRENCY - 1],
    [OPENSTACK_PROBE_COLLECTION_CONCURRENCY, 0],
    [OPENSTACK_PROBE_COLLECTION_CONCURRENCY + 5, 0],
  ])("%s running, %s more", (running: number, limit: number) => {
    expect(getCollectionClaimLimit(running)).toBe(limit);
  });
});

describe(`POST ${WORK_URI}`, () => {
  test("is the work for this probe, whichever probe the body claims to be", async () => {
    await call(
      WORK_URI,
      makeRequest({
        body: {
          probeId: OTHER_PROBE_ID.toString(),
          runningOpenStackCloudIds: [RUNNING_ID],
        },
      }),
    );

    expect(fake.claimForCollection).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      runningOpenStackCloudIds: [RUNNING_ID],
      limit: OPENSTACK_PROBE_COLLECTION_CONCURRENCY - 1,
    });
    expect(fake.claimPendingTests).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      limit: OPENSTACK_PROBE_TEST_BATCH_SIZE,
    });

    expect(sentBody()).toEqual({
      collections: [collectionJob()],
      tests: [testJob()],
    });
  });

  test("a probe with no free slots is asked about no more", async () => {
    await call(
      WORK_URI,
      makeRequest({
        body: {
          runningOpenStackCloudIds: [
            "aaaaaaaa-1111-4111-8111-111111111111",
            "aaaaaaaa-1111-4111-8111-111111111112",
            "aaaaaaaa-1111-4111-8111-111111111113",
            "aaaaaaaa-1111-4111-8111-111111111114",
          ],
        },
      }),
    );

    expect(fake.claimForCollection.mock.calls[0]?.[0]).toMatchObject({
      limit: 0,
    });
  });

  test("with ingestion off a collection could only be thrown away, and a test still runs", async () => {
    ingestion.isDisabled.mockReturnValue(true as never);

    await call(WORK_URI, makeRequest({}));

    expect(fake.claimForCollection).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({ collections: [], tests: [testJob()] });
  });

  test("a body that is not one is no running collections", async () => {
    await call(WORK_URI, makeRequest({ body: [1, 2] }));

    expect(fake.claimForCollection.mock.calls[0]?.[0]).toMatchObject({
      runningOpenStackCloudIds: [],
    });
  });

  test("a failure goes to the error handler, and hands out nothing", async () => {
    const failure: Error = new Error("The database is gone.");

    fake.claimForCollection.mockRejectedValue(failure as never);

    const { next } = await call(WORK_URI, makeRequest({}));

    expect(next).toHaveBeenCalledWith(failure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe(`POST ${COLLECTION_URI}`, () => {
  test.each([
    ["nothing", {}],
    ["a status it does not know", collectionReport({ status: "Whatever" })],
    [
      "Pending, which no probe can say",
      collectionReport({ status: "Pending" }),
    ],
  ])("%s is refused", async (_name: string, body: JSONObject) => {
    await call(COLLECTION_URI, makeRequest({ body: body }));

    expect(refusal()).toBe(
      "A collection report is Succeeded, PartiallySucceeded or Failed.",
    );
    expect(fake.recordCollectionReport).not.toHaveBeenCalled();
  });

  test("is heard as this probe's, whichever probe the body claims to be", async () => {
    await call(
      COLLECTION_URI,
      makeRequest({
        body: collectionReport({ probeId: OTHER_PROBE_ID.toString() }),
      }),
    );

    expect(fake.recordCollectionReport.mock.calls[0]?.[0]).toMatchObject({
      probeId: PROBE_ID,
    });
  });

  test("its metrics enter the ingest the agent's do, as one job, under the server's word for the cloud", async () => {
    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(queue.addMetricIngestJob).toHaveBeenCalledTimes(1);

    const job: JSONObject = queue.addMetricIngestJob.mock
      .calls[0]?.[0] as JSONObject;

    expect(job["projectId"]).toEqual(PROJECT_ID);
    expect(job["productType"]).toBe(ProductType.Metrics);

    const [resource] = (job["body"] as JSONObject)[
      "resourceMetrics"
    ] as Array<JSONObject>;

    expect((resource!["resource"] as JSONObject)["attributes"]).toEqual([
      { key: "openstack.cloud.name", value: { stringValue: "Production" } },
    ]);
    expect(resource!["scopeMetrics"]).toEqual(
      (resourceMetrics()[0] as JSONObject)["scopeMetrics"],
    );

    expect(sentBody()).toEqual({
      accepted: true,
      isCurrent: true,
      queuedResourceCount: 1,
    });
  });

  test("a failed collection's metrics enter too: they are what says it is failing", async () => {
    await call(
      COLLECTION_URI,
      makeRequest({
        body: collectionReport({
          status: "Failed",
          errorCode: "KeystoneFailing",
          errorMessage: "Keystone answered 503.",
        }),
      }),
    );

    expect(queue.addMetricIngestJob).toHaveBeenCalledTimes(1);
    expect(sentBody()).toMatchObject({
      accepted: true,
      queuedResourceCount: 1,
    });
  });

  test("a partly successful one too", async () => {
    await call(
      COLLECTION_URI,
      makeRequest({ body: collectionReport({ status: "PartiallySucceeded" }) }),
    );

    expect(queue.addMetricIngestJob).toHaveBeenCalledTimes(1);
  });

  test("a report for older settings still delivers its data", async () => {
    fake.recordCollectionReport.mockResolvedValue({
      accepted: true,
      projectId: PROJECT_ID,
      cloudName: "Production",
      isCurrent: false,
    } as never);

    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(queue.addMetricIngestJob).toHaveBeenCalledTimes(1);
    expect(sentBody()).toMatchObject({ isCurrent: false });
  });

  test("a report not heard goes no further, and the probe is told why", async () => {
    fake.recordCollectionReport.mockResolvedValue({
      accepted: false,
      reason: "This probe does not collect that cloud.",
    } as never);

    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({
      accepted: false,
      reason: "This probe does not collect that cloud.",
    });
  });

  test("a report heard for a project it cannot name goes no further", async () => {
    fake.recordCollectionReport.mockResolvedValue({
      accepted: true,
    } as never);

    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({
      accepted: false,
      reason: "The report was not accepted.",
    });
  });

  test("with ingestion off the status is still kept, and nothing is queued", async () => {
    ingestion.isDisabled.mockReturnValue(true as never);

    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(fake.recordCollectionReport).toHaveBeenCalledTimes(1);
    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()).toMatchObject({
      accepted: true,
      queuedResourceCount: 0,
    });
  });

  test.each([
    ["no metrics at all", undefined],
    ["metrics that are not", "many"],
    ["no resources", []],
  ])("%s queues nothing", async (_name: string, value: unknown) => {
    await call(
      COLLECTION_URI,
      makeRequest({
        body: collectionReport({ resourceMetrics: value as JSONArray }),
      }),
    );

    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()).toMatchObject({ queuedResourceCount: 0 });
  });

  test("a cloud with no name has nothing to send under", async () => {
    fake.recordCollectionReport.mockResolvedValue({
      accepted: true,
      projectId: PROJECT_ID,
    } as never);

    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
  });

  test("a queue that fails goes to the error handler", async () => {
    const failure: Error = new Error("Redis is gone.");

    queue.addMetricIngestJob.mockRejectedValue(failure as never);

    const { next } = await call(
      COLLECTION_URI,
      makeRequest({ body: collectionReport() }),
    );

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe(`POST ${TEST_URI}`, () => {
  test.each([
    ["nothing", {}],
    ["a status it does not know", { status: "Whatever" }],
    ["Running, which no probe can say", { status: "Running" }],
  ])("%s is refused", async (_name: string, body: JSONObject) => {
    await call(TEST_URI, makeRequest({ body: body }));

    expect(refusal()).toBe("A test report is Succeeded or Failed.");
    expect(fake.recordTestReport).not.toHaveBeenCalled();
  });

  test("is heard as this probe's, whichever probe the body claims to be", async () => {
    const report: OpenStackConnectionTestReport = {
      openStackCloudConnectionTestId: TEST_ID,
      status: "Failed",
      durationInMs: 10,
    };

    await call(
      TEST_URI,
      makeRequest({
        body: { ...report, probeId: OTHER_PROBE_ID.toString() },
      }),
    );

    expect(fake.recordTestReport.mock.calls[0]?.[0]).toMatchObject({
      probeId: PROBE_ID,
      report: { openStackCloudConnectionTestId: TEST_ID },
    });
    expect(sentBody()).toEqual({ accepted: true });
  });

  test("the store's answer is the probe's", async () => {
    fake.recordTestReport.mockResolvedValue(false as never);

    await call(
      TEST_URI,
      makeRequest({
        body: {
          openStackCloudConnectionTestId: TEST_ID,
          status: "Succeeded",
          durationInMs: 10,
        },
      }),
    );

    expect(sentBody()).toEqual({ accepted: false });
  });

  test("a failure goes to the error handler", async () => {
    const failure: Error = new Error("The database is gone.");

    fake.recordTestReport.mockRejectedValue(failure as never);

    const { next } = await call(
      TEST_URI,
      makeRequest({
        body: {
          openStackCloudConnectionTestId: TEST_ID,
          status: "Succeeded",
          durationInMs: 10,
        },
      }),
    );

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe("a report as it arrives", () => {
  function runParse(body: unknown): { body: unknown; next: NextSpy } {
    const req: { body: unknown } = { body: body };
    const next: NextSpy = jest.fn();

    parseInflatedJsonBody(
      req as unknown as Parameters<typeof parseInflatedJsonBody>[0],
      mockResponse,
      next as unknown as NextFunction,
    );

    return { body: req.body, next: next };
  }

  test("inflated bytes are read as the JSON they are", () => {
    const { body, next } = runParse(Buffer.from('{"status":"Succeeded"}'));

    expect(body).toEqual({ status: "Succeeded" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("a plain JSON body passes untouched", () => {
    const { body, next } = runParse({ status: "Succeeded" });

    expect(body).toEqual({ status: "Succeeded" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("bytes that are not JSON are refused", () => {
    const { next } = runParse(Buffer.from("not json"));

    expect(next).not.toHaveBeenCalled();
    expect(refusal()).toBe("The collection report is not JSON.");
  });
});
