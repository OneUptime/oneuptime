import { mockRouter } from "./Helpers";
import BaseAPI from "../../../Server/API/BaseAPI";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import OwnedByFilter from "../../../Server/Types/Database/OwnedByFilter";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import Query from "../../../Server/Types/Database/Query";
import QueryUtil from "../../../Server/Types/Database/QueryUtil";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import Label from "../../../Models/DatabaseModels/Label";
import Includes from "../../../Types/BaseDatabase/Includes";
import OwnedBy, {
  OWNED_BY_QUERY_KEY,
  OwnedByData,
  OwnedByMatch,
} from "../../../Types/BaseDatabase/OwnedBy";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, EntityMetadata, FindOptionsWhere } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * EVERY LIST OF A KIND WITH OWNERS, FILTERED BY ITS OWNERS, against a
 * migrated Postgres.
 *
 * An on-call schedule, a monitor, an incident, an episode, a template, a
 * probe, a runner - every kind with owners of its own (OwnerTableRegistry)
 * - is listed through its own route (POST /<kind>/get-list) by a member of
 * the project, with the Owner chip's filter in the query, exactly as the
 * Dashboard sends it: `{ "owners": { "_type": "OwnedBy", ... } }`. The
 * request goes through the real user middleware, which reads the member's
 * team and its permission rows from the tables below, the permission
 * pipeline, the query serializer and TypeORM, so the filter runs as the SQL
 * Postgres runs. For each kind:
 *
 *   - a person: the records that person owns, not those of a team they are
 *     in (a team's members are not its owners);
 *   - a team: the records the team owns, not those one of its members owns;
 *   - a person and a team: the records either owns, each once;
 *   - two teams: the records of either;
 *   - none of them (Owner is not): every other record, those without owners
 *     included;
 *   - someone (Owner is not empty) and nobody (Owner is empty);
 *   - an owner row marked deleted is no owner; a record of another project
 *     is never listed, whoever owns it;
 *   - the count the list answers with counts the same records, and pages of
 *     the list hold each record once;
 *   - beside another filter on the records' ids, both hold.
 *
 * And for the lists: the subquery reaches the owner tables through their
 * indexes (EXPLAIN with sequential scans off), a member who may read the
 * kind but not its owners is refused, and a filter by owners on a kind
 * without owners is refused rather than listing everything.
 *
 * Opt in with RUN_POSTGRES_OWNER_FILTER_TESTS=true against a database the
 * registered migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_OWNER_FILTER_TESTS=true \
 *   OWNER_FILTER_TEST_DATABASE_HOST=127.0.0.1 \
 *   OWNER_FILTER_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/API/OwnerFilterListsPostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into a uniquely named schema that is dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OWNER_FILTER_TESTS"] === "true"
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
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// The data source below is built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The tables every part of this suite reads besides each kind's own.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "CustomRole",
  "CustomRolePermission",
  "CustomRolePermissionLabel",
  "TeamCustomRole",
];

// A JSON column whose rows are read through a shape of their own.
const JSON_COLUMN_VALUES: Dictionary<unknown> = {
  dashboardViewConfig: { _type: "DashboardViewConfig", components: [] },
};

interface Kind {
  name: string;
  modelType: { new (): BaseModel };
  pair: OwnerTablePair;
  // The route its list is read through: /monitor, /on-call-duty-policy-schedule.
  path: string;
  // Its owner tables, as Postgres names them.
  ownerUserTable: string;
  ownerTeamTable: string;
}

// The kinds whose own services rewrite a read's query (privacy filters).
const KIND_SERVICES: Dictionary<DatabaseService<BaseModel>> = {
  Incident: IncidentService as unknown as DatabaseService<BaseModel>,
  Alert: AlertService as unknown as DatabaseService<BaseModel>,
  IncidentEpisode:
    IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
  AlertEpisode: AlertEpisodeService as unknown as DatabaseService<BaseModel>,
};

