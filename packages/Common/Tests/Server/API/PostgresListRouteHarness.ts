import { mockRouter } from "./Helpers";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import MonitorLatestArrivals from "../../../Server/Utils/Monitor/MonitorLatestArrivals";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import Response from "../../../Server/Utils/Response";
import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { getJestSpyOn } from "../../Spy";
import { jest } from "@jest/globals";
import { DataSource } from "typeorm";

/*
 * LISTS READ THROUGH THE REAL SERVER, ON MIGRATED POSTGRES (#10580, #10581).
 *
 * What a picker or a list filter asks for is only proven by asking the
 * database: a query that reads right in a unit test can still be one
 * Postgres answers differently (an empty column under `<>`), and a search
 * that pages the right rows in a fake API can still miss a row past a cap.
 * Each read here goes through the list route the app registers (POST
 * <model path>/get-list) as a member of the project: the real user
 * middleware reading the member's team and its permission rows from the
 * tables, the permission pipeline, the query serializer and TypeORM.
 *
 * The tables a suite writes are copied from public into a uniquely named
 * schema that is dropped afterwards; every row is synthetic. Every other
 * table a read touches is found, empty, in public.
 *
 * A suite opts in with RUN_POSTGRES_PICKER_SEARCH_TESTS=true against a
 * database the registered migrations have been applied to, and reads the
 * flag itself (process.env["RUN_POSTGRES_PICKER_SEARCH_TESTS"]): that is how
 * Tests/Ops/PostgresSuitesRunInCi finds a suite, and checks a workflow runs
 * it. Each suite file also mocks what this harness needs mocked (jest.mock
 * is hoisted only in the file it is written in): EnvironmentConfig (no
 * billing), Express's router (mockRouter), Response (captured) and the
 * app's DataSourceOptions (the data source is built here). Copy them from
 * an existing suite, e.g. ListIsNotFilterPostgres.test.ts.
 *
 *   RUN_POSTGRES_PICKER_SEARCH_TESTS=true \
 *   PICKER_SEARCH_TEST_DATABASE_HOST=127.0.0.1 \
 *   PICKER_SEARCH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/API/ListIsNotFilterPostgres.test.ts --forceExit
 */

