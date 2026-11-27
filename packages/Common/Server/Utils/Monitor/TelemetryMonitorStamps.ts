import MonitorService from "../../Services/MonitorService";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE TELEMETRY SCHEDULER'S STAMPS ON A MONITOR (MonitorTelemetryMonitor).
 *
 * As the scheduler queues a telemetry monitor's evaluation it stamps the
 * monitor: when it was last scheduled (telemetryMonitorLastMonitorAt) and
 * when it is next due (telemetryMonitorNextMonitorAt), which is what the
 * scheduler reads to find what is due. Scheduler bookkeeping, so single
 * statements with no hooks: the full update pipeline would cost ~4
 * statements per monitor and - because Monitor has @EnableWorkflow +
 * @EnableAuditLog - an on-update workflow trigger and an audit entry per
 * monitor per check.
 */

export interface TelemetryMonitorStamp {
  id: ObjectID;
  /*
   * When the evaluation being queued was due. The monitor is stamped only
   * while it is still due by then: a monitor another run has queued since
   * it was read is due later, and is left alone.
   */
  dueAt: Date;
  // When the monitor is next due.
  nextMonitorAt: Date;
}

/*
 * Stamps due telemetry monitors as scheduled - when they were last
 * scheduled, and when each is next due - and says which it stamped: only
 * those are queued. One UPDATE for them all, each row its own next due time,
 * where the scheduler used to send one UPDATE per monitor, every minute,
 * all at once.
 *
 * A monitor is stamped only while it is still due by the time it was read
 * as due at (or has never been scheduled), and is not deleted, so two runs
 * that read the same monitor queue it once: the second finds it due later,
 * as the first stamped it, and leaves it. The millisecond of slack is a
 * stored time finer than JavaScript's milliseconds, which reads back a
 * fraction early. updatedAt is refreshed, as the write this replaced
 * refreshed it.
 */
export const stampTelemetryMonitorsScheduled: (data: {
  lastMonitorAt: Date;
  monitors: Array<TelemetryMonitorStamp>;
}) => Promise<Set<string>> = async (data: {
  lastMonitorAt: Date;
  monitors: Array<TelemetryMonitorStamp>;
}): Promise<Set<string>> => {
  if (data.monitors.length === 0) {
    return new Set<string>();
  }

  const rows: Array<{ _id: string }> =
    await MonitorService.getRepository().manager.query(
      `WITH "stamped" AS (UPDATE "Monitor" AS "monitor" SET "telemetryMonitorLastMonitorAt" = $1, "telemetryMonitorNextMonitorAt" = "due"."nextMonitorAt", "updatedAt" = CURRENT_TIMESTAMP FROM unnest($2::uuid[], $3::timestamptz[], $4::timestamptz[]) AS "due"("_id", "dueAt", "nextMonitorAt") WHERE "monitor"."_id" = "due"."_id" AND "monitor"."deletedAt" IS NULL AND ("monitor"."telemetryMonitorNextMonitorAt" IS NULL OR "monitor"."telemetryMonitorNextMonitorAt" < "due"."dueAt" + interval '1 millisecond') RETURNING "monitor"."_id") SELECT "_id" FROM "stamped"`,
      [
        data.lastMonitorAt,
        data.monitors.map((monitor: TelemetryMonitorStamp): string => {
          return monitor.id.toString();
        }),
        data.monitors.map((monitor: TelemetryMonitorStamp): Date => {
          return monitor.dueAt;
        }),
        data.monitors.map((monitor: TelemetryMonitorStamp): Date => {
          return monitor.nextMonitorAt;
        }),
      ],
    );

  return new Set<string>(
    rows.map((row: { _id: string }): string => {
      return String(row._id).toLowerCase();
    }),
  );
};

/*
 * Makes due again the monitors whose evaluation could not be queued after
 * they were stamped (the queue refused it), so the next run queues them
 * rather than their check being skipped. Only a monitor whose next due time
 * is still the one it was stamped with: one rescheduled since keeps its own.
 */
export const returnTelemetryMonitorsNotQueued: (
  monitors: Array<TelemetryMonitorStamp>,
) => Promise<void> = async (
  monitors: Array<TelemetryMonitorStamp>,
): Promise<void> => {
  if (monitors.length === 0) {
    return;
  }

  await MonitorService.getRepository().manager.query(
    `UPDATE "Monitor" AS "monitor" SET "telemetryMonitorNextMonitorAt" = "failed"."dueAt" FROM unnest($1::uuid[], $2::timestamptz[], $3::timestamptz[]) AS "failed"("_id", "dueAt", "nextMonitorAt") WHERE "monitor"."_id" = "failed"."_id" AND "monitor"."telemetryMonitorNextMonitorAt" = "failed"."nextMonitorAt"`,
    [
      monitors.map((monitor: TelemetryMonitorStamp): string => {
        return monitor.id.toString();
      }),
      monitors.map((monitor: TelemetryMonitorStamp): Date => {
        return monitor.dueAt;
      }),
      monitors.map((monitor: TelemetryMonitorStamp): Date => {
        return monitor.nextMonitorAt;
      }),
    ],
  );
};
