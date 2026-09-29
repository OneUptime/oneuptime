import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ServiceService from "Common/Server/Services/ServiceService";
import SpanService from "Common/Server/Services/SpanService";
import Response from "Common/Server/Utils/Response";
import Span from "Common/Models/AnalyticsModels/Span";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
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

/*
 * The two data sources the endpoint reads: Postgres for the name -> id
 * resolution, ClickHouse for the spans. Neither may be touched for a caller
 * who has not proved who they are.
 */
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
 * Contract under test - POST /telemetry/service-dependency-timeseries with an
 * expired session.
 *
 * The Service Map's edge drill-down is usually opened from a page that has
 * been sitting open for a while. The dashboard's access-token cookie expires
 * together with the JWT inside it, so by then the browser has stopped sending
 * it and getUserMiddleware passes the request on as Public, with no userId but
 * with the page's tenantid header. The handler used to reach its span-read
 * permission check with that and answer 422 "You do not have permission to
 * read traces for this project", which the browser client shows as an error:
 * it refreshes the session and replays the request on a 401 and on nothing
 * else. It now asks for credentials first, so the same request is a 401.
 *
 * A project API key is a credential. It carries no userId either, but it is
 * not anonymous and keeps going to the permission check.
 */

// Importing the module registers its route on the mocked router.
import ServiceDependencyTimeseriesAPI from "../../FeatureSet/BaseAPI/API/ServiceDependencyTimeseries";

new ServiceDependencyTimeseriesAPI().getRouter();

const ROUTE: string = "/telemetry/service-dependency-timeseries";
const PROJECT_ID: ObjectID = ObjectID.generate();

const serviceService: { findOneBy: jest.Mock } = ServiceService as unknown as {
  findOneBy: jest.Mock;
};
const spanService: { executeQuery: jest.Mock } = SpanService as unknown as {
  executeQuery: jest.Mock;
};
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

// A well-formed body, so any refusal below is about the caller, not the input.
const VALID_BODY: JSONObject = {
  callerServiceName: "checkout",
  calleeServiceName: "payments",
  startTime: "2026-09-18T10:00:00.000Z",
  endTime: "2026-09-18T11:00:00.000Z",
};

function tenantPermissions(
  permissions: Array<Permission>,
): Record<string, UserTenantAccessPermission> {
  return {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission;
      }),
      isBlockPermission: false,
    } as UserTenantAccessPermission,
  };
}

function mockProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

async function callRoute(body?: JSONObject | undefined): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;

  const req: ExpressRequest = {
    params: {},
    body: body || VALID_BODY,
  } as unknown as ExpressRequest;

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(req, {} as ExpressResponse, next);

  return next;
}

function errorFrom(next: NextFunction): Error {
  const calls: Array<Array<unknown>> = (next as unknown as jest.Mock).mock
    .calls as Array<Array<unknown>>;
  expect(calls).toHaveLength(1);
  return calls[0]![0] as Error;
}

function expectAuthenticationRequired(next: NextFunction): void {
  const error: Error = errorFrom(next);

  expect(error).toBeInstanceOf(NotAuthenticatedException);
  expect(error).not.toBeInstanceOf(NotAuthorizedException);
  expect(error).not.toBeInstanceOf(BadDataException);
  expect((error as NotAuthenticatedException).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect(error.message).toBe(CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE);
}

function expectNothingRead(): void {
  expect(serviceService.findOneBy).not.toHaveBeenCalled();
  expect(spanService.executeQuery).not.toHaveBeenCalled();
  expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
}

describe("POST /telemetry/service-dependency-timeseries - callers without a session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    serviceService.findOneBy.mockResolvedValue(null as never);
  });

  test("is mounted behind getUserMiddleware only - the handler is the gate", () => {
    expect(mockRouter.match("post", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("an anonymous caller naming a project in the tenant header gets 401, not the span-permission 422", async () => {
    mockProps({ tenantId: PROJECT_ID, userType: UserType.Public });

    const next: NextFunction = await callRoute();

    expectAuthenticationRequired(next);
    expectNothingRead();
  });

  test("an anonymous caller with no tenant header gets 401, not 'Project not found in request'", async () => {
    mockProps({ userType: UserType.Public });

    const next: NextFunction = await callRoute();

    expectAuthenticationRequired(next);
    expectNothingRead();
  });

  test("a caller getUserMiddleware left unclassified is anonymous too", async () => {
    mockProps({ tenantId: PROJECT_ID });

    const next: NextFunction = await callRoute();

    expectAuthenticationRequired(next);
    expectNothingRead();
  });

  /*
   * Span-read permissions on a request with no user, no key and no
   * master-admin session prove nothing about who sent it.
   */
  test("an anonymous caller carrying stray span-read permissions is still anonymous", async () => {
    mockProps({
      tenantId: PROJECT_ID,
      userType: UserType.Public,
      userTenantAccessPermission: tenantPermissions([
        Permission.TelemetryViewer,
      ]),
    });

    const next: NextFunction = await callRoute();

    expectAuthenticationRequired(next);
    expectNothingRead();
  });

  test("an anonymous caller is told to authenticate before its body is validated", async () => {
    mockProps({ tenantId: PROJECT_ID, userType: UserType.Public });

    const next: NextFunction = await callRoute({ callerServiceName: 42 });

    expectAuthenticationRequired(next);
    expectNothingRead();
  });

  test("the fixtures below use a real span reader", () => {
    expect(new Span().accessControl?.read).toContain(
      Permission.TelemetryViewer,
    );
  });

  test("a project API key with span-read permission is admitted past the credential check to the service lookup", async () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userType: UserType.API,
      userTenantAccessPermission: tenantPermissions([
        Permission.TelemetryViewer,
      ]),
    };
    mockProps(props);

    const next: NextFunction = await callRoute();

    // The lookup ran under the key's own props and found nothing to chart.
    expect(serviceService.findOneBy).toHaveBeenCalled();
    expect(
      (serviceService.findOneBy.mock.calls[0]![0] as { props: unknown }).props,
    ).toBe(props);

    const error: Error = errorFrom(next);
    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("was not found");
  });

  test("a project API key without span-read permission gets the permission 422, not 401", async () => {
    mockProps({
      tenantId: PROJECT_ID,
      userType: UserType.API,
      userTenantAccessPermission: tenantPermissions([
        Permission.ReadProjectIncident,
      ]),
    });

    const next: NextFunction = await callRoute();

    const error: Error = errorFrom(next);
    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error).not.toBeInstanceOf(NotAuthenticatedException);
    expect((error as NotAuthorizedException).code).toBe(
      ExceptionCode.NotAuthorizedException,
    );
    expect(error.message).toBe(
      "You do not have permission to read traces for this project.",
    );
    expectNothingRead();
  });

  test("a logged-in user with span-read permission is admitted as before", async () => {
    mockProps({
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userType: UserType.User,
      userTenantAccessPermission: tenantPermissions([
        Permission.TelemetryViewer,
      ]),
    });

    const next: NextFunction = await callRoute();

    expect(serviceService.findOneBy).toHaveBeenCalled();
    expect(errorFrom(next)).toBeInstanceOf(BadDataException);
  });
});
