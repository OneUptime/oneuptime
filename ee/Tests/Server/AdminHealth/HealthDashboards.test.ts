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
import fs from "fs";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import path from "path";

/*
 * The live OneUptime Health dashboards, served by the enterprise module.
 *
 * They moved here from core's App/API/AdminHealth.ts, which now only answers
 * their paths with a 402. The requests below go through the same mount order
 * as App/Index.ts - this module's router at /api/admin/health AHEAD of core's -
 * so every 200 is this module answering (core would say 402), and the
 * Community routes are proven to still fall through to core.
 *
 * Who may use them: a master admin (the master API key too, except for live
 * Postgres activity, which returns statement text) on an install whose
 * license covers instance health. OneUptime Cloud (billing on) always passes.
 *
 * Billing AND the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). Master-admin authorization passes every request (it
 * is not what is under test); which middleware each route uses is asserted on
 * the router itself.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("Common/Server/Middleware/MasterAdminAuthorization", () => {
  type Middleware = (req: unknown, res: unknown, next: () => void) => void;

  const isAuthorizedMasterAdminMiddleware: Middleware = (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ): void => {
    next();
  };

  const isAuthorizedMasterAdminOrMasterApiKeyMiddleware: Middleware = (
    _req: unknown,
    _res: unknown,
    next: () => void,
  ): void => {
    next();
  };

  return {
    __esModule: true,
    default: {
      isAuthorizedMasterAdminMiddleware,
      isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    },
  };
});

jest.mock("Common/Server/Utils/InstanceHealth/RedisHealth", () => {
  return {
    __esModule: true,
    ...(jest.requireActual(
      "Common/Server/Utils/InstanceHealth/RedisHealth",
    ) as Record<string, unknown>),
    getRedisInfoSnapshot: jest.fn(async (): Promise<null> => {
      return null;
    }),
  };
});

jest.mock("Common/Server/Utils/InstanceHealth/TelemetryIngestion", () => {
  return {
    __esModule: true,
    ...(jest.requireActual(
      "Common/Server/Utils/InstanceHealth/TelemetryIngestion",
    ) as Record<string, unknown>),
    getTelemetryIngestionBySignal: jest.fn(
      async (): Promise<{ connected: boolean; tables: Array<never> }> => {
        return { connected: false, tables: [] };
      },
    ),
    getTelemetryIngestionByProject: jest.fn(
      async (): Promise<{
        connected: boolean;
        projects: Array<never>;
        signals: Array<never>;
        truncated: boolean;
      }> => {
        return {
          connected: false,
          projects: [],
          signals: [],
          truncated: false,
        };
      },
    ),
  };
});

jest.mock("App/FeatureSet/APIReference/Utils/Resources", () => {
  return {
    __esModule: true,
    default: {
      getResources: (): Array<never> => {
        return [];
      },
    },
  };
});

jest.mock("App/FeatureSet/APIReference/Utils/DataTypes", () => {
  return {
    __esModule: true,
    default: {
      getDataTypes: (): Array<never> => {
        return [];
      },
    },
  };
});

import EnterpriseModule from "../../../Server/Index";
import {
  createAdminHealthRouter,
  getAdminHealthRouter,
} from "../../../Server/AdminHealth/Index";
import {
  ACTIVITY_QUERY_TEXT_LENGTH,
  createHealthDashboardsRouter,
  getClickhouseHealthSummary,
  getClickhouseTelemetryIngestionByProject,
  getHealthSummary,
  getPostgresActivity,
  resetHealthDashboardCachesForTests,
} from "../../../Server/AdminHealth/HealthDashboards";
import CoreAdminHealthRouter, {
  getHealthDashboardMiddleware,
  HEALTH_DASHBOARD_PATHS,
  HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
  QUERY_CONSOLE_PATHS,
} from "App/API/AdminHealth";
import { MasterAdminApis } from "App/FeatureSet/APIReference/Service/MasterAdminApis";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import Redis from "Common/Server/Infrastructure/Redis";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  getRedisInfoSnapshot,
  RedisInfoSnapshot,
} from "Common/Server/Utils/InstanceHealth/RedisHealth";
import {
  getTelemetryIngestionByProject,
  getTelemetryIngestionBySignal,
  MAX_PROJECTS_PER_SIGNAL,
  TelemetryProjectIngestionResult,
} from "Common/Server/Utils/InstanceHealth/TelemetryIngestion";
import logger from "Common/Server/Utils/Logger";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Exception from "Common/Types/Exception/Exception";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

// The live dashboards, as requested: 402 unless the license covers instance health.
const ENTERPRISE_ROUTES: Array<string> = [
  "/overview",
  "/queues",
  "/queues/Worker/failed-jobs",
  "/redis",
  "/logs",
  "/clickhouse-cluster",
  "/clickhouse-telemetry-ingestion",
  "/clickhouse-telemetry-ingestion-by-project",
  "/postgres-cluster",
  "/postgres-activity",
];

// Served by core on every edition, behind this module's router.
const COMMUNITY_ROUTES: Array<string> = [
  "/clickhouse-capacity",
  "/instance-health-logs",
  "/migrations",
  "/support-bundle",
];

const HEALTH_DASHBOARDS_SOURCE_PATH: string = path.resolve(
  __dirname,
  "../../../Server/AdminHealth/HealthDashboards.ts",
);

const ADMIN_HEALTH_SERVER_DIR: string = path.resolve(
  __dirname,
  "../../../Server/AdminHealth",
);

interface HttpResult {
  status: number;
  body: JSONObject;
}

interface EditionState {
  label: string;
  billing: boolean;
  install: () => void;
}

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

type QueueStats = Awaited<ReturnType<typeof Queue.getQueueStats>>;

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const LOCKED_STATES: Array<EditionState & { message: string }> = [
  {
    label: "the Community Edition",
    billing: false,
    install: uninstallEnterpriseModule,
    message: EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
  },
  {
    label: "the Community Edition with billing on",
    billing: true,
    install: uninstallEnterpriseModule,
    message: EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
  },
  {
    label: "the Enterprise Edition without a license",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("missing"),
      });
    },
    message: EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
  },
  {
    label:
      "the Enterprise Edition with a license expired past its grace period",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
    },
    message: EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
  },
  {
    label: "the Enterprise Edition with an invalid license",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("invalid"),
      });
    },
    message: EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
  },
  {
    label:
      "the Enterprise Edition with a license that leaves out instance health",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModuleWithFeatures([
        EnterpriseFeature.SSO,
        EnterpriseFeature.SCIM,
        EnterpriseFeature.AuditLogs,
      ]);
    },
    message: EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
  },
  {
    label: "the Enterprise Edition before its first license load",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({ snapshot: null });
    },
    message: EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
  },
];

const OPEN_STATES: Array<EditionState> = [
  {
    label: "the Enterprise Edition with a valid license",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule();
    },
  },
  {
    label: "the Enterprise Edition in its grace period",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("grace"),
      });
    },
  },
  {
    label: "the Enterprise Edition in its unlicensed trial grace",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("grace", {
          graceReason: "unlicensed",
          verification: "none",
          expiresAt: undefined,
          graceEndsAt: new Date(Date.now() + 10 * DAY_IN_MS),
        }),
      });
    },
  },
  {
    label: "the Enterprise Edition with a license for instance health only",
    billing: false,
    install: (): void => {
      installFakeEnterpriseModuleWithFeatures([
        EnterpriseFeature.InstanceHealth,
      ]);
    },
  },
  {
    label: "OneUptime Cloud (billing on), whatever the license says",
    billing: true,
    install: (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("missing"),
      });
    },
  },
];

let httpServer: Server;
let baseUrl: string = "";

const request: (
  method: string,
  requestPath: string,
  body?: JSONObject,
) => Promise<HttpResult> = async (
  method: string,
  requestPath: string,
  body?: JSONObject,
): Promise<HttpResult> => {
  const response: globalThis.Response = await fetch(
    `${baseUrl}/api/admin/health${requestPath}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );

  return {
    status: response.status,
    body: (await response.json()) as JSONObject,
  };
};

const get: (requestPath: string) => Promise<HttpResult> = (
  requestPath: string,
): Promise<HttpResult> => {
  return request("GET", requestPath);
};

const enter: (state: EditionState) => void = (state: EditionState): void => {
  setTestBillingEnabled(state.billing);
  state.install();
};

const layersOf: (router: ExpressRouter) => Array<RouteLayer> = (
  router: ExpressRouter,
): Array<RouteLayer> => {
  return (router as unknown as { stack: Array<RouteLayer> }).stack;
};

const describeRoute: (layer: RouteLayer) => string = (
  layer: RouteLayer,
): string => {
  return `${Object.keys(layer.route?.methods || {}).join(",")} ${layer.route?.path}`;
};

const eeLayers: () => Array<RouteLayer> = (): Array<RouteLayer> => {
  return layersOf(getAdminHealthRouter() as ExpressRouter);
};

const findGetLayer: (
  layers: Array<RouteLayer>,
  routePath: string,
) => RouteLayer | undefined = (
  layers: Array<RouteLayer>,
  routePath: string,
): RouteLayer | undefined => {
  return layers.find((layer: RouteLayer): boolean => {
    return (
      layer.route?.path === routePath && Boolean(layer.route?.methods["get"])
    );
  });
};

// Removes comments, so prose about a pattern cannot satisfy or break a check.
const stripComments: (source: string) => string = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

const queueStats: (overrides: Partial<QueueStats>) => QueueStats = (
  overrides: Partial<QueueStats>,
): QueueStats => {
  return {
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    total: 0,
    ...overrides,
  };
};

const redisSnapshot: (
  overrides: Partial<RedisInfoSnapshot>,
) => RedisInfoSnapshot = (
  overrides: Partial<RedisInfoSnapshot>,
): RedisInfoSnapshot => {
  return {
    usedMemoryInBytes: 0,
    maxMemoryInBytes: 0,
    maxMemoryPolicy: "noeviction",
    memoryUtilizationPercent: null,
    connectedClients: 1,
    maxClients: null,
    clientUtilizationPercent: null,
    blockedClients: 0,
    evictedKeys: 0,
    rejectedConnections: 0,
    rdbLastBgsaveStatus: "ok",
    isAofEnabled: false,
    aofLastWriteStatus: "ok",
    aofLastBgrewriteStatus: "ok",
    uptimeInSeconds: 1,
    ...overrides,
  };
};

// A fake Postgres data source that answers each probe by a fragment of its SQL.
const usePostgres: (
  answer: (sql: string) => Array<Record<string, unknown>>,
) => Array<string> = (
  answer: (sql: string) => Array<Record<string, unknown>>,
): Array<string> => {
  const queries: Array<string> = [];

  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    query: async (sql: string): Promise<Array<Record<string, unknown>>> => {
      queries.push(sql);
      return answer(sql);
    },
  } as unknown as ReturnType<typeof PostgresAppInstance.getDataSource>);

  return queries;
};

// A fake ClickHouse client; `fail` makes every query reject.
const useClickhouse: (fail: boolean) => Array<string> = (
  fail: boolean,
): Array<string> => {
  const queries: Array<string> = [];

  jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue({
    query: async (data: {
      query: string;
    }): Promise<{ json: () => Promise<JSONObject> }> => {
      queries.push(data.query);

      if (fail) {
        throw new Error("ClickHouse is down");
      }

      return {
        json: async (): Promise<JSONObject> => {
          return { data: [] };
        },
      };
    },
  } as unknown as ReturnType<typeof ClickhouseAppInstance.getDataSource>);

  return queries;
};

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  // The App/Index.ts mount order: the enterprise router first, then core's.
  app.use("/api/admin/health", getAdminHealthRouter() as ExpressRouter);
  app.use("/api/admin/health", CoreAdminHealthRouter);
  app.use(
    (
      error: Exception,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      const status: number =
        typeof error.code === "number" && error.code >= 400 && error.code < 600
          ? error.code
          : 500;
      res.status(status).json({ message: error.message });
    },
  );

  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    httpServer.close((): void => {
      resolve();
    });
  });
});

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();
  resetHealthDashboardCachesForTests();

  jest.mocked(getRedisInfoSnapshot).mockClear();
  jest.mocked(getTelemetryIngestionBySignal).mockClear();
  jest.mocked(getTelemetryIngestionByProject).mockClear();

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);
  jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(null);
  jest.spyOn(Redis, "getClient").mockReturnValue(null);
  jest.spyOn(Redis, "isConnected").mockReturnValue(false);
  jest.spyOn(Queue, "getQueueStats").mockResolvedValue(queueStats({}));
  jest.spyOn(Queue, "getFailedJobsWithDetails").mockResolvedValue([]);
  jest.spyOn(InstanceHealthLogService, "findBy").mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  resetHealthDashboardCachesForTests();
});

describe("the enterprise admin-health router", () => {
  test("is what the assembled enterprise module hands core, built once", () => {
    const router: ExpressRouter | null = getAdminHealthRouter();

    expect(router).not.toBeNull();
    expect(getAdminHealthRouter()).toBe(router);
    expect(EnterpriseModule.getAdminHealthRouter()).toBe(router);
  });

  test("serves exactly the paths core keeps fallbacks for: the dashboards as GETs, the console as POSTs", () => {
    expect(eeLayers().map(describeRoute).sort()).toEqual(
      [
        ...HEALTH_DASHBOARD_PATHS.map((routePath: string): string => {
          return `get ${routePath}`;
        }),
        ...QUERY_CONSOLE_PATHS.map((routePath: string): string => {
          return `post ${routePath}`;
        }),
      ].sort(),
    );
  });

  test("every requested dashboard path matches a route", () => {
    expect(
      ENTERPRISE_ROUTES.map((routePath: string): string => {
        return routePath.replace("/Worker/", "/:queueName/");
      }),
    ).toEqual([...HEALTH_DASHBOARD_PATHS]);
  });

  test("holds routes only - one router, no router.use() layer", () => {
    for (const router of [
      getAdminHealthRouter() as ExpressRouter,
      createAdminHealthRouter(),
      createHealthDashboardsRouter(),
    ]) {
      expect(
        EnterpriseServerModuleShape.findLayersWithoutRoute(router),
      ).toEqual([]);
    }
  });

  test("a fresh router serves the same routes as the shared one", () => {
    expect(layersOf(createAdminHealthRouter()).map(describeRoute)).toEqual(
      eeLayers().map(describeRoute),
    );
    expect(
      layersOf(createHealthDashboardsRouter()).map(describeRoute).sort(),
    ).toEqual(
      HEALTH_DASHBOARD_PATHS.map((routePath: string): string => {
        return `get ${routePath}`;
      }).sort(),
    );
  });

  /*
   * The same middleware as core's fallback for each path, so moving a route
   * between editions never changes who may call it.
   */
  test.each([...HEALTH_DASHBOARD_PATHS])(
    "GET %s keeps its middleware, and nothing else runs before the handler",
    (routePath: string) => {
      const layer: RouteLayer | undefined = findGetLayer(eeLayers(), routePath);

      expect(layer?.route?.stack).toHaveLength(2);
      expect(layer?.route?.stack[0]?.handle).toBe(
        getHealthDashboardMiddleware(routePath),
      );
      expect(layer?.route?.stack[0]?.handle).toBe(
        findGetLayer(layersOf(CoreAdminHealthRouter), routePath)?.route
          ?.stack[0]?.handle,
      );
    },
  );

  test("live Postgres activity never accepts the master API key", () => {
    const handle: unknown = findGetLayer(eeLayers(), "/postgres-activity")
      ?.route?.stack[0]?.handle;

    expect(handle).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
    expect(handle).not.toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    );
  });

  test("every other dashboard accepts the master API key", () => {
    for (const routePath of HEALTH_DASHBOARD_PATHS) {
      if (routePath === "/postgres-activity") {
        continue;
      }

      expect({
        routePath,
        handle: findGetLayer(eeLayers(), routePath)?.route?.stack[0]?.handle,
      }).toEqual({
        routePath,
        handle:
          MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
      });
    }
  });

  // The Community routes are core's on every edition; shadowing one would move it.
  test("never registers a Community route", () => {
    const paths: Array<string> = eeLayers().map((layer: RouteLayer): string => {
      return String(layer.route?.path);
    });

    for (const routePath of COMMUNITY_ROUTES) {
      expect(paths).not.toContain(routePath);
    }
  });

  /*
   * The master-admin API reference badges each endpoint Enterprise or not.
   * Every Enterprise one is served here, with the master API key; no
   * every-edition one is.
   */
  test("serves exactly the documented Enterprise endpoints that take the master API key", () => {
    const keyRoutes: Array<string> = eeLayers()
      .filter((layer: RouteLayer): boolean => {
        return (
          Boolean(layer.route?.methods["get"]) &&
          layer.route?.stack[0]?.handle ===
            MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware
        );
      })
      .map((layer: RouteLayer): string => {
        return String(layer.route?.path).replace(":queueName", "{queueName}");
      });

    const documented: Array<{ path: string; isEnterpriseEdition: boolean }> =
      MasterAdminApis;

    for (const api of documented) {
      expect({ path: api.path, served: keyRoutes.includes(api.path) }).toEqual({
        path: api.path,
        served: api.isEnterpriseEdition,
      });
    }
  });
});