// The tables every member's request reads, besides the suite's own.
export const MEMBER_TABLES: Array<string> = [
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

export interface ListedPage<TModel extends BaseModel = BaseModel> {
  rows: Array<TModel>;
  count: number;
}

export interface ListRequest {
  // The model's route, as its crudApiPath names it: "/monitor".
  path: string;
  query: Dictionary<unknown>;
  select: Dictionary<unknown>;
  sort?: Dictionary<unknown> | undefined;
  limit: number;
  skip?: number | undefined;
  // Who asks, and in which project: the member set up first, unless named.
  userId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
}

export default class PostgresListRouteHarness {
  public readonly schema: string;
  private readonly tables: Array<string>;
  private dataSource: DataSource | null = null;

  public constructor(data: { schemaPrefix: string; tables: Array<string> }) {
    this.schema = `${data.schemaPrefix}_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;

    // Each table once, the member's first.
    this.tables = Array.from(new Set([...MEMBER_TABLES, ...data.tables]));
  }

  public get database(): DataSource {
    if (!this.dataSource) {
      throw new Error("The harness is not set up.");
    }

    return this.dataSource;
  }

  // Connects, copies the tables into the suite's schema and mocks the rest.
  public async setUp(): Promise<void> {
    this.dataSource = new DataSource({
      type: "postgres",
      host: process.env["PICKER_SEARCH_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["PICKER_SEARCH_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PICKER_SEARCH_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      /*
       * No schema of its own: table names stay unqualified, so the tables
       * copied into the suite's schema are found first, and every other
       * table a read touches is found, empty, in public.
       */
      synchronize: false,
      logging: ["error"],
      extra: { options: `-c search_path=${this.schema},public` },
    });

    await this.dataSource.initialize();
    await this.dataSource.query(`CREATE SCHEMA "${this.schema}"`);

    for (const table of this.tables) {
      await this.dataSource.query(
        `CREATE TABLE "${this.schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const database: DataSource = this.dataSource;

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
    getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
    getJestSpyOn(GlobalCache, "deleteKey").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(RealtimeAccessChanges, "announce").mockReturnValue(
      undefined as never,
    );

    // The heartbeats kept in Redis, laid over monitor rows: none here.
    getJestSpyOn(MonitorLatestArrivals, "putOverRows").mockResolvedValue(
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
  }

  public async tearDown(): Promise<void> {
    jest.restoreAllMocks();

    if (this.dataSource?.isInitialized) {
      await this.dataSource.query(`DROP SCHEMA "${this.schema}" CASCADE`);
      await this.dataSource.destroy();
    }
  }

  // One row, its ids written as text.
  public async insert(table: string, row: Dictionary<unknown>): Promise<void> {
    const columns: Array<string> = Object.keys(row);

    await this.database.query(
      `INSERT INTO "${this.schema}"."${table}" (${columns
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
  }

  // A statement of the suite's own, its tables named in its schema.
  public async query(
    sql: string,
    parameters?: Array<unknown> | undefined,
  ): Promise<unknown> {
    return await this.database.query(sql, parameters);
  }

  public async analyze(table: string): Promise<void> {
    await this.database.query(`ANALYZE "${this.schema}"."${table}"`);
  }

  public async insertProject(id: ObjectID, name: string): Promise<void> {
    await this.insert("Project", {
      _id: id,
      name: name,
      slug: id.toString(),
      version: 1,
    });
  }

  /*
   * A person in a team of the project, the team holding `permission` - on
   * every record, or (labelIds) on the records with one of those labels.
   */
  public async insertMember(data: {
    userId: ObjectID;
    projectId: ObjectID;
    teamId: ObjectID;
    permission: Permission;
    labelIds?: Array<ObjectID> | undefined;
  }): Promise<void> {
    await this.insert("User", {
      _id: data.userId,
      name: "Synthetic Member",
      email: `${data.userId.toString()}@example.com`,
      slug: data.userId.toString(),
      version: 1,
    });

    await this.insertTeamPermission(data);
  }

  // Another team of the project the person is in, holding `permission`.
  public async insertTeamPermission(data: {
    userId: ObjectID;
    projectId: ObjectID;
    teamId: ObjectID;
    permission: Permission;
    labelIds?: Array<ObjectID> | undefined;
  }): Promise<void> {
    await this.insert("Team", {
      _id: data.teamId,
      projectId: data.projectId,
      name: `Team ${data.teamId.toString()}`,
      slug: data.teamId.toString(),
      version: 1,
    });

    await this.insert("TeamMember", {
      _id: ObjectID.generate(),
      projectId: data.projectId,
      teamId: data.teamId,
      userId: data.userId,
      hasAcceptedInvitation: true,
      version: 1,
    });

    const teamPermissionId: ObjectID = ObjectID.generate();

    await this.insert("TeamPermission", {
      _id: teamPermissionId,
      projectId: data.projectId,
      teamId: data.teamId,
      permission: data.permission,
      isBlockPermission: false,
      scope: PermissionScope.All,
      version: 1,
    });

    for (const labelId of data.labelIds || []) {
      await this.insert("TeamPermissionLabel", {
        teamPermissionId: teamPermissionId,
        labelId: labelId,
      });
    }
  }

  public async insertLabel(data: {
    id: ObjectID;
    projectId: ObjectID;
    name: string;
  }): Promise<void> {
    await this.insert("Label", {
      _id: data.id,
      projectId: data.projectId,
      name: data.name,
      slug: data.id.toString(),
      color: "#6366f1",
      version: 1,
    });
  }

  /*
   * A list, through POST <path>/get-list, as ModelAPI sends it: the query,
   * select and sort serialized for the wire, the page in the query string.
   * Throws with the server's answer when the read is refused.
   */
  public async list<TModel extends BaseModel = BaseModel>(
    request: ListRequest & { userId: ObjectID; projectId: ObjectID },
  ): Promise<ListedPage<TModel>> {
    jest.mocked(Response.sendEntityArrayResponse).mockClear();
    jest.mocked(Response.sendErrorResponse).mockClear();

    const body: JSONObject = JSON.parse(
      JSON.stringify({
        query: JSONFunctions.serialize(request.query as JSONObject),
        select: JSONFunctions.serialize(request.select as JSONObject),
        sort: JSONFunctions.serialize((request.sort || {}) as JSONObject),
      }),
    );

    const req: ExpressRequest = {
      method: "POST",
      params: {},
      // ModelAPI sends the page in the query string.
      query: {
        limit: String(request.limit),
        skip: String(request.skip || 0),
      },
      cookies: {},
      headers: {
        authorization: `Bearer ${request.userId.toString()}`,
        tenantid: request.projectId.toString(),
      },
      body: body,
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      set: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;

    const route: (typeof mockRouter.routes)[number] = mockRouter.match(
      "post",
      `${request.path}/get-list`,
    );

    for (const middleware of route.middlewares) {
      let isPassed: boolean = false;

      await middleware(req, res, ((error?: unknown) => {
        if (!error) {
          isPassed = true;
        }
      }) as NextFunction);

      if (!isPassed) {
        throw new Error(
          `The list was refused before it was read: ${String(
            jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
          )}`,
        );
      }
    }

    let forwardedError: unknown = undefined;

    await route.handlerFunction(req, res, ((error: unknown) => {
      forwardedError = error;
    }) as NextFunction);

    if (forwardedError) {
      throw forwardedError;
    }

    const call: Array<unknown> | undefined = jest.mocked(
      Response.sendEntityArrayResponse,
    ).mock.calls[0];

    if (!call) {
      throw new Error(
        `${request.path}/get-list answered nothing: ${String(
          jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2],
        )}`,
      );
    }

    return {
      rows: call[2] as Array<TModel>,
      count: Number((call[3] as { toNumber: () => number }).toNumber()),
    };
  }

  /*
   * The dashboard's own reads, through the real list routes (#10646): every
   * ModelAPI.getList answered by list(), as the member, so a picker's or a
   * card's read code runs as it runs in the browser - its query, select,
   * sort and page - against migrated Postgres, and a test pins what the
   * code asks rather than a copy of it. Restored with the other mocks
   * (tearDown). The reads are kept, in order, for a test to look at.
   *
   * They are answered one at a time, however the code sends them: list()
   * reads its answer off the one captured Response, so two reads in flight
   * at once (a page's Promise.all) would each take the other's rows.
   */
  public routeModelAPIReads(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Array<ListRequest> {
    const reads: Array<ListRequest> = [];
    let previous: Promise<unknown> = Promise.resolve();

    getJestSpyOn(ModelAPI, "getList").mockImplementation((async (options: {
      modelType: { new (): BaseModel };
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      sort?: Dictionary<unknown> | undefined;
      limit: number;
      skip: number;
    }): Promise<ListResult<BaseModel>> => {
      const path: string = new options.modelType().crudApiPath!.toString();
      const request: ListRequest & { userId: ObjectID; projectId: ObjectID } = {
        path: path,
        query: options.query,
        select: options.select,
        sort: options.sort,
        limit: options.limit,
        skip: options.skip,
        userId: data.userId,
        projectId: data.projectId,
      };

      reads.push(request);

      const answered: Promise<ListedPage> = previous.then(() => {
        return this.list(request);
      });

      // The next read waits for this one, answered or refused.
      previous = answered.catch(() => {
        return undefined;
      });

      const page: ListedPage = await answered;

      return {
        data: page.rows,
        count: page.count,
        skip: options.skip,
        limit: options.limit,
      };
    }) as never);

    return reads;
  }
}

// A model's rows, by one of their columns: names, ids.
export const valuesOf: <TModel extends BaseModel>(
  page: ListedPage<TModel>,
  column: string,
) => Array<string> = <TModel extends BaseModel>(
  page: ListedPage<TModel>,
  column: string,
): Array<string> => {
  return page.rows.map((row: TModel): string => {
    const value: unknown = (row as unknown as Dictionary<unknown>)[column];

    return value === undefined || value === null ? "" : String(value);
  });
};
