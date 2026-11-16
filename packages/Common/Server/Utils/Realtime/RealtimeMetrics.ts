import AppMetrics from "../Telemetry/AppMetrics";
import logger from "../Logger";
import ModelEventType from "../../../Types/Realtime/ModelEventType";

/*
 * WHAT A WRITE WAITS FOR ON ACCOUNT OF LIVE UPDATES, MEASURED (#8964).
 *
 * A delete, and an update that may take a record away from someone
 * listening, first decide who could read its records (Realtime
 * .snapshotReadAccess): who listens, on this server and on every other App
 * server, asked over the cluster, and which records each of them may read.
 * The write waits for that decision, at most
 * Realtime.BEFORE_WRITE_DECISION_TIMEOUT_IN_MS. An update that names no
 * column any read is narrowed by makes no decision at all, and waits for
 * nothing (DatabaseService.getRealtimeAccessBeforeUpdate).
 *
 * Both are measured (AppMetrics): how long each decision took and how it
 * ended, and how many were not made. A measurement never fails a write.
 */

// How a decision of who could read a write's records before it ended.
export enum BeforeWriteDecisionOutcome {
  // Nobody listening could read the records: the write is heard as usual.
  NobodyCouldRead = "nobody_could_read",
  // Someone listening could read some of them: they hear about the write.
  SomeoneCouldRead = "someone_could_read",
  // Not decided in time: the write went ahead without it.
  TimedOut = "timed_out",
  // Not decided at all: the write went ahead without it.
  Failed = "failed",
}

export default class RealtimeMetrics {
  public static recordBeforeWriteDecision(data: {
    tableName: string;
    eventType: ModelEventType;
    outcome: BeforeWriteDecisionOutcome;
    durationInMs: number;
  }): void {
    try {
      AppMetrics.getRealtimeBeforeWriteDecisionDuration().record(
        Math.max(0, data.durationInMs),
        {
          [AppMetrics.REALTIME_TABLE_ATTRIBUTE]: data.tableName,
          [AppMetrics.REALTIME_EVENT_TYPE_ATTRIBUTE]: data.eventType,
          [AppMetrics.REALTIME_OUTCOME_ATTRIBUTE]: data.outcome,
        },
      );
    } catch (err) {
      logger.debug(err);
    }
  }

  // `decisions`: how many were not made, one per project of the records.
  public static recordBeforeWriteDecisionsSkipped(data: {
    tableName: string;
    eventType: ModelEventType;
    decisions: number;
  }): void {
    if (data.decisions <= 0) {
      return;
    }

    try {
      AppMetrics.getRealtimeBeforeWriteDecisionsSkipped().add(data.decisions, {
        [AppMetrics.REALTIME_TABLE_ATTRIBUTE]: data.tableName,
        [AppMetrics.REALTIME_EVENT_TYPE_ATTRIBUTE]: data.eventType,
      });
    } catch (err) {
      logger.debug(err);
    }
  }
}
