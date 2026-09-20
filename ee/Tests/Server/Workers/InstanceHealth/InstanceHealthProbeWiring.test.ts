import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import InstanceHealthLog, {
  InstanceHealthLogEventType,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import User from "Common/Models/DatabaseModels/User";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import * as CoreRedisHealth from "Common/Server/Utils/InstanceHealth/RedisHealth";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The instance-health probes moved from core into ee/ next to the two jobs
 * that read them. These tests run each job against its REAL probe (nothing in
 * ee's PostgresHealth or RedisHealth is stubbed; only the database and Redis
 * clients underneath are faked), so they fail if a job stops calling ee's
 * probe or the probe stops reaching the notification it feeds.
 *
 * The job files register themselves with RunCron at import time, so Cron is
 * mocked to keep the import inert.
 */
jest.mock("App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import * as PostgresHealth from "../../../../Server/Workers/InstanceHealth/PostgresHealth";
import * as RedisHealth from "../../../../Server/Workers/InstanceHealth/RedisHealth";
import { evaluatePostgresHealth } from "../../../../Server/Workers/InstanceHealth/EvaluatePostgresHealth";
import { evaluateRedisHealth } from "../../../../Server/Workers/InstanceHealth/EvaluateRedisHealth";

const COUNTER_SAMPLE_KEY: string = "oneuptime-instance-health-redis-sample";

function mockGlobalConfig(config: GlobalConfig): void {
  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(config as never);
}

function createdEventTypes(): Array<unknown> {
  return (
    InstanceHealthLogService.create as unknown as jest.Mock
  ).mock.calls.map((call: Array<CreateBy<InstanceHealthLog>>): unknown => {
    return call[0]?.data.eventType;
  });
}

/*
 * One answer per Postgres probe, keyed on a recognisable fragment of each
 * statement (the same dispatch the probe's own unit tests use).
 */
function makeDataSource(backends: string): { query: jest.Mock } {
  return {
    query: jest.fn(async (sql: string): Promise<unknown> => {
      if (sql.includes("pg_is_in_recovery() AS in_recovery")) {
        return [{ in_recovery: false }];
      }
      if (sql.includes("pg_ls_waldir")) {
        return [{ size: "0" }];
      }
      if (sql.includes("pg_database_size")) {
        return [{ size: "1073741824" }];
      }
      if (sql.includes("max_connections")) {
        return [
          {
            max_connections: "100",
            reserved_connections: "3",
            backends: backends,
          },
        ];
      }
      if (sql.includes("datfrozenxid")) {
        return [{ max_xid_age: "1000", max_mxid_age: "1000" }];
      }
      if (sql.includes("pg_replication_slots")) {
        return [];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
  };
}

const REDIS_INFO: string = [
  "uptime_in_seconds:86400",
  "connected_clients:42",
  "maxclients:10000",
  "used_memory:100",
  "maxmemory:1000",
  "maxmemory_policy:allkeys-lru",
  "evicted_keys:17",
  "rejected_connections:0",
].join("\r\n");

interface FakeRedisClient {
  info: jest.Mock;
  call: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  expire: jest.Mock;
}

// A stored sample pair taken ten minutes ago, with `evictedKeys` evictions.
function makeRedisClient(storedEvictedKeys: number): FakeRedisClient {
  const sample: {
    evictedKeys: number;
    rejectedConnections: number;
    uptimeInSeconds: number;
  } = {
    evictedKeys: storedEvictedKeys,
    rejectedConnections: 0,
    uptimeInSeconds: 86400 - 600,
  };

  return {
    info: jest.fn().mockResolvedValue(REDIS_INFO),
    call: jest.fn().mockResolvedValue(["maxclients", "10000"]),
    get: jest
      .fn()
      .mockResolvedValue(JSON.stringify({ older: sample, newer: sample })),
    set: jest.fn().mockResolvedValue("OK"),
    expire: jest.fn().mockResolvedValue(1),
  };
}

describe("instance-health jobs use the probes in ee/", () => {
  beforeEach(() => {
    jest
      .spyOn(InstanceHealthLogService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(InstanceHealthLogService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<InstanceHealthLog>,
        ): Promise<InstanceHealthLog> => {
          createBy.data.id = new ObjectID("created-log");
          return createBy.data;
        },
      );
    jest
      .spyOn(InstanceHealthLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const admin: User = new User();
    admin.id = new ObjectID("admin-1");
    admin.email = new Email("admin@example.com");
    jest.spyOn(UserService, "findBy").mockResolvedValue([admin] as never);
    jest.spyOn(MailService, "sendMail").mockResolvedValue({
      isSuccess: (): boolean => {
        return true;
      },
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("EvaluatePostgresHealth", () => {
    beforeEach(() => {
      const config: GlobalConfig = new GlobalConfig();
      config.postgresStorageNotificationEnabled = false;
      config.postgresConnectionNotificationEnabled = true;
      config.postgresConnectionNotificationThresholdPercent = 80;
      config.postgresWraparoundNotificationEnabled = false;
      config.postgresReplicationSlotNotificationEnabled = false;
      mockGlobalConfig(config);
    });

    test("reads its snapshot from ee's PostgresHealth probe", async () => {
      const dataSource: { query: jest.Mock } = makeDataSource("95");
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(dataSource as never);
      const probe: jest.SpyInstance = jest.spyOn(
        PostgresHealth,
        "getPostgresHealthSnapshot",
      );

      await evaluatePostgresHealth();

      expect(probe).toHaveBeenCalledTimes(1);
      // The probe really ran against the (fake) database.
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining("pg_stat_database"),
      );
      // 95 of 97 usable connections is past the 80% threshold.
      expect(createdEventTypes()).toEqual([
        InstanceHealthLogEventType.PostgresConnectionSaturationNotification,
      ]);
      expect(MailService.sendMail).toHaveBeenCalledTimes(1);
    });

    // Negative control: the notification follows the probe's numbers.
    test("raises nothing when the probe reports a healthy database", async () => {
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(makeDataSource("10") as never);

      await evaluatePostgresHealth();

      expect(InstanceHealthLogService.create).not.toHaveBeenCalled();
      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    test("holds rather than evaluates when ee's probe finds no database", async () => {
      jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(null);
      const probe: jest.SpyInstance = jest.spyOn(
        PostgresHealth,
        "getPostgresHealthSnapshot",
      );

      await evaluatePostgresHealth();

      expect(probe).toHaveBeenCalledTimes(1);
      expect(InstanceHealthLogService.create).not.toHaveBeenCalled();
    });
  });

  describe("EvaluateRedisHealth", () => {
    beforeEach(() => {
      const config: GlobalConfig = new GlobalConfig();
      config.redisMemoryNotificationEnabled = false;
      config.redisConnectionNotificationEnabled = false;
      config.redisKeyEvictionNotificationEnabled = true;
      config.redisPersistenceFailureNotificationEnabled = false;
      mockGlobalConfig(config);
      jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    });

    test("reads its snapshot from ee's RedisHealth, which builds on core's INFO read", async () => {
      const client: FakeRedisClient = makeRedisClient(10);
      jest.spyOn(Redis, "getClient").mockReturnValue(client as never);
      const probe: jest.SpyInstance = jest.spyOn(
        RedisHealth,
        "getRedisHealthSnapshot",
      );
      const infoRead: jest.SpyInstance = jest.spyOn(
        CoreRedisHealth,
        "readInfoSnapshot",
      );

      await evaluateRedisHealth();

      expect(probe).toHaveBeenCalledTimes(1);
      expect(infoRead).toHaveBeenCalledTimes(1);
      expect(infoRead).toHaveBeenCalledWith(client);
      // The counter baseline is ee's: read from, and kept in, Redis itself.
      expect(client.get).toHaveBeenCalledWith(COUNTER_SAMPLE_KEY);
      // 17 evicted now against 10 in the baseline: 7 evictions in the window.
      expect(createdEventTypes()).toEqual([
        InstanceHealthLogEventType.RedisKeyEvictionNotification,
      ]);
      expect(MailService.sendMail).toHaveBeenCalledTimes(1);
    });

    // Negative control: no evictions since the baseline, no notification.
    test("raises nothing when the counters have not moved", async () => {
      jest
        .spyOn(Redis, "getClient")
        .mockReturnValue(makeRedisClient(17) as never);

      await evaluateRedisHealth();

      expect(InstanceHealthLogService.create).not.toHaveBeenCalled();
      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    /*
     * The admin page's read-only view stays in core and must never be what
     * the worker evaluates: it carries no deltas at all.
     */
    test("never evaluates core's read-only INFO view", async () => {
      jest
        .spyOn(Redis, "getClient")
        .mockReturnValue(makeRedisClient(10) as never);
      const readOnlyView: jest.SpyInstance = jest.spyOn(
        CoreRedisHealth,
        "getRedisInfoSnapshot",
      );

      await evaluateRedisHealth();

      expect(readOnlyView).not.toHaveBeenCalled();
    });
  });
});
