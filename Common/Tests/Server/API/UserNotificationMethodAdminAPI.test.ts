import { mockRouter } from "./Helpers";
import UserNotificationMethodAdminAPI from "../../../Server/API/UserNotificationMethodAdminAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationMethodAdminService, {
  AdminNotificationMethodView,
} from "../../../Server/Services/UserNotificationMethodAdminService";
import { ReadinessMethodType } from "../../../Server/Services/OnCallReadinessService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The HTTP face of "an administrator manages somebody else's notification
 * methods".
 *
 * This router is the ONLY gate under these routes, and that is not a stylistic
 * observation. The nine notification method models are scoped to the person
 * who owns the device — the essay at the top of UserEmail.ts is the record of
 * what happened the one time that scope was widened — so the service behind
 * these handlers does every read and write with `isRoot: true`, which means the
 * models' own TableAccessControl never runs on this path. And
 * UserMiddleware.getUserMiddleware is not a gate either: it admits anonymous
 * callers as UserType.Public and calls next(), and the tenant id it attaches
 * comes straight off the caller-supplied `tenantid` header before any
 * authorisation runs.
 *
 * So a disproportionate share of this file is about who is refused, in what
 * order, and — the property that stops these endpoints being a cross-tenant
 * probe — whether a caller can tell the refusals apart.
 *
 * The service itself is stubbed here. What it does with the row (mask it, leave
 * it unverified, mail the owner) is a different claim tested against the real
 * thing in UserNotificationMethodAdminService.test.ts; a masking test that
 * stubbed the masker would prove nothing.
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
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const LIST_ROUTE: string = "/user-notification-method-admin/user/:userId";
const ADD_ROUTE: string = "/user-notification-method-admin/user/:userId";
const IMPACT_ROUTE: string =
  "/user-notification-method-admin/user/:userId/:methodType/:methodId/deletion-impact";
const RESEND_ROUTE: string =
  "/user-notification-method-admin/user/:userId/:methodType/:methodId/resend-verification-code";
const DELETE_ROUTE: string =
  "/user-notification-method-admin/user/:userId/:methodType/:methodId";

/*
 * The one sentence every authorisation refusal on this router carries.
 * Asserting on the literal is the only way to pin the property that matters:
 * "you may not do this", "that user is in another project" and "that user does
 * not exist" must be indistinguishable to the caller, or the endpoint becomes a
 * way to enumerate the installation's users.
 */
const REFUSAL: string = "You are not authorized to access this project's data.";

interface RegisteredRoute {
  method: string;
  uri: string;
  middleware: unknown;
  middlewares: Array<unknown>;
  handlerFunction: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void | Promise<void>;
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
}

let propsSpy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let listSpy: jest.SpyInstance;
let addSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;
let resendSpy: jest.SpyInstance;
let previewSpy: jest.SpyInstance;

let projectId: ObjectID;
let otherProjectId: ObjectID;
let callerUserId: ObjectID;
let targetUserId: ObjectID;
let methodId: ObjectID;

/*
 * A logged-in caller holding exactly the permissions named, in the project
 * named.
 *
 * `isBlockPermission` is set explicitly on every entry because the dictionary
 * these live in holds GRANTS AND DENIALS together, discriminated only by that
 * flag. A fixture that left it undefined would be a grant by accident, and the
 * denial test below would then be testing nothing.
 */
function buildProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  blockedPermissions?: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const granted: Array<UserPermission> = data.permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const blocked: Array<UserPermission> = (data.blockedPermissions || []).map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [...granted, ...blocked],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

function routeFor(method: string, uri: string): RegisteredRoute {
  const routes: Array<RegisteredRoute> =
    mockRouter.routes as unknown as Array<RegisteredRoute>;

  const route: RegisteredRoute | undefined = routes.find(
    (candidate: RegisteredRoute): boolean => {
      return candidate.method === method && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`No ${method} route registered for ${uri}`);
  }

  return route;
}

