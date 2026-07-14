import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import InstanceHealthLog, {
  InstanceHealthLogEventType,
  InstanceHealthLogStatus,
} from "Common/Models/DatabaseModels/InstanceHealthLog";
import User from "Common/Models/DatabaseModels/User";
import { IsEnterpriseEdition } from "Common/Server/EnvironmentConfig";
import PostgresDatabase, {
  DatabaseQueryRunner,
  DatabaseSource,
} from "Common/Server/Infrastructure/PostgresDatabase";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import InstanceHealthLogService from "Common/Server/Services/InstanceHealthLogService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import {
  buildClickhousePruningPlan,
  ClickhouseDiskSnapshot,
  ClickhousePartitionCandidate,
  ClickhousePartitionReclaimState,
  ClickhousePlannedPartition,
  ClickhousePruningPlan,
  dropClickhousePartition,
  getClickhouseDiskSnapshots,
  getClickhousePartitionReclaimState,
  getClickhousePrunablePartitions,
  getMaxClickhouseDiskUtilization,
} from "Common/Server/Utils/AnalyticsDatabase/ClickhouseCapacity";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";

const JOB_NAME: string = "InstanceHealth:EvaluateClickhouseCapacity";
const ADVISORY_LOCK_LABEL: string =
  "oneuptime:instance-health:clickhouse-capacity";
const MAX_PARTITIONS_PER_BATCH: number = 25;
const RECLAIM_CHECK_DELAY_IN_MINUTES: number = 10;
const RETRY_COOLDOWN_IN_MINUTES: number = 60;

export interface ClickhouseCapacitySettings {
  notificationEnabled: boolean;
  notificationThresholdPercent: number;
  pruningEnabled: boolean;
  pruningThresholdPercent: number;
  pruningTargetPercent: number;
}

interface NotificationDeliverySummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function serializeForMetadata(value: unknown): JSONValue {
  return JSON.parse(
    JSON.stringify(value, (_key: string, currentValue: unknown): unknown => {
      return typeof currentValue === "bigint"
        ? currentValue.toString()
        : currentValue;
    }),
  ) as JSONValue;
}

function mergeMetadata(
  current: JSONObject | undefined,
  additions: JSONObject,
): JSONObject {
  return Object.assign({}, current || {}, additions);
}

function getWorstDisk(
  disks: Array<ClickhouseDiskSnapshot>,
): ClickhouseDiskSnapshot | null {
  if (disks.length === 0) {
    return null;
  }

  return disks.reduce(
    (
      worst: ClickhouseDiskSnapshot,
      disk: ClickhouseDiskSnapshot,
    ): ClickhouseDiskSnapshot => {
      return disk.utilizationPercent > worst.utilizationPercent ? disk : worst;
    },
  );
}

async function getSettings(): Promise<ClickhouseCapacitySettings> {
  const config: GlobalConfig | null = await GlobalConfigService.findOneById({
    id: ObjectID.getZeroObjectID(),
    select: {
      clickhouseCapacityNotificationEnabled: true,
      clickhouseCapacityNotificationThresholdPercent: true,
      clickhouseDataPruningEnabled: true,
      clickhouseDataPruningThresholdPercent: true,
      clickhouseDataPruningTargetPercent: true,
    },
    props: {
      isRoot: true,
    },
  });

  return {
    notificationEnabled: config?.clickhouseCapacityNotificationEnabled ?? false,
    notificationThresholdPercent:
      config?.clickhouseCapacityNotificationThresholdPercent ?? 80,
    pruningEnabled: config?.clickhouseDataPruningEnabled ?? false,
    pruningThresholdPercent:
      config?.clickhouseDataPruningThresholdPercent ?? 90,
    pruningTargetPercent: config?.clickhouseDataPruningTargetPercent ?? 80,
  };
}

async function getLatestLog(
  eventType: InstanceHealthLogEventType,
): Promise<InstanceHealthLog | null> {
  return await InstanceHealthLogService.findOneBy({
    query: {
      eventType,
    },
    select: {
      _id: true,
      eventType: true,
      status: true,
      message: true,
      createdAt: true,
      completedAt: true,
      nextCheckAt: true,
      capacityBeforePercent: true,
      capacityAfterPercent: true,
      thresholdPercent: true,
      targetPercent: true,
      estimatedFreedBytes: true,
      metadata: true,
    },
    sort: {
      createdAt: SortOrder.Descending,
    },
    props: {
      isRoot: true,
    },
  });
}

