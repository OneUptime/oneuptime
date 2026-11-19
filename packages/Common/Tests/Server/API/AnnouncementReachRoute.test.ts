import AnnouncementReachRoute from "../../../Server/API/AnnouncementReachRoute";
import CommonAPI from "../../../Server/API/CommonAPI";
import StatusPageAnnouncementAPI from "../../../Server/API/StatusPageAnnouncementAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AnnouncementReachBuilder from "../../../Server/Utils/StatusPage/AnnouncementReachBuilder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import AnnouncementReach, {
  AnnouncementReachResult,
} from "../../../Types/StatusPage/AnnouncementReach";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import UserType from "../../../Types/UserType";
import { tenantPermissionsFor } from "./PermissionRows";
/*
 * jest itself is the global one: @jest/globals types spyOn and fn as mocks
 * the global jest.SpyInstance and jest.Mock annotations here do not accept.
 */
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - POST /status-page-announcement/reach
 * (Server/API/AnnouncementReachRoute): whether an announcement on the
 * status pages picked on its form shows on one of them and notifies anyone,
 * which Create Announcement's Schedule & Notifications line says (#9775).
 *
 * The announcement API registers it on its own router, behind the session
 * guards. The handler reads the project from the request's tenant, reads
 * the pages picked (and the announcement an Edit edits) from the body,
 * hands them to the builder as the caller - who decides who may ask, for
 * the announcement - and answers the one reason, or none, as JSON, never
 * cached. Which reason is the builder's (AnnouncementReachBuilder.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");
const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const ANNOUNCEMENT: string = "d0000000-0000-4000-8000-000000000001";

type RouteFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> | void;

interface Registration {
  path: string;
  functions: Array<RouteFunction>;
}

// A router that records what is registered on it.
function recordingRouter(): {
  router: ExpressRouter;
  posts: Array<Registration>;
} {
  const posts: Array<Registration> = [];

  const router: ExpressRouter = {
    post: (path: string, ...functions: Array<RouteFunction>) => {
      posts.push({ path, functions });
    },
    get: () => {
      return undefined;
    },
  } as unknown as ExpressRouter;

  return { router, posts };
}

const MEMBER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
  userType: UserType.User,
  userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
    Permission.ProjectMember,
  ]),
};

const RESULT: AnnouncementReachResult = {
  nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
};

interface Answer {
  sent: jest.SpyInstance;
  noCache: jest.SpyInstance;
  build: jest.SpyInstance;
  next: jest.Mock;
}

/*
 * Registers the route, then runs its handler with this caller and body, as
 * Express would once the session guards let it through.
 */
async function ask(data: {
  props: DatabaseCommonInteractionProps;
  body: unknown;
  build?: () => Promise<AnnouncementReachResult>;
}): Promise<Answer> {
  const { router, posts } = recordingRouter();

  AnnouncementReachRoute.register({
    router: router,
    apiPath: "/status-page-announcement",
  });

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(data.props);

  const sent: jest.SpyInstance = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  const noCache: jest.SpyInstance = jest
    .spyOn(Response, "setNoCacheHeaders")
    .mockImplementation((() => {
      return undefined;
    }) as never);
  const build: jest.SpyInstance = jest
    .spyOn(AnnouncementReachBuilder, "build")
    .mockImplementation(
      (data.build ||
        (async (): Promise<AnnouncementReachResult> => {
          return RESULT;
        })) as never,
    );

  const next: jest.Mock = jest.fn();
  const handler: RouteFunction = posts[0]!.functions[2]!;

  await handler(
    { body: data.body } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { sent, noCache, build, next };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the announcement reach route", () => {
  it("is a POST under the announcement API's path, behind the session guards", () => {
    const { router, posts } = recordingRouter();

    AnnouncementReachRoute.register({
      router: router,
      apiPath: "/status-page-announcement",
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/status-page-announcement/reach");
    expect(posts[0]!.functions).toHaveLength(3);
    expect(posts[0]!.functions[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(posts[0]!.functions[1]).toBe(
      UserMiddleware.requireUserAuthentication,
    );
  });

  it("answers the reason, as JSON, never cached - and nothing more", async () => {
    const answer: Answer = await ask({
      props: MEMBER,
      body: { statusPageIds: [SITE_1] },
    });

    expect(answer.next).not.toHaveBeenCalled();
    expect(answer.noCache).toHaveBeenCalledTimes(1);
    expect(answer.sent).toHaveBeenCalledTimes(1);
    expect(answer.sent.mock.calls[0]![2]).toEqual(
      AnnouncementReach.toJSON(RESULT),
    );
    expect(answer.sent.mock.calls[0]![2]).toEqual({
      nothingSentReason: "NotificationsOff",
    });
  });

  it("works it out for the pages picked, in the request's project, as the caller", async () => {
    const answer: Answer = await ask({
      props: MEMBER,
      body: {
        statusPageIds: [SITE_1.toUpperCase(), SITE_2, SITE_1],
        announcementId: ANNOUNCEMENT,
      },
    });

    const asked: Record<string, any> = answer.build.mock.calls[0]![0] as never;

    expect(String(asked["projectId"])).toBe(PROJECT_ID.toString());
    expect(asked["props"]).toBe(MEMBER);
    expect(
      (asked["request"].statusPageIds as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([SITE_1, SITE_2]);
    expect(String(asked["request"].announcementId)).toBe(ANNOUNCEMENT);
  });

  it("refuses a request of no project, before anything is worked out", async () => {
    const answer: Answer = await ask({
      props: { ...MEMBER, tenantId: undefined },
      body: { statusPageIds: [SITE_1] },
    });

    expect(answer.next).toHaveBeenCalledTimes(1);
    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(answer.build).not.toHaveBeenCalled();
    expect(answer.sent).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ statusPageIds: SITE_1 }],
    [{ statusPageIds: ["not-an-id"] }],
    [{ statusPageIds: [SITE_1], announcementId: "not-an-id" }],
    [null],
  ] as Array<[unknown]>)(
    "refuses a body that does not name the pages picked by their ids: %j",
    async (body: unknown) => {
      const answer: Answer = await ask({ props: MEMBER, body: body });

      expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
      expect(answer.build).not.toHaveBeenCalled();
    },
  );

  it("passes on the builder's refusal: who may ask is the announcement's to decide", async () => {
    const answer: Answer = await ask({
      props: MEMBER,
      body: { statusPageIds: [SITE_1] },
      build: async (): Promise<AnnouncementReachResult> => {
        throw new NotAuthorizedException(
          "You do not have permissions to create Status Page Announcement.",
        );
      },
    });

    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(answer.sent).not.toHaveBeenCalled();
  });
});

describe("the announcement API", () => {
  it("registers the answer on its own path", () => {
    const register: jest.SpyInstance = jest.spyOn(
      AnnouncementReachRoute,
      "register",
    );

    const api: StatusPageAnnouncementAPI = new StatusPageAnnouncementAPI();

    expect(register).toHaveBeenCalledTimes(1);

    const registered: Record<string, unknown> = register.mock
      .calls[0]![0] as never;

    expect(registered["apiPath"]).toBe("/status-page-announcement");
    expect(registered["router"]).toBe(api.getRouter());
    expect(`/status-page-announcement${AnnouncementReach.routePath}`).toBe(
      "/status-page-announcement/reach",
    );
  });
});