async function callRoute(data: {
  method: string;
  uri: string;
  params?: Dictionary<string> | undefined;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: {},
    body: data.body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await routeFor(data.method, data.uri).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

type StubCallerFunction = (permissions: Array<Permission>) => void;

/*
 * The mutable module-level spies and ids are reached through functions rather
 * than captured directly, because the parameterised blocks below build their
 * callbacks inside a `for` loop: a closure over `propsSpy` would read whichever
 * spy happened to be bound when the loop ran rather than the one this test's
 * beforeEach created. Going through a stable function is also what stops
 * eslint's no-loop-func from being right about it.
 */
const stubCaller: StubCallerFunction = (
  permissions: Array<Permission>,
): void => {
  propsSpy.mockResolvedValue(
    buildProps({
      projectId: projectId,
      userId: callerUserId,
      permissions: permissions,
    }) as never,
  );
};

type StubTargetOutsideProjectFunction = () => void;

const stubTargetOutsideProject: StubTargetOutsideProjectFunction = (): void => {
  teamMemberFindBy.mockResolvedValue([] as never);
};

function jsonPayload(): Record<string, unknown> {
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const calls: Array<Array<unknown>> = sender.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];

  if (!last) {
    throw new Error("The route sent no JSON response");
  }

  return last[2] as Record<string, unknown>;
}

/* Enough of a view to serialise, carrying no raw value anywhere. */
function buildView(): AdminNotificationMethodView {
  return {
    methodId: methodId,
    methodType: ReadinessMethodType.SMS,
    maskedIdentifier: "+1 ••• ••• 4821",
    isVerified: false,
    isAdminAddable: true,
    createdAt: new Date("2024-01-02T03:04:05.000Z"),
  };
}

function everyWriteSpy(): Array<jest.SpyInstance> {
  return [addSpy, deleteSpy, resendSpy, previewSpy];
}

beforeEach(() => {
  jest.clearAllMocks();

  projectId = ObjectID.generate();
  otherProjectId = ObjectID.generate();
  callerUserId = ObjectID.generate();
  targetUserId = ObjectID.generate();
  methodId = ObjectID.generate();

  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [
          Permission.ProjectMember,
          Permission.ManageProjectUserNotificationMethod,
          Permission.ReadProjectUserNotificationRule,
        ],
      }) as never,
    );

  teamMemberFindBy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([{ _id: ObjectID.generate().toString() }] as never);

  listSpy = jest
    .spyOn(UserNotificationMethodAdminService, "listMethodsForUser")
    .mockResolvedValue([buildView()] as never);

  addSpy = jest
    .spyOn(UserNotificationMethodAdminService, "addMethodForUser")
    .mockResolvedValue(buildView() as never);

  deleteSpy = jest
    .spyOn(UserNotificationMethodAdminService, "deleteMethodForUser")
    .mockResolvedValue(undefined as never);

  resendSpy = jest
    .spyOn(UserNotificationMethodAdminService, "resendVerificationCodeForUser")
    .mockResolvedValue(undefined as never);

  previewSpy = jest
    .spyOn(UserNotificationMethodAdminService, "getDeletionPreview")
    .mockResolvedValue({
      rulesDeletedCount: 2,
      coverageLostCount: 1,
      verifiedMethodCountAfterDeletion: 0,
      reachability: "NotReachable",
      isFallbackEnabled: true,
      isTruncated: false,
    } as never);
});