describe("the live OneUptime Health dashboards are licensed", () => {
  describe.each(LOCKED_STATES)(
    "on $label",
    (state: EditionState & { message: string }) => {
      test.each(ENTERPRISE_ROUTES)(
        "GET %s answers 402 with the edition's own message",
        async (routePath: string) => {
          enter(state);

          const result: HttpResult = await get(routePath);

          expect(result.status).toBe(402);
          expect(result.body["message"]).toBe(state.message);
        },
      );
    },
  );

  describe.each(OPEN_STATES)("on $label", (state: EditionState) => {
    test.each(ENTERPRISE_ROUTES)(
      "GET %s answers 200 from the enterprise module",
      async (routePath: string) => {
        enter(state);

        const result: HttpResult = await get(routePath);

        expect(result.status).toBe(200);
        expect(result.body["message"]).not.toBe(
          HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
        );
      },
    );
  });

  test("the two edition messages are different, so an operator can tell the cases apart", () => {
    expect(EnterpriseEdition.COMMUNITY_EDITION_MESSAGE).not.toBe(
      EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
    );
  });

  test("a license lapsing locks the dashboards on the next request, without a restart", async () => {
    setTestBillingEnabled(false);
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    expect((await get("/postgres-cluster")).status).toBe(200);

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    expect((await get("/postgres-cluster")).status).toBe(402);

    fake.setSnapshot(createLicenseSnapshot());
    expect((await get("/postgres-cluster")).status).toBe(200);
  });

  /*
   * The overview and the queue stats are cached briefly, but the license is
   * checked before the cache is read: a cached answer never outlives it.
   */
  test.each(["/overview", "/queues"])(
    "GET %s is cached, and the cache never outlives the license",
    async (routePath: string) => {
      const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

      expect((await get(routePath)).status).toBe(200);
      expect((await get(routePath)).status).toBe(200);
      // One read of the four queues, however many requests inside the TTL.
      expect(Queue.getQueueStats).toHaveBeenCalledTimes(4);

      fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
      const locked: HttpResult = await get(routePath);
      expect(locked.status).toBe(402);
      expect(locked.body["message"]).toBe(
        EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
      );

      fake.setSnapshot(createLicenseSnapshot());
      expect((await get(routePath)).status).toBe(200);
      expect(Queue.getQueueStats).toHaveBeenCalledTimes(4);
    },
  );

  test("the edition answer comes before request validation", async () => {
    const result: HttpResult = await get("/queues/NotAQueue/failed-jobs");

    expect(result.status).toBe(402);
    expect(result.body["message"]).toBe(
      EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
    );
  });
});