async function createLog(data: {
  eventType: InstanceHealthLogEventType;
  status: InstanceHealthLogStatus;
  message: string;
  completedAt?: Date | undefined;
  nextCheckAt?: Date | undefined;
  capacityBeforePercent?: number | undefined;
  capacityAfterPercent?: number | undefined;
  thresholdPercent?: number | undefined;
  targetPercent?: number | undefined;
  estimatedFreedBytes?: number | undefined;
  metadata?: JSONObject | undefined;
}): Promise<InstanceHealthLog> {
  const log: InstanceHealthLog = new InstanceHealthLog();
  log.eventType = data.eventType;
  log.status = data.status;
  log.message = data.message;

  if (data.completedAt !== undefined) {
    log.completedAt = data.completedAt;
  }
  if (data.nextCheckAt !== undefined) {
    log.nextCheckAt = data.nextCheckAt;
  }
  if (data.capacityBeforePercent !== undefined) {
    log.capacityBeforePercent = data.capacityBeforePercent;
  }
  if (data.capacityAfterPercent !== undefined) {
    log.capacityAfterPercent = data.capacityAfterPercent;
  }
  if (data.thresholdPercent !== undefined) {
    log.thresholdPercent = data.thresholdPercent;
  }
  if (data.targetPercent !== undefined) {
    log.targetPercent = data.targetPercent;
  }
  if (data.estimatedFreedBytes !== undefined) {
    log.estimatedFreedBytes = data.estimatedFreedBytes;
  }
  if (data.metadata !== undefined) {
    log.metadata = data.metadata;
  }

  return await InstanceHealthLogService.create({
    data: log,
    props: {
      isRoot: true,
    },
  });
}

async function updateInstanceHealthLog(data: {
  id: ObjectID;
  data: Partial<InstanceHealthLog>;
  props: { isRoot: boolean };
}): Promise<void> {
  await InstanceHealthLogService.updateOneById(data as never);
}

async function sendCapacityNotificationToMasterAdmins(data: {
  capacityPercent: number;
  thresholdPercent: number;
  worstDisk: ClickhouseDiskSnapshot;
}): Promise<NotificationDeliverySummary> {
  const summary: NotificationDeliverySummary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
  };
  const subject: string = "OneUptime ClickHouse capacity warning";
  const message: string =
    `ClickHouse capacity is ${data.capacityPercent.toFixed(2)}%, which has reached ` +
    `the configured notification threshold of ${data.thresholdPercent}%. ` +
    `The most utilized writable disk is ${data.worstDisk.diskName} on ` +
    `${data.worstDisk.host} (shard ${data.worstDisk.shardNum}).`;
  let skip: number = 0;

  for (;;) {
    const users: Array<User> = await UserService.findBy({
      query: {
        isMasterAdmin: true,
        isDisabled: false,
        isBlocked: false,
      },
      select: {
        _id: true,
        email: true,
      },
      skip,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      if (!user.email) {
        continue;
      }

      summary.attempted++;

      try {
        const response: Awaited<ReturnType<typeof MailService.sendMail>> =
          await MailService.sendMail(
            {
              toEmail: user.email,
              templateType: EmailTemplateType.SimpleMessage,
              subject,
              vars: {
                subject,
                message,
              },
            },
            {
              userId: user.id || undefined,
            },
          );

        if (response.isSuccess()) {
          summary.succeeded++;
        } else {
          summary.failed++;
        }
      } catch (error) {
        summary.failed++;
        logger.error(
          `${JOB_NAME}: Failed to email a ClickHouse capacity warning: ${getErrorMessage(error)}`,
        );
      }
    }

    if (users.length < LIMIT_MAX) {
      break;
    }

    skip += users.length;
  }

  return summary;
}

