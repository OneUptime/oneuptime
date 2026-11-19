import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import PublicNoteReachRoute from "../../../Server/API/PublicNoteReachRoute";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import PublicNoteReachBuilder from "../../../Server/Utils/StatusPage/PublicNoteReachBuilder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
  PublicNoteReachEvent,
  PublicNoteReachResult,
} from "../../../Types/StatusPage/PublicNoteReach";
import UserType from "../../../Types/UserType";
import { tenantPermissionsFor } from "./PermissionRows";
/*
 * jest itself is the global one: @jest/globals types spyOn and fn as mocks
 * the global jest.SpyInstance and jest.Mock annotations here do not accept.
 */
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - POST /<event>/public-note-reach
 * (Server/API/PublicNoteReachRoute): whether a public note posted now on an
 * incident, an episode or a maintenance event is on a status page and
 * notifies anyone, which the note composer says (#9735).
 *
 * Each event's API registers it on its own router, behind the session
 * guards. The handler reads the project from the request's tenant, refuses
 * a caller who may neither post nor edit the event's public notes - before
 * it reads the body - reads the event's id from the body, and answers the
 * one reason, or none, as JSON, never cached. Which reason is the builder's
 * (PublicNoteReachBuilder.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");
const EVENT_ID: string = "a0000000-0000-4000-8000-00000000000a";

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
  } as unknown as ExpressRouter;

  return { router, posts };
}

function caller(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, permissions),
  };
}

const MEMBER: DatabaseCommonInteractionProps = caller([
  Permission.ProjectMember,
]);

const RESULT: PublicNoteReachResult = {
  nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
};

interface Answer {
  sent: jest.SpyInstance;
  noCache: jest.SpyInstance;
  build: jest.SpyInstance;
  next: jest.Mock;
}

/*
 * Registers the route for `event`, then runs its handler with this caller
 * and body, as Express would once the session guards let it through.
 */