describe("core still answers the Community routes behind the enterprise router", () => {
  const states: Array<EditionState> = [
    LOCKED_STATES[0] as EditionState,
    LOCKED_STATES[3] as EditionState,
    OPEN_STATES[0] as EditionState,
    OPEN_STATES[4] as EditionState,
  ];

  describe.each(states)("on $label", (state: EditionState) => {
    test.each(COMMUNITY_ROUTES)(
      "GET %s answers 200",
      async (routePath: string) => {
        enter(state);

        const result: HttpResult = await get(routePath);

        expect(result.status).toBe(200);
      },
    );
  });

  test("the support bundle never carries live Postgres activity", async () => {
    installFakeEnterpriseModule();

    const serialized: string = JSON.stringify(
      (await get("/support-bundle")).body,
    );

    expect(serialized).not.toContain('"activeQueries"');
    expect(serialized).not.toContain('"topStatements"');
  });

  test("the query console still answers on the same router", async () => {
    installFakeEnterpriseModule();

    const result: HttpResult = await request("POST", "/query/postgres", {
      query: "SELECT 1",
    });

    expect(result.status).toBe(200);
    expect(result.body["error"]).toBe(
      "Postgres is not connected on this instance.",
    );
  });
});

describe("failed jobs for one queue", () => {
  beforeEach(() => {
    installFakeEnterpriseModule();
  });

  test("an unknown queue is refused before BullMQ is asked", async () => {
    const result: HttpResult = await get("/queues/NotAQueue/failed-jobs");

    expect(result.status).toBe(400);
    expect(result.body["message"]).toBe("Unknown queue: NotAQueue");
    expect(Queue.getFailedJobsWithDetails).not.toHaveBeenCalled();
    expect(Queue.getQueueStats).not.toHaveBeenCalled();
  });

  test("a known queue answers with its stats and its most recent failed jobs", async () => {
    jest
      .spyOn(Queue, "getQueueStats")
      .mockResolvedValue(queueStats({ failed: 3, total: 3 }));

    const result: HttpResult = await get("/queues/Worker/failed-jobs");

    expect(result.status).toBe(200);
    expect(result.body["name"]).toBe(QueueName.Worker);
    expect((result.body["stats"] as JSONObject)["failed"]).toBe(3);
    expect(result.body["failedJobs"]).toEqual([]);
    expect(Queue.getFailedJobsWithDetails).toHaveBeenCalledWith(
      QueueName.Worker,
      { start: 0, end: 24 },
    );
  });
});

