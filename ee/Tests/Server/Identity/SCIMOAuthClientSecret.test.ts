import { mockRouter } from "Common/Tests/Server/API/Helpers";
import "../../../Server/Identity/API/SCIMOAuthClientSecret";
import { hashScimClientSecret } from "../../../Server/Identity/Utils/SCIMOAuth";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The dashboard's routes that make and delete a SCIM connection's OAuth 2.0
 * client secrets (API/SCIMOAuthClientSecret.ts).
 *
 * They sit behind UserMiddleware.getUserMiddleware, which lets an anonymous
 * caller through as public, and they read the connection as root - so who
 * the caller is and whether the connection is their project's is decided by
 * the routes themselves, before anything about the connection is answered.
 * The write goes through the connection's service with the caller's props,
 * which holds it to the columns' access control.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "2b000000-0000-4000-8000-000000000002",
);
const CONNECTION_ID: string = "2b000000-0000-4000-8000-000000000003";
const USER_ID: ObjectID = new ObjectID("2b000000-0000-4000-8000-000000000004");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const REFUSAL: string = "You are not authorized to access this project's data.";

const PROJECT_ROUTE: string =
  "/project-scim/:projectScimId/oauth-client-secret";
const PROJECT_PREVIOUS_ROUTE: string = `${PROJECT_ROUTE}/previous`;
const STATUS_PAGE_ROUTE: string =
  "/status-page-scim/:statusPageScimId/oauth-client-secret";
const STATUS_PAGE_PREVIOUS_ROUTE: string = `${STATUS_PAGE_ROUTE}/previous`;

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      projectId: PROJECT_ID,
      permissions: [],
      _type: "UserTenantAccessPermission",
    } as never,
  },
};

const ANONYMOUS_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userType: UserType.Public,
};

let props: DatabaseCommonInteractionProps;
let stored: ProjectSCIM | null;
let updated: number;
let updateError: Error | null;

interface Call {
  next: jest.Mock;
  answer: JSONObject | undefined;
  error: unknown;
}

