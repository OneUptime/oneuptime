import "../TestingUtils/Init";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import NetworkFlow from "../../../Models/AnalyticsModels/NetworkFlow";
import { mockRouter } from "./Helpers";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * POST /network-flow, the telemetry create a project member may make: every
 * value is written into the INSERT as its column's type, and a value that is
 * not one is refused with a 400 before anything is written. The create runs
 * as it does for a member, with its permission checks; only ClickHouse is
 * answered here.
 */

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();

// The request as getUserMiddleware leaves it for a logged-in project member.
function buildMemberRequest(data: JSONObject): ExpressRequest {
  const tenantPermissions: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission,
      ],
    },
  };

  return {
    params: {},
    query: {},
    headers: { tenantid: PROJECT_ID.toString() },
    body: { data: data },
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userAuthorization: {
      userId: ObjectID.generate(),
      email: "member@example.com",
      name: "Member",
      isMasterAdmin: false,
    },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: tenantPermissions,
    userTeamIds: [],
  } as unknown as ExpressRequest;
}

// What a flow's create sends: every column it requires, each of its type.
function aFlow(): JSONObject {
  return {
    networkDeviceId: ObjectID.generate().toString(),
    exporterIp: "10.0.0.1",
    srcIp: "10.0.0.2",
    dstIp: "10.0.0.3",
    srcPort: 0,
    dstPort: 443,
    protocol: 6,
    inputInterfaceIndex: 1,
    outputInterfaceIndex: 2,
    octets: 1500,
    packets: 3,
    flowStartAt: "2026-07-01T00:00:00.000Z",
    flowEndAt: "2026-07-01T00:00:01.000Z",
    ingestedAt: "2026-07-01T00:00:02.000Z",
    flowFormat: "netflow-v9",
    samplingRate: 1,
    flowCount: 1,
    srcName: "client's laptop",
    dstName: "api",
  };
}

async function createFlow(data: JSONObject): Promise<unknown> {
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "POST",
    "/network-flow",
  );

  let thrownToNext: unknown = undefined;

  await route.handlerFunction(buildMemberRequest(data), res, ((
    err?: unknown,
  ) => {
    thrownToNext = err;
  }) as NextFunction);

  return thrownToNext;
}

describe("BaseAnalyticsAPI create writes each value as its column's type", () => {
  let inserts: Array<string>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouter.routes = [];

    const service: AnalyticsDatabaseService<NetworkFlow> =
      new AnalyticsDatabaseService<NetworkFlow>({ modelType: NetworkFlow });

    new BaseAnalyticsAPI<NetworkFlow, AnalyticsDatabaseService<NetworkFlow>>(
      NetworkFlow,
      service,
    );

    inserts = [];

    jest
      .spyOn(service, "execute")
      .mockImplementation((statement: Statement | string) => {
        inserts.push(statement as string);

        return Promise.resolve({} as never);
      });
  });

  test("a member creates a flow, and every value is written as its column's type", async () => {
    const thrown: unknown = await createFlow({
      ...aFlow(),
      dstPort: "443",
      octets: "18446744073709551615",
    });

    expect(thrown).toBeUndefined();
    expect(inserts).toHaveLength(1);
    expect(Response.sendEntityResponse).toHaveBeenCalledTimes(1);

    const insert: string = inserts[0]!;

    expect(insert).toContain(`'${PROJECT_ID.toString()}'`);
    expect(insert).toContain("'10.0.0.2', '10.0.0.3', 0, 443, 6, 1, 2");
    expect(insert).toContain(
      "CAST('18446744073709551615' AS UInt64), CAST('3' AS UInt64)",
    );
    expect(insert).toContain(
      "parseDateTimeBestEffortOrNull('2026-07-01 00:00:00.000000000')",
    );
    expect(insert).toContain("'client\\'s laptop'");
  });

  test.each([
    ["srcPort", [443], "a number"],
    ["srcPort", { port: 443 }, "a number"],
    ["dstPort", true, "a number"],
    ["octets", "many", "a whole number, or a string of its digits"],
    ["octets", [1500], "a whole number, or a string of its digits"],
    ["packets", { count: 3 }, "a whole number, or a string of its digits"],
    ["flowStartAt", ["2026-07-01T00:00:00.000Z"], "a date and time"],
    [
      "flowStartAt",
      { _type: "DateTime", value: "2026-07-01T00:00:00.000Z" },
      "a date and time",
    ],
    ["flowEndAt", "not a time", "a date and time"],
    ["srcIp", ["10.0.0.2"], "text"],
    ["srcName", { name: "laptop" }, "text"],
  ])(
    "refuses %s of %j with a 400, and writes nothing",
    async (key: string, value: unknown, expected: string) => {
      const thrown: unknown = await createFlow({
        ...aFlow(),
        [key]: value as never,
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as BadDataException).code).toBe(400);
      expect((thrown as BadDataException).message).toBe(
        `Invalid value for ${key}. It must be ${expected}.`,
      );
      expect(inserts).toHaveLength(0);
      expect(Response.sendEntityResponse).not.toHaveBeenCalled();
    },
  );
});