describe("the routes it registers", () => {
  test("five routes, each behind the user middleware", () => {
    const expected: Array<{ method: string; uri: string }> = [
      { method: "GET", uri: LIST_ROUTE },
      { method: "POST", uri: ADD_ROUTE },
      { method: "GET", uri: IMPACT_ROUTE },
      { method: "POST", uri: RESEND_ROUTE },
      { method: "DELETE", uri: DELETE_ROUTE },
    ];

    for (const route of expected) {
      const registered: RegisteredRoute = routeFor(route.method, route.uri);

      /*
       * The middleware does not authorise anything — it admits anonymous
       * callers — but its absence would mean the handler runs with no resolved
       * session at all, and `props.userId` would be undefined on a route that
       * names the actor in an audit entry and in a mail to the account holder.
       */
      expect(registered.middleware).toBe(UserMiddleware.getUserMiddleware);
    }
  });

  test("the router is exported as a bare router, not a CRUD API", () => {
    /*
     * Extending BaseAPI to inherit `this.router` would register a whole model's
     * CRUD routes as a side effect — dead code that is shadowed by the real
     * registration until the day the mount order changes. There is no model to
     * inherit here in any case: the nine method models stay owner-scoped and
     * this router deliberately never exposes them.
     */
    expect(UserNotificationMethodAdminAPI).toBe(mockRouter);
  });
});

describe("reading the masked list", () => {
  test("returns one masked entry per method and no raw field", async () => {
    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: LIST_ROUTE,
      params: { userId: targetUserId.toString() },
    });

    expect(result.nextCallCount).toBe(0);

    const payload: Record<string, unknown> = jsonPayload();
    const methods: Array<Record<string, unknown>> = payload["methods"] as Array<
      Record<string, unknown>
    >;

    expect(methods).toHaveLength(1);

    /*
     * Ids are flattened to plain strings rather than left as ObjectID's
     * `{ _type, value }` JSON envelope, which is right for model payloads the
     * client parses back but wrong for a hand-rolled body.
     */
    expect(methods[0]!["methodId"]).toBe(methodId.toString());
    expect(methods[0]!["methodType"]).toBe("SMS");
    expect(methods[0]!["maskedIdentifier"]).toBe("+1 ••• ••• 4821");

    /*
     * The serialiser copies the fields it names and nothing else. There is no
     * raw field on the service's contract to leak, which is the point — a
     * future change would have to widen that contract in the open rather than
     * slip a phone number through here.
     */
    expect(Object.keys(methods[0]!).sort()).toEqual(
      [
        "createdAt",
        "isAdminAddable",
        "isVerified",
        "maskedIdentifier",
        "methodId",
        "methodType",
      ].sort(),
    );
  });

  test("a read-only admin permission is enough to look", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [
          Permission.ProjectMember,
          Permission.ReadProjectUserNotificationRule,
        ],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: LIST_ROUTE,
      params: { userId: targetUserId.toString() },
    });

    expect(result.nextCallCount).toBe(0);
    expect(listSpy).toHaveBeenCalled();
  });

  test("an ordinary member may not read a colleague's methods", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [Permission.ProjectMember],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: LIST_ROUTE,
      params: { userId: targetUserId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );

    /*
     * Refused BEFORE the read. A route that fetches and then refuses has
     * already paid for — and, on a replica with logging, recorded — the
     * disclosure it declined to make.
     */
    expect(listSpy).not.toHaveBeenCalled();
  });

  test("but that same member may read their own", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: targetUserId,
        permissions: [Permission.ProjectMember],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: LIST_ROUTE,
      params: { userId: targetUserId.toString() },
    });

    /*
     * These are rows the self-serve settings pages already show them in full,
     * so refusing a masked view of their own account would be theatre.
     */
    expect(result.nextCallCount).toBe(0);
    expect(listSpy).toHaveBeenCalled();
  });
});

