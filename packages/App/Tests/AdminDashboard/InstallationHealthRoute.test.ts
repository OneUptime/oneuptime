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
import { SpyInstance } from "jest-mock";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import AdminHealthRouter, {
  getInstallationHealthFacts,
  getPendingMigrationFailure,
  InstallationHealthReaders,
} from "../../API/AdminHealth";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import ClusterKeyAuthorization, {
  CLUSTER_KEY_IN_URL_MESSAGE,
  CLUSTER_KEY_NOT_FOUND_MESSAGE,
  INVALID_CLUSTER_KEY_MESSAGE,
  SHIPPED_CLUSTER_KEY_MESSAGE,
} from "Common/Server/Middleware/ClusterKeyAuthorization";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import ProjectMiddleware from "Common/Server/Middleware/ProjectAuthorization";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
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
import ObjectID from "Common/Types/ObjectID";
import { ServerSetupChecklistAnswer } from "Common/Types/ServerSetup/ServerSetupChecklist";

/*
 * /api/admin/health/doctor (#6826): what is wrong with this installation,
 * for the Admin Dashboard's OneUptime Health overview, `npm run doctor` and
 * diagnose.sh.
 *
 *   - Every edition: it is a Community route (AdminHealthEditionGates).
 *   - GET is the Admin Dashboard's: a master admin's session, or the master
 *     API key. A cluster key does not stand in for either.
 *   - POST is the doctor's and diagnose.sh's: the cluster key, which a
 *     Docker Compose host's config.env and the app pod hold, through
 *     ClusterKeyAuthorization's one check, as every route that takes the
 *     key (Common's ClusterKeyGuard). A master admin's session or the master
 *     API key does not stand in for it.
 *   - Only the POST's answer carries a proof to ask HOST for.
 *   - Each fact is read on its own: one datastore down neither hides the
 *     others nor fails the answer, and what needs PostgreSQL is not asked
 *     while it does not answer.
 *
 * It was one GET that took all three, until the rule of #5014 caught it: a
 * route that takes the cluster key is a POST, handed the check by its
 * router, and nothing else reads the key.
 */

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

const MASTER_API_KEY: string = ObjectID.generate().toString();

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

// The router's layers for /doctor, in the order they were registered.
const doctorLayers: () => Array<RouteLayer> = (): Array<RouteLayer> => {
  return (
    AdminHealthRouter as unknown as { stack: Array<RouteLayer> }
  ).stack.filter((layer: RouteLayer): boolean => {
    return layer.route?.path === "/doctor";
  });
};

const doctorLayer: (method: "get" | "post") => RouteLayer | undefined = (
  method: "get" | "post",
): RouteLayer | undefined => {
  return doctorLayers().find((layer: RouteLayer): boolean => {
    return Boolean(layer.route?.methods[method]);
  });
};

describe("who may ask", () => {
  test("a GET and a POST answer it, and no other method", () => {
    expect(
      doctorLayers().map((layer: RouteLayer): Record<string, boolean> => {
        return layer.route?.methods || {};
      }),
    ).toEqual([{ get: true }, { post: true }]);
  });

  test("the GET is the Admin Dashboard's: a master admin's session or the master API key, and nothing else first", () => {
    const layer: RouteLayer | undefined = doctorLayer("get");

    expect(layer?.route?.stack).toHaveLength(2);
    expect(layer?.route?.stack[0]?.handle).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    );
  });

  test("the POST is the doctor's and diagnose.sh's: ClusterKeyAuthorization's one check, and nothing else first", () => {
    const layer: RouteLayer | undefined = doctorLayer("post");

    expect(layer?.route?.stack).toHaveLength(2);
    expect(layer?.route?.stack[0]?.handle).toBe(
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    );
  });
});

/*
 * Real HTTP through the real router and the real checks - the router holds
 * them from when it was loaded - with the session a check reads
 * (UserMiddleware.readRequestSession) and the master API key's lookup
 * (ProjectMiddleware.isMasterApiKey) stood in for, every datastore down and
 * the proof stood in for.
 */
