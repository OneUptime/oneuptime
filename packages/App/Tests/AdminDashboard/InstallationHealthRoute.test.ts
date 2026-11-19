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
  readGlobalProbesBehind,
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
  InstallationHealthLevel,
  InstallationHealthProbeBehind,
} from "Common/Types/InstallationHealth/InstallationHealth";
import ProbeService from "Common/Server/Services/ProbeService";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ProbeBehindWork } from "Common/Types/Probe/ProbeBehind";
import {
  ServerProductsPreset,
  getOffByPreset,
} from "Common/Types/Product/ServerProducts";
import {
  ServerProductsAnswer,
  ServerProductsSource,
} from "Common/Types/Product/ServerProductsAnswer";
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
    serverProducts: async (): Promise<ServerProductsAnswer> => {
      return MONITORING_ONLY;
    },
    globalProbesBehind: async (): Promise<
      Array<InstallationHealthProbeBehind>
    > => {
      return [];
    },
    ...overrides,
  };
};

// A server an admin set to Monitoring and status pages on Settings > Products (#7481).
const MONITORING_ONLY: ServerProductsAnswer = {
  off: {},
  switchedOff: getOffByPreset(ServerProductsPreset.MonitoringAndStatusPages),
  preset: ServerProductsPreset.MonitoringAndStatusPages,
  source: ServerProductsSource.Saved,
  startingValue: "",
  startingValueUnknownNames: [],
  isTelemetryIngestionStopped: false,
  shouldSuggestStoppingIngestion: false,
  changedAt: "2026-11-10T09:30:00.000Z",
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
    expect(facts.serverProducts).toEqual(MONITORING_ONLY);
    expect(InstallationHealthUtil.evaluate(facts)).toEqual([]);
  });

  test("the products switched off on the server are read, and are no finding: a choice is not a fault (#7481)", async () => {
    const facts: InstallationHealthFacts =
      await getInstallationHealthFacts(readers());

    expect(InstallationHealthUtil.evaluate(facts)).toEqual([]);
    expect(
      InstallationHealthUtil.getAnswer({
        facts: facts,
        addressProof: null,
        checkedAt: "2026-11-18T10:00:00.000Z",
      }).products,
    ).toEqual(
      expect.objectContaining({
        onCount: 5,
        preset: ServerProductsPreset.MonitoringAndStatusPages,
        presetTitle: "Monitoring and status pages",
        source: ServerProductsSource.Saved,
      }),
    );
  });

  test("the products a reader could not read are none: the answer still comes, without them", async () => {
    const facts: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        serverProducts: async (): Promise<ServerProductsAnswer> => {
          throw new Error("relation does not exist");
        },
      }),
    );

    expect(facts.serverProducts).toBe(null);
    expect(facts.serverSetup).toEqual(EMPTY_CHECKLIST);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a global probe that is behind is a finding to look at, with when it fell behind and where to fix it (#9488)", async () => {
    const facts: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        globalProbesBehind: async (): Promise<
          Array<InstallationHealthProbeBehind>
        > => {
          return [
            {
              id: "11111111-1111-4111-8111-111111111111",
              name: "Probe-1",
              since: "2026-11-18T09:12:00.000Z",
            },
          ];
        },
      }),
    );

    expect(facts.globalProbesBehind).toHaveLength(1);

    const findings: Array<{
      id: string;
      level: InstallationHealthLevel;
      sentence: string;
      adminPath: string | null;
    }> = InstallationHealthUtil.evaluate(facts);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toBe(
      `${InstallationHealthFindingId.GlobalProbeBehind}-11111111-1111-4111-8111-111111111111`,
    );
    expect(findings[0]!.level).toBe(InstallationHealthLevel.Warn);
    expect(findings[0]!.sentence).toBe(
      "Probe-1 is behind: since 2026-11-18 09:12 UTC, its monitors have waited more than a minute past their check time, so they are checked less often than set.",
    );
    expect(findings[0]!.adminPath).toBe("/admin/health/probes");
  });

  test("whether the global probes are behind is read only while PostgreSQL answers, and a failed read is none", async () => {
    let asked: boolean = false;
    const down: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        isPostgresConnected: async (): Promise<boolean> => {
          return false;
        },
        globalProbesBehind: async (): Promise<
          Array<InstallationHealthProbeBehind>
        > => {
          asked = true;
          return [];
        },
      }),
    );

    expect(asked).toBe(false);
    expect(down.globalProbesBehind).toBe(null);

    const failed: InstallationHealthFacts = await getInstallationHealthFacts(
      readers({
        globalProbesBehind: async (): Promise<
          Array<InstallationHealthProbeBehind>
        > => {
          throw new Error("column does not exist");
        },
      }),
    );

    expect(failed.globalProbesBehind).toBe(null);
    expect(InstallationHealthUtil.evaluate(failed)).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("the global probes behind are the connected ones whose late checks span a minute, since the first", async () => {
    const behind: Probe = new Probe();
    behind.id = new ObjectID("22222222-2222-4222-8222-222222222222");
    behind.name = "Probe-1";
    behind.checksLateSince = new Date("2026-11-18T09:00:00.000Z");
    behind.checksLastLateAt = new Date("2026-11-18T09:03:00.000Z");

    // One late reading only: a restart, not yet behind.
    const once: Probe = new Probe();
    once.id = ObjectID.generate();
    once.name = "Probe-2";
    once.checksLateSince = new Date("2026-11-18T09:03:00.000Z");
    once.checksLastLateAt = new Date("2026-11-18T09:03:00.000Z");

    // eslint-disable-next-line @typescript-eslint/typedef
    const findBy = jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([behind, once] as never);

    expect(await readGlobalProbesBehind()).toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Probe-1",
        since: "2026-11-18T09:00:00.000Z",
        work: ProbeBehindWork.MonitorChecks,
      },
    ]);

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as unknown as { query: Record<string, unknown> }
    ).query;

    expect(query["isGlobalProbe"]).toBe(true);
    expect(query["connectionStatus"]).toBe(ProbeConnectionStatus.Connected);
    expect(Object.keys(query).sort()).toEqual(
      ["connectionStatus", "isGlobalProbe"].sort(),
    );

    // Both kinds of work are read, so a probe behind on either is found.
    const select: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as unknown as {
        select: Record<string, unknown>;
      }
    ).select;
    for (const column of [
      "checksLateSince",
      "checksLastLateAt",
      "devicePollsLateSince",
      "devicePollsLastLateAt",
    ]) {
      expect(select[column]).toBe(true);
    }
  });

  test("a global probe behind on its network devices is found too, and one behind on both is found for each (#9499)", async () => {
    const devices: Probe = new Probe();
    devices.id = new ObjectID("33333333-3333-4333-8333-333333333333");
    devices.name = "Probe-3";
    devices.devicePollsLateSince = new Date("2026-11-18T09:01:00.000Z");
    devices.devicePollsLastLateAt = new Date("2026-11-18T09:04:00.000Z");

    const both: Probe = new Probe();
    both.id = new ObjectID("44444444-4444-4444-8444-444444444444");
    both.name = "Probe-4";
    both.checksLateSince = new Date("2026-11-18T09:02:00.000Z");
    both.checksLastLateAt = new Date("2026-11-18T09:05:00.000Z");
    both.devicePollsLateSince = new Date("2026-11-18T08:59:00.000Z");
    both.devicePollsLastLateAt = new Date("2026-11-18T09:05:00.000Z");

    jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([devices, both] as never);

    const behind: Array<InstallationHealthProbeBehind> =
      await readGlobalProbesBehind();

    expect(behind).toEqual([
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Probe-3",
        since: "2026-11-18T09:01:00.000Z",
        work: ProbeBehindWork.DevicePolls,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Probe-4",
        since: "2026-11-18T09:02:00.000Z",
        work: ProbeBehindWork.MonitorChecks,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Probe-4",
        since: "2026-11-18T08:59:00.000Z",
        work: ProbeBehindWork.DevicePolls,
      },
    ]);

    // Each is a finding of its own, with its own fix, the longest first.
    const findings: Array<string> = InstallationHealthUtil.probeFindings({
      globalProbesBehind: behind,
    } as InstallationHealthFacts).map((finding: { id: string }): string => {
      return finding.id;
    });

    expect(findings).toEqual([
      `${InstallationHealthFindingId.GlobalProbeDevicesBehind}-44444444-4444-4444-8444-444444444444`,
      `${InstallationHealthFindingId.GlobalProbeDevicesBehind}-33333333-3333-4333-8333-333333333333`,
      `${InstallationHealthFindingId.GlobalProbeBehind}-44444444-4444-4444-8444-444444444444`,
    ]);
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
        serverProducts: async (): Promise<ServerProductsAnswer> => {
          asked.push("serverProducts");
          return MONITORING_ONLY;
        },
      }),
    );

    expect(asked).toEqual([]);
    expect(facts.migrations).toBe(null);
    expect(facts.serverSetup).toBe(null);
    expect(facts.serverProducts).toBe(null);
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
    // What an admin switched off is in PostgreSQL, which does not answer.
    expect(result.answer!.products).toBe(null);
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
