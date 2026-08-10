import { describe, expect, test } from "@jest/globals";

/*
 * ClickHouse client keep-alive.
 *
 * @clickhouse/client enables HTTP keep-alive by default but destroys idle
 * pooled sockets after only 2500ms (keep_alive.idle_socket_ttl), while the
 * telemetry fan-in writer flushes on a TELEMETRY_FANIN_MAX_WAIT_MS window
 * that defaults to 5000ms. Under sub-saturation ingest load every flush
 * therefore found its pooled socket already destroyed and paid TCP (+TLS)
 * connection setup again — on every single flush. ClickhouseConfig.ts now
 * pins keep_alive explicitly with an env-configurable TTL
 * (CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS, default 8000ms) sandwiched
 * between two constraints:
 *
 *   - it must sit ABOVE the fan-in flush window, or sockets keep dying
 *     between flushes and the setting is pointless;
 *   - it must sit BELOW the ClickHouse server's keep_alive_timeout (10s in
 *     the bundled Clickhouse/config.xml, also the server default since
 *     23.11), or the client reuses sockets the server already closed and
 *     requests fail with ECONNRESET.
 *
 * This suite pins the default, the env override, the invalid-value
 * fallback, that EVERY pool derived from the shared options object carries
 * the setting (query, ingest, migration, test — and the two clients
 * ClickhouseDatabase.connect() actually constructs), and both ordering
 * constraints above.
 *
 * The config module reads env at import time, so each case re-imports it
 * in isolation (same pattern as PostgresLockTimeoutOptions.test.ts).
 */

import ClickhouseDatabase, {
  ClickhouseClient,
} from "../../../Server/Infrastructure/ClickhouseDatabase";
import {
  ClickHouseClientConfigOptions,
  dataSourceOptions,
  ingestDataSourceOptions,
} from "../../../Server/Infrastructure/ClickhouseConfig";
import { readFanInWriterOptionsFromEnv } from "../../../Server/Utils/Telemetry/TelemetryFanInWriter";
import { createClient } from "@clickhouse/client";
import fs from "fs";
import path from "path";

/*
 * Count and capture every client the ClickhouseDatabase connect() flow
 * builds. The mock lives INSIDE the hoisted factory (a module-scope const
 * would not be initialized yet when the hoisted static imports trigger the
 * factory) and is retrieved below through the mocked module itself. Each
 * fake client resolves the exact calls connect() makes: exec (CREATE
 * DATABASE on the bootstrap client), close (bootstrap client teardown),
 * ping (pool client health check).
 */
jest.mock("@clickhouse/client", () => {
  return {
    __esModule: true,
    createClient: jest.fn(() => {
      return {
        exec: jest.fn(async () => {
          return;
        }),
        close: jest.fn(async () => {
          return;
        }),
        ping: jest.fn(async () => {
          return { success: true };
        }),
      };
    }),
    ClickHouseError: class MockClickHouseError extends Error {},
  };
});

const mockCreateClient: jest.Mock = createClient as unknown as jest.Mock;

interface KeepAliveOptionsUnderTest {
  enabled?: boolean;
  idle_socket_ttl?: number;
}

interface ClickhouseOptionsUnderTest {
  keep_alive?: KeepAliveOptionsUnderTest;
  request_timeout?: number;
  max_open_connections?: number;
  compression?: { request?: boolean; response?: boolean };
  database?: string;
}

interface LoadedClickhouseConfig {
  dataSourceOptions: ClickhouseOptionsUnderTest;
  ingestDataSourceOptions: ClickhouseOptionsUnderTest;
  migrationDataSourceOptions: ClickhouseOptionsUnderTest;
  testDataSourceOptions: ClickhouseOptionsUnderTest;
}

/*
 * Run a callback with process.env temporarily overridden (undefined
 * deletes the key), restoring the previous values afterwards so cases
 * cannot leak env into each other or into unrelated suites.
 */
function withEnv<T>(
  env: Record<string, string | undefined>,
  callback: () => T,
): T {
  const previous: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function loadConfig(
  env: Record<string, string | undefined>,
): LoadedClickhouseConfig {
  let loaded: LoadedClickhouseConfig | undefined = undefined;

  jest.isolateModules(() => {
    withEnv(env, () => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require("../../../Server/Infrastructure/ClickhouseConfig");
      /* eslint-enable @typescript-eslint/no-var-requires */
    });
  });

  return loaded!;
}

