import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import PublicNoteReachRoute from "../../../Server/API/PublicNoteReachRoute";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import { UnreadableParentException } from "../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import CallerPermission from "../../../Server/Utils/Permission/CallerPermission";
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
 * guards. The handler reads the project from the request's tenant and the
 * event's id from the body, refuses a caller who may neither post a public
 * note on that event nor edit one it has - decided for the event, by the
 * note's own create and update checks, never by the note table alone
 * (TableHalfWriteGuard) - and answers the one reason, or none, as JSON,
 * never cached. Which reason is the builder's (PublicNoteReachBuilder.test.ts).
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

interface NoteChecks {
  // The note's create, asked without creating it (checkCallerMayCreate).
  mayCreate: jest.SpyInstance;
  // The rows an update of the note table reaches (getUpdatableQuery).
  updatable: jest.SpyInstance;
  // The read of one of those rows: a note the event has.
  noteRead: jest.SpyInstance;
}

interface Answer {
  sent: jest.SpyInstance;
  noCache: jest.SpyInstance;
  build: jest.SpyInstance;
  next: jest.Mock;
  checks: NoteChecks;
}

/*
 * The note's own checks, stood in for, as they read the project's plan, the
 * event's labels and owners and the caller's grants: its create, asked
 * without creating it (DatabaseService.checkCallerMayCreate), passes a
 * caller who holds one of the note table's create permissions, and the rows
 * an update reaches (ModelPermission.getUpdatableQuery) are there for one
 * who holds one of its update permissions - a team's block no grant - each
 * refusing anyone else, as they would. The event has a public note.
 */
function standInForNoteChecks(event: PublicNoteReachEvent): NoteChecks {
  const service: DatabaseService<BaseModel> =
    PublicNoteReachBuilder.getNoteService(event);
  const note: BaseModel = new service.modelType();

  const mayCreate: jest.SpyInstance = jest
    .spyOn(service, "checkCallerMayCreate")
    .mockImplementation((async (args: {
      props: DatabaseCommonInteractionProps;
    }): Promise<void> => {
      if (
        !CallerPermission.holdsAnyOf(args.props, note.getCreatePermissions())
      ) {
        throw new NotAuthorizedException(
          `You do not have permission to create ${note.singularName}.`,
        );
      }
    }) as never);

  const updatable: jest.SpyInstance = jest
    .spyOn(ModelPermission, "getUpdatableQuery")
    .mockImplementation((async (
      _modelType: unknown,
      query: Query<BaseModel>,
      props: DatabaseCommonInteractionProps,
    ): Promise<Query<BaseModel>> => {
      if (!CallerPermission.holdsAnyOf(props, note.getUpdatePermissions())) {
        throw new NotAuthorizedException(
          `You do not have permission to update ${note.singularName}.`,
        );
      }

      return query;
    }) as never);

  const noteRead: jest.SpyInstance = jest
    .spyOn(service, "findOneBy")
    .mockResolvedValue(note as never);

  return { mayCreate, updatable, noteRead };
}

/*
 * Registers the route for `event`, then runs its handler with this caller
 * and body, as Express would once the session guards let it through. The
 * note's checks are stood in for (standInForNoteChecks), and `arrange` may
 * change what they answer first.
 */
