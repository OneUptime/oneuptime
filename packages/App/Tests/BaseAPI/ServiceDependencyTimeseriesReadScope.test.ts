import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import ServiceService from "Common/Server/Services/ServiceService";
import SpanService from "Common/Server/Services/SpanService";
import Response from "Common/Server/Utils/Response";
import TelemetryReadAccess from "Common/Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import Span from "Common/Models/AnalyticsModels/Span";
import Service from "Common/Models/DatabaseModels/Service";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
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
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/SpanService", () => {
  return {
    __esModule: true,
    default: { executeQuery: jest.fn() },
  };
});

/*
 * POST /telemetry/service-dependency-timeseries charts the calls between two
 * services from both services' spans. Reading the two Service records is
 * not enough: the series is read only when the caller may read the traces
 * of both (TelemetryReadAccess, the scope every telemetry read follows),
 * and an edge with a side out of their scope is answered as one with no
 * calls, without reading any span.
 */

// Importing the module registers its route on the mocked router.
import ServiceDependencyTimeseriesAPI from "../../FeatureSet/BaseAPI/API/ServiceDependencyTimeseries";

new ServiceDependencyTimeseriesAPI().getRouter();

const ROUTE: string = "/telemetry/service-dependency-timeseries";
const PROJECT_ID: ObjectID = ObjectID.generate();
const CHECKOUT_ID: ObjectID = ObjectID.generate();
const PAYMENTS_ID: ObjectID = ObjectID.generate();

const serviceService: { findOneBy: jest.Mock } = ServiceService as unknown as {
  findOneBy: jest.Mock;
};
const spanService: { executeQuery: jest.Mock } = SpanService as unknown as {
  executeQuery: jest.Mock;
};
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const BODY: JSONObject = {
  callerServiceName: "checkout",
  calleeServiceName: "payments",
  startTime: "2026-09-18T10:00:00.000Z",
  endTime: "2026-09-18T11:00:00.000Z",
};

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ReadTelemetryServiceTraces,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission,
      ],
      isBlockPermission: false,
    } as UserTenantAccessPermission,
  },
};

function serviceRow(id: ObjectID): Service {
  const service: Service = new Service();
  service._id = id.toString();
  return service;
}

function resultSet(data: Array<JSONObject>): {
  json: () => Promise<{ data: Array<JSONObject> }>;
} {
  return {
    json: async () => {
      return { data };
    },
  };
}

let scopeSpy: {
  mockResolvedValue: (scope: TelemetryReadScope) => unknown;
  mockRejectedValue: (error: Error) => unknown;
  mock: { calls: Array<Array<unknown>> };
};

async function callRoute(): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(
      { params: {}, body: BODY } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

  return next;
}

function sentBody(): JSONObject {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

describe("POST /telemetry/service-dependency-timeseries follows the caller's trace scope", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(PROPS);

    // The caller's name is looked up first, then the callee's.
    serviceService.findOneBy
      .mockResolvedValueOnce(serviceRow(CHECKOUT_ID) as never)
      .mockResolvedValueOnce(serviceRow(PAYMENTS_ID) as never);

    spanService.executeQuery.mockImplementation((async (sql: string) => {
      return sql.includes("callerCount")
        ? resultSet([{ callerCount: "10", calleeCount: "10" }])
        : resultSet([
            {
              bucketStart: "2026-09-18 10:00:00",
              callCount: "10",
              errorCount: "1",
              avgDurationNano: "2000000",
            },
          ]);
    }) as never);

    scopeSpy = jest.spyOn(
      TelemetryReadAccess,
      "getScope",
    ) as unknown as typeof scopeSpy;
  });

  test("asks the scope of the caller's span reads", async () => {
    scopeSpy.mockResolvedValue(TelemetryReadScopeUtil.getUnrestrictedScope());

    await callRoute();

    expect(scopeSpy.mock.calls[0]![0]).toBe(Span);
    expect(scopeSpy.mock.calls[0]![1]).toBe(PROPS);
  });

  test("a caller who reads every service's traces gets the series", async () => {
    scopeSpy.mockResolvedValue(TelemetryReadScopeUtil.getUnrestrictedScope());

    await callRoute();

    expect(spanService.executeQuery).toHaveBeenCalledTimes(2);
    expect(sentBody()["buckets"]).toHaveLength(1);
  });

  test("a caller who reads the traces of both services gets the series", async () => {
    scopeSpy.mockResolvedValue({
      readableIds: [CHECKOUT_ID.toString(), PAYMENTS_ID.toString()],
      blockedIds: [],
    });

    await callRoute();

    expect(spanService.executeQuery).toHaveBeenCalledTimes(2);
    expect(sentBody()["buckets"]).toHaveLength(1);
  });

  test("a caller who may not read the calling service's traces gets no calls, and no span is read", async () => {
    scopeSpy.mockResolvedValue({
      readableIds: [PAYMENTS_ID.toString()],
      blockedIds: [],
    });

    await callRoute();

    expect(spanService.executeQuery).not.toHaveBeenCalled();
    expect(sentBody()).toEqual(
      expect.objectContaining({
        callerServiceId: CHECKOUT_ID.toString(),
        calleeServiceId: PAYMENTS_ID.toString(),
        truncated: false,
        buckets: [],
      }),
    );
  });

  test("a block with labels on the called service's traces leaves no calls to chart", async () => {
    scopeSpy.mockResolvedValue({
      readableIds: null,
      blockedIds: [PAYMENTS_ID.toString()],
    });

    await callRoute();

    expect(spanService.executeQuery).not.toHaveBeenCalled();
    expect(sentBody()["buckets"]).toEqual([]);
  });

  test("a block with no labels on reading traces refuses the request", async () => {
    scopeSpy.mockRejectedValue(new NotAuthorizedException("blocked"));

    const next: NextFunction = await callRoute();

    expect((next as unknown as jest.Mock).mock.calls[0]![0]).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(spanService.executeQuery).not.toHaveBeenCalled();
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
