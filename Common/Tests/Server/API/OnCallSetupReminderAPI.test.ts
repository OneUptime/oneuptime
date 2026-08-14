import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallReadinessAPI from "../../../Server/API/OnCallReadinessAPI";
import OnCallReadinessService from "../../../Server/Services/OnCallReadinessService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallSetupReminderService, {
  SetupReminderOutcome,
  SetupReminderResult,
  SetupReminderUserResult,
} from "../../../Server/Services/OnCallSetupReminderService";
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
 * POST /on-call-readiness/send-setup-reminder - the only WRITE on the readiness
 * router, and the only endpoint in this feature that sends email.
 *
 * The route itself is thin by design: OnCallSetupReminderService owns who gets
 * mailed and what the mail says. What is left worth testing here is exactly the
 * part the service cannot do for itself, and it is all about the boundary:
 *
 *   WHO. The route is mounted with UserMiddleware.getUserMiddleware, which
 *   admits anonymous callers as UserType.Public and takes the project from a
 *   caller-supplied `tenantid` header. So the handler is the only gate, and it
 *   has to refuse BEFORE any mail-sending work starts - a route that refuses
 *   after the send has not refused anything.
 *
 *   WITH WHAT STANDING. Membership is the bar for the READS on this router and
 *   was, wrongly, the bar for this write too. Every read-only Viewer holds an
 *   access entry for the project, so the original gate let anyone who could LOOK
 *   at the readiness table make the product mail their colleagues in the
 *   project's name. Reading who is unreachable and mailing them about it are
 *   different acts, and the tests below pin the second to on-call management.
 *
 *   WHICH PROJECT. The project comes from the authenticated caller's tenant,
 *   never from the body. A body that carries its own projectId must be ignored
 *   entirely, or a member of project A mails project B's responders about
 *   project B by sending one extra field.
 *
 *   WHAT THE BODY IS ALLOWED TO BE. ObjectID's constructor accepts any string,
 *   so a body of arbitrary text would otherwise travel into the service and out
 *   the far side as an ordinary-looking "not a member of this project" result.
 *
 *   WHAT COMES BACK. Ids flattened to strings, outcomes preserved per user, and
 *   the counts carried alongside - because the UI's whole job is to say "5 sent,
 *   2 skipped, 1 failed" instead of showing a tick.
 *
 * The service is stubbed throughout. OnCallSetupReminder.test.ts covers its
 * behaviour with the same rigour; duplicating that here would test the stub.
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
    sendJsonArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const REMINDER_ROUTE: string = "/on-call-readiness/send-setup-reminder";

/*
 * The message every authorisation refusal on this router carries. Asserted on
 * the literal so "you are in the wrong project" cannot drift apart from "you are
 * not logged in" - a caller must not be able to tell them apart.
 */
const REFUSAL: string = "You are not authorized to access this project's data.";

interface RegisteredRoute {
  method: string;
  uri: string;
  middleware: unknown;
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
let sendRemindersSpy: jest.SpyInstance;

let projectId: ObjectID;
let otherProjectId: ObjectID;
let callerUserId: ObjectID;
let userA: ObjectID;
let userB: ObjectID;

/*
 * A logged-in caller holding exactly the permissions named, in the project
 * named.
 *
 * `isBlockPermission` is set explicitly on every entry because the dictionary
 * these live in holds GRANTS AND DENIALS together and the route's permission
 * read filters on that flag. A fixture that left it undefined would be a grant
 * by accident rather than on purpose, and the denial test below would then be
 * testing nothing.
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

/*
 * The caller the rest of this file assumes: somebody who administers on-call in
 * this project, which is what the route now requires. Everything about the body
 * and the response shape is tested through this caller, so a regression in the
 * permission gate shows up as those tests failing loudly rather than as one
 * skipped assertion.
 */
function buildOnCallAdminProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  return buildProps({
    projectId: data.projectId,
    userId: data.userId,
    permissions: [Permission.ProjectMember, Permission.OnCallAdmin],
  });
}

/*
 * A member with no on-call standing - the caller the original gate admitted.
 * ProjectMember and Viewer are what an ordinary teammate and a read-only
 * teammate carry, and neither is a licence to send mail as the project.
 */
function buildMemberProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  return buildProps({
    projectId: data.projectId,
    userId: data.userId,
    permissions: [Permission.ProjectMember],
  });
}

function routeFor(uri: string): RegisteredRoute {
  const routes: Array<RegisteredRoute> =
    mockRouter.routes as unknown as Array<RegisteredRoute>;

  const route: RegisteredRoute | undefined = routes.find(
    (candidate: RegisteredRoute): boolean => {
      return candidate.method === "POST" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`No POST route registered for ${uri}`);
  }

  return route;
}

async function callRoute(
  body: JSONObject | undefined,
): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await routeFor(REMINDER_ROUTE).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

/*
 * The body the route handed to Response.sendJsonObjectResponse, typed as a bag
 * of unknowns rather than as the wire interface: the point of these assertions
 * is what actually crosses the wire, and typing it as the thing it is supposed
 * to be would let a missing field type-check its way past the test.
 */
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

function serviceCall(): { projectId: ObjectID; userIds: Array<ObjectID> } {
  const call: Array<unknown> | undefined = sendRemindersSpy.mock.calls[0];

  if (!call) {
    throw new Error("The route did not call the reminder service");
  }

  return call[0] as { projectId: ObjectID; userIds: Array<ObjectID> };
}

beforeEach(() => {
  jest.clearAllMocks();

  projectId = ObjectID.generate();
  otherProjectId = ObjectID.generate();
  callerUserId = ObjectID.generate();
  userA = ObjectID.generate();
  userB = ObjectID.generate();

  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(
      buildOnCallAdminProps({ projectId: projectId, userId: callerUserId }),
    );

  /*
   * The default stub echoes the request back as an all-sent result, so the
   * assertions about WHAT THE ROUTE PASSED IN can be made from the payload it
   * sent out. Tests about the shape of a mixed answer override it.
   */
  const echoAllSent: (data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }) => Promise<SetupReminderResult> = async (data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<SetupReminderResult> => {
    return {
      projectId: data.projectId,
      requestedCount: data.userIds.length,
      sentCount: data.userIds.length,
      skippedCount: 0,
      failedCount: 0,
      results: data.userIds.map((userId: ObjectID): SetupReminderUserResult => {
        return {
          userId: userId,
          outcome: SetupReminderOutcome.Sent,
          message: "Reminder sent to their account email address.",
        };
      }),
    };
  };

  sendRemindersSpy = jest
    .spyOn(OnCallSetupReminderService, "sendSetupReminders")
    .mockImplementation(echoAllSent as never);
});

describe("OnCallReadinessAPI POST /send-setup-reminder - registration", () => {
  test("the route is registered as a POST behind the user middleware", () => {
    const route: RegisteredRoute = routeFor(REMINDER_ROUTE);

    expect(route.method).toBe("POST");
    expect(route.middleware).toBe(UserMiddleware.getUserMiddleware);
  });

  test("the readiness router still exposes it alongside its three reads", () => {
    /*
     * A guard against the write being registered on some other router by
     * accident: it has to be reachable at the same prefix as the reads it
     * belongs with, or the dashboard's one base URL cannot reach both.
     */
    const uris: Array<string> = (
      mockRouter.routes as unknown as Array<RegisteredRoute>
    ).map((route: RegisteredRoute): string => {
      return route.uri;
    });

    expect(uris).toContain("/on-call-readiness/project");
    expect(uris).toContain(REMINDER_ROUTE);
  });
});

describe("OnCallReadinessAPI POST /send-setup-reminder - who may call it", () => {
  test("an anonymous caller is refused and nothing is sent", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userTenantAccessPermission: {},
    } as never);

    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("a member of a different project is refused and nothing is sent", async () => {
    // The header names THIS project; the caller's permissions name another.
    propsSpy.mockResolvedValue({
      ...buildOnCallAdminProps({
        projectId: otherProjectId,
        userId: callerUserId,
      }),
      tenantId: projectId,
    } as never);

    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("a request with no tenant header is refused before the body is even parsed", async () => {
    propsSpy.mockResolvedValue({} as never);

    const result: RouteCallResult = await callRoute({
      userIds: ["obviously-not-a-uuid"],
    });

    /*
     * The refusal must be the AUTHORISATION one, not the body-validation one:
     * if the body were parsed first, a caller could probe validation behaviour
     * without being authorised at all.
     */
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as BadDataException).message).toContain(
      "Project ID is required",
    );
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });
});

