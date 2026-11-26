import DetectionRuleAPI from "../../../Server/API/DetectionRuleAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import SecurityEventLateArrivalService from "../../../Server/Services/SecurityEventLateArrivalService";
import TelemetryReadAccess from "../../../Server/Utils/Telemetry/TelemetryReadAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityEventLateArrivals,
  parseLateArrivals,
} from "../../../Types/SecurityEvent/SecurityEventLateArrival";
import { countRefusals, withoutRefusals } from "./RouteRefusals";

/*
 * POST /detection-rule/late-arrivals (#10491): the security events that
 * arrived more than a day after they happened in the last week, which no
 * rule's run checked - for the notice on Detection Rules. Who may ask (a
 * role that reads detection rules AND security events, as Run on Past
 * Events takes), which sources are counted (only the caller's), and what
 * is answered.
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
const SERVICE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const LATE_ARRIVALS: string = "/detection-rule/late-arrivals";

const ANSWER: SecurityEventLateArrivals = {
  arrivedSince: new Date("2026-11-14T00:00:00.000Z"),
  eventCount: 312,
  sources: [
    {
      vendorName: "Okta",
      productName: "Okta Workforce Identity",
      eventCount: 300,
      happenedFrom: new Date("2026-11-15T03:00:00.000Z"),
      happenedTo: new Date("2026-11-17T21:30:00.000Z"),
      arrivedFrom: new Date("2026-11-19T08:00:00.000Z"),
      arrivedTo: new Date("2026-11-19T08:40:00.000Z"),
    },
    {
      vendorName: "CrowdStrike",
      productName: "Falcon",
      eventCount: 12,
      happenedFrom: new Date("2026-11-12T10:00:00.000Z"),
      happenedTo: new Date("2026-11-12T11:00:00.000Z"),
      arrivedFrom: new Date("2026-11-14T09:00:00.000Z"),
      arrivedTo: new Date("2026-11-14T09:00:00.000Z"),
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
      return item.uri === LATE_ARRIVALS;
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
  jest
    .spyOn(TelemetryReadAccess, "getServiceFilter")
    .mockResolvedValue({ serviceIds: [SERVICE_ID] });
  read = jest
    .spyOn(SecurityEventLateArrivalService, "getLateArrivals")
    .mockResolvedValue(ANSWER);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("POST /detection-rule/late-arrivals", () => {
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
    Permission.SecurityAdmin,
    Permission.SecurityMember,
    Permission.SecurityViewer,
  ])(
    "%s may see them: it reads rules and events",
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
      "Seeing the events your rules did not check takes a role that can read security events.",
    );
    expect(read).not.toHaveBeenCalled();
  });

  test("a role with neither may not", async () => {
    setPermissions(Permission.ProjectMember);

    await ask();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(read).not.toHaveBeenCalled();
  });

  test("counts the caller's project, and only the sources they may read of security events", async () => {
    await ask();

    expect(TelemetryReadAccess.getServiceFilter).toHaveBeenCalledWith({
      modelType: SecurityEvent,
      props,
    });
    expect(read).toHaveBeenCalledWith({
      projectId: PROJECT,
      serviceFilter: { serviceIds: [SERVICE_ID] },
    });
  });

  test("answers with the count, and each source's, as the Dashboard reads it back", async () => {
    await ask();

    expect(parseLateArrivals(answered())).toEqual(ANSWER);
  });

  test("a read that fails is passed on, with nothing answered", async () => {
    read.mockRejectedValue(new Error("ClickHouse is not reachable."));

    await ask();

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
