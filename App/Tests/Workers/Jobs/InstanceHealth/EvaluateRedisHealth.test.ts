import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import InstanceHealthLog, {
  InstanceHealthLogEventType,
  InstanceHealthLogStatus,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import User from "Common/Models/DatabaseModels/User";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import {
  getRedisHealthSnapshot,
  RedisHealthSnapshot,
} from "Common/Server/Utils/InstanceHealth/RedisHealth";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * Spread the real module rather than listing exports by hand: only the two
 * probe functions need stubbing, and an enumerated factory silently turns every
 * export it forgets into undefined, which surfaces as NaN or "undefined" buried
 * inside a message that substring assertions happily step over.
 */
jest.mock("Common/Server/Utils/InstanceHealth/RedisHealth", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/InstanceHealth/RedisHealth",
  );

  return {
    __esModule: true,
    ...actual,
    getRedisHealthSnapshot: jest.fn(),
    getRedisInfoSnapshot: jest.fn(),
  };
});

import {
  buildRedisConnectionCheck,
  buildRedisEvictionCheck,
  buildRedisMemoryCheck,
  buildRedisPersistenceCheck,
  evaluateRedisHealth,
  getRedisHealthSettings,
  RedisHealthSettings,
} from "../../../../FeatureSet/Workers/Jobs/InstanceHealth/EvaluateRedisHealth";
import { InstanceHealthCheckResult } from "../../../../FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthNotification";

const now: Date = new Date("2026-08-03T12:00:00.000Z");
const later: Date = new Date("2026-08-03T13:00:00.000Z");

const snapshotMock: jest.MockedFunction<typeof getRedisHealthSnapshot> =
  getRedisHealthSnapshot as jest.MockedFunction<typeof getRedisHealthSnapshot>;

function makeSnapshot(
  overrides: Partial<RedisHealthSnapshot> = {},
): RedisHealthSnapshot {
  return {
    usedMemoryInBytes: 850,
    maxMemoryInBytes: 1000,
    maxMemoryPolicy: "allkeys-lru",
    memoryUtilizationPercent: 85,
    connectedClients: 40,
    maxClients: 100,
    clientUtilizationPercent: 40,
    blockedClients: 2,
    evictedKeys: 0,
    rejectedConnections: 0,
    evictedKeysDelta: 0,
    counterWindowInSeconds: 1800,
    rejectedConnectionsDelta: 0,
    rdbLastBgsaveStatus: "ok",
    isAofEnabled: false,
    aofLastWriteStatus: "ok",
    aofLastBgrewriteStatus: "ok",
    uptimeInSeconds: 7200,
    ...overrides,
  };
}

function allSettings(
  overrides: Partial<RedisHealthSettings> = {},
): RedisHealthSettings {
  return {
    memoryNotificationEnabled: true,
    memoryNotificationThresholdPercent: 80,
    connectionNotificationEnabled: true,
    connectionNotificationThresholdPercent: 80,
    keyEvictionNotificationEnabled: true,
    persistenceFailureNotificationEnabled: true,
    ...overrides,
  };
}

function mockGlobalConfig(settings: RedisHealthSettings): void {
  const config: GlobalConfig = new GlobalConfig();
  config.redisMemoryNotificationEnabled = settings.memoryNotificationEnabled;
  config.redisMemoryNotificationThresholdPercent =
    settings.memoryNotificationThresholdPercent;
  config.redisConnectionNotificationEnabled =
    settings.connectionNotificationEnabled;
  config.redisConnectionNotificationThresholdPercent =
    settings.connectionNotificationThresholdPercent;
  config.redisKeyEvictionNotificationEnabled =
    settings.keyEvictionNotificationEnabled;
  config.redisPersistenceFailureNotificationEnabled =
    settings.persistenceFailureNotificationEnabled;

  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(config as never);
}