describe("the overview roll-up", () => {
  test("rolls up the datastores and every queue", async () => {
    usePostgres((): Array<Record<string, unknown>> => {
      return [{ size: "2048" }];
    });
    useClickhouse(false);
    jest
      .mocked(getRedisInfoSnapshot)
      .mockResolvedValueOnce(
        redisSnapshot({ usedMemoryInBytes: 100, maxMemoryInBytes: 1000 }),
      );
    jest
      .spyOn(Queue, "getQueueStats")
      .mockImplementation(async (queueName: QueueName): Promise<QueueStats> => {
        if (queueName === QueueName.Workflow) {
          return queueStats({ waiting: 3, delayed: 1 });
        }

        if (queueName === QueueName.Worker) {
          return queueStats({ failed: 2, waiting: 5 });
        }

        if (queueName === QueueName.Telemetry) {
          throw new Error("queue unavailable");
        }

        return queueStats({ delayed: 2 });
      });

    expect(await getHealthSummary()).toEqual({
      postgres: { connected: true, databaseSizeInBytes: 2048 },
      clickhouse: { connected: true },
      redis: {
        connected: true,
        usedMemoryInBytes: 100,
        maxMemoryInBytes: 1000,
      },
      queues: {
        totalQueues: 4,
        healthyQueues: 2,
        failingQueues: 1,
        unavailableQueues: 1,
        failedJobs: 2,
        waitingJobs: 8,
        delayedJobs: 3,
      },
    });
  });

  test("one unreachable datastore never blanks the others", async () => {
    jest.spyOn(Queue, "getQueueStats").mockRejectedValue(new Error("down"));

    expect(await getHealthSummary()).toEqual({
      postgres: { connected: false, databaseSizeInBytes: null },
      clickhouse: { connected: false },
      redis: {
        connected: false,
        usedMemoryInBytes: null,
        maxMemoryInBytes: null,
      },
      queues: {
        totalQueues: 4,
        healthyQueues: 0,
        failingQueues: 0,
        unavailableQueues: 4,
        failedJobs: 0,
        waitingJobs: 0,
        delayedJobs: 0,
      },
    });
  });

  test("ClickHouse reachability is one capped SELECT 1, not the capacity read", async () => {
    const queries: Array<string> = useClickhouse(false);

    expect(await getClickhouseHealthSummary()).toEqual({ connected: true });
    expect(queries).toEqual(["SELECT 1 SETTINGS max_execution_time = 10"]);
  });

  test("a failing ClickHouse reads as unreachable, not as an error", async () => {
    useClickhouse(true);

    expect(await getClickhouseHealthSummary()).toEqual({ connected: false });
    expect(logger.error).toHaveBeenCalled();
  });

  test("GET /overview wraps the roll-up in a summary", async () => {
    installFakeEnterpriseModule();

    const result: HttpResult = await get("/overview");
    const summary: JSONObject = result.body["summary"] as JSONObject;

    expect(Object.keys(summary).sort()).toEqual(
      ["clickhouse", "postgres", "queues", "redis"].sort(),
    );
    expect((summary["queues"] as JSONObject)["totalQueues"]).toBe(4);
  });
});