export async function evaluateNotification(data: {
  settings: ClickhouseCapacitySettings;
  latestLog: InstanceHealthLog | null;
  capacityPercent?: number | undefined;
  worstDisk?: ClickhouseDiskSnapshot | undefined;
}): Promise<void> {
  const isActive: boolean =
    data.latestLog?.status === InstanceHealthLogStatus.NotificationActive;
  const isRetryableFailure: boolean =
    data.latestLog?.status === InstanceHealthLogStatus.Failed;
  const isPendingDelivery: boolean =
    data.latestLog?.status === InstanceHealthLogStatus.Running;

  if (!data.settings.notificationEnabled) {
    if (isActive || isRetryableFailure || isPendingDelivery) {
      await createLog({
        eventType: InstanceHealthLogEventType.ClickHouseCapacityNotification,
        status: InstanceHealthLogStatus.Resolved,
        message:
          "ClickHouse capacity notification state was resolved because notifications were disabled.",
        completedAt: OneUptimeDate.getCurrentDate(),
        thresholdPercent: data.settings.notificationThresholdPercent,
        metadata: {
          resolutionReason: "NotificationsDisabled",
        },
      });
    }

    return;
  }

  if (data.capacityPercent === undefined || data.worstDisk === undefined) {
    return;
  }

  if (
    (isRetryableFailure || isPendingDelivery) &&
    data.latestLog?.nextCheckAt &&
    data.latestLog.nextCheckAt.getTime() >
      OneUptimeDate.getCurrentDate().getTime() &&
    data.capacityPercent >= data.settings.notificationThresholdPercent
  ) {
    return;
  }

  if (
    data.capacityPercent >= data.settings.notificationThresholdPercent &&
    !isActive
  ) {
    /*
     * Persist pending delivery before sending mail. If this worker dies while
     * delivering, the durable cooldown prevents an immediate duplicate burst;
     * after it expires, delivery is safe to retry instead of staying silently
     * suppressed forever.
     */
    const activeLog: InstanceHealthLog = await createLog({
      eventType: InstanceHealthLogEventType.ClickHouseCapacityNotification,
      status: InstanceHealthLogStatus.Running,
      message:
        `ClickHouse capacity reached ${data.capacityPercent.toFixed(2)}%, ` +
        `meeting the ${data.settings.notificationThresholdPercent}% notification threshold. Notification delivery is pending.`,
      nextCheckAt: OneUptimeDate.getSomeMinutesAfter(RETRY_COOLDOWN_IN_MINUTES),
      capacityBeforePercent: data.capacityPercent,
      thresholdPercent: data.settings.notificationThresholdPercent,
      metadata: {
        worstDisk: serializeForMetadata(data.worstDisk),
      },
    });

    try {
      const delivery: NotificationDeliverySummary =
        await sendCapacityNotificationToMasterAdmins({
          capacityPercent: data.capacityPercent,
          thresholdPercent: data.settings.notificationThresholdPercent,
          worstDisk: data.worstDisk,
        });

      if (activeLog.id) {
        const noSuccessfulDelivery: boolean = delivery.succeeded === 0;
        const metadata: JSONObject = mergeMetadata(activeLog.metadata, {
          notificationDelivery: serializeForMetadata(delivery),
        });
        const updateData: InstanceHealthLog = new InstanceHealthLog();
        updateData.status = noSuccessfulDelivery
          ? InstanceHealthLogStatus.Failed
          : InstanceHealthLogStatus.NotificationActive;
        updateData.completedAt = noSuccessfulDelivery
          ? OneUptimeDate.getCurrentDate()
          : (null as unknown as Date);
        updateData.nextCheckAt = noSuccessfulDelivery
          ? OneUptimeDate.getSomeMinutesAfter(RETRY_COOLDOWN_IN_MINUTES)
          : (null as unknown as Date);
        updateData.metadata = metadata;
        updateData.message = noSuccessfulDelivery
          ? `${activeLog.message} No notification email was delivered; retrying after a cooldown.`
          : `${activeLog.message} Notification email delivery: ` +
            `${delivery.succeeded} succeeded, ${delivery.failed} failed.`;

        await updateInstanceHealthLog({
          id: activeLog.id,
          data: updateData,
          props: {
            isRoot: true,
          },
        });
      }
    } catch (error) {
      if (activeLog.id) {
        const updateData: InstanceHealthLog = new InstanceHealthLog();
        updateData.status = InstanceHealthLogStatus.Failed;
        updateData.message =
          `${activeLog.message} Notification delivery failed before any confirmed email: ` +
          getErrorMessage(error);
        updateData.completedAt = OneUptimeDate.getCurrentDate();
        updateData.nextCheckAt = OneUptimeDate.getSomeMinutesAfter(
          RETRY_COOLDOWN_IN_MINUTES,
        );
        updateData.metadata = mergeMetadata(activeLog.metadata, {
          notificationDeliveryError: getErrorMessage(error),
        });

        await updateInstanceHealthLog({
          id: activeLog.id,
          data: updateData,
          props: {
            isRoot: true,
          },
        });
      }

      throw error;
    }

    return;
  }

  if (
    data.capacityPercent < data.settings.notificationThresholdPercent &&
    (isActive || isRetryableFailure || isPendingDelivery)
  ) {
    await createLog({
      eventType: InstanceHealthLogEventType.ClickHouseCapacityNotification,
      status: InstanceHealthLogStatus.Resolved,
      message:
        `ClickHouse capacity returned to ${data.capacityPercent.toFixed(2)}%, ` +
        `below the ${data.settings.notificationThresholdPercent}% notification threshold.`,
      completedAt: OneUptimeDate.getCurrentDate(),
      capacityAfterPercent: data.capacityPercent,
      thresholdPercent: data.settings.notificationThresholdPercent,
      metadata: {
        worstDisk: serializeForMetadata(data.worstDisk),
        resolutionReason: "CapacityBelowThreshold",
      },
    });
  }
}

