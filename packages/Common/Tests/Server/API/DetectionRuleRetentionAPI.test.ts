import DetectionRuleAPI from "../../../Server/API/DetectionRuleAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityEventRetention from "../../../Server/Utils/SecurityEvent/SecurityEventRetention";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SECONDS_IN_A_DAY,
  SecurityEventRetentionStatus,
  parseSecurityEventRetentionStatus,
} from "../../../Types/SecurityEvent/SecurityEventRetention";
import { DetectionRuleType } from "../../../Types/SecurityEvent/SigmaCorrelation";
import { countRefusals, withoutRefusals } from "./RouteRefusals";

/*
 * POST /detection-rule/retention (#10432): how long the project keeps its
 * security events, and the enabled rules that read further back - what the
 * rule form, the Rule Library, Run on Past Events, a hunt's time range and
 * Settings -> Telemetry say. Who may ask (any member: the retention is the
 * project's, as its Settings show it), whose project is read (the caller's
 * own), and that the rules are read as the caller.
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

const RETENTION: string = "/detection-rule/retention";

const ANSWER: SecurityEventRetentionStatus = {
  retentionInDays: 15,
  rulesPastRetention: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "AWS activity in a region the account never used",
      type: DetectionRuleType.NewValue,
      lookbackInSeconds: 30 * SECONDS_IN_A_DAY,
    },
  ],
  hasMoreRulesPastRetention: false,
};

let props: DatabaseCommonInteractionProps;
let next: jest.Mock;
let read: jest.SpyInstance;
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

function route(): { uri: string; handlers: Array<Handler> } {
  const found: { uri: string; handlers: Array<Handler> } | undefined =
    recordedRoutes.find((item: { uri: string }) => {
      return item.uri === RETENTION;
    });
  expect(found).toBeDefined();
  return found!;
}

async function ask(): Promise<void> {
  const handlers: Array<Handler> = route().handlers;
  await handlers[handlers.length - 1]!(
    { params: {}, body: {} } as unknown as ExpressRequest,
    res,
    next,
  );
}

function answered(): JSONObject {
  const mock: jest.Mock = Response.sendJsonObjectResponse as jest.Mock;
  return mock.mock.calls[mock.mock.calls.length - 1]![2] as JSONObject;
}

beforeAll(() => {
  new DetectionRuleAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT };
  setPermissions(Permission.SecurityMember);
  next = jest.fn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });
  read = jest
    .spyOn(SecurityEventRetention, "getStatus")
    .mockResolvedValue(ANSWER);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /detection-rule/retention", () => {
  test("resolves the user, requires authentication, and refuses while Security Events is off", () => {
    expect(route().handlers.slice(0, 2)).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
    expect(withoutRefusals(route().handlers)).toHaveLength(3);
    expect(countRefusals(route().handlers)).toBe(1);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])(
    "%s may ask: the retention is the project's, as its Settings show it",
    async (permission: Permission) => {
      setPermissions(permission);

      await ask();

      expect(next).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  test("someone who is not a member of the project may not", async () => {
    props.userTenantAccessPermission = {} as never;

    await ask();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(read).not.toHaveBeenCalled();
  });

  test("reads the caller's own project, and its rules as the caller", async () => {
    await ask();

    expect(read).toHaveBeenCalledWith({ projectId: PROJECT, props });
  });

  test("answers as the Dashboard reads it back", async () => {
    await ask();

    expect(parseSecurityEventRetentionStatus(answered())).toEqual(ANSWER);
  });

  test("a read that fails is passed on, with nothing answered", async () => {
    read.mockRejectedValue(new Error("Postgres is not reachable."));

    await ask();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
