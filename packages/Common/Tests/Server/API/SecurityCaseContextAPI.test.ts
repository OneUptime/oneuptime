import SecurityCaseContextAPI, {
  readCaseId,
} from "../../../Server/API/SecurityCaseContextAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityCaseImpact from "../../../Server/Utils/SecurityCase/Context/SecurityCaseImpact";
import SecurityCaseStory from "../../../Server/Utils/SecurityCase/Context/SecurityCaseStory";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SECURITY_CASE_IMPACT_API_PATH,
  SECURITY_CASE_STORY_API_PATH,
  SecurityCaseImpactJson,
  SecurityCaseInternetExposure,
  SecurityCaseStoryJson,
} from "../../../Types/SecurityCase/SecurityCaseContext";

/*
 * The routes behind a case's Story and Impact: who may call them (a reader
 * without Security access sees no security data), that each reads inside the
 * caller's project with the caller's own permissions, and what each refuses.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;
const recordedRoutes: Array<{ uri: string; handlers: Array<Handler> }> = [];
jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return {
        post: (uri: string, ...handlers: Array<Handler>): void => {
          recordedRoutes.push({ uri, handlers });
        },
        get: jest.fn(),
        put: jest.fn(),
        delete: jest.fn(),
      };
    },
  };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { sendJsonObjectResponse: jest.fn() };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const STORY: SecurityCaseStoryJson = {
  windowStart: "2026-10-27T05:30:00.000Z",
  windowEnd: "2026-10-27T07:30:00.000Z",
  items: [],
  truncatedSources: [],
  unreadableSources: [],
  failedSources: [],
};

const IMPACT: SecurityCaseImpactJson = {
  windowStart: "2026-10-27T05:30:00.000Z",
  windowEnd: "2026-10-27T07:30:00.000Z",
  firstDetectedAt: null,
  records: [],
  hasMoreRecords: false,
  statusPages: [],
  flowPeers: [],
  internet: { exposure: SecurityCaseInternetExposure.Unknown, evidence: [] },
  unreadableSources: [],
  failedSources: [],
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
const res: ExpressResponse = {} as ExpressResponse;

function setPermissions(...permissions: Array<Permission>): void {
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

function route(uri: string): Handler {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === uri;
    });
  expect(found).toBeDefined();
  return found!.handlers[found!.handlers.length - 1]!;
}

function request(body: JSONObject = {}): ExpressRequest {
  return { params: {}, body } as unknown as ExpressRequest;
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject;
}

beforeAll(() => {
  new SecurityCaseContextAPI().getRouter();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityViewer);
  next = jest.fn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("route registration", () => {
  test.each([SECURITY_CASE_STORY_API_PATH, SECURITY_CASE_IMPACT_API_PATH])(
    "%s resolves the user and requires authentication first",
    (uri: string) => {
      const found: { uri: string; handlers: Array<Handler> } | undefined =
        recordedRoutes.find((item: { uri: string }) => {
          return item.uri === uri;
        });

      expect(found?.handlers.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(found?.handlers).toHaveLength(3);
    },
  );

  test("the routes are where the Dashboard asks for them", () => {
    expect(SECURITY_CASE_STORY_API_PATH).toBe("/security-case-context/story");
    expect(SECURITY_CASE_IMPACT_API_PATH).toBe("/security-case-context/impact");
  });
});

describe.each([
  {
    uri: SECURITY_CASE_STORY_API_PATH,
    name: "story",
    spy: (): jest.SpyInstance => {
      return jest
        .spyOn(SecurityCaseStory, "build")
        .mockResolvedValue(STORY as never);
    },
    answer: STORY as unknown as JSONObject,
  },
  {
    uri: SECURITY_CASE_IMPACT_API_PATH,
    name: "impact",
    spy: (): jest.SpyInstance => {
      return jest
        .spyOn(SecurityCaseImpact, "build")
        .mockResolvedValue(IMPACT as never);
    },
    answer: IMPACT as unknown as JSONObject,
  },
])(
  "POST $uri",
  (scenario: {
    uri: string;
    name: string;
    spy: () => jest.SpyInstance;
    answer: JSONObject;
  }) => {
    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadSecurityEvent,
    ])(
      `answers %s with the case's ${scenario.name}, read as them`,
      async (permission: Permission) => {
        setPermissions(permission);
        const build: jest.SpyInstance = scenario.spy();

        await route(scenario.uri)(
          request({ caseId: CASE_ID.toString() }),
          res,
          next,
        );

        expect(next).not.toHaveBeenCalled();
        expect(build).toHaveBeenCalledWith({
          projectId: PROJECT,
          securityCaseId: CASE_ID,
          props,
        });
        expect(answered()).toEqual(scenario.answer);
      },
    );

    test.each([
      Permission.ProjectMember,
      Permission.TelemetryAdmin,
      Permission.ReadHost,
      Permission.ReadProjectIncident,
    ])(
      "refuses %s: no Security access, so no security data",
      async (permission: Permission) => {
        setPermissions(permission);
        const build: jest.SpyInstance = scenario.spy();

        await route(scenario.uri)(
          request({ caseId: CASE_ID.toString() }),
          res,
          next,
        );

        expect(next).toHaveBeenCalledWith(expect.any(NotAuthorizedException));
        expect(build).not.toHaveBeenCalled();
      },
    );

    test("a case the caller cannot read, or of another project, is not found", async () => {
      const build: jest.SpyInstance = scenario.spy();
      build.mockResolvedValue(null);

      await route(scenario.uri)(
        request({ caseId: CASE_ID.toString() }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundException));
    });

    test.each([
      [{}],
      [{ caseId: "not-a-case" }],
      [{ caseId: 42 }],
      [{ caseId: "" }],
    ])(
      "a case ID that is not one is refused before any read: %j",
      async (body: JSONObject) => {
        const build: jest.SpyInstance = scenario.spy();

        await route(scenario.uri)(request(body), res, next);

        expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
        expect(build).not.toHaveBeenCalled();
      },
    );

    test("a failure to read is passed on, not answered as an empty case", async () => {
      const build: jest.SpyInstance = scenario.spy();
      const failure: Error = new Error("ClickHouse is down");
      build.mockRejectedValue(failure);

      await route(scenario.uri)(
        request({ caseId: CASE_ID.toString() }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(failure);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  },
);

describe("reading a case ID", () => {
  test("takes a case's UUID and nothing else", () => {
    expect(readCaseId({ caseId: CASE_ID.toString() }).toString()).toBe(
      CASE_ID.toString(),
    );
    expect(() => {
      return readCaseId({ caseId: ["x"] } as unknown as JSONObject);
    }).toThrow(BadDataException);
  });
});