describe("ClickHouse client keep-alive options", () => {
  describe("default", () => {
    test("keep-alive is enabled with an 8000ms idle-socket TTL when the env var is unset", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: undefined,
      });

      expect(config.dataSourceOptions.keep_alive).toEqual({
        enabled: true,
        idle_socket_ttl: 8000,
      });
    });

    /*
     * The whole point of the change: the client's own 2500ms default is
     * what destroyed every socket between 5000ms fan-in flushes. If the
     * key were ever dropped from the options object again, the client
     * would silently regress to 2500ms — so pin its presence explicitly.
     */
    test("the client default of 2500ms is overridden, not inherited", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: undefined,
      });

      expect(config.dataSourceOptions.keep_alive).toBeDefined();
      expect(config.dataSourceOptions.keep_alive!.idle_socket_ttl).not.toBe(
        2500,
      );
    });
  });

  describe("env override", () => {
    test("a positive integer value is applied", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: "12000",
      });

      expect(config.dataSourceOptions.keep_alive).toEqual({
        enabled: true,
        idle_socket_ttl: 12000,
      });
    });

    test("surrounding whitespace is tolerated", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: "  9000  ",
      });

      expect(config.dataSourceOptions.keep_alive!.idle_socket_ttl).toBe(9000);
    });

    /*
     * parseInt semantics: a decimal string yields its leading integer
     * part. Milliseconds are documented as integers; pin the behavior so
     * a future parser change is a conscious one.
     */
    test("a decimal value is truncated to its integer part", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: "12000.9",
      });

      expect(config.dataSourceOptions.keep_alive!.idle_socket_ttl).toBe(12000);
    });
  });

  describe("invalid values fall back to the default", () => {
    test.each([
      ["non-numeric", "not-a-number"],
      ["empty string", ""],
      ["whitespace only", "   "],
      /*
       * Zero is rejected deliberately: the client treats 0 as "disable
       * idle-socket reaping entirely", which reintroduces the
       * server-closes-first ECONNRESET failure mode the TTL exists to
       * prevent.
       */
      ["zero", "0"],
      ["negative", "-500"],
      ["NaN literal", "NaN"],
    ])("%s (%p) falls back to 8000ms", (_label: string, rawValue: string) => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: rawValue,
      });

      expect(config.dataSourceOptions.keep_alive).toEqual({
        enabled: true,
        idle_socket_ttl: 8000,
      });
    });
  });

  /*
   * The setting lives on the shared base `options` object, so every pool
   * derived from it must carry it — a keep-alive that only covered the
   * query pool would leave the INGEST pool (the hot path this change is
   * for) still paying per-flush connection setup.
   */
  describe("every pool derived from the shared options carries the setting", () => {
    test("default reaches query, ingest, migration and test pools", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: undefined,
      });

      const expected: KeepAliveOptionsUnderTest = {
        enabled: true,
        idle_socket_ttl: 8000,
      };

      expect(config.dataSourceOptions.keep_alive).toEqual(expected);
      expect(config.ingestDataSourceOptions.keep_alive).toEqual(expected);
      expect(config.migrationDataSourceOptions.keep_alive).toEqual(expected);
      expect(config.testDataSourceOptions.keep_alive).toEqual(expected);
    });

    test("an override reaches query, ingest, migration and test pools", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: "7000",
      });

      const expected: KeepAliveOptionsUnderTest = {
        enabled: true,
        idle_socket_ttl: 7000,
      };

      expect(config.dataSourceOptions.keep_alive).toEqual(expected);
      expect(config.ingestDataSourceOptions.keep_alive).toEqual(expected);
      expect(config.migrationDataSourceOptions.keep_alive).toEqual(expected);
      expect(config.testDataSourceOptions.keep_alive).toEqual(expected);
    });
  });

  /*
   * The default is only correct while it stays strictly between the fan-in
   * flush window (below) and the ClickHouse server's keep_alive_timeout
   * (above). Both neighbours live in other files, so pin the ordering
   * against their real sources rather than restating magic numbers that
   * could drift apart silently.
   */
  describe("ordering constraints on the default", () => {
    test("the TTL outlives the fan-in writer's default flush window, so sockets survive between flushes", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: undefined,
      });

      const fanInMaxWaitMs: number = withEnv(
        { TELEMETRY_FANIN_MAX_WAIT_MS: undefined },
        () => {
          return readFanInWriterOptionsFromEnv().maxWaitMs;
        },
      );

      expect(
        config.dataSourceOptions.keep_alive!.idle_socket_ttl!,
      ).toBeGreaterThan(fanInMaxWaitMs);
    });

    test("the TTL stays below the bundled ClickHouse server keep_alive_timeout, so the client always closes first", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: undefined,
      });

      /*
       * Read the authoritative server value from the bundled server
       * config (repo root /Clickhouse/config.xml) instead of hardcoding
       * 10s here: if an operator-facing change ever lowers the server
       * timeout, this test fails and forces the client default to move
       * with it.
       */
      const serverConfigPath: string = path.join(
        __dirname,
        "../../../../Clickhouse/config.xml",
      );
      const serverConfigXml: string = fs.readFileSync(
        serverConfigPath,
        "utf-8",
      );
      const keepAliveTimeoutMatch: RegExpMatchArray | null =
        serverConfigXml.match(
          /<keep_alive_timeout>(\d+)<\/keep_alive_timeout>/,
        );

      expect(keepAliveTimeoutMatch).not.toBeNull();

      const serverKeepAliveTimeoutInMs: number =
        parseInt(keepAliveTimeoutMatch![1]!, 10) * 1000;

      expect(
        config.dataSourceOptions.keep_alive!.idle_socket_ttl!,
      ).toBeLessThan(serverKeepAliveTimeoutInMs);
    });
  });

  /*
   * The efficiency change must not disturb any of the other tuned client
   * options — those carry their own hard-won constraints (nginx timeout
   * headroom, pool sizing, compression preconditions).
   */
  describe("pre-existing options are unchanged", () => {
    test("request_timeout, compression and pool sizing keep their values", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: "12000",
      });

      expect(config.dataSourceOptions.request_timeout).toBe(58_000);
      expect(config.ingestDataSourceOptions.request_timeout).toBe(58_000);
      expect(config.dataSourceOptions.compression).toEqual({
        request: true,
        response: true,
      });
      /*
       * The migration pool's idle ceiling has a 30-minute floor (see
       * migrationRequestTimeoutInMs in ClickhouseConfig.ts).
       */
      expect(
        config.migrationDataSourceOptions.request_timeout!,
      ).toBeGreaterThanOrEqual(30 * 60 * 1000);
    });

    test("the ingest pool still sizes its connections independently while carrying keep-alive", () => {
      const config: LoadedClickhouseConfig = loadConfig({
        CLICKHOUSE_KEEP_ALIVE_IDLE_SOCKET_TTL_MS: undefined,
      });

      /*
       * EnvironmentConfig is imported (not re-required) by the isolated
       * ClickhouseConfig load, so the connection counts reflect whatever
       * the ambient test env resolved at first import. Assert the
       * RELATIONSHIP — ingest keep-alive present alongside its own
       * max_open_connections — not an absolute count.
       */
      expect(config.ingestDataSourceOptions.max_open_connections).toBeDefined();
      expect(config.ingestDataSourceOptions.keep_alive).toEqual(
        config.dataSourceOptions.keep_alive,
      );
    });
  });

  /*
   * Options only matter if they reach the clients ClickhouseDatabase
   * actually constructs. connect() builds TWO clients — a short-lived
   * bootstrap client against the `default` database (CREATE DATABASE IF
   * NOT EXISTS) and the long-lived pool client — and BOTH must carry
   * keep_alive, so the counting mock captures every createClient call.
   */
  describe("the setting reaches the clients built from this config", () => {
    beforeEach(() => {
      mockCreateClient.mockClear();
    });

    test("connect() passes keep-alive to both the bootstrap client and the pool client", async () => {
      const database: ClickhouseDatabase = new ClickhouseDatabase();

      const client: ClickhouseClient =
        await database.connect(dataSourceOptions);

      expect(client).toBeDefined();
      expect(mockCreateClient).toHaveBeenCalledTimes(2);

      const bootstrapOptions: ClickhouseOptionsUnderTest = mockCreateClient.mock
        .calls[0]![0] as ClickhouseOptionsUnderTest;
      const poolOptions: ClickhouseOptionsUnderTest = mockCreateClient.mock
        .calls[1]![0] as ClickhouseOptionsUnderTest;

      expect(bootstrapOptions.database).toBe("default");
      expect(bootstrapOptions.keep_alive).toEqual(dataSourceOptions.keep_alive);
      expect(poolOptions).toBe(dataSourceOptions);
      expect(poolOptions.keep_alive).toEqual({
        enabled: true,
        idle_socket_ttl: expect.any(Number),
      });

      await database.disconnect();
    });

    test("the ingest pool client carries keep-alive too", async () => {
      const database: ClickhouseDatabase = new ClickhouseDatabase(
        ingestDataSourceOptions,
      );

      await database.connect(
        database.getDatasourceOptions() as ClickHouseClientConfigOptions,
      );

      expect(mockCreateClient).toHaveBeenCalledTimes(2);

      const poolOptions: ClickhouseOptionsUnderTest = mockCreateClient.mock
        .calls[1]![0] as ClickhouseOptionsUnderTest;

      expect(poolOptions).toBe(ingestDataSourceOptions);
      expect(poolOptions.keep_alive).toEqual(dataSourceOptions.keep_alive);

      await database.disconnect();
    });
  });
});
