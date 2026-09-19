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
import nodePath from "path";

/*
 * Which OneUptime Health API core answers, on which edition.
 *
 * ClickHouse capacity (and its audit log), migrations and the support bundle
 * answer on every edition. The live dashboards and the query console are
 * Enterprise code: they live in the enterprise module (ee/Server/AdminHealth,
 * tested in ee/Tests/Server/AdminHealth), and core only keeps 402 fallbacks
 * for their paths - gated on the LICENSE through
 * EnterpriseEdition.assertFeatureAvailable(InstanceHealth), never on the raw
 * IS_ENTERPRISE_EDITION variable. This suite never needs ee/: CI runs it with
 * ee/ deleted.
 *
 * Real HTTP through the real router. Master-admin authorization passes every
 * request (it is not what is under test), and the datastores are reported as
 * not connected, so every handler that is allowed to run answers 200.
 *
 * Billing AND the edition are pinned in every test: CI's config.env sets
 * BILLING_ENABLED=true, and OneUptime Cloud (billing on) always passes the
 * license gate.
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

jest.mock("../../FeatureSet/APIReference/Utils/Resources", () => {
  return {
    __esModule: true,
    default: {
      getResources: (): Array<never> => {
        return [];
      },
    },
  };
});

jest.mock("../../FeatureSet/APIReference/Utils/DataTypes", () => {
  return {
    __esModule: true,
    default: {
      getDataTypes: (): Array<never> => {
        return [];
      },
    },
  };
});

import AdminHealthRouter, {
  getHealthDashboardMiddleware,
  HEALTH_DASHBOARD_PATHS,
  HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
  JWT_ONLY_HEALTH_DASHBOARD_PATHS,
  QUERY_CONSOLE_PATHS,
  QUERY_CONSOLE_UNAVAILABLE_MESSAGE,
} from "../../API/AdminHealth";
import { MasterAdminApis } from "../../FeatureSet/APIReference/Service/MasterAdminApis";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Queue from "Common/Server/Infrastructure/Queue";
import Redis from "Common/Server/Infrastructure/Redis";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import Express, {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import { getRedisInfoSnapshot } from "Common/Server/Utils/InstanceHealth/RedisHealth";
import {
  getTelemetryIngestionByProject,
  getTelemetryIngestionBySignal,
} from "Common/Server/Utils/InstanceHealth/TelemetryIngestion";
import logger from "Common/Server/Utils/Logger";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

/*
 * The live dashboards, as requested. The enterprise module serves them; core
 * answers each with a 402.
 */
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

// Available on every edition.
const COMMUNITY_ROUTES: Array<string> = [
  "/clickhouse-capacity",
  "/instance-health-logs",
  "/migrations",
  "/support-bundle",
];

interface HttpResult {
  status: number;
  body: JSONObject;
}

interface EditionState {
  label: string;
  billing: boolean;
  install: () => void;
}

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
const originalEnvironment: NodeJS.ProcessEnv = { ...process.env };

