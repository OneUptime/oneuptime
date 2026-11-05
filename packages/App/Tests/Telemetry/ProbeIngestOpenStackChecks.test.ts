import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Probe from "Common/Models/DatabaseModels/Probe";
import Response from "Common/Server/Utils/Response";
import { OpenStackCheckReportOutcome } from "Common/Server/Utils/OpenStack/OpenStackCheckStore";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_PROBE_API_CHECK_CONCURRENCY,
  OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY,
} from "Common/Types/OpenStack/OpenStackCheck";
import {
  OPENSTACK_CHECK_RESOURCE_ATTRIBUTE,
  toOpenStackCheckResourceMetrics,
} from "Common/Utils/OpenStack/OpenStackCheckMetrics";
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

jest.mock("Common/Server/Services/OpenStackCloudService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/OpenStackCloudConnectionTestService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/OpenStackCloudCheckService", () => {
  return { __esModule: true, default: {} };
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
        addLogIngestJob: jest.fn(),
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

import {
  OpenStackCheckWorkStore,
  createOpenStackCheckRouter,
} from "../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackChecks";

/*
 * The probe's side of the checks. As with collections: every route is behind probe authentication,
 * keys everything on the AUTHENTICATED probe and never one in the body, and what a check found enters
 * the very ingest everything else does, stamped with the cloud's name by the server.
 */

const WORK_URI: string = "/probe/openstack/checks/work";
const REPORT_URI: string = "/probe/openstack/checks/report";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CHECK_ID: string = "44444444-4444-4444-8444-444444444444";
const RUNNING_ID: string = "55555555-5555-4555-8555-555555555555";

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

const mockResponse: ExpressResponse = {} as ExpressResponse;

function requestOf(data: {
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

function sentBody(): JSONObject {
  expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

interface Harness {
  store: { [K in keyof OpenStackCheckWorkStore]: jest.Mock };
  route: (uri: string) => RecordedRoute;
}

function createHarness(
  outcome?: Partial<OpenStackCheckReportOutcome> | undefined,
): Harness {
  const store: Harness["store"] = {
    claimApiChecks: jest.fn(async () => {
      return [{ openStackCloudCheckId: "api-job" }];
    }) as unknown as jest.Mock,
    claimLifecycleChecks: jest.fn(async () => {
      return [{ openStackCloudCheckId: "lifecycle-job" }];
    }) as unknown as jest.Mock,
    recordReport: jest.fn(async () => {
      return {
        accepted: true,
        projectId: PROJECT_ID,
        cloudName: "Lab",
        resourceMetrics: toOpenStackCheckResourceMetrics({
          points: [
            {
              metric: "openstack_check_token_success",
              value: 1,
              labels: {},
              description: "x",
              unit: "1",
            } as never,
          ],
          now: 1,
          scopeVersion: "1",
        }),
        ...outcome,
      };
    }) as unknown as jest.Mock,
  };

  const router: RecordingRouter = createOpenStackCheckRouter(
    store as unknown as OpenStackCheckWorkStore,
  ) as unknown as RecordingRouter;

  return {
    store: store,
    route: (uri: string): RecordedRoute => {
      return router.routes.get(uri) as RecordedRoute;
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ingestion.isDisabled.mockReturnValue(false);
});

describe("the routes", () => {
  test("each is behind probe authentication", () => {
    const harness: Harness = createHarness();

    for (const uri of [WORK_URI, REPORT_URI]) {
      expect(harness.route(uri).middlewares).toContain(
        ProbeAuthorization.isAuthorizedServiceMiddleware,
      );
    }
  });

  test("the server mounts them", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../FeatureSet/Telemetry/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import ProbeIngestOpenStackChecksAPI from "./API/ProbeIngest/OpenStackChecks";',
    );
    expect(index).toContain(
      "app.use(PROBE_INGEST_PREFIXES, ProbeIngestOpenStackChecksAPI);",
    );
  });
});

describe("asking for work", () => {
  test("claims for the authenticated probe, whatever a body says, with the room it has", async () => {
    const harness: Harness = createHarness();

    await harness.route(WORK_URI).handler(
      requestOf({
        body: {
          probeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          runningApiCheckIds: [RUNNING_ID, "not-an-id", 5],
          runningLifecycleCheckIds: [RUNNING_ID],
        },
      }),
      mockResponse,
      jest.fn() as unknown as NextFunction,
    );

    expect(harness.store.claimApiChecks).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      runningIds: [RUNNING_ID],
      limit: OPENSTACK_PROBE_API_CHECK_CONCURRENCY - 1,
    });
    expect(harness.store.claimLifecycleChecks).toHaveBeenCalledWith({
      probeId: PROBE_ID,
      runningIds: [RUNNING_ID],
      limit: OPENSTACK_PROBE_LIFECYCLE_CHECK_CONCURRENCY - 1,
    });
    expect(sentBody()).toEqual({
      apiChecks: [{ openStackCloudCheckId: "api-job" }],
      lifecycleChecks: [{ openStackCloudCheckId: "lifecycle-job" }],
    });
  });

  test("no probe, no work", async () => {
    const harness: Harness = createHarness();

    await harness
      .route(WORK_URI)
      .handler(
        requestOf({ probeId: null }),
        mockResponse,
        jest.fn() as unknown as NextFunction,
      );

    expect(responseUtil.sendErrorResponse.mock.calls[0]![2]).toBeInstanceOf(
      BadDataException,
    );
    expect(harness.store.claimApiChecks).not.toHaveBeenCalled();
  });

  test("with ingestion off nothing is run for nothing, and nothing is written to anyone's cloud", async () => {
    ingestion.isDisabled.mockReturnValue(true);

    const harness: Harness = createHarness();

    await harness
      .route(WORK_URI)
      .handler(
        requestOf({}),
        mockResponse,
        jest.fn() as unknown as NextFunction,
      );

    expect(sentBody()).toEqual({ apiChecks: [], lifecycleChecks: [] });
    expect(harness.store.claimLifecycleChecks).not.toHaveBeenCalled();
  });

  test("a failure goes where failures go", async () => {
    const harness: Harness = createHarness();
    const failure: Error = new Error("No database.");

    harness.store.claimApiChecks.mockImplementation(async () => {
      throw failure;
    });

    const next: jest.Mock = jest.fn() as unknown as jest.Mock;

    await harness
      .route(WORK_URI)
      .handler(requestOf({}), mockResponse, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe("a report", () => {
  const body: JSONObject = {
    openStackCloudCheckId: CHECK_ID,
    settingsVersion: 2,
    kind: "api",
  };

  test("is recorded for the authenticated probe, and what it found enters the ingest, named for the cloud", async () => {
    const harness: Harness = createHarness();

    await harness
      .route(REPORT_URI)
      .handler(
        requestOf({ body: body }),
        mockResponse,
        jest.fn() as unknown as NextFunction,
      );

    expect(harness.store.recordReport.mock.calls[0]![0]).toMatchObject({
      probeId: PROBE_ID,
      report: body,
    });

    expect(queue.addMetricIngestJob).toHaveBeenCalledTimes(1);

    const job: JSONObject = queue.addMetricIngestJob.mock
      .calls[0]![0] as JSONObject;
    const resource: JSONObject = (
      (job["body"] as JSONObject)["resourceMetrics"] as Array<JSONObject>
    )[0]!["resource"] as JSONObject;

    expect(job["projectId"]).toBe(PROJECT_ID);
    expect(resource["attributes"]).toEqual(
      expect.arrayContaining([
        {
          key: "openstack.cloud.name",
          value: { stringValue: "Lab" },
        },
        expect.objectContaining({ key: OPENSTACK_CHECK_RESOURCE_ATTRIBUTE }),
      ]),
    );
    expect(sentBody()).toEqual({ accepted: true, queuedResourceCount: 1 });
  });

  test("one not accepted says why, and nothing enters the ingest", async () => {
    const harness: Harness = createHarness({
      accepted: false,
      reason: "Not this probe's.",
      projectId: undefined,
    });

    await harness
      .route(REPORT_URI)
      .handler(
        requestOf({ body: body }),
        mockResponse,
        jest.fn() as unknown as NextFunction,
      );

    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({
      accepted: false,
      reason: "Not this probe's.",
    });
  });

  test("with ingestion off it is still recorded, and nothing enters the ingest", async () => {
    ingestion.isDisabled.mockReturnValue(true);

    const harness: Harness = createHarness();

    await harness
      .route(REPORT_URI)
      .handler(
        requestOf({ body: body }),
        mockResponse,
        jest.fn() as unknown as NextFunction,
      );

    expect(harness.store.recordReport).toHaveBeenCalledTimes(1);
    expect(queue.addMetricIngestJob).not.toHaveBeenCalled();
  });

  test("no probe, nothing heard", async () => {
    const harness: Harness = createHarness();

    await harness
      .route(REPORT_URI)
      .handler(
        requestOf({ probeId: null, body: body }),
        mockResponse,
        jest.fn() as unknown as NextFunction,
      );

    expect(harness.store.recordReport).not.toHaveBeenCalled();
  });
});