describe("who may write", () => {
  /*
   * The four write routes, described lazily.
   *
   * `getParams` and `getBody` are functions rather than values because the ids
   * every one of them names are regenerated in beforeEach, and a describe body
   * runs once at collection time — before the first beforeEach has assigned
   * anything. Building the params eagerly reads `undefined.toString()` and
   * takes the whole file down at load.
   */
  interface WriteCase {
    label: string;
    method: string;
    uri: string;
    getParams: () => Dictionary<string>;
    getBody: () => JSONObject | undefined;
    spy: () => jest.SpyInstance;
  }

  const WRITE_CASES: Array<WriteCase> = [
    {
      label: "add",
      method: "POST",
      uri: ADD_ROUTE,
      getParams: (): Dictionary<string> => {
        return { userId: targetUserId.toString() };
      },
      getBody: (): JSONObject => {
        return { methodType: "SMS", value: "+15551234821" };
      },
      spy: (): jest.SpyInstance => {
        return addSpy;
      },
    },
    {
      label: "remove",
      method: "DELETE",
      uri: DELETE_ROUTE,
      getParams: (): Dictionary<string> => {
        return {
          userId: targetUserId.toString(),
          methodType: "SMS",
          methodId: methodId.toString(),
        };
      },
      getBody: (): undefined => {
        return undefined;
      },
      spy: (): jest.SpyInstance => {
        return deleteSpy;
      },
    },
    {
      label: "resend the verification code",
      method: "POST",
      uri: RESEND_ROUTE,
      getParams: (): Dictionary<string> => {
        return {
          userId: targetUserId.toString(),
          methodType: "SMS",
          methodId: methodId.toString(),
        };
      },
      getBody: (): JSONObject => {
        return {};
      },
      spy: (): jest.SpyInstance => {
        return resendSpy;
      },
    },
    {
      label: "preview a removal",
      method: "GET",
      uri: IMPACT_ROUTE,
      getParams: (): Dictionary<string> => {
        return {
          userId: targetUserId.toString(),
          methodType: "SMS",
          methodId: methodId.toString(),
        };
      },
      getBody: (): undefined => {
        return undefined;
      },
      spy: (): jest.SpyInstance => {
        return previewSpy;
      },
    },
  ];

  for (const writeCase of WRITE_CASES) {
    test(`${writeCase.label} is refused for a caller who may only READ rules`, async () => {
      /*
       * Including the rule EDIT permission, which is the whole point of the
       * separation: repairing somebody's rules re-points their pages between
       * devices they have already proved they hold; adding a method introduces
       * a device nobody has proved anything about.
       */
      stubCaller([
        Permission.ProjectMember,
        Permission.ReadProjectUserNotificationRule,
        Permission.EditProjectUserNotificationRule,
      ]);

      const result: RouteCallResult = await callRoute({
        method: writeCase.method,
        uri: writeCase.uri,
        params: writeCase.getParams(),
        body: writeCase.getBody(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        REFUSAL,
      );
      expect(writeCase.spy()).not.toHaveBeenCalled();
    });

    test(`${writeCase.label} is allowed for a project owner`, async () => {
      /*
       * And with NO granular permission. Existing project teams are seeded with
       * roles, never with individual granular permissions, so a gate naming
       * only ManageProjectUserNotificationMethod would be dead on arrival for
       * every project that already exists.
       */
      stubCaller([Permission.ProjectOwner]);

      const result: RouteCallResult = await callRoute({
        method: writeCase.method,
        uri: writeCase.uri,
        params: writeCase.getParams(),
        body: writeCase.getBody(),
      });

      expect(result.nextCallCount).toBe(0);
      expect(writeCase.spy()).toHaveBeenCalled();
    });

    test(`${writeCase.label} is refused when the target is not in the project`, async () => {
      stubTargetOutsideProject();

      const result: RouteCallResult = await callRoute({
        method: writeCase.method,
        uri: writeCase.uri,
        params: writeCase.getParams(),
        body: writeCase.getBody(),
      });

      /*
       * Holding an administrative permission is a claim about a PROJECT, so it
       * can only ever authorise acting on users of that project. Without this,
       * one throwaway project where the caller is an admin would license adding
       * a phone number to any user id in the installation.
       *
       * The refusal is word-for-word the permission refusal, so "that user is
       * in another project" and "that user does not exist" cannot be told
       * apart.
       */
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        REFUSAL,
      );
      expect(writeCase.spy()).not.toHaveBeenCalled();
    });

    test(`${writeCase.label} rejects a user id that is not a uuid`, async () => {
      const result: RouteCallResult = await callRoute({
        method: writeCase.method,
        uri: writeCase.uri,
        params: { ...writeCase.getParams(), userId: "not-a-uuid" },
        body: writeCase.getBody(),
      });

      /*
       * ObjectID's constructor accepts any string, so an unvalidated segment
       * would travel to a query that matches nothing and read as "this user has
       * no methods" rather than as "you sent nonsense".
       */
      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(writeCase.spy()).not.toHaveBeenCalled();
    });
  }

  test("a blocked ProjectAdmin is a denial, never a grant", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [Permission.ProjectMember],
        blockedPermissions: [
          Permission.ProjectAdmin,
          Permission.ManageProjectUserNotificationMethod,
        ],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: ADD_ROUTE,
      params: { userId: targetUserId.toString() },
      body: { methodType: "Email", value: "someone@example.com" },
    });

    /*
     * The permission dictionary holds grants and denials in one array,
     * discriminated only by `isBlockPermission`. Reading it raw would count a
     * team's explicit BLOCK of ProjectAdmin as a grant of it — so the admin
     * action that RESTRICTS a team would be the thing that handed it this
     * endpoint.
     */
    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(addSpy).not.toHaveBeenCalled();
  });

  test("a master admin is let through", async () => {
    propsSpy.mockResolvedValue({
      ...buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [],
      }),
      isMasterAdmin: true,
    } as never);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: ADD_ROUTE,
      params: { userId: targetUserId.toString() },
      body: { methodType: "Email", value: "someone@example.com" },
    });

    expect(result.nextCallCount).toBe(0);
    expect(addSpy).toHaveBeenCalled();
  });

  test("being the owner of the account is NOT a licence to use this router", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: targetUserId,
        permissions: [Permission.ProjectMember],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: ADD_ROUTE,
      params: { userId: targetUserId.toString() },
      body: { methodType: "Email", value: "someone@example.com" },
    });

    /*
     * The self branch exists on the READ and deliberately not on the writes. A
     * person adding their own method goes through /user-email and its siblings,
     * where the model's own ownership scoping applies end to end; letting them
     * in here instead would put an ordinary member's self-service on a code
     * path that runs as root.
     */
    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(addSpy).not.toHaveBeenCalled();
  });
});

