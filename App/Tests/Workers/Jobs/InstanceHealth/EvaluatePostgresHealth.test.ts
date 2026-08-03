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
  getPostgresHealthSnapshot,
  PostgresHealthSnapshot,
  PostgresReplicationSlotSnapshot,
  POSTGRES_WRAPAROUND_CEILING,
} from "Common/Server/Utils/InstanceHealth/PostgresHealth";
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

jest.mock("Common/Server/Utils/InstanceHealth/PostgresHealth", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/InstanceHealth/PostgresHealth",
  );

  return {
    __esModule: true,
    ...actual,
    getPostgresHealthSnapshot: jest.fn(),
  };
});

import {
  buildPostgresConnectionCheck,
  buildPostgresReplicationSlotCheck,
  buildPostgresStorageCheck,
  buildPostgresWraparoundCheck,
  evaluatePostgresHealth,
  getPostgresHealthSettings,
  PostgresHealthSettings,
} from "../../../../FeatureSet/Workers/Jobs/InstanceHealth/EvaluatePostgresHealth";
import { InstanceHealthCheckResult } from "../../../../FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthNotification";

const now: Date = new Date("2026-08-03T12:00:00.000Z");
const later: Date = new Date("2026-08-03T13:00:00.000Z");
const ONE_GB: number = 1024 * 1024 * 1024;

const snapshotMock: jest.MockedFunction<typeof getPostgresHealthSnapshot> =
  getPostgresHealthSnapshot as jest.MockedFunction<
    typeof getPostgresHealthSnapshot
  >;

function makeSlot(
  overrides: Partial<PostgresReplicationSlotSnapshot> = {},
): PostgresReplicationSlotSnapshot {
  return {
    slotName: "replica_1",
    slotType: "physical",
    isActive: true,
    walStatus: "reserved",
    retainedWalInBytes: ONE_GB,
    ...overrides,
  };
}

function makeSnapshot(
  overrides: Partial<PostgresHealthSnapshot> = {},
): PostgresHealthSnapshot {
  return {
    databaseSizeInBytes: 50 * ONE_GB,
    walSizeInBytes: 0,
    maxConnections: 100,
    usableConnections: 97,
    clientBackends: 40,
    connectionUtilizationPercent: 40,
    transactionIdAge: 200000000,
    multiXactIdAge: 1000,
    maxTransactionIdAge: 200000000,
    wraparoundUtilizationPercent:
      (200000000 / POSTGRES_WRAPAROUND_CEILING) * 100,
    replicationSlots: [],
    isInRecovery: false,
    ...overrides,
  };
}

function allSettings(
  overrides: Partial<PostgresHealthSettings> = {},
): PostgresHealthSettings {
  return {
    storageNotificationEnabled: true,
    storageLimitInGb: 100,
    storageNotificationThresholdPercent: 80,
    connectionNotificationEnabled: true,
    connectionNotificationThresholdPercent: 80,
    wraparoundNotificationEnabled: true,
    wraparoundNotificationThresholdPercent: 50,
    replicationSlotNotificationEnabled: true,
    retainedWalLimitInGb: 10,
    ...overrides,
  };
}

function mockGlobalConfig(settings: PostgresHealthSettings): void {
  const config: GlobalConfig = new GlobalConfig();
  config.postgresStorageNotificationEnabled =
    settings.storageNotificationEnabled;
  if (settings.storageLimitInGb !== null) {
    config.postgresStorageLimitInGb = settings.storageLimitInGb;
  }
  config.postgresStorageNotificationThresholdPercent =
    settings.storageNotificationThresholdPercent;
  config.postgresConnectionNotificationEnabled =
    settings.connectionNotificationEnabled;
  config.postgresConnectionNotificationThresholdPercent =
    settings.connectionNotificationThresholdPercent;
  config.postgresWraparoundNotificationEnabled =
    settings.wraparoundNotificationEnabled;
  config.postgresWraparoundNotificationThresholdPercent =
    settings.wraparoundNotificationThresholdPercent;
  config.postgresReplicationSlotNotificationEnabled =
    settings.replicationSlotNotificationEnabled;
  config.postgresRetainedWalLimitInGb = settings.retainedWalLimitInGb;

  jest
    .spyOn(GlobalConfigService, "findOneById")
    .mockResolvedValue(config as never);
}

