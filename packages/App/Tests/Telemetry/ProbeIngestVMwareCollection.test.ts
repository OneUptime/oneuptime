import { mockRouter } from "Common/Tests/Server/API/Helpers";
import VMwareVCenterConnectionTestService from "Common/Server/Services/VMwareVCenterConnectionTestService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Probe from "Common/Models/DatabaseModels/Probe";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import VMwareCollectionErrorCode from "Common/Types/VMware/VMwareCollectionError";
import {
  VMWARE_PROBE_COLLECTION_CONCURRENCY,
  VMWARE_PROBE_TEST_BATCH_SIZE,
  VMwareCollectionJob,
  VMwareConnectionTestJob,
} from "Common/Types/VMware/VMwareProbeCollection";
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

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
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

jest.mock("Common/Server/Services/VMwareVCenterService", () => {
  return {
    __esModule: true,
    default: {
      claimForCollection: jest.fn(),
      recordCollectionReport: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/VMwareVCenterConnectionTestService", () => {
  return {
    __esModule: true,
    default: {
      claimPendingTests: jest.fn(),
      recordTestReport: jest.fn(),
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
 * The probe's side of collecting vCenters: the work it is handed, and what
 * it reports. What these protect:
 *
 *   - every route is behind probe authentication and keys every read and
 *     write on the AUTHENTICATED probe - a probe id in the body is never read
 *     - so a probe is only handed, and only heard about, its own vCenters and
 *     tests;
 *   - a probe is handed no more collections than it has free slots for, and
 *     none while telemetry ingestion is off on the instance;
 *   - a collection's metrics enter the very ingest the VMware agent's do, as
 *     one job, stamped with the vCenter's name by the server;
 *   - a gzip-compressed report is read as the JSON it is.
 */
import VMwareCollectionRouter, {
  getCollectionClaimLimit,
  parseInflatedJsonBody,
  readRunningVMwareVCenterIds,
} from "../../FeatureSet/Telemetry/API/ProbeIngest/VMwareCollection";

const vcenters: {
  claimForCollection: jest.Mock;
  recordCollectionReport: jest.Mock;
} = VMwareVCenterService as unknown as {
  claimForCollection: jest.Mock;
  recordCollectionReport: jest.Mock;
};

const connectionTests: {
  claimPendingTests: jest.Mock;
  recordTestReport: jest.Mock;
} = VMwareVCenterConnectionTestService as unknown as {
  claimPendingTests: jest.Mock;
  recordTestReport: jest.Mock;
};

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

const WORK_URI: string = "/probe/vmware/work";
const COLLECTION_URI: string = "/probe/vmware/collection";
const TEST_URI: string = "/probe/vmware/test";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const VCENTER_ID: string = "44444444-4444-4444-8444-444444444444";
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

async function call(
  uri: string,
  req: ExpressRequest,
): Promise<{ next: NextSpy }> {
  const next: NextSpy = jest.fn();

  await mockRouter
    .match("post", uri)
    .handlerFunction(req, mockResponse, next as unknown as NextFunction);

  return { next };
}

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

function collectionJob(): VMwareCollectionJob {
  return {
    vmwareVCenterId: VCENTER_ID,
    vcenterName: "Production",
    vcenterUrl: "https://vcsa.example.com",
    username: "oneuptime@vsphere.local",
    password: "secret",
    collectionIntervalInMinutes: 2,
    settingsVersion: 3,
  };
}

function testJob(): VMwareConnectionTestJob {
  return {
    vmwareVCenterConnectionTestId: TEST_ID,
    vcenterUrl: "https://vcsa.example.com",
    username: "oneuptime@vsphere.local",
    password: "secret",
  };
}

function resourceMetrics(): JSONArray {
  return [
    {
      resource: {
        attributes: [
          { key: "vcenter.datacenter.name", value: { stringValue: "DC1" } },
          { key: "vcenter.host.name", value: { stringValue: "esx-01" } },
          // A probe never names the vCenter itself.
          {
            key: "vmware.vcenter.name",
            value: { stringValue: "Someone else's" },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "oneuptime-probe-vmware", version: "1" },
          metrics: [
            {
              name: "vcenter.host.cpu.usage",
              unit: "MHz",
              sum: {
                dataPoints: [{ asInt: "1200", timeUnixNano: "1" }],
                aggregationTemporality: 2,
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
    vmwareVCenterId: VCENTER_ID,
    settingsVersion: 3,
    collectedAt: "2026-10-10T12:00:00.000Z",
    status: "Succeeded",
    durationInMs: 900,
    resourceMetrics: resourceMetrics(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ingestion.isDisabled.mockReturnValue(false as never);
  vcenters.claimForCollection.mockResolvedValue([collectionJob()] as never);
  connectionTests.claimPendingTests.mockResolvedValue([testJob()] as never);
  vcenters.recordCollectionReport.mockResolvedValue({
    accepted: true,
    projectId: PROJECT_ID,
    vcenterName: "Production",
    isCurrent: true,
  } as never);
  connectionTests.recordTestReport.mockResolvedValue(true as never);
  queue.addMetricIngestJob.mockResolvedValue(undefined as never);
});

describe("wiring", () => {
  test("the router is what the module exports", () => {
    expect(VMwareCollectionRouter).toBe(mockRouter);
  });

  test.each([WORK_URI, COLLECTION_URI, TEST_URI])(
    "%s is a POST behind probe authentication",
    (uri: string) => {
      expect(mockRouter.match("post", uri).middlewares).toContain(
        ProbeAuthorization.isAuthorizedServiceMiddleware,
      );
    },
  );

  test("a compressed collection report is read as JSON before the probe is authenticated from it", () => {
    expect(mockRouter.match("post", COLLECTION_URI).middlewares).toEqual([
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
      'import ProbeIngestVMwareCollectionAPI from "./API/ProbeIngest/VMwareCollection";',
    );
    expect(index).toContain(
      "app.use(PROBE_INGEST_PREFIXES, ProbeIngestVMwareCollectionAPI);",
    );
  });
});

describe("POST /probe/vmware/work", () => {
  test("hands the authenticated probe its due vCenters and its tests - never a probe the body names", async () => {
    await call(
      WORK_URI,
      makeRequest({
        body: {
          probeId: OTHER_PROBE_ID.toString(),
          runningVMwareVCenterIds: [RUNNING_ID],
        },
      }),
    );

    expect(vcenters.claimForCollection).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      runningVMwareVCenterIds: [RUNNING_ID],
      limit: VMWARE_PROBE_COLLECTION_CONCURRENCY - 1,
    });
    expect(connectionTests.claimPendingTests).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      limit: VMWARE_PROBE_TEST_BATCH_SIZE,
    });
    expect(sentBody()).toEqual({
      collections: [collectionJob()],
      tests: [testJob()],
    });
  });

  test("with telemetry ingestion off, no collection is handed out - a test still runs", async () => {
    ingestion.isDisabled.mockReturnValue(true as never);

    await call(WORK_URI, makeRequest({}));

    expect(vcenters.claimForCollection).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({ collections: [], tests: [testJob()] });
  });

  test("a failure is handed to Express's error handling", async () => {
    const failure: Error = new Error("database is gone");
    vcenters.claimForCollection.mockRejectedValue(failure as never);

    const { next } = await call(WORK_URI, makeRequest({}));

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe("POST /probe/vmware/collection", () => {
  test("records the report as the authenticated probe's, and queues the metrics as one ingest job, named by the server", async () => {
    await call(
      COLLECTION_URI,
      makeRequest({
        body: { ...collectionReport(), probeId: OTHER_PROBE_ID.toString() },
      }),
    );

    expect(vcenters.recordCollectionReport).toHaveBeenCalledTimes(1);
    expect(
      (
        vcenters.recordCollectionReport.mock.calls[0]![0] as {
          probeId: ObjectID;
        }
      ).probeId.toString(),
    ).toBe(PROBE_ID.toString());

    expect(queue.addMetricIngestJob).toHaveBeenCalledTimes(1);
    const job: JSONObject = queue.addMetricIngestJob.mock
      .calls[0]![0] as JSONObject;

    expect(job["projectId"]).toBe(PROJECT_ID);
    expect(job["productType"]).toBe(ProductType.Metrics);
    expect(job["headers"]).toEqual({});

    const queued: JSONArray = (job["body"] as JSONObject)[
      "resourceMetrics"
    ] as JSONArray;
    expect(queued).toHaveLength(1);
    expect(
      ((queued[0] as JSONObject)["resource"] as JSONObject)["attributes"],
    ).toEqual([
      { key: "vcenter.datacenter.name", value: { stringValue: "DC1" } },
      { key: "vcenter.host.name", value: { stringValue: "esx-01" } },
      { key: "vmware.vcenter.name", value: { stringValue: "Production" } },
    ]);

    expect(sentBody()).toEqual({
      accepted: true,
      isCurrent: true,
      queuedResourceCount: 1,
    });
  });

  test("a failed collection is recorded, and queues nothing", async () => {
    await call(
      COLLECTION_URI,
      makeRequest({
        body: collectionReport({
          status: "Failed",
          errorCode: VMwareCollectionErrorCode.InvalidLogin,
          errorMessage: "Refused.",
          resourceMetrics: undefined,
        }),
      }),
    );

    expect(vcenters.recordCollectionReport).toHaveBeenCalledTimes(1);
    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({
      accepted: true,
      isCurrent: true,
      queuedResourceCount: 0,
    });
  });

  test("a report the server does not hear is answered as such, and nothing is ingested", async () => {
    vcenters.recordCollectionReport.mockResolvedValue({
      accepted: false,
      reason: "This probe does not collect that vCenter (any more).",
    } as never);

    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({
      accepted: false,
      reason: "This probe does not collect that vCenter (any more).",
    });
  });

  test("with telemetry ingestion off, the status is recorded and the metrics dropped", async () => {
    ingestion.isDisabled.mockReturnValue(true as never);

    await call(COLLECTION_URI, makeRequest({ body: collectionReport() }));

    expect(vcenters.recordCollectionReport).toHaveBeenCalledTimes(1);
    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()["queuedResourceCount"]).toBe(0);
  });

  test("a success with nothing to ingest queues no empty job", async () => {
    await call(
      COLLECTION_URI,
      makeRequest({ body: collectionReport({ resourceMetrics: [] }) }),
    );

    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
  });

  test.each([undefined, "Pending", "succeeded", 7])(
    "a report whose status is %p is refused",
    async (status: unknown) => {
      await call(
        COLLECTION_URI,
        makeRequest({ body: collectionReport({ status: status as string }) }),
      );

      expect(refusal()).toBe("A collection report is Succeeded or Failed.");
      expect(vcenters.recordCollectionReport).not.toHaveBeenCalled();
    },
  );
});

describe("POST /probe/vmware/test", () => {
  test("records the test as the authenticated probe's", async () => {
    await call(
      TEST_URI,
      makeRequest({
        body: {
          vmwareVCenterConnectionTestId: TEST_ID,
          status: "Failed",
          errorCode: VMwareCollectionErrorCode.UntrustedCertificate,
          durationInMs: 12,
          probeId: OTHER_PROBE_ID.toString(),
        },
      }),
    );

    expect(connectionTests.recordTestReport).toHaveBeenCalledTimes(1);
    expect(
      (
        connectionTests.recordTestReport.mock.calls[0]![0] as {
          probeId: ObjectID;
        }
      ).probeId.toString(),
    ).toBe(PROBE_ID.toString());
    expect(sentBody()).toEqual({ accepted: true });
  });

  test("a test this probe does not run is not heard", async () => {
    connectionTests.recordTestReport.mockResolvedValue(false as never);

    await call(
      TEST_URI,
      makeRequest({
        body: { vmwareVCenterConnectionTestId: TEST_ID, status: "Succeeded" },
      }),
    );

    expect(sentBody()).toEqual({ accepted: false });
  });

  test("a report that is neither Succeeded nor Failed is refused", async () => {
    await call(
      TEST_URI,
      makeRequest({ body: { vmwareVCenterConnectionTestId: TEST_ID } }),
    );

    expect(refusal()).toBe("A test report is Succeeded or Failed.");
    expect(connectionTests.recordTestReport).not.toHaveBeenCalled();
  });
});

describe("the route helpers", () => {
  test("running collections are ids only, trimmed and bounded", () => {
    expect(readRunningVMwareVCenterIds("x")).toEqual([]);
    expect(
      readRunningVMwareVCenterIds([
        ` ${RUNNING_ID} `,
        "not-an-id",
        7,
        null,
        "'; DROP TABLE x; --",
      ]),
    ).toEqual([RUNNING_ID]);
    expect(
      readRunningVMwareVCenterIds(new Array(150).fill(RUNNING_ID)),
    ).toHaveLength(100);
  });

  test("a probe is handed only as many collections as it has free slots", () => {
    expect(getCollectionClaimLimit(0)).toBe(
      VMWARE_PROBE_COLLECTION_CONCURRENCY,
    );
    expect(getCollectionClaimLimit(3)).toBe(
      VMWARE_PROBE_COLLECTION_CONCURRENCY - 3,
    );
    expect(getCollectionClaimLimit(10)).toBe(0);
  });

  test("an inflated body is read as JSON; a body that is not is refused; a parsed one passes", () => {
    const next: NextSpy = jest.fn();
    const inflated: ExpressRequest = makeRequest({
      body: Buffer.from(JSON.stringify(collectionReport())),
    });

    parseInflatedJsonBody(
      inflated,
      mockResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect((inflated as unknown as { body: JSONObject }).body).toEqual(
      collectionReport(),
    );

    const broken: ExpressRequest = makeRequest({
      body: Buffer.from("{not json"),
    });
    const brokenNext: NextSpy = jest.fn();

    parseInflatedJsonBody(
      broken,
      mockResponse,
      brokenNext as unknown as NextFunction,
    );

    expect(brokenNext).not.toHaveBeenCalled();
    expect(refusal()).toBe("The collection report is not JSON.");

    jest.clearAllMocks();
    const parsed: ExpressRequest = makeRequest({ body: { status: "Failed" } });
    const parsedNext: NextSpy = jest.fn();

    parseInflatedJsonBody(
      parsed,
      mockResponse,
      parsedNext as unknown as NextFunction,
    );

    expect(parsedNext).toHaveBeenCalledTimes(1);
    expect((parsed as unknown as { body: JSONObject }).body).toEqual({
      status: "Failed",
    });
  });
});