describe("adding a method", () => {
  test("passes the channel, the value and the SERVER's actor", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: ADD_ROUTE,
      params: { userId: targetUserId.toString() },
      body: {
        methodType: "SMS",
        value: "  +15551234821  ",
        /*
         * A body that tries to sign the change with somebody else's name. It
         * must not be read: this value ends up in an audit entry and in a mail
         * to the account holder, and a caller-supplied actor would let an
         * attacker attribute their own write to a colleague.
         */
        actorUserId: ObjectID.generate().toString(),
        userId: ObjectID.generate().toString(),
      },
    });

    expect(result.nextCallCount).toBe(0);

    const call: any = addSpy.mock.calls[0]![0];

    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.targetUserId.toString()).toBe(targetUserId.toString());
    expect(call.actorUserId.toString()).toBe(callerUserId.toString());
    expect(call.methodType).toBe("SMS");

    // Trimmed at the edge, so the service never sees the caller's whitespace.
    expect(call.value).toBe("+15551234821");
  });

  test("refuses a body with no channel or no value", async () => {
    for (const body of [
      {},
      { methodType: "SMS" },
      { value: "+15551234821" },
      { methodType: "SMS", value: "   " },
      { methodType: 42, value: "+15551234821" },
    ] as Array<JSONObject>) {
      addSpy.mockClear();

      const result: RouteCallResult = await callRoute({
        method: "POST",
        uri: ADD_ROUTE,
        params: { userId: targetUserId.toString() },
        body: body,
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(addSpy).not.toHaveBeenCalled();
    }
  });

  test("checks the permission before it reads the body", async () => {
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [Permission.ProjectMember],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: ADD_ROUTE,
      params: { userId: targetUserId.toString() },
      body: {},
    });

    /*
     * The body here is invalid AND the caller is unauthorised. A route that
     * validated first would answer "methodType is required", which tells a
     * caller it has no business talking to this endpoint what the endpoint
     * expects.
     */
    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(result.thrownToNext).not.toBeInstanceOf(BadDataException);
  });

  test("returns the created method, masked", async () => {
    await callRoute({
      method: "POST",
      uri: ADD_ROUTE,
      params: { userId: targetUserId.toString() },
      body: { methodType: "SMS", value: "+15551234821" },
    });

    const payload: Record<string, unknown> = jsonPayload();

    expect(payload["maskedIdentifier"]).toBe("+1 ••• ••• 4821");

    /*
     * And UNVERIFIED. The whole safety property of this feature is that an
     * administrator can type a number in but cannot make it live — the code
     * goes to the device and the verify endpoints refuse anybody but the row's
     * owner — so a response claiming otherwise would be the first sign that
     * property had been lost.
     */
    expect(payload["isVerified"]).toBe(false);
  });
});