const request: (method: string, path: string) => Promise<HttpResult> = async (
  method: string,
  path: string,
): Promise<HttpResult> => {
  const response: globalThis.Response = await fetch(
    `${baseUrl}/api/admin/health${path}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "POST"
        ? { body: JSON.stringify({ query: "SELECT 1", readOnly: true }) }
        : {}),
    },
  );

  return {
    status: response.status,
    body: (await response.json()) as JSONObject,
  };
};

const get: (path: string) => Promise<HttpResult> = (
  path: string,
): Promise<HttpResult> => {
  return request("GET", path);
};

const enter: (state: EditionState) => void = (state: EditionState): void => {
  setTestBillingEnabled(state.billing);
  state.install();
};

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

const layersOf: (router: ExpressRouter) => Array<RouteLayer> = (
  router: ExpressRouter,
): Array<RouteLayer> => {
  return (router as unknown as { stack: Array<RouteLayer> }).stack;
};

const routeLayers: () => Array<RouteLayer> = (): Array<RouteLayer> => {
  return layersOf(AdminHealthRouter);
};

/*
 * Every problem with a router's live-dashboard fallbacks: a path without a
 * GET route, a route on the wrong middleware, or a route with more in its
 * stack than the middleware and the handler.
 */
const findFallbackProblems: (router: ExpressRouter) => Array<string> = (
  router: ExpressRouter,
): Array<string> => {
  const problems: Array<string> = [];

  for (const path of HEALTH_DASHBOARD_PATHS) {
    const layer: RouteLayer | undefined = layersOf(router).find(
      (candidate: RouteLayer): boolean => {
        return (
          candidate.route?.path === path &&
          Boolean(candidate.route?.methods["get"])
        );
      },
    );

    if (!layer?.route) {
      problems.push(`${path}: no GET route`);
      continue;
    }

    const expected: unknown = JWT_ONLY_HEALTH_DASHBOARD_PATHS.includes(path)
      ? MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware
      : MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware;

    if (layer.route.stack[0]?.handle !== expected) {
      problems.push(`${path}: wrong middleware`);
    }

    if (layer.route.stack.length !== 2) {
      problems.push(`${path}: ${layer.route.stack.length} handlers, not 2`);
    }
  }

  return problems;
};

/*
 * The enterprise-only probes and state that moved to ee/Server/AdminHealth.
 * None of them may come back to the Apache-2.0 core.
 */
const ENTERPRISE_ONLY_MARKERS: Array<string> = [
  "getHealthSummary",
  "getClickhouseHealthSummary",
  "getPostgresActivity",
  "getClickhouseTelemetryIngestionByProject",
  "getTelemetryIngestionByProject",
  "attachProjectNames",
  "ACTIVITY_QUERY_TEXT_LENGTH",
  "pg_stat_statements",
  "pg_stat_progress_vacuum",
  "overviewCache",
  "queuesCache",
];

const findEnterpriseOnlyMarkers: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const code: string = stripComments(source);

  return ENTERPRISE_ONLY_MARKERS.filter((marker: string): boolean => {
    return code.includes(marker);
  });
};

const readApiSource: (file: string) => string = (file: string): string => {
  return fs.readFileSync(nodePath.join(__dirname, "../../API", file), "utf8");
};

// Removes comments, so prose about a pattern cannot satisfy or break a check.
const stripComments: (source: string) => string = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
};

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson());
  app.use("/api/admin/health", AdminHealthRouter);
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

  // The module mocks above keep their calls across tests unless cleared.
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
  jest.spyOn(Queue, "getQueueStats").mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    delayed: 0,
    total: 0,
  });
  jest.spyOn(Queue, "getFailedJobsWithDetails").mockResolvedValue([]);
  jest.spyOn(InstanceHealthLogService, "findBy").mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  process.env = { ...originalEnvironment };
});

describe("the live OneUptime Health dashboards are not part of core", () => {
  describe.each(LOCKED_STATES)(
    "on $label",
    (state: EditionState & { message: string }) => {
      test.each(ENTERPRISE_ROUTES)(
        "GET %s answers 402 with the edition's own message",
        async (path: string) => {
          enter(state);

          const result: HttpResult = await get(path);

          expect(result.status).toBe(402);
          expect(result.body["message"]).toBe(state.message);
        },
      );
    },
  );

  /*
   * Where the license allows the dashboards, the enterprise router answers
   * first (ee/Tests/Server/AdminHealth covers that). A request that still
   * reaches core means the module did not serve it, and says so.
   */
  describe.each(OPEN_STATES)("on $label", (state: EditionState) => {
    test.each(ENTERPRISE_ROUTES)(
      "GET %s still answers 402 when a licensed Enterprise module left the request to core",
      async (path: string) => {
        enter(state);

        const result: HttpResult = await get(path);

        expect(result.status).toBe(402);
        expect(result.body["message"]).toBe(
          HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
        );
      },
    );
  });

  test("the three messages are different, so an operator can tell the cases apart", () => {
    const messages: Array<string> = [
      EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
      EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
      HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
    ];

    expect(new Set(messages).size).toBe(messages.length);
    expect(HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE).toContain(
      "did not serve this request",
    );
  });

  test("the fallbacks read the license on every request, without a restart", async () => {
    setTestBillingEnabled(false);
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    expect((await get("/postgres-cluster")).body["message"]).toBe(
      HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
    );

    fake.setSnapshot(createLicenseSnapshotWithStatus("expired"));
    expect((await get("/postgres-cluster")).body["message"]).toBe(
      EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
    );

    fake.setSnapshot(createLicenseSnapshot());
    expect((await get("/postgres-cluster")).body["message"]).toBe(
      HEALTH_DASHBOARD_UNAVAILABLE_MESSAGE,
    );
  });

  test("the fallbacks cover exactly the moved dashboard paths", () => {
    expect([...HEALTH_DASHBOARD_PATHS]).toEqual(
      ENTERPRISE_ROUTES.map((path: string): string => {
        return path.replace("/Worker/", "/:queueName/");
      }),
    );
    expect([...JWT_ONLY_HEALTH_DASHBOARD_PATHS]).toEqual([
      "/postgres-activity",
    ]);
  });

  /*
   * Same middleware as the enterprise route each one stands in for: live
   * Postgres activity returns statement text, so it takes a master-admin
   * session only, never the static master API key.
   */
  test("every moved path has a fallback on the right middleware", () => {
    expect(findFallbackProblems(AdminHealthRouter)).toEqual([]);

    for (const path of HEALTH_DASHBOARD_PATHS) {
      expect({ path, middleware: getHealthDashboardMiddleware(path) }).toEqual({
        path,
        middleware:
          path === "/postgres-activity"
            ? MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware
            : MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
      });
    }
  });

  // Negative control: the check above does fail on a bad router.
  test("the fallback check catches a missing path, a wrong middleware and an extra handler", () => {
    const router: ExpressRouter = Express.getRouter();
    const handler: () => void = (): void => {
      return undefined;
    };

    for (const path of HEALTH_DASHBOARD_PATHS) {
      if (path === "/logs") {
        continue;
      }

      if (path === "/postgres-activity") {
        router.get(
          path,
          MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
          handler,
        );
        continue;
      }

      if (path === "/redis") {
        router.get(
          path,
          MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
          handler,
          handler,
        );
        continue;
      }

      router.get(path, getHealthDashboardMiddleware(path), handler);
    }

    expect(findFallbackProblems(router).sort()).toEqual(
      [
        "/logs: no GET route",
        "/postgres-activity: wrong middleware",
        "/redis: 3 handlers, not 2",
      ].sort(),
    );
  });

  test("the fallbacks never reach a datastore, even when the license allows the dashboards", async () => {
    installFakeEnterpriseModule();

    for (const path of ENTERPRISE_ROUTES) {
      expect((await get(path)).status).toBe(402);
    }

    expect(PostgresAppInstance.getDataSource).not.toHaveBeenCalled();
    expect(ClickhouseAppInstance.getDataSource).not.toHaveBeenCalled();
    expect(Redis.getClient).not.toHaveBeenCalled();
    expect(Queue.getQueueStats).not.toHaveBeenCalled();
    expect(Queue.getFailedJobsWithDetails).not.toHaveBeenCalled();
    expect(getRedisInfoSnapshot).not.toHaveBeenCalled();
    expect(getTelemetryIngestionBySignal).not.toHaveBeenCalled();
    expect(getTelemetryIngestionByProject).not.toHaveBeenCalled();
  });
});

describe("no enterprise-only code is left in core", () => {
  test.each(["AdminHealth.ts", "AdminHealthProbes.ts"])(
    "%s defines none of the enterprise-only probes",
    (file: string) => {
      expect({
        file,
        found: findEnterpriseOnlyMarkers(readApiSource(file)),
      }).toEqual({ file, found: [] });
    },
  );

  test("core's router registers no working handler for a moved path", () => {
    const source: string = stripComments(readApiSource("AdminHealth.ts"));
    const literalGetPaths: Array<string> = Array.from(
      source.matchAll(/router\.get\(\s*"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(literalGetPaths.sort()).toEqual([...COMMUNITY_ROUTES].sort());
  });

  // Negative control: the marker check does fail on enterprise code.
  test("the marker check catches a moved probe, but not prose about it", () => {
    expect(
      findEnterpriseOnlyMarkers(
        "export async function getPostgresActivity(): Promise<JSONObject> {}",
      ),
    ).toEqual(["getPostgresActivity"]);
    expect(
      findEnterpriseOnlyMarkers(
        "let overviewCache: JSONObject | null = null;\nconst sql: string = 'SELECT * FROM pg_stat_statements';",
      ),
    ).toEqual(["pg_stat_statements", "overviewCache"]);
    expect(
      findEnterpriseOnlyMarkers(
        "/* getPostgresActivity moved to ee */\n// so did getHealthSummary\nconst x: number = 1;",
      ),
    ).toEqual([]);
  });

  /*
   * The enterprise dashboards import the probes module, never the router: a
   * probes module that grew routes or an edition gate would pull core's
   * routing into ee, or gate the Community support bundle.
   */
  test("the probes module is neither a router nor edition-gated", () => {
    const probes: string = stripComments(readApiSource("AdminHealthProbes.ts"));

    expect(probes).not.toContain("Express");
    expect(probes).not.toContain("router.");
    expect(probes).not.toContain("EnterpriseEdition");
    expect(probes).not.toContain("IsEnterpriseEdition");
    expect(probes).not.toContain('from "./AdminHealth"');
  });
});

describe("the Community routes answer on every edition", () => {
  const states: Array<EditionState> = [
    LOCKED_STATES[0] as EditionState,
    LOCKED_STATES[2] as EditionState,
    LOCKED_STATES[3] as EditionState,
    OPEN_STATES[0] as EditionState,
    OPEN_STATES[4] as EditionState,
  ];

  describe.each(states)("on $label", (state: EditionState) => {
    test.each(COMMUNITY_ROUTES)("GET %s answers 200", async (path: string) => {
      enter(state);

      const result: HttpResult = await get(path);

      expect(result.status).toBe(200);
    });
  });

  test("ClickHouse capacity reports the datastore, not an upsell, on the Community Edition", async () => {
    const result: HttpResult = await get("/clickhouse-capacity");

    expect(result.status).toBe(200);
    expect(result.body["connected"]).toBe(false);
    expect(result.body).toHaveProperty("diskByNode");
    expect(result.body).toHaveProperty("localTableSizesByShard");
  });

  test("the instance health log is listed on the Community Edition", async () => {
    const result: HttpResult = await get("/instance-health-logs");

    expect(result.status).toBe(200);
    expect(result.body["logs"]).toEqual([]);
    expect(InstanceHealthLogService.findBy).toHaveBeenCalledTimes(1);
  });
});

describe("the query console is not part of core", () => {
  test.each(QUERY_CONSOLE_PATHS)(
    "POST %s answers 402 with the Community message on the Community Edition",
    async (path: string) => {
      const result: HttpResult = await request("POST", path);

      expect(result.status).toBe(402);
      expect(result.body["message"]).toBe(
        EnterpriseEdition.COMMUNITY_EDITION_MESSAGE,
      );
    },
  );

  test.each(QUERY_CONSOLE_PATHS)(
    "POST %s answers 402 with the license message on an unlicensed Enterprise Edition",
    async (path: string) => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });

      const result: HttpResult = await request("POST", path);

      expect(result.status).toBe(402);
      expect(result.body["message"]).toBe(
        EnterpriseEdition.LICENSE_REQUIRED_MESSAGE,
      );
    },
  );

  test.each(QUERY_CONSOLE_PATHS)(
    "POST %s still answers 402 when a licensed Enterprise module left the request to core",
    async (path: string) => {
      installFakeEnterpriseModule();

      const result: HttpResult = await request("POST", path);

      expect(result.status).toBe(402);
      expect(result.body["message"]).toBe(QUERY_CONSOLE_UNAVAILABLE_MESSAGE);
    },
  );

  test("the fallbacks cover exactly the console's three paths", () => {
    expect([...QUERY_CONSOLE_PATHS].sort()).toEqual(
      ["/query/clickhouse", "/query/postgres", "/query/redis"].sort(),
    );
  });

  test("the fallbacks keep the console's JWT-only master-admin middleware (never the master API key)", () => {
    for (const path of QUERY_CONSOLE_PATHS) {
      const layer: RouteLayer | undefined = routeLayers().find(
        (candidate: RouteLayer): boolean => {
          return candidate.route?.path === path;
        },
      );

      expect(layer?.route?.methods["post"]).toBe(true);
      expect(layer?.route?.stack[0]?.handle).toBe(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    }
  });

  test("no query runner is left in the core AdminHealth API", () => {
    const source: string = stripComments(
      fs.readFileSync(
        nodePath.join(__dirname, "../../API/AdminHealth.ts"),
        "utf8",
      ),
    );

    for (const runner of [
      "runPostgresQuery",
      "runClickhouseQuery",
      "runRedisCommands",
      "REDIS_ALWAYS_BLOCKED",
      "DECLARE oneuptime_console_cursor",
    ]) {
      expect({ runner, found: source.includes(runner) }).toEqual({
        runner,
        found: false,
      });
    }
  });
});

describe("the support bundle keeps every probe it shares with the dashboards", () => {
  /*
   * The probes the enterprise dashboards also read moved to
   * AdminHealthProbes.ts. The Community bundle must still carry every one of
   * them, on every edition.
   */
  test.each([LOCKED_STATES[0] as EditionState, OPEN_STATES[0] as EditionState])(
    "on $label",
    async (state: EditionState) => {
      enter(state);

      const result: HttpResult = await get("/support-bundle");
      const components: JSONObject = result.body["components"] as JSONObject;

      expect(result.status).toBe(200);
      expect(Object.keys(result.body).sort()).toEqual(
        [
          "clickhouse",
          "clickhouseDiagnostics",
          "clickhouseTelemetryIngestion",
          "components",
          "config",
          "generatedAt",
          "instance",
          "logs",
          "migrations",
          "postgres",
          "postgresClusterHealth",
          "postgresDiagnostics",
          "queueDiagnostics",
          "runtime",
        ].sort(),
      );
      expect(Object.keys(components).sort()).toEqual(
        ["clickhouse", "postgres", "queues", "redis"].sort(),
      );
      expect(components["queues"]).toHaveLength(4);
      expect(result.body["queueDiagnostics"]).toHaveLength(4);
      expect(Object.keys(result.body["logs"] as JSONObject).sort()).toEqual(
        [
          "application",
          "clickhouse",
          "containerLogsNote",
          "postgres",
          "redis",
        ].sort(),
      );
      expect(getTelemetryIngestionBySignal).toHaveBeenCalledTimes(1);
    },
  );

  /*
   * Live Postgres activity returns statement text, which can embed customer
   * data. It is an enterprise dashboard only and never part of the bundle
   * operators share.
   */
  test("never carries live Postgres activity", async () => {
    installFakeEnterpriseModule();

    const result: HttpResult = await get("/support-bundle");
    const serialized: string = JSON.stringify(result.body);

    for (const key of [
      "activeQueries",
      "blockedSessions",
      "topStatements",
      "vacuumProgress",
    ]) {
      expect({ key, found: serialized.includes(`"${key}"`) }).toEqual({
        key,
        found: false,
      });
    }
  });
});

describe("the support bundle reports the edition this process really runs", () => {
  test("the Community Edition, even when IS_ENTERPRISE_EDITION=true is set", async () => {
    process.env["IS_ENTERPRISE_EDITION"] = "true";
    process.env["ONEUPTIME_EDITION"] = "auto";

    const result: HttpResult = await get("/support-bundle");
    const instance: JSONObject = result.body["instance"] as JSONObject;
    const config: JSONObject = result.body["config"] as JSONObject;

    expect(result.status).toBe(200);
    expect(instance["edition"]).toBe("Community");
    expect(instance["license"]).toBeNull();
    // The raw settings are still reported, as configuration.
    expect(config["IS_ENTERPRISE_EDITION"]).toBe("true");
    expect(config["ONEUPTIME_EDITION"]).toBe("auto");
  });

  test("the Enterprise Edition, even when IS_ENTERPRISE_EDITION is false, with its license status", async () => {
    process.env["IS_ENTERPRISE_EDITION"] = "false";
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        companyName: "Acme Secret Division",
        userLimit: 250,
      }),
    });

    const result: HttpResult = await get("/support-bundle");
    const instance: JSONObject = result.body["instance"] as JSONObject;
    const license: JSONObject = instance["license"] as JSONObject;

    expect(instance["edition"]).toBe("Enterprise");
    expect(license["status"]).toBe("valid");
    expect(license["verification"]).toBe("verified");
    expect(license["features"]).toBe("all");
    expect(license["userLimit"]).toBe(250);
    expect(license["isEvaluation"]).toBe(false);
    expect(license["instanceHealthAvailable"]).toBe(true);
    expect(typeof license["expiresAt"]).toBe("string");
  });

  test("the license part carries status and dates only - no company, key or token", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({ companyName: "Acme Secret Division" }),
    });

    const result: HttpResult = await get("/support-bundle");
    const license: JSONObject = (result.body["instance"] as JSONObject)[
      "license"
    ] as JSONObject;

    expect(Object.keys(license).sort()).toEqual(
      [
        "expiresAt",
        "features",
        "graceEndsAt",
        "graceReason",
        "instanceHealthAvailable",
        "isEvaluation",
        "status",
        "userLimit",
        "verification",
      ].sort(),
    );
    expect(JSON.stringify(result.body)).not.toContain("Acme Secret Division");
  });

  test("an expired license is reported as expired, with instance health locked", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    const result: HttpResult = await get("/support-bundle");
    const license: JSONObject = (result.body["instance"] as JSONObject)[
      "license"
    ] as JSONObject;

    expect(result.status).toBe(200);
    expect(license["status"]).toBe("expired");
    expect(license["instanceHealthAvailable"]).toBe(false);
  });

  test("a grace period reports its reason and end date", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("grace"),
    });

    const result: HttpResult = await get("/support-bundle");
    const license: JSONObject = (result.body["instance"] as JSONObject)[
      "license"
    ] as JSONObject;

    expect(license["status"]).toBe("grace");
    expect(license["graceReason"]).toBe("expired");
    expect(typeof license["graceEndsAt"]).toBe("string");
  });

  test("a license subset is listed feature by feature", async () => {
    installFakeEnterpriseModuleWithFeatures([
      EnterpriseFeature.SSO,
      EnterpriseFeature.AuditLogs,
    ]);

    const result: HttpResult = await get("/support-bundle");
    const license: JSONObject = (result.body["instance"] as JSONObject)[
      "license"
    ] as JSONObject;

    expect(license["features"]).toEqual(
      [EnterpriseFeature.AuditLogs, EnterpriseFeature.SSO].sort(),
    );
    expect(license["instanceHealthAvailable"]).toBe(false);
  });

  test("a license that cannot be read still produces a bundle", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: null,
    });
    fake.licensing.getSnapshotError = new Error("database blip");

    const result: HttpResult = await get("/support-bundle");
    const instance: JSONObject = result.body["instance"] as JSONObject;

    expect(result.status).toBe(200);
    expect(instance["edition"]).toBe("Enterprise");
    expect(instance["license"]).toEqual({ status: "unknown" });
  });
});

describe("the master admin API reference matches the routes", () => {
  const toRequestPath: (documentedPath: string) => string = (
    documentedPath: string,
  ): string => {
    return documentedPath.replace("{queueName}", "Worker");
  };

  test("ClickHouse capacity and the instance health log are documented as available on every edition", () => {
    const flags: Record<string, boolean> = {};

    for (const api of MasterAdminApis) {
      flags[api.path] = api.isEnterpriseEdition;
    }

    expect(flags).toEqual({
      "/overview": true,
      "/queues": true,
      "/queues/{queueName}/failed-jobs": true,
      "/clickhouse-capacity": false,
      "/clickhouse-cluster": true,
      "/clickhouse-telemetry-ingestion": true,
      "/postgres-cluster": true,
      "/redis": true,
      "/instance-health-logs": false,
      "/logs": true,
      "/migrations": false,
      "/support-bundle": false,
    });
  });

  test.each(
    MasterAdminApis.map(
      (api: {
        path: string;
        isEnterpriseEdition: boolean;
      }): [string, boolean] => {
        return [api.path, api.isEnterpriseEdition];
      },
    ),
  )(
    "%s: the Enterprise badge (%s) matches what the Community Edition answers",
    async (documentedPath: string, isEnterpriseEdition: boolean) => {
      const result: HttpResult = await get(toRequestPath(documentedPath));

      expect(result.status).toBe(isEnterpriseEdition ? 402 : 200);
    },
  );

  /*
   * Accepts the master API key but has never been listed in the reference: its
   * description needs a new pages.masterAdminApis.*Desc string in all 17
   * APIReference locales. Listed here so the gap stays visible, and so a new
   * undocumented route still fails this test.
   */
  const KNOWN_UNDOCUMENTED_KEY_ROUTES: Array<string> = [
    "/clickhouse-telemetry-ingestion-by-project",
  ];

  test("documents exactly the GET routes that accept the master API key", () => {
    const keyRoutes: Array<string> = routeLayers()
      .filter((layer: RouteLayer): boolean => {
        return (
          Boolean(layer.route?.methods["get"]) &&
          layer.route?.stack[0]?.handle ===
            MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware
        );
      })
      .map((layer: RouteLayer): string => {
        return String(layer.route?.path).replace(":queueName", "{queueName}");
      })
      .filter((path: string): boolean => {
        return !KNOWN_UNDOCUMENTED_KEY_ROUTES.includes(path);
      })
      .sort();

    expect(keyRoutes).toEqual(
      MasterAdminApis.map((api: { path: string }): string => {
        return api.path;
      }).sort(),
    );
  });

  test("the known undocumented route is still a licensed one", async () => {
    for (const path of KNOWN_UNDOCUMENTED_KEY_ROUTES) {
      expect(ENTERPRISE_ROUTES).toContain(path);
      expect((await get(path)).status).toBe(402);
    }
  });
});

describe("the core AdminHealth router", () => {
  test("holds routes only, so nothing in it can run for another router's request", () => {
    expect(
      EnterpriseServerModuleShape.findLayersWithoutRoute(AdminHealthRouter),
    ).toEqual([]);
  });

  test("registers a fallback for every live dashboard path, and every Community route", () => {
    const paths: Array<string> = routeLayers().map(
      (layer: RouteLayer): string => {
        return String(layer.route?.path);
      },
    );

    for (const path of ENTERPRISE_ROUTES) {
      expect(paths).toContain(path.replace("/Worker/", "/:queueName/"));
    }

    for (const path of COMMUNITY_ROUTES) {
      expect(paths).toContain(path);
    }
  });

  test("never reads the raw IS_ENTERPRISE_EDITION flag", () => {
    const source: string = stripComments(readApiSource("AdminHealth.ts"));

    expect(source).not.toContain("IsEnterpriseEdition");
    expect(source).toContain(
      "EnterpriseEdition.assertFeatureAvailable(\n          EnterpriseFeature.InstanceHealth,",
    );
  });
});