async function markWaitingLogComplete(data: {
  log: InstanceHealthLog;
  status: InstanceHealthLogStatus.Succeeded | InstanceHealthLogStatus.Partial;
  capacityPercent: number;
  message: string;
}): Promise<void> {
  if (!data.log.id) {
    return;
  }

  await updateInstanceHealthLog({
    id: data.log.id,
    data: {
      status: data.status,
      message: data.message,
      capacityAfterPercent: data.capacityPercent,
      completedAt: OneUptimeDate.getCurrentDate(),
      nextCheckAt: null as unknown as Date,
    },
    props: {
      isRoot: true,
    },
  });
}

async function recoverInterruptedPruningLog(
  log: InstanceHealthLog,
  cancelAfterReclaim: boolean,
): Promise<void> {
  if (!log.id) {
    return;
  }

  const nextCheckAt: Date = OneUptimeDate.getSomeMinutesAfter(
    RECLAIM_CHECK_DELAY_IN_MINUTES,
  );

  await updateInstanceHealthLog({
    id: log.id,
    data: {
      status: InstanceHealthLogStatus.WaitingForReclaim,
      message:
        "The pruning worker stopped before recording the DDL result. Waiting before another destructive batch while ClickHouse state is reconciled.",
      nextCheckAt,
      metadata: mergeMetadata(log.metadata, {
        recoveredInterruptedBatchAt: OneUptimeDate.getCurrentDate(),
        ...(cancelAfterReclaim ? { cancelAfterReclaim: true } : {}),
      }),
    },
    props: {
      isRoot: true,
    },
  });
}

function getPartitionsToReconcile(
  log: InstanceHealthLog,
): Array<ClickhousePlannedPartition> {
  const metadata: JSONObject = log.metadata || {};
  const droppedPartitions: unknown = metadata["droppedPartitions"];
  const rawPartitions: unknown =
    Array.isArray(droppedPartitions) && droppedPartitions.length > 0
      ? droppedPartitions
      : metadata["partitions"];

  if (!Array.isArray(rawPartitions)) {
    return [];
  }

  return rawPartitions.flatMap(
    (value: unknown): Array<ClickhousePlannedPartition> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }

      const partition: Record<string, unknown> = value as Record<
        string,
        unknown
      >;
      const tableName: string = String(partition["tableName"] || "");
      const partitionId: string = String(partition["partitionId"] || "");

      if (!tableName || !partitionId) {
        return [];
      }

      const estimatedFreedBytes: number = Number(
        partition["estimatedFreedBytes"] || 0,
      );

      return [
        {
          tableName,
          partitionId,
          estimatedFreedBytes: Number.isFinite(estimatedFreedBytes)
            ? estimatedFreedBytes
            : 0,
        },
      ];
    },
  );
}

/*
 * Return true when the current tick must remain in WaitingForReclaim. A DROP
 * can leave inactive parts on disk beyond the nominal delay; advancing while
 * those bytes are still present can over-prune once delayed cleanup catches up.
 * Missing metadata or a failed reconciliation query therefore fails closed.
 */
