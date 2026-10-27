import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
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
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * A GRANT SCOPED TO OWNED REACHES WHAT ITS OWN TEAM OWNS, against a migrated
 * Postgres - through the routes BaseAPI registers, the real user middleware
 * (which reads the member's teams and their permission rows from the tables
 * below), the real permission pipeline, query serializer and TypeORM.
 *
 * Reported by a customer: a member of two teams - one that may change the
 * resources it owns, one that may only view the resources it owns - could
 * change an incident owned by the viewing team alone. "Only resources they
 * own" on a team's permission means the resources that team owns (or the
 * member owns themselves), never the resources the member's other teams own:
 * each team's grant reaches its own team's resources. So here:
 *
 *   - a team's Owned grant to change, delete or create reaches the records
 *     the member owns and the records that team owns - not the records
 *     another team of theirs owns, which they may only read;
 *   - a read reaches everything any of their teams' read grants reaches;
 *   - a write needs a read, team by team: a record one team may change but
 *     no team of theirs may read is not changed;
 *   - an incident's notes and owners follow the incident: a note is added,
 *     changed or removed, and an owner added or removed, only on the
 *     incidents the granting team (or the member) owns - so a member cannot
 *     make their editing team an owner of the viewing team's incident and
 *     edit it that way.
 *
 * Opt in with RUN_POSTGRES_RECORD_SCOPE_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RECORD_SCOPE_TESTS=true \
 *   RECORD_SCOPE_TEST_DATABASE_HOST=127.0.0.1 \
 *   RECORD_SCOPE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/OwnedScopePerTeamPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is dropped
 * afterwards; every row is synthetic.
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

// The audit trail of an update or a delete is written elsewhere.
jest.mock("../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      recordCreate: jest.fn(),
      recordUpdate: jest.fn(),
      recordDelete: jest.fn(),
    },
  };
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

// Who owns an incident: the member, a team, both, nobody.
interface OwnedIncident {
  id: ObjectID;
  noteId: ObjectID;
  title: string;
  ownerUserIds: Array<ObjectID>;
  ownerTeamIds: Array<ObjectID>;
}

