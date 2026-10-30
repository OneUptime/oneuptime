import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import URL from "../../../Types/API/URL";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A PRIVATE INCIDENT IS CHANGED ONLY THROUGH THE TEAMS THAT OWN IT, against a
 * migrated Postgres - through the routes BaseAPI registers over the
 * production services, the real user middleware (which reads the member's
 * teams and their permission rows from the tables below), the real
 * permission pipeline, query serializer and TypeORM.
 *
 * Reported by the maintainer (block 33): Test User 2, a member of Team 1 and
 * Team 2, updated a private incident owned only by Team 2, whose permissions
 * are Viewer - Team 1's permission to change incidents reached an incident
 * only Team 2 owns, and Team 1's members cannot even see.
 *
 * Opt in with RUN_POSTGRES_RECORD_SCOPE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RECORD_SCOPE_TESTS=true \
 *   RECORD_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   RECORD_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/PrivateRecordOwnerTeamsPostgres.test.ts
 *
 * The tables it writes are copied from public into a uniquely named schema
 * that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RECORD_SCOPE_TESTS"] === "true"
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

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// Copying a table takes a few seconds on a busy database.
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

// What a route answered.
interface Outcome {
  error?: unknown;
  ids?: Array<string>;
  count?: number;
  item?: BaseModel | null;
  isEmptySuccess?: boolean;
}

