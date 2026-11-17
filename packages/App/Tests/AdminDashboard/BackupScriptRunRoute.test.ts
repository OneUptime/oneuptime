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
import AdminHealthRouter from "../../API/AdminHealth";
import ClusterKeyAuthorization, {
  CLUSTER_KEY_IN_URL_MESSAGE,
  CLUSTER_KEY_NOT_FOUND_MESSAGE,
  INVALID_CLUSTER_KEY_MESSAGE,
  SHIPPED_CLUSTER_KEY_MESSAGE,
} from "Common/Server/Middleware/ClusterKeyAuthorization";
import ProjectMiddleware from "Common/Server/Middleware/ProjectAuthorization";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ServerSetupChecklist from "Common/Server/Utils/ServerSetup/ServerSetupChecklist";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { BACKUP_SCRIPT_RUN_URL_PATH } from "Common/Types/Backup/BackupScriptRun";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupCheckResult,
  ServerSetupChecklistAnswer,
  ServerSetupStatus,
} from "Common/Types/ServerSetup/ServerSetupChecklist";

/*
 * POST /api/admin/health/backup-run (#7026): `npm run backup` telling the
 * server it ran, so the setup checklist's Backups item is measured, not the
 * admin's word.
 *
 *   - The cluster key, through ClusterKeyAuthorization's one check, and
 *     nothing else first: only the server's operator holds it. No session -
 *     a project's member's, or a master admin's - and no master API key
 *     stands in for it, so nobody else can mark the server as backed up.
 *   - It keeps when it was told, whether the run succeeded and the dump's
 *     size, and nothing else the body holds; a body that does not say
 *     whether it succeeded is refused, and nothing is written.
 *   - Once a run is recorded, the checklist reads it: done while it is
 *     fresh, failing when pg_dump failed. A server never told reads as it
 *     did - an older script calls nothing.
 *
 * Real HTTP through the real router and the real check, with the session a
 * check reads, the master API key's lookup and the one settings row stood
 * in for.
 */

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown }>;
  };
};

const MASTER_API_KEY: string = ObjectID.generate().toString();

function backupRunLayers(): Array<RouteLayer> {
  return (
    (AdminHealthRouter as unknown as { stack: Array<RouteLayer> }).stack || []
  ).filter((layer: RouteLayer): boolean => {
    return layer.route?.path === "/backup-run";
  });
}

describe("who may say the server was backed up", () => {
  test("a POST alone, handed ClusterKeyAuthorization's one check first", () => {
    const layers: Array<RouteLayer> = backupRunLayers();

    expect(
      layers.map((layer: RouteLayer): Record<string, boolean> => {
        return layer.route?.methods || {};
      }),
    ).toEqual([{ post: true }]);
    expect(layers[0]?.route?.stack).toHaveLength(2);
    expect(layers[0]?.route?.stack[0]?.handle).toBe(
      ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
    );
  });
});