describe("live Postgres activity", () => {
  const activityAnswer: (options: {
    statementsInstalled: boolean;
  }) => (sql: string) => Array<Record<string, unknown>> = (options: {
    statementsInstalled: boolean;
  }): ((sql: string) => Array<Record<string, unknown>>) => {
    return (sql: string): Array<Record<string, unknown>> => {
      if (sql.includes("FROM pg_stat_statements")) {
        if (!options.statementsInstalled) {
          throw new Error('relation "pg_stat_statements" does not exist');
        }

        return [
          {
            query: "SELECT * FROM x WHERE id = $1",
            calls: "10",
            total_ms: "150",
            mean_ms: "15.5",
            max_ms: "40",
            rows: "10",
            cache_hit_ratio: "99.5",
          },
        ];
      }

      if (sql.includes("pg_blocking_pids(blocked.pid)")) {
        return [
          {
            blocked_pid: "11",
            blocked_user: "app",
            blocked_for_seconds: "30",
            blocked_query: "UPDATE a SET b = 1",
            blocking_pid: "12",
            blocking_user: null,
            blocking_state: "idle in transaction",
            blocking_query: null,
          },
        ];
      }

      if (sql.includes("FROM pg_stat_progress_vacuum")) {
        return [
          {
            pid: "13",
            table_name: "Log",
            phase: "scanning heap",
            heap_blks_total: "100",
            heap_blks_scanned: "50",
            percent_scanned: "50.0",
          },
        ];
      }

      if (sql.includes("FROM pg_stat_activity a")) {
        return [
          {
            pid: "10",
            username: "app",
            application_name: null,
            client_addr: "10.0.0.1",
            state: "active",
            wait_event_type: null,
            wait_event: null,
            query_age_seconds: "5",
            transaction_age_seconds: "6",
            query: "SELECT pg_sleep(10)",
          },
        ];
      }

      return [];
    };
  };

  test("reports running queries, blocking pairs, statements and vacuum progress", async () => {
    usePostgres(activityAnswer({ statementsInstalled: true }));

    const result: JSONObject = await getPostgresActivity();

    expect(result["connected"]).toBe(true);
    expect(result["activeQueries"]).toEqual([
      {
        pid: 10,
        username: "app",
        applicationName: null,
        clientAddr: "10.0.0.1",
        state: "active",
        waitEventType: null,
        waitEvent: null,
        queryAgeSeconds: 5,
        transactionAgeSeconds: 6,
        query: "SELECT pg_sleep(10)",
      },
    ]);
    expect(result["blockedSessions"]).toEqual([
      {
        blockedPid: 11,
        blockedUser: "app",
        blockedForSeconds: 30,
        blockedQuery: "UPDATE a SET b = 1",
        blockingPid: 12,
        blockingUser: null,
        blockingState: "idle in transaction",
        blockingQuery: null,
      },
    ]);
    expect(result["statementsAvailable"]).toBe(true);
    expect(result["topStatements"]).toEqual([
      {
        query: "SELECT * FROM x WHERE id = $1",
        calls: 10,
        totalMilliseconds: 150,
        meanMilliseconds: 15.5,
        maxMilliseconds: 40,
        rows: 10,
        cacheHitRatio: 99.5,
      },
    ]);
    expect(result["vacuumProgress"]).toEqual([
      {
        pid: 13,
        tableName: "Log",
        phase: "scanning heap",
        heapBlocksTotal: 100,
        heapBlocksScanned: 50,
        percentScanned: 50,
      },
    ]);
  });

  test("without pg_stat_statements it says so and still reports the rest", async () => {
    usePostgres(activityAnswer({ statementsInstalled: false }));

    const result: JSONObject = await getPostgresActivity();

    expect(result["statementsAvailable"]).toBe(false);
    expect(result["topStatements"]).toEqual([]);
    expect(result["activeQueries"] as JSONArray).toHaveLength(1);
    expect(result["blockedSessions"] as JSONArray).toHaveLength(1);
    expect(result["vacuumProgress"] as JSONArray).toHaveLength(1);
  });

  test("every statement text it reads is truncated by Postgres, and its own backend is left out", async () => {
    const queries: Array<string> = usePostgres(
      activityAnswer({ statementsInstalled: true }),
    );

    await getPostgresActivity();

    const textColumns: Array<string> = queries
      .join("\n")
      .match(/LEFT\([a-z.]+query, \d+\)/g) as Array<string>;

    expect(ACTIVITY_QUERY_TEXT_LENGTH).toBe(500);
    expect(textColumns).toHaveLength(4);
    for (const column of textColumns) {
      expect(column).toContain(`, ${ACTIVITY_QUERY_TEXT_LENGTH})`);
    }
    expect(queries.join("\n")).toContain("a.pid <> pg_backend_pid()");
  });

  test("without Postgres it reports not connected", async () => {
    expect(await getPostgresActivity()).toEqual({
      connected: false,
      activeQueries: [],
      blockedSessions: [],
      statementsAvailable: false,
      topStatements: [],
      vacuumProgress: [],
    });
  });
});