describePostgres(
  "a private incident is changed only through the teams that own it, on Postgres",
  () => {
    const schema: string = `private_owner_teams_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    new BaseAPI(Incident, IncidentService as DatabaseService<BaseModel>);
    new BaseAPI(
      IncidentInternalNote,
      IncidentInternalNoteService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      IncidentOwnerTeam,
      IncidentOwnerTeamService as unknown as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      IncidentOwnerUser,
      IncidentOwnerUserService as unknown as DatabaseService<BaseModel>,
    );

    // Test User 2, and somebody else in the project.
    const memberId: ObjectID = ObjectID.generate();
    const colleagueId: ObjectID = ObjectID.generate();

    const projectId: ObjectID = ObjectID.generate();

    // Team 1 (another team of the member's) and Team 2 (the view-only owner).
    const team1Id: ObjectID = ObjectID.generate();
    const team2Id: ObjectID = ObjectID.generate();

    const productionLabelId: ObjectID = ObjectID.generate();

    const identifiedStateId: ObjectID = ObjectID.generate();
    const acknowledgedStateId: ObjectID = ObjectID.generate();

    // INC-17: private, owned by Team 2 alone, carrying the Production label.
    const privateIncidentId: ObjectID = ObjectID.generate();
    const privateIncidentNoteId: ObjectID = ObjectID.generate();
    const privateIncidentTitle: string = "Another Private Incident";

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

    const readColumn: (
      table: string,
      id: ObjectID,
      column: string,
    ) => Promise<unknown> = async (
      table: string,
      id: ObjectID,
      column: string,
    ): Promise<unknown> => {
      const rows: Array<Dictionary<unknown>> = await database.query(
        `SELECT "${column}" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]?.[column];
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

    // Sends one request through its route, as Express would.
    const send: (data: {
      uri: string;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }) => Promise<Outcome> = async (data: {
      uri: string;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
    }): Promise<Outcome> => {
      jest.mocked(Response.sendEntityResponse).mockClear();
      jest.mocked(Response.sendEntityArrayResponse).mockClear();
      jest.mocked(Response.sendJsonObjectResponse).mockClear();
      jest.mocked(Response.sendEmptySuccessResponse).mockClear();
      jest.mocked(Response.sendErrorResponse).mockClear();

      const req: ExpressRequest = {
        method: "POST",
        params: data.id ? { id: data.id.toString() } : {},
        query: {},
        cookies: {},
        headers: {
          authorization: `Bearer ${memberId.toString()}`,
          tenantid: projectId.toString(),
        },
        body: data.body || {},
      } as unknown as ExpressRequest;

      const res: ExpressResponse = {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;

      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        "post",
        data.uri,
      );

      for (const middleware of route.middlewares) {
        let isPassed: boolean = false;

        await middleware(req, res, ((error?: unknown) => {
          if (!error) {
            isPassed = true;
          }
        }) as NextFunction);

        if (!isPassed) {
          return {
            error: jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
          };
        }
      }

      let forwardedError: unknown = undefined;

      await route.handlerFunction(req, res, ((error: unknown) => {
        forwardedError = error;
      }) as NextFunction);

      if (forwardedError) {
        return { error: forwardedError };
      }

      const itemCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityResponse,
      ).mock.calls[0];

      if (itemCall) {
        return { item: (itemCall[2] as BaseModel | null) || null };
      }

      const listCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityArrayResponse,
      ).mock.calls[0];

      if (listCall) {
        return {
          ids: (listCall[2] as Array<BaseModel>)
            .map((model: BaseModel): string => {
              return model.id!.toString();
            })
            .sort(),
          count: (listCall[3] as PositiveNumber).toNumber(),
        };
      }

      if (
        jest.mocked(Response.sendEmptySuccessResponse).mock.calls.length > 0
      ) {
        return { isEmptySuccess: true };
      }

      throw new Error(`${data.uri} answered nothing.`);
    };

    // The member's props, as the user middleware builds them.
    const memberProps: () => Promise<DatabaseCommonInteractionProps> =
      async (): Promise<DatabaseCommonInteractionProps> => {
        const req: ExpressRequest = {
          method: "POST",
          params: {},
          query: {},
          cookies: {},
          headers: {
            authorization: `Bearer ${memberId.toString()}`,
            tenantid: projectId.toString(),
          },
          body: {},
        } as unknown as ExpressRequest;

        const res: ExpressResponse = {
          set: jest.fn(),
          status: jest.fn().mockReturnThis(),
          json: jest.fn(),
          send: jest.fn(),
        } as unknown as ExpressResponse;

        for (const middleware of mockRouter.match("post", "/incident/get-list")
          .middlewares) {
          let isPassed: boolean = false;

          await middleware(req, res, ((error?: unknown) => {
            isPassed = !error;
          }) as NextFunction);

          expect(isPassed).toBe(true);
        }

        return await CommonAPI.getDatabaseCommonInteractionProps(req);
      };

    /*
     * INC-17 as the maintainer had it - private, owned by Team 2 alone,
     * labelled Production, with one private note - made again from nothing
     * before every test: a test that fails half-way, or a write that should
     * have been refused and was not, leaves the next one as it found it.
     */
    const seedIncident: () => Promise<void> = async (): Promise<void> => {
      for (const table of [
        "IncidentStateTimeline",
        "IncidentFeed",
        "IncidentInternalNote",
        "IncidentOwnerUser",
        "IncidentOwnerTeam",
        "IncidentLabel",
        "Incident",
      ]) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }

      await insert("Incident", {
        _id: privateIncidentId,
        projectId: projectId,
        title: privateIncidentTitle,
        slug: privateIncidentId.toString(),
        currentIncidentStateId: identifiedStateId,
        // The severity table is not read here.
        incidentSeverityId: ObjectID.generate(),
        isPrivate: true,
        version: 1,
      });

      await insert("IncidentLabel", {
        incidentId: privateIncidentId,
        labelId: productionLabelId,
      });

      await insert("IncidentOwnerTeam", {
        _id: ObjectID.generate(),
        projectId: projectId,
        incidentId: privateIncidentId,
        teamId: team2Id,
        version: 1,
      });

      await insert("IncidentInternalNote", {
        _id: privateIncidentNoteId,
        projectId: projectId,
        incidentId: privateIncidentId,
        note: "A note",
        version: 1,
      });
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["RECORD_SCOPE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["RECORD_SCOPE_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RECORD_SCOPE_TEST_DATABASE_NAME"] ||
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

      // The session token names the member; it is not a signed token here.
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
      getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(AuditLogService, "recordDelete").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(IncidentService, "getIncidentLinkInDashboard").mockResolvedValue(
        URL.fromString("https://oneuptime.example/incident") as never,
      );
      getJestSpyOn(IncidentFeedService, "createIncidentFeedItem").mockResolvedValue(
        undefined as never,
      );
      getJestSpyOn(
        CustomFieldMappingService,
        "applyMappingsToUpdate",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(StatusPageOverviewCache, "forgetProjects").mockResolvedValue(
        undefined as never,
      );

      await insert("Project", {
        _id: projectId,
        name: "IRM Test",
        slug: projectId.toString(),
        version: 1,
      });

      for (const [id, name] of [
        [memberId, "Test User 2"],
        [colleagueId, "Aidil Rezjki Suljztan"],
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
        [team1Id, "Team 1"],
        [team2Id, "Team 2"],
      ] as Array<[ObjectID, string]>) {
        await insert("Team", {
          _id: teamId,
          projectId: projectId,
          name: name,
          slug: teamId.toString(),
          version: 1,
        });
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: projectId,
          teamId: teamId,
          userId: memberId,
          hasAcceptedInvitation: true,
          version: 1,
        });
      }

      await insert("Label", {
        _id: productionLabelId,
        projectId: projectId,
        name: "Production",
        slug: productionLabelId.toString(),
        color: "#000000",
        version: 1,
      });

      for (const [id, name, order, isAcknowledged] of [
        [identifiedStateId, "Identified", 1, false],
        [acknowledgedStateId, "Acknowledged", 2, true],
      ] as Array<[ObjectID, string, number, boolean]>) {
        await insert("IncidentState", {
          _id: id,
          projectId: projectId,
          name: name,
          slug: id.toString(),
          color: "#000000",
          order: order,
          isCreatedState: order === 1,
          isAcknowledgedState: isAcknowledged,
          isResolvedState: false,
          version: 1,
        });
      }

      // Team 2 holds Viewer: the owner team may only view.
      await setTeamPermissions(team2Id, [{ permission: Permission.Viewer }]);
    });

    beforeEach(async () => {
      await seedIncident();
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    const expectRefused: (outcome: Outcome) => void = (
      outcome: Outcome,
    ): void => {
      expect(outcome.error).toBeInstanceOf(Exception);
      expect(outcome.isEmptySuccess).toBeUndefined();
    };

    // The four ways Team 1's permission was given in the reproduction.
    const TEAM_1_GRANTS: Array<{ name: string; rows: Array<PermissionRow> }> =
      [
        {
          name: "Project Member over the whole project",
          rows: [{ permission: Permission.ProjectMember }],
        },
        {
          name: "Incident Member over the whole project",
          rows: [{ permission: Permission.IncidentMember }],
        },
        {
          name: "Incident Member scoped to Owned",
          rows: [
            {
              permission: Permission.IncidentMember,
              scope: PermissionScope.Owned,
            },
          ],
        },
        {
          name: "Incident Member limited to the incident's label",
          rows: [
            {
              permission: Permission.IncidentMember,
              labelIds: [productionLabelId],
            },
          ],
        },
      ];

    describe.each(TEAM_1_GRANTS)(
      "the maintainer's case, with Team 1 given $name",
      (grant: { name: string; rows: Array<PermissionRow> }) => {
        test("Test User 2 reads the incident: Team 2 owns it", async () => {
          await setTeamPermissions(team1Id, grant.rows);

          const read: Outcome = await send({
            uri: "/incident/:id/get-item",
            id: privateIncidentId,
            body: { select: { _id: true, title: true } },
          });

          expect(read.error).toBeUndefined();
          expect(read.item?.id?.toString()).toBe(privateIncidentId.toString());
        });

        test("Test User 2 does not update the incident's description", async () => {
          await setTeamPermissions(team1Id, grant.rows);

          const outcome: Outcome = await send({
            uri: "/incident/:id/update-item",
            id: privateIncidentId,
            body: {
              data: JSONFunctions.serialize({ description: "Sigh. Updated." }),
            },
          });

          expectRefused(outcome);
          expect(
            await readColumn("Incident", privateIncidentId, "description"),
          ).toBeNull();
        });

        test("Test User 2 adds no private note to the incident", async () => {
          await setTeamPermissions(team1Id, grant.rows);

          const outcome: Outcome = await send({
            uri: "/incident-internal-note",
            body: {
              data: JSONFunctions.serialize({
                incidentId: privateIncidentId.toString(),
                projectId: projectId.toString(),
                note: "Added through Team 1",
              }),
            },
          });

          expectRefused(outcome);
          expect(
            await countRows("IncidentInternalNote", `"note" = $1`, [
              "Added through Team 1",
            ]),
          ).toBe(0);
        });

        test("Test User 2 changes none of the incident's private notes", async () => {
          await setTeamPermissions(team1Id, grant.rows);

          const outcome: Outcome = await send({
            uri: "/incident-internal-note/:id/update-item",
            id: privateIncidentNoteId,
            body: {
              data: JSONFunctions.serialize({ note: "Changed through Team 1" }),
            },
          });

          expectRefused(outcome);
          expect(
            await readColumn(
              "IncidentInternalNote",
              privateIncidentNoteId,
              "note",
            ),
          ).toBe("A note");
        });

        test("Test User 2 adds neither Team 1 nor themselves as an owner", async () => {
          await setTeamPermissions(team1Id, grant.rows);

          const teamOutcome: Outcome = await send({
            uri: "/incident-owner-team",
            body: {
              data: JSONFunctions.serialize({
                incidentId: privateIncidentId.toString(),
                projectId: projectId.toString(),
                teamId: team1Id.toString(),
              }),
            },
          });

          expectRefused(teamOutcome);

          const userOutcome: Outcome = await send({
            uri: "/incident-owner-user",
            body: {
              data: JSONFunctions.serialize({
                incidentId: privateIncidentId.toString(),
                projectId: projectId.toString(),
                userId: memberId.toString(),
              }),
            },
          });

          expectRefused(userOutcome);

          expect(
            await countRows(
              "IncidentOwnerTeam",
              `"incidentId" = $1 AND "teamId" = $2`,
              [privateIncidentId.toString(), team1Id.toString()],
            ),
          ).toBe(0);
          expect(
            await countRows("IncidentOwnerUser", `"incidentId" = $1`, [
              privateIncidentId.toString(),
            ]),
          ).toBe(0);
        });

        test("Test User 2 does not acknowledge the incident", async () => {
          await setTeamPermissions(team1Id, grant.rows);

          const stateChange: IncidentStateTimeline = new IncidentStateTimeline();
          stateChange.projectId = projectId;
          stateChange.incidentId = privateIncidentId;
          stateChange.incidentStateId = acknowledgedStateId;

          await expect(
            IncidentStateTimelineService.checkCallerMayCreate({
              data: stateChange,
              props: await memberProps(),
            }),
          ).rejects.toBeInstanceOf(Exception);
        });

        test("Test User 2 does not delete the incident", async () => {
          await setTeamPermissions(team1Id, grant.rows);

          const outcome: Outcome = await send({
            uri: "/incident/:id/delete-item",
            id: privateIncidentId,
          });

          expectRefused(outcome);
          expect(
            await readColumn("Incident", privateIncidentId, "deletedAt"),
          ).toBeNull();
        });
      },
    );
  },
);
