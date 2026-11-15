import ServiceLevelObjectiveAPI, {
  SLO_RELEASE_CHECK_BAD_ID_MESSAGE,
  SLO_RELEASE_CHECK_FAILED_STATUS_CODE,
  SLO_RELEASE_CHECK_PERMISSION_MESSAGE,
} from "../../../Server/API/ServiceLevelObjectiveAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SloReleaseCheckMeasurement, {
  SLO_RELEASE_CHECK_SELECT,
} from "../../../Server/Utils/Slo/SloReleaseCheckMeasurement";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusCode from "../../../Types/API/StatusCode";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import UserType from "../../../Types/UserType";
import { SLO_RELEASE_CHECK_ERRORS } from "../../../Utils/Slo/SloReleaseCheck";

/*
 * GET and POST /service-level-objective/:id/release-check: what a rollout
 * tool asks while a release goes out. The routes are captured from the
 * router, and the SLO read and the measurement are stubbed, so these tests
 * pin the endpoint's own contract: who may ask, how the options are read,
 * what is answered, and the 412 a tool that reads status codes asks for.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> = [];

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ method: "post", uri, handlers });
        },
        get: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ method: "get", uri, handlers });
        },
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

jest.mock("../../../Server/Utils/Logger");

const PROJECT: ObjectID = new ObjectID("aa000000-0000-4000-8000-000000000001");
const USER: ObjectID = new ObjectID("aa000000-0000-4000-8000-000000000002");
const SLO_ID: ObjectID = new ObjectID("aa000000-0000-4000-8000-000000000003");

const PATH: string = "/service-level-objective/:id/release-check";
const NOW: Date = new Date("2026-07-19T12:00:00.000Z");

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let findSpy: jest.SpyInstance;
let measureSpy: jest.SpyInstance;
const res: ExpressResponse = {} as ExpressResponse;

function withPermissions(permissions: Array<Permission>): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  } as never;
}

function routeOf(method: string): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((route: { method: string; uri: string }) => {
      return route.method === method && route.uri === PATH;
    });

  expect(found).toBeDefined();
  return found!;
}

async function ask(
  method: "get" | "post",
  data: { id?: string; query?: JSONObject; body?: unknown } = {},
): Promise<void> {
  const route: { uri: string; handlers: Array<Handler> } = routeOf(method);

  await route.handlers[route.handlers.length - 1]!(
    {
      params: { id: data.id ?? SLO_ID.toString() },
      query: data.query || {},
      body: data.body,
    } as unknown as ExpressRequest,
    res,
    next,
  );
}

function answered(): { body: JSONObject; statusCode: number } {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  expect(mock).toHaveBeenCalledTimes(1);

  const options: { statusCode?: StatusCode } | undefined = mock.mock
    .calls[0]![3] as { statusCode?: StatusCode } | undefined;

  return {
    body: mock.mock.calls[0]![2] as JSONObject,
    statusCode: options?.statusCode?.toNumber() ?? 200,
  };
}

function refusal(): Error {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Error;
}

function requestSlo(
  fields: Partial<ServiceLevelObjective> = {},
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(SLO_ID);
  slo.projectId = PROJECT;
  slo.name = "Checkout requests";
  slo.sliType = SliType.RequestSuccess;
  slo.targetPercentage = 99.9;
  slo.sloStatus = SloStatus.Healthy;
  slo.deploymentsAllowed = true;
  Object.assign(slo, fields);
  return slo;
}

beforeAll(() => {
  new ServiceLevelObjectiveAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT, userType: UserType.User };
  withPermissions([Permission.ReadServiceLevelObjective]);
  next = jest.fn();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  findSpy = jest
    .spyOn(ServiceLevelObjectiveService, "findOneById")
    .mockResolvedValue(requestSlo());

  measureSpy = jest
    .spyOn(SloReleaseCheckMeasurement, "measure")
    .mockResolvedValue({
      burnRate: 0.5,
      sliPercentage: 99.95,
      goodRequestCount: 1999,
      totalRequestCount: 2000,
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the routes", () => {
  test("GET and POST, beside the SLO's CRUD path, behind the user middleware", () => {
    for (const method of ["get", "post"]) {
      const route: { uri: string; handlers: Array<Handler> } = routeOf(method);

      expect(route.handlers).toHaveLength(2);
      expect(route.handlers[0]).toBe(UserMiddleware.getUserMiddleware);
    }
  });

  test("the SLO's own CRUD routes are still there", () => {
    expect(
      recordedRoutes.some((route: { uri: string }) => {
        return route.uri === "/service-level-objective/:id/get-item";
      }),
    ).toBe(true);
  });
});

describe("the answer", () => {
  test("a pass is 200 with the verdict and what it was read from", async () => {
    await ask("get");

    const { body, statusCode } = answered();

    expect(statusCode).toBe(200);
    expect(body["isSafeToContinue"]).toBe(true);
    expect(body["verdict"]).toBe("Pass");
    expect(body["burnRate"]).toBe(0.5);
    expect(body["totalRequestCount"]).toBe(2000);
    expect(body["sloId"]).toBe(SLO_ID.toString());
    expect(body["checkedAt"]).toBe(NOW.toISOString());
  });

  test("a fail is 200 too, unless the tool asks for a status code", async () => {
    measureSpy.mockResolvedValue({
      burnRate: 50,
      sliPercentage: 95,
      goodRequestCount: 950,
      totalRequestCount: 1000,
    });

    await ask("get");

    expect(answered()).toMatchObject({
      statusCode: 200,
      body: { isSafeToContinue: false, verdict: "Fail" },
    });
  });

  test("failWithStatusCode answers a fail with 412, and a pass with 200", async () => {
    measureSpy.mockResolvedValue({
      burnRate: 50,
      sliPercentage: 95,
      goodRequestCount: 950,
      totalRequestCount: 1000,
    });

    await ask("post", { query: { failWithStatusCode: "true" } });

    expect(answered().statusCode).toBe(SLO_RELEASE_CHECK_FAILED_STATUS_CODE);
    expect(SLO_RELEASE_CHECK_FAILED_STATUS_CODE).toBe(412);

    (Response.sendJsonObjectResponse as jest.Mock).mockClear();
    measureSpy.mockResolvedValue({
      burnRate: 0,
      sliPercentage: 100,
      goodRequestCount: 10,
      totalRequestCount: 10,
    });

    await ask("post", { query: { failWithStatusCode: "true" } });

    expect(answered().statusCode).toBe(200);
  });

  test("a frozen SLO fails, whatever it burned", async () => {
    findSpy.mockResolvedValue(
      requestSlo({
        deploymentsAllowed: false,
        currentErrorBudgetPolicyTierName: "Budget exhausted",
      }),
    );

    await ask("get");

    expect(answered().body).toMatchObject({
      isSafeToContinue: false,
      verdict: "Fail",
      deploymentsAllowed: false,
      errorBudgetPolicyTier: "Budget exhausted",
    });
  });
});

describe("how the options are read", () => {
  test("from the query string, and a POST's JSON body over it", async () => {
    await ask("post", {
      query: { windowInMinutes: "5", serviceVersion: "1.0.0" },
      body: { windowInMinutes: 20, maxBurnRate: 3 },
    });

    expect(measureSpy.mock.calls[0]![0].options).toEqual({
      windowInMinutes: 20,
      maxBurnRate: 3,
      minimumRequestCount: 1,
      serviceVersion: "1.0.0",
      includeDeploymentGate: true,
      failWithStatusCode: false,
    });
    expect(measureSpy.mock.calls[0]![0].now).toBe(NOW);
  });

  test("a Flagger webhook's own body is ignored", async () => {
    await ask("post", {
      body: {
        name: "checkout",
        namespace: "shop",
        phase: "Progressing",
        metadata: { windowInMinutes: "60" },
      },
    });

    expect(measureSpy.mock.calls[0]![0].options.windowInMinutes).toBe(10);
  });

  test("an option out of range is refused before anything is read", async () => {
    await ask("get", { query: { windowInMinutes: "0" } });

    const error: Error = refusal();

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(SLO_RELEASE_CHECK_ERRORS.windowInMinutes);
    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe("who may ask, and about what", () => {
  test("the SLO is read as the caller, with only the columns the check needs", async () => {
    await ask("get");

    const args: {
      id: ObjectID;
      select: unknown;
      props: DatabaseCommonInteractionProps;
    } = findSpy.mock.calls[0]![0];

    expect(args.id.toString()).toBe(SLO_ID.toString());
    expect(args.select).toBe(SLO_RELEASE_CHECK_SELECT);
    expect(args.props).toBe(props);
    expect(args.props.isRoot).toBeUndefined();
  });

  test("a role that cannot read SLOs is refused", async () => {
    withPermissions([]);

    await ask("get");

    expect(refusal().message).toBe(SLO_RELEASE_CHECK_PERMISSION_MESSAGE);
    expect(findSpy).not.toHaveBeenCalled();
  });

  test("an ID that is not one is refused", async () => {
    await ask("get", { id: "not-an-id" });

    const error: Error = refusal();

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(SLO_RELEASE_CHECK_BAD_ID_MESSAGE);
  });

  test("an SLO the caller cannot see, or that does not exist, is missing", async () => {
    findSpy.mockResolvedValue(null);

    await ask("get");

    expect(refusal()).toBeInstanceOf(NotFoundException);
    expect(measureSpy).not.toHaveBeenCalled();
  });

  test("an SLO that cannot be measured is refused with the measurement's reason", async () => {
    measureSpy.mockRejectedValue(new BadDataException("No services."));

    await ask("get");

    expect(refusal().message).toBe("No services.");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