const KINDS: Array<Kind> = Array.from(OwnerTableRegistry.entries()).map(
  ([name, pair]: [string, OwnerTablePair]): Kind => {
    const modelType: { new (): BaseModel } | undefined = (
      Entities as Array<{ new (): BaseModel }>
    ).find((each: { new (): BaseModel }): boolean => {
      return each.name === name;
    });

    if (!modelType) {
      throw new Error(`No model named ${name}.`);
    }

    return {
      name: name,
      modelType: modelType,
      pair: pair,
      path: new modelType().crudApiPath!.toString(),
      ownerUserTable: new (pair.ownerUserService.modelType as {
        new (): BaseModel;
      })().tableName!,
      ownerTeamTable: new (pair.ownerTeamService.modelType as {
        new (): BaseModel;
      })().tableName!,
    };
  },
);

// The records each kind is seeded with, by who owns them.
type Seeded =
  // A person owns it.
  | "ada"
  // The SRE team owns it; Ada is in that team.
  | "sre"
  // Bob owns it; Bob is in the SRE team too.
  | "bob"
  // Ada and the SRE team both own it.
  | "adaAndSre"
  // Nobody owns it.
  | "nobody"
  // The Payments team owns it.
  | "payments"
  // Ada owned it: her owner row is marked deleted.
  | "adaRemoved";

const SEEDED: Array<Seeded> = [
  "ada",
  "sre",
  "bob",
  "adaAndSre",
  "nobody",
  "payments",
  "adaRemoved",
];