/*
 * MEMBERSHIP IS NOT ENOUGH.
 *
 * This block is the whole reason the route's authorisation is not a copy of its
 * read siblings'. Every caller below is a genuine, logged-in member of the right
 * project - assertAuthenticatedProjectMember admits all of them - and the
 * question each test asks is whether they may make the product send branded mail
 * to other people in that project's name.
 *
 * The refusal message is asserted to be the router's single refusal sentence, so
 * "you lack the permission" cannot be told apart from "you are not in this
 * project": a caller who could distinguish them could map out other projects'
 * membership from the outside.
 */
describe("OnCallReadinessAPI POST /send-setup-reminder - membership is not enough", () => {
  test("an ordinary project member cannot make the product mail their colleagues", async () => {
    propsSpy.mockResolvedValue(
      buildMemberProps({ projectId: projectId, userId: callerUserId }) as never,
    );

    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("a read-only viewer is refused", async () => {
    /*
     * The case that made this change necessary. A Viewer can open the readiness
     * page and read every gap on it; that is a disclosure decision already made.
     * It is not a decision to let them mail anybody.
     */
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [Permission.Viewer],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("the on-call tiers below Admin are refused", async () => {
    /*
     * OnCallMember and OnCallViewer are held by people who are ON call, which is
     * the population this endpoint mails. Being a recipient of the reminder is
     * not standing to send it.
     */
    for (const permission of [
      Permission.OnCallMember,
      Permission.OnCallViewer,
    ]) {
      jest.clearAllMocks();

      propsSpy.mockResolvedValue(
        buildProps({
          projectId: projectId,
          userId: callerUserId,
          permissions: [Permission.ProjectMember, permission],
        }) as never,
      );

      const result: RouteCallResult = await callRoute({
        userIds: [userA.toString()],
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(sendRemindersSpy).not.toHaveBeenCalled();
    }
  });

  test("each permission that means 'manages on-call here' is admitted", async () => {
    /*
     * All four are listed rather than just the granular one, and the reason is
     * migration rather than generosity: OneUptime's teams carry ROLES, so a
     * project that predates this feature has an owner holding ProjectOwner and
     * no granular permission at all. A gate that named only
     * EditProjectOnCallDutyPolicy would lock every existing project's owner out
     * of the button on their own readiness page.
     */
    const admitted: Array<Permission> = [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.OnCallAdmin,
      Permission.EditProjectOnCallDutyPolicy,
    ];

    for (const permission of admitted) {
      jest.clearAllMocks();

      propsSpy.mockResolvedValue(
        buildProps({
          projectId: projectId,
          userId: callerUserId,
          permissions: [permission],
        }) as never,
      );

      const result: RouteCallResult = await callRoute({
        userIds: [userA.toString()],
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(sendRemindersSpy).toHaveBeenCalledTimes(1);
    }
  });

  test("a BLOCKED permission is not read as a granted one", async () => {
    /*
     * The dictionary these permissions live in holds grants and denials in one
     * array, told apart only by isBlockPermission. Reading it raw would count a
     * team's explicit "block ProjectAdmin" as a grant of ProjectAdmin - so the
     * admin action that RESTRICTS a team would be the thing that handed it a
     * mail-sending endpoint.
     */
    propsSpy.mockResolvedValue(
      buildProps({
        projectId: projectId,
        userId: callerUserId,
        permissions: [Permission.ProjectMember],
        blockedPermissions: [
          Permission.ProjectAdmin,
          Permission.OnCallAdmin,
          Permission.EditProjectOnCallDutyPolicy,
        ],
      }) as never,
    );

    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("the permission held must be held IN THIS PROJECT", async () => {
    /*
     * An on-call admin of project B, sending project A's tenantid header. The
     * membership gate refuses this first; the assertion that matters is that
     * nothing was sent, because the permission read is keyed on the tenant and
     * would otherwise be reading somebody else's project's grants.
     */
    const props: DatabaseCommonInteractionProps = buildOnCallAdminProps({
      projectId: otherProjectId,
      userId: callerUserId,
    });

    propsSpy.mockResolvedValue({
      ...props,
      tenantId: projectId,
    } as never);

    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("the refusal happens before the body is validated", async () => {
    /*
     * An unauthorised caller must not be able to learn what this endpoint
     * accepts by watching which complaint comes back. A body that is nonsense
     * AND a caller who may not send has to fail as a permission problem.
     */
    propsSpy.mockResolvedValue(
      buildMemberProps({ projectId: projectId, userId: callerUserId }) as never,
    );

    const result: RouteCallResult = await callRoute({
      userIds: "not-even-an-array",
    } as unknown as JSONObject);

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("the GET routes are deliberately NOT tightened", async () => {
    /*
     * Only the write moved. The reads exist so that somebody inside the project
     * can see who cannot be paged, and requiring on-call administration to LOOK
     * would take the feature away from the people it was built to inform.
     */
    const readRoutes: Array<RegisteredRoute> = (
      mockRouter.routes as unknown as Array<RegisteredRoute>
    ).filter((route: RegisteredRoute): boolean => {
      return route.method === "GET";
    });

    expect(readRoutes.length).toBe(3);

    propsSpy.mockResolvedValue(
      buildMemberProps({ projectId: projectId, userId: callerUserId }) as never,
    );

    const summarySpy: jest.SpyInstance = jest
      .spyOn(OnCallReadinessService, "getReadinessForProject")
      .mockResolvedValue({
        projectId: projectId,
        readyCount: 0,
        partiallyReadyCount: 0,
        notReachableCount: 0,
        isFallbackEnabled: true,
        isTruncated: false,
        users: [],
      } as never);

    const projectRoute: RegisteredRoute | undefined = readRoutes.find(
      (route: RegisteredRoute): boolean => {
        return route.uri === "/on-call-readiness/project";
      },
    );

    const req: ExpressRequest = {
      params: {},
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

    await projectRoute!.handlerFunction(
      req,
      res,
      next as unknown as NextFunction,
    );

    // The bare member got their answer. Nothing was refused.
    expect(next).not.toHaveBeenCalled();
    expect(summarySpy).toHaveBeenCalledTimes(1);

    summarySpy.mockRestore();
  });
});

describe("OnCallReadinessAPI POST /send-setup-reminder - the body is never trusted", () => {
  test("the project comes from the authenticated tenant, not from the body", async () => {
    await callRoute({
      userIds: [userA.toString()],
      // A caller trying to redirect the send at somebody else's project.
      projectId: otherProjectId.toString(),
    });

    expect(serviceCall().projectId.toString()).toBe(projectId.toString());
  });

  test("a missing userIds field is refused", async () => {
    const result: RouteCallResult = await callRoute({});

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("an absent body is refused rather than crashing the handler", async () => {
    const result: RouteCallResult = await callRoute(undefined);

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("a userIds that is not an array is refused", async () => {
    const result: RouteCallResult = await callRoute({
      userIds: userA.toString(),
    } as unknown as JSONObject);

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("a non-string entry is refused", async () => {
    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString(), 42],
    } as unknown as JSONObject);

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("an entry that is not a UUID is refused rather than passed through as an id", async () => {
    /*
     * ObjectID's constructor accepts any string. Without this check, arbitrary
     * caller text reaches the mail-sending service and comes back looking like
     * an ordinary stale id.
     */
    const result: RouteCallResult = await callRoute({
      userIds: ["'; DROP TABLE users; --"],
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("one bad id refuses the whole request rather than silently dropping it", async () => {
    /*
     * Sending to "everyone except the one we could not parse" would be a
     * partial action reported as a complete one.
     */
    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString(), "not-a-uuid", userB.toString()],
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(sendRemindersSpy).not.toHaveBeenCalled();
  });

  test("well-formed ids reach the service in the order they were sent", async () => {
    await callRoute({
      userIds: [userA.toString(), userB.toString()],
    });

    expect(
      serviceCall().userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([userA.toString(), userB.toString()]);
  });

  test("an empty list is handed to the service, which owns that rule", async () => {
    /*
     * Deliberately NOT rejected here. The "select at least one" rule belongs to
     * the service so it holds for every caller, and duplicating it at the route
     * would let the two drift into disagreeing about what an empty request
     * means.
     */
    sendRemindersSpy.mockRejectedValue(
      new BadDataException(
        "Select at least one responder to send a setup reminder to.",
      ) as never,
    );

    const result: RouteCallResult = await callRoute({ userIds: [] });

    expect(sendRemindersSpy).toHaveBeenCalled();
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
  });
});

describe("OnCallReadinessAPI POST /send-setup-reminder - what comes back", () => {
  test("the payload carries the counts and one entry per user", async () => {
    sendRemindersSpy.mockResolvedValue({
      projectId: projectId,
      requestedCount: 2,
      sentCount: 1,
      skippedCount: 1,
      failedCount: 0,
      results: [
        {
          userId: userA,
          outcome: SetupReminderOutcome.Sent,
          message: "Reminder sent to their account email address.",
        },
        {
          userId: userB,
          outcome: SetupReminderOutcome.SkippedThrottled,
          message: "Already reminded in the last 24 hours.",
        },
      ],
    } as never);

    await callRoute({
      userIds: [userA.toString(), userB.toString()],
    });

    const payload: Record<string, unknown> = jsonPayload();

    expect(payload["requestedCount"]).toBe(2);
    expect(payload["sentCount"]).toBe(1);
    expect(payload["skippedCount"]).toBe(1);
    expect(payload["failedCount"]).toBe(0);
    expect(payload["results"]).toHaveLength(2);
  });

  test("every id crosses the wire as a plain string, never as an ObjectID envelope", async () => {
    /*
     * ObjectID.toJSON() serialises to { _type: "ObjectID", value: "..." }, which
     * is right for model payloads and wrong for a hand-rolled body. The browser
     * matches these against row ids it holds as plain strings.
     */
    await callRoute({ userIds: [userA.toString()] });

    const payload: Record<string, unknown> = jsonPayload();
    const results: Array<Record<string, unknown>> = payload["results"] as Array<
      Record<string, unknown>
    >;

    expect(typeof payload["projectId"]).toBe("string");
    expect(payload["projectId"]).toBe(projectId.toString());
    expect(typeof results[0]!["userId"]).toBe("string");
    expect(results[0]!["userId"]).toBe(userA.toString());
  });

  test("the outcome is carried as its own value, not flattened to a boolean", async () => {
    sendRemindersSpy.mockResolvedValue({
      projectId: projectId,
      requestedCount: 1,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 1,
      results: [
        {
          userId: userA,
          outcome: SetupReminderOutcome.Failed,
          message: "We could not send this reminder.",
        },
      ],
    } as never);

    await callRoute({ userIds: [userA.toString()] });

    const results: Array<Record<string, unknown>> = jsonPayload()[
      "results"
    ] as Array<Record<string, unknown>>;

    expect(results[0]!["outcome"]).toBe(SetupReminderOutcome.Failed);
    expect(results[0]!["message"]).toBe("We could not send this reminder.");
  });

  test("no email address is echoed back in the response", async () => {
    sendRemindersSpy.mockResolvedValue({
      projectId: projectId,
      requestedCount: 1,
      sentCount: 1,
      skippedCount: 0,
      failedCount: 0,
      results: [
        {
          userId: userA,
          outcome: SetupReminderOutcome.Sent,
          message: "Reminder sent to their account email address.",
        },
      ],
    } as never);

    await callRoute({ userIds: [userA.toString()] });

    const results: Array<Record<string, unknown>> = jsonPayload()[
      "results"
    ] as Array<Record<string, unknown>>;

    expect(Object.keys(results[0]!).sort()).toEqual([
      "message",
      "outcome",
      "userId",
    ]);
  });

  test("a service failure is handed to the error middleware rather than answered as success", async () => {
    sendRemindersSpy.mockRejectedValue(
      new BadDataException("Project not found.") as never,
    );

    const result: RouteCallResult = await callRoute({
      userIds: [userA.toString()],
    });

    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock.calls,
    ).toHaveLength(0);
  });
});

/*
 * Imported for its side effect: OnCallReadinessAPI registers its routes when the
 * MODULE is evaluated (it exports a bare router, not a class), so the reference
 * below is what guarantees the import is not elided as unused.
 */
describe("OnCallReadinessAPI - the router under test", () => {
  test("the module exports the router the routes were registered on", () => {
    expect(OnCallReadinessAPI).toBe(mockRouter);
  });
});
