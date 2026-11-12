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
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import AdminHealthRouter, {
  getInstallationHealthFacts,
  getPendingMigrationFailure,
  installationHealthMiddleware,
  InstallationHealthReaders,
} from "../../API/AdminHealth";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import CustomDomainServerReadiness from "Common/Server/Utils/CustomDomain/CustomDomainServerReadiness";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Exception from "Common/Types/Exception/Exception";
import InstallationHealthUtil, {
  InstallationHealthAnswer,
  InstallationHealthFacts,
  InstallationHealthFindingId,
} from "Common/Types/InstallationHealth/InstallationHealth";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { ServerSetupChecklistAnswer } from "Common/Types/ServerSetup/ServerSetupChecklist";

/*
 * GET /api/admin/health/doctor (#6826): what is wrong with this installation,
 * for the Admin Dashboard's OneUptime Health overview, `npm run doctor` and
 * diagnose.sh.
 *
 *   - Every edition: it is a Community route (AdminHealthEditionGates).
 *   - The cluster key, which a Docker Compose host's config.env and the app
 *     pod hold, or a master admin (or the master API key): a request that
 *     presents a cluster key is judged by the cluster key alone.
 *   - Only a cluster-key caller gets a proof to ask HOST for.
 *   - Each fact is read on its own: one datastore down neither hides the
 *     others nor fails the answer, and what needs PostgreSQL is not asked
 *     while it does not answer.
 */

type Middleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const EMPTY_CHECKLIST: ServerSetupChecklistAnswer = {
  checks: [],
  openRequired: [],
  isHiddenForReader: false,
};

const readers: (
  overrides?: Partial<InstallationHealthReaders>,
) => InstallationHealthReaders = (
  overrides: Partial<InstallationHealthReaders> = {},
): InstallationHealthReaders => {
  return {
    isPostgresConnected: async (): Promise<boolean> => {
      return true;
    },
    isClickhouseConnected: async (): Promise<boolean> => {
      return true;
    },
    isValkeyConnected: async (): Promise<boolean> => {
      return true;
    },
    migrations: async (): Promise<JSONObject> => {
      return {
        postgres: { connected: true, totalPending: 0, pendingMigrations: [] },
        dataMigrations: {
          connected: true,
          totalPending: 0,
          pendingMigrations: [],
        },
      };
    },
    clickhouseDisks: async (): Promise<
      InstallationHealthFacts["clickhouseDisks"]
    > => {
      return [{ name: "ch default", freeInBytes: 80, totalInBytes: 100 }];
    },
    queues: async (): Promise<JSONArray> => {
      return [
        { name: "Worker", waiting: 2, failed: 100 },
        { name: "Telemetry", error: true },
      ];
    },
    latestVersion: async (): Promise<string | null> => {
      return null;
    },
    serverSetup: async (): Promise<ServerSetupChecklistAnswer> => {
      return EMPTY_CHECKLIST;
    },
    ...overrides,
  };
};