describe("EvaluateRedisHealth", () => {
  beforeEach(() => {
    snapshotMock.mockReset();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
    jest.spyOn(OneUptimeDate, "getSomeMinutesAfter").mockReturnValue(later);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("memory check", () => {
    test("breaches at the threshold and reports usage against maxmemory", () => {
      const check: InstanceHealthCheckResult | null = buildRedisMemoryCheck({
        snapshot: makeSnapshot(),
        thresholdPercent: 80,
      });

      expect(check?.isBreaching).toBe(true);
      expect(check?.isCritical).toBe(false);
      expect(check?.observedPercent).toBe(85);
      expect(check?.thresholdPercent).toBe(80);
      expect(check?.subject).toContain("Redis memory is 85.00% full");
      expect(check?.breachMessage).toContain("reached 85.00%");
    });

    test("treats exactly the threshold as a breach", () => {
      const check: InstanceHealthCheckResult | null = buildRedisMemoryCheck({
        snapshot: makeSnapshot({ memoryUtilizationPercent: 80 }),
        thresholdPercent: 80,
      });

      expect(check?.isBreaching).toBe(true);
    });

    test("does not breach below the threshold", () => {
      const check: InstanceHealthCheckResult | null = buildRedisMemoryCheck({
        snapshot: makeSnapshot({ memoryUtilizationPercent: 79.99 }),
        thresholdPercent: 80,
      });

      expect(check?.isBreaching).toBe(false);
      expect(check?.resolvedMessage).toContain("returned to 79.99%");
    });

    test("escalates to critical near the ceiling", () => {
      const check: InstanceHealthCheckResult | null = buildRedisMemoryCheck({
        snapshot: makeSnapshot({ memoryUtilizationPercent: 96 }),
        thresholdPercent: 80,
      });

      expect(check?.isCritical).toBe(true);
      expect(check?.badgeText).toBe("Memory Critical");
    });

    /*
     * With no maxmemory there is no ceiling to compare against. That is a
     * configuration decision, not a failed reading, so the check must report
     * itself inapplicable — a non-breaching result that CLEARS any open
     * notification. Returning null instead would hold the notification open
     * forever, and a held-open one suppresses every later memory breach.
     */
    test("clears rather than holds when maxmemory is unset", () => {
      const check: InstanceHealthCheckResult | null = buildRedisMemoryCheck({
        snapshot: makeSnapshot({
          maxMemoryInBytes: 0,
          memoryUtilizationPercent: null,
        }),
        thresholdPercent: 80,
      });

      expect(check).not.toBeNull();
      expect(check?.isBreaching).toBe(false);
      expect(check?.resolvedMessage).toContain("no maxmemory limit configured");
    });

    test("explains write rejection rather than eviction under noeviction", () => {
      const evicting: InstanceHealthCheckResult | null = buildRedisMemoryCheck({
        snapshot: makeSnapshot({ maxMemoryPolicy: "allkeys-lru" }),
        thresholdPercent: 80,
      });
      const rejecting: InstanceHealthCheckResult | null = buildRedisMemoryCheck(
        {
          snapshot: makeSnapshot({ maxMemoryPolicy: "noeviction" }),
          thresholdPercent: 80,
        },
      );

      expect(evicting?.remediation).toContain("evicting keys");
      expect(rejecting?.remediation).toContain("reject");
    });
  });

  describe("connection check", () => {
    test("breaches once connections reach the threshold", () => {
      const check: InstanceHealthCheckResult | null = buildRedisConnectionCheck(
        {
          snapshot: makeSnapshot({ clientUtilizationPercent: 85 }),
          thresholdPercent: 80,
        },
      );

      expect(check?.isBreaching).toBe(true);
      expect(check?.isCritical).toBe(false);
      expect(check?.observedPercent).toBe(85);
    });

    /*
     * A rejected connection means the limit is already being enforced, so it
     * must fire regardless of where the percentage happens to sit.
     */
    test("breaches on rejected connections even well below the threshold", () => {
      const check: InstanceHealthCheckResult | null = buildRedisConnectionCheck(
        {
          snapshot: makeSnapshot({
            clientUtilizationPercent: 5,
            rejectedConnectionsDelta: 3,
          }),
          thresholdPercent: 80,
        },
      );

      expect(check?.isBreaching).toBe(true);
      expect(check?.isCritical).toBe(true);
      expect(check?.subject).toContain("rejecting client connections");
      expect(check?.breachMessage).toContain("rejected 3 client connection(s)");
    });

    test("does not breach when connections are low and nothing was rejected", () => {
      const check: InstanceHealthCheckResult | null = buildRedisConnectionCheck(
        {
          snapshot: makeSnapshot({ clientUtilizationPercent: 40 }),
          thresholdPercent: 80,
        },
      );

      expect(check?.isBreaching).toBe(false);
    });

    test("still evaluates rejections when maxclients is unknown", () => {
      const check: InstanceHealthCheckResult | null = buildRedisConnectionCheck(
        {
          snapshot: makeSnapshot({
            maxClients: null,
            clientUtilizationPercent: null,
            rejectedConnectionsDelta: 1,
          }),
          thresholdPercent: 80,
        },
      );

      expect(check?.isBreaching).toBe(true);
      expect(check?.observedPercent).toBeUndefined();
    });

    test("cannot be evaluated when neither maxclients nor a delta is known", () => {
      expect(
        buildRedisConnectionCheck({
          snapshot: makeSnapshot({
            maxClients: null,
            clientUtilizationPercent: null,
            rejectedConnectionsDelta: null,
          }),
          thresholdPercent: 80,
        }),
      ).toBeNull();
    });
  });

  describe("eviction check", () => {
    test("breaches when keys were evicted inside the window", () => {
      const check: InstanceHealthCheckResult | null = buildRedisEvictionCheck({
        snapshot: makeSnapshot({ evictedKeysDelta: 128, evictedKeys: 500 }),
      });

      expect(check?.isBreaching).toBe(true);
      expect(check?.isCritical).toBe(true);
      expect(check?.breachMessage).toContain("evicted 128 key(s)");
    });

    test("does not breach when nothing was evicted", () => {
      const check: InstanceHealthCheckResult | null = buildRedisEvictionCheck({
        snapshot: makeSnapshot({ evictedKeysDelta: 0 }),
      });

      expect(check?.isBreaching).toBe(false);
    });

    /*
     * Without a baseline "no delta" is unknown, not zero — reporting it as zero
     * would resolve a live eviction notification on the first run after a
     * restart.
     */
    test("cannot be evaluated without a comparable earlier sample", () => {
      expect(
        buildRedisEvictionCheck({
          snapshot: makeSnapshot({ evictedKeysDelta: null }),
        }),
      ).toBeNull();
    });
  });

  describe("persistence check", () => {
    test("breaches when the last RDB snapshot failed", () => {
      const check: InstanceHealthCheckResult = buildRedisPersistenceCheck({
        snapshot: makeSnapshot({ rdbLastBgsaveStatus: "err" }),
      });

      expect(check.isBreaching).toBe(true);
      expect(check.breachMessage).toContain('RDB snapshot reported "err"');
    });

    test("does not breach when persistence is healthy", () => {
      expect(
        buildRedisPersistenceCheck({ snapshot: makeSnapshot() }).isBreaching,
      ).toBe(false);
    });

    /*
     * AOF status fields keep their last value even after AOF is turned off, so
     * reading them unconditionally would report a permanent phantom failure.
     */
    test("ignores AOF status while AOF is disabled", () => {
      const check: InstanceHealthCheckResult = buildRedisPersistenceCheck({
        snapshot: makeSnapshot({
          isAofEnabled: false,
          aofLastWriteStatus: "err",
          aofLastBgrewriteStatus: "err",
        }),
      });

      expect(check.isBreaching).toBe(false);
    });

    test("breaches on a failed AOF write once AOF is enabled", () => {
      const check: InstanceHealthCheckResult = buildRedisPersistenceCheck({
        snapshot: makeSnapshot({
          isAofEnabled: true,
          aofLastWriteStatus: "err",
        }),
      });

      expect(check.isBreaching).toBe(true);
      expect(check.breachMessage).toContain('AOF write reported "err"');
    });

    test("breaches on a failed AOF rewrite once AOF is enabled", () => {
      const check: InstanceHealthCheckResult = buildRedisPersistenceCheck({
        snapshot: makeSnapshot({
          isAofEnabled: true,
          aofLastBgrewriteStatus: "err",
        }),
      });

      expect(check.isBreaching).toBe(true);
      expect(check.breachMessage).toContain('AOF rewrite reported "err"');
    });

    /*
     * "unknown" means the field was absent from INFO, which is not evidence of
     * a failure.
     */
    test("treats an absent status as no evidence of failure", () => {
      const check: InstanceHealthCheckResult = buildRedisPersistenceCheck({
        snapshot: makeSnapshot({
          rdbLastBgsaveStatus: "unknown",
          isAofEnabled: true,
          aofLastWriteStatus: "unknown",
          aofLastBgrewriteStatus: "unknown",
        }),
      });

      expect(check.isBreaching).toBe(false);
    });
  });

  describe("evaluateRedisHealth", () => {
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

    /*
     * Probing advances the stored counter baseline, so an instance with every
     * check turned off must not pay that cost — or consume deltas nobody reads.
     */
    test("does not touch Redis when every check is disabled", async () => {
      mockGlobalConfig(
        allSettings({
          memoryNotificationEnabled: false,
          connectionNotificationEnabled: false,
          keyEvictionNotificationEnabled: false,
          persistenceFailureNotificationEnabled: false,
        }),
      );

      await evaluateRedisHealth();

      expect(snapshotMock).not.toHaveBeenCalled();
    });

    test("probes Redis once and evaluates every enabled check from it", async () => {
      mockGlobalConfig(allSettings());
      snapshotMock.mockResolvedValue(
        makeSnapshot({
          memoryUtilizationPercent: 90,
          clientUtilizationPercent: 95,
          evictedKeysDelta: 5,
          rdbLastBgsaveStatus: "err",
        }),
      );

      await evaluateRedisHealth();

      expect(snapshotMock).toHaveBeenCalledTimes(1);

      const createdEventTypes: Array<unknown> = (
        InstanceHealthLogService.create as unknown as jest.Mock
      ).mock.calls.map((call: Array<CreateBy<InstanceHealthLog>>): unknown => {
        return call[0]?.data.eventType;
      });

      expect(createdEventTypes).toEqual([
        InstanceHealthLogEventType.RedisMemoryNotification,
        InstanceHealthLogEventType.RedisConnectionSaturationNotification,
        InstanceHealthLogEventType.RedisKeyEvictionNotification,
        InstanceHealthLogEventType.RedisPersistenceFailureNotification,
      ]);
      expect(MailService.sendMail).toHaveBeenCalledTimes(4);
      expect(MailService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateType: EmailTemplateType.RedisHealthWarning,
        }),
        expect.anything(),
      );
    });

    test("only notifies for the checks that are enabled", async () => {
      mockGlobalConfig(
        allSettings({
          connectionNotificationEnabled: false,
          keyEvictionNotificationEnabled: false,
          persistenceFailureNotificationEnabled: false,
        }),
      );
      snapshotMock.mockResolvedValue(
        makeSnapshot({
          memoryUtilizationPercent: 90,
          clientUtilizationPercent: 99,
          evictedKeysDelta: 12,
          rdbLastBgsaveStatus: "err",
        }),
      );

      await evaluateRedisHealth();

      const createdEventTypes: Array<unknown> = (
        InstanceHealthLogService.create as unknown as jest.Mock
      ).mock.calls.map((call: Array<CreateBy<InstanceHealthLog>>): unknown => {
        return call[0]?.data.eventType;
      });

      expect(createdEventTypes).toEqual([
        InstanceHealthLogEventType.RedisMemoryNotification,
      ]);
    });

    /*
     * An unreachable datastore is unknown, not healthy. With a live
     * notification open it must be HELD — resolving it here would close a real
     * incident and then re-raise it the moment Redis answers again. Seeding an
     * open notification is what makes this test meaningful: against a clean
     * slate the recovery branch cannot fire either way.
     */
    test("holds an open notification when Redis cannot be reached", async () => {
      mockGlobalConfig(allSettings());
      snapshotMock.mockResolvedValue(null);

      const activeLog: InstanceHealthLog = new InstanceHealthLog();
      activeLog.id = new ObjectID("active-log");
      activeLog.status = InstanceHealthLogStatus.NotificationActive;
      (
        InstanceHealthLogService.findOneBy as unknown as jest.Mock
      ).mockResolvedValue(activeLog as never);

      await evaluateRedisHealth();

      expect(InstanceHealthLogService.create).not.toHaveBeenCalled();
      expect(InstanceHealthLogService.updateOneById).not.toHaveBeenCalled();
      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    test("closes an open notification for a check that was just disabled", async () => {
      mockGlobalConfig(
        allSettings({
          memoryNotificationEnabled: false,
          connectionNotificationEnabled: false,
          keyEvictionNotificationEnabled: false,
          persistenceFailureNotificationEnabled: false,
        }),
      );

      const activeLog: InstanceHealthLog = new InstanceHealthLog();
      activeLog.id = new ObjectID("active-log");
      activeLog.status = InstanceHealthLogStatus.NotificationActive;
      (
        InstanceHealthLogService.findOneBy as unknown as jest.Mock
      ).mockResolvedValue(activeLog as never);

      await evaluateRedisHealth();

      expect(InstanceHealthLogService.create).toHaveBeenCalledTimes(4);
      expect(
        (InstanceHealthLogService.create as unknown as jest.Mock).mock
          .calls[0]?.[0].data.status,
      ).toBe(InstanceHealthLogStatus.Resolved);
    });

    test("falls back to the documented defaults with no global config row", async () => {
      jest
        .spyOn(GlobalConfigService, "findOneById")
        .mockResolvedValue(null as never);

      await evaluateRedisHealth();

      // Every check defaults to off, so Redis is never probed.
      expect(snapshotMock).not.toHaveBeenCalled();
      expect(InstanceHealthLogService.create).not.toHaveBeenCalled();
    });

    /*
     * These defaults are written three times — the @Column decorator, the
     * migration DDL, and the ?? fallbacks here — and nothing links them. Pinning
     * the fallbacks catches the case where a threshold is changed in the model
     * but a pre-existing GlobalConfig row leaves this path serving the old one.
     */
    test("reads the documented default thresholds", async () => {
      jest
        .spyOn(GlobalConfigService, "findOneById")
        .mockResolvedValue(null as never);

      expect(await getRedisHealthSettings()).toEqual({
        memoryNotificationEnabled: false,
        memoryNotificationThresholdPercent: 80,
        connectionNotificationEnabled: false,
        connectionNotificationThresholdPercent: 80,
        keyEvictionNotificationEnabled: false,
        persistenceFailureNotificationEnabled: false,
      });
    });
  });
});