async function shouldKeepWaitingForReclaim(
  log: InstanceHealthLog,
): Promise<boolean> {
  if (!log.id) {
    logger.error(
      `${JOB_NAME}: Cannot reconcile a pruning batch without an InstanceHealthLog id.`,
    );
    return true;
  }

  const partitions: Array<ClickhousePlannedPartition> =
    getPartitionsToReconcile(log);

  if (partitions.length === 0) {
    const nextCheckAt: Date = OneUptimeDate.getSomeMinutesAfter(
      RETRY_COOLDOWN_IN_MINUTES,
    );
    await updateInstanceHealthLog({
      id: log.id,
      data: {
        status: InstanceHealthLogStatus.WaitingForReclaim,
        message:
          "Waiting to continue pruning because the prior batch has no partition metadata to reconcile safely.",
        nextCheckAt,
        metadata: mergeMetadata(log.metadata, {
          reclaimReconciliationError: "PartitionMetadataMissing",
          reclaimCheckedAt: OneUptimeDate.getCurrentDate().toISOString(),
        }),
      },
      props: {
        isRoot: true,
      },
    });
    return true;
  }

  try {
    const reclaimState: ClickhousePartitionReclaimState =
      await getClickhousePartitionReclaimState(partitions);

    if (
      reclaimState.inactivePartCount === 0 &&
      reclaimState.inactiveBytes === 0
    ) {
      return false;
    }

    const nextCheckAt: Date = OneUptimeDate.getSomeMinutesAfter(
      RECLAIM_CHECK_DELAY_IN_MINUTES,
    );
    await updateInstanceHealthLog({
      id: log.id,
      data: {
        status: InstanceHealthLogStatus.WaitingForReclaim,
        message:
          `Waiting for ${reclaimState.inactivePartCount} inactive ClickHouse ` +
          `part(s) (${reclaimState.inactiveBytes} bytes) from the prior pruning batch to leave disk.`,
        nextCheckAt,
        metadata: mergeMetadata(log.metadata, {
          remainingInactivePartCount: reclaimState.inactivePartCount,
          remainingInactiveBytes: reclaimState.inactiveBytes,
          reclaimCheckedAt: OneUptimeDate.getCurrentDate().toISOString(),
        }),
      },
      props: {
        isRoot: true,
      },
    });
    return true;
  } catch (error) {
    const nextCheckAt: Date = OneUptimeDate.getSomeMinutesAfter(
      RETRY_COOLDOWN_IN_MINUTES,
    );
    const errorMessage: string = getErrorMessage(error);
    await updateInstanceHealthLog({
      id: log.id,
      data: {
        status: InstanceHealthLogStatus.WaitingForReclaim,
        message:
          "Waiting to continue pruning because ClickHouse reclaim state could not be verified safely.",
        nextCheckAt,
        metadata: mergeMetadata(log.metadata, {
          reclaimReconciliationError: errorMessage,
          reclaimCheckedAt: OneUptimeDate.getCurrentDate().toISOString(),
        }),
      },
      props: {
        isRoot: true,
      },
    });
    logger.error(`${JOB_NAME}: Reclaim reconciliation failed: ${errorMessage}`);
    return true;
  }
}