describe("over HTTP", () => {
  let httpServer: Server;
  let baseUrl: string = "";

  interface Asked {
    status: number;
    message: string | null;
    answer: InstallationHealthAnswer | null;
  }

  const EVERY_DATASTORE_DOWN: Array<string> = [
    InstallationHealthFindingId.Postgres,
    InstallationHealthFindingId.Clickhouse,
    InstallationHealthFindingId.Valkey,
  ];

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

  let createProof: SpyInstance<typeof CustomDomainServerReadiness.createProof>;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    // No connection held: every datastore is down, and nothing is dialled.
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);
    jest.spyOn(ClickhouseAppInstance, "getDataSource").mockReturnValue(null);
    jest.spyOn(Redis, "getClient").mockReturnValue(null);
    createProof = jest
      .spyOn(CustomDomainServerReadiness, "createProof")
      .mockReturnValue("nonce.signature");
    // The installation's master API key, and no other.
    jest
      .spyOn(ProjectMiddleware, "isMasterApiKey")
      .mockImplementation(async (apiKey: ObjectID): Promise<boolean> => {
        return apiKey.toString() === MASTER_API_KEY;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const signInAs: (requestSession: RequestSession) => void = (
    requestSession: RequestSession,
  ): void => {
    jest
      .spyOn(UserMiddleware, "readRequestSession")
      .mockResolvedValue(requestSession);
  };

  const session: (isMasterAdmin: boolean) => RequestSession = (
    isMasterAdmin: boolean,
  ): RequestSession => {
    return {
      kind: "user",
      session: {
        userId: ObjectID.generate(),
        email: "admin@example.com",
        name: "Admin",
        isMasterAdmin: isMasterAdmin,
      },
    } as unknown as RequestSession;
  };

  const ask: (
    method: "GET" | "POST",
    headers: Record<string, string>,
    query?: string,
  ) => Promise<Asked> = async (
    method: "GET" | "POST",
    headers: Record<string, string>,
    query: string = "",
  ): Promise<Asked> => {
    const response: globalThis.Response = await fetch(
      `${baseUrl}/api/admin/health/doctor${query}`,
      { method, headers },
    );
    const body: JSONObject = (await response.json()) as JSONObject;

    return {
      status: response.status,
      message: typeof body["message"] === "string" ? body["message"] : null,
      answer:
        response.status === 200
          ? InstallationHealthUtil.parseAnswer(body)
          : null,
    };
  };

  const findingIds: (
    answer: InstallationHealthAnswer | null,
  ) => Array<string> = (
    answer: InstallationHealthAnswer | null,
  ): Array<string> => {
    return (answer?.findings || []).map((finding: { id: string }): string => {
      return finding.id;
    });
  };

  test("GET, as a master admin: every datastore that does not answer, worst first, and no proof", async () => {
    signInAs(session(true));

    const result: Asked = await ask("GET", {});

    expect(result.status).toBe(200);
    expect(findingIds(result.answer)).toEqual(EVERY_DATASTORE_DOWN);
    expect(result.answer!.findings[0]!.sentence).toBe(
      "PostgreSQL does not answer, so OneUptime cannot read or save anything.",
    );
    expect(result.answer!.addressProof).toBe(null);
    expect(result.answer!.checkedAt).not.toBe("");
    expect(createProof).not.toHaveBeenCalled();
  });

  test("GET, with the master API key: the same findings, and no proof", async () => {
    const result: Asked = await ask("GET", { apikey: MASTER_API_KEY });

    expect(result.status).toBe(200);
    expect(findingIds(result.answer)).toEqual(EVERY_DATASTORE_DOWN);
    expect(result.answer!.addressProof).toBe(null);
    expect(createProof).not.toHaveBeenCalled();
  });

  test("GET with the cluster key alone is refused: it is no master admin's session, and nothing is read", async () => {
    const readSession: SpyInstance<typeof UserMiddleware.readRequestSession> =
      jest.spyOn(UserMiddleware, "readRequestSession");

    const result: Asked = await ask(
      "GET",
      ClusterKeyAuthorization.getClusterKeyHeaders(),
    );

    expect(result).toEqual({
      status: 401,
      message: "Unauthorized: Access token is required.",
      answer: null,
    });
    // Judged as a request with no session: the real reader, which found none.
    expect(readSession).toHaveBeenCalledTimes(1);
    expect(createProof).not.toHaveBeenCalled();
  });

  test("GET with the cluster key beside the session of someone who is not a master admin is refused", async () => {
    signInAs(session(false));

    const result: Asked = await ask(
      "GET",
      ClusterKeyAuthorization.getClusterKeyHeaders(),
    );

    expect(result.status).toBe(422);
    expect(result.message).toBe(
      "Unauthorized: Only master admins can perform this action.",
    );
    expect(createProof).not.toHaveBeenCalled();
  });

  test("POST, with the cluster key: the same findings, and a proof to ask HOST for", async () => {
    const result: Asked = await ask(
      "POST",
      ClusterKeyAuthorization.getClusterKeyHeaders(),
    );

    expect(result.status).toBe(200);
    expect(findingIds(result.answer)).toEqual(EVERY_DATASTORE_DOWN);
    expect(result.answer!.findings[0]!.sentence).toBe(
      "PostgreSQL does not answer, so OneUptime cannot read or save anything.",
    );
    expect(result.answer!.addressProof).toBe("nonce.signature");
    expect(createProof).toHaveBeenCalledTimes(1);
  });

  test("POST without the key is refused, a master admin's session and the master API key too", async () => {
    expect(await ask("POST", {})).toEqual({
      status: 400,
      message: CLUSTER_KEY_NOT_FOUND_MESSAGE,
      answer: null,
    });
    expect(await ask("POST", { apikey: MASTER_API_KEY })).toEqual({
      status: 400,
      message: CLUSTER_KEY_NOT_FOUND_MESSAGE,
      answer: null,
    });

    signInAs(session(true));

    expect(await ask("POST", {})).toEqual({
      status: 400,
      message: CLUSTER_KEY_NOT_FOUND_MESSAGE,
      answer: null,
    });
    expect(createProof).not.toHaveBeenCalled();
  });

  test("POST with a wrong key, a value this repository ships, or the key in its URL, is refused", async () => {
    expect(await ask("POST", { clusterkey: "not-the-key" })).toEqual({
      status: 400,
      message: INVALID_CLUSTER_KEY_MESSAGE,
      answer: null,
    });

    for (const shipped of ["please-change-this-to-random-value", "secret"]) {
      expect(await ask("POST", { clusterkey: shipped })).toEqual({
        status: 400,
        message: SHIPPED_CLUSTER_KEY_MESSAGE,
        answer: null,
      });
    }

    const headers: Record<string, string> =
      ClusterKeyAuthorization.getClusterKeyHeaders();

    expect(
      await ask(
        "POST",
        headers,
        `?clusterkey=${encodeURIComponent(Object.values(headers)[0]!)}`,
      ),
    ).toEqual({
      status: 400,
      message: CLUSTER_KEY_IN_URL_MESSAGE,
      answer: null,
    });
    expect(createProof).not.toHaveBeenCalled();
  });
});