describe("removing a method", () => {
  test("names the channel and the row, and the server's actor", async () => {
    await callRoute({
      method: "DELETE",
      uri: DELETE_ROUTE,
      params: {
        userId: targetUserId.toString(),
        methodType: "SMS",
        methodId: methodId.toString(),
      },
    });

    const call: any = deleteSpy.mock.calls[0]![0];

    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.targetUserId.toString()).toBe(targetUserId.toString());
    expect(call.actorUserId.toString()).toBe(callerUserId.toString());
    expect(call.methodType).toBe("SMS");
    expect(call.methodId.toString()).toBe(methodId.toString());
  });

  test("rejects a method id that is not a uuid", async () => {
    const result: RouteCallResult = await callRoute({
      method: "DELETE",
      uri: DELETE_ROUTE,
      params: {
        userId: targetUserId.toString(),
        methodType: "SMS",
        methodId: "not-a-uuid",
      },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test("the preview crosses the wire as plain numbers", async () => {
    await callRoute({
      method: "GET",
      uri: IMPACT_ROUTE,
      params: {
        userId: targetUserId.toString(),
        methodType: "SMS",
        methodId: methodId.toString(),
      },
    });

    const payload: Record<string, unknown> = jsonPayload();

    expect(payload["rulesDeletedCount"]).toBe(2);
    expect(payload["coverageLostCount"]).toBe(1);
    expect(payload["verifiedMethodCountAfterDeletion"]).toBe(0);

    /*
     * Carried through rather than swallowed: a confirmation that silently
     * undercounts is worse than one that says it is unsure.
     */
    expect(payload["isTruncated"]).toBe(false);
  });
});

describe("the project scope", () => {
  test("every route checks the target against the caller's own project", async () => {
    await callRoute({
      method: "GET",
      uri: LIST_ROUTE,
      params: { userId: targetUserId.toString() },
    });

    const call: any = teamMemberFindBy.mock.calls[0]![0];

    /*
     * The project comes from the props the server resolved for this caller, not
     * from anything in the path — otherwise a member of project A reads project
     * B's data simply by sending their own `tenantid` header alongside a
     * borrowed user id.
     */
    expect(call.query.projectId.toString()).toBe(projectId.toString());
    expect(call.query.projectId.toString()).not.toBe(otherProjectId.toString());
    expect(call.query.userId.toString()).toBe(targetUserId.toString());
    expect(call.props.isRoot).toBe(true);
  });

  test("a caller with no project is refused everywhere", async () => {
    propsSpy.mockResolvedValue({
      userId: callerUserId,
      userTenantAccessPermission: {},
    } as never);

    for (const uri of [LIST_ROUTE, ADD_ROUTE]) {
      const result: RouteCallResult = await callRoute({
        method: uri === LIST_ROUTE ? "GET" : "POST",
        uri: uri,
        params: { userId: targetUserId.toString() },
        body: { methodType: "Email", value: "someone@example.com" },
      });

      expect(result.nextCallCount).toBe(1);
    }

    for (const spy of everyWriteSpy()) {
      expect(spy).not.toHaveBeenCalled();
    }

    expect(listSpy).not.toHaveBeenCalled();
  });
});