export async function evaluatePruning(data: {
  settings: ClickhouseCapacitySettings;
  latestLog: InstanceHealthLog | null;
  disks: Array<ClickhouseDiskSnapshot>;
  capacityPercent: number;
  worstDisk: ClickhouseDiskSnapshot;
}): Promise<void> {
  let latestLog: InstanceHealthLog | null = data.latestLog;
  const now: Date = OneUptimeDate.getCurrentDate();

  if (
    latestLog?.status === InstanceHealthLogStatus.Partial &&
    data.capacityPercent <= data.settings.pruningTargetPercent
  ) {
    await markWaitingLogComplete({
      log: latestLog,
      status: InstanceHealthLogStatus.Succeeded,
      capacityPercent: data.capacityPercent,
      message:
        `ClickHouse capacity reached ${data.capacityPercent.toFixed(2)}%, ` +
        `at or below the ${data.settings.pruningTargetPercent}% target after a partial pruning batch.`,
    });
    return;
  }

  let shouldContinueTowardTarget: boolean =
    data.capacityPercent > data.settings.pruningTargetPercent &&
    latestLog?.status === InstanceHealthLogStatus.Partial;

  if (latestLog?.status === InstanceHealthLogStatus.Running) {
    await recoverInterruptedPruningLog(
      latestLog,
      !data.settings.pruningEnabled,
    );
    return;
  }

  if (
    (latestLog?.status === InstanceHealthLogStatus.TargetUnreachable ||
      latestLog?.status === InstanceHealthLogStatus.Failed) &&
    latestLog.nextCheckAt &&
    latestLog.nextCheckAt.getTime() > now.getTime()
  ) {
    return;
  }

  if (latestLog?.status === InstanceHealthLogStatus.WaitingForReclaim) {
    let cancelAfterReclaim: boolean =
      latestLog.metadata?.["cancelAfterReclaim"] === true;

    if (!data.settings.pruningEnabled && !cancelAfterReclaim && latestLog.id) {
      latestLog.metadata = mergeMetadata(latestLog.metadata, {
        cancelAfterReclaim: true,
      });
      await updateInstanceHealthLog({
        id: latestLog.id,
        data: {
          metadata: latestLog.metadata,
          message:
            "Automatic pruning was disabled. Waiting for the already-issued batch to reclaim before cancelling this pruning cycle.",
        },
        props: {
          isRoot: true,
        },
      });
      cancelAfterReclaim = true;
    }

    if (
      latestLog.nextCheckAt &&
      latestLog.nextCheckAt.getTime() > now.getTime()
    ) {
      return;
    }

    if (await shouldKeepWaitingForReclaim(latestLog)) {
      return;
    }

    if (data.capacityPercent <= data.settings.pruningTargetPercent) {
      await markWaitingLogComplete({
        log: latestLog,
        status: InstanceHealthLogStatus.Succeeded,
        capacityPercent: data.capacityPercent,
        message:
          `ClickHouse reclaimed capacity after pruning. Current capacity is ` +
          `${data.capacityPercent.toFixed(2)}%, at or below the ` +
          `${data.settings.pruningTargetPercent}% target.`,
      });
      return;
    }

    await markWaitingLogComplete({
      log: latestLog,
      status: InstanceHealthLogStatus.Partial,
      capacityPercent: data.capacityPercent,
      message:
        `ClickHouse reclaimed some capacity after pruning, but remains at ` +
        `${data.capacityPercent.toFixed(2)}%, above the ` +
        `${data.settings.pruningTargetPercent}% target.`,
    });

    if (cancelAfterReclaim) {
      await createLog({
        eventType: InstanceHealthLogEventType.ClickHouseDataPruning,
        status: InstanceHealthLogStatus.Resolved,
        message:
          "The incomplete ClickHouse pruning cycle was cancelled after reclaim because automatic pruning was disabled.",
        completedAt: OneUptimeDate.getCurrentDate(),
        capacityAfterPercent: data.capacityPercent,
        thresholdPercent: data.settings.pruningThresholdPercent,
        targetPercent: data.settings.pruningTargetPercent,
        metadata: {
          resolutionReason: "PruningDisabled",
        },
      });
      return;
    }

    shouldContinueTowardTarget = true;
    latestLog = null;
  }

  if (
    !data.settings.pruningEnabled ||
    (!shouldContinueTowardTarget &&
      data.capacityPercent < data.settings.pruningThresholdPercent)
  ) {
    return;
  }

  if (
    data.settings.pruningTargetPercent >= data.settings.pruningThresholdPercent
  ) {
    logger.error(
      `${JOB_NAME}: Refusing to prune because the target must be below the threshold.`,
    );
    return;
  }

  let runningLog: InstanceHealthLog | null = null;
  const droppedPartitions: Array<ClickhousePlannedPartition> = [];

  try {
    const candidates: Array<ClickhousePartitionCandidate> =
      await getClickhousePrunablePartitions();
    const plan: ClickhousePruningPlan = buildClickhousePruningPlan({
      disks: data.disks,
      candidates,
      targetPercent: data.settings.pruningTargetPercent,
      maxPartitions: MAX_PARTITIONS_PER_BATCH,
    });

    if (plan.partitions.length === 0) {
      await createLog({
        eventType: InstanceHealthLogEventType.ClickHouseDataPruning,
        status: InstanceHealthLogStatus.TargetUnreachable,
        message:
          `ClickHouse capacity is ${data.capacityPercent.toFixed(2)}%, but no ` +
          "safe historical partition is available to prune. The newest partition of each table is protected.",
        completedAt: OneUptimeDate.getCurrentDate(),
        nextCheckAt: OneUptimeDate.getSomeMinutesAfter(
          RETRY_COOLDOWN_IN_MINUTES,
        ),
        capacityBeforePercent: data.capacityPercent,
        thresholdPercent: data.settings.pruningThresholdPercent,
        targetPercent: data.settings.pruningTargetPercent,
        metadata: {
          candidateCount: candidates.length,
          worstDisk: serializeForMetadata(data.worstDisk),
          plan: serializeForMetadata(plan),
        },
      });
      return;
    }

    runningLog = await createLog({
      eventType: InstanceHealthLogEventType.ClickHouseDataPruning,
      status: InstanceHealthLogStatus.Running,
      message:
        `Starting a bounded ClickHouse pruning batch of ${plan.partitions.length} ` +
        `partition(s) at ${data.capacityPercent.toFixed(2)}% capacity.`,
      capacityBeforePercent: data.capacityPercent,
      thresholdPercent: data.settings.pruningThresholdPercent,
      targetPercent: data.settings.pruningTargetPercent,
      estimatedFreedBytes: plan.estimatedFreedBytes,
      metadata: {
        maxPartitionsPerBatch: MAX_PARTITIONS_PER_BATCH,
        targetReachableInBatch: plan.targetReachable,
        projectedMaxUtilizationPercent: plan.projectedMaxUtilizationPercent,
        worstDisk: serializeForMetadata(data.worstDisk),
        partitions: serializeForMetadata(plan.partitions),
      },
    });

    for (const partition of plan.partitions) {
      await dropClickhousePartition({
        tableName: partition.tableName,
        partitionId: partition.partitionId,
      });
      droppedPartitions.push(partition);
    }

    if (!runningLog.id) {
      throw new Error("The running InstanceHealthLog has no id.");
    }

    const nextCheckAt: Date = OneUptimeDate.getSomeMinutesAfter(
      RECLAIM_CHECK_DELAY_IN_MINUTES,
    );

    await updateInstanceHealthLog({
      id: runningLog.id,
      data: {
        status: InstanceHealthLogStatus.WaitingForReclaim,
        message:
          `Dropped ${droppedPartitions.length} ClickHouse partition(s). ` +
          `Waiting until ${nextCheckAt.toISOString()} for inactive parts and filesystem space to be reclaimed.`,
        nextCheckAt,
        metadata: mergeMetadata(runningLog.metadata, {
          droppedPartitionCount: droppedPartitions.length,
          droppedPartitions: serializeForMetadata(droppedPartitions),
        }),
      },
      props: {
        isRoot: true,
      },
    });
  } catch (error) {
    const errorMessage: string = getErrorMessage(error);
    const nextCheckAt: Date = OneUptimeDate.getSomeMinutesAfter(
      droppedPartitions.length > 0
        ? RECLAIM_CHECK_DELAY_IN_MINUTES
        : RETRY_COOLDOWN_IN_MINUTES,
    );

    if (runningLog?.id) {
      await updateInstanceHealthLog({
        id: runningLog.id,
        data: {
          status:
            droppedPartitions.length > 0
              ? InstanceHealthLogStatus.WaitingForReclaim
              : InstanceHealthLogStatus.Failed,
          message:
            droppedPartitions.length > 0
              ? `Dropped ${droppedPartitions.length} ClickHouse partition(s), but the batch then failed: ${errorMessage}. Waiting for reclaim before evaluating another batch.`
              : `ClickHouse pruning failed before any confirmed partition drop: ${errorMessage}`,
          completedAt:
            droppedPartitions.length > 0
              ? (null as unknown as Date)
              : OneUptimeDate.getCurrentDate(),
          nextCheckAt,
          metadata: mergeMetadata(runningLog.metadata, {
            error: errorMessage,
            droppedPartitionCount: droppedPartitions.length,
            droppedPartitions: serializeForMetadata(droppedPartitions),
          }),
        },
        props: {
          isRoot: true,
        },
      });
    } else {
      await createLog({
        eventType: InstanceHealthLogEventType.ClickHouseDataPruning,
        status: InstanceHealthLogStatus.Failed,
        message: `ClickHouse pruning planning failed: ${errorMessage}`,
        completedAt: OneUptimeDate.getCurrentDate(),
        nextCheckAt,
        capacityBeforePercent: data.capacityPercent,
        thresholdPercent: data.settings.pruningThresholdPercent,
        targetPercent: data.settings.pruningTargetPercent,
        metadata: {
          error: errorMessage,
          worstDisk: serializeForMetadata(data.worstDisk),
        },
      });
    }

    logger.error(`${JOB_NAME}: ${errorMessage}`);
  }
}