describePostgres(
  "every list of a kind with owners, filtered by its owners",
  () => {
    const schema: string = `owner_filter_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    let database: DataSource;

    // A kind without owners, listed through its own route.
    new BaseAPI(
      Label as { new (): BaseModel },
      new DatabaseService(Label as { new (): BaseModel }),
    );

    // Every kind's list route, as the app registers it.
    for (const kind of KINDS) {
      new BaseAPI(
        kind.modelType,
        KIND_SERVICES[kind.name] ||
          (new DatabaseService(kind.modelType) as DatabaseService<BaseModel>),
      );
    }

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();

    // The member every request is made as, and the people they filter by.
    const memberId: ObjectID = ObjectID.generate();
    const adaId: ObjectID = ObjectID.generate();
    const bobId: ObjectID = ObjectID.generate();

    // The member's own team, the SRE team (Ada and Bob), the Payments team.
    const memberTeamId: ObjectID = ObjectID.generate();
    const sreTeamId: ObjectID = ObjectID.generate();
    const paymentsTeamId: ObjectID = ObjectID.generate();

    // Each kind's records, by kind and by who owns them; and one elsewhere.
    const records: Dictionary<Dictionary<string>> = {};
    const otherProjectRecords: Dictionary<string> = {};

    const requiredColumns: Dictionary<
      Array<{ name: string; type: string; udt: string; length: number | null }>
    > = {};

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

          if (value instanceof ObjectID) {
            return value.toString();
          }

          if (
            value &&
            typeof value === "object" &&
            !(value instanceof Date) &&
            !Array.isArray(value)
          ) {
            return JSON.stringify(value);
          }

          return value;
        }),
      );
    };

    /*
     * A row of any table this suite copied, with every column a row needs
     * given a value of its type, and `row` over them.
     */
    const insertAnyRow: (
      table: string,
      row: Dictionary<unknown>,
    ) => Promise<void> = async (
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> => {
      const filled: Dictionary<unknown> = {};
      const id: string = ObjectID.generate().toString();

      for (const column of requiredColumns[table] || []) {
        if (column.name in row) {
          continue;
        }

        if (column.name in JSON_COLUMN_VALUES) {
          filled[column.name] = JSON_COLUMN_VALUES[column.name];
        } else if (column.udt === "uuid") {
          filled[column.name] = ObjectID.generate();
        } else if (
          column.udt === "varchar" ||
          column.udt === "text" ||
          column.udt === "bpchar"
        ) {
          const text: string = `${column.name}-${id}`;
          filled[column.name] = column.length
            ? text.slice(0, column.length)
            : text;
        } else if (
          ["int2", "int4", "int8", "numeric", "float4", "float8"].includes(
            column.udt,
          )
        ) {
          filled[column.name] = 1;
        } else if (column.udt === "bool") {
          filled[column.name] = false;
        } else if (["timestamptz", "timestamp", "date"].includes(column.udt)) {
          filled[column.name] = new Date();
        } else if (column.udt === "jsonb" || column.udt === "json") {
          filled[column.name] = {};
        } else if (column.type === "ARRAY") {
          filled[column.name] = "{}";
        } else if (column.type === "USER-DEFINED") {
          const labels: Array<{ enumlabel: string }> = await database.query(
            `SELECT e."enumlabel" FROM pg_enum e JOIN pg_type t ON t.oid = e."enumtypid" WHERE t."typname" = $1 ORDER BY e."enumsortorder" LIMIT 1`,
            [column.udt],
          );
          filled[column.name] = labels[0]?.enumlabel;
        } else {
          throw new Error(
            `${table}.${column.name}: no value for a column of type ${column.type}.`,
          );
        }
      }

      await insert(table, { ...filled, ...row });
    };

    // An owner row of a record: a person's or a team's.
    const insertOwner: (data: {
      kind: Kind;
      recordId: ObjectID;
      inProject: ObjectID;
      userId?: ObjectID;
      teamId?: ObjectID;
      isDeleted?: boolean;
    }) => Promise<void> = async (data: {
      kind: Kind;
      recordId: ObjectID;
      inProject: ObjectID;
      userId?: ObjectID;
      teamId?: ObjectID;
      isDeleted?: boolean;
    }): Promise<void> => {
      await insertAnyRow(
        data.userId ? data.kind.ownerUserTable : data.kind.ownerTeamTable,
        {
          _id: ObjectID.generate(),
          projectId: data.inProject,
          [data.kind.pair.fkColumn]: data.recordId,
          ...(data.userId ? { userId: data.userId } : { teamId: data.teamId }),
          ...(data.isDeleted ? { deletedAt: new Date() } : {}),
          version: 1,
        },
      );
    };

    // A record of a kind, created a second after the one before it.
    let createdAt: number = Date.UTC(2026, 9, 1, 9, 0, 0);

    const insertRecord: (
      kind: Kind,
      inProject: ObjectID,
    ) => Promise<ObjectID> = async (
      kind: Kind,
      inProject: ObjectID,
    ): Promise<ObjectID> => {
      const id: ObjectID = ObjectID.generate();
      createdAt += 1000;

      await insertAnyRow(new kind.modelType().tableName!, {
        _id: id,
        projectId: inProject,
        version: 1,
        createdAt: new Date(createdAt),
        ...(kind.name === "Monitor" ? { monitorType: "Manual" } : {}),
        // A private incident, alert or episode is its owners' alone.
        ...(["Incident", "Alert", "IncidentEpisode", "AlertEpisode"].includes(
          kind.name,
        )
          ? { isPrivate: false }
          : {}),
        // An archived record leaves no list; these are all live.
        ...(new kind.modelType().getTableColumnMetadata("isArchived")
          ? { isArchived: false }
          : {}),
      });

      return id;
    };

    // The member's team's own permission rows, replaced.
    const setGrants: (
      rows: Array<{ permission: Permission; isBlock?: boolean }>,
    ) => Promise<void> = async (
      rows: Array<{ permission: Permission; isBlock?: boolean }>,
    ): Promise<void> => {
      await database.query(
        `DELETE FROM "${schema}"."TeamPermission" WHERE "teamId" = $1`,
        [memberTeamId.toString()],
      );

      for (const row of rows) {
        await insert("TeamPermission", {
          _id: ObjectID.generate(),
          projectId: projectId,
          teamId: memberTeamId,
          permission: row.permission,
          isBlockPermission: Boolean(row.isBlock),
          scope: PermissionScope.All,
          version: 1,
        });
      }
    };

    const requestOf: (body: JSONObject) => ExpressRequest = (
      body: JSONObject,
    ): ExpressRequest => {
      return {
        method: "POST",
        params: {},
        query: {},
        cookies: {},
        headers: {
          authorization: `Bearer ${memberId.toString()}`,
          tenantid: projectId.toString(),
        },
        body: body,
      } as unknown as ExpressRequest;
    };

    const responseStub: () => ExpressResponse = (): ExpressResponse => {
      return {
        set: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        send: jest.fn(),
      } as unknown as ExpressResponse;
    };

    interface Listed {
      error?: unknown;
      ids?: Array<string>;
      count?: number;
    }

    /*
     * A kind's list, through its route, as the Dashboard's Owner chip asks for
     * it: the query serialized the way ModelAPI serializes it.
     */
    const list: (data: {
      kind: Kind;
      owners?: OwnedByData;
      query?: Dictionary<unknown>;
      limit?: number;
      skip?: number;
    }) => Promise<Listed> = async (data: {
      kind: Kind;
      owners?: OwnedByData;
      query?: Dictionary<unknown>;
      limit?: number;
      skip?: number;
    }): Promise<Listed> => {
      jest.mocked(Response.sendEntityArrayResponse).mockClear();
      jest.mocked(Response.sendErrorResponse).mockClear();

      const query: Dictionary<unknown> = { ...(data.query || {}) };

      if (data.owners) {
        query[OWNED_BY_QUERY_KEY] = new OwnedBy(data.owners);
      }

      const body: JSONObject = JSON.parse(
        JSON.stringify({
          query: JSONFunctions.serialize(query as JSONObject),
          select: { _id: true },
          sort: { createdAt: SortOrder.Ascending },
          limit: data.limit || 100,
          skip: data.skip || 0,
        }),
      );

      const req: ExpressRequest = requestOf(body);
      const res: ExpressResponse = responseStub();
      const route: (typeof mockRouter.routes)[number] = mockRouter.match(
        "post",
        `${data.kind.path}/get-list`,
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

      const call: Array<unknown> | undefined = jest.mocked(
        Response.sendEntityArrayResponse,
      ).mock.calls[0];

      if (!call) {
        throw new Error(`${data.kind.path}/get-list answered nothing.`);
      }

      return {
        ids: (call[2] as Array<BaseModel>).map((model: BaseModel): string => {
          return model.id!.toString();
        }),
        count: Number((call[3] as { toNumber: () => number }).toNumber()),
      };
    };

    // The seeded records of `kind` that `owners` should list, sorted.
    const idsOf: (kind: Kind, which: Array<Seeded>) => Array<string> = (
      kind: Kind,
      which: Array<Seeded>,
    ): Array<string> => {
      return which
        .map((seeded: Seeded): string => {
          return records[kind.name]![seeded]!;
        })
        .sort();
    };

    const sorted: (ids: Array<string> | undefined) => Array<string> = (
      ids: Array<string> | undefined,
    ): Array<string> => {
      return [...(ids || [])].sort();
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["OWNER_FILTER_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["OWNER_FILTER_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["OWNER_FILTER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        /*
         * No schema of its own: table names stay unqualified, so the tables
         * copied into the test schema are found first, and every other table
         * a read touches is found, empty, in public.
         */
        synchronize: false,
        logging: ["error"],
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      // Each kind's table, its label links and its owner tables too.
      const tables: Array<string> = [...TABLES];

      for (const kind of KINDS) {
        const metadata: EntityMetadata = database.getMetadata(kind.modelType);
        const accessControlColumn: string | null =
          new kind.modelType().getAccessControlColumn();
        const labels: RelationMetadata | undefined =
          metadata.manyToManyRelations.find(
            (relation: RelationMetadata): boolean => {
              return relation.propertyName === accessControlColumn;
            },
          );

        for (const table of [
          metadata.tableName,
          labels?.junctionEntityMetadata?.tableName,
          kind.ownerUserTable,
          kind.ownerTeamTable,
        ]) {
          if (table && !tables.includes(table)) {
            tables.push(table);
          }
        }
      }

      for (const table of tables) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        requiredColumns[table] = (
          await database.query(
            `SELECT "column_name", "data_type", "udt_name", "character_maximum_length" FROM information_schema.columns WHERE "table_schema" = 'public' AND "table_name" = $1 AND "is_nullable" = 'NO' AND "column_default" IS NULL`,
            [table],
          )
        ).map(
          (column: {
            column_name: string;
            data_type: string;
            udt_name: string;
            character_maximum_length: number | null;
          }) => {
            return {
              name: column.column_name,
              type: column.data_type,
              udt: column.udt_name,
              length: column.character_maximum_length,
            };
          },
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
      getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
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

      // The locks and the shared cache generations (Valkey): always free.
      getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
        key: string;
        namespace: string;
      }): Promise<unknown> => {
        return { key: data.key, namespace: data.namespace };
      }) as never);
      getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined as never);
      getJestSpyOn(CacheGenerations.prototype, "bump").mockResolvedValue(
        undefined as never,
      );

      for (const [id, name] of [
        [projectId, "Owner filter project"],
        [otherProjectId, "Another project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id,
          name: name,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [id, name] of [
        [memberId, "Synthetic Member"],
        [adaId, "Ada Synthetic"],
        [bobId, "Bob Synthetic"],
      ] as Array<[ObjectID, string]>) {
        await insert("User", {
          _id: id,
          name: name,
          email: `${id.toString()}@example.com`,
          slug: id.toString(),
          version: 1,
        });
      }

      for (const [teamId, members] of [
        [memberTeamId, [memberId]],
        [sreTeamId, [adaId, bobId]],
        [paymentsTeamId, []],
      ] as Array<[ObjectID, Array<ObjectID>]>) {
        await insert("Team", {
          _id: teamId,
          projectId: projectId,
          name: `Team ${teamId.toString()}`,
          slug: teamId.toString(),
          version: 1,
        });

        for (const userId of members) {
          await insert("TeamMember", {
            _id: ObjectID.generate(),
            projectId: projectId,
            teamId: teamId,
            userId: userId,
            hasAcceptedInvitation: true,
            version: 1,
          });
        }
      }

      // The member reads every kind and its owners.
      await setGrants([{ permission: Permission.ProjectOwner }]);

      for (const kind of KINDS) {
        const seeded: Dictionary<string> = {};

        for (const which of SEEDED) {
          const id: ObjectID = await insertRecord(kind, projectId);
          seeded[which] = id.toString();

          if (which === "ada" || which === "adaAndSre") {
            await insertOwner({
              kind,
              recordId: id,
              inProject: projectId,
              userId: adaId,
            });
          }

          if (which === "sre" || which === "adaAndSre") {
            await insertOwner({
              kind,
              recordId: id,
              inProject: projectId,
              teamId: sreTeamId,
            });
          }

          if (which === "bob") {
            await insertOwner({
              kind,
              recordId: id,
              inProject: projectId,
              userId: bobId,
            });
          }

          if (which === "payments") {
            await insertOwner({
              kind,
              recordId: id,
              inProject: projectId,
              teamId: paymentsTeamId,
            });
          }

          if (which === "adaRemoved") {
            await insertOwner({
              kind,
              recordId: id,
              inProject: projectId,
              userId: adaId,
              isDeleted: true,
            });
          }
        }

        records[kind.name] = seeded;

        // Owned by Ada and the SRE team, in another project.
        const elsewhere: ObjectID = await insertRecord(kind, otherProjectId);
        otherProjectRecords[kind.name] = elsewhere.toString();
        await insertOwner({
          kind,
          recordId: elsewhere,
          inProject: otherProjectId,
          userId: adaId,
        });
        await insertOwner({
          kind,
          recordId: elsewhere,
          inProject: otherProjectId,
          teamId: sreTeamId,
        });
      }
    }, 600000);

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("every kind with owners is swept", () => {
      expect(KINDS.length).toBeGreaterThanOrEqual(37);
    });

    describe.each(
      KINDS.map((kind: Kind): [string, Kind] => {
        return [kind.name, kind];
      }),
    )("%s", (_name: string, kind: Kind) => {
      test("unfiltered, the list holds every record of the project and no other", async () => {
        const listed: Listed = await list({ kind });

        expect(listed.error).toBeUndefined();
        expect(sorted(listed.ids)).toEqual(idsOf(kind, SEEDED));
        expect(listed.ids).not.toContain(otherProjectRecords[kind.name]);
        expect(listed.count).toBe(SEEDED.length);
      });

      test.each([
        [
          "a person: what Ada owns, not what her team owns",
          { userIds: [] as Array<string> },
          ["ada", "adaAndSre"],
        ],
        [
          "a team: what the SRE team owns, not what its members own",
          { teamIds: [] as Array<string> },
          ["sre", "adaAndSre"],
        ],
        [
          "a person and a team: what either owns, each once",
          { userIds: [] as Array<string>, teamIds: [] as Array<string> },
          ["ada", "sre", "adaAndSre"],
        ],
      ] as Array<[string, OwnedByData, Array<Seeded>]>)(
        "by %s",
        async (_case: string, shape: OwnedByData, expected: Array<Seeded>) => {
          const listed: Listed = await list({
            kind,
            owners: {
              ...(shape.userIds ? { userIds: [adaId] } : {}),
              ...(shape.teamIds ? { teamIds: [sreTeamId] } : {}),
            },
          });

          expect(listed.error).toBeUndefined();
          expect(sorted(listed.ids)).toEqual(idsOf(kind, expected));
          expect(listed.count).toBe(expected.length);
        },
      );

      test("by two teams: what either owns", async () => {
        const listed: Listed = await list({
          kind,
          owners: { teamIds: [sreTeamId, paymentsTeamId] },
        });

        expect(sorted(listed.ids)).toEqual(
          idsOf(kind, ["sre", "adaAndSre", "payments"]),
        );
      });

      test("by Bob, a member of the SRE team: only what Bob owns", async () => {
        const listed: Listed = await list({
          kind,
          owners: { userIds: [bobId] },
        });

        expect(sorted(listed.ids)).toEqual(idsOf(kind, ["bob"]));
      });

      test("none of the SRE team (Owner is not): every other record, those without owners included", async () => {
        const listed: Listed = await list({
          kind,
          owners: { match: OwnedByMatch.NoneOf, teamIds: [sreTeamId] },
        });

        expect(sorted(listed.ids)).toEqual(
          idsOf(kind, ["ada", "bob", "nobody", "payments", "adaRemoved"]),
        );
        expect(listed.count).toBe(5);
      });

      test("none of Ada and the SRE team", async () => {
        const listed: Listed = await list({
          kind,
          owners: {
            match: OwnedByMatch.NoneOf,
            userIds: [adaId],
            teamIds: [sreTeamId],
          },
        });

        expect(sorted(listed.ids)).toEqual(
          idsOf(kind, ["bob", "nobody", "payments", "adaRemoved"]),
        );
      });

      test("someone (Owner is not empty): every record with an owner", async () => {
        const listed: Listed = await list({
          kind,
          owners: { match: OwnedByMatch.AnyOwner },
        });

        expect(sorted(listed.ids)).toEqual(
          idsOf(kind, ["ada", "sre", "bob", "adaAndSre", "payments"]),
        );
        expect(listed.count).toBe(5);
      });

      test("nobody (Owner is empty): the records without owners, a removed owner row none", async () => {
        const listed: Listed = await list({
          kind,
          owners: { match: OwnedByMatch.NoOwner },
        });

        expect(sorted(listed.ids)).toEqual(
          idsOf(kind, ["nobody", "adaRemoved"]),
        );
        expect(listed.count).toBe(2);
      });

      test("pages of a filtered list hold each record once, and the count is the whole", async () => {
        const owners: OwnedByData = {
          userIds: [adaId],
          teamIds: [sreTeamId],
        };
        const first: Listed = await list({ kind, owners, limit: 2, skip: 0 });
        const second: Listed = await list({ kind, owners, limit: 2, skip: 2 });

        expect(first.count).toBe(3);
        expect(second.count).toBe(3);
        expect(first.ids).toHaveLength(2);
        expect(second.ids).toHaveLength(1);
        expect(sorted([...first.ids!, ...second.ids!])).toEqual(
          idsOf(kind, ["ada", "sre", "adaAndSre"]),
        );
      });

      test("beside a filter on the records' ids, both hold", async () => {
        const listed: Listed = await list({
          kind,
          owners: { teamIds: [sreTeamId] },
          query: {
            _id: new Includes([
              records[kind.name]!["sre"]!,
              records[kind.name]!["ada"]!,
            ]),
          },
        });

        expect(sorted(listed.ids)).toEqual(idsOf(kind, ["sre"]));
      });

      test("the owner tables are read through their indexes, never scanned whole", async () => {
        for (const owners of [
          new OwnedBy({ userIds: [adaId], teamIds: [sreTeamId] }),
          new OwnedBy({ match: OwnedByMatch.NoneOf, teamIds: [sreTeamId] }),
          new OwnedBy({ match: OwnedByMatch.NoOwner }),
        ]) {
          const where: FindOptionsWhere<BaseModel> = QueryUtil.serializeQuery(
            kind.modelType,
            {
              projectId: projectId,
              owners: owners,
            } as unknown as Query<BaseModel>,
          ) as unknown as FindOptionsWhere<BaseModel>;

          const [sql, parameters]: [string, Array<unknown>] = database
            .getRepository(kind.modelType)
            .createQueryBuilder()
            .setFindOptions({ where: where, select: { _id: true } })
            .getQueryAndParameters();

          const plan: Array<PlanNode> = await database.transaction(
            async (manager: {
              query: (sql: string, parameters?: Array<unknown>) => Promise<any>;
            }): Promise<Array<PlanNode>> => {
              await manager.query("SET LOCAL enable_seqscan = off");

              const rows: Array<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }> =
                await manager.query(`EXPLAIN (FORMAT JSON) ${sql}`, parameters);

              return planNodesOf(rows[0]!["QUERY PLAN"][0]!.Plan);
            },
          );

          // Every read of an owner table in the plan is an index read.
          const ownerTableReads: Array<string> = plan
            .filter((node: PlanNode): boolean => {
              return (
                node["Relation Name"] === kind.ownerUserTable ||
                node["Relation Name"] === kind.ownerTeamTable
              );
            })
            .map((node: PlanNode): string => {
              return `${node["Node Type"]} on ${node["Relation Name"]}`;
            });

          expect(ownerTableReads.length).toBeGreaterThan(0);

          for (const read of ownerTableReads) {
            expect({ match: owners.match, read }).toEqual({
              match: owners.match,
              read: expect.stringMatching(INDEX_READ),
            });
          }
        }
      });
    });

    describe("held to the read of the owner tables", () => {
      const schedule: () => Kind = (): Kind => {
        return KINDS.find((kind: Kind): boolean => {
          return kind.name === "OnCallDutyPolicySchedule";
        })!;
      };

      test("a reader of on-call schedules who may not read their owners is refused, not shown every schedule", async () => {
        await setGrants([
          { permission: Permission.ReadProjectOnCallDutyPolicySchedule },
        ]);

        try {
          const unfiltered: Listed = await list({ kind: schedule() });
          expect(unfiltered.error).toBeUndefined();
          expect(unfiltered.ids).toHaveLength(SEEDED.length);

          const filtered: Listed = await list({
            kind: schedule(),
            owners: { teamIds: [sreTeamId] },
          });

          expect(filtered.ids).toBeUndefined();
          expect(filtered.error).toBeInstanceOf(NotAuthorizedException);
        } finally {
          await setGrants([{ permission: Permission.ProjectOwner }]);
        }
      });

      test("a reader of schedules and their team owners filters by a team, and still not by a person", async () => {
        await setGrants([
          { permission: Permission.ReadProjectOnCallDutyPolicySchedule },
          { permission: Permission.ReadOnCallDutyPolicyScheduleOwnerTeam },
        ]);

        try {
          const byTeam: Listed = await list({
            kind: schedule(),
            owners: { teamIds: [sreTeamId] },
          });

          expect(sorted(byTeam.ids)).toEqual(
            idsOf(schedule(), ["sre", "adaAndSre"]),
          );

          const byPerson: Listed = await list({
            kind: schedule(),
            owners: { userIds: [adaId] },
          });

          expect(byPerson.error).toBeInstanceOf(NotAuthorizedException);
        } finally {
          await setGrants([{ permission: Permission.ProjectOwner }]);
        }
      });

      test("a project member (the default role) filters on-call schedules by owners", async () => {
        await setGrants([{ permission: Permission.ProjectMember }]);

        try {
          const listed: Listed = await list({
            kind: schedule(),
            owners: { userIds: [adaId], teamIds: [sreTeamId] },
          });

          expect(sorted(listed.ids)).toEqual(
            idsOf(schedule(), ["ada", "sre", "adaAndSre"]),
          );
        } finally {
          await setGrants([{ permission: Permission.ProjectOwner }]);
        }
      });
    });

    test("a filter by owners on a kind without owners is refused, never answered with every record", async () => {
      expect(OwnedByFilter.getOwnerTables(Label)).toBeNull();

      // Labels are listed through their own route; they have no owners.
      const labels: Kind = {
        name: "Label",
        modelType: Label,
        pair: KINDS[0]!.pair,
        path: new Label().crudApiPath!.toString(),
        ownerUserTable: "",
        ownerTeamTable: "",
      };

      const unfiltered: Listed = await list({ kind: labels });

      expect(unfiltered.error).toBeUndefined();

      const filtered: Listed = await list({
        kind: labels,
        owners: { teamIds: [sreTeamId] },
      });

      expect(filtered.ids).toBeUndefined();
      expect(filtered.error).toBeInstanceOf(BadDataException);
      expect((filtered.error as Error).message).toBe(
        "Labels have no owners, so they cannot be filtered by their owners.",
      );
    });
  },
);

// A read of a table through an index: Index Scan, Index Only Scan, Bitmap Heap Scan.
const INDEX_READ: RegExp = /^(Index Scan|Index Only Scan|Bitmap Heap Scan) on /;

// One node of a query plan, as EXPLAIN (FORMAT JSON) writes it.
interface PlanNode {
  "Node Type": string;
  "Relation Name"?: string;
  Plans?: Array<PlanNode>;
}

// Every node of a plan, the root first.
const planNodesOf: (node: PlanNode) => Array<PlanNode> = (
  node: PlanNode,
): Array<PlanNode> => {
  return [
    node,
    ...(node.Plans || []).flatMap((child: PlanNode): Array<PlanNode> => {
      return planNodesOf(child);
    }),
  ];
};
