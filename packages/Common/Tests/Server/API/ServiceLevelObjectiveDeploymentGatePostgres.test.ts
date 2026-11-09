import { mockRouter } from "./Helpers";
import BaseAPI from "../../../Server/API/BaseAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { AddSloDeploymentGate1809063206333 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809063206333-AddSloDeploymentGate";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
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
import { DataSource, QueryRunner } from "typeorm";

/*
 * THE SLO DEPLOY GATE, against a migrated Postgres (issue #6333).
 *
 * A CI/CD pipeline asks an SLO "may I deploy?" with an API key that reads
 * SLOs: POST (or GET) /service-level-objective/:id/get-item selecting
 * deploymentsAllowed, as the docs' Deployment gate examples do. Here every
 * request goes through the route BaseAPI registers, the real user
 * middleware - which reads the API key and its permission rows from the
 * tables below - and the real permission pipeline, query serializer and
 * TypeORM. Only the lookups around the request (the permission cache, the
 * audit trail, workflow triggers) are stubbed.
 *
 *   - The migration, run on tables that already hold an SLO and a tier,
 *     leaves the SLO allowing deployments and the tier freezing nothing, and
 *     its down step takes the three columns away again.
 *   - A key that may only read SLOs reads the answer, and the time
 *     deployments were frozen, by POST and by GET; the answer as the API
 *     sends it is what `jq '.deploymentsAllowed'` reads.
 *   - A key that may not read SLOs gets no answer; one that may edit SLOs
 *     still may not write it - only the evaluation worker does.
 *   - A key that may edit tiers switches Freeze Deployments on.
 *
 * The services are plain DatabaseServices: the pipeline under test is
 * BaseAPI -> DatabaseService -> ModelPermission, not the services' hooks
 * (their unit tests hold those).
 *
 * Opt in with RUN_POSTGRES_SLO_DEPLOYMENT_GATE_TESTS=true against a database
 * the registered migrations have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_SLO_DEPLOYMENT_GATE_TESTS=true \
 *   SLO_DEPLOYMENT_GATE_TEST_DATABASE_HOST=127.0.0.1 \
 *   SLO_DEPLOYMENT_GATE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/API/ServiceLevelObjectiveDeploymentGatePostgres.test.ts --forceExit
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are copied from public into uniquely named schemas that are dropped
 * afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SLO_DEPLOYMENT_GATE_TESTS"] === "true"
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

// The data sources below are built here; the app's own needs no migrations.
jest.mock("../../../Server/Infrastructure/Postgres/DataSourceOptions", () => {
  return {};
});

// The audit trail of an update is written elsewhere.
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

// The tables the API part writes or reads; every other table is read from public.
const TABLES: Array<string> = [
  "User",
  "Project",
  "Team",
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "Label",
  "ApiKey",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  "ServiceLevelObjective",
  "ServiceLevelObjectiveLabel",
  "ServiceLevelObjectiveOwnerUser",
  "ServiceLevelObjectiveOwnerTeam",
  "ServiceLevelObjectiveErrorBudgetPolicyTier",
];

const SLO_PATH: string = new ServiceLevelObjective()
  .getCrudApiPath()!
  .toString();
const TIER_PATH: string = new ServiceLevelObjectiveErrorBudgetPolicyTier()
  .getCrudApiPath()!
  .toString();

// What a route answered.
interface Outcome {
  error?: unknown;
  item?: BaseModel | null;
  isEmptySuccess?: boolean;
}

type Method = "get" | "post";

function databaseOptions(): {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
} {
  return {
    host: process.env["SLO_DEPLOYMENT_GATE_TEST_DATABASE_HOST"] || "localhost",
    port: Number(
      process.env["SLO_DEPLOYMENT_GATE_TEST_DATABASE_PORT"] || "5400",
    ),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["SLO_DEPLOYMENT_GATE_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
  };
}

function uniqueSchema(prefix: string): string {
  return `${prefix}_${ObjectID.generate().toString().split("-").join("")}`;
}

describePostgres("the SLO deploy gate's migration, on Postgres", () => {
  const schema: string = uniqueSchema("slo_gate_migration");
  let database: DataSource;
  const projectId: ObjectID = ObjectID.generate();
  const sloId: ObjectID = ObjectID.generate();
  const tierId: ObjectID = ObjectID.generate();

  async function columnsOf(table: string): Promise<Array<string>> {
    const rows: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
      [schema, table],
    );

    return rows.map((row: { column_name: string }): string => {
      return row.column_name;
    });
  }

  async function withRunner(
    work: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();

    try {
      await work(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      ...databaseOptions(),
      synchronize: false,
      // The migration's unqualified table names land on the copies.
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [
      "ServiceLevelObjective",
      "ServiceLevelObjectiveErrorBudgetPolicyTier",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // The tables as they were before the gate existed.
    await database.query(
      `ALTER TABLE "${schema}"."ServiceLevelObjective" DROP COLUMN "deploymentsAllowed", DROP COLUMN "deploymentsFrozenAt"`,
    );
    await database.query(
      `ALTER TABLE "${schema}"."ServiceLevelObjectiveErrorBudgetPolicyTier" DROP COLUMN "freezesDeployments"`,
    );

    // An SLO, and the tier of an exhausted budget it is in, from before.
    await database.query(
      `INSERT INTO "${schema}"."ServiceLevelObjective" ("_id", "projectId", "name", "slug", "targetPercentage", "version", "currentErrorBudgetPolicyTierId", "currentErrorBudgetPolicyTierName") VALUES ($1, $2, 'Checkout availability', $3, 99.9, 1, $4, 'Budget exhausted')`,
      [
        sloId.toString(),
        projectId.toString(),
        `checkout-${sloId.toString()}`,
        tierId.toString(),
      ],
    );
    await database.query(
      `INSERT INTO "${schema}"."ServiceLevelObjectiveErrorBudgetPolicyTier" ("_id", "projectId", "serviceLevelObjectiveId", "name", "thresholdPercentage", "whatWeDo", "version") VALUES ($1, $2, $3, 'Budget exhausted', 0, 'Freeze non-critical releases.', 1)`,
      [tierId.toString(), projectId.toString(), sloId.toString()],
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("leaves an SLO stored before it allowing deployments, and a tier freezing nothing", async () => {
    await withRunner(async (queryRunner: QueryRunner) => {
      await new AddSloDeploymentGate1809063206333().up(queryRunner);
    });

    const slos: Array<Dictionary<unknown>> = await database.query(
      `SELECT "deploymentsAllowed", "deploymentsFrozenAt" FROM "${schema}"."ServiceLevelObjective" WHERE "_id" = $1`,
      [sloId.toString()],
    );
    const tiers: Array<Dictionary<unknown>> = await database.query(
      `SELECT "freezesDeployments" FROM "${schema}"."ServiceLevelObjectiveErrorBudgetPolicyTier" WHERE "_id" = $1`,
      [tierId.toString()],
    );

    expect(slos).toEqual([
      { deploymentsAllowed: true, deploymentsFrozenAt: null },
    ]);
    // Even the recommended policy's Budget exhausted, added before: off until switched on.
    expect(tiers).toEqual([{ freezesDeployments: false }]);
  });

  test("writes the columns as the models declare them", async () => {
    const rows: Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }> = await database.query(
      `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND column_name IN ('deploymentsAllowed', 'deploymentsFrozenAt', 'freezesDeployments') ORDER BY column_name`,
      [schema],
    );

    expect(rows).toEqual([
      {
        table_name: "ServiceLevelObjective",
        column_name: "deploymentsAllowed",
        data_type: "boolean",
        is_nullable: "NO",
        column_default: "true",
      },
      {
        table_name: "ServiceLevelObjective",
        column_name: "deploymentsFrozenAt",
        data_type: "timestamp with time zone",
        is_nullable: "YES",
        column_default: null,
      },
      {
        table_name: "ServiceLevelObjectiveErrorBudgetPolicyTier",
        column_name: "freezesDeployments",
        data_type: "boolean",
        is_nullable: "NO",
        column_default: "false",
      },
    ]);
  });

  test("its down step takes the three columns away again", async () => {
    await withRunner(async (queryRunner: QueryRunner) => {
      await new AddSloDeploymentGate1809063206333().down(queryRunner);
    });

    expect(await columnsOf("ServiceLevelObjective")).not.toContain(
      "deploymentsAllowed",
    );
    expect(await columnsOf("ServiceLevelObjective")).not.toContain(
      "deploymentsFrozenAt",
    );
    expect(
      await columnsOf("ServiceLevelObjectiveErrorBudgetPolicyTier"),
    ).not.toContain("freezesDeployments");
    // The rows themselves are untouched.
    expect(
      await database.query(
        `SELECT "name" FROM "${schema}"."ServiceLevelObjective" WHERE "_id" = $1`,
        [sloId.toString()],
      ),
    ).toEqual([{ name: "Checkout availability" }]);
  });
});

describePostgres("the SLO deploy gate through the API, on Postgres", () => {
  const schema: string = uniqueSchema("slo_gate_api");
  let database: DataSource;

  const sloService: DatabaseService<ServiceLevelObjective> =
    new DatabaseService(ServiceLevelObjective);
  const tierService: DatabaseService<ServiceLevelObjectiveErrorBudgetPolicyTier> =
    new DatabaseService(ServiceLevelObjectiveErrorBudgetPolicyTier);

  // The routes register on mockRouter as BaseAPI builds them.
  new BaseAPI(
    ServiceLevelObjective,
    sloService as unknown as DatabaseService<BaseModel>,
  );
  new BaseAPI(
    ServiceLevelObjectiveErrorBudgetPolicyTier,
    tierService as unknown as DatabaseService<BaseModel>,
  );

  const projectId: ObjectID = ObjectID.generate();
  const frozenSloId: ObjectID = ObjectID.generate();
  const allowedSloId: ObjectID = ObjectID.generate();
  const tierId: ObjectID = ObjectID.generate();
  const FROZEN_AT: Date = new Date("2026-11-09T08:00:00.000Z");

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

  // A new API key of the project with these permissions: a key's rows are cached by the key.
  const createApiKey: (
    permissions: Array<Permission>,
  ) => Promise<ObjectID> = async (
    permissions: Array<Permission>,
  ): Promise<ObjectID> => {
    const id: ObjectID = ObjectID.generate();
    const apiKey: ObjectID = ObjectID.generate();

    await insert("ApiKey", {
      _id: id,
      projectId: projectId,
      name: `Key ${id.toString()}`,
      slug: `key-${id.toString()}`,
      apiKey: apiKey,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      version: 1,
    });

    for (const permission of permissions) {
      await insert("ApiKeyPermission", {
        _id: ObjectID.generate(),
        projectId: projectId,
        apiKeyId: id,
        permission: permission,
        isBlockPermission: false,
        version: 1,
      });
    }

    return apiKey;
  };

  // Sends one request through its route, as Express would.
  const send: (data: {
    method: Method;
    uri: string;
    apiKey: ObjectID;
    id: ObjectID;
    body?: JSONObject | undefined;
  }) => Promise<Outcome> = async (data: {
    method: Method;
    uri: string;
    apiKey: ObjectID;
    id: ObjectID;
    body?: JSONObject | undefined;
  }): Promise<Outcome> => {
    jest.mocked(Response.sendEntityResponse).mockClear();
    jest.mocked(Response.sendEmptySuccessResponse).mockClear();
    jest.mocked(Response.sendErrorResponse).mockClear();

    const req: ExpressRequest = {
      method: data.method.toUpperCase(),
      params: { id: data.id.toString() },
      query: {},
      cookies: {},
      headers: { apikey: data.apiKey.toString() },
      body: data.body || {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    } as unknown as ExpressResponse;

    const route: (typeof mockRouter.routes)[number] = mockRouter.match(
      data.method,
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

    if (jest.mocked(Response.sendEmptySuccessResponse).mock.calls.length > 0) {
      return { isEmptySuccess: true };
    }

    throw new Error(`${data.uri} answered nothing.`);
  };

  // The docs' question: the SLO's get-item, selecting the deploy gate.
  const askGate: (
    method: Method,
    apiKey: ObjectID,
    sloId: ObjectID,
  ) => Promise<Outcome> = async (
    method: Method,
    apiKey: ObjectID,
    sloId: ObjectID,
  ): Promise<Outcome> => {
    return await send({
      method: method,
      uri: `${SLO_PATH}/:id/get-item`,
      apiKey: apiKey,
      id: sloId,
      body: {
        select: {
          deploymentsAllowed: true,
          deploymentsFrozenAt: true,
          currentErrorBudgetPolicyTierName: true,
        },
      },
    });
  };

  const expectRefused: (outcome: Outcome) => void = (
    outcome: Outcome,
  ): void => {
    expect(outcome.error).toBeInstanceOf(Exception);
    expect(outcome.item).toBeUndefined();
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      ...databaseOptions(),
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

    // Permissions are read from the tables every time: nothing is cached.
    getJestSpyOn(GlobalCache, "getJSONObject").mockResolvedValue(null as never);
    getJestSpyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);
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

    await insert("Project", {
      _id: projectId,
      name: "Deploy gate project",
      slug: projectId.toString(),
      version: 1,
    });

    // In Budget exhausted, which froze deployments at 08:00.
    await insert("ServiceLevelObjective", {
      _id: frozenSloId,
      projectId: projectId,
      name: "Checkout availability",
      slug: `checkout-${frozenSloId.toString()}`,
      targetPercentage: 99.9,
      version: 1,
      currentErrorBudgetPolicyTierId: tierId,
      currentErrorBudgetPolicyTierName: "Budget exhausted",
      deploymentsAllowed: false,
      deploymentsFrozenAt: FROZEN_AT,
    });

    // Never frozen: the gate columns are left to their defaults.
    await insert("ServiceLevelObjective", {
      _id: allowedSloId,
      projectId: projectId,
      name: "Search latency",
      slug: `search-${allowedSloId.toString()}`,
      targetPercentage: 99.5,
      version: 1,
    });

    await insert("ServiceLevelObjectiveErrorBudgetPolicyTier", {
      _id: tierId,
      projectId: projectId,
      serviceLevelObjectiveId: frozenSloId,
      name: "Budget exhausted",
      thresholdPercentage: 0,
      whatWeDo: "Freeze non-critical releases.",
      version: 1,
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("a key that may only read SLOs reads a frozen SLO's answer and since when, by POST get-item", async () => {
    const apiKey: ObjectID = await createApiKey([
      Permission.ReadServiceLevelObjective,
    ]);

    const outcome: Outcome = await askGate("post", apiKey, frozenSloId);

    expect(outcome.error).toBeUndefined();

    const slo: ServiceLevelObjective = outcome.item as ServiceLevelObjective;

    expect(slo.deploymentsAllowed).toBe(false);
    expect(new Date(slo.deploymentsFrozenAt as Date).toISOString()).toBe(
      FROZEN_AT.toISOString(),
    );
    expect(slo.currentErrorBudgetPolicyTierName).toBe("Budget exhausted");
  });

  test("and by GET get-item", async () => {
    const apiKey: ObjectID = await createApiKey([
      Permission.ReadServiceLevelObjective,
    ]);

    const outcome: Outcome = await askGate("get", apiKey, frozenSloId);

    expect(outcome.error).toBeUndefined();
    expect((outcome.item as ServiceLevelObjective).deploymentsAllowed).toBe(
      false,
    );
  });

  test("an SLO never frozen answers true, with no freeze time", async () => {
    const apiKey: ObjectID = await createApiKey([
      Permission.ReadServiceLevelObjective,
    ]);

    const slo: ServiceLevelObjective = (
      await askGate("post", apiKey, allowedSloId)
    ).item as ServiceLevelObjective;

    expect(slo.deploymentsAllowed).toBe(true);
    expect(slo.deploymentsFrozenAt ?? null).toBeNull();
  });

  test("the answer as the API sends it is what the docs' jq reads", async () => {
    const apiKey: ObjectID = await createApiKey([
      Permission.ReadServiceLevelObjective,
    ]);

    const frozen: JSONObject = BaseModel.toJSON(
      (await askGate("post", apiKey, frozenSloId)).item as BaseModel,
      ServiceLevelObjective,
    );
    const allowed: JSONObject = BaseModel.toJSON(
      (await askGate("post", apiKey, allowedSloId)).item as BaseModel,
      ServiceLevelObjective,
    );

    // jq -e '.deploymentsAllowed == true'
    expect(frozen["deploymentsAllowed"] === true).toBe(false);
    expect(frozen["deploymentsAllowed"]).toBe(false);
    expect(allowed["deploymentsAllowed"] === true).toBe(true);
  });

  test("a key that may not read SLOs gets no answer", async () => {
    const apiKey: ObjectID = await createApiKey([
      Permission.ReadProjectMonitor,
    ]);

    expectRefused(await askGate("post", apiKey, frozenSloId));
  });

  test("a key that may edit SLOs still may not write the answer: only the worker does", async () => {
    const apiKey: ObjectID = await createApiKey([
      Permission.ReadServiceLevelObjective,
      Permission.EditServiceLevelObjective,
    ]);

    expectRefused(
      await send({
        method: "post",
        uri: `${SLO_PATH}/:id/update-item`,
        apiKey: apiKey,
        id: frozenSloId,
        body: {
          data: JSONFunctions.serialize({
            deploymentsAllowed: true,
          }) as JSONObject,
        },
      }),
    );

    expectRefused(
      await send({
        method: "post",
        uri: `${SLO_PATH}/:id/update-item`,
        apiKey: apiKey,
        id: frozenSloId,
        body: {
          data: JSONFunctions.serialize({
            deploymentsFrozenAt: null,
          }) as JSONObject,
        },
      }),
    );

    expect(
      await readColumn("ServiceLevelObjective", frozenSloId, "deploymentsAllowed"),
    ).toBe(false);
  });

  test("a key that may edit tiers switches Freeze Deployments on, and a key that may read tiers reads it", async () => {
    const reader: ObjectID = await createApiKey([
      Permission.ReadServiceLevelObjective,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

    const before: Outcome = await send({
      method: "post",
      uri: `${TIER_PATH}/:id/get-item`,
      apiKey: reader,
      id: tierId,
      body: { select: { name: true, freezesDeployments: true } },
    });

    expect(
      (before.item as ServiceLevelObjectiveErrorBudgetPolicyTier)
        .freezesDeployments,
    ).toBe(false);

    const editor: ObjectID = await createApiKey([
      Permission.ReadServiceLevelObjective,
      Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
      Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
    ]);

    const update: Outcome = await send({
      method: "post",
      uri: `${TIER_PATH}/:id/update-item`,
      apiKey: editor,
      id: tierId,
      body: {
        data: JSONFunctions.serialize({
          freezesDeployments: true,
        }) as JSONObject,
      },
    });

    expect(update.error).toBeUndefined();
    expect(
      await readColumn(
        "ServiceLevelObjectiveErrorBudgetPolicyTier",
        tierId,
        "freezesDeployments",
      ),
    ).toBe(true);

    // Reading a tier does not let a key switch it.
    expectRefused(
      await send({
        method: "post",
        uri: `${TIER_PATH}/:id/update-item`,
        apiKey: reader,
        id: tierId,
        body: {
          data: JSONFunctions.serialize({
            freezesDeployments: false,
          }) as JSONObject,
        },
      }),
    );
    expect(
      await readColumn(
        "ServiceLevelObjectiveErrorBudgetPolicyTier",
        tierId,
        "freezesDeployments",
      ),
    ).toBe(true);
  });
});