describe("the facts", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a healthy server: every fact read, and nothing to say", async () => {
    const facts: InstallationHealthFacts =
      await getInstallationHealthFacts(readers());

    expect(facts.isPostgresConnected).toBe(true);
    expect(facts.migrations).toEqual({ pending: 0, failure: null });
    expect(facts.queues).toEqual([
      { name: "Worker", waiting: 2 },
      { name: "Telemetry", waiting: 0 },
    ]);
    expect(facts.serverSetup).toEqual(EMPTY_CHECKLIST);
    expect(InstallationHealthUtil.evaluate(facts)).toEqual([]);
  });

  test("PostgreSQL down: what needs it is not asked, and the rest still is", async () => {
    const asked: Array<string> = [];
    const facts: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        isPostgresConnected: async (): Promise<boolean> => {
          return false;
        },
        migrations: async (): Promise<JSONObject> => {
          asked.push("migrations");
          return {};
        },
        serverSetup: async (): Promise<ServerSetupChecklistAnswer> => {
          asked.push("serverSetup");
          return EMPTY_CHECKLIST;
        },
        latestVersion: async (): Promise<string | null> => {
          asked.push("latestVersion");
          return null;
        },
      }),
    );

    expect(asked).toEqual([]);
    expect(facts.migrations).toBe(null);
    expect(facts.serverSetup).toBe(null);
    expect(facts.clickhouseDisks).toHaveLength(1);
    expect(
      InstallationHealthUtil.evaluate(facts).map(
        (finding: { id: string }): string => {
          return finding.id;
        },
      ),
    ).toEqual([InstallationHealthFindingId.Postgres]);
  });

  test("a reader that throws answers as down, and the answer still comes", async () => {
    const facts: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        isValkeyConnected: async (): Promise<boolean> => {
          throw new Error("ECONNREFUSED");
        },
        serverSetup: async (): Promise<ServerSetupChecklistAnswer> => {
          throw new Error("relation does not exist");
        },
      }),
    );

    expect(facts.isValkeyConnected).toBe(false);
    expect(facts.queues).toEqual([]);
    expect(facts.serverSetup).toBe(null);
    expect(logger.error).toHaveBeenCalled();
  });

  test("pending migrations of both runners are counted, and a failure of one still pending is named", async () => {
    const facts: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        migrations: async (): Promise<JSONObject> => {
          return {
            postgres: {
              connected: true,
              totalPending: 1,
              pendingMigrations: ["AddThing1809110968240"],
              recentFailures: [
                {
                  migrationName: "AddThing1809110968240",
                  errorMessage: "column already exists",
                  attemptedAt: "2026-11-10T09:30:00.000Z",
                },
              ],
            },
            dataMigrations: {
              connected: true,
              totalPending: 2,
              pendingMigrations: ["A", "B"],
            },
          };
        },
      }),
    );

    expect(facts.migrations).toEqual({
      pending: 3,
      failure: {
        name: "AddThing1809110968240",
        reason: "column already exists",
        at: "2026-11-10T09:30:00.000Z",
      },
    });
  });

  test("a failure of a migration that has since run is not named", () => {
    expect(
      getPendingMigrationFailure({
        pendingMigrations: ["Later"],
        recentFailures: [
          { migrationName: "Earlier", errorMessage: "x" },
          { migrationName: "Later", errorMessage: "" },
        ],
      }),
    ).toEqual({ name: "Later", reason: "no error was recorded", at: null });
    expect(
      getPendingMigrationFailure({
        pendingMigrations: [],
        recentFailures: [{ migrationName: "Earlier", errorMessage: "x" }],
      }),
    ).toBe(null);
    expect(getPendingMigrationFailure(undefined)).toBe(null);
  });

  test("a newer release is an update; a reader that could not tell is not", async () => {
    const newer: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        latestVersion: async (): Promise<string | null> => {
          return "999.0.0";
        },
      }),
    );

    expect(newer.version.latest).toBe("999.0.0");
    expect(newer.version.isUpdateAvailable).toBe(
      newer.version.current !== "unknown",
    );

    const unknown: InstallationHealthFacts =
      await getInstallationHealthFacts(readers());

    expect(unknown.version.isUpdateAvailable).toBe(false);
  });
});

