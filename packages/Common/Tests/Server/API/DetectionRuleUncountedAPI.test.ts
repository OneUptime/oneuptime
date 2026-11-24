import DetectionRuleAPI, {
  readRuleIds,
} from "../../../Server/API/DetectionRuleAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DetectionRuleUncountedReader from "../../../Server/Utils/SecurityEvent/DetectionRuleUncounted";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  DETECTION_RULE_UNCOUNTED_PATH,
  DetectionRulesUncounted,
  MAX_DETECTION_RULES_UNCOUNTED_PER_ASK,
  readDetectionRulesUncounted,
} from "../../../Types/SecurityEvent/DetectionRuleUncounted";
import { countRefusals, withoutRefusals } from "./RouteRefusals";

/*
 * POST /detection-rule/uncounted (#10547): what the rules a page of
 * Detection Rules lists could not count in the last day. Who may ask (a
 * role that reads detection rules AND security events, as Run on Past
 * Events takes), what may be asked (a page of rule ids), which sources are
 * counted (only the caller's), and what is answered.
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

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111110547");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222220547");
const SERVICE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555550547",
);
const RULE_ID: string = "10547000-0000-4000-8000-0000000000e1";

const ANSWER: DetectionRulesUncounted = {
  periodInHours: 24,
  rules: [
    {
      detectionRuleId: RULE_ID,
      field: "principalIp",
      matchedCount: 1210,
      uncountedCount: 1204,
      hiddenInLogsCount: 1180,
      hiddenInTracesCount: 0,
    },
  ],
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
      return item.uri === DETECTION_RULE_UNCOUNTED_PATH;
    });
  expect(found).toBeDefined();
  return found!;
}

async function ask(body: unknown = { detectionRuleIds: [RULE_ID] }): Promise<void> {
  const handlers: Array<Handler> = route().handlers;
  await handlers[handlers.length - 1]!(
    { params: {}, body } as unknown as ExpressRequest,
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
  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({ serviceIds: [SERVICE_ID] });
  read = jest
    .spyOn(DetectionRuleUncountedReader, "read")
    .mockResolvedValue(ANSWER);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /detection-rule/uncounted", () => {
  test("is the path the Dashboard asks, behind the user, authentication and the product's switch", () => {
    expect(route().uri).toBe("/detection-rule/uncounted");
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
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])(
    "%s may ask: it reads rules and events",
    async (permission: Permission) => {
      setPermissions(permission);

      await ask();

      expect(next).not.toHaveBeenCalled();
      expect(read).toHaveBeenCalledTimes(1);
    },
  );

  test("a role that reads detection rules but not security events may not", async () => {
    setPermissions(Permission.ReadProjectDetectionRule);

    await ask();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(String((next.mock.calls[0]![0] as Error).message)).toBe(
      "Seeing what your rules could not count takes a role that can read security events.",
    );
    expect(read).not.toHaveBeenCalled();
  });

  test("a role with neither may not", async () => {
    setPermissions(Permission.ProjectMember);

    await ask();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(read).not.toHaveBeenCalled();
  });

  test("reads the caller's project, the rules asked about, only the sources they may read, as they read", async () => {
    await ask({ detectionRuleIds: [RULE_ID, RULE_ID.toUpperCase()] });

    expect(TelemetryReadAccess.getServiceFilter).toHaveBeenCalledWith({
      modelType: SecurityEvent,
      props,
    });
    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT,
      detectionRuleIds: [new ObjectID(RULE_ID)],
      props,
      serviceFilter: { serviceIds: [SERVICE_ID] },
    });
  });

  test("answers as the Dashboard reads it back", async () => {
    await ask();

    expect(readDetectionRulesUncounted(answered())).toEqual(ANSWER);
  });

  test("an ask that names its rules wrongly is refused, saying what to send", async () => {
    for (const body of [
      {},
      { detectionRuleIds: "all" },
      { detectionRuleIds: ["not-an-id"] },
      { detectionRuleIds: [7] },
    ]) {
      next.mockClear();

      await ask(body);

      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    }

    expect(read).not.toHaveBeenCalled();
  });

  test("a read that fails is passed on, with nothing answered", async () => {
    read.mockRejectedValue(new Error("ClickHouse is not reachable."));

    await ask();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("the rule ids an ask names", () => {
  test("each a rule's id, each once", () => {
    expect(
      readRuleIds([RULE_ID, ` ${RULE_ID} `, RULE_ID.toUpperCase()]),
    ).toEqual([new ObjectID(RULE_ID)]);
    expect(readRuleIds([])).toEqual([]);
  });

  test("at most a page of them", () => {
    expect(() => {
      return readRuleIds(
        Array.from(
          { length: MAX_DETECTION_RULES_UNCOUNTED_PER_ASK + 1 },
          (): string => {
            return ObjectID.generate().toString();
          },
        ),
      );
    }).toThrow(
      `Ask about at most ${MAX_DETECTION_RULES_UNCOUNTED_PER_ASK} detection rules at a time.`,
    );
  });

  test("anything else says what to send", () => {
    expect(() => {
      return readRuleIds(undefined);
    }).toThrow("Send the ids of the detection rules to read, as detectionRuleIds.");
    expect(() => {
      return readRuleIds(["", "x"]);
    }).toThrow("Each detection rule id must be the id of a detection rule.");
  });
});
