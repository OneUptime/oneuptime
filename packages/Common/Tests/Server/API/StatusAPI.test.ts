import StatusAPI, { StatusAPIOptions } from "../../../Server/API/StatusAPI";
import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import InMemoryTTLCache from "../../../Server/Infrastructure/InMemoryTTLCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Redis from "../../../Server/Infrastructure/Redis";
import InfrastructureStatus from "../../../Server/Infrastructure/Status";
import logger from "../../../Server/Utils/Logger";
import { JSONObject } from "../../../Types/JSON";
import Sleep from "../../../Types/Sleep";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import type { SpyInstance } from "jest-mock";

/*
 * What the kubelet sees when a datastore is down, end to end: the real
 * InfrastructureStatus checks behind the real StatusAPI routes, wired the way
 * App/Index.ts wires them, with only the datastore pings stubbed.
 *
 *  - /status/ready fails, naming the datastore, so the pod leaves its Service;
 *  - /status/live keeps answering 200, so the pod is not restarted;
 *  - the per-datastore check of the datastore that is down fails, and the
 *    other two still answer 200.
 *
 * Before checkStatusWithRetry rethrew, every one of these answered 200.
 */

type CheckFunction = () => Promise<void>;

type Datastores = {
  checkRedisStatus: boolean;
  checkPostgresStatus: boolean;
  checkClickhouseStatus: boolean;
};

const checkOf: (datastores: Datastores) => CheckFunction = (
  datastores: Datastores,
): CheckFunction => {
  return async (): Promise<void> => {
    return await InfrastructureStatus.checkStatusWithRetry({
      ...datastores,
      retryCount: 3,
    });
  };
};

const OPTIONS: StatusAPIOptions = {
  liveCheck: async () => {},
  readyCheck: checkOf({
    checkRedisStatus: true,
    checkPostgresStatus: true,
    checkClickhouseStatus: true,
  }),
  databaseCheck: checkOf({
    checkRedisStatus: false,
    checkPostgresStatus: true,
    checkClickhouseStatus: false,
  }),
  globalCacheCheck: checkOf({
    checkRedisStatus: true,
    checkPostgresStatus: false,
    checkClickhouseStatus: false,
  }),
  analyticsDatabaseCheck: checkOf({
    checkRedisStatus: false,
    checkPostgresStatus: false,
    checkClickhouseStatus: true,
  }),
};

const DEEP_ROUTES: Array<string> = [
  "/status/database",
  "/status/global-cache",
  "/status/analytics-database",
];

type HttpResult = { status: number; body: JSONObject | null };

function get(port: number, path: string): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.get(
        { host: "127.0.0.1", port, path },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: response.statusCode || 0,
              body: raw ? (JSON.parse(raw) as JSONObject) : null,
            });
          });
        },
      );

      request.on("error", reject);
    },
  );
}

describe("StatusAPI probes when a datastore is down", () => {
  let server: http.Server;
  let port: number;
  let pings: {
    postgres: SpyInstance<() => Promise<boolean>>;
    valkey: SpyInstance<() => Promise<boolean>>;
    clickhouse: SpyInstance<() => Promise<boolean>>;
  };

  beforeAll(async () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);

    pings = {
      postgres: jest.spyOn(PostgresAppInstance, "checkConnnectionStatus"),
      valkey: jest.spyOn(Redis, "checkConnnectionStatus"),
      clickhouse: jest.spyOn(ClickhouseAppInstance, "checkConnnectionStatus"),
    };

    const app: express.Express = express();
    app.use("/", StatusAPI.init(OPTIONS));

    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    pings.postgres.mockResolvedValue(true);
    pings.valkey.mockResolvedValue(true);
    pings.clickhouse.mockResolvedValue(true);

    // StatusAPI caches each result for five seconds; every test starts cold.
    (
      StatusAPI as unknown as { checkResultCache: InMemoryTTLCache<unknown> }
    ).checkResultCache.clear();
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });

    jest.restoreAllMocks();
  });

  test("every probe answers 200 while all three datastores are up", async () => {
    for (const path of ["/status/ready", "/status/live", ...DEEP_ROUTES]) {
      const result: HttpResult = await get(port, path);

      expect({ path, ...result }).toEqual({
        path,
        status: 200,
        body: { status: "ok" },
      });
    }
  });

  type Outage = {
    datastore: keyof typeof pings;
    message: string;
    deepRoute: string;
  };

  const OUTAGES: Array<Outage> = [
    {
      datastore: "postgres",
      message: "Postgres is not connected",
      deepRoute: "/status/database",
    },
    {
      datastore: "valkey",
      message: "Valkey is not connected",
      deepRoute: "/status/global-cache",
    },
    {
      datastore: "clickhouse",
      message: "Clickhouse is not connected",
      deepRoute: "/status/analytics-database",
    },
  ];

  describe.each(OUTAGES)("with $datastore down", (outage: Outage) => {
    beforeEach(() => {
      pings[outage.datastore].mockResolvedValue(false);
    });

    test("readiness fails and names it", async () => {
      const result: HttpResult = await get(port, "/status/ready");

      expect(result).toEqual({
        status: 500,
        body: { message: outage.message },
      });
    });

    test("liveness still answers 200", async () => {
      const result: HttpResult = await get(port, "/status/live");

      expect(result).toEqual({ status: 200, body: { status: "ok" } });
    });

    test("its own deep check fails and the others answer 200", async () => {
      for (const path of DEEP_ROUTES) {
        const result: HttpResult = await get(port, path);

        expect({ path, ...result }).toEqual(
          path === outage.deepRoute
            ? { path, status: 500, body: { message: outage.message } }
            : { path, status: 200, body: { status: "ok" } },
        );
      }
    });
  });
});