describe("who may ask", () => {
  let serviceMiddleware: jest.SpiedFunction<Middleware>;
  let masterAdminMiddleware: jest.SpiedFunction<Middleware>;

  beforeEach(() => {
    serviceMiddleware = jest
      .spyOn(ClusterKeyAuthorization, "isAuthorizedServiceMiddleware")
      .mockImplementation(async (): Promise<void> => {
        return undefined;
      }) as unknown as jest.SpiedFunction<Middleware>;
    masterAdminMiddleware = jest
      .spyOn(
        MasterAdminAuthorization,
        "isAuthorizedMasterAdminOrMasterApiKeyMiddleware",
      )
      .mockImplementation(async (): Promise<void> => {
        return undefined;
      }) as unknown as jest.SpiedFunction<Middleware>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const requestWith: (headers: Record<string, string>) => ExpressRequest = (
    headers: Record<string, string>,
  ): ExpressRequest => {
    return { headers: headers, query: {}, url: "/doctor" } as ExpressRequest;
  };

  test("a request that presents the cluster key is judged by the cluster key alone", async () => {
    await installationHealthMiddleware(
      requestWith({ clusterkey: "some-key" }),
      {} as ExpressResponse,
      (): void => {
        return undefined;
      },
    );

    expect(serviceMiddleware).toHaveBeenCalledTimes(1);
    expect(masterAdminMiddleware).not.toHaveBeenCalled();
  });

  test("KEDA's spelling of the header counts too", async () => {
    await installationHealthMiddleware(
      requestWith({ "x-clusterkey": "some-key" }),
      {} as ExpressResponse,
      (): void => {
        return undefined;
      },
    );

    expect(serviceMiddleware).toHaveBeenCalledTimes(1);
  });

  test("any other request needs a master admin, or the master API key", async () => {
    await installationHealthMiddleware(
      requestWith({ apikey: "x" }),
      {} as ExpressResponse,
      (): void => {
        return undefined;
      },
    );

    expect(masterAdminMiddleware).toHaveBeenCalledTimes(1);
    expect(serviceMiddleware).not.toHaveBeenCalled();
  });

  test("the route is registered with this middleware first", () => {
    const layer:
      | { route?: { path: string; stack: Array<{ handle: unknown }> } }
      | undefined = (
      AdminHealthRouter as unknown as {
        stack: Array<{
          route?: { path: string; stack: Array<{ handle: unknown }> };
        }>;
      }
    ).stack.find(
      (candidate: { route?: { path: string } }): boolean => {
        return candidate.route?.path === "/doctor";
      },
    );

    expect(layer?.route?.stack[0]?.handle).toBe(installationHealthMiddleware);
    expect(layer?.route?.stack).toHaveLength(2);
  });
});

describe("over HTTP", () => {
  let httpServer: Server;
  let baseUrl: string = "";

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
        res.status(500).json({ message: error.message });
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
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    // No connection held: every datastore is down, and nothing is dialled.
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(null);
    jest.spyOn(Redis, "getClient").mockReturnValue(null);
    jest
      .spyOn(CustomDomainServerReadiness, "createProof")
      .mockReturnValue("nonce.signature");
    jest
      .spyOn(ClusterKeyAuthorization, "isAuthorizedServiceMiddleware")
      .mockImplementation(
        async (
          _req: ExpressRequest,
          _res: ExpressResponse,
          next: NextFunction,
        ): Promise<void> => {
          next();
        },
      );
    jest
      .spyOn(
        MasterAdminAuthorization,
        "isAuthorizedMasterAdminOrMasterApiKeyMiddleware",
      )
      .mockImplementation(
        async (
          _req: ExpressRequest,
          _res: ExpressResponse,
          next: NextFunction,
        ): Promise<void> => {
          next();
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const get: (
    headers: Record<string, string>,
  ) => Promise<{ status: number; answer: InstallationHealthAnswer | null }> =
    async (
      headers: Record<string, string>,
    ): Promise<{ status: number; answer: InstallationHealthAnswer | null }> => {
      const response: globalThis.Response = await fetch(
        `${baseUrl}/api/admin/health/doctor`,
        { headers },
      );

      return {
        status: response.status,
        answer: InstallationHealthUtil.parseAnswer(await response.json()),
      };
    };

  test("with the cluster key: every datastore that does not answer, worst first, and a proof to ask HOST for", async () => {
    const result: {
      status: number;
      answer: InstallationHealthAnswer | null;
    } = await get({ clusterkey: "some-key" });

    expect(result.status).toBe(200);
    expect(
      result.answer!.findings.map((finding: { id: string }): string => {
        return finding.id;
      }),
    ).toEqual([
      InstallationHealthFindingId.Postgres,
      InstallationHealthFindingId.Clickhouse,
      InstallationHealthFindingId.Valkey,
    ]);
    expect(result.answer!.findings[0]!.sentence).toBe(
      "PostgreSQL does not answer, so OneUptime cannot read or save anything.",
    );
    expect(result.answer!.addressProof).toBe("nonce.signature");
    expect(result.answer!.checkedAt).not.toBe("");
  });

  test("a master admin gets the same findings, and no proof", async () => {
    const result: {
      status: number;
      answer: InstallationHealthAnswer | null;
    } = await get({});

    expect(result.status).toBe(200);
    expect(result.answer!.findings).toHaveLength(3);
    expect(result.answer!.addressProof).toBe(null);
  });
});
