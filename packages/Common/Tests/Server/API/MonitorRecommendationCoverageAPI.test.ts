import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorRecommendationCoverageQuery from "../../../Server/Utils/Monitor/MonitorRecommendationCoverageQuery";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  MONITOR_RECOMMENDATION_COVERAGE_PATH,
  MonitorRecommendationCoverageQuestion,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationCoverageQuestions";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /monitor/recommendation-coverage (#11074)
 *
 * Which of the project's monitors covers each recommended monitor a page
 * asks about. The pages read the first 10,000 monitors of each type and
 * compared them in the browser; they send their recommendations'
 * fingerprints here now, and the server answers a monitor id for each
 * covered one (MonitorRecommendationCoverageQuery, which has its own
 * suite, and a Postgres one past the cap). Held here: who may ask, what is
 * read off the request, and the answer's shape.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const ROUTE: string = `/monitor${MONITOR_RECOMMENDATION_COVERAGE_PATH}`;

const FINGERPRINT: string = MonitorRecommendationUtil.serializeFingerprint({
  resourceIdentifier: "web-1",
  configKind: "hostMonitor",
  metricNames: ["system.cpu.utilization"],
  formulas: [],
  metricAliases: [],
  queryAttributes: [],
  criteriaFilters: [],
  configValues: [],
});

function buildProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const grants: Array<UserPermission> = data.permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: grants,
  };

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

async function post(body: unknown): Promise<{ thrown: unknown }> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body,
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return { thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined };
}

describe("POST /monitor/recommendation-coverage", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let propsSpy: jest.SpyInstance;
  let querySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    querySpy = jest
      .spyOn(MonitorRecommendationCoverageQuery, "findCoveringMonitors")
      .mockResolvedValue(new Map<string, ObjectID>());

    propsSpy.mockResolvedValue(
      buildProps({
        projectId,
        userId,
        permissions: [Permission.ReadProjectMonitor],
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is mounted behind getUserMiddleware, and is no CRUD route's", () => {
    expect(mockRouter.match("POST", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("answers the monitor that covers each covered question, by its key, uncached - asked with the member's own props", async () => {
    const monitorId: ObjectID = ObjectID.generate();
    querySpy.mockResolvedValue(
      new Map<string, ObjectID>([["Host:high-cpu", monitorId]]),
    );
    const questions: Array<MonitorRecommendationCoverageQuestion> = [
      {
        key: "Host:high-cpu",
        monitorType: MonitorType.Host,
        fingerprints: [FINGERPRINT],
      },
      {
        key: "Host:disk-full",
        monitorType: MonitorType.Host,
        fingerprints: [FINGERPRINT],
      },
    ];

    const result: { thrown: unknown } = await post({ questions });

    expect(result.thrown).toBeUndefined();
    expect(querySpy).toHaveBeenCalledWith({
      projectId,
      props: expect.objectContaining({ userId, tenantId: projectId }),
      questions,
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2] as JSONObject,
    ).toEqual({ covered: { "Host:high-cpu": monitorId.toString() } });
  });

  test("a member who may not read monitors is refused before anything is read", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId,
        userId,
        permissions: [Permission.ReadProjectIncident],
      }),
    );

    const result: { thrown: unknown } = await post({
      questions: [
        {
          key: "Host:high-cpu",
          monitorType: MonitorType.Host,
          fingerprints: [FINGERPRINT],
        },
      ],
    });

    expect(result.thrown).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrown as Error).message).toBe(
      "You do not have permission to read this project's monitors.",
    );
    expect(querySpy).not.toHaveBeenCalled();
  });

  test("a question that is not one is refused, saying what is wrong, before anything is read", async () => {
    const result: { thrown: unknown } = await post({
      questions: [{ key: "k", monitorType: "Teleport", fingerprints: [] }],
    });

    expect(result.thrown).toBeInstanceOf(BadDataException);
    expect(querySpy).not.toHaveBeenCalled();
  });

  test("no tenant: refused as not a member, nothing read", async () => {
    propsSpy.mockResolvedValue({ userId, userType: UserType.User });

    const result: { thrown: unknown } = await post({ questions: [] });

    expect(result.thrown).toBeDefined();
    expect(querySpy).not.toHaveBeenCalled();
  });
});
