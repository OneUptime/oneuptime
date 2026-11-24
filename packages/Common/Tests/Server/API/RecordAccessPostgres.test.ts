/*
 * Must stay the first import: the Dashboard's client builds its API URL from
 * HOST when UI/Config loads. `npm run test` exports HOST from config.env, and
 * the Postgres Schema Drift job, which runs this suite, has no config.env:
 * with no HOST the URL is http:///api, whose "api" a URL parser reads as the
 * host, and every request missed the routes served under /api.
 */
import "../../UI/Utils/API/DashboardHost";
import BaseAPI from "../../../Server/API/BaseAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import URL from "../../../Types/API/URL";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import RecordAccess, {
  RecordAccessKind,
  RecordAccessOperation,
  RecordAccessRefusalReason,
  RecordAccessResult,
  RecordAccessVerdict,
} from "../../../Types/RecordAccess/RecordAccess";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { fetchRecordAccess } from "../../../../App/FeatureSet/Dashboard/src/Components/RecordAccess/RecordAccessApi";
import { getJestSpyOn } from "../../Spy";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import { DataSource } from "typeorm";

/*
 * WHAT THE READER MAY DO ON AN INCIDENT, AGAINST THE SERVER'S REAL RULE ON
 * A MIGRATED POSTGRES (#10272).
 *
 * An incident's page asks once, as it opens, what the reader may do on it
 * (GET /incident/record-access/:id), and locks what the answer refuses.
 * Here the Dashboard's own request (fetchRecordAccess) goes over HTTP
 * (DashboardRequestsOverHttp) through the real user middleware - which
 * reads the reader's teams and their permission rows, labels and scopes
 * from the tables below - the real route, RecordAccessBuilder, the
 * permission layer, the query serializer and TypeORM, for each kind of
 * reader the rule weighs a record for:
 *
 *   - a Project Owner and a Project Admin: everything, everywhere;
 *   - a permission limited to labels (#10191's customer: Edit Incident
 *     Member on the incidents labelled Payments);
 *   - a permission limited to the incidents the reader or their team owns;
 *   - a team's block on one label;
 *   - a private incident, owned by a team of the reader's that may only
 *     view it, and changed through another team.
 *
 * And the answer is held to what the server then does: the writes it
 * allows go through the same routes, and the ones it refuses are refused,
 * with nothing written.
 *
 * Opt in with RUN_POSTGRES_RECORD_ACCESS_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RECORD_ACCESS_TESTS=true \
 *   RECORD_ACCESS_TEST_DATABASE_HOST=127.0.0.1 \
 *   RECORD_ACCESS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/RecordAccessPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is
 * dropped afterwards; every row is synthetic. Workflows, live updates, the
 * audit log and feed entries are stubbed.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RECORD_ACCESS_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

jest.mock("isolated-vm", () => {
  return {};
});

jest.setTimeout(10 * 60 * 1000);

// The tables this suite writes; every other table is read from public.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "Incident",
  "IncidentLabel",
  "IncidentOwnerUser",
  "IncidentOwnerTeam",
  "IncidentInternalNote",
  "IncidentMember",
  "IncidentRole",
  "IncidentFeed",
  "IncidentState",
  "IncidentStateTimeline",
];

interface PermissionRow {
  permission: Permission;
  scope?: PermissionScope;
  labelIds?: Array<ObjectID>;
  isBlock?: boolean;
}

describePostgres(
  "what the reader may do on an incident, against the real rule on Postgres",
  () => {
    const schema: string = `record_access_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let server: DashboardRequestsOverHttp;

    const projectId: ObjectID = ObjectID.generate();

    // The reader; the commander every incident starts with; who it goes to.
    const readerId: ObjectID = ObjectID.generate();
    const holderId: ObjectID = ObjectID.generate();
    const nextHolderId: ObjectID = ObjectID.generate();

    // The reader's teams, and a team of the others.
    const teamAId: ObjectID = ObjectID.generate();
    const teamBId: ObjectID = ObjectID.generate();
    const peopleTeamId: ObjectID = ObjectID.generate();

    const paymentsLabelId: ObjectID = ObjectID.generate();
    const searchLabelId: ObjectID = ObjectID.generate();

    const commanderRoleId: ObjectID = ObjectID.generate();
    const responderRoleId: ObjectID = ObjectID.generate();
    const identifiedStateId: ObjectID = ObjectID.generate();

    interface IncidentFixture {
      key: string;
      id: ObjectID;
      commanderRowId: ObjectID;
      noteId: ObjectID;
      labelIds: Array<ObjectID>;
      isPrivate: boolean;
      ownedByReader: boolean;
      ownerTeamIds: Array<ObjectID>;
    }

    const incident: (
      key: string,
      data: Omit<IncidentFixture, "key" | "id" | "commanderRowId" | "noteId">,
    ) => IncidentFixture = (
      key: string,
      data: Omit<IncidentFixture, "key" | "id" | "commanderRowId" | "noteId">,
    ): IncidentFixture => {
      return {
        key: key,
        id: ObjectID.generate(),
        commanderRowId: ObjectID.generate(),
        noteId: ObjectID.generate(),
        ...data,
      };
    };

    const PAYMENTS: IncidentFixture = incident("labelled Payments", {
      labelIds: [paymentsLabelId],
      isPrivate: false,
      ownedByReader: false,
      ownerTeamIds: [],
    });
    const SEARCH: IncidentFixture = incident("labelled Search", {
      labelIds: [searchLabelId],
      isPrivate: false,
      ownedByReader: false,
      ownerTeamIds: [],
    });
    const OWNED: IncidentFixture = incident("owned by the reader", {
      labelIds: [],
      isPrivate: false,
      ownedByReader: true,
      ownerTeamIds: [],
    });
    const TEAM_OWNED: IncidentFixture = incident("owned by Team A", {
      labelIds: [],
      isPrivate: false,
      ownedByReader: false,
      ownerTeamIds: [teamAId],
    });
    const PRIVATE: IncidentFixture = incident("private, owned by Team B", {
      labelIds: [],
      isPrivate: true,
      ownedByReader: false,
      ownerTeamIds: [teamBId],
    });

    const INCIDENTS: Array<IncidentFixture> = [
      PAYMENTS,
      SEARCH,
      OWNED,
      TEAM_OWNED,
      PRIVATE,
    ];

    const insert: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          const value: unknown = row[column];
          return value instanceof ObjectID ? value.toString() : value;
        }),
      );
    };

    const countRows: (
      table: string,
      where: string,
      values: Array<unknown>,
    ) => Promise<number> = async (
      table: string,
      where: string,
      values: Array<unknown>,
    ): Promise<number> => {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."${table}" WHERE ${where}`,
        values,
      );

      return Number(rows[0]?.count || 0);
    };

    // Every incident as the fixtures have it, made again from nothing.
    const seedIncidents: () => Promise<void> = async (): Promise<void> => {
      for (const table of [
        "IncidentStateTimeline",
        "IncidentFeed",
        "IncidentInternalNote",
        "IncidentMember",
        "IncidentOwnerUser",
        "IncidentOwnerTeam",
        "IncidentLabel",
        "Incident",
      ]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      for (const fixture of INCIDENTS) {
        await insert("Incident", {
          _id: fixture.id,
          projectId: projectId,
          title: fixture.key,
          slug: fixture.id.toString(),
          currentIncidentStateId: identifiedStateId,
          incidentSeverityId: ObjectID.generate(),
          isPrivate: fixture.isPrivate,
          version: 1,
        });

        for (const labelId of fixture.labelIds) {
          await insert("IncidentLabel", {
            incidentId: fixture.id,
            labelId: labelId,
          });
        }

        if (fixture.ownedByReader) {
          await insert("IncidentOwnerUser", {
            _id: ObjectID.generate(),
            projectId: projectId,
            incidentId: fixture.id,
            userId: readerId,
            version: 1,
          });
        }

        for (const teamId of fixture.ownerTeamIds) {
          await insert("IncidentOwnerTeam", {
            _id: ObjectID.generate(),
            projectId: projectId,
            incidentId: fixture.id,
            teamId: teamId,
            version: 1,
          });
        }

        await insert("IncidentMember", {
          _id: fixture.commanderRowId,
          projectId: projectId,
          incidentId: fixture.id,
          userId: holderId,
          incidentRoleId: commanderRoleId,
          isMemberNotified: true,
          version: 1,
        });

        await insert("IncidentInternalNote", {
          _id: fixture.noteId,
          projectId: projectId,
          incidentId: fixture.id,
          note: "Rolled back the deploy.",
          version: 1,
        });
      }
    };

    // A team's permission rows, replaced.
    const setTeamPermissions: (
      teamId: ObjectID,
      rows: Array<PermissionRow>,
    ) => Promise<void> = async (
      teamId: ObjectID,
      rows: Array<PermissionRow>,
    ): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermissionLabel" WHERE "teamPermissionId" IN (SELECT "_id" FROM "${schema}"."TeamPermission" WHERE "teamId" = $1)`,
        [teamId.toString()],
      );
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [teamId.toString()],
      );

      for (const row of rows) {
        const id: ObjectID = ObjectID.generate();

        await insert("TeamPermission", {
          _id: id,
          projectId: projectId,
          teamId: teamId,
          permission: row.permission,
          isBlockPermission: Boolean(row.isBlock),
          scope:
            row.scope ||
            (!row.isBlock && row.labelIds && row.labelIds.length > 0
              ? PermissionScope.Labels
              : PermissionScope.All),
          version: 1,
        });

        for (const labelId of row.labelIds || []) {
          await insert("TeamPermissionLabel", {
            teamPermissionId: id,
            labelId: labelId,
          });
        }
      }
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["RECORD_ACCESS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["RECORD_ACCESS_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RECORD_ACCESS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );

      // The session token names the reader; it is not a signed token here.
      getJestSpyOn(JSONWebToken, "decode").mockImplementation(((
        token: string,
      ): JSONWebTokenData => {
        return {
          userId: new ObjectID(token),
          isMasterAdmin: false,
          isGlobalLogin: true,
        } as JSONWebTokenData;
      }) as never);

      // Permissions are read from the tables every time: nothing is cached.
      getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(
        null as never,
      );
      getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
        undefined as never,
      );

      getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(UserService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(ProjectService, "getRequireSsoForLogin").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(ProjectService, "isProjectBlocked").mockResolvedValue(
        false as never,
      );
      getJestSpyOn(
        GlobalConfigService,
        "getRequireSsoForLogin",
      ).mockResolvedValue(false as never);

      // Workflows, live updates, the audit log and feeds run elsewhere.
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerRealtime",
      ).mockResolvedValue(undefined as never);

      for (const service of [
        IncidentService,
        IncidentMemberService,
        IncidentInternalNoteService,
      ] as Array<DatabaseService<BaseModel>>) {
        getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
          undefined as never,
        );
        getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
          undefined as never,
        );
      }
      getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordDelete").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(
        IncidentService,
        "getIncidentLinkInDashboard",
      ).mockResolvedValue(
        URL.fromString("https://oneuptime.example/incident") as never,
      );
      getJestSpyOn(
        IncidentFeedService,
        "createIncidentFeedItem",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        WorkspaceNotificationRuleService,
        "getNotificationRulesWhereInviteRolesIsTrue",
      ).mockResolvedValue([] as never);
      getJestSpyOn(
        WorkspaceNotificationRuleService,
        "inviteUsersBasedOnRulesAndWorkspaceChannels",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        IncidentService,
        "getWorkspaceChannelForIncident",
      ).mockResolvedValue([] as never);

      // The Dashboard's requests carry the reader's project...
      getJestSpyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
        tenantid: projectId.toString(),
      } as never);

      await insert("Project", {
        _id: projectId,
        name: "Acme Commerce",
        slug: projectId.toString(),
        version: 1,
      });

      for (const [id, name] of [
        [readerId, "Ana Lima"],
        [holderId, "Maya Chen"],
        [nextHolderId, "Jordan Patel"],
      ] as Array<[ObjectID, string]>) {
        await insert("User", {
          _id: id,
          name: name,
          email: `${id.toString()}@example.com`,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [teamId, name] of [
        [teamAId, "Team A"],
        [teamBId, "Team B"],
        [peopleTeamId, "Responders"],
      ] as Array<[ObjectID, string]>) {
        await insert("Team", {
          _id: teamId,
          projectId: projectId,
          name: name,
          slug: teamId.toString(),
          version: 1,
        });
      }

      // The reader is on Team A and Team B; the others are project members.
      for (const [teamId, userId] of [
        [teamAId, readerId],
        [teamBId, readerId],
        [peopleTeamId, holderId],
        [peopleTeamId, nextHolderId],
      ] as Array<[ObjectID, ObjectID]>) {
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: projectId,
          teamId: teamId,
          userId: userId,
          hasAcceptedInvitation: true,
          version: 1,
        });
      }

      for (const [labelId, name] of [
        [paymentsLabelId, "Payments"],
        [searchLabelId, "Search"],
      ] as Array<[ObjectID, string]>) {
        await insert("Label", {
          _id: labelId,
          projectId: projectId,
          name: name,
          slug: labelId.toString(),
          color: "#000000",
          version: 1,
        });
      }

      for (const [roleId, name, isPrimary] of [
        [commanderRoleId, "Incident Commander", true],
        [responderRoleId, "Responder", false],
      ] as Array<[ObjectID, string, boolean]>) {
        await insert("IncidentRole", {
          _id: roleId,
          projectId: projectId,
          name: name,
          slug: roleId.toString(),
          color: "#000000",
          isPrimaryRole: isPrimary,
          canAssignMultipleUsers: !isPrimary,
          version: 1,
        });
      }

      await insert("IncidentState", {
        _id: identifiedStateId,
        projectId: projectId,
        name: "Identified",
        slug: identifiedStateId.toString(),
        color: "#000000",
        order: 1,
        isCreatedState: true,
        isAcknowledgedState: false,
        isResolvedState: false,
        version: 1,
      });

      /*
       * ...and their session: the reader's, as the browser's cookie carries
       * it. The bridge sends no header of the client's, so the two are set
       * as each request arrives, before the user middleware reads them.
       */
      const session: ExpressRouter =
        express.Router() as unknown as ExpressRouter;

      session.use(
        (req: ExpressRequest, _res: ExpressResponse, next: NextFunction) => {
          req.headers["authorization"] = `Bearer ${readerId.toString()}`;
          req.headers["tenantid"] = projectId.toString();
          next();
        },
      );

      server = new DashboardRequestsOverHttp();
      await server.start([
        session,
        new IncidentAPI().getRouter(),
        new BaseAPI<IncidentMember, DatabaseService<BaseModel>>(
          IncidentMember,
          IncidentMemberService as unknown as DatabaseService<BaseModel>,
        ).getRouter(),
        new BaseAPI<IncidentInternalNote, DatabaseService<BaseModel>>(
          IncidentInternalNote,
          IncidentInternalNoteService as unknown as DatabaseService<BaseModel>,
        ).getRouter(),
      ]);
    });

    beforeEach(async () => {
      server.requests.length = 0;
      await seedIncidents();
      await setTeamPermissions(teamAId, []);
      await setTeamPermissions(teamBId, []);
    });

    afterAll(async () => {
      await server?.stop();
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    // The answer for an incident, as the Dashboard asks it and reads it.
    const answerFor: (
      fixture: IncidentFixture,
    ) => Promise<RecordAccessResult> = async (
      fixture: IncidentFixture,
    ): Promise<RecordAccessResult> => {
      return await fetchRecordAccess({
        kind: RecordAccessKind.Incident,
        recordId: fixture.id,
      });
    };

    const verdictOf: (
      result: RecordAccessResult,
      table: string,
      operation: RecordAccessOperation,
    ) => RecordAccessVerdict | null = (
      result: RecordAccessResult,
      table: string,
      operation: RecordAccessOperation,
    ): RecordAccessVerdict | null => {
      return RecordAccess.getVerdict(result, table, operation);
    };

    const isAllowed: (
      result: RecordAccessResult,
      table: string,
      operation: RecordAccessOperation,
    ) => boolean = (
      result: RecordAccessResult,
      table: string,
      operation: RecordAccessOperation,
    ): boolean => {
      const verdict: RecordAccessVerdict | null = verdictOf(
        result,
        table,
        operation,
      );

      expect(verdict).not.toBeNull();
      return Boolean(verdict?.isAllowed);
    };

    // The writes the answer is held to, through the same routes, as the page sends them.
    const handCommanderOn: (
      fixture: IncidentFixture,
    ) => Promise<boolean> = async (
      fixture: IncidentFixture,
    ): Promise<boolean> => {
      const sent: SentRequest = await server.request(
        "PUT",
        `/api/incident-member/${fixture.commanderRowId.toString()}`,
        { data: { userId: nextHolderId.toString() } },
      );

      const isMade: boolean =
        (await countRows("IncidentMember", `"_id" = $1 AND "userId" = $2`, [
          fixture.commanderRowId.toString(),
          nextHolderId.toString(),
        ])) === 1;

      expect(sent.status === 200).toBe(isMade);
      return isMade;
    };

    const removeCommander: (
      fixture: IncidentFixture,
    ) => Promise<boolean> = async (
      fixture: IncidentFixture,
    ): Promise<boolean> => {
      const sent: SentRequest = await server.request(
        "DELETE",
        `/api/incident-member/${fixture.commanderRowId.toString()}`,
      );

      const isMade: boolean =
        (await countRows(
          "IncidentMember",
          `"_id" = $1 AND "deletedAt" IS NULL`,
          [fixture.commanderRowId.toString()],
        )) === 0;

      expect(sent.status === 200).toBe(isMade);
      return isMade;
    };

    const giveResponderRole: (
      fixture: IncidentFixture,
    ) => Promise<boolean> = async (
      fixture: IncidentFixture,
    ): Promise<boolean> => {
      const sent: SentRequest = await server.request(
        "POST",
        "/api/incident-member",
        {
          data: {
            incidentId: fixture.id.toString(),
            projectId: projectId.toString(),
            userId: nextHolderId.toString(),
            incidentRoleId: responderRoleId.toString(),
          },
        },
      );

      const isMade: boolean =
        (await countRows(
          "IncidentMember",
          `"incidentId" = $1 AND "userId" = $2 AND "incidentRoleId" = $3`,
          [
            fixture.id.toString(),
            nextHolderId.toString(),
            responderRoleId.toString(),
          ],
        )) === 1;

      expect(sent.status === 200).toBe(isMade);
      return isMade;
    };

    const addNote: (fixture: IncidentFixture) => Promise<boolean> = async (
      fixture: IncidentFixture,
    ): Promise<boolean> => {
      const text: string = `Note ${ObjectID.generate().toString()}`;

      const sent: SentRequest = await server.request(
        "POST",
        "/api/incident-internal-note",
        {
          data: {
            incidentId: fixture.id.toString(),
            projectId: projectId.toString(),
            note: text,
          },
        },
      );

      const isMade: boolean =
        (await countRows("IncidentInternalNote", `"note" = $1`, [text])) > 0;

      expect(sent.status === 200).toBe(isMade);
      return isMade;
    };

    /*
     * What the answer says of the roles and notes, held to what the server
     * does with the same writes: every write it allows is made, every one it
     * refuses is not. Each write on an incident seeded afresh.
     */
    const expectAnswerHeldToWrites: (
      fixture: IncidentFixture,
    ) => Promise<void> = async (fixture: IncidentFixture): Promise<void> => {
      const result: RecordAccessResult = await answerFor(fixture);

      for (const [table, operation, write] of [
        ["IncidentMember", RecordAccessOperation.Update, handCommanderOn],
        ["IncidentMember", RecordAccessOperation.Delete, removeCommander],
        ["IncidentMember", RecordAccessOperation.Create, giveResponderRole],
        ["IncidentInternalNote", RecordAccessOperation.Create, addNote],
      ] as Array<
        [
          string,
          RecordAccessOperation,
          (f: IncidentFixture) => Promise<boolean>,
        ]
      >) {
        await seedIncidents();

        expect({
          incident: fixture.key,
          table: table,
          operation: operation,
          made: await write(fixture),
        }).toEqual({
          incident: fixture.key,
          table: table,
          operation: operation,
          made: isAllowed(result, table, operation),
        });
      }
    };

    describe("a Project Owner and a Project Admin may do everything, on every incident", () => {
      test.each([
        ["Project Owner", Permission.ProjectOwner],
        ["Project Admin", Permission.ProjectAdmin],
      ])("%s", async (_name: string, permission: Permission) => {
        await setTeamPermissions(teamAId, [{ permission: permission }]);

        for (const fixture of INCIDENTS) {
          const result: RecordAccessResult = await answerFor(fixture);

          for (const [table, verdicts] of Object.entries(result.tables)) {
            for (const [operation, verdict] of Object.entries(verdicts)) {
              expect({
                incident: fixture.key,
                table: table,
                operation: operation,
                isAllowed: verdict!.isAllowed,
              }).toEqual({
                incident: fixture.key,
                table: table,
                operation: operation,
                isAllowed: true,
              });
            }
          }

          // The incident and its roles were weighed, not left out.
          expect(
            verdictOf(result, "Incident", RecordAccessOperation.Update),
          ).toEqual(RecordAccess.allowed());
          expect(
            verdictOf(result, "IncidentMember", RecordAccessOperation.Update),
          ).toEqual(RecordAccess.allowed());
        }
      });
    });

    describe("a permission limited to labels: #10191's customer", () => {
      beforeEach(async () => {
        await setTeamPermissions(teamAId, [
          { permission: Permission.Viewer },
          {
            permission: Permission.CreateIncidentMember,
            labelIds: [paymentsLabelId],
          },
          {
            permission: Permission.EditIncidentMember,
            labelIds: [paymentsLabelId],
          },
          {
            permission: Permission.DeleteIncidentMember,
            labelIds: [paymentsLabelId],
          },
        ]);
      });

      test("on an incident labelled Payments: the roles are theirs to change", async () => {
        const result: RecordAccessResult = await answerFor(PAYMENTS);

        for (const operation of [
          RecordAccessOperation.Create,
          RecordAccessOperation.Update,
          RecordAccessOperation.Delete,
        ]) {
          expect(verdictOf(result, "IncidentMember", operation)).toEqual(
            RecordAccess.allowed(),
          );
        }

        // Nothing else of the incident is theirs to change.
        expect(
          verdictOf(result, "Incident", RecordAccessOperation.Update),
        ).toEqual(RecordAccess.refused(RecordAccessRefusalReason.Permission));
      });

      test("on an incident labelled Search: refused, because their permission is limited to the incidents labelled Payments", async () => {
        const result: RecordAccessResult = await answerFor(SEARCH);

        for (const operation of [
          RecordAccessOperation.Create,
          RecordAccessOperation.Update,
          RecordAccessOperation.Delete,
        ]) {
          expect(verdictOf(result, "IncidentMember", operation)).toEqual(
            RecordAccess.refused(RecordAccessRefusalReason.Labels, {
              labelNames: ["Payments"],
            }),
          );
        }
      });

      test.each([
        ["labelled Payments", PAYMENTS],
        ["labelled Search", SEARCH],
      ])(
        "on the incident %s, the answer is what the server then does",
        async (_name: string, fixture: IncidentFixture) => {
          await expectAnswerHeldToWrites(fixture);
        },
      );
    });

    describe("a permission limited to the incidents the reader or their team owns", () => {
      beforeEach(async () => {
        await setTeamPermissions(teamAId, [
          { permission: Permission.Viewer },
          {
            permission: Permission.EditProjectIncident,
            scope: PermissionScope.Owned,
          },
        ]);
      });

      test.each([
        ["one the reader owns", OWNED],
        ["one their team owns", TEAM_OWNED],
      ])(
        "the incident is theirs to change on %s",
        async (_name: string, fixture: IncidentFixture) => {
          const result: RecordAccessResult = await answerFor(fixture);

          expect(
            verdictOf(result, "Incident", RecordAccessOperation.Update),
          ).toEqual(RecordAccess.allowed());
        },
      );

      test("refused on one neither owns, because their permission is limited to owned incidents", async () => {
        const result: RecordAccessResult = await answerFor(SEARCH);

        expect(
          verdictOf(result, "Incident", RecordAccessOperation.Update),
        ).toEqual(RecordAccess.refused(RecordAccessRefusalReason.Owned));
      });
    });

    describe("a team's block on one label", () => {
      beforeEach(async () => {
        await setTeamPermissions(teamAId, [
          { permission: Permission.ProjectMember },
          {
            permission: Permission.EditIncidentMember,
            labelIds: [paymentsLabelId],
            isBlock: true,
          },
        ]);
      });

      test("on an incident carrying the label: handing a role on is refused, because a team blocks it there", async () => {
        const result: RecordAccessResult = await answerFor(PAYMENTS);

        expect(
          verdictOf(result, "IncidentMember", RecordAccessOperation.Update),
        ).toEqual(
          RecordAccess.refused(RecordAccessRefusalReason.BlockedLabels, {
            labelNames: ["Payments"],
          }),
        );
        // What the block does not name stays theirs.
        expect(
          verdictOf(result, "IncidentMember", RecordAccessOperation.Create),
        ).toEqual(RecordAccess.allowed());
        expect(
          verdictOf(result, "Incident", RecordAccessOperation.Update),
        ).toEqual(RecordAccess.allowed());
      });

      test("on an incident without it: allowed", async () => {
        const result: RecordAccessResult = await answerFor(SEARCH);

        expect(
          verdictOf(result, "IncidentMember", RecordAccessOperation.Update),
        ).toEqual(RecordAccess.allowed());
      });

      test.each([
        ["labelled Payments", PAYMENTS],
        ["labelled Search", SEARCH],
      ])(
        "on the incident %s, the answer is what the server then does",
        async (_name: string, fixture: IncidentFixture) => {
          await expectAnswerHeldToWrites(fixture);
        },
      );
    });

    describe("a private incident is changed only through the teams that own it", () => {
      beforeEach(async () => {
        // Team A may change every incident; Team B, which owns it, only views.
        await setTeamPermissions(teamAId, [
          { permission: Permission.ProjectMember },
        ]);
        await setTeamPermissions(teamBId, [{ permission: Permission.Viewer }]);
      });

      test("the reader sees it through Team B, and may change none of it: it is private, and Team B may not", async () => {
        const result: RecordAccessResult = await answerFor(PRIVATE);

        for (const [table, operation] of [
          ["Incident", RecordAccessOperation.Update],
          ["IncidentMember", RecordAccessOperation.Update],
          ["IncidentMember", RecordAccessOperation.Create],
          ["IncidentInternalNote", RecordAccessOperation.Create],
        ] as Array<[string, RecordAccessOperation]>) {
          expect({
            table: table,
            operation: operation,
            verdict: verdictOf(result, table, operation),
          }).toEqual({
            table: table,
            operation: operation,
            verdict: RecordAccess.refused(RecordAccessRefusalReason.Private, {
              teamNames: ["Team B"],
            }),
          });
        }
      });

      test("a public incident is changed through Team A, as before", async () => {
        const result: RecordAccessResult = await answerFor(SEARCH);

        expect(
          verdictOf(result, "Incident", RecordAccessOperation.Update),
        ).toEqual(RecordAccess.allowed());
      });

      test("the answer is what the server then does", async () => {
        await expectAnswerHeldToWrites(PRIVATE);
      });
    });
  },
);
