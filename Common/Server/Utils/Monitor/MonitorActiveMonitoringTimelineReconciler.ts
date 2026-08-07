import PostgresAppInstance, {
  DatabaseSource,
} from "../../Infrastructure/PostgresDatabase";
import MonitorStatusTimelineService, {
  ActiveMonitoringTimelineReconciliationResult,
} from "../../Services/MonitorStatusTimelineService";
import DatabaseNotConnectedException from "../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../Types/ObjectID";
import CaptureSpan from "../Telemetry/CaptureSpan";
import logger from "../Logger";

const RECONCILIATION_BATCH_SIZE: number = 100;

interface ActiveMonitoringMismatchRow {
  disableActiveMonitoring: boolean;
  monitorId: string;
  stateUpdatedAt: Date | string;
}

export interface ActiveMonitoringTimelineRepairResult {
  failedMonitorIds: Array<ObjectID>;
  monitorsExamined: number;
  paused: number;
  resumed: number;
}

export interface ActiveMonitoringTimelineRepairOptions {
  maximumBatches?: number | undefined;
}

/**
 * Repairs drift between Monitor.disableActiveMonitoring and the presence of an
 * open MonitorStatusTimeline row.
 *
 * Runtime hooks are the primary write path. This reconciler is the durable
 * rollout/failure safety net: data migrations overlap old pods, and monitor
 * rows commit before post-update hooks. Running on every worker startup and
 * hourly means a late old-version write or an exhausted transient retry cannot
 * leave fabricated green history indefinitely.
 */
export default class MonitorActiveMonitoringTimelineReconciler {
  @CaptureSpan()
  public static async repairMismatches(
    options: ActiveMonitoringTimelineRepairOptions = {},
  ): Promise<ActiveMonitoringTimelineRepairResult> {
    const dataSource: DatabaseSource = this.getDataSource();
    const result: ActiveMonitoringTimelineRepairResult = {
      failedMonitorIds: [],
      monitorsExamined: 0,
      paused: 0,
      resumed: 0,
    };
    let cursor: string | null = null;
    let batchesProcessed: number = 0;

    while (true) {
      if (
        options.maximumBatches !== undefined &&
        batchesProcessed >= options.maximumBatches
      ) {
        break;
      }

      /*
       * Keyset pagination is stable when monitors are deleted or repaired while
       * the scan runs. The mismatch predicate is intentionally cheap: disabled
       * monitors must have no open row; enabled monitors must have one. The
       * existing stale-open-row reconciler runs separately and handles the
       * pathological multiple-open-row case.
       */
      const rows: Array<ActiveMonitoringMismatchRow> = await dataSource.query(
        `
          SELECT
            m."_id" AS "monitorId",
            m."disableActiveMonitoring" AS "disableActiveMonitoring",
            m."updatedAt" AS "stateUpdatedAt"
          FROM "Monitor" m
          WHERE m."deletedAt" IS NULL
            AND ($1::uuid IS NULL OR m."_id" > $1::uuid)
            AND (
              (
                m."disableActiveMonitoring" = true
                AND EXISTS (
                  SELECT 1
                  FROM "MonitorStatusTimeline" t
                  WHERE t."monitorId" = m."_id"
                    AND t."deletedAt" IS NULL
                    AND t."endsAt" IS NULL
                )
              )
              OR
              (
                m."disableActiveMonitoring" = false
                AND NOT EXISTS (
                  SELECT 1
                  FROM "MonitorStatusTimeline" t
                  WHERE t."monitorId" = m."_id"
                    AND t."deletedAt" IS NULL
                    AND t."endsAt" IS NULL
                )
              )
            )
          ORDER BY m."_id" ASC
          LIMIT $2
        `,
        [cursor, RECONCILIATION_BATCH_SIZE.toString()],
      );

      if (rows.length === 0) {
        break;
      }

      batchesProcessed++;
      cursor = rows[rows.length - 1]!.monitorId;

      for (const row of rows) {
        const monitorId: ObjectID = new ObjectID(row.monitorId);
        result.monitorsExamined++;

        try {
          const reconciliation: ActiveMonitoringTimelineReconciliationResult =
            await MonitorStatusTimelineService.reconcileActiveMonitoring({
              monitorId: monitorId,
              expectedDisableActiveMonitoring:
                row.disableActiveMonitoring === true,
              reconciledAt:
                row.stateUpdatedAt instanceof Date
                  ? row.stateUpdatedAt
                  : new Date(row.stateUpdatedAt),
            });

          if (reconciliation.didPause) {
            result.paused++;
          }

          if (reconciliation.didResume) {
            result.resumed++;
          }
        } catch (error) {
          result.failedMonitorIds.push(monitorId);
          logger.error(
            `MonitorActiveMonitoringTimelineReconciler: failed to reconcile monitor ${monitorId.toString()}.`,
          );
          logger.error(error);
        }
      }

      if (rows.length < RECONCILIATION_BATCH_SIZE) {
        break;
      }
    }

    return result;
  }

  private static getDataSource(): DatabaseSource {
    const dataSource: DatabaseSource | null =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new DatabaseNotConnectedException();
    }

    return dataSource;
  }
}