describe("over HTTP", () => {
  let httpServer: Server;
  let baseUrl: string = "";

  // The one settings row, as the route and the checklist read and write it.
  let stored: JSONObject | null = null;
  let writes: Array<JSONObject> = [];

  interface Asked {
    status: number;
    body: JSONObject;
  }

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.use("/api/admin/health", AdminHealthRouter);
    // As the app answers what a route hands on: a refusal in its own words.
    app.use(expressErrorHandler);

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
    stored = null;
    writes = [];

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(GlobalConfigService, "writeBackupScriptLastRun")
      .mockImplementation(async (run: JSONObject): Promise<void> => {
        writes.push(run);
        stored = run;
      });
    jest
      .spyOn(GlobalConfigService, "findOneById")
      .mockImplementation(async (): Promise<GlobalConfig> => {
        return Object.assign(new GlobalConfig(), {
          backupScriptLastRun: stored,
        });
      });
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
        email: "someone@example.com",
        name: "Someone",
        isMasterAdmin: isMasterAdmin,
      },
    } as unknown as RequestSession;
  };

  const tell: (
    headers: Record<string, string>,
    body: unknown,
    query?: string,
  ) => Promise<Asked> = async (
    headers: Record<string, string>,
    body: unknown,
    query: string = "",
  ): Promise<Asked> => {
    const response: globalThis.Response = await fetch(
      `${baseUrl}${BACKUP_SCRIPT_RUN_URL_PATH}${query}`,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      },
    );

    return {
      status: response.status,
      body: (await response.json()) as JSONObject,
    };
  };

  const backups: () => Promise<ServerSetupCheckResult> =
    async (): Promise<ServerSetupCheckResult> => {
      const answer: ServerSetupChecklistAnswer =
        await ServerSetupChecklist.getAnswer();

      return ServerSetupChecklistUtil.getCheck(
        answer,
        ServerSetupCheckId.Backups,
      )!;
    };

  test("with the server's cluster key: kept with the server's own time, and the Backups item is measured", async () => {
    // Before: a server the script never told, as it always read.
    expect((await backups()).status).toBe(ServerSetupStatus.NotSetUp);

    const before: number = Date.now();
    const result: Asked = await tell(
      ClusterKeyAuthorization.getClusterKeyHeaders(),
      { succeeded: true, sizeInBytes: 7340032 },
    );

    expect(result.status).toBe(200);
    expect(result.body["recorded"]).toBe(true);
    expect(result.body["succeeded"]).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0]!["succeeded"]).toBe(true);
    expect(writes[0]!["sizeInBytes"]).toBe(7340032);
    expect(
      new Date(writes[0]!["at"] as string).getTime(),
    ).toBeGreaterThanOrEqual(before - 1000);

    const measured: ServerSetupCheckResult = await backups();

    expect(measured.status).toBe(ServerSetupStatus.Done);
    expect(measured.backupMadeBy).toBe("script");
    expect(measured.time).toBe(writes[0]!["at"]);
  });

  test("a failed run is kept as failed, and the Backups item says so", async () => {
    const result: Asked = await tell(
      ClusterKeyAuthorization.getClusterKeyHeaders(),
      { succeeded: false, sizeInBytes: 10 },
    );

    expect(result.status).toBe(200);
    expect(writes[0]).toEqual({
      at: writes[0]!["at"],
      succeeded: false,
      sizeInBytes: null,
    });
    expect((await backups()).status).toBe(ServerSetupStatus.Failing);
  });

  test("only how it went is kept: a time, a path or a password the body holds is not", async () => {
    await tell(ClusterKeyAuthorization.getClusterKeyHeaders(), {
      succeeded: true,
      sizeInBytes: 1,
      at: "1999-01-01T00:00:00.000Z",
      file: "/home/ada/oneuptime/Backups/db-17.backup",
      password: "secret",
    });

    expect(Object.keys(writes[0]!).sort()).toEqual(
      ["at", "sizeInBytes", "succeeded"].sort(),
    );
    expect(writes[0]!["at"]).not.toBe("1999-01-01T00:00:00.000Z");
  });

  test("a body that does not say whether it succeeded is refused, and nothing is written", async () => {
    for (const body of [{}, { succeeded: "yes" }, { sizeInBytes: 10 }, "ok"]) {
      const result: Asked = await tell(
        ClusterKeyAuthorization.getClusterKeyHeaders(),
        body,
      );

      expect(result.status).toBe(400);
    }

    expect(writes).toEqual([]);
  });

  test("without the key it is refused: an outsider, a project's member, a master admin's session and the master API key alike", async () => {
    expect(await tell({}, { succeeded: true })).toEqual({
      status: 400,
      body: { message: CLUSTER_KEY_NOT_FOUND_MESSAGE },
    });
    expect(await tell({ apikey: MASTER_API_KEY }, { succeeded: true })).toEqual(
      {
        status: 400,
        body: { message: CLUSTER_KEY_NOT_FOUND_MESSAGE },
      },
    );

    // A project's member, signed in.
    signInAs(session(false));
    expect((await tell({}, { succeeded: true })).status).toBe(400);

    // A master admin, signed in: the checklist's "This server is backed up" is theirs, not this.
    jest.restoreAllMocks();
    stored = null;
    writes = [];
    jest
      .spyOn(GlobalConfigService, "writeBackupScriptLastRun")
      .mockImplementation(async (run: JSONObject): Promise<void> => {
        writes.push(run);
      });
    signInAs(session(true));
    expect(await tell({}, { succeeded: true })).toEqual({
      status: 400,
      body: { message: CLUSTER_KEY_NOT_FOUND_MESSAGE },
    });

    expect(writes).toEqual([]);
  });

  test("a wrong key, a value this repository ships, or the key in its URL, is refused, and nothing is written", async () => {
    expect(
      await tell({ clusterkey: "not-the-key" }, { succeeded: true }),
    ).toEqual({ status: 400, body: { message: INVALID_CLUSTER_KEY_MESSAGE } });

    for (const shipped of ["please-change-this-to-random-value", "secret"]) {
      expect(await tell({ clusterkey: shipped }, { succeeded: true })).toEqual({
        status: 400,
        body: { message: SHIPPED_CLUSTER_KEY_MESSAGE },
      });
    }

    const headers: Record<string, string> =
      ClusterKeyAuthorization.getClusterKeyHeaders();

    expect(
      await tell(
        headers,
        { succeeded: true },
        `?clusterkey=${encodeURIComponent(Object.values(headers)[0]!)}`,
      ),
    ).toEqual({ status: 400, body: { message: CLUSTER_KEY_IN_URL_MESSAGE } });

    // In the body, the key is nothing: no header, no entry.
    expect(
      (
        await tell(
          {},
          { succeeded: true, clusterkey: Object.values(headers)[0] },
        )
      ).status,
    ).toBe(400);

    expect(writes).toEqual([]);
  });
});
