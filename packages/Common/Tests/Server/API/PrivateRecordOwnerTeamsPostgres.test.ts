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
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import MeasurementMetricWriter from "../../../Server/Utils/Measurement/MeasurementMetricWriter";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import PrivateRecordWriteCheck from "../../../Server/Utils/Permission/PrivateRecordWriteCheck";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
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
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import URL from "../../../Types/API/URL";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
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
 * only Team 2 owns, which Team 1's other members cannot even see. Before the
 * fix the member updated it, added notes and owners (Team 1, and
 * themselves) to it, changed its state and deleted it whenever Team 1 could
 * change incidents over the whole project or on the incident's label; only
 * a grant scoped to Owned was refused (#5337).
 *
 * The rule, as this suite states it independently (expectedOutcome):
 *
 *   - who SEES a private incident is unchanged: its owners - the person
 *     named on it, the members of the teams named on it (accepted
 *     invitations only) - with a permission to read incidents that reaches
 *     it, and the project's owners and admins;
 *   - who CHANGES one - edits it, deletes it, changes its state, adds or
 *     removes its notes and owners - is decided by its owners: a person named
 *     as an owner with every permission they hold, a member of a team named
 *     as an owner with that team's permissions, each with its own scope
 *     (labels, Owned); another team's permission reaches none of it;
 *   - a public incident is changed by whoever's permission reaches it, as
 *     before, whoever owns it - a view-only owner team takes nothing away;
 *   - every write needs a read.
 *
 * Opt in with RUN_POSTGRES_RECORD_SCOPE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RECORD_SCOPE_TESTS=true \
 *   RECORD_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   RECORD_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/PrivateRecordOwnerTeamsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is dropped
 * afterwards; every row is synthetic. Workflows, live updates, the audit log
 * and feed entries are stubbed.
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

/*
 * What a team of the member's may do to incidents: nothing, read them all
 * (Viewer), or work on them (Incident Member) - over the whole project,
 * scoped to Owned, or limited to the Production label.
 */
type Grant = "none" | "viewer" | "member" | "memberOwned" | "memberLabelled";

const GRANTS: ReadonlyArray<Grant> = [
  "none",
  "viewer",
  "member",
  "memberOwned",
  "memberLabelled",
];

// How the member is on a team: accepted, invited and not accepted, or not.
type Membership = "accepted" | "pending" | "none";

interface Config {
  team1: { membership: Membership; grant: Grant };
  team2: { membership: Membership; grant: Grant };
}

// Who owns an incident, whether it is private, and whether it is labelled.
interface IncidentFixture {
  key: string;
  id: ObjectID;
  noteId: ObjectID;
  title: string;
  isPrivate: boolean;
  isLabelled: boolean;
  ownedByMember: boolean;
  ownerTeams: Array<"team1" | "team2" | "team3">;
}

// The writes the matrix tries, each on every incident.
type Write =
  | "edit the incident"
  | "delete the incident"
  | "change its state"
  | "add a private note"
  | "delete its private note"
  | "add Team 4 as an owner";

const WRITES: ReadonlyArray<Write> = [
  "edit the incident",
  "delete the incident",
  "change its state",
  "add a private note",
  "delete its private note",
  "add Team 4 as an owner",
];

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

    /*
     * Team 1 and Team 2 are the member's; Team 3 is somebody else's, and
     * Team 4 a team with nobody in it that owns nothing yet.
     */
    const team1Id: ObjectID = ObjectID.generate();
    const team2Id: ObjectID = ObjectID.generate();
    const team3Id: ObjectID = ObjectID.generate();
    const team4Id: ObjectID = ObjectID.generate();

    const teamIdOf: (team: "team1" | "team2" | "team3") => ObjectID = (
      team: "team1" | "team2" | "team3",
    ): ObjectID => {
      return { team1: team1Id, team2: team2Id, team3: team3Id }[team];
    };

    const productionLabelId: ObjectID = ObjectID.generate();

    const identifiedStateId: ObjectID = ObjectID.generate();
    const acknowledgedStateId: ObjectID = ObjectID.generate();

    const incidentFixture: (
      key: string,
      data: Omit<IncidentFixture, "key" | "id" | "noteId" | "title">,
    ) => IncidentFixture = (
      key: string,
      data: Omit<IncidentFixture, "key" | "id" | "noteId" | "title">,
    ): IncidentFixture => {
      return {
        key: key,
        id: ObjectID.generate(),
        noteId: ObjectID.generate(),
        title: key,
        ...data,
      };
    };

    // INC-17, exactly: private, owned by Team 2 alone, labelled.
    const inc17: IncidentFixture = incidentFixture(
      "Another Private Incident (INC-17)",
      {
        isPrivate: true,
        isLabelled: true,
        ownedByMember: false,
        ownerTeams: ["team2"],
      },
    );

    const INCIDENTS: Array<IncidentFixture> = [
      inc17,
      incidentFixture("private, Team 2's, unlabelled", {
        isPrivate: true,
        isLabelled: false,
        ownedByMember: false,
        ownerTeams: ["team2"],
      }),
      incidentFixture("private, Team 1's, labelled", {
        isPrivate: true,
        isLabelled: true,
        ownedByMember: false,
        ownerTeams: ["team1"],
      }),
      incidentFixture("private, both teams', unlabelled", {
        isPrivate: true,
        isLabelled: false,
        ownedByMember: false,
        ownerTeams: ["team1", "team2"],
      }),
      incidentFixture("private, the member's own, unlabelled", {
        isPrivate: true,
        isLabelled: false,
        ownedByMember: true,
        ownerTeams: [],
      }),
      incidentFixture("private, the member's and Team 2's, labelled", {
        isPrivate: true,
        isLabelled: true,
        ownedByMember: true,
        ownerTeams: ["team2"],
      }),
      incidentFixture("private, Team 3's, labelled", {
        isPrivate: true,
        isLabelled: true,
        ownedByMember: false,
        ownerTeams: ["team3"],
      }),
      incidentFixture("public, Team 2's, labelled", {
        isPrivate: false,
        isLabelled: true,
        ownedByMember: false,
        ownerTeams: ["team2"],
      }),
      incidentFixture("public, nobody's, unlabelled", {
        isPrivate: false,
        isLabelled: false,
        ownedByMember: false,
        ownerTeams: [],
      }),
    ];

    /*
     * THE RULE, stated on its own (see the comment at the top): what the
     * member may do to `incident` with `config`'s teams.
     */
    const isOwnedByTeam: (
      incident: IncidentFixture,
      team: "team1" | "team2",
    ) => boolean = (
      incident: IncidentFixture,
      team: "team1" | "team2",
    ): boolean => {
      return incident.ownerTeams.includes(team);
    };

    // Whether a team's grant, on its own, reaches the incident by its scope.
    const scopeReaches: (
      grant: Grant,
      team: "team1" | "team2",
      incident: IncidentFixture,
    ) => boolean = (
      grant: Grant,
      team: "team1" | "team2",
      incident: IncidentFixture,
    ): boolean => {
      switch (grant) {
        case "viewer":
        case "member":
          return true;
        case "memberOwned":
          return incident.ownedByMember || isOwnedByTeam(incident, team);
        case "memberLabelled":
          return incident.isLabelled;
        case "none":
          return false;
      }
    };

    const memberTeams: (config: Config) => Array<"team1" | "team2"> = (
      config: Config,
    ): Array<"team1" | "team2"> => {
      return (["team1", "team2"] as Array<"team1" | "team2">).filter(
        (team: "team1" | "team2"): boolean => {
          return config[team].membership === "accepted";
        },
      );
    };

    const canSee: (config: Config, incident: IncidentFixture) => boolean = (
      config: Config,
      incident: IncidentFixture,
    ): boolean => {
      const teams: Array<"team1" | "team2"> = memberTeams(config);

      const isSeenByPrivacy: boolean =
        !incident.isPrivate ||
        incident.ownedByMember ||
        teams.some((team: "team1" | "team2"): boolean => {
          return isOwnedByTeam(incident, team);
        });

      const isRead: boolean = teams.some(
        (team: "team1" | "team2"): boolean => {
          return (
            config[team].grant !== "none" &&
            scopeReaches(config[team].grant, team, incident)
          );
        },
      );

      return isSeenByPrivacy && isRead;
    };

    const canWrite: (config: Config, incident: IncidentFixture) => boolean = (
      config: Config,
      incident: IncidentFixture,
    ): boolean => {
      if (!canSee(config, incident)) {
        return false;
      }

      return memberTeams(config).some((team: "team1" | "team2"): boolean => {
        const grant: Grant = config[team].grant;

        return (
          (grant === "member" ||
            grant === "memberOwned" ||
            grant === "memberLabelled") &&
          scopeReaches(grant, team, incident) &&
          (!incident.isPrivate ||
            incident.ownedByMember ||
            isOwnedByTeam(incident, team))
        );
      });
    };

    const rowsOf: (grant: Grant) => Array<PermissionRow> = (
      grant: Grant,
    ): Array<PermissionRow> => {
      switch (grant) {
        case "none":
          return [];
        case "viewer":
          return [{ permission: Permission.Viewer }];
        case "member":
          return [{ permission: Permission.IncidentMember }];
        case "memberOwned":
          return [
            {
              permission: Permission.IncidentMember,
              scope: PermissionScope.Owned,
            },
          ];
        case "memberLabelled":
          return [
            {
              permission: Permission.IncidentMember,
              labelIds: [productionLabelId],
            },
          ];
      }
    };

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

    /*
     * Every incident as the fixtures have it - its owners, its label, one
     * private note - made again from nothing: a write that went through, or
     * a test that failed half-way, leaves the next one as it found it.
     */
    const seedIncidents: () => Promise<void> = async (): Promise<void> => {
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

      for (const incident of INCIDENTS) {
        await insert("Incident", {
          _id: incident.id,
          projectId: projectId,
          title: incident.title,
          slug: incident.id.toString(),
          currentIncidentStateId: identifiedStateId,
          // The severity table is not read here.
          incidentSeverityId: ObjectID.generate(),
          isPrivate: incident.isPrivate,
          version: 1,
        });

        if (incident.isLabelled) {
          await insert("IncidentLabel", {
            incidentId: incident.id,
            labelId: productionLabelId,
          });
        }

        if (incident.ownedByMember) {
          await insert("IncidentOwnerUser", {
            _id: ObjectID.generate(),
            projectId: projectId,
            incidentId: incident.id,
            userId: memberId,
            version: 1,
          });
        }

        for (const team of incident.ownerTeams) {
          await insert("IncidentOwnerTeam", {
            _id: ObjectID.generate(),
            projectId: projectId,
            incidentId: incident.id,
            teamId: teamIdOf(team),
            version: 1,
          });
        }

        await insert("IncidentInternalNote", {
          _id: incident.noteId,
          projectId: projectId,
          incidentId: incident.id,
          note: "A note",
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

    // The member's membership of a team, replaced.
    const setMembership: (
      teamId: ObjectID,
      membership: Membership,
    ) => Promise<void> = async (
      teamId: ObjectID,
      membership: Membership,
    ): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamMember" WHERE "teamId" = $1 AND "userId" = $2`,
        [teamId.toString(), memberId.toString()],
      );

      if (membership === "none") {
        return;
      }

      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: teamId,
        userId: memberId,
        hasAcceptedInvitation: membership === "accepted",
        version: 1,
      });
    };

    const applyConfig: (config: Config) => Promise<void> = async (
      config: Config,
    ): Promise<void> => {
      await setMembership(team1Id, config.team1.membership);
      await setMembership(team2Id, config.team2.membership);
      await setTeamPermissions(team1Id, rowsOf(config.team1.grant));
      await setTeamPermissions(team2Id, rowsOf(config.team2.grant));
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
     * Tries one write on one incident as the member and says whether it was
     * made - checking the database, never the answer alone: a refused write
     * answers with an error and leaves the row as it was.
     */
    const tryWrite: (
      write: Write,
      incident: IncidentFixture,
    ) => Promise<boolean> = async (
      write: Write,
      incident: IncidentFixture,
    ): Promise<boolean> => {
      switch (write) {
        case "edit the incident": {
          const outcome: Outcome = await send({
            uri: "/incident/:id/update-item",
            id: incident.id,
            body: {
              data: JSONFunctions.serialize({ description: "Sigh. Updated." }),
            },
          });

          const isMade: boolean =
            (await readColumn("Incident", incident.id, "description")) ===
            "Sigh. Updated.";

          expect(Boolean(outcome.isEmptySuccess)).toBe(isMade);
          return isMade;
        }
        case "delete the incident": {
          /*
           * Which incidents the delete reaches: the delete's own record rule
           * (the query it is narrowed to), counted. An incident's delete
           * reads every column of the row for its audit log, a few seconds
           * here each time, so the matrix asks the rule and the tests of the
           * maintainer's case and of Team 2's own grant send real deletes
           * through the route.
           */
          try {
            const query: Query<Incident> =
              await ModelPermission.checkDeleteQueryPermission(
                Incident,
                { _id: incident.id.toString() } as Query<Incident>,
                await memberProps(),
              );

            return (
              (await database
                .getRepository(Incident)
                .count({ where: query as never })) === 1
            );
          } catch (error) {
            expect(error).toBeInstanceOf(Exception);
            return false;
          }
        }
        case "change its state": {
          const stateChange: IncidentStateTimeline =
            new IncidentStateTimeline();
          stateChange.projectId = projectId;
          stateChange.incidentId = incident.id;
          stateChange.incidentStateId = acknowledgedStateId;

          try {
            await IncidentStateTimelineService.checkCallerMayCreate({
              data: stateChange,
              props: await memberProps(),
            });
            return true;
          } catch (error) {
            expect(error).toBeInstanceOf(Exception);
            return false;
          }
        }
        case "add a private note": {
          const text: string = `Note ${ObjectID.generate().toString()}`;

          const outcome: Outcome = await send({
            uri: "/incident-internal-note",
            body: {
              data: JSONFunctions.serialize({
                incidentId: incident.id.toString(),
                projectId: projectId.toString(),
                note: text,
              }),
            },
          });

          const isMade: boolean =
            (await countRows("IncidentInternalNote", `"note" = $1`, [text])) >
            0;

          expect(outcome.error === undefined).toBe(isMade);
          return isMade;
        }
        case "delete its private note": {
          const outcome: Outcome = await send({
            uri: "/incident-internal-note/:id/delete-item",
            id: incident.noteId,
          });

          const isMade: boolean =
            (await countRows(
              "IncidentInternalNote",
              `"_id" = $1 AND "deletedAt" IS NULL`,
              [incident.noteId.toString()],
            )) === 0;

          expect(Boolean(outcome.isEmptySuccess)).toBe(isMade);
          return isMade;
        }
        case "add Team 4 as an owner": {
          // Team 4 owns nothing, so an owner added is never a duplicate.
          const outcome: Outcome = await send({
            uri: "/incident-owner-team",
            body: {
              data: JSONFunctions.serialize({
                incidentId: incident.id.toString(),
                projectId: projectId.toString(),
                teamId: team4Id.toString(),
              }),
            },
          });

          const isMade: boolean =
            (await countRows(
              "IncidentOwnerTeam",
              `"incidentId" = $1 AND "teamId" = $2 AND "deletedAt" IS NULL`,
              [incident.id.toString(), team4Id.toString()],
            )) > 0;

          expect(outcome.error === undefined).toBe(isMade);
          return isMade;
        }
      }
    };

    const describeConfig: (config: Config) => string = (
      config: Config,
    ): string => {
      const team: (name: string, data: Config["team1"]) => string = (
        name: string,
        data: Config["team1"],
      ): string => {
        return data.membership === "none"
          ? `not on ${name}`
          : `${data.membership === "pending" ? "invited to" : "on"} ${name} (${data.grant})`;
      };

      return `${team("Team 1", config.team1)}, ${team("Team 2", config.team2)}`;
    };

    /*
     * The matrix: a member on both teams with every pair of grants, on one
     * team only, and on one team with an invitation to the other still
     * waiting - against every incident and every write.
     */
    const CONFIGS: Array<Config> = [
      ...GRANTS.flatMap((grant1: Grant): Array<Config> => {
        return GRANTS.map((grant2: Grant): Config => {
          return {
            team1: { membership: "accepted", grant: grant1 },
            team2: { membership: "accepted", grant: grant2 },
          };
        });
      }),
      ...GRANTS.map((grant: Grant): Config => {
        return {
          team1: { membership: "accepted", grant: grant },
          team2: { membership: "none", grant: "viewer" },
        };
      }),
      ...GRANTS.map((grant: Grant): Config => {
        return {
          team1: { membership: "none", grant: "member" },
          team2: { membership: "accepted", grant: grant },
        };
      }),
      ...GRANTS.map((grant: Grant): Config => {
        return {
          team1: { membership: "accepted", grant: grant },
          team2: { membership: "pending", grant: "member" },
        };
      }),
    ];

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

      // And on each service, whichever has triggers of its own.
      for (const service of [
        IncidentService,
        IncidentInternalNoteService,
        IncidentOwnerTeamService,
        IncidentOwnerUserService,
        IncidentStateTimelineService,
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
        CustomFieldMappingService,
        "applyMappingsToUpdate",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(
        StatusPageOverviewCache,
        "forgetProjects",
      ).mockResolvedValue(undefined as never);
      // A deleted incident's metrics are tombstoned in ClickHouse, not here.
      getJestSpyOn(
        MutableMetricService,
        "tombstoneEntityMetrics",
      ).mockResolvedValue(undefined as never);
      getJestSpyOn(MeasurementMetricWriter, "tombstoneAll").mockResolvedValue(
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
        [team3Id, "Team 3"],
        [team4Id, "Team 4"],
      ] as Array<[ObjectID, string]>) {
        await insert("Team", {
          _id: teamId,
          projectId: projectId,
          name: name,
          slug: teamId.toString(),
          version: 1,
        });
      }

      // Team 3 is the colleague's, who may change every incident.
      await insert("TeamMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        teamId: team3Id,
        userId: colleagueId,
        hasAcceptedInvitation: true,
        version: 1,
      });
      await setTeamPermissions(team3Id, [
        { permission: Permission.IncidentMember },
      ]);

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
    });

    beforeEach(async () => {
      await seedIncidents();
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    // The maintainer's exact teams: Team 2 views, Team 1 may change.
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
        {
          name: "Edit, delete and create on every operational resource",
          rows: [
            { permission: Permission.ReadAllOperationalResources },
            { permission: Permission.EditAllOperationalResources },
            { permission: Permission.DeleteAllOperationalResources },
            { permission: Permission.CreateAllOperationalResources },
            { permission: Permission.CreateIncidentInternalNote },
            { permission: Permission.EditIncidentInternalNote },
            { permission: Permission.CreateIncidentOwnerTeam },
            { permission: Permission.CreateIncidentOwnerUser },
            { permission: Permission.CreateIncidentStateTimeline },
          ],
        },
      ];

    describe.each(TEAM_1_GRANTS)(
      "the maintainer's case (block 33), with Team 1 given $name",
      (grant: { name: string; rows: Array<PermissionRow> }) => {
        beforeEach(async () => {
          await setMembership(team1Id, "accepted");
          await setMembership(team2Id, "accepted");
          await setTeamPermissions(team1Id, grant.rows);
          await setTeamPermissions(team2Id, [
            { permission: Permission.Viewer },
          ]);
        });

        test("Test User 2 still reads INC-17: Team 2 owns it", async () => {
          const read: Outcome = await send({
            uri: "/incident/:id/get-item",
            id: inc17.id,
            body: { select: { _id: true, title: true } },
          });

          expect(read.error).toBeUndefined();
          expect(read.item?.id?.toString()).toBe(inc17.id.toString());
        });

        test("Test User 2 does not update INC-17's description, and is told why", async () => {
          const outcome: Outcome = await send({
            uri: "/incident/:id/update-item",
            id: inc17.id,
            body: {
              data: JSONFunctions.serialize({ description: "Sigh. Updated." }),
            },
          });

          expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
          expect((outcome.error as Error).message).toBe(
            "You do not have permission to update this incident. It is private, so it is changed only with the permissions of the teams that own it and of the people named as its owners, and none of them lets you do this. Ask a project admin to give one of the teams that own it this permission, or to add you as an owner.",
          );
          expect(
            await readColumn("Incident", inc17.id, "description"),
          ).toBeNull();
        });

        test("Test User 2 adds no private note to INC-17, and is told why", async () => {
          const outcome: Outcome = await send({
            uri: "/incident-internal-note",
            body: {
              data: JSONFunctions.serialize({
                incidentId: inc17.id.toString(),
                projectId: projectId.toString(),
                note: "Added through Team 1",
              }),
            },
          });

          expect(outcome.error).toBeInstanceOf(Exception);
          expect((outcome.error as Error).message).toContain(
            "The incident it belongs to is private, so it is changed only with the permissions of the teams that own that incident and of the people named as its owners",
          );
          expect(
            await countRows("IncidentInternalNote", `"note" = $1`, [
              "Added through Team 1",
            ]),
          ).toBe(0);
        });

        test("Test User 2 changes none of INC-17's private notes", async () => {
          const outcome: Outcome = await send({
            uri: "/incident-internal-note/:id/update-item",
            id: inc17.noteId,
            body: {
              data: JSONFunctions.serialize({ note: "Changed through Team 1" }),
            },
          });

          expect(outcome.error).toBeInstanceOf(Exception);
          expect(
            await readColumn("IncidentInternalNote", inc17.noteId, "note"),
          ).toBe("A note");
        });

        test("Test User 2 adds neither Team 1 nor themselves as an owner of INC-17", async () => {
          const teamOutcome: Outcome = await send({
            uri: "/incident-owner-team",
            body: {
              data: JSONFunctions.serialize({
                incidentId: inc17.id.toString(),
                projectId: projectId.toString(),
                teamId: team1Id.toString(),
              }),
            },
          });

          expect(teamOutcome.error).toBeInstanceOf(Exception);

          const userOutcome: Outcome = await send({
            uri: "/incident-owner-user",
            body: {
              data: JSONFunctions.serialize({
                incidentId: inc17.id.toString(),
                projectId: projectId.toString(),
                userId: memberId.toString(),
              }),
            },
          });

          expect(userOutcome.error).toBeInstanceOf(Exception);

          expect(
            await countRows(
              "IncidentOwnerTeam",
              `"incidentId" = $1 AND "teamId" = $2`,
              [inc17.id.toString(), team1Id.toString()],
            ),
          ).toBe(0);
          expect(
            await countRows("IncidentOwnerUser", `"incidentId" = $1`, [
              inc17.id.toString(),
            ]),
          ).toBe(0);
        });

        test("Test User 2 removes no owner of INC-17", async () => {
          const ownerRows: Array<{ _id: string }> = await database.query(
            `SELECT "_id" FROM "${schema}"."IncidentOwnerTeam" WHERE "incidentId" = $1`,
            [inc17.id.toString()],
          );

          const outcome: Outcome = await send({
            uri: "/incident-owner-team/:id/delete-item",
            id: new ObjectID(ownerRows[0]!._id),
          });

          expect(outcome.error).toBeInstanceOf(Exception);
          expect(
            await countRows(
              "IncidentOwnerTeam",
              `"incidentId" = $1 AND "deletedAt" IS NULL`,
              [inc17.id.toString()],
            ),
          ).toBe(1);
        });

        test("Test User 2 does not acknowledge INC-17", async () => {
          const stateChange: IncidentStateTimeline =
            new IncidentStateTimeline();
          stateChange.projectId = projectId;
          stateChange.incidentId = inc17.id;
          stateChange.incidentStateId = acknowledgedStateId;

          await expect(
            IncidentStateTimelineService.checkCallerMayCreate({
              data: stateChange,
              props: await memberProps(),
            }),
          ).rejects.toBeInstanceOf(Exception);
        });

        test("Test User 2 does not delete INC-17", async () => {
          const outcome: Outcome = await send({
            uri: "/incident/:id/delete-item",
            id: inc17.id,
          });

          expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
          expect(
            await countRows("Incident", `"_id" = $1 AND "deletedAt" IS NULL`, [
              inc17.id.toString(),
            ]),
          ).toBe(1);
        });

        test("in Slack and Microsoft Teams, Test User 2 is told why before anything is written", async () => {
          const props: DatabaseCommonInteractionProps = await memberProps();

          await expect(
            WorkspaceActionAuthorization.assertCanCreateAndRead({
              props: props,
              modelType: IncidentStateTimeline,
              action: "acknowledge this incident",
              resources: [
                {
                  service: IncidentService as unknown as DatabaseService<BaseModel>,
                  id: inc17.id,
                },
              ],
            }),
          ).rejects.toThrow(
            "You do not have permission to acknowledge this incident: this incident is private, so it is changed only with the permissions of the teams that own it and of the people named as its owners, and none of them lets you do this.",
          );
        });
      },
    );

    describe("the permission matrix: every pair of grants, on one team or two, every incident, every write", () => {
      test.each(CONFIGS.map((config: Config) => [describeConfig(config), config]))(
        "%s",
        async (_name: string, config: Config) => {
          await applyConfig(config);

          const mismatches: Array<string> = [];

          // What the member reads: the incidents list.
          const list: Outcome = await send({
            uri: "/incident/get-list",
            body: { query: {}, select: { _id: true }, limit: 50 },
          });

          const expectedReadIds: Array<string> = INCIDENTS.filter(
            (incident: IncidentFixture): boolean => {
              return canSee(config, incident);
            },
          )
            .map((incident: IncidentFixture): string => {
              return incident.id.toString();
            })
            .sort();

          if (list.error) {
            // A member who may read no incident at all is refused the list.
            if (expectedReadIds.length > 0) {
              mismatches.push(`read: refused (${String(list.error)})`);
            }
          } else if (
            JSON.stringify(list.ids) !== JSON.stringify(expectedReadIds)
          ) {
            mismatches.push(
              `read: ${INCIDENTS.filter((incident: IncidentFixture) => {
                return list.ids!.includes(incident.id.toString());
              })
                .map((incident: IncidentFixture) => {
                  return incident.key;
                })
                .join(" | ")}`,
            );
          }

          for (const write of WRITES) {
            for (const incident of INCIDENTS) {
              const expected: boolean = canWrite(config, incident);
              const startedAt: number = Date.now();
              const actual: boolean = await tryWrite(write, incident);
              // eslint-disable-next-line no-console
              console.log("TIMING", write, actual, Date.now() - startedAt);

              if (expected !== actual) {
                mismatches.push(
                  `${write} on "${incident.key}": expected ${expected ? "made" : "refused"}, was ${actual ? "made" : "refused"}`,
                );
              }

              if (actual) {
                const seededAt: number = Date.now();
                await seedIncidents();
                // eslint-disable-next-line no-console
                console.log("TIMING seed", Date.now() - seededAt);
              }
            }
          }

          expect(mismatches).toEqual([]);
        },
      );
    });

    describe("who acts on every private incident", () => {
      test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
        "a member whose team holds %s changes every private incident, whoever owns it",
        async (role: Permission) => {
          await applyConfig({
            team1: { membership: "accepted", grant: "none" },
            team2: { membership: "none", grant: "none" },
          });
          await setTeamPermissions(team1Id, [{ permission: role }]);

          for (const incident of INCIDENTS) {
            expect(await tryWrite("edit the incident", incident)).toBe(true);
            expect(await tryWrite("add a private note", incident)).toBe(true);
            expect(await tryWrite("change its state", incident)).toBe(true);
          }
        },
      );

      test("a Project Admin limited to a label is no admin of every private incident", async () => {
        await applyConfig({
          team1: { membership: "accepted", grant: "none" },
          team2: { membership: "none", grant: "none" },
        });
        await setTeamPermissions(team1Id, [
          {
            permission: Permission.ProjectAdmin,
            labelIds: [productionLabelId],
          },
        ]);

        // Team 3's private incident, labelled: seen by none of the member's teams.
        const teamThrees: IncidentFixture = INCIDENTS.find(
          (incident: IncidentFixture) => {
            return incident.key === "private, Team 3's, labelled";
          },
        )!;

        expect(await tryWrite("edit the incident", teamThrees)).toBe(false);

        // Team 1's private incident, labelled: Team 1 owns it.
        const teamOnes: IncidentFixture = INCIDENTS.find(
          (incident: IncidentFixture) => {
            return incident.key === "private, Team 1's, labelled";
          },
        )!;

        await setMembership(team1Id, "accepted");
        expect(await tryWrite("edit the incident", teamOnes)).toBe(true);
      });
    });

    describe("what the member is told", () => {
      beforeEach(async () => {
        await applyConfig({
          team1: { membership: "accepted", grant: "member" },
          team2: { membership: "accepted", grant: "viewer" },
        });
      });

      test("a private incident none of their teams owns is not found, as before - nothing about it is told", async () => {
        const teamThrees: IncidentFixture = INCIDENTS.find(
          (incident: IncidentFixture) => {
            return incident.key === "private, Team 3's, labelled";
          },
        )!;

        const outcome: Outcome = await send({
          uri: "/incident/:id/update-item",
          id: teamThrees.id,
          body: {
            data: JSONFunctions.serialize({ description: "Changed" }),
          },
        });

        expect(outcome.error).toBeInstanceOf(NotFoundException);
        expect((outcome.error as Error).message).toBe("Incident not found.");
      });

      test("a note on a private incident is refused with the reason, naming nothing they cannot see", async () => {
        const outcome: Outcome = await send({
          uri: "/incident-internal-note/:id/delete-item",
          id: inc17.noteId,
        });

        expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
        expect((outcome.error as Error).message).toBe(
          "You do not have permission to delete this incident internal note. The incident it belongs to is private, so it is changed only with the permissions of the teams that own that incident and of the people named as its owners, and none of them lets you do this. Ask a project admin to give one of the teams that own it this permission, or to add you as an owner.",
        );
      });

      test("a public incident Team 2 owns is changed with Team 1's permission, as before", async () => {
        const publicTeamTwos: IncidentFixture = INCIDENTS.find(
          (incident: IncidentFixture) => {
            return incident.key === "public, Team 2's, labelled";
          },
        )!;

        expect(await tryWrite("edit the incident", publicTeamTwos)).toBe(true);
      });
    });

    describe("a person named as an owner acts with every permission they hold", () => {
      test("Team 1's permission reaches the private incidents the member owns themselves", async () => {
        await applyConfig({
          team1: { membership: "accepted", grant: "member" },
          team2: { membership: "accepted", grant: "viewer" },
        });

        const membersOwn: IncidentFixture = INCIDENTS.find(
          (incident: IncidentFixture) => {
            return incident.key === "private, the member's and Team 2's, labelled";
          },
        )!;

        for (const write of WRITES) {
          expect(await tryWrite(write, membersOwn)).toBe(true);
          await seedIncidents();
        }
      });

      test("once a project admin names Test User 2 an owner of INC-17, Team 1's permission reaches it", async () => {
        await applyConfig({
          team1: { membership: "accepted", grant: "member" },
          team2: { membership: "accepted", grant: "viewer" },
        });

        expect(await tryWrite("edit the incident", inc17)).toBe(false);

        await insert("IncidentOwnerUser", {
          _id: ObjectID.generate(),
          projectId: projectId,
          incidentId: inc17.id,
          userId: memberId,
          version: 1,
        });

        expect(await tryWrite("edit the incident", inc17)).toBe(true);
      });

      test("once Team 2 is given Incident Member, Test User 2 changes INC-17 through Team 2", async () => {
        await applyConfig({
          team1: { membership: "accepted", grant: "member" },
          team2: { membership: "accepted", grant: "member" },
        });

        for (const write of WRITES) {
          expect(await tryWrite(write, inc17)).toBe(true);
          await seedIncidents();
        }

        // And deletes it through its route, as the dashboard does.
        const outcome: Outcome = await send({
          uri: "/incident/:id/delete-item",
          id: inc17.id,
        });

        expect(outcome.error).toBeUndefined();
        expect(outcome.isEmptySuccess).toBe(true);
        expect(
          await countRows("Incident", `"_id" = $1 AND "deletedAt" IS NULL`, [
            inc17.id.toString(),
          ]),
        ).toBe(0);
      });
    });

    describe("a write of many incidents at once", () => {
      test("changes only the private ones the member's write reaches, and every public one it reaches", async () => {
        await applyConfig({
          team1: { membership: "accepted", grant: "member" },
          team2: { membership: "accepted", grant: "viewer" },
        });

        const config: Config = {
          team1: { membership: "accepted", grant: "member" },
          team2: { membership: "accepted", grant: "viewer" },
        };

        await IncidentService.updateBy({
          query: {
            _id: QueryHelper.any(
              INCIDENTS.map((incident: IncidentFixture): string => {
                return incident.id.toString();
              }),
            ),
          },
          data: { description: "Bulk" },
          limit: 50,
          skip: 0,
          props: await memberProps(),
        });

        for (const incident of INCIDENTS) {
          expect({
            incident: incident.key,
            isChanged:
              (await readColumn("Incident", incident.id, "description")) ===
              "Bulk",
          }).toEqual({
            incident: incident.key,
            isChanged: canWrite(config, incident),
          });
        }
      });
    });

    describe("a check made by the record before a write (Slack, Teams, call transcripts)", () => {
      test("answers as the write would, for the record itself and for its parts", async () => {
        const config: Config = {
          team1: { membership: "accepted", grant: "member" },
          team2: { membership: "accepted", grant: "viewer" },
        };

        await applyConfig(config);

        const props: DatabaseCommonInteractionProps = await memberProps();

        for (const incident of INCIDENTS) {
          for (const [modelType, type] of [
            [Incident, DatabaseRequestType.Update],
            [IncidentStateTimeline, DatabaseRequestType.Create],
            [IncidentInternalNote, DatabaseRequestType.Create],
          ] as Array<[{ new (): BaseModel }, DatabaseRequestType]>) {
            expect({
              incident: incident.key,
              type: type,
              reaches: await PrivateRecordWriteCheck.reaches({
                modelType: modelType,
                type: type,
                recordService:
                  IncidentService as unknown as DatabaseService<BaseModel>,
                recordId: incident.id,
                props: props,
              }),
            }).toEqual({
              incident: incident.key,
              type: type,
              // Reaches what the member's write reaches, or what they cannot see at all.
              reaches:
                canWrite(config, incident) ||
                !incident.isPrivate ||
                !canSee(config, incident)
                  ? canWrite(config, incident) || !incident.isPrivate
                  : false,
            });
          }
        }
      });
    });
  },
);