export async function evaluateClickhouseCapacity(): Promise<void> {
  const settings: ClickhouseCapacitySettings = await getSettings();
  const [latestNotificationLog, latestPruningLog]: [
    InstanceHealthLog | null,
    InstanceHealthLog | null,
  ] = await Promise.all([
    getLatestLog(InstanceHealthLogEventType.ClickHouseCapacityNotification),
    getLatestLog(InstanceHealthLogEventType.ClickHouseDataPruning),
  ]);

  if (!settings.notificationEnabled) {
    await evaluateNotification({
      settings,
      latestLog: latestNotificationLog,
    });
  }

  if (
    !settings.pruningEnabled &&
    latestPruningLog?.status === InstanceHealthLogStatus.Partial
  ) {
    /*
     * A Partial row carries the X-to-Y hysteresis state. End that cycle
     * durably when pruning is disabled so re-enabling months later cannot
     * resume destructive work below the newly configured trigger.
     */
    await createLog({
      eventType: InstanceHealthLogEventType.ClickHouseDataPruning,
      status: InstanceHealthLogStatus.Resolved,
      message:
        "The incomplete ClickHouse pruning cycle was cancelled because automatic pruning was disabled.",
      completedAt: OneUptimeDate.getCurrentDate(),
      thresholdPercent: settings.pruningThresholdPercent,
      targetPercent: settings.pruningTargetPercent,
      metadata: {
        resolutionReason: "PruningDisabled",
      },
    });
  }

  const hasOutstandingPruningWork: boolean =
    latestPruningLog?.status === InstanceHealthLogStatus.Running ||
    latestPruningLog?.status === InstanceHealthLogStatus.WaitingForReclaim;

  if (
    !settings.notificationEnabled &&
    !settings.pruningEnabled &&
    !hasOutstandingPruningWork
  ) {
    return;
  }

  const disks: Array<ClickhouseDiskSnapshot> =
    await getClickhouseDiskSnapshots();
  const capacityPercent: number | null = getMaxClickhouseDiskUtilization(disks);
  const worstDisk: ClickhouseDiskSnapshot | null = getWorstDisk(disks);

  if (capacityPercent === null || !worstDisk) {
    logger.debug(
      `${JOB_NAME}: No writable local ClickHouse disk was available for evaluation.`,
    );
    return;
  }

  if (settings.notificationEnabled) {
    await evaluateNotification({
      settings,
      latestLog: latestNotificationLog,
      capacityPercent,
      worstDisk,
    });
  }

  await evaluatePruning({
    settings,
    latestLog: latestPruningLog,
    disks,
    capacityPercent,
    worstDisk,
  });
}