describePostgres(
  "a grant scoped to Owned reaches what its own team owns, on Postgres",
  () => {
    const schema: string = `owned_per_team_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    const incidentService: DatabaseService<Incident> = new DatabaseService(
      Incident,
    );
    const noteService: DatabaseService<IncidentInternalNote> =
      new DatabaseService(IncidentInternalNote);

    new BaseAPI(Incident, incidentService as DatabaseService<BaseModel>);
    new BaseAPI(
      IncidentInternalNote,
      noteService as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      IncidentOwnerTeam,
      new DatabaseService(IncidentOwnerTeam) as DatabaseService<BaseModel>,
    );
    new BaseAPI(
      IncidentOwnerUser,
      new DatabaseService(IncidentOwnerUser) as DatabaseService<BaseModel>,
    );

    // The signed-in member, and somebody else in the project.
    const memberId: ObjectID = ObjectID.generate();
    const colleagueId: ObjectID = ObjectID.generate();

    const projectId: ObjectID = ObjectID.generate();
    const secondProjectId: ObjectID = ObjectID.generate();

    // The member's teams: one that may change what it owns, one that views.
    const editorsTeamId: ObjectID = ObjectID.generate();
    const viewersTeamId: ObjectID = ObjectID.generate();
    // A team the member is not on.
    const othersTeamId: ObjectID = ObjectID.generate();
    // The member's team in a second project.
    const secondProjectTeamId: ObjectID = ObjectID.generate();

    const productionLabelId: ObjectID = ObjectID.generate();

    const incident: (
      title: string,
      owners: { users?: Array<ObjectID>; teams?: Array<ObjectID> },
    ) => OwnedIncident = (
      title: string,
      owners: { users?: Array<ObjectID>; teams?: Array<ObjectID> },
    ): OwnedIncident => {
      return {
        id: ObjectID.generate(),
        noteId: ObjectID.generate(),
        title: title,
        ownerUserIds: owners.users || [],
        ownerTeamIds: owners.teams || [],
      };
    };

    const ownedByEditors: OwnedIncident = incident("Owned by the editors", {
      teams: [editorsTeamId],
    });
    const ownedByViewers: OwnedIncident = incident("Owned by the viewers", {
      teams: [viewersTeamId],
    });
    const ownedByBothTeams: OwnedIncident = incident("Owned by both teams", {
      teams: [editorsTeamId, viewersTeamId],
    });
    const ownedByMember: OwnedIncident = incident("Owned by the member", {
      users: [memberId],
    });
    const ownedByOthers: OwnedIncident = incident("Owned by another team", {
      teams: [othersTeamId],
    });
    const ownedByColleague: OwnedIncident = incident("Owned by a colleague", {
      users: [colleagueId],
    });
    const ownedByNobody: OwnedIncident = incident("Owned by nobody", {});

    const INCIDENTS: Array<OwnedIncident> = [
      ownedByEditors,
      ownedByViewers,
      ownedByBothTeams,
      ownedByMember,
      ownedByOthers,
      ownedByColleague,
      ownedByNobody,
    ];

    // An incident of the second project, owned by the member's team there.
    const secondProjectIncident: OwnedIncident = incident(
      "Second project, owned by the team there",
      { teams: [secondProjectTeamId] },
    );

    const sorted: (ids: Array<ObjectID | string>) => Array<string> = (
      ids: Array<ObjectID | string>,
    ): Array<string> => {
      return ids
        .map((id: ObjectID | string): string => {
          return id.toString();
        })
        .sort();
    };

    const idsOf: (incidents: Array<OwnedIncident>) => Array<string> = (
      incidents: Array<OwnedIncident>,
    ): Array<string> => {
      return sorted(
        incidents.map((item: OwnedIncident): ObjectID => {
          return item.id;
        }),
      );
    };

    const noteIdsOf: (incidents: Array<OwnedIncident>) => Array<string> = (
      incidents: Array<OwnedIncident>,
    ): Array<string> => {
      return sorted(
        incidents.map((item: OwnedIncident): ObjectID => {
          return item.noteId;
        }),
      );
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

    const insertIncident: (
      data: OwnedIncident,
      inProjectId?: ObjectID,
    ) => Promise<void> = async (
      data: OwnedIncident,
      inProjectId: ObjectID = projectId,
    ): Promise<void> => {
      await insert("Incident", {
        _id: data.id,
        projectId: inProjectId,
        title: data.title,
        slug: data.id.toString(),
        // The state and severity tables are not read here.
        currentIncidentStateId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        version: 1,
      });

      for (const userId of data.ownerUserIds) {
        await insert("IncidentOwnerUser", {
          _id: ObjectID.generate(),
          projectId: inProjectId,
          incidentId: data.id,
          userId: userId,
          version: 1,
        });
      }

      for (const teamId of data.ownerTeamIds) {
        await insert("IncidentOwnerTeam", {
          _id: ObjectID.generate(),
          projectId: inProjectId,
          incidentId: data.id,
          teamId: teamId,
          version: 1,
        });
      }

      await insert("IncidentInternalNote", {
        _id: data.noteId,
        projectId: inProjectId,
        incidentId: data.id,
        note: `A note on ${data.title}`,
        version: 1,
      });
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

    const rowExists: (table: string, id: ObjectID) => Promise<boolean> = async (
      table: string,
      id: ObjectID,
    ): Promise<boolean> => {
      const rows: Array<unknown> = await database.query(
        `SELECT "_id" FROM "${schema}"."${table}" WHERE "_id" = $1 AND "deletedAt" IS NULL`,
        [id.toString()],
      );

      return rows.length > 0;
    };

    /*
     * Who owns each incident, its note and its title put back as the suite
     * made them: a test that fails half-way leaves the next one as it found
     * it.
     */
    const resetIncidents: () => Promise<void> = async (): Promise<void> => {
      await database.query(`DELETE FROM "${schema}"."IncidentOwnerUser"`);
      await database.query(`DELETE FROM "${schema}"."IncidentOwnerTeam"`);
      await database.query(
        `DELETE FROM "${schema}"."IncidentInternalNote" WHERE "_id" <> ALL($1::uuid[])`,
        [
          [...INCIDENTS, secondProjectIncident].map(
            (item: OwnedIncident): string => {
              return item.noteId.toString();
            },
          ),
        ],
      );

      for (const [item, inProjectId] of [
        ...INCIDENTS.map((each: OwnedIncident): [OwnedIncident, ObjectID] => {
          return [each, projectId];
        }),
        [secondProjectIncident, secondProjectId],
      ] as Array<[OwnedIncident, ObjectID]>) {
        await database.query(
          `UPDATE "${schema}"."Incident" SET "title" = $1, "description" = NULL, "deletedAt" = NULL WHERE "_id" = $2`,
          [item.title, item.id.toString()],
        );
        await database.query(
          `UPDATE "${schema}"."IncidentInternalNote" SET "note" = $1, "deletedAt" = NULL WHERE "_id" = $2`,
          [`A note on ${item.title}`, item.noteId.toString()],
        );

        for (const userId of item.ownerUserIds) {
          await insert("IncidentOwnerUser", {
            _id: ObjectID.generate(),
            projectId: inProjectId,
            incidentId: item.id,
            userId: userId,
            version: 1,
          });
        }

        for (const teamId of item.ownerTeamIds) {
          await insert("IncidentOwnerTeam", {
            _id: ObjectID.generate(),
            projectId: inProjectId,
            incidentId: item.id,
            teamId: teamId,
            version: 1,
          });
        }
      }
    };

    const ownerTeamsOf: (
      incidentId: ObjectID,
    ) => Promise<Array<string>> = async (
      incidentId: ObjectID,
    ): Promise<Array<string>> => {
      const rows: Array<{ teamId: string }> = await database.query(
        `SELECT "teamId" FROM "${schema}"."IncidentOwnerTeam" WHERE "incidentId" = $1 AND "deletedAt" IS NULL`,
        [incidentId.toString()],
      );

      return sorted(
        rows.map((row: { teamId: string }): string => {
          return row.teamId;
        }),
      );
    };

    // A team's permission rows, replaced.
    const setTeamPermissions: (
      teamId: ObjectID,
      rows: Array<PermissionRow>,
      inProjectId?: ObjectID,
    ) => Promise<void> = async (
      teamId: ObjectID,
      rows: Array<PermissionRow>,
      inProjectId: ObjectID = projectId,
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
          projectId: inProjectId,
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

    // Both of the member's teams' rows, replaced.
    const grant: (data: {
      editors: Array<PermissionRow>;
      viewers: Array<PermissionRow>;
    }) => Promise<void> = async (data: {
      editors: Array<PermissionRow>;
      viewers: Array<PermissionRow>;
    }): Promise<void> => {
      await setTeamPermissions(editorsTeamId, data.editors);
      await setTeamPermissions(viewersTeamId, data.viewers);
    };

    const headersOf: (data?: {
      tenantId?: ObjectID | undefined;
      isMultiTenant?: boolean | undefined;
    }) => Dictionary<string> = (data?: {
      tenantId?: ObjectID | undefined;
      isMultiTenant?: boolean | undefined;
    }): Dictionary<string> => {
      const headers: Dictionary<string> = {
        authorization: `Bearer ${memberId.toString()}`,
      };

      if (data?.isMultiTenant) {
        headers["is-multi-tenant-query"] = "true";
      } else {
        headers["tenantid"] = (data?.tenantId || projectId).toString();
      }

      return headers;
    };

    // The member's props, as the user middleware builds them.
    const memberProps: () => Promise<DatabaseCommonInteractionProps> =
      async (): Promise<DatabaseCommonInteractionProps> => {
        const req: ExpressRequest = {
          method: "POST",
          params: {},
          query: {},
          cookies: {},
          headers: headersOf(),
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

    // Sends one request through its route, as Express would.
    const send: (data: {
      uri: string;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
      isMultiTenant?: boolean | undefined;
      tenantId?: ObjectID | undefined;
    }) => Promise<Outcome> = async (data: {
      uri: string;
      id?: ObjectID | undefined;
      body?: JSONObject | undefined;
      isMultiTenant?: boolean | undefined;
      tenantId?: ObjectID | undefined;
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
        headers: headersOf({
          tenantId: data.tenantId,
          isMultiTenant: data.isMultiTenant,
        }),
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

      const listCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityArrayResponse,
      ).mock.calls[0];

      if (listCall) {
        return {
          ids: sorted(
            (listCall[2] as Array<BaseModel>).map(
              (model: BaseModel): string => {
                return model.id!.toString();
              },
            ),
          ),
          count: (listCall[3] as PositiveNumber).toNumber(),
        };
      }

      const countCall: Array<unknown> | undefined = jest.mocked(
        Response.sendJsonObjectResponse,
      ).mock.calls[0];

      if (countCall) {
        return { count: (countCall[2] as JSONObject)["count"] as number };
      }

      const itemCall: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityResponse,
      ).mock.calls[0];

      if (itemCall) {
        return { item: (itemCall[2] as BaseModel | null) || null };
      }

      if (
        jest.mocked(Response.sendEmptySuccessResponse).mock.calls.length > 0
      ) {
        return { isEmptySuccess: true };
      }

      throw new Error(`${data.uri} answered nothing.`);
    };

    const list: (
      path: string,
      options?: { isMultiTenant?: boolean },
    ) => Promise<Outcome> = async (
      path: string,
      options?: { isMultiTenant?: boolean },
    ): Promise<Outcome> => {
      return await send({
        uri: `${path}/get-list`,
        isMultiTenant: options?.isMultiTenant,
        body: {
          query: {},
          select: { _id: true },
          limit: 50,
        },
      });
    };

    const getItem: (path: string, id: ObjectID) => Promise<Outcome> = async (
      path: string,
      id: ObjectID,
    ): Promise<Outcome> => {
      return await send({
        uri: `${path}/:id/get-item`,
        id: id,
        body: { select: { _id: true } },
      });
    };

    const update: (
      path: string,
      id: ObjectID,
      data: JSONObject,
    ) => Promise<Outcome> = async (
      path: string,
      id: ObjectID,
      data: JSONObject,
    ): Promise<Outcome> => {
      return await send({
        uri: `${path}/:id/update-item`,
        id: id,
        body: { data: JSONFunctions.serialize(data) },
      });
    };

    const remove: (path: string, id: ObjectID) => Promise<Outcome> = async (
      path: string,
      id: ObjectID,
    ): Promise<Outcome> => {
      return await send({
        uri: `${path}/:id/delete-item`,
        id: id,
      });
    };

    const create: (path: string, data: JSONObject) => Promise<Outcome> = async (
      path: string,
      data: JSONObject,
    ): Promise<Outcome> => {
      return await send({
        uri: `${path}`,
        body: { data: JSONFunctions.serialize(data) },
      });
    };

    const expectRefused: (outcome: Outcome) => void = (
      outcome: Outcome,
    ): void => {
      expect(outcome.error).toBeInstanceOf(Exception);
      expect(outcome.isEmptySuccess).toBeUndefined();
      expect(outcome.item).toBeUndefined();
    };

    /*
     * Tries to retitle each incident, and says which it changed. Every title
     * is put back afterwards.
     */
    const retitled: (
      incidents: Array<OwnedIncident>,
    ) => Promise<Array<string>> = async (
      incidents: Array<OwnedIncident>,
    ): Promise<Array<string>> => {
      const changed: Array<string> = [];

      for (const item of incidents) {
        const outcome: Outcome = await update("/incident", item.id, {
          title: `Changed ${item.title}`,
        });

        const title: unknown = await readColumn("Incident", item.id, "title");

        if (title === `Changed ${item.title}`) {
          expect(outcome.isEmptySuccess).toBe(true);
          changed.push(item.id.toString());

          await database.query(
            `UPDATE "${schema}"."Incident" SET "title" = $1 WHERE "_id" = $2`,
            [item.title, item.id.toString()],
          );
        } else {
          expectRefused(outcome);
          expect(title).toBe(item.title);
        }
      }

      return changed.sort();
    };

    // Tries to change each incident's note, and says which it changed.
    const noteChanged: (
      incidents: Array<OwnedIncident>,
    ) => Promise<Array<string>> = async (
      incidents: Array<OwnedIncident>,
    ): Promise<Array<string>> => {
      const changed: Array<string> = [];

      for (const item of incidents) {
        const before: unknown = await readColumn(
          "IncidentInternalNote",
          item.noteId,
          "note",
        );

        const outcome: Outcome = await update(
          "/incident-internal-note",
          item.noteId,
          { note: "Changed note" },
        );

        const after: unknown = await readColumn(
          "IncidentInternalNote",
          item.noteId,
          "note",
        );

        if (after === "Changed note") {
          expect(outcome.isEmptySuccess).toBe(true);
          changed.push(item.noteId.toString());

          await database.query(
            `UPDATE "${schema}"."IncidentInternalNote" SET "note" = $1 WHERE "_id" = $2`,
            [before, item.noteId.toString()],
          );
        } else {
          expectRefused(outcome);
          expect(after).toBe(before);
        }
      }

      return changed.sort();
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
        /*
         * No schema of its own: table names stay unqualified, so the tables
         * copied into the test schema are found first and every other table
         * a read joins is found, empty, in public.
         */
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

      // Workflows run elsewhere.
      getJestSpyOn(
        DatabaseService.prototype,
        "onTriggerWorkflow",
      ).mockResolvedValue(undefined as never);

      for (const [id, name] of [
        [projectId, "Project"],
        [secondProjectId, "Second project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const id of [memberId, colleagueId]) {
        await insert("User", {
          _id: id,
          name: "Synthetic User",
          email: `${id.toString()}@example.com`,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [teamId, inProjectId, userId, name] of [
        [editorsTeamId, projectId, memberId, "Editors"],
        [viewersTeamId, projectId, memberId, "Viewers"],
        [othersTeamId, projectId, colleagueId, "Others"],
        [secondProjectTeamId, secondProjectId, memberId, "Second project"],
      ] as Array<[ObjectID, ObjectID, ObjectID, string]>) {
        await insert("Team", {
          _id: teamId,
          projectId: inProjectId,
          name: name,
          slug: teamId.toString(),
          version: 1,
        });
        await insert("TeamMember", {
          _id: ObjectID.generate(),
          projectId: inProjectId,
          teamId: teamId,
          userId: userId,
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

      for (const item of INCIDENTS) {
        await insertIncident(item);
      }

      await insertIncident(secondProjectIncident, secondProjectId);

      await insert("IncidentLabel", {
        incidentId: ownedByViewers.id,
        labelId: productionLabelId,
      });

      // The member's team in the second project views what it owns.
      await setTeamPermissions(
        secondProjectTeamId,
        [{ permission: Permission.Viewer, scope: PermissionScope.Owned }],
        secondProjectId,
      );
    });

    afterEach(async () => {
      await resetIncidents();
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    /*
     * The customer's teams: Project Member on the resources the editors own,
     * Viewer on the resources the viewers own.
     */
    const customerTeams: () => Promise<void> = async (): Promise<void> => {
      await grant({
        editors: [
          {
            permission: Permission.ProjectMember,
            scope: PermissionScope.Owned,
          },
        ],
        viewers: [
          { permission: Permission.Viewer, scope: PermissionScope.Owned },
        ],
      });
    };

    describe("the customer's report: the editors change what they own, the viewers view what they own", () => {
      beforeEach(async () => {
        await customerTeams();
      });

      test("the member reads every incident either team owns, and their own", async () => {
        const outcome: Outcome = await list("/incident");

        expect(outcome.error).toBeUndefined();
        expect(outcome.ids).toEqual(
          idsOf([
            ownedByEditors,
            ownedByViewers,
            ownedByBothTeams,
            ownedByMember,
          ]),
        );

        for (const item of [ownedByViewers, ownedByEditors]) {
          const read: Outcome = await getItem("/incident", item.id);
          expect(read.error).toBeUndefined();
          expect(read.item?.id?.toString()).toBe(item.id.toString());
        }
      });

      test("an incident only the viewers own is not changed", async () => {
        expect(await retitled([ownedByViewers])).toEqual([]);
      });

      test("the member changes what the editors own, and what they own themselves", async () => {
        expect(
          await retitled([
            ownedByEditors,
            ownedByBothTeams,
            ownedByMember,
            ownedByViewers,
            ownedByOthers,
            ownedByColleague,
            ownedByNobody,
          ]),
        ).toEqual(idsOf([ownedByEditors, ownedByBothTeams, ownedByMember]));
      });

      test("an incident only the viewers own is not deleted", async () => {
        expectRefused(await remove("/incident", ownedByViewers.id));

        expect(await rowExists("Incident", ownedByViewers.id)).toBe(true);
      });

      test("the viewers' incident's note is read, not changed or deleted", async () => {
        const outcome: Outcome = await list("/incident-internal-note");

        expect(outcome.error).toBeUndefined();
        expect(outcome.ids).toEqual(
          noteIdsOf([
            ownedByEditors,
            ownedByViewers,
            ownedByBothTeams,
            ownedByMember,
          ]),
        );

        expect(await noteChanged(INCIDENTS)).toEqual(
          noteIdsOf([ownedByEditors, ownedByBothTeams, ownedByMember]),
        );

        expectRefused(
          await remove("/incident-internal-note", ownedByViewers.noteId),
        );
        expect(
          await rowExists("IncidentInternalNote", ownedByViewers.noteId),
        ).toBe(true);
      });

      test("a note is added to what the editors own, not to what only the viewers own", async () => {
        const refused: Outcome = await create("/incident-internal-note", {
          incidentId: ownedByViewers.id.toString(),
          note: "Added by the member",
        });

        expectRefused(refused);

        const added: Outcome = await create("/incident-internal-note", {
          incidentId: ownedByEditors.id.toString(),
          note: "Added by the member",
        });

        expect(added.error).toBeUndefined();

        const rows: Array<{ incidentId: string }> = await database.query(
          `SELECT "incidentId" FROM "${schema}"."IncidentInternalNote" WHERE "note" = $1`,
          ["Added by the member"],
        );

        expect(
          rows.map((row: { incidentId: string }): string => {
            return row.incidentId;
          }),
        ).toEqual([ownedByEditors.id.toString()]);

        await database.query(
          `DELETE FROM "${schema}"."IncidentInternalNote" WHERE "note" = $1`,
          ["Added by the member"],
        );
      });

      /*
       * Making the editors an owner of the viewers' incident would let the
       * member change it after all: an owner is added only to what the
       * granting team (or the member) owns.
       */
      test("the editors cannot be made owners of the viewers' incident", async () => {
        const outcome: Outcome = await create("/incident-owner-team", {
          incidentId: ownedByViewers.id.toString(),
          teamId: editorsTeamId.toString(),
        });

        expectRefused(outcome);
        expect(await ownerTeamsOf(ownedByViewers.id)).toEqual(
          sorted([viewersTeamId]),
        );

        // So the incident stays out of their reach.
        expect(await retitled([ownedByViewers])).toEqual([]);
      });

      test("the member cannot make themselves an owner of the viewers' incident", async () => {
        const outcome: Outcome = await create("/incident-owner-user", {
          incidentId: ownedByViewers.id.toString(),
          userId: memberId.toString(),
        });

        expectRefused(outcome);

        const rows: Array<unknown> = await database.query(
          `SELECT "_id" FROM "${schema}"."IncidentOwnerUser" WHERE "incidentId" = $1`,
          [ownedByViewers.id.toString()],
        );

        expect(rows).toHaveLength(0);
      });

      test("the viewers are not removed as owners of their incident", async () => {
        const rows: Array<{ _id: string }> = await database.query(
          `SELECT "_id" FROM "${schema}"."IncidentOwnerTeam" WHERE "incidentId" = $1`,
          [ownedByViewers.id.toString()],
        );

        expect(rows).toHaveLength(1);

        expectRefused(
          await remove("/incident-owner-team", new ObjectID(rows[0]!._id)),
        );

        expect(await ownerTeamsOf(ownedByViewers.id)).toEqual(
          sorted([viewersTeamId]),
        );
      });

      test("an owner is still added to what the editors own", async () => {
        const outcome: Outcome = await create("/incident-owner-team", {
          incidentId: ownedByEditors.id.toString(),
          teamId: viewersTeamId.toString(),
        });

        expect(outcome.error).toBeUndefined();
        expect(await ownerTeamsOf(ownedByEditors.id)).toEqual(
          sorted([editorsTeamId, viewersTeamId]),
        );

        await database.query(
          `DELETE FROM "${schema}"."IncidentOwnerTeam" WHERE "incidentId" = $1 AND "teamId" = $2`,
          [ownedByEditors.id.toString(), viewersTeamId.toString()],
        );
      });

      test("an update by query changes only what the editors or the member own", async () => {
        const props: DatabaseCommonInteractionProps = await memberProps();

        await incidentService.updateBy({
          query: {},
          data: { description: "Changed by query" },
          limit: 50,
          skip: 0,
          props: props,
        });

        const rows: Array<{ _id: string }> = await database.query(
          `SELECT "_id" FROM "${schema}"."Incident" WHERE "description" = $1`,
          ["Changed by query"],
        );

        expect(
          sorted(
            rows.map((row: { _id: string }): string => {
              return row._id;
            }),
          ),
        ).toEqual(idsOf([ownedByEditors, ownedByBothTeams, ownedByMember]));

        await database.query(
          `UPDATE "${schema}"."Incident" SET "description" = NULL`,
        );
      });

      test("a delete by query removes only what the editors or the member own", async () => {
        const props: DatabaseCommonInteractionProps = await memberProps();

        // Nothing is removed in fact: the query names an incident of each.
        const reached: Array<string> = [];

        for (const item of INCIDENTS) {
          const found: Array<Incident> = await incidentService.findBy({
            query: { _id: item.id.toString() },
            select: { _id: true },
            limit: 1,
            skip: 0,
            props: props,
          });

          if (found.length > 0) {
            reached.push(item.id.toString());
          }
        }

        expect(reached.sort()).toEqual(
          idsOf([
            ownedByEditors,
            ownedByViewers,
            ownedByBothTeams,
            ownedByMember,
          ]),
        );

        const deleted: number = await incidentService.deleteBy({
          query: { _id: ownedByViewers.id.toString() },
          limit: 1,
          skip: 0,
          props: props,
        });

        expect(deleted).toBe(0);
        expect(await rowExists("Incident", ownedByViewers.id)).toBe(true);
      });
    });

    describe("the editors change what they own, the viewers view everything", () => {
      beforeEach(async () => {
        await grant({
          editors: [
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.Owned,
            },
          ],
          viewers: [
            { permission: Permission.Viewer, scope: PermissionScope.All },
          ],
        });
      });

      test("every incident is read", async () => {
        const outcome: Outcome = await list("/incident");

        expect(outcome.ids).toEqual(idsOf(INCIDENTS));
      });

      test("only what the editors or the member own is changed", async () => {
        expect(await retitled(INCIDENTS)).toEqual(
          idsOf([ownedByEditors, ownedByBothTeams, ownedByMember]),
        );
      });

      test("only the notes of what the editors or the member own are changed", async () => {
        expect(await noteChanged(INCIDENTS)).toEqual(
          noteIdsOf([ownedByEditors, ownedByBothTeams, ownedByMember]),
        );
      });
    });

    describe("both teams change what they own", () => {
      beforeEach(async () => {
        await grant({
          editors: [
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.Owned,
            },
          ],
          viewers: [
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.Owned,
            },
          ],
        });
      });

      test("what either team owns is changed, and nothing else", async () => {
        expect(await retitled(INCIDENTS)).toEqual(
          idsOf([
            ownedByEditors,
            ownedByViewers,
            ownedByBothTeams,
            ownedByMember,
          ]),
        );
      });
    });

    describe("a write needs a read, team by team", () => {
      test("a team that may change but not read what it owns changes only what another grant lets the member read", async () => {
        await grant({
          editors: [
            {
              permission: Permission.EditProjectIncident,
              scope: PermissionScope.Owned,
            },
          ],
          viewers: [
            {
              permission: Permission.ReadProjectIncident,
              scope: PermissionScope.Owned,
            },
          ],
        });

        /*
         * The editors' incidents are not read by anyone's grant, and the
         * viewers' incidents are not changed by anyone's: only the incident
         * both teams own, and the member's own, are both read and changed.
         */
        expect(await retitled(INCIDENTS)).toEqual(
          idsOf([ownedByBothTeams, ownedByMember]),
        );
      });

      test("a read over the whole project lets the editors change everything they own", async () => {
        await grant({
          editors: [
            {
              permission: Permission.EditProjectIncident,
              scope: PermissionScope.Owned,
            },
          ],
          viewers: [
            {
              permission: Permission.ReadProjectIncident,
              scope: PermissionScope.All,
            },
          ],
        });

        expect(await retitled(INCIDENTS)).toEqual(
          idsOf([ownedByEditors, ownedByBothTeams, ownedByMember]),
        );
      });

      test("a change over the whole project changes only what an owned read reaches", async () => {
        await grant({
          editors: [
            {
              permission: Permission.EditProjectIncident,
              scope: PermissionScope.All,
            },
          ],
          viewers: [
            {
              permission: Permission.ReadProjectIncident,
              scope: PermissionScope.Owned,
            },
          ],
        });

        expect(await retitled(INCIDENTS)).toEqual(
          idsOf([ownedByViewers, ownedByBothTeams, ownedByMember]),
        );
      });
    });

    describe("grants of other kinds beside an owned one", () => {
      test("a grant limited to labels on one team and an owned one on the other", async () => {
        await grant({
          editors: [
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.Owned,
            },
          ],
          viewers: [
            {
              permission: Permission.Viewer,
              labelIds: [productionLabelId],
            },
          ],
        });

        // The viewers' incident carries the label the viewers may read.
        const read: Outcome = await getItem("/incident", ownedByViewers.id);
        expect(read.error).toBeUndefined();

        // It is not the editors' to change all the same.
        expect(await retitled([ownedByViewers])).toEqual([]);
      });

      test("a block with no labels on the viewers takes the change away from everything", async () => {
        await grant({
          editors: [
            {
              permission: Permission.ProjectMember,
              scope: PermissionScope.Owned,
            },
          ],
          viewers: [
            { permission: Permission.Viewer, scope: PermissionScope.Owned },
            {
              permission: Permission.ProjectMember,
              isBlock: true,
            },
          ],
        });

        expect(await retitled(INCIDENTS)).toEqual([]);
      });
    });

    describe("across projects", () => {
      test("a read of every project reaches what the member's team owns in each", async () => {
        await customerTeams();

        const outcome: Outcome = await list("/incident", {
          isMultiTenant: true,
        });

        expect(outcome.error).toBeUndefined();
        expect(outcome.ids).toEqual(
          idsOf([
            ownedByEditors,
            ownedByViewers,
            ownedByBothTeams,
            ownedByMember,
            secondProjectIncident,
          ]),
        );
      });
    });
  },
);