async function call(
  method: "POST" | "DELETE",
  route: string,
  params: Record<string, string>,
): Promise<Call> {
  const next: jest.Mock = jest.fn();
  const req: ExpressRequest = {
    params: params,
    headers: {},
    body: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;

  await mockRouter
    .match(method, route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  const sent: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls[0];

  return {
    next: next,
    answer: sent ? (sent[2] as JSONObject) : undefined,
    error: next.mock.calls[0]?.[0],
  };
}

function connection(data: {
  projectId: ObjectID;
  secretHash?: string;
  secretExpiresAt?: Date;
}): ProjectSCIM {
  const model: ProjectSCIM = new ProjectSCIM(new ObjectID(CONNECTION_ID));
  model.projectId = data.projectId;

  if (data.secretHash) {
    model.oauthClientSecretHash = data.secretHash;
  }

  if (data.secretExpiresAt) {
    model.oauthClientSecretExpiresAt = data.secretExpiresAt;
  }

  return model;
}

let findOneBy: jest.SpiedFunction<typeof ProjectSCIMService.findOneBy>;
let updateOneById: jest.SpiedFunction<typeof ProjectSCIMService.updateOneById>;
let statusPageFindOneBy: jest.SpiedFunction<
  typeof StatusPageSCIMService.findOneBy
>;
let statusPageUpdateOneById: jest.SpiedFunction<
  typeof StatusPageSCIMService.updateOneById
>;

beforeEach(() => {
  jest.clearAllMocks();
  props = MEMBER_PROPS;
  stored = connection({ projectId: PROJECT_ID });
  updated = 1;
  updateError = null;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  findOneBy = jest
    .spyOn(ProjectSCIMService, "findOneBy")
    .mockImplementation(async () => {
      return stored as never;
    });
  updateOneById = jest
    .spyOn(ProjectSCIMService, "updateOneById")
    .mockImplementation(async () => {
      if (updateError) {
        throw updateError;
      }
      return updated as never;
    });

  statusPageFindOneBy = jest
    .spyOn(StatusPageSCIMService, "findOneBy")
    .mockImplementation(async () => {
      const model: StatusPageSCIM = new StatusPageSCIM(
        new ObjectID(CONNECTION_ID),
      );
      if (!stored) {
        return null as never;
      }
      model.projectId = stored.projectId!;
      return model as never;
    });
  statusPageUpdateOneById = jest
    .spyOn(StatusPageSCIMService, "updateOneById")
    .mockImplementation(async () => {
      return updated as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the routes", () => {
  test.each([
    ["POST", PROJECT_ROUTE],
    ["DELETE", PROJECT_PREVIOUS_ROUTE],
    ["POST", STATUS_PAGE_ROUTE],
    ["DELETE", STATUS_PAGE_PREVIOUS_ROUTE],
  ])(
    "%s %s runs the user middleware, then the handler",
    (method: string, route: string) => {
      const registered: { middlewares: Array<unknown> } = mockRouter.match(
        method,
        route,
      );

      expect(registered.middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    },
  );
});

describe("making a secret", () => {
  test("answers it once, with what the identity provider is configured with", async () => {
    const before: number = Date.now();
    const result: Call = await call("POST", PROJECT_ROUTE, {
      projectScimId: CONNECTION_ID,
    });

    expect(result.error).toBeUndefined();
    expect(result.answer!["clientId"]).toBe(CONNECTION_ID);
    expect(result.answer!["clientSecret"]).toMatch(/^[0-9a-f]{64}$/);
    expect(result.answer!["previousClientSecretExpiresAt"]).toBe(null);
    expect(result.answer!["tokenEndpoint"]).toMatch(
      /\/identity\/scim\/oauth\/token$/,
    );

    const expiresAt: number = Date.parse(
      result.answer!["clientSecretExpiresAt"] as string,
    );

    expect(expiresAt - before).toBeGreaterThanOrEqual(365 * DAY_IN_MS - 1000);
    expect(expiresAt - before).toBeLessThanOrEqual(365 * DAY_IN_MS + 1000);
  });

  test("stores only its hash, through the service, with the caller's permissions", async () => {
    const result: Call = await call("POST", PROJECT_ROUTE, {
      projectScimId: CONNECTION_ID,
    });
    const secret: string = result.answer!["clientSecret"] as string;
    const update: { data: JSONObject; props: unknown } = updateOneById.mock
      .calls[0]![0] as unknown as { data: JSONObject; props: unknown };

    expect(update.props).toBe(MEMBER_PROPS);
    expect(update.data["oauthClientSecretHash"]).toBe(
      hashScimClientSecret(secret),
    );
    expect(JSON.stringify(update.data)).not.toContain(secret);
    expect(update.data["oauthPreviousClientSecretHash"]).toBe(null);
    expect(update.data["oauthPreviousClientSecretExpiresAt"]).toBe(null);
  });

  test("a live secret becomes the previous one, and keeps working until it expires", async () => {
    const currentExpiry: Date = new Date(Date.now() + 100 * DAY_IN_MS);
    stored = connection({
      projectId: PROJECT_ID,
      secretHash: "current-hash",
      secretExpiresAt: currentExpiry,
    });

    const result: Call = await call("POST", PROJECT_ROUTE, {
      projectScimId: CONNECTION_ID,
    });
    const update: { data: JSONObject } = updateOneById.mock
      .calls[0]![0] as unknown as { data: JSONObject };

    expect(update.data["oauthPreviousClientSecretHash"]).toBe("current-hash");
    expect(update.data["oauthPreviousClientSecretExpiresAt"]).toEqual(
      currentExpiry,
    );
    expect(result.answer!["previousClientSecretExpiresAt"]).toBe(
      currentExpiry.toISOString(),
    );
  });

  test("an expired secret is not kept", async () => {
    stored = connection({
      projectId: PROJECT_ID,
      secretHash: "expired-hash",
      secretExpiresAt: new Date(Date.now() - 1000),
    });

    await call("POST", PROJECT_ROUTE, { projectScimId: CONNECTION_ID });
    const update: { data: JSONObject } = updateOneById.mock
      .calls[0]![0] as unknown as { data: JSONObject };

    expect(update.data["oauthPreviousClientSecretHash"]).toBe(null);
  });

  test("a status page connection's, through its own service", async () => {
    const result: Call = await call("POST", STATUS_PAGE_ROUTE, {
      statusPageScimId: CONNECTION_ID,
    });

    expect(result.answer!["clientId"]).toBe(CONNECTION_ID);
    expect(statusPageUpdateOneById).toHaveBeenCalledTimes(1);
    expect(updateOneById).not.toHaveBeenCalled();
  });
});

describe("who is refused, before anything is read", () => {
  test("no credentials: 401, and the connection is never read", async () => {
    props = ANONYMOUS_PROPS;

    for (const [method, route] of [
      ["POST", PROJECT_ROUTE],
      ["DELETE", PROJECT_PREVIOUS_ROUTE],
    ] as Array<["POST" | "DELETE", string]>) {
      const result: Call = await call(method, route, {
        projectScimId: CONNECTION_ID,
      });

      expect(result.error).toBeInstanceOf(NotAuthenticatedException);
      expect(result.answer).toBeUndefined();
    }

    expect(findOneBy).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a member of another project: refused, nothing written", async () => {
    props = { ...MEMBER_PROPS, tenantId: OTHER_PROJECT_ID };

    const result: Call = await call("POST", PROJECT_ROUTE, {
      projectScimId: CONNECTION_ID,
    });

    expect(result.error).toBeInstanceOf(NotAuthorizedException);
    expect(findOneBy).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });
});

describe("a connection that is not the caller's project's is refused as one that does not exist", () => {
  test.each([
    ["another project's connection", "other"],
    ["no such connection", "missing"],
    ["a malformed id", "malformed"],
  ])("%s", async (_name: string, kind: string) => {
    if (kind === "other") {
      stored = connection({ projectId: OTHER_PROJECT_ID });
    }

    if (kind === "missing") {
      stored = null;
    }

    for (const [method, route] of [
      ["POST", PROJECT_ROUTE],
      ["DELETE", PROJECT_PREVIOUS_ROUTE],
      ["POST", STATUS_PAGE_ROUTE],
      ["DELETE", STATUS_PAGE_PREVIOUS_ROUTE],
    ] as Array<["POST" | "DELETE", string]>) {
      jest.clearAllMocks();

      const id: string = kind === "malformed" ? "not-a-uuid" : CONNECTION_ID;
      const result: Call = await call(method, route, {
        projectScimId: id,
        statusPageScimId: id,
      });

      expect(result.error).toBeInstanceOf(NotAuthorizedException);
      expect((result.error as Error).message).toBe(REFUSAL);
      expect(result.answer).toBeUndefined();
      expect(updateOneById).not.toHaveBeenCalled();
      expect(statusPageUpdateOneById).not.toHaveBeenCalled();
    }

    if (kind === "malformed") {
      expect(findOneBy).not.toHaveBeenCalled();
      expect(statusPageFindOneBy).not.toHaveBeenCalled();
    }
  });
});

describe("a secret is answered only once it is stored", () => {
  test("a caller the columns refuse (not a project owner) gets no secret", async () => {
    updateError = new NotAuthorizedException(
      "You do not have permissions to update this record.",
    );

    const result: Call = await call("POST", PROJECT_ROUTE, {
      projectScimId: CONNECTION_ID,
    });

    expect(result.error).toBe(updateError);
    expect(result.answer).toBeUndefined();
  });

  test("a write that matched no row: not found, and no secret", async () => {
    updated = 0;

    const result: Call = await call("POST", PROJECT_ROUTE, {
      projectScimId: CONNECTION_ID,
    });

    expect(result.error).toBeInstanceOf(NotFoundException);
    expect(result.answer).toBeUndefined();
  });
});

describe("deleting the previous secret", () => {
  test("clears it, through the service, with the caller's permissions", async () => {
    const result: Call = await call("DELETE", PROJECT_PREVIOUS_ROUTE, {
      projectScimId: CONNECTION_ID,
    });

    expect(result.error).toBeUndefined();
    expect(result.answer).toEqual({
      clientId: CONNECTION_ID,
      previousClientSecretExpiresAt: null,
    });
    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          oauthPreviousClientSecretHash: null,
          oauthPreviousClientSecretExpiresAt: null,
        },
        props: MEMBER_PROPS,
      }),
    );
  });

  test("never touches the current secret", async () => {
    await call("DELETE", PROJECT_PREVIOUS_ROUTE, {
      projectScimId: CONNECTION_ID,
    });

    const update: { data: JSONObject } = updateOneById.mock
      .calls[0]![0] as unknown as { data: JSONObject };

    expect(Object.keys(update.data)).not.toContain("oauthClientSecretHash");
    expect(Object.keys(update.data)).not.toContain(
      "oauthClientSecretExpiresAt",
    );
  });
});