async function ask(data: {
  event: PublicNoteReachEvent;
  props: DatabaseCommonInteractionProps;
  body: unknown;
  arrange?: ((checks: NoteChecks) => void) | undefined;
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

  const checks: NoteChecks = standInForNoteChecks(data.event);
  data.arrange?.(checks);

  const next: jest.Mock = jest.fn();
  const handler: RouteFunction = posts[0]!.functions[2]!;

  await handler(
    { body: data.body } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  return { sent, noCache, build, next, checks };
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
    "refuses a %s's answer to a caller holding only %s, before working anything out",
    async (event: PublicNoteReachEvent, permission: Permission) => {
      const answer: Answer = await ask({
        event: event,
        props: caller([permission]),
        body: { eventId: EVENT_ID },
      });

      expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
        NotAuthorizedException,
      );
      expect(answer.next.mock.calls[0]![0].message).toMatch(
        /^You do not have permission to see where this (incident|episode|maintenance event)'s public notes are shown\. You need a permission that lets you post or edit them\.$/,
      );
      expect(answer.build).not.toHaveBeenCalled();
      expect(answer.sent).not.toHaveBeenCalled();
    },
  );

  /*
   * Decided for the event asked about, never by the note table alone
   * (TableHalfWriteGuard): a grant limited to labels the event does not
   * carry, or to records nobody on the caller's teams owns, does not reach
   * it - which the note's own checks weigh, given the event.
   */
  it.each([
    [PublicNoteReachEvent.Incident, "incidentId"],
    [PublicNoteReachEvent.IncidentEpisode, "incidentEpisodeId"],
    [PublicNoteReachEvent.ScheduledMaintenance, "scheduledMaintenanceId"],
  ] as Array<[PublicNoteReachEvent, string]>)(
    "a %s's answer asks the note's own create of a note on that event, by %s, as the caller",
    async (event: PublicNoteReachEvent, column: string) => {
      const answer: Answer = await ask({
        event: event,
        props: MEMBER,
        body: { eventId: EVENT_ID },
      });

      expect(answer.next).not.toHaveBeenCalled();
      expect(answer.checks.mayCreate).toHaveBeenCalledTimes(1);

      const asked: { data: BaseModel; props: DatabaseCommonInteractionProps } =
        answer.checks.mayCreate.mock.calls[0]![0] as never;

      expect(asked.props).toBe(MEMBER);
      expect(asked.data).toBeInstanceOf(
        PublicNoteReachBuilder.getNoteService(event).modelType,
      );
      expect(String(asked.data.getColumnValue("projectId"))).toBe(
        PROJECT_ID.toString(),
      );
      expect(String(asked.data.getColumnValue(column))).toBe(EVENT_ID);
      // Nothing is asked of the edit once the post is allowed.
      expect(answer.checks.updatable).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      PublicNoteReachEvent.Incident,
      Permission.EditIncidentPublicNote,
      "incidentId",
    ],
    [
      PublicNoteReachEvent.IncidentEpisode,
      Permission.EditIncidentEpisodePublicNote,
      "incidentEpisodeId",
    ],
    [
      PublicNoteReachEvent.ScheduledMaintenance,
      Permission.EditScheduledMaintenancePublicNote,
      "scheduledMaintenanceId",
    ],
  ] as Array<[PublicNoteReachEvent, Permission, string]>)(
    "a %s's editor who may not post (%s) is asked for a note of that event among the rows their edit reaches",
    async (
      event: PublicNoteReachEvent,
      permission: Permission,
      column: string,
    ) => {
      const props: DatabaseCommonInteractionProps = caller([permission]);

      const answer: Answer = await ask({
        event: event,
        props: props,
        body: { eventId: EVENT_ID },
      });

      expect(answer.next).not.toHaveBeenCalled();
      expect(answer.sent).toHaveBeenCalledTimes(1);

      // getUpdatableQuery(modelType, query, props).
      const asked: [unknown, Record<string, unknown>, unknown] = answer.checks
        .updatable.mock.calls[0]! as never;

      expect(asked[0]).toBe(
        PublicNoteReachBuilder.getNoteService(event).modelType,
      );
      expect(String(asked[1]["projectId"])).toBe(PROJECT_ID.toString());
      expect(String(asked[1][column])).toBe(EVENT_ID);
      expect(asked[2]).toBe(props);

      // The rows found are only those the caller's edit reaches.
      const read: { query: unknown } = answer.checks.noteRead.mock
        .calls[0]![0] as never;
      expect(read.query).toBe(
        await answer.checks.updatable.mock.results[0]!.value,
      );
    },
  );

  it("refuses an editor whose edit reaches none of the event's notes, or an event with none", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.Incident,
      props: caller([Permission.EditIncidentPublicNote]),
      body: { eventId: EVENT_ID },
      arrange: (checks: NoteChecks) => {
        checks.noteRead.mockResolvedValue(null as never);
      },
    });

    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(answer.build).not.toHaveBeenCalled();
  });

  /*
   * A create under an event the caller may not read is refused as under
   * one that is not there (UnreadableParentException): the answer is the
   * same refusal, never whether the event exists.
   */
  it("refuses an event the caller may not read, as one that is not there", async () => {
    const answer: Answer = await ask({
      event: PublicNoteReachEvent.Incident,
      props: MEMBER,
      body: { eventId: EVENT_ID },
      arrange: (checks: NoteChecks) => {
        checks.mayCreate.mockRejectedValue(
          new UnreadableParentException(
            "Incident was not found in this project.",
          ) as never,
        );
        checks.noteRead.mockResolvedValue(null as never);
      },
    });

    expect(answer.next.mock.calls[0]![0]).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(answer.next.mock.calls[0]![0]).not.toBeInstanceOf(
      UnreadableParentException,
    );
    expect(answer.build).not.toHaveBeenCalled();
  });

  it("passes on a failure that is no refusal", async () => {
    const failure: Error = new Error("The database is not answering.");

    const answer: Answer = await ask({
      event: PublicNoteReachEvent.Incident,
      props: MEMBER,
      body: { eventId: EVENT_ID },
      arrange: (checks: NoteChecks) => {
        checks.mayCreate.mockRejectedValue(failure as never);
      },
    });

    expect(answer.next.mock.calls[0]![0]).toBe(failure);
    expect(answer.build).not.toHaveBeenCalled();
  });

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

  it("lets a master admin ask, asking nothing of the note's checks", async () => {
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
    expect(answer.checks.mayCreate).not.toHaveBeenCalled();
    expect(answer.checks.updatable).not.toHaveBeenCalled();
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
      expect(answer.checks.mayCreate).not.toHaveBeenCalled();
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
