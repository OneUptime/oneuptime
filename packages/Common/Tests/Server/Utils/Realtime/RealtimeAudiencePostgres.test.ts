import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IO from "../../../../Server/Infrastructure/SocketIO";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import AIConversationMessageService from "../../../../Server/Services/AIConversationMessageService";
import AIInsightService from "../../../../Server/Services/AIInsightService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentService from "../../../../Server/Services/IncidentService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import Realtime from "../../../../Server/Utils/Realtime";
import RealtimeReaders, {
  RealtimeReaderIdentity,
} from "../../../../Server/Utils/Realtime/RealtimeReaders";
import { RealtimeReadAccess } from "../../../../Server/Utils/Realtime/RealtimeReadAccess";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import ModelEventType from "../../../../Types/Realtime/ModelEventType";
import UserType from "../../../../Types/UserType";
import RealtimeUtil from "../../../../Utils/Realtime";
import { DataSource } from "typeorm";

/*
 * LIVE UPDATES AGAINST A MIGRATED POSTGRES: each listener hears about
 * exactly the records their own read finds.
 *
 * One project, its people and their permissions, records that carry labels,
 * owners and the private flag, an AI insight that names a labelled service,
 * and a person's own AI conversation. For each person listening, the events
 * Realtime sends - through its real queue, audience and the services' real
 * reads - are compared with the records that person's read of the same
 * table finds, and with what the rules say it should find:
 *
 *   - a project-wide reader hears about everything (no read per record);
 *   - a grant limited to labels hears about records carrying them;
 *   - an Owned grant hears about the records they or their teams own;
 *   - a block with labels takes the records carrying them away, and a
 *     label-less record that names such a record (an insight about a
 *     blocked service) with them;
 *   - a private incident is heard about by its owners and the project's
 *     owners and admins only;
 *   - an AI conversation's messages by the person who had it only;
 *   - a delete is heard about by those who could read the record before it
 *     went.
 *
 * Opt in with RUN_POSTGRES_REALTIME_AUDIENCE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_REALTIME_AUDIENCE_TESTS=true \
 *   REALTIME_AUDIENCE_TEST_DATABASE_HOST=127.0.0.1 \
 *   REALTIME_AUDIENCE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Realtime/RealtimeAudiencePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after that
 * job has applied every registered migration to an empty database.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_REALTIME_AUDIENCE_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../../Server/Infrastructure/SocketIO", () => {
  return {
    __esModule: true,
    default: {
      getSocketServer: jest.fn(),
    },
  };
});

interface FakeSocket {
  id: string;
  rooms: Set<string>;
  data: Record<string, unknown>;
  received: Array<{ event: string; modelId: string }>;
}

// socket.io's server, as far as Realtime uses it (see RealtimeDelivery.test.ts).
class FakeSocketServer {
  public sockets: Array<FakeSocket> = [];

  public on(): void {
    // Connections are not modelled here.
  }

  public in(rooms: string | Array<string>): {
    fetchSockets: () => Promise<Array<FakeSocket>>;
  } {
    const wanted: Array<string> = Array.isArray(rooms) ? rooms : [rooms];

    return {
      fetchSockets: async (): Promise<Array<FakeSocket>> => {
        return this.sockets.filter((socket: FakeSocket): boolean => {
          return wanted.some((room: string): boolean => {
            return socket.rooms.has(room);
          });
        });
      },
    };
  }

  public to(target: string | Array<string>): {
    emit: (event: string, payload: JSONObject) => void;
  } {
    const targets: Array<string> = Array.isArray(target) ? target : [target];

    return {
      emit: (event: string, payload: JSONObject): void => {
        for (const socket of this.sockets) {
          if (
            targets.length === 0 ||
            targets.some((room: string): boolean => {
              return socket.rooms.has(room);
            })
          ) {
            socket.received.push({
              event: event,
              modelId: String(payload["modelId"]).toLowerCase(),
            });
          }
        }
      },
    };
  }

  public listen(userId: string, room: string): FakeSocket {
    const id: string = `socket-${this.sockets.length + 1}`;
    const socket: FakeSocket = {
      id: id,
      rooms: new Set<string>([id, room]),
      data: { realtimeReader: { userId: userId, isMasterAdmin: false } },
      received: [],
    };

    this.sockets.push(socket);
    return socket;
  }
}

function id(): string {
  return ObjectID.generate().toString();
}

describePostgres("live updates against a migrated Postgres", () => {
  let database: DataSource;
  const server: FakeSocketServer = new FakeSocketServer();

  const projectId: string = id();
  const users: Array<string> = [];

  // The people, by what they hold.
  const OWNER: string = id();
  const MEMBER: string = id();
  const LABELS_READER: string = id();
  const OWNED_READER: string = id();
  const TEAM_READER: string = id();
  const BLOCKED_READER: string = id();
  const PRIVATE_OWNER: string = id();
  const AI_AUTHOR: string = id();

  const RED: string = id();
  const BLUE: string = id();
  const TEAM: string = id();

  // The records.
  const I_RED: string = id();
  const I_BLUE: string = id();
  const I_PLAIN: string = id();
  const I_OWNED: string = id();
  const I_TEAM: string = id();
  const I_PRIVATE: string = id();
  const INCIDENTS: Array<string> = [
    I_RED,
    I_BLUE,
    I_PLAIN,
    I_OWNED,
    I_TEAM,
    I_PRIVATE,
  ];

  const BLUE_SERVICE: string = id();
  const INSIGHT_ON_BLUE_SERVICE: string = id();
  const INSIGHT_PLAIN: string = id();

  const CONVERSATION: string = id();
  const MESSAGE_OF_AUTHOR: string = id();
  const MESSAGE_OF_OWNER: string = id();

  function row(
    permission: Permission,
    options: {
      scope?: PermissionScope;
      labelIds?: Array<string>;
      isBlock?: boolean;
    } = {},
  ): UserPermission {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: (options.labelIds || []).map((labelId: string) => {
        return new ObjectID(labelId);
      }),
      isBlockPermission: Boolean(options.isBlock),
      scope: options.scope,
    };
  }

  // What each person's requests would carry in the project.
  const PERMISSIONS: Map<
    string,
    { rows: Array<UserPermission>; teamIds: Array<string> }
  > = new Map([
    [
      OWNER,
      {
        rows: [row(Permission.ProjectOwner, { scope: PermissionScope.All })],
        teamIds: [],
      },
    ],
    [
      MEMBER,
      {
        rows: [row(Permission.ProjectMember, { scope: PermissionScope.All })],
        teamIds: [],
      },
    ],
    [
      LABELS_READER,
      {
        rows: [
          row(Permission.ProjectMember, {
            scope: PermissionScope.Labels,
            labelIds: [RED],
          }),
        ],
        teamIds: [],
      },
    ],
    [
      OWNED_READER,
      {
        rows: [row(Permission.ProjectMember, { scope: PermissionScope.Owned })],
        teamIds: [],
      },
    ],
    [
      TEAM_READER,
      {
        rows: [row(Permission.ProjectMember, { scope: PermissionScope.Owned })],
        teamIds: [TEAM],
      },
    ],
    [
      BLOCKED_READER,
      {
        rows: [
          row(Permission.ProjectMember, { scope: PermissionScope.All }),
          row(Permission.ProjectMember, { labelIds: [BLUE], isBlock: true }),
        ],
        teamIds: [],
      },
    ],
    [
      PRIVATE_OWNER,
      {
        rows: [row(Permission.ProjectMember, { scope: PermissionScope.All })],
        teamIds: [],
      },
    ],
    [
      AI_AUTHOR,
      {
        rows: [row(Permission.ProjectMember, { scope: PermissionScope.All })],
        teamIds: [],
      },
    ],
  ]);

  function propsOf(userId: string): DatabaseCommonInteractionProps {
    const held: { rows: Array<UserPermission>; teamIds: Array<string> } =
      PERMISSIONS.get(userId)!;

    return {
      userId: new ObjectID(userId),
      userType: UserType.User,
      tenantId: new ObjectID(projectId),
      userTenantAccessPermission: {
        [projectId]: {
          _type: "UserTenantAccessPermission",
          projectId: new ObjectID(projectId),
          permissions: [
            row(Permission.CurrentUser),
            row(Permission.ProjectUser),
            ...held.rows,
          ],
        },
      },
      userTeamIds: held.teamIds.map((teamId: string) => {
        return new ObjectID(teamId);
      }),
      currentPlan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    };
  }

  async function insertUser(userId: string): Promise<void> {
    users.push(userId);
    await database.query(
      `INSERT INTO "User" ("_id","email","slug","version") VALUES ($1,$2,$3,1)`,
      [userId, `realtime-${userId}@example.com`, `s${userId}`],
    );
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["REALTIME_AUDIENCE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["REALTIME_AUDIENCE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["REALTIME_AUDIENCE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      synchronize: false,
    });
    await database.initialize();

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    (IO.getSocketServer as unknown as jest.Mock).mockReturnValue(server);
    await Realtime.init();

    for (const userId of PERMISSIONS.keys()) {
      await insertUser(userId);
    }

    await database.query(
      `INSERT INTO "Project" ("_id","name","slug","version") VALUES ($1,'Realtime',$2,1)`,
      [projectId, `s${projectId}`],
    );

    for (const [labelId, name] of [
      [RED, "Red"],
      [BLUE, "Blue"],
    ]) {
      await database.query(
        `INSERT INTO "Label" ("_id","projectId","name","slug","color","version") VALUES ($1,$2,$3,$4,'#ff0000',1)`,
        [labelId, projectId, name, `s${labelId}`],
      );
    }

    await database.query(
      `INSERT INTO "Team" ("_id","projectId","name","slug","version") VALUES ($1,$2,'On call',$3,1)`,
      [TEAM, projectId, `s${TEAM}`],
    );
    await database.query(
      `INSERT INTO "TeamMember" ("_id","projectId","teamId","userId","hasAcceptedInvitation","version") VALUES ($1,$2,$3,$4,true,1)`,
      [id(), projectId, TEAM, TEAM_READER],
    );

    const stateId: string = id();
    const severityId: string = id();
    await database.query(
      `INSERT INTO "IncidentState" ("_id","projectId","name","color","order","slug","version") VALUES ($1,$2,'Open','#fff',1,$3,1)`,
      [stateId, projectId, `s${stateId}`],
    );
    await database.query(
      `INSERT INTO "IncidentSeverity" ("_id","projectId","name","slug","color","order","version") VALUES ($1,$2,'High',$3,'#fff',1,1)`,
      [severityId, projectId, `s${severityId}`],
    );

    const insertIncident: (
      incidentId: string,
      isPrivate: boolean,
      labelIds: Array<string>,
    ) => Promise<void> = async (
      incidentId: string,
      isPrivate: boolean,
      labelIds: Array<string>,
    ): Promise<void> => {
      await database.query(
        `INSERT INTO "Incident" ("_id","projectId","title","currentIncidentStateId","incidentSeverityId","isPrivate","slug","version") VALUES ($1,$2,'An incident',$3,$4,$5,$6,1)`,
        [
          incidentId,
          projectId,
          stateId,
          severityId,
          isPrivate,
          `s${incidentId}`,
        ],
      );

      for (const labelId of labelIds) {
        await database.query(
          `INSERT INTO "IncidentLabel" ("incidentId","labelId") VALUES ($1,$2)`,
          [incidentId, labelId],
        );
      }
    };

    await insertIncident(I_RED, false, [RED]);
    await insertIncident(I_BLUE, false, [BLUE]);
    await insertIncident(I_PLAIN, false, []);
    await insertIncident(I_OWNED, false, []);
    await insertIncident(I_TEAM, false, [BLUE]);
    await insertIncident(I_PRIVATE, true, [RED]);

    await database.query(
      `INSERT INTO "IncidentOwnerUser" ("_id","projectId","userId","incidentId","version") VALUES ($1,$2,$3,$4,1)`,
      [id(), projectId, OWNED_READER, I_OWNED],
    );
    await database.query(
      `INSERT INTO "IncidentOwnerTeam" ("_id","projectId","teamId","incidentId","version") VALUES ($1,$2,$3,$4,1)`,
      [id(), projectId, TEAM, I_TEAM],
    );
    await database.query(
      `INSERT INTO "IncidentOwnerUser" ("_id","projectId","userId","incidentId","version") VALUES ($1,$2,$3,$4,1)`,
      [id(), projectId, PRIVATE_OWNER, I_PRIVATE],
    );

    // An insight about a service that carries a label, and one about nothing.
    await database.query(
      `INSERT INTO "Service" ("_id","projectId","name","slug","version") VALUES ($1,$2,'Checkout',$3,1)`,
      [BLUE_SERVICE, projectId, `s${BLUE_SERVICE}`],
    );
    await database.query(
      `INSERT INTO "ServiceLabel" ("serviceId","labelId") VALUES ($1,$2)`,
      [BLUE_SERVICE, BLUE],
    );

    for (const [insightId, serviceId] of [
      [INSIGHT_ON_BLUE_SERVICE, BLUE_SERVICE],
      [INSIGHT_PLAIN, null],
    ]) {
      await database.query(
        `INSERT INTO "AIInsight" ("_id","projectId","insightType","status","severity","fingerprint","title","detailMarkdown","firstSeenAt","lastSeenAt","telemetryServiceId","version") VALUES ($1,$2,'NewException','Open','Medium',$3,'An insight','Details',now(),now(),$4,1)`,
        [insightId, projectId, `f${insightId}`, serviceId],
      );
    }

    // A conversation, with a message of its author and one of the owner.
    await database.query(
      `INSERT INTO "AIConversation" ("_id","projectId","createdByUserId","version") VALUES ($1,$2,$3,1)`,
      [CONVERSATION, projectId, AI_AUTHOR],
    );

    for (const [messageId, userId] of [
      [MESSAGE_OF_AUTHOR, AI_AUTHOR],
      [MESSAGE_OF_OWNER, OWNER],
    ]) {
      await database.query(
        `INSERT INTO "AIConversationMessage" ("_id","projectId","conversationId","userId","role","version") VALUES ($1,$2,$3,$4,'User',1)`,
        [messageId, projectId, CONVERSATION, userId],
      );
    }
  }, 120_000);

  let buildProps: jest.SpyInstance | null = null;

  beforeEach(() => {
    server.sockets = [];
    RealtimeReaders.clear();

    buildProps = jest
      .spyOn(RealtimeReaders, "buildProps")
      .mockImplementation(
        async (
          identity: RealtimeReaderIdentity,
        ): Promise<DatabaseCommonInteractionProps | null> => {
          return PERMISSIONS.has(identity.userId)
            ? propsOf(identity.userId)
            : null;
        },
      );
  });

  afterEach(async () => {
    await Realtime.waitForPendingDeliveries();
    buildProps?.mockRestore();
    buildProps = null;
  });

  /*
   * Deleting a project, or a user, checks every table that can name one -
   * hundreds of foreign keys - which takes most of a minute on a migrated
   * database, more than a hook is given by default.
   */
  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DELETE FROM "Project" WHERE "_id" = $1`, [
        projectId,
      ]);
      await database.query(`DELETE FROM "User" WHERE "_id" = ANY($1)`, [users]);
      await database.destroy();
    }
  }, 300_000);

  // Every person listening for a kind of event of a table.
  function everyoneListensTo(room: string): Map<string, FakeSocket> {
    const sockets: Map<string, FakeSocket> = new Map<string, FakeSocket>();

    for (const userId of PERMISSIONS.keys()) {
      sockets.set(userId, server.listen(userId, room));
    }

    return sockets;
  }

  function heard(socket: FakeSocket): Array<string> {
    return socket.received
      .map((received: { modelId: string }): string => {
        return received.modelId;
      })
      .sort();
  }

  function sorted(ids: Array<string>): Array<string> {
    return ids
      .map((value: string): string => {
        return value.toLowerCase();
      })
      .sort();
  }

  // What the person's own read of the table finds, of `ids`.
  async function readBy(
    service: DatabaseService<BaseModel>,
    userId: string,
    ids: Array<string>,
  ): Promise<Array<string>> {
    try {
      const rows: Array<BaseModel> = await service.findBy({
        query: { _id: QueryHelper.any(ids) },
        select: { _id: true },
        skip: 0,
        limit: 100,
        props: propsOf(userId),
      });

      return sorted(
        rows.map((found: BaseModel): string => {
          return found.id!.toString();
        }),
      );
    } catch {
      return [];
    }
  }

  async function emitAll(
    service: DatabaseService<BaseModel>,
    ids: Array<string>,
    eventType: ModelEventType,
  ): Promise<void> {
    for (const recordId of ids) {
      await service.onTriggerRealtime(
        new ObjectID(recordId),
        new ObjectID(projectId),
        eventType,
      );
    }

    await Realtime.waitForPendingDeliveries();
  }

  describe("incidents: labels, owners, blocks with labels and private records", () => {
    const EXPECTED: Array<[string, string, Array<string>]> = [
      ["a project owner (project-wide)", OWNER, INCIDENTS],
      [
        "a project member (project-wide, not the private one)",
        MEMBER,
        [I_RED, I_BLUE, I_PLAIN, I_OWNED, I_TEAM],
      ],
      ["a member granted for the Red label only", LABELS_READER, [I_RED]],
      ["a member granted for what they own", OWNED_READER, [I_OWNED]],
      ["a member granted for what their team owns", TEAM_READER, [I_TEAM]],
      [
        "a member with a block on the Blue label",
        BLOCKED_READER,
        [I_RED, I_PLAIN, I_OWNED],
      ],
      ["the private incident's owner", PRIVATE_OWNER, INCIDENTS],
      [
        "a member with nothing of their own",
        AI_AUTHOR,
        [I_RED, I_BLUE, I_PLAIN, I_OWNED, I_TEAM],
      ],
    ];

    test.each(EXPECTED)(
      "%s hears about exactly the incidents their read finds",
      async (_who: string, userId: string, expected: Array<string>) => {
        const sockets: Map<string, FakeSocket> = everyoneListensTo(
          RealtimeUtil.getRoomId(
            projectId,
            new Incident().tableName!,
            ModelEventType.Update,
          ),
        );

        await emitAll(
          IncidentService as unknown as DatabaseService<BaseModel>,
          INCIDENTS,
          ModelEventType.Update,
        );

        expect(heard(sockets.get(userId)!)).toEqual(sorted(expected));
        expect(heard(sockets.get(userId)!)).toEqual(
          await readBy(
            IncidentService as unknown as DatabaseService<BaseModel>,
            userId,
            INCIDENTS,
          ),
        );
      },
    );

    test("only those who read every incident skip the read: project owners", async () => {
      const readsEvery: Map<string, boolean> = new Map<string, boolean>();

      for (const userId of PERMISSIONS.keys()) {
        readsEvery.set(
          userId,
          await IncidentService.readsEveryRecordInProject(propsOf(userId)),
        );
      }

      expect(readsEvery.get(OWNER)).toBe(true);

      for (const userId of [
        MEMBER,
        LABELS_READER,
        OWNED_READER,
        TEAM_READER,
        BLOCKED_READER,
        PRIVATE_OWNER,
      ]) {
        expect([userId, readsEvery.get(userId)]).toEqual([userId, false]);
      }
    });

    test("a delete is heard about by those who could read the incident before it went", async () => {
      const deleted: Array<string> = [I_BLUE, I_PRIVATE];
      const sockets: Map<string, FakeSocket> = everyoneListensTo(
        RealtimeUtil.getRoomId(
          projectId,
          new Incident().tableName!,
          ModelEventType.Delete,
        ),
      );

      const before: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >();

      for (const userId of PERMISSIONS.keys()) {
        before.set(
          userId,
          await readBy(
            IncidentService as unknown as DatabaseService<BaseModel>,
            userId,
            deleted,
          ),
        );
      }

      const decided: RealtimeReadAccess = await Realtime.snapshotReadAccess({
        tenantId: projectId,
        modelType: Incident,
        modelIds: deleted.map((recordId: string) => {
          return new ObjectID(recordId);
        }),
        access: IncidentService.getRealtimeReadAccess(),
      });

      await database.query(`DELETE FROM "Incident" WHERE "_id" = ANY($1)`, [
        deleted,
      ]);

      for (const recordId of deleted) {
        await IncidentService.onTriggerRealtime(
          new ObjectID(recordId),
          new ObjectID(projectId),
          ModelEventType.Delete,
          { access: decided },
        );
      }

      await Realtime.waitForPendingDeliveries();

      for (const [userId, socket] of sockets) {
        expect([userId, heard(socket)]).toEqual([userId, before.get(userId)]);
      }

      // The owner heard about both; a Blue-blocked member about neither.
      expect(heard(sockets.get(OWNER)!)).toEqual(sorted(deleted));
      expect(heard(sockets.get(BLOCKED_READER)!)).toEqual([]);
      expect(heard(sockets.get(PRIVATE_OWNER)!)).toEqual(sorted(deleted));
      expect(heard(sockets.get(MEMBER)!)).toEqual(sorted([I_BLUE]));
    });
  });

  describe("a record with no labels of its own", () => {
    const INSIGHTS: Array<string> = [INSIGHT_ON_BLUE_SERVICE, INSIGHT_PLAIN];

    test.each([
      ["a project owner", OWNER, INSIGHTS],
      ["a project member", MEMBER, INSIGHTS],
      ["a member granted for the Red label only", LABELS_READER, INSIGHTS],
      ["a member granted for what they own", OWNED_READER, INSIGHTS],
      [
        "a member with a block on the Blue label: not the insight about the Blue service",
        BLOCKED_READER,
        [INSIGHT_PLAIN],
      ],
    ] as Array<[string, string, Array<string>]>)(
      "%s hears about exactly the insights their read finds",
      async (_who: string, userId: string, expected: Array<string>) => {
        const sockets: Map<string, FakeSocket> = everyoneListensTo(
          RealtimeUtil.getRoomId(projectId, "AIInsight", ModelEventType.Create),
        );

        await emitAll(
          AIInsightService as unknown as DatabaseService<BaseModel>,
          INSIGHTS,
          ModelEventType.Create,
        );

        expect(heard(sockets.get(userId)!)).toEqual(sorted(expected));
        expect(heard(sockets.get(userId)!)).toEqual(
          await readBy(
            AIInsightService as unknown as DatabaseService<BaseModel>,
            userId,
            INSIGHTS,
          ),
        );
      },
    );
  });

  describe("a person's own AI conversation", () => {
    const MESSAGES: Array<string> = [MESSAGE_OF_AUTHOR, MESSAGE_OF_OWNER];

    test.each([
      ["the person who wrote it", AI_AUTHOR, [MESSAGE_OF_AUTHOR]],
      [
        "even a project owner, for messages not theirs",
        OWNER,
        [MESSAGE_OF_OWNER],
      ],
      ["anyone else", MEMBER, []],
    ] as Array<[string, string, Array<string>]>)(
      "%s hears about exactly their own messages",
      async (_who: string, userId: string, expected: Array<string>) => {
        const sockets: Map<string, FakeSocket> = everyoneListensTo(
          RealtimeUtil.getRoomId(
            projectId,
            "AIConversationMessage",
            ModelEventType.Create,
          ),
        );

        await emitAll(
          AIConversationMessageService as unknown as DatabaseService<BaseModel>,
          MESSAGES,
          ModelEventType.Create,
        );

        expect(heard(sockets.get(userId)!)).toEqual(sorted(expected));
      },
    );
  });
});