describe("telemetry ingestion by project", () => {
  const ingestionFor: (
    projectIds: Array<string>,
  ) => TelemetryProjectIngestionResult = (
    projectIds: Array<string>,
  ): TelemetryProjectIngestionResult => {
    return {
      connected: true,
      truncated: false,
      signals: [{ telemetryType: "Logs", available: true, truncated: false }],
      projects: projectIds.map((projectId: string) => {
        return {
          projectId,
          projectName: null,
          lastMinute: 1,
          lastHour: 2,
          lastDay: 3,
          signals: [],
        };
      }),
    };
  };

  test("names exactly the reporting projects, in one root read", async () => {
    jest
      .mocked(getTelemetryIngestionByProject)
      .mockResolvedValueOnce(ingestionFor(["p1", "p2"]));
    jest.spyOn(ProjectService, "findBy").mockResolvedValue([
      {
        id: {
          toString: (): string => {
            return "p1";
          },
        },
        name: "Acme",
      },
    ] as never);

    const result: JSONObject = await getClickhouseTelemetryIngestionByProject();
    const projects: JSONArray = result["projects"] as JSONArray;

    expect(result["connected"]).toBe(true);
    expect(result["maxProjectsPerSignal"]).toBe(MAX_PROJECTS_PER_SIGNAL);
    expect((projects[0] as JSONObject)["projectName"]).toBe("Acme");
    expect((projects[1] as JSONObject)["projectName"]).toBeNull();
    expect(ProjectService.findBy).toHaveBeenCalledTimes(1);

    const findByArgument: Record<string, unknown> = jest.mocked(
      ProjectService.findBy,
    ).mock.calls[0]?.[0] as unknown as Record<string, unknown>;

    expect(findByArgument["select"]).toEqual({ _id: true, name: true });
    expect(findByArgument["limit"]).toBe(LIMIT_MAX);
    expect(findByArgument["props"]).toEqual({ isRoot: true });
  });

  test("a name lookup failure still returns every project, labelled by id", async () => {
    jest
      .mocked(getTelemetryIngestionByProject)
      .mockResolvedValueOnce(ingestionFor(["p1"]));
    jest
      .spyOn(ProjectService, "findBy")
      .mockRejectedValue(new Error("database blip"));

    const result: JSONObject = await getClickhouseTelemetryIngestionByProject();

    expect(result["projects"]).toEqual([
      {
        projectId: "p1",
        projectName: null,
        lastMinute: 1,
        lastHour: 2,
        lastDay: 3,
        signals: [],
      },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      "AdminHealth: failed to resolve telemetry project names",
    );
  });

  test("no reporting project means no project read at all", async () => {
    jest.spyOn(ProjectService, "findBy").mockResolvedValue([] as never);

    const result: JSONObject = await getClickhouseTelemetryIngestionByProject();

    expect(result["projects"]).toEqual([]);
    expect(ProjectService.findBy).not.toHaveBeenCalled();
  });
});

/*
 * The route pins that used to live in core's
 * packages/App/Tests/AdminDashboard/TelemetryHealthPageWiring.test.ts, which
 * now only pins core's fallbacks. Source text, comments stripped.
 */
describe("telemetry ingestion route wiring", () => {
  const source: string = stripComments(
    fs.readFileSync(HEALTH_DASHBOARDS_SOURCE_PATH, "utf8"),
  );

  test("registers both ingestion routes", () => {
    expect(source).toContain('"/clickhouse-telemetry-ingestion"');
    expect(source).toContain('"/clickhouse-telemetry-ingestion-by-project"');
  });

  /*
   * Per-project ingestion names every tenant on the instance. It has to sit
   * behind the same master-admin authorization as the rest of the health API.
   */
  test("the by-project route is master-admin gated", () => {
    expect(source).toMatch(
      /"\/clickhouse-telemetry-ingestion-by-project",\s*MasterAdminAuthorization\.isAuthorizedMasterAdmin/,
    );
  });

  test("both ingestion routes are license-gated", () => {
    for (const route of [
      '"/clickhouse-telemetry-ingestion"',
      '"/clickhouse-telemetry-ingestion-by-project"',
    ]) {
      const routeAt: number = source.indexOf(route);
      const handler: string = source.slice(routeAt, routeAt + 600);

      expect(handler).toContain("EnterpriseEdition.assertFeatureAvailable(");
      expect(handler).toContain("EnterpriseFeature.InstanceHealth");
      expect(handler).not.toContain("IsEnterpriseEdition");
    }
  });

  /*
   * Both views read the same table list and the same event-time columns from
   * the shared probe; the by-signal figures come through core's probes module,
   * the same function the support bundle calls.
   */
  test("both views are served from the one shared probe", () => {
    expect(source).toContain(
      'from "Common/Server/Utils/InstanceHealth/TelemetryIngestion"',
    );
    expect(source).toContain("getTelemetryIngestionByProject()");
    expect(source).toContain('from "App/API/AdminHealthProbes"');
    expect(source).toContain("getClickhouseTelemetryIngestion()");
  });

  test("names are resolved for the reporting projects only, and a failure does not fail the request", () => {
    const functionAt: number = source.indexOf(
      "async function getClickhouseTelemetryIngestionByProject",
    );
    const body: string = source.slice(functionAt, functionAt + 2500);

    expect(functionAt).toBeGreaterThan(-1);
    expect(body).toContain("QueryHelper.any(projectIds)");
    expect(body).toContain("attachProjectNames(");
    expect(body).toMatch(/catch \(err\)/);
  });
});

describe("the enterprise admin-health code imports core's probes, never its router", () => {
  const ROUTER_IMPORT: RegExp = /from "App\/API\/AdminHealth"/;

  test.each(
    fs.readdirSync(ADMIN_HEALTH_SERVER_DIR).filter((file: string): boolean => {
      return file.endsWith(".ts");
    }),
  )("%s", (file: string) => {
    const fileSource: string = stripComments(
      fs.readFileSync(path.join(ADMIN_HEALTH_SERVER_DIR, file), "utf8"),
    );

    expect(ROUTER_IMPORT.test(fileSource)).toBe(false);
    expect(fileSource).not.toContain("../packages/");
  });

  // Negative control: the pattern tells the two modules apart.
  test("the check catches the router import and allows the probes import", () => {
    expect(
      ROUTER_IMPORT.test('import Router from "App/API/AdminHealth";'),
    ).toBe(true);
    expect(
      ROUTER_IMPORT.test(
        'import { getRedisStats } from "App/API/AdminHealthProbes";',
      ),
    ).toBe(false);
  });
});
