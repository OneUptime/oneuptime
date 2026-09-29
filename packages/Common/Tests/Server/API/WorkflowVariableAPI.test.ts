import type {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /workflow-variable/:id/refresh-oauth-token - "Refresh now" for an
 * OAuth 2.0 workflow variable.
 *
 * What matters here is the order of the checks and what the answer does NOT
 * contain. The caller's own read decides whether the variable exists for
 * them at all; the update permission decides whether they may cause a write;
 * only then are credentials read as root and a token requested. And the
 * access token never appears in the response - it is as unreadable through
 * the API as a variable's content.
 */

type RouteHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type RecordedRoute = {
  method: string;
  uri: string;
  handlers: Array<RouteHandler>;
};

const recordedRoutes: Array<RecordedRoute> = [];

jest.mock("../../../Server/Utils/Express", () => {
  const record: (method: string) => (...args: Array<unknown>) => void = (
    method: string,
  ) => {
    return (...args: Array<unknown>): void => {
      recordedRoutes.push({
        method,
        uri: args[0] as string,
        handlers: args.slice(1) as Array<RouteHandler>,
      });
    };
  };
  return {
    getRouter: () => {
      return {
        get: jest.fn().mockImplementation(record("GET")),
        post: jest.fn().mockImplementation(record("POST")),
        put: jest.fn().mockImplementation(record("PUT")),
        delete: jest.fn().mockImplementation(record("DELETE")),
      };
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

import WorkflowVariableAPI from "../../../Server/API/WorkflowVariableAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Response from "../../../Server/Utils/Response";
import { OAuth2TokenRequestException } from "../../../Server/Utils/Workflow/OAuth2TokenClient";
import WorkflowVariableOAuthToken from "../../../Server/Utils/Workflow/WorkflowVariableOAuthToken";
import WorkflowVariable from "../../../Models/DatabaseModels/WorkflowVariable";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { WorkflowVariableType } from "../../../Types/Workflow/WorkflowVariableOAuth";

const PROJECT_ID: ObjectID = new ObjectID(
  "eeee1111-1111-4111-8111-111111111111",
);
const VARIABLE_ID: ObjectID = new ObjectID(
  "eeee2222-2222-4222-8222-222222222222",
);
const ROUTE: string = "/workflow-variable/:id/refresh-oauth-token";
/*
 * An authenticated member of the project, the shape
 * CommonAPI.getDatabaseCommonInteractionProps produces for a signed-in user:
 * assertAuthenticatedProjectPrincipal wants the caller's permission record for
 * the project it is asking about, not just a tenant header.
 */
const CALLER_PROPS: JSONObject = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("eeee3333-3333-4333-8333-333333333333"),
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    },
  } as unknown as JSONObject,
};

function findRoute(): RecordedRoute {
  const route: RecordedRoute | undefined = recordedRoutes.find(
    (candidate: RecordedRoute) => {
      return candidate.method === "POST" && candidate.uri === ROUTE;
    },
  );

  if (!route) {
    throw new Error(`Route not registered: POST ${ROUTE}`);
  }

  return route;
}

async function callRoute(id: string): Promise<{ next: jest.Mock }> {
  const route: RecordedRoute = findRoute();
  const handler: RouteHandler = route.handlers[route.handlers.length - 1]!;

  const req: ExpressRequest = {
    params: { id },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await handler(req, res, next as unknown as NextFunction);

  return { next };
}

function variable(type: WorkflowVariableType): WorkflowVariable {
  const model: WorkflowVariable = new WorkflowVariable();
  model._id = VARIABLE_ID.toString();
  model.name = "API_TOKEN";
  model.variableType = type;
  return model;
}

describe("WorkflowVariableAPI refresh-oauth-token", () => {
  let findOneById: jest.SpyInstance;
  let checkUpdate: jest.SpyInstance;
  let getAccessToken: jest.SpyInstance;

  beforeAll(() => {
    recordedRoutes.length = 0;
    new WorkflowVariableAPI();
  });

  beforeEach(() => {
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue(CALLER_PROPS as never);

    findOneById = jest
      .spyOn(WorkflowVariableService, "findOneById")
      .mockResolvedValue(variable(WorkflowVariableType.OAuth2) as never);

    checkUpdate = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue({} as never);

    getAccessToken = jest
      .spyOn(WorkflowVariableOAuthToken, "getAccessToken")
      .mockResolvedValue({
        accessToken: "the-access-token",
        expiresAt: new Date("2026-09-22T13:00:00.000Z"),
        refreshedAt: new Date("2026-09-22T12:00:00.000Z"),
        didRefresh: true,
      } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (Response.sendErrorResponse as jest.Mock).mockClear();
    (Response.sendJsonObjectResponse as jest.Mock).mockClear();
  });

  test("is registered behind the user middleware", () => {
    expect(findRoute().handlers).toContain(
      UserMiddleware.getUserMiddleware as unknown as RouteHandler,
    );
  });

  test("refreshes the token and answers with when it expires - never the token", async () => {
    const { next } = await callRoute(VARIABLE_ID.toString());

    expect(next).not.toHaveBeenCalled();
    expect(getAccessToken).toHaveBeenCalledWith({
      variableId: VARIABLE_ID,
      forceRefresh: true,
    });

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

    const body: JSONObject = (Response.sendJsonObjectResponse as jest.Mock).mock
      .calls[0]![2] as JSONObject;

    expect(body).toEqual({
      oauthAccessTokenExpiresAt: "2026-09-22T13:00:00.000Z",
      oauthLastRefreshedAt: "2026-09-22T12:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("the-access-token");
  });

  test("answers null when the provider did not say when the token expires", async () => {
    getAccessToken.mockResolvedValue({
      accessToken: "the-access-token",
      expiresAt: null,
      refreshedAt: new Date("2026-09-22T12:00:00.000Z"),
      didRefresh: true,
    } as never);

    await callRoute(VARIABLE_ID.toString());

    expect(
      (
        (Response.sendJsonObjectResponse as jest.Mock).mock
          .calls[0]![2] as JSONObject
      )["oauthAccessTokenExpiresAt"],
    ).toBeNull();
  });

  /*
   * The first read uses the caller's own permissions, so another project's
   * variable - or one they may not read - is indistinguishable from one that
   * does not exist, and nothing is read as root.
   */
  test("reads the variable with the caller's permissions first", async () => {
    await callRoute(VARIABLE_ID.toString());

    expect(findOneById).toHaveBeenCalledTimes(1);

    const call: { id: ObjectID; props: unknown; select: JSONObject } =
      findOneById.mock.calls[0]![0] as {
        id: ObjectID;
        props: unknown;
        select: JSONObject;
      };

    expect(call.id.toString()).toBe(VARIABLE_ID.toString());
    expect(call.props).toBe(CALLER_PROPS);
    // Nothing secret is asked for with the caller's permissions.
    expect(Object.keys(call.select).sort()).toEqual(
      ["_id", "name", "variableType"].sort(),
    );
  });

  test("a variable the caller cannot see is not found, and nothing is refreshed", async () => {
    findOneById.mockResolvedValue(null as never);

    const { next } = await callRoute(VARIABLE_ID.toString());

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect((next.mock.calls[0]![0] as Error).message).toBe(
      "Workflow variable not found, or you do not have access to it.",
    );
    expect(checkUpdate).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  /*
   * A refresh writes the token (and possibly a rotated refresh token), so it
   * needs the permission that editing the variable needs. Being able to read
   * the variable is not enough.
   */
  test("requires permission to update the variable", async () => {
    await callRoute(VARIABLE_ID.toString());

    expect(checkUpdate).toHaveBeenCalledWith(
      WorkflowVariable,
      { _id: VARIABLE_ID.toString() },
      {},
      CALLER_PROPS,
    );
  });

  test("a caller who may read but not update gets refused, and nothing is refreshed", async () => {
    checkUpdate.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to update Workflow Variable.",
      ) as never,
    );

    const { next } = await callRoute(VARIABLE_ID.toString());

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  test("refuses a Static variable", async () => {
    findOneById.mockResolvedValue(
      variable(WorkflowVariableType.Static) as never,
    );

    const { next } = await callRoute(VARIABLE_ID.toString());

    expect((next.mock.calls[0]![0] as Error).message).toBe(
      '"API_TOKEN" is not an OAuth 2.0 variable, so it has no access token to refresh.',
    );
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  test("refuses a malformed id without touching the database", async () => {
    const { next } = await callRoute('\'; DROP TABLE "WorkflowVariable"; --');

    expect(next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("refuses a signed-in user who is not a member of the project, before any read", async () => {
    (
      CommonAPI.getDatabaseCommonInteractionProps as unknown as jest.Mock
    ).mockResolvedValue({
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userTenantAccessPermission: {},
    } as never);

    const { next } = await callRoute(VARIABLE_ID.toString());

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(NotAuthorizedException);
    expect(findOneById).not.toHaveBeenCalled();
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  test("refuses a caller with no project", async () => {
    (
      CommonAPI.getDatabaseCommonInteractionProps as unknown as jest.Mock
    ).mockResolvedValue({ userId: ObjectID.generate() } as never);

    const { next } = await callRoute(VARIABLE_ID.toString());

    expect(next).toHaveBeenCalledTimes(1);
    expect(findOneById).not.toHaveBeenCalled();
  });

  /*
   * The identity provider's answer is the part the person has to act on, so
   * it is the error message - sent as an error response, not swallowed.
   */
  test("hands the identity provider's refusal back as the error", async () => {
    const refusal: OAuth2TokenRequestException =
      new OAuth2TokenRequestException(
        "The token endpoint refused the request (HTTP 401): invalid_client.",
        "invalid_client",
      );

    getAccessToken.mockRejectedValue(refusal as never);

    const { next } = await callRoute(VARIABLE_ID.toString());

    expect(next).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect((Response.sendErrorResponse as jest.Mock).mock.calls[0]![2]).toBe(
      refusal,
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("wraps a failure that is not an Exception in a generic message", async () => {
    getAccessToken.mockRejectedValue("boom" as never);

    await callRoute(VARIABLE_ID.toString());

    const error: Error = (Response.sendErrorResponse as jest.Mock).mock
      .calls[0]![2] as Error;

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Could not refresh the access token. Try again in a few minutes.",
    );
  });
});