describe("EvaluatePostgresHealth", () => {
  beforeEach(() => {
    snapshotMock.mockReset();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(now);
    jest.spyOn(OneUptimeDate, "getSomeMinutesAfter").mockReturnValue(later);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("storage check", () => {
    test("measures the database size against the configured limit", () => {
      const check: InstanceHealthCheckResult | null = buildPostgresStorageCheck(
        {
          snapshot: makeSnapshot({ databaseSizeInBytes: 85 * ONE_GB }),
          storageLimitInGb: 100,
          thresholdPercent: 80,
        },
      );

      expect(check?.isBreaching).toBe(true);
      expect(check?.observedPercent).toBeCloseTo(85, 5);
      expect(check?.subject).toContain("PostgreSQL is 85.00% full");
    });

    test("does not breach below the threshold", () => {
      const check: InstanceHealthCheckResult | null = buildPostgresStorageCheck(
        {
          snapshot: makeSnapshot({ databaseSizeInBytes: 50 * ONE_GB }),
          storageLimitInGb: 100,
          thresholdPercent: 80,
        },
      );

      expect(check?.isBreaching).toBe(false);
    });

    test("escalates to critical past 90%", () => {
      const check: InstanceHealthCheckResult | null = buildPostgresStorageCheck(
        {
          snapshot: makeSnapshot({ databaseSizeInBytes: 92 * ONE_GB }),
          storageLimitInGb: 100,
          thresholdPercent: 80,
        },
      );

      expect(check?.isCritical).toBe(true);
      expect(check?.badgeText).toBe("Storage Critical");
    });

    /*
     * WAL lives on the same volume but outside pg_database_size, and an
     * abandoned replication slot is exactly what fills it. Counting only the
     * database would report comfortable headroom while the volume is full and
     * writes are already failing.
     */
    test("counts WAL toward the limit", () => {
      const check: InstanceHealthCheckResult | null = buildPostgresStorageCheck(
        {
          snapshot: makeSnapshot({
            databaseSizeInBytes: 40 * ONE_GB,
            walSizeInBytes: 55 * ONE_GB,
          }),
          storageLimitInGb: 100,
          thresholdPercent: 80,
        },
      );

      expect(check?.observedPercent).toBeCloseTo(95, 5);
      expect(check?.isBreaching).toBe(true);
    });

    test("still evaluates when WAL size is not readable", () => {
      const check: InstanceHealthCheckResult | null = buildPostgresStorageCheck(
        {
          snapshot: makeSnapshot({
            databaseSizeInBytes: 85 * ONE_GB,
            walSizeInBytes: null,
          }),
          storageLimitInGb: 100,
          thresholdPercent: 80,
        },
      );

      expect(check?.observedPercent).toBeCloseTo(85, 5);
      expect(check?.details).toContainEqual({
        title: "WAL Size: ",
        text: "not measured (needs pg_monitor)",
      });
    });

    /*
     * Clearing the limit is an admin decision, so the check becomes
     * inapplicable and must CLEAR any open notification rather than hold it.
     * Holding would strand the notification permanently.
     */
    test("clears rather than holds when no storage limit is configured", () => {
      for (const storageLimitInGb of [null, 0]) {
        const check: InstanceHealthCheckResult | null =
          buildPostgresStorageCheck({
            snapshot: makeSnapshot(),
            storageLimitInGb,
            thresholdPercent: 80,
          });

        expect(check).not.toBeNull();
        expect(check?.isBreaching).toBe(false);
        expect(check?.resolvedMessage).toContain("no storage limit");
      }
    });

    test("cannot be evaluated when the database size probe failed", () => {
      expect(
        buildPostgresStorageCheck({
          snapshot: makeSnapshot({ databaseSizeInBytes: null }),
          storageLimitInGb: 100,
          thresholdPercent: 80,
        }),
      ).toBeNull();
    });
  });

  describe("connection check", () => {
    test("breaches once client backends reach the threshold", () => {
      const check: InstanceHealthCheckResult | null =
        buildPostgresConnectionCheck({
          snapshot: makeSnapshot({
            clientBackends: 85,
            connectionUtilizationPercent: 85,
          }),
          thresholdPercent: 80,
        });

      expect(check?.isBreaching).toBe(true);
      expect(check?.observedPercent).toBe(85);
      // Measured against usable connections, not raw max_connections.
      expect(check?.details).toContainEqual({
        title: "Client Backends: ",
        text: "85 of 97",
      });
    });

    test("does not breach below the threshold", () => {
      expect(
        buildPostgresConnectionCheck({
          snapshot: makeSnapshot(),
          thresholdPercent: 80,
        })?.isBreaching,
      ).toBe(false);
    });

    test("escalates to critical past 95%", () => {
      expect(
        buildPostgresConnectionCheck({
          snapshot: makeSnapshot({ connectionUtilizationPercent: 97 }),
          thresholdPercent: 80,
        })?.isCritical,
      ).toBe(true);
    });

    test("cannot be evaluated when the connection probe failed", () => {
      expect(
        buildPostgresConnectionCheck({
          snapshot: makeSnapshot({ connectionUtilizationPercent: null }),
          thresholdPercent: 80,
        }),
      ).toBeNull();
    });
  });

  describe("wraparound check", () => {
    test("measures transaction-ID age against the 2^31 ceiling", () => {
      const age: number = POSTGRES_WRAPAROUND_CEILING / 2;
      const check: InstanceHealthCheckResult | null =
        buildPostgresWraparoundCheck({
          snapshot: makeSnapshot({
            maxTransactionIdAge: age,
            wraparoundUtilizationPercent:
              (age / POSTGRES_WRAPAROUND_CEILING) * 100,
          }),
          thresholdPercent: 50,
        });

      expect(POSTGRES_WRAPAROUND_CEILING).toBe(2147483648);
      expect(check?.observedPercent).toBeCloseTo(50, 5);
      expect(check?.isBreaching).toBe(true);
    });

    test("does not breach at a healthy transaction-ID age", () => {
      expect(
        buildPostgresWraparoundCheck({
          snapshot: makeSnapshot(),
          thresholdPercent: 50,
        })?.isBreaching,
      ).toBe(false);
    });

    test("escalates to critical past three quarters of the ceiling", () => {
      const age: number = Math.floor(POSTGRES_WRAPAROUND_CEILING * 0.8);
      const check: InstanceHealthCheckResult | null =
        buildPostgresWraparoundCheck({
          snapshot: makeSnapshot({
            maxTransactionIdAge: age,
            wraparoundUtilizationPercent:
              (age / POSTGRES_WRAPAROUND_CEILING) * 100,
          }),
          thresholdPercent: 50,
        });

      expect(check?.isCritical).toBe(true);
      expect(check?.badgeText).toBe("Wraparound Critical");
      expect(check?.remediation).toContain("single-user-mode VACUUM");
    });

    test("cannot be evaluated when the wraparound probe failed", () => {
      expect(
        buildPostgresWraparoundCheck({
          snapshot: makeSnapshot({
            maxTransactionIdAge: null,
            wraparoundUtilizationPercent: null,
          }),
          thresholdPercent: 50,
        }),
      ).toBeNull();
    });
  });

  describe("replication slot check", () => {
    test("breaches when a slot retains more WAL than the limit", () => {
      const check: InstanceHealthCheckResult | null =
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({
            replicationSlots: [
              makeSlot({ retainedWalInBytes: 12 * ONE_GB, isActive: false }),
            ],
          }),
          retainedWalLimitInGb: 10,
        });

      expect(check?.isBreaching).toBe(true);
      expect(check?.breachMessage).toContain("12 GB of WAL");
    });

    test("does not breach while retained WAL is within the limit", () => {
      expect(
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({ replicationSlots: [makeSlot()] }),
          retainedWalLimitInGb: 10,
        })?.isBreaching,
      ).toBe(false);
    });

    /*
     * A 'lost' slot is the opposite failure to retention — Postgres already
     * discarded the WAL, so the replica behind that slot has to be rebuilt.
     */
    /*
     * PostgreSQL nulls restart_lsn when it invalidates a slot, so a lost slot
     * reports unknown retained WAL. The message must describe WAL that was
     * DISCARDED and a replica needing a rebuild — the earlier wording said the
     * slot was "retaining 0 B of WAL", which points the operator at freeing
     * disk space, the exact opposite of what is required.
     */
    test("breaches critically on a lost slot and says the WAL is gone", () => {
      const check: InstanceHealthCheckResult | null =
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({
            replicationSlots: [
              makeSlot({ walStatus: "lost", retainedWalInBytes: null }),
            ],
          }),
          retainedWalLimitInGb: 10,
        });

      expect(check?.isBreaching).toBe(true);
      expect(check?.isCritical).toBe(true);
      expect(check?.badgeText).toBe("Slot Lost WAL");
      expect(check?.subject).toContain("has lost its WAL");
      expect(check?.breachMessage).toContain("must be rebuilt");
      expect(check?.breachMessage).not.toContain("retaining 0 B");
      expect(check?.remediation).toContain("rebuilt from a fresh base backup");
      expect(check?.details).toContainEqual({
        title: "Most WAL Retained: ",
        text: "unknown",
      });
    });

    /*
     * 'unreserved' means the WAL is still there but scheduled for removal, and
     * it can return to 'reserved' on its own. Paging at critical severity and
     * telling the operator the replica is unrecoverable would be wrong — and if
     * they acted on it by dropping the slot, that is a destructive no-op.
     */
    test("breaches on an unreserved slot but does not treat it as terminal", () => {
      const check: InstanceHealthCheckResult | null =
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({
            replicationSlots: [makeSlot({ walStatus: "unreserved" })],
          }),
          retainedWalLimitInGb: 10,
        });

      expect(check?.isBreaching).toBe(true);
      expect(check?.isCritical).toBe(false);
      expect(check?.badgeText).toBe("WAL Retention Warning");
    });

    /*
     * A slot can land in more than one breaching bucket at once. The count must
     * come from the deduplicated set — asserting only the leading number would
     * pass without dedupe, since that number is lostSlots.length, so the "of N"
     * total and the detail row are what actually prove it.
     */
    test("counts each slot once when it both retains too much and is lost", () => {
      const check: InstanceHealthCheckResult | null =
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({
            replicationSlots: [
              makeSlot({
                walStatus: "lost",
                retainedWalInBytes: 40 * ONE_GB,
              }),
              makeSlot({ slotName: "replica_2", retainedWalInBytes: ONE_GB }),
            ],
          }),
          retainedWalLimitInGb: 10,
        });

      expect(check?.breachMessage).toContain("1 of 2 slot(s) need attention");
      expect(check?.details).toContainEqual({
        title: "Slots Needing Attention: ",
        text: "1 of 2",
      });
    });

    /*
     * Retained bytes cannot be computed on a standby, so such slots must be
     * judged on wal_status alone rather than counted as zero retention.
     */
    test("does not breach on a standby where retained WAL is unknown", () => {
      const check: InstanceHealthCheckResult | null =
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({
            isInRecovery: true,
            replicationSlots: [makeSlot({ retainedWalInBytes: null })],
          }),
          retainedWalLimitInGb: 10,
        });

      expect(check?.isBreaching).toBe(false);
    });

    /*
     * Dropping the offending slot is what this alert's own remediation tells the
     * operator to do, so "no slots" is the success state. It must CLEAR the
     * notification. Treating it as unknown would leave the very notification
     * that prompted the fix open forever, silencing all future slot problems.
     */
    test("clears once the offending slot has been dropped", () => {
      const check: InstanceHealthCheckResult | null =
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({ replicationSlots: [] }),
          retainedWalLimitInGb: 10,
        });

      expect(check).not.toBeNull();
      expect(check?.isBreaching).toBe(false);
      expect(check?.resolvedMessage).toContain(
        "no longer has any replication slots",
      );
    });

    // A failed probe is genuinely unknown and must hold the current state.
    test("cannot be evaluated when the slot probe failed", () => {
      expect(
        buildPostgresReplicationSlotCheck({
          snapshot: makeSnapshot({ replicationSlots: null }),
          retainedWalLimitInGb: 10,
        }),
      ).toBeNull();
    });
  });

  describe("evaluatePostgresHealth", () => {
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

    test("does not probe Postgres when every check is disabled", async () => {
      mockGlobalConfig(
        allSettings({
          storageNotificationEnabled: false,
          connectionNotificationEnabled: false,
          wraparoundNotificationEnabled: false,
          replicationSlotNotificationEnabled: false,
        }),
      );

      await evaluatePostgresHealth();

      expect(snapshotMock).not.toHaveBeenCalled();
    });

    test("probes once and evaluates every enabled check from that snapshot", async () => {
      mockGlobalConfig(allSettings());
      snapshotMock.mockResolvedValue(
        makeSnapshot({
          databaseSizeInBytes: 90 * ONE_GB,
          connectionUtilizationPercent: 90,
          maxTransactionIdAge: POSTGRES_WRAPAROUND_CEILING * 0.6,
          wraparoundUtilizationPercent: 60,
          replicationSlots: [
            makeSlot({ retainedWalInBytes: 25 * ONE_GB, isActive: false }),
          ],
        }),
      );

      await evaluatePostgresHealth();

      expect(snapshotMock).toHaveBeenCalledTimes(1);

      const createdEventTypes: Array<unknown> = (
        InstanceHealthLogService.create as unknown as jest.Mock
      ).mock.calls.map((call: Array<CreateBy<InstanceHealthLog>>): unknown => {
        return call[0]?.data.eventType;
      });

      expect(createdEventTypes).toEqual([
        InstanceHealthLogEventType.PostgresStorageNotification,
        InstanceHealthLogEventType.PostgresConnectionSaturationNotification,
        InstanceHealthLogEventType.PostgresWraparoundNotification,
        InstanceHealthLogEventType.PostgresReplicationSlotNotification,
      ]);
      expect(MailService.sendMail).toHaveBeenCalledTimes(4);
      expect(MailService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateType: EmailTemplateType.PostgresHealthWarning,
        }),
        expect.anything(),
      );
    });

    test("skips the storage check when no storage limit is configured", async () => {
      mockGlobalConfig(
        allSettings({
          storageLimitInGb: null,
          connectionNotificationEnabled: false,
          wraparoundNotificationEnabled: false,
          replicationSlotNotificationEnabled: false,
        }),
      );
      snapshotMock.mockResolvedValue(
        makeSnapshot({ databaseSizeInBytes: 900 * ONE_GB }),
      );

      await evaluatePostgresHealth();

      expect(InstanceHealthLogService.create).not.toHaveBeenCalled();
      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    /*
     * An unreachable datastore is unknown, not healthy. With a live
     * notification open it must be HELD — resolving it here would close a real
     * incident and then re-raise it the moment Postgres answers again. Seeding
     * an open notification is what makes this test meaningful: against a clean
     * slate the recovery branch cannot fire either way.
     */
    test("holds an open notification when Postgres cannot be reached", async () => {
      mockGlobalConfig(allSettings());
      snapshotMock.mockResolvedValue(null);

      const activeLog: InstanceHealthLog = new InstanceHealthLog();
      activeLog.id = new ObjectID("active-log");
      activeLog.status = InstanceHealthLogStatus.NotificationActive;
      (
        InstanceHealthLogService.findOneBy as unknown as jest.Mock
      ).mockResolvedValue(activeLog as never);

      await evaluatePostgresHealth();

      expect(InstanceHealthLogService.create).not.toHaveBeenCalled();
      expect(InstanceHealthLogService.updateOneById).not.toHaveBeenCalled();
      expect(MailService.sendMail).not.toHaveBeenCalled();
    });

    test("closes an open notification for a check that was just disabled", async () => {
      mockGlobalConfig(
        allSettings({
          storageNotificationEnabled: false,
          connectionNotificationEnabled: false,
          wraparoundNotificationEnabled: false,
          replicationSlotNotificationEnabled: false,
        }),
      );

      const activeLog: InstanceHealthLog = new InstanceHealthLog();
      activeLog.id = new ObjectID("active-log");
      activeLog.status = InstanceHealthLogStatus.NotificationActive;
      (
        InstanceHealthLogService.findOneBy as unknown as jest.Mock
      ).mockResolvedValue(activeLog as never);

      await evaluatePostgresHealth();

      expect(InstanceHealthLogService.create).toHaveBeenCalledTimes(4);
      expect(
        (InstanceHealthLogService.create as unknown as jest.Mock).mock
          .calls[0]?.[0].data.status,
      ).toBe(InstanceHealthLogStatus.Resolved);
    });

    test("defaults every check to off when there is no global config row", async () => {
      jest
        .spyOn(GlobalConfigService, "findOneById")
        .mockResolvedValue(null as never);

      await evaluatePostgresHealth();

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

      expect(await getPostgresHealthSettings()).toEqual({
        storageNotificationEnabled: false,
        // No limit by default, so the storage check stays skipped until set.
        storageLimitInGb: null,
        storageNotificationThresholdPercent: 80,
        connectionNotificationEnabled: false,
        connectionNotificationThresholdPercent: 80,
        wraparoundNotificationEnabled: false,
        wraparoundNotificationThresholdPercent: 50,
        replicationSlotNotificationEnabled: false,
        retainedWalLimitInGb: 10,
      });
    });
  });
});