function advisoryLockWasAcquired(rows: unknown): boolean {
  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  const acquired: unknown = (rows[0] as { acquired?: unknown }).acquired;
  return acquired === true || acquired === "t" || acquired === 1;
}

export async function runEvaluateClickhouseCapacityWithLock(): Promise<void> {
  if (!IsEnterpriseEdition) {
    return;
  }

  const dataSource: DatabaseSource | null = PostgresDatabase.getDataSource();

  if (!dataSource) {
    logger.error(
      `${JOB_NAME}: Skipping evaluation because Postgres is not connected.`,
    );
    return;
  }

  const queryRunner: DatabaseQueryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    await queryRunner.startTransaction();

    const rows: unknown = await queryRunner.query(
      "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired",
      [ADVISORY_LOCK_LABEL],
    );

    if (!advisoryLockWasAcquired(rows)) {
      await queryRunner.commitTransaction();
      return;
    }

    await evaluateClickhouseCapacity();
    await queryRunner.commitTransaction();
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      try {
        await queryRunner.rollbackTransaction();
      } catch (rollbackError) {
        logger.error(
          `${JOB_NAME}: Failed to roll back the advisory-lock transaction: ${getErrorMessage(rollbackError)}`,
        );
      }
    }

    throw error;
  } finally {
    await queryRunner.release();
  }
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
      await runEvaluateClickhouseCapacityWithLock();
    } catch (error) {
      logger.error(`${JOB_NAME}: ${getErrorMessage(error)}`);
    }
  },
);
