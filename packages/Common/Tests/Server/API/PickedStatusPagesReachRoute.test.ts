import CommonAPI from "../../../Server/API/CommonAPI";
import PickedStatusPagesReachRoute from "../../../Server/API/PickedStatusPagesReachRoute";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import ScheduledMaintenanceTemplateAPI from "../../../Server/API/ScheduledMaintenanceTemplateAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import PickedStatusPagesReachBuilder from "../../../Server/Utils/StatusPage/PickedStatusPagesReachBuilder";
import {
  SCHEDULED_MAINTENANCE_RECORD,
  SCHEDULED_MAINTENANCE_TEMPLATE_RECORD,
} from "../../../Server/Utils/StatusPage/ScheduledMaintenanceReachBuilder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "../../../Types/StatusPage/PickedStatusPagesReach";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import UserType from "../../../Types/UserType";
import { tenantPermissionsFor } from "./PermissionRows";
/*
 * jest itself is the global one: @jest/globals types spyOn and fn as mocks
 * the global jest.SpyInstance and jest.Mock annotations here do not accept.
 */
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - POST /scheduled-maintenance/reach and
 * /scheduled-maintenance-template/reach (Server/API
 * /PickedStatusPagesReachRoute): whether a maintenance event, or an event
 * made from a maintenance template, on the status pages picked on its form
 * shows on one of them and notifies anyone, which their Subscriber
 * Notifications line says (#9920). The route every form that picks its
 * status pages asks - an announcement's too (AnnouncementReachRoute.test).
 *
 * Each API registers it on its own router, behind the session guards. The
 * handler reads the project from the request's tenant, reads the pages
 * picked (and the record an Edit edits, under its own key) from the body,
 * hands them to the builder as the caller - who decides who may ask, for
 * the record - and answers the one reason, or none, as JSON, never cached.
 * Which reason is the builder's (ScheduledMaintenanceReachBuilder.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");
const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const RECORD: string = "e0000000-0000-4000-8000-000000000001";

type RouteFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void> | void;

interface Registration {
  path: string;
  functions: Array<RouteFunction>;
}

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

const RESULT: PickedStatusPagesReachResult = {
  nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
};

interface Answer {
  sent: jest.SpyInstance;
  noCache: jest.SpyInstance;
  build: jest.SpyInstance;
  next: jest.Mock;
}

const KINDS: Array<{
  name: string;
  apiPath: string;
  recordIdKey: string;
  kind:
    | typeof SCHEDULED_MAINTENANCE_RECORD
    | typeof SCHEDULED_MAINTENANCE_TEMPLATE_RECORD;
}> = [
  {
    name: "a maintenance event",
    apiPath: "/scheduled-maintenance",
    recordIdKey: "scheduledMaintenanceId",
    kind: SCHEDULED_MAINTENANCE_RECORD,
  },
  {
    name: "a maintenance template",
    apiPath: "/scheduled-maintenance-template",
    recordIdKey: "scheduledMaintenanceTemplateId",
    kind: SCHEDULED_MAINTENANCE_TEMPLATE_RECORD,
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "the reach route of $name",
  (each: (typeof KINDS)[number]) => {
    async function ask(data: {
      props: DatabaseCommonInteractionProps;
      body: unknown;
      build?: () => Promise<PickedStatusPagesReachResult>;
    }): Promise<Answer> {
      const { router, posts } = recordingRouter();

      PickedStatusPagesReachRoute.register({
        router: router,
        apiPath: each.apiPath,
        answer: PickedStatusPagesReachRoute.answerFor(each.kind),
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
        .spyOn(PickedStatusPagesReachBuilder, "build")
        .mockImplementation(
          (data.build ||
            (async (): Promise<PickedStatusPagesReachResult> => {
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

    it("is a POST under the API's own path, behind the session guards", () => {
      const { router, posts } = recordingRouter();

      PickedStatusPagesReachRoute.register({
        router: router,
        apiPath: each.apiPath,
        answer: PickedStatusPagesReachRoute.answerFor(each.kind),
      });

      expect(posts).toHaveLength(1);
      expect(posts[0]!.path).toBe(`${each.apiPath}/reach`);
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
        PickedStatusPagesReach.toJSON(RESULT),
      );
      expect(answer.sent.mock.calls[0]![2]).toEqual({
        nothingSentReason: "NotificationsOff",
      });
    });

    it("works it out for the pages picked, in the request's project, as the caller, for this kind", async () => {
      const answer: Answer = await ask({
        props: MEMBER,
        body: {
          statusPageIds: [SITE_1.toUpperCase(), SITE_2, SITE_1],
          [each.recordIdKey]: RECORD,
        },
      });

      const asked: Record<string, any> = answer.build.mock
        .calls[0]![0] as never;

      expect(String(asked["projectId"])).toBe(PROJECT_ID.toString());
      expect(asked["props"]).toBe(MEMBER);
      expect(asked["kind"]).toBe(each.kind);
      expect(
        (asked["request"].statusPageIds as Array<ObjectID>).map(
          (id: ObjectID): string => {
            return id.toString();
          },
        ),
      ).toEqual([SITE_1, SITE_2]);
      expect(String(asked["request"].recordId)).toBe(RECORD);
    });

    it("refuses a request of no project, before anything is worked out", async () => {
      const answer: Answer = await ask({
        props: { ...MEMBER, tenantId: undefined },
        body: { statusPageIds: [SITE_1] },
      });

      expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
      expect(answer.build).not.toHaveBeenCalled();
      expect(answer.sent).not.toHaveBeenCalled();
    });

    it.each([
      [{}],
      [{ statusPageIds: SITE_1 }],
      [{ statusPageIds: ["not-an-id"] }],
      [null],
    ] as Array<[unknown]>)(
      "refuses a body that does not name the pages picked by their ids: %j",
      async (body: unknown) => {
        const answer: Answer = await ask({ props: MEMBER, body: body });

        expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
        expect(answer.build).not.toHaveBeenCalled();
      },
    );

    it("refuses a record named by something that is not an id", async () => {
      const answer: Answer = await ask({
        props: MEMBER,
        body: { statusPageIds: [SITE_1], [each.recordIdKey]: "not-an-id" },
      });

      expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
      expect(answer.build).not.toHaveBeenCalled();
    });

    it("passes on the builder's refusal: who may ask is the record's to decide", async () => {
      const answer: Answer = await ask({
        props: MEMBER,
        body: { statusPageIds: [SITE_1] },
        build: async (): Promise<PickedStatusPagesReachResult> => {
          throw new NotAuthorizedException(
            "You do not have permissions to create Scheduled Maintenance.",
          );
        },
      });

      expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
        NotAuthorizedException,
      );
      expect(answer.sent).not.toHaveBeenCalled();
    });
  },
);

describe("the maintenance APIs", () => {
  it.each([
    [
      "the maintenance event's",
      (): { getRouter: () => ExpressRouter } => {
        return new ScheduledMaintenanceAPI();
      },
      "/scheduled-maintenance",
      SCHEDULED_MAINTENANCE_RECORD,
    ],
    [
      "the maintenance template's",
      (): { getRouter: () => ExpressRouter } => {
        return new ScheduledMaintenanceTemplateAPI();
      },
      "/scheduled-maintenance-template",
      SCHEDULED_MAINTENANCE_TEMPLATE_RECORD,
    ],
  ] as Array<
    [
      string,
      () => { getRouter: () => ExpressRouter },
      string,
      typeof SCHEDULED_MAINTENANCE_RECORD,
    ]
  >)(
    "%s registers the answer on its own path, for its own kind",
    (
      _name: string,
      create: () => { getRouter: () => ExpressRouter },
      apiPath: string,
      kind: typeof SCHEDULED_MAINTENANCE_RECORD,
    ) => {
      const register: jest.SpyInstance = jest.spyOn(
        PickedStatusPagesReachRoute,
        "register",
      );
      const answerFor: jest.SpyInstance = jest.spyOn(
        PickedStatusPagesReachRoute,
        "answerFor",
      );

      const api: { getRouter: () => ExpressRouter } = create();

      expect(register).toHaveBeenCalledTimes(1);

      const registered: Record<string, unknown> = register.mock
        .calls[0]![0] as never;

      expect(registered["apiPath"]).toBe(apiPath);
      expect(registered["router"]).toBe(api.getRouter());
      expect(answerFor).toHaveBeenCalledWith(kind);
      expect(`${apiPath}${PickedStatusPagesReach.routePath}`).toBe(
        `${apiPath}/reach`,
      );
    },
  );
});
