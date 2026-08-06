import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import InstanceHealthLog, {
  InstanceHealthLogEventType,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import { Host, IsEnterpriseEdition } from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import {
  getRedisHealthSnapshot,
  RedisHealthSnapshot,
} from "Common/Server/Utils/InstanceHealth/RedisHealth";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import {
  runWithInstanceHealthLease,
  INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES,
  INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
} from "./InstanceHealthLock";
import {
  bytesToReadable,
  evaluateInstanceHealthNotification,
  getErrorMessage,
  getLatestInstanceHealthLog,
  InstanceHealthCheckResult,
  notApplicable,
  serializeForMetadata,
} from "./InstanceHealthNotification";

const JOB_NAME: string = "InstanceHealth:EvaluateRedisHealth";
const ADVISORY_LOCK_LABEL: string = "oneuptime:instance-health:redis";
const HEALTH_ROUTE: string = "/health/redis";
const HEALTH_PAGE_BUTTON_TEXT: string = "View Redis Health";
// Above this the memory ceiling is close enough that eviction is imminent.
const CRITICAL_MEMORY_PERCENT: number = 95;
const CRITICAL_CONNECTION_PERCENT: number = 95;
/*
 * Describe the delta window using the span actually observed rather than the
 * nominal constant. The baseline is held whenever it cannot be rolled, so the
 * real lookback can exceed the nominal window and quoting the constant would
 * understate it.
 */
function describeCounterWindow(snapshot: RedisHealthSnapshot): string {
  if (snapshot.counterWindowInSeconds === null) {
    return "the last check";
  }

  const minutes: number = Math.max(
    1,
    Math.round(snapshot.counterWindowInSeconds / 60),
  );

  return `the last ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export interface RedisHealthSettings {
  memoryNotificationEnabled: boolean;
  memoryNotificationThresholdPercent: number;
  connectionNotificationEnabled: boolean;
  connectionNotificationThresholdPercent: number;
  keyEvictionNotificationEnabled: boolean;
  persistenceFailureNotificationEnabled: boolean;
}

function withHost(subject: string): string {
  return Host ? `${subject} on ${Host}` : subject;
}

export async function getRedisHealthSettings(): Promise<RedisHealthSettings> {
  const config: GlobalConfig | null = await GlobalConfigService.findOneById({
    id: ObjectID.getZeroObjectID(),
    select: {
      redisMemoryNotificationEnabled: true,
      redisMemoryNotificationThresholdPercent: true,
      redisConnectionNotificationEnabled: true,
      redisConnectionNotificationThresholdPercent: true,
      redisKeyEvictionNotificationEnabled: true,
      redisPersistenceFailureNotificationEnabled: true,
    },
    props: {
      isRoot: true,
    },
  });

  return {
    memoryNotificationEnabled: config?.redisMemoryNotificationEnabled ?? false,
    memoryNotificationThresholdPercent:
      config?.redisMemoryNotificationThresholdPercent ?? 80,
    connectionNotificationEnabled:
      config?.redisConnectionNotificationEnabled ?? false,
    connectionNotificationThresholdPercent:
      config?.redisConnectionNotificationThresholdPercent ?? 80,
    keyEvictionNotificationEnabled:
      config?.redisKeyEvictionNotificationEnabled ?? false,
    persistenceFailureNotificationEnabled:
      config?.redisPersistenceFailureNotificationEnabled ?? false,
  };
}

/*
 * Redis is at risk of losing data once used memory approaches maxmemory: with
 * an eviction policy it starts discarding keys, and with noeviction it starts
 * rejecting writes. Both break caching and the background job queues.
 *
 * With maxmemory unset there is no ceiling to measure against — Redis simply
 * grows until the host itself runs out. That is a configuration decision rather
 * than a failed reading, so the check reports itself inapplicable and clears any
 * open notification. Holding it as unknown would strand that notification, and a
 * stranded one silently suppresses every later memory breach.
 */
export function buildRedisMemoryCheck(data: {
  snapshot: RedisHealthSnapshot;
  thresholdPercent: number;
}): InstanceHealthCheckResult | null {
  const utilization: number | null = data.snapshot.memoryUtilizationPercent;

  if (utilization === null) {
    return notApplicable({
      subject: withHost("Redis memory notification no longer applies"),
      resolvedMessage:
        "The Redis memory notification was resolved because Redis has no maxmemory limit configured.",
      snapshot: data.snapshot,
    });
  }

  const used: string = utilization.toFixed(2);
  const isBreaching: boolean = utilization >= data.thresholdPercent;
  const isCritical: boolean = utilization >= CRITICAL_MEMORY_PERCENT;
  const willEvict: boolean = data.snapshot.maxMemoryPolicy !== "noeviction";

  return {
    isBreaching,
    isCritical,
    subject: withHost(`ACTION REQUIRED: Redis memory is ${used}% full`),
    badgeText: isCritical ? "Memory Critical" : "Memory Warning",
    details: [
      { title: "Memory Used: ", text: `${used}% of maxmemory` },
      {
        title: "Notification Threshold: ",
        text: `${data.thresholdPercent}%`,
      },
      {
        title: "Memory Usage: ",
        text:
          `${bytesToReadable(data.snapshot.usedMemoryInBytes)} used of ` +
          `${bytesToReadable(data.snapshot.maxMemoryInBytes)}`,
      },
      { title: "Eviction Policy: ", text: data.snapshot.maxMemoryPolicy },
      {
        title: "Connected Clients: ",
        text: data.snapshot.connectedClients.toString(),
      },
    ],
    remediation: willEvict
      ? "Once Redis reaches maxmemory it will start evicting keys under the " +
        `${data.snapshot.maxMemoryPolicy} policy, which silently drops cached data and queued job state. ` +
        "Raise maxmemory, give the Redis host more memory, or reduce what OneUptime caches."
      : "The maxmemory policy is noeviction, so once Redis reaches its limit it will reject " +
        "writes outright and background jobs will start failing. Raise maxmemory or give the " +
        "Redis host more memory.",
    breachMessage:
      `Redis memory reached ${used}%, meeting the ` +
      `${data.thresholdPercent}% notification threshold.`,
    resolvedMessage:
      `Redis memory returned to ${used}%, below the ` +
      `${data.thresholdPercent}% notification threshold.`,
    observedPercent: utilization,
    thresholdPercent: data.thresholdPercent,
    metadata: {
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

/*
 * Two signals share one check because they are the same incident seen at
 * different moments: clients climbing toward maxclients is the warning, and
 * connections actually being rejected is the same limit already being enforced.
 * Rejections are therefore always critical, whatever the percentage says.
 */
export function buildRedisConnectionCheck(data: {
  snapshot: RedisHealthSnapshot;
  thresholdPercent: number;
}): InstanceHealthCheckResult | null {
  const utilization: number | null = data.snapshot.clientUtilizationPercent;
  const rejectedDelta: number | null = data.snapshot.rejectedConnectionsDelta;

  if (utilization === null && rejectedDelta === null) {
    return null;
  }

  const hasRejections: boolean = (rejectedDelta ?? 0) > 0;
  const isOverThreshold: boolean =
    utilization !== null && utilization >= data.thresholdPercent;
  const isBreaching: boolean = isOverThreshold || hasRejections;
  const isCritical: boolean =
    hasRejections ||
    (utilization !== null && utilization >= CRITICAL_CONNECTION_PERCENT);
  const used: string =
    utilization === null ? "unknown" : utilization.toFixed(2);
  const subject: string = hasRejections
    ? withHost("ACTION REQUIRED: Redis is rejecting client connections")
    : withHost(`ACTION REQUIRED: Redis connections are ${used}% of maxclients`);

  return {
    isBreaching,
    isCritical,
    subject,
    badgeText: isCritical ? "Connections Critical" : "Connections Warning",
    details: [
      {
        title: "Connections Used: ",
        text:
          utilization === null
            ? `${data.snapshot.connectedClients} connected (maxclients unknown)`
            : `${used}% of maxclients`,
      },
      {
        title: "Notification Threshold: ",
        text: `${data.thresholdPercent}%`,
      },
      {
        title: "Connected Clients: ",
        text:
          data.snapshot.maxClients === null
            ? data.snapshot.connectedClients.toString()
            : `${data.snapshot.connectedClients} of ${data.snapshot.maxClients}`,
      },
      {
        title: "Blocked Clients: ",
        text: data.snapshot.blockedClients.toString(),
      },
      {
        title: `Rejected In ${describeCounterWindow(data.snapshot)}: `,
        text: rejectedDelta === null ? "unknown" : rejectedDelta.toString(),
      },
    ],
    remediation:
      "Redis refuses new connections once maxclients is reached, which stalls every OneUptime " +
      "process that needs the cache or a job queue. Raise maxclients, or find the client that is " +
      "leaking connections and stop it.",
    breachMessage: hasRejections
      ? `Redis rejected ${rejectedDelta} client connection(s) in ` +
        `${describeCounterWindow(data.snapshot)}, with connections at ${used}% of maxclients.`
      : `Redis connections reached ${used}% of maxclients, meeting the ` +
        `${data.thresholdPercent}% notification threshold.`,
    resolvedMessage:
      utilization === null
        ? "Redis is no longer rejecting client connections."
        : `Redis connections returned to ${used}% of maxclients with no rejected connections, ` +
          `below the ${data.thresholdPercent}% notification threshold.`,
    observedPercent: utilization ?? undefined,
    thresholdPercent: data.thresholdPercent,
    metadata: {
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

/*
 * Evictions prove data was already discarded, which the memory check can miss
 * entirely: a burst that fills Redis, evicts, and falls back under the
 * threshold before the next tick leaves no trace in the utilization reading.
 *
 * The delta covers a rolling window rather than a single tick, so a bursty
 * workload cannot clear on one quiet cycle and re-fire on the next.
 *
 * Returns null when there is no trustworthy baseline (first run after a
 * restart, or the stored sample expired), because "no delta" is unknown here,
 * not zero.
 */
export function buildRedisEvictionCheck(data: {
  snapshot: RedisHealthSnapshot;
}): InstanceHealthCheckResult | null {
  const evictedDelta: number | null = data.snapshot.evictedKeysDelta;

  if (evictedDelta === null) {
    return null;
  }

  const isBreaching: boolean = evictedDelta > 0;

  return {
    isBreaching,
    isCritical: true,
    subject: withHost("ACTION REQUIRED: Redis is evicting keys"),
    badgeText: "Data Loss",
    details: [
      {
        title: `Keys Evicted In ${describeCounterWindow(data.snapshot)}: `,
        text: evictedDelta.toString(),
      },
      {
        title: "Keys Evicted Since Restart: ",
        text: data.snapshot.evictedKeys.toString(),
      },
      { title: "Eviction Policy: ", text: data.snapshot.maxMemoryPolicy },
      {
        title: "Memory Usage: ",
        text:
          `${bytesToReadable(data.snapshot.usedMemoryInBytes)} used of ` +
          `${bytesToReadable(data.snapshot.maxMemoryInBytes)}`,
      },
    ],
    remediation:
      "Redis reached its memory limit and discarded keys to make room. Cached data and queued " +
      "job state are lost without warning when this happens. Raise maxmemory, give the Redis " +
      "host more memory, or reduce what OneUptime caches.",
    breachMessage:
      `Redis evicted ${evictedDelta} key(s) in ${describeCounterWindow(data.snapshot)} ` +
      `because it reached its memory limit under the ${data.snapshot.maxMemoryPolicy} policy.`,
    resolvedMessage: "Redis has stopped evicting keys.",
    metadata: {
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

/*
 * A failing snapshot or AOF write means Redis is running entirely from memory:
 * everything since the last good write is lost on restart. AOF fields are only
 * meaningful when AOF is turned on, so they are ignored otherwise.
 */
export function buildRedisPersistenceCheck(data: {
  snapshot: RedisHealthSnapshot;
}): InstanceHealthCheckResult {
  const failures: Array<string> = [];

  if (
    data.snapshot.rdbLastBgsaveStatus !== "ok" &&
    data.snapshot.rdbLastBgsaveStatus !== "unknown"
  ) {
    failures.push(
      `the last RDB snapshot reported "${data.snapshot.rdbLastBgsaveStatus}"`,
    );
  }

  if (data.snapshot.isAofEnabled) {
    if (
      data.snapshot.aofLastWriteStatus !== "ok" &&
      data.snapshot.aofLastWriteStatus !== "unknown"
    ) {
      failures.push(
        `the last AOF write reported "${data.snapshot.aofLastWriteStatus}"`,
      );
    }

    if (
      data.snapshot.aofLastBgrewriteStatus !== "ok" &&
      data.snapshot.aofLastBgrewriteStatus !== "unknown"
    ) {
      failures.push(
        `the last AOF rewrite reported "${data.snapshot.aofLastBgrewriteStatus}"`,
      );
    }
  }

  const isBreaching: boolean = failures.length > 0;

  return {
    isBreaching,
    isCritical: true,
    subject: withHost("ACTION REQUIRED: Redis cannot persist to disk"),
    badgeText: "Persistence Failing",
    details: [
      { title: "Last RDB Snapshot: ", text: data.snapshot.rdbLastBgsaveStatus },
      {
        title: "AOF Enabled: ",
        text: data.snapshot.isAofEnabled ? "Yes" : "No",
      },
      { title: "Last AOF Write: ", text: data.snapshot.aofLastWriteStatus },
      {
        title: "Last AOF Rewrite: ",
        text: data.snapshot.aofLastBgrewriteStatus,
      },
      {
        title: "Memory Usage: ",
        text: bytesToReadable(data.snapshot.usedMemoryInBytes),
      },
    ],
    remediation:
      "Redis is serving from memory but cannot write to disk, so everything since the last " +
      "successful write is lost if it restarts. The usual causes are a full disk on the Redis " +
      "host or a permissions problem on its data directory.",
    breachMessage: `Redis persistence is failing: ${failures.join(", ")}.`,
    resolvedMessage: "Redis persistence is healthy again.",
    metadata: {
      snapshot: serializeForMetadata(data.snapshot),
    },
  };
}

export async function evaluateRedisHealth(): Promise<void> {
  const settings: RedisHealthSettings = await getRedisHealthSettings();
  const [memoryLog, connectionLog, evictionLog, persistenceLog]: [
    InstanceHealthLog | null,
    InstanceHealthLog | null,
    InstanceHealthLog | null,
    InstanceHealthLog | null,
  ] = await Promise.all([
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.RedisMemoryNotification,
    ),
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.RedisConnectionSaturationNotification,
    ),
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.RedisKeyEvictionNotification,
    ),
    getLatestInstanceHealthLog(
      InstanceHealthLogEventType.RedisPersistenceFailureNotification,
    ),
  ]);

  const isAnyCheckEnabled: boolean =
    settings.memoryNotificationEnabled ||
    settings.connectionNotificationEnabled ||
    settings.keyEvictionNotificationEnabled ||
    settings.persistenceFailureNotificationEnabled;

  /*
   * Probing Redis writes a counter sample, so it is skipped entirely when every
   * check is off. Each evaluation below still runs with a null snapshot so a
   * check that was just disabled can close out its open notification.
   */
  const snapshot: RedisHealthSnapshot | null = isAnyCheckEnabled
    ? await getRedisHealthSnapshot()
    : null;

  if (isAnyCheckEnabled && !snapshot) {
    logger.debug(`${JOB_NAME}: Redis was not reachable for evaluation.`);
  }

  await evaluateInstanceHealthNotification({
    eventType: InstanceHealthLogEventType.RedisMemoryNotification,
    templateType: EmailTemplateType.RedisHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.memoryNotificationEnabled,
    latestLog: memoryLog,
    check: snapshot
      ? buildRedisMemoryCheck({
          snapshot,
          thresholdPercent: settings.memoryNotificationThresholdPercent,
        })
      : null,
  });

  await evaluateInstanceHealthNotification({
    eventType: InstanceHealthLogEventType.RedisConnectionSaturationNotification,
    templateType: EmailTemplateType.RedisHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.connectionNotificationEnabled,
    latestLog: connectionLog,
    check: snapshot
      ? buildRedisConnectionCheck({
          snapshot,
          thresholdPercent: settings.connectionNotificationThresholdPercent,
        })
      : null,
  });

  await evaluateInstanceHealthNotification({
    eventType: InstanceHealthLogEventType.RedisKeyEvictionNotification,
    templateType: EmailTemplateType.RedisHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.keyEvictionNotificationEnabled,
    latestLog: evictionLog,
    check: snapshot ? buildRedisEvictionCheck({ snapshot }) : null,
  });

  await evaluateInstanceHealthNotification({
    eventType: InstanceHealthLogEventType.RedisPersistenceFailureNotification,
    templateType: EmailTemplateType.RedisHealthWarning,
    healthRoute: HEALTH_ROUTE,
    healthPageButtonText: HEALTH_PAGE_BUTTON_TEXT,
    isEnabled: settings.persistenceFailureNotificationEnabled,
    latestLog: persistenceLog,
    check: snapshot ? buildRedisPersistenceCheck({ snapshot }) : null,
  });
}

export async function runEvaluateRedisHealthWithLock(): Promise<void> {
  if (!IsEnterpriseEdition) {
    return;
  }

  await runWithInstanceHealthLease({
    jobName: JOB_NAME,
    lockLabel: ADVISORY_LOCK_LABEL,
    leaseTtlInSeconds: INSTANCE_HEALTH_LEASE_TTL_IN_SECONDS,
    run: evaluateRedisHealth,
  });
}

RunCron(
  JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: OneUptimeDate.convertMinutesToMilliseconds(
      INSTANCE_HEALTH_JOB_TIMEOUT_IN_MINUTES,
    ),
  },
  async (): Promise<void> => {
    try {
      await runEvaluateRedisHealthWithLock();
    } catch (error) {
      logger.error(`${JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);
