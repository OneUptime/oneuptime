import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import InstanceHealthLog, {
  InstanceHealthLogEventType,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import { Host, IsEnterpriseEdition } from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import {
  getPostgresHealthSnapshot,
  gigabytesToBytes,
  PostgresHealthSnapshot,
  PostgresReplicationSlotSnapshot,
  POSTGRES_WRAPAROUND_CEILING,
} from "Common/Server/Utils/InstanceHealth/PostgresHealth";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import { runWithInstanceHealthAdvisoryLock } from "./InstanceHealthLock";
import {
  bytesToReadable,
  evaluateInstanceHealthNotification,
  getErrorMessage,
  getLatestInstanceHealthLog,
  InstanceHealthCheckResult,
  notApplicable,
  serializeForMetadata,
} from "./InstanceHealthNotification";

const JOB_NAME: string = "InstanceHealth:EvaluatePostgresHealth";
const ADVISORY_LOCK_LABEL: string = "oneuptime:instance-health:postgres";
const HEALTH_ROUTE: string = "/health/postgres";
const HEALTH_PAGE_BUTTON_TEXT: string = "View PostgreSQL Health";
const CRITICAL_STORAGE_PERCENT: number = 90;
const CRITICAL_CONNECTION_PERCENT: number = 95;
/*
 * Postgres begins refusing writes shortly before transaction-ID age reaches the
 * 2^31 ceiling, so three quarters of the way there is already an emergency.
 */
const CRITICAL_WRAPAROUND_PERCENT: number = 75;

export interface PostgresHealthSettings {
  storageNotificationEnabled: boolean;
  storageLimitInGb: number | null;
  storageNotificationThresholdPercent: number;
  connectionNotificationEnabled: boolean;
  connectionNotificationThresholdPercent: number;
  wraparoundNotificationEnabled: boolean;
  wraparoundNotificationThresholdPercent: number;
  replicationSlotNotificationEnabled: boolean;
  retainedWalLimitInGb: number;
}

function withHost(subject: string): string {
  return Host ? `${subject} on ${Host}` : subject;
}

export async function getPostgresHealthSettings(): Promise<PostgresHealthSettings> {
  const config: GlobalConfig | null = await GlobalConfigService.findOneById({
    id: ObjectID.getZeroObjectID(),
    select: {
      postgresStorageNotificationEnabled: true,
      postgresStorageLimitInGb: true,
      postgresStorageNotificationThresholdPercent: true,
      postgresConnectionNotificationEnabled: true,
      postgresConnectionNotificationThresholdPercent: true,
      postgresWraparoundNotificationEnabled: true,
      postgresWraparoundNotificationThresholdPercent: true,
      postgresReplicationSlotNotificationEnabled: true,
      postgresRetainedWalLimitInGb: true,
    },
    props: {
      isRoot: true,
    },
  });

  return {
    storageNotificationEnabled:
      config?.postgresStorageNotificationEnabled ?? false,
    storageLimitInGb: config?.postgresStorageLimitInGb ?? null,
    storageNotificationThresholdPercent:
      config?.postgresStorageNotificationThresholdPercent ?? 80,
    connectionNotificationEnabled:
      config?.postgresConnectionNotificationEnabled ?? false,
    connectionNotificationThresholdPercent:
      config?.postgresConnectionNotificationThresholdPercent ?? 80,
    wraparoundNotificationEnabled:
      config?.postgresWraparoundNotificationEnabled ?? false,
    wraparoundNotificationThresholdPercent:
      config?.postgresWraparoundNotificationThresholdPercent ?? 50,
    replicationSlotNotificationEnabled:
      config?.postgresReplicationSlotNotificationEnabled ?? false,
    retainedWalLimitInGb: config?.postgresRetainedWalLimitInGb ?? 10,
  };
}

/*
 * Postgres exposes no filesystem free space over SQL, so the denominator here
 * is an administrator-supplied volume size rather than something measured.
 *
 * The two ways this check cannot produce a percentage are deliberately NOT
 * treated the same. A failed size probe is unknown, so it holds whatever state
 * the notification is in. A cleared storage limit is a decision — the check no
 * longer applies, and reporting that as unknown would strand an open
 * notification that could then never be resolved or re-raised.
 */
export function buildPostgresStorageCheck(data: {
  snapshot: PostgresHealthSnapshot;
  storageLimitInGb: number | null;
  thresholdPercent: number;
}): InstanceHealthCheckResult | null {
  if (data.snapshot.databaseSizeInBytes === null) {
    return null;
  }

  if (data.storageLimitInGb === null || data.storageLimitInGb <= 0) {
    return notApplicable({
      subject: withHost("PostgreSQL storage notification no longer applies"),
      resolvedMessage:
        "The PostgreSQL storage notification was resolved because no storage limit is configured.",
      snapshot: data.snapshot,
    });
  }

  const limitInBytes: number = gigabytesToBytes(data.storageLimitInGb);
  /*
   * WAL sits on the same volume but outside pg_database_size, and an abandoned
   * replication slot is exactly what parks tens of gigabytes there — the very
   * condition the sibling slot check exists to catch. Counting only the database
   * would let this check report comfortable headroom while the volume is full.
   */
  const measuredInBytes: number =
    data.snapshot.databaseSizeInBytes + (data.snapshot.walSizeInBytes ?? 0);
  const utilization: number = (measuredInBytes / limitInBytes) * 100;
  const used: string = utilization.toFixed(2);
  const isBreaching: boolean = utilization >= data.thresholdPercent;

  return {
    isBreaching,
    isCritical: utilization >= CRITICAL_STORAGE_PERCENT,
    subject: withHost(`ACTION REQUIRED: PostgreSQL is ${used}% full`),
    badgeText:
      utilization >= CRITICAL_STORAGE_PERCENT
        ? "Storage Critical"
        : "Storage Warning",
    details: [
      { title: "Storage Used: ", text: `${used}% of the configured limit` },
      { title: "Notification Threshold: ", text: `${data.thresholdPercent}%` },
      {
        title: "Database Size: ",
        text: bytesToReadable(data.snapshot.databaseSizeInBytes),
      },
      {
        title: "WAL Size: ",
        text:
          data.snapshot.walSizeInBytes === null
            ? "not measured (needs pg_monitor)"
            : bytesToReadable(data.snapshot.walSizeInBytes),
      },
      { title: "Storage Limit: ", text: bytesToReadable(limitInBytes) },
      {
        /*
         * Deliberately not called "free space": this is headroom against the
         * configured limit, not a filesystem reading. Anything else on the
         * volume is invisible here.
         */
        title: "Remaining Against Limit: ",
        text: bytesToReadable(Math.max(0, limitInBytes - measuredInBytes)),
      },
    ],
    remediation:
      "When the volume backing PostgreSQL fills, writes fail and OneUptime stops recording " +
      "incidents, monitors and alerts. Add storage, lower your retention settings, or check the " +
      "largest tables on the PostgreSQL health page. If WAL is the bulk of it, look for an " +
      "inactive replication slot holding it.",
    breachMessage:
      `PostgreSQL storage reached ${used}% of its ${data.storageLimitInGb} GB limit, ` +
      `meeting the ${data.thresholdPercent}% notification threshold.`,
    resolvedMessage:
      `PostgreSQL storage returned to ${used}% of its ${data.storageLimitInGb} GB limit, ` +
      `below the ${data.thresholdPercent}% notification threshold.`,
    observedPercent: utilization,
    thresholdPercent: data.thresholdPercent,
    metadata: {
      storageLimitInBytes: limitInBytes,
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

/*
 * Once max_connections is reached Postgres refuses new backends, and every
 * OneUptime process that needs the database starts erroring at once.
 */
export function buildPostgresConnectionCheck(data: {
  snapshot: PostgresHealthSnapshot;
  thresholdPercent: number;
}): InstanceHealthCheckResult | null {
  const utilization: number | null = data.snapshot.connectionUtilizationPercent;

  if (utilization === null) {
    return null;
  }

  const used: string = utilization.toFixed(2);
  const isBreaching: boolean = utilization >= data.thresholdPercent;

  return {
    isBreaching,
    isCritical: utilization >= CRITICAL_CONNECTION_PERCENT,
    subject: withHost(
      `ACTION REQUIRED: PostgreSQL connections are ${used}% of max_connections`,
    ),
    badgeText:
      utilization >= CRITICAL_CONNECTION_PERCENT
        ? "Connections Critical"
        : "Connections Warning",
    details: [
      {
        title: "Connections Used: ",
        text: `${used}% of the connections ordinary clients may use`,
      },
      { title: "Notification Threshold: ", text: `${data.thresholdPercent}%` },
      {
        title: "Client Backends: ",
        text: `${data.snapshot.clientBackends} of ${data.snapshot.usableConnections}`,
      },
      {
        title: "max_connections: ",
        text: `${data.snapshot.maxConnections} (minus slots reserved for superusers)`,
      },
      {
        title: "Role: ",
        text: data.snapshot.isInRecovery ? "standby" : "primary",
      },
    ],
    remediation:
      "PostgreSQL refuses new connections once max_connections is reached, which takes the whole " +
      "instance down rather than degrading it. Raise max_connections, put a connection pooler in " +
      "front of PostgreSQL, or find the client holding connections open.",
    breachMessage:
      `PostgreSQL connections reached ${used}% of max_connections, meeting the ` +
      `${data.thresholdPercent}% notification threshold.`,
    resolvedMessage:
      `PostgreSQL connections returned to ${used}% of max_connections, below the ` +
      `${data.thresholdPercent}% notification threshold.`,
    observedPercent: utilization,
    thresholdPercent: data.thresholdPercent,
    metadata: {
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

/*
 * Transaction-ID wraparound is the classic silent PostgreSQL outage: age climbs
 * quietly for weeks while autovacuum is blocked, and at the 2^31 ceiling
 * PostgreSQL shuts down writes to protect the data. Recovery from that point is
 * a single-user-mode VACUUM, so this wants a much earlier warning than a
 * capacity check.
 */
export function buildPostgresWraparoundCheck(data: {
  snapshot: PostgresHealthSnapshot;
  thresholdPercent: number;
}): InstanceHealthCheckResult | null {
  const utilization: number | null = data.snapshot.wraparoundUtilizationPercent;

  if (utilization === null || data.snapshot.maxTransactionIdAge === null) {
    return null;
  }

  const used: string = utilization.toFixed(2);
  const isBreaching: boolean = utilization >= data.thresholdPercent;

  return {
    isBreaching,
    isCritical: utilization >= CRITICAL_WRAPAROUND_PERCENT,
    subject: withHost(
      `ACTION REQUIRED: PostgreSQL transaction-ID age is ${used}% of the wraparound limit`,
    ),
    badgeText:
      utilization >= CRITICAL_WRAPAROUND_PERCENT
        ? "Wraparound Critical"
        : "Wraparound Warning",
    details: [
      { title: "Wraparound Headroom Used: ", text: `${used}%` },
      { title: "Notification Threshold: ", text: `${data.thresholdPercent}%` },
      {
        title: "Transaction ID Age: ",
        text:
          data.snapshot.transactionIdAge === null
            ? "unknown"
            : data.snapshot.transactionIdAge.toLocaleString(),
      },
      {
        title: "Multixact ID Age: ",
        text:
          data.snapshot.multiXactIdAge === null
            ? "unknown"
            : data.snapshot.multiXactIdAge.toLocaleString(),
      },
      {
        title: "Wraparound Ceiling: ",
        text: POSTGRES_WRAPAROUND_CEILING.toLocaleString(),
      },
    ],
    remediation:
      "PostgreSQL refuses all writes once transaction-ID or multixact age reaches the wraparound ceiling, and " +
      "recovering from that needs a single-user-mode VACUUM with the instance offline. Something " +
      "is holding autovacuum back — usually a long-running transaction, an abandoned prepared " +
      "transaction, or an inactive replication slot. Clear it and let autovacuum freeze the " +
      "oldest tables.",
    breachMessage:
      `PostgreSQL transaction-ID age reached ${used}% of the wraparound ceiling, meeting the ` +
      `${data.thresholdPercent}% notification threshold.`,
    resolvedMessage:
      `PostgreSQL transaction-ID age returned to ${used}% of the wraparound ceiling, below the ` +
      `${data.thresholdPercent}% notification threshold.`,
    observedPercent: utilization,
    thresholdPercent: data.thresholdPercent,
    metadata: {
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

/*
 * A replication slot pins WAL until its consumer catches up, so an abandoned
 * slot grows pg_wal without bound and is one of the most common ways a
 * PostgreSQL volume fills.
 *
 * wal_status distinguishes two very different problems, and they get different
 * severities and different messages:
 *
 *   'lost'       PostgreSQL already discarded the WAL this slot needed. The
 *                replica behind it cannot catch up and must be rebuilt. This is
 *                terminal, and the opposite of a retention problem — telling the
 *                operator to free disk space here would point them the wrong way
 *                entirely. It also nulls restart_lsn, so retained bytes read as
 *                unknown rather than large.
 *   'unreserved' The WAL is still present but is scheduled for removal at the
 *                next checkpoint. It can return to 'reserved'. A replica that
 *                briefly outran max_slot_wal_keep_size during a burst lands
 *                here and recovers on its own, so it is a warning, not a page.
 *
 * Retained bytes cannot be computed on a standby, so those slots are judged on
 * wal_status alone rather than counted as zero retention.
 */
export function buildPostgresReplicationSlotCheck(data: {
  snapshot: PostgresHealthSnapshot;
  retainedWalLimitInGb: number;
}): InstanceHealthCheckResult | null {
  // The probe could not run, so nothing is known about the slots.
  if (data.snapshot.replicationSlots === null) {
    return null;
  }

  /*
   * No slots at all is healthy, not unknown — and it is precisely the state
   * this alert's own remediation produces, since it tells the operator to drop
   * the offending slot. Reporting it as unknown would leave the notification
   * that prompted the fix permanently open, and a stranded open notification
   * suppresses every future slot problem.
   */
  if (data.snapshot.replicationSlots.length === 0) {
    return notApplicable({
      subject: withHost("PostgreSQL has no replication slots"),
      resolvedMessage:
        "The PostgreSQL replication slot notification was resolved because this instance no longer has any replication slots.",
      snapshot: data.snapshot,
    });
  }

  const limitInBytes: number = gigabytesToBytes(data.retainedWalLimitInGb);
  const overLimitSlots: Array<PostgresReplicationSlotSnapshot> =
    data.snapshot.replicationSlots.filter(
      (slot: PostgresReplicationSlotSnapshot): boolean => {
        return (
          slot.retainedWalInBytes !== null &&
          slot.retainedWalInBytes >= limitInBytes
        );
      },
    );
  const lostSlots: Array<PostgresReplicationSlotSnapshot> =
    data.snapshot.replicationSlots.filter(
      (slot: PostgresReplicationSlotSnapshot): boolean => {
        return slot.walStatus === "lost";
      },
    );
  const unreservedSlots: Array<PostgresReplicationSlotSnapshot> =
    data.snapshot.replicationSlots.filter(
      (slot: PostgresReplicationSlotSnapshot): boolean => {
        return slot.walStatus === "unreserved";
      },
    );
  const breachingSlots: Array<PostgresReplicationSlotSnapshot> = Array.from(
    new Set([...overLimitSlots, ...unreservedSlots, ...lostSlots]),
  );
  const isBreaching: boolean = breachingSlots.length > 0;
  const hasLostSlots: boolean = lostSlots.length > 0;
  const worstRetainedBytes: number = data.snapshot.replicationSlots.reduce(
    (worst: number, slot: PostgresReplicationSlotSnapshot): number => {
      return Math.max(worst, slot.retainedWalInBytes ?? 0);
    },
    0,
  );

  return {
    isBreaching,
    // Only a lost slot is unrecoverable; 'unreserved' can still return to reserved.
    isCritical: hasLostSlots,
    subject: hasLostSlots
      ? withHost(
          "ACTION REQUIRED: A PostgreSQL replication slot has lost its WAL",
        )
      : withHost(
          "ACTION REQUIRED: A PostgreSQL replication slot is retaining WAL",
        ),
    badgeText: hasLostSlots ? "Slot Lost WAL" : "WAL Retention Warning",
    details: [
      {
        title: "Slots Needing Attention: ",
        text: `${breachingSlots.length} of ${data.snapshot.replicationSlots.length}`,
      },
      {
        title: "Most WAL Retained: ",
        text:
          worstRetainedBytes > 0
            ? bytesToReadable(worstRetainedBytes)
            : "unknown",
      },
      { title: "Retained WAL Limit: ", text: bytesToReadable(limitInBytes) },
      {
        title: "Slots: ",
        text:
          data.snapshot.replicationSlots
            .map((slot: PostgresReplicationSlotSnapshot): string => {
              const retained: string =
                slot.retainedWalInBytes === null
                  ? "unknown"
                  : bytesToReadable(slot.retainedWalInBytes);
              return `${slot.slotName} (${slot.isActive ? "active" : "inactive"}, ${slot.walStatus}, ${retained})`;
            })
            .join(", ") || "none",
      },
    ],
    remediation: hasLostSlots
      ? "PostgreSQL has already discarded the WAL these slots needed, so the replicas behind " +
        "them can no longer catch up and have to be rebuilt from a fresh base backup. Freeing " +
        "disk space will not recover them. Once the replicas are rebuilt, or if they are no " +
        "longer wanted, drop the stale slots with pg_drop_replication_slot. Raising " +
        "max_slot_wal_keep_size will stop it happening again."
      : "An inactive replication slot holds WAL forever and will eventually fill the PostgreSQL " +
        "volume. Restart the consumer that owns the slot, or drop the slot with " +
        "pg_drop_replication_slot if it is no longer needed.",
    breachMessage: hasLostSlots
      ? `${lostSlots.length} PostgreSQL replication slot(s) have lost the WAL they needed and ` +
        `their replicas must be rebuilt. ${breachingSlots.length} of ` +
        `${data.snapshot.replicationSlots.length} slot(s) need attention in total.`
      : `${breachingSlots.length} PostgreSQL replication slot(s) need attention. The largest is ` +
        `retaining ${bytesToReadable(worstRetainedBytes)} of WAL against a ` +
        `${data.retainedWalLimitInGb} GB limit.`,
    resolvedMessage:
      "PostgreSQL replication slots are healthy again and retained WAL is back within the " +
      "configured limit.",
    metadata: {
      retainedWalLimitInBytes: limitInBytes,
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

export async function evaluatePostgresHealth(): Promise<void> {
  const settings: PostgresHealthSettings = await getPostgresHealthSettings();
  const [storageLog, connectionLog, wraparoundLog, replicationSlotLog]: [
    InstanceHealthLog | null,
    InstanceHealthLog | null,
    InstanceHealthLog | null,
    InstanceHealthLog | null,
  ] = await Promise.all([
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.PostgresStorageNotification,
    ),
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.PostgresConnectionSaturationNotification,
    ),
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.PostgresWraparoundNotification,
    ),
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.PostgresReplicationSlotNotification,
    ),
  ]);

  const isAnyCheckEnabled: boolean =
    settings.storageNotificationEnabled ||
    settings.connectionNotificationEnabled ||
    settings.wraparoundNotificationEnabled ||
    settings.replicationSlotNotificationEnabled;

  const snapshot: PostgresHealthSnapshot | null = isAnyCheckEnabled
    ? await getPostgresHealthSnapshot()
    : null;

  if (isAnyCheckEnabled && !snapshot) {
    logger.debug(`${JOB_NAME}: Postgres was not reachable for evaluation.`);
  }

  await evaluateInstanceHealthNotification({
    eventType: InstanceHealthLogEventType.PostgresStorageNotification,
    templateType: EmailTemplateType.PostgresHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.storageNotificationEnabled,
    latestLog: storageLog,
    check: snapshot
      ? buildPostgresStorageCheck({
          snapshot,
          storageLimitInGb: settings.storageLimitInGb,
          thresholdPercent: settings.storageNotificationThresholdPercent,
        })
      : null,
  });

  await evaluateInstanceHealthNotification({
    eventType:
      InstanceHealthLogEventType.PostgresConnectionSaturationNotification,
    templateType: EmailTemplateType.PostgresHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.connectionNotificationEnabled,
    latestLog: connectionLog,
    check: snapshot
      ? buildPostgresConnectionCheck({
          snapshot,
          thresholdPercent: settings.connectionNotificationThresholdPercent,
        })
      : null,
  });

  await evaluateInstanceHealthNotification({
    eventType: InstanceHealthLogEventType.PostgresWraparoundNotification,
    templateType: EmailTemplateType.PostgresHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.wraparoundNotificationEnabled,
    latestLog: wraparoundLog,
    check: snapshot
      ? buildPostgresWraparoundCheck({
          snapshot,
          thresholdPercent: settings.wraparoundNotificationThresholdPercent,
        })
      : null,
  });

  await evaluateInstanceHealthNotification({
    eventType: InstanceHealthLogEventType.PostgresReplicationSlotNotification,
    templateType: EmailTemplateType.PostgresHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.replicationSlotNotificationEnabled,
    latestLog: replicationSlotLog,
    check: snapshot
      ? buildPostgresReplicationSlotCheck({
          snapshot,
          retainedWalLimitInGb: settings.retainedWalLimitInGb,
        })
      : null,
  });
}

export async function runEvaluatePostgresHealthWithLock(): Promise<void> {
  if (!IsEnterpriseEdition) {
    return;
  }

  await runWithInstanceHealthAdvisoryLock({
    jobName: JOB_NAME,
    lockLabel: ADVISORY_LOCK_LABEL,
    run: evaluatePostgresHealth,
  });
}

RunCron(
  JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(15),
  },
  async (): Promise<void> => {
    try {
      await runEvaluatePostgresHealthWithLock();
    } catch (error) {
      logger.error(`${JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);