async function ask(data: {
  event: PublicNoteReachEvent;
  props: DatabaseCommonInteractionProps;
  body: unknown;
}): Promise<Answer> {
  const { router, posts } = recordingRouter();

  PublicNoteReachRoute.register({
    router: router,
    apiPath: "/incident",
    event: data.event,
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
    .spyOn(PublicNoteReachBuilder, "build")
    .mockResolvedValue(RESULT);

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

describe("the public note reach route", () => {
  it("is a POST under the event's API path, behind the session guards", () => {
    const { router, posts } = recordingRouter();

    PublicNoteReachRoute.register({
      router: router,
      apiPath: "/scheduled-maintenance",
      event: PublicNoteReachEvent.ScheduledMaintenance,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe("/scheduled-maintenance/public-note-reach");
    expect(posts[0]!.functions).toHaveLength(3);
    expect(posts[0]!.functions[0]).toBe(UserMiddleware.getUserMiddleware);
    expect(posts[0]!.functions[1]).toBe(
      UserMiddleware.requireUserAuthentication,
    );
  });

  it("answers the reason, as JSON, never cached - and nothing more", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.Incident,
      props: MEMBER,
      body: { eventId: EVENT_ID },
    });

    expect(answer.next).not.toHaveBeenCalled();
    expect(answer.noCache).toHaveBeenCalledTimes(1);
    expect(answer.sent).toHaveBeenCalledTimes(1);
    expect(answer.sent.mock.calls[0]![2]).toEqual(
      PublicNoteReach.toJSON(RESULT),
    );
    expect(answer.sent.mock.calls[0]![2]).toEqual({
      nothingSentReason: "NotificationsOff",
    });
  });

  it("works it out for the event asked about, in the request's project, as the caller", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.IncidentEpisode,
      props: MEMBER,
      body: { eventId: EVENT_ID.toUpperCase() },
    });

    const asked: Record<string, any> = answer.build.mock.calls[0]![0] as never;

    expect(asked["event"]).toBe(PublicNoteReachEvent.IncidentEpisode);
    expect(String(asked["projectId"])).toBe(PROJECT_ID.toString());
    expect(asked["props"]).toBe(MEMBER);
    expect(String(asked["eventId"])).toBe(EVENT_ID);
  });

  it("refuses a request of no project", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.Incident,
      props: { ...MEMBER, tenantId: undefined },
      body: { eventId: EVENT_ID },
    });

    expect(answer.next).toHaveBeenCalledTimes(1);
    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
    expect(answer.build).not.toHaveBeenCalled();
    expect(answer.sent).not.toHaveBeenCalled();
  });

  it.each([
    [PublicNoteReachEvent.Incident, Permission.CreateIncidentPublicNote],
    [PublicNoteReachEvent.Incident, Permission.EditIncidentPublicNote],
    [
      PublicNoteReachEvent.IncidentEpisode,
      Permission.CreateIncidentEpisodePublicNote,
    ],
    [
      PublicNoteReachEvent.IncidentEpisode,
      Permission.EditIncidentEpisodePublicNote,
    ],
    [
      PublicNoteReachEvent.ScheduledMaintenance,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    [
      PublicNoteReachEvent.ScheduledMaintenance,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  ] as Array<[PublicNoteReachEvent, Permission]>)(
    "a %s's answer is open to whoever holds %s: they post or edit its public notes",
    async (event: PublicNoteReachEvent, permission: Permission) => {
      const answer: Answer = await ask({
        event: event,
        props: caller([permission]),
        body: { eventId: EVENT_ID },
      });

      expect(answer.next).not.toHaveBeenCalled();
      expect(answer.sent).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [PublicNoteReachEvent.Incident, Permission.ReadIncidentPublicNote],
    [
      PublicNoteReachEvent.Incident,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    [PublicNoteReachEvent.IncidentEpisode, Permission.CreateIncidentPublicNote],
    [
      PublicNoteReachEvent.ScheduledMaintenance,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    [
      PublicNoteReachEvent.ScheduledMaintenance,
      Permission.CreateIncidentPublicNote,
    ],
  ] as Array<[PublicNoteReachEvent, Permission]>)(
    "refuses a %s's answer to a caller holding only %s, before reading the body",
    async (event: PublicNoteReachEvent, permission: Permission) => {
      const parse: jest.SpyInstance = jest.spyOn(
        PublicNoteReachBuilder,
        "parseEventId",
      );

      const answer: Answer = await ask({
        event: event,
        props: caller([permission]),
        body: { eventId: EVENT_ID },
      });

      expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
        NotAuthorizedException,
      );
      expect(parse).not.toHaveBeenCalled();
      expect(answer.build).not.toHaveBeenCalled();
      expect(answer.sent).not.toHaveBeenCalled();
    },
  );

  it("refuses a caller whose only grant is blocked", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.Incident,
      props: {
        ...MEMBER,
        userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
          {
            _type: "UserPermission",
            permission: Permission.CreateIncidentPublicNote,
            labelIds: [],
            isBlockPermission: true,
          } as never,
        ]),
      },
      body: { eventId: EVENT_ID },
    });

    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(answer.build).not.toHaveBeenCalled();
  });

  it("lets a master admin ask", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.ScheduledMaintenance,
      props: {
        tenantId: PROJECT_ID,
        userId: USER_ID,
        userType: UserType.User,
        isMasterAdmin: true,
      },
      body: { eventId: EVENT_ID },
    });

    expect(answer.next).not.toHaveBeenCalled();
    expect(answer.sent).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{}],
    [{ eventId: "" }],
    [{ eventId: "not-an-id" }],
    [{ eventId: 42 }],
    [{ eventId: [EVENT_ID] }],
    [null],
    ["eventId"],
  ] as Array<[unknown]>)(
    "refuses a body that names no event: %j",
    async (body: unknown) => {
      const answer: Answer = await ask({
        event: PublicNoteReachEvent.Incident,
        props: MEMBER,
        body: body,
      });

      expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(BadDataException);
      expect(answer.build).not.toHaveBeenCalled();
    },
  );

  /*
   * A project API key is admitted like a member, its permissions deciding:
   * automation may ask too.
   */
  it("admits a project API key that may post the event's public notes", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.IncidentEpisode,
      props: {
        tenantId: PROJECT_ID,
        userType: UserType.API,
        apiKeyId: new ObjectID("60000000-0000-4000-8000-000000000001"),
        userTenantAccessPermission: tenantPermissionsFor(PROJECT_ID, [
          Permission.CreateIncidentEpisodePublicNote,
        ]),
      },
      body: { eventId: EVENT_ID },
    });

    expect(answer.next).not.toHaveBeenCalled();
    expect(answer.sent).toHaveBeenCalledTimes(1);
  });
});

describe("each event's API", () => {
  it.each([
    ["IncidentAPI", "/incident", PublicNoteReachEvent.Incident],
    [
      "IncidentEpisodeAPI",
      "/incident-episode",
      PublicNoteReachEvent.IncidentEpisode,
    ],
    [
      "ScheduledMaintenanceAPI",
      "/scheduled-maintenance",
      PublicNoteReachEvent.ScheduledMaintenance,
    ],
  ] as Array<[string, string, PublicNoteReachEvent]>)(
    "%s registers the answer for its own event, on its own path",
    (name: string, apiPath: string, event: PublicNoteReachEvent) => {
      const register: jest.SpyInstance = jest.spyOn(
        PublicNoteReachRoute,
        "register",
      );

      const api: { getRouter: () => ExpressRouter } =
        name === "IncidentAPI"
          ? new IncidentAPI()
          : name === "IncidentEpisodeAPI"
            ? new IncidentEpisodeAPI()
            : new ScheduledMaintenanceAPI();

      expect(register).toHaveBeenCalledTimes(1);

      const registered: Record<string, unknown> = register.mock
        .calls[0]![0] as never;

      expect(registered["apiPath"]).toBe(apiPath);
      expect(registered["event"]).toBe(event);
      expect(registered["router"]).toBe(api.getRouter());

      // The route the dashboard's note kinds ask through.
      expect(`${apiPath}${PublicNoteReach.routePath}`).toBe(
        `${apiPath}/public-note-reach`,
      );
    },
  );
});
