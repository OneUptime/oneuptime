import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DETECTION_EVALUATION_DELAY_IN_SECONDS,
  DETECTION_MAX_LOOKBACK_IN_MINUTES,
} from "../../../../Types/SecurityEvent/DetectionFindingConstants";
import Queue, { QueueName } from "../../../Infrastructure/Queue";

/*
 * The jobs a real-time rule runs on (Types/SecurityEvent/RealTimeDetection):
 * RealTimeDetections queues them, RealTimeDetectionJob runs them. Kept apart
 * from both, so the rule's own service can queue one without loading either.
 *
 *   - A confirmation: the events one write handed one rule, by id.
 *   - A handover: every event of a window, for a rule that has just started
 *     to run in real time. Until every process has read the rule again
 *     (REAL_TIME_RULES_CACHE_TTL_MS), the events it writes are screened
 *     without it; and a rule taken off its schedule last read its events
 *     at its last run. The handover reads both - from where the schedule
 *     stopped until every process screens for it - once that window's late
 *     events are in, as a scheduled run would.
 */

export const REAL_TIME_DETECTION_JOB: string =
  "DetectionRules:EvaluateRealTime";

// How long a project's real-time rules are kept before they are read again.
export const REAL_TIME_RULES_CACHE_TTL_MS: number = 30 * 1000;

// The most events one job confirms: more candidates make more jobs.
export const REAL_TIME_EVENTS_PER_JOB: number = 500;

// A job waits this long for its events to be readable, then twice as long, at most this many times.
export const REAL_TIME_FIRST_DELAY_MS: number = 5 * 1000;
export const REAL_TIME_MAX_ATTEMPTS: number = 5;

// A handover reads this much past the time every process screens for the rule.
export const REAL_TIME_HANDOVER_MARGIN_MS: number = 5 * 1000;

// An event a job names: the row's id, and when it happened (ISO 8601).
export interface RealTimeCandidate {
  id: string;
  time: string;
}

// The window a handover reads (ISO 8601), by when its events happened.
export interface RealTimeWindow {
  startTime: string;
  endTime: string;
}

export interface RealTimeJobData {
  projectId: string;
  ruleId: string;
  events: Array<RealTimeCandidate>;
  attempt: number;
  // A handover's window: every event of it, rather than `events`.
  window?: RealTimeWindow | undefined;
}

/*
 * Where a rule starting in real time at `now` hands over from: its last
 * scheduled run, or - a rule that never ran - the interval a scheduled
 * rule's first run reads; at most DETECTION_MAX_LOOKBACK_IN_MINUTES back,
 * as a run reads. Until the time every process screens for it.
 */
export function getRealTimeHandoverWindow(data: {
  now: Date;
  lastEvaluatedAt?: Date | null | undefined;
  evaluationIntervalInMinutes?: number | null | undefined;
}): { startTime: Date; endTime: Date } {
  const endTime: Date = new Date(
    data.now.getTime() +
      REAL_TIME_RULES_CACHE_TTL_MS +
      REAL_TIME_HANDOVER_MARGIN_MS,
  );
  const earliest: Date = OneUptimeDate.addRemoveMinutes(
    endTime,
    -DETECTION_MAX_LOOKBACK_IN_MINUTES,
  );
  const startTime: Date = data.lastEvaluatedAt
    ? new Date(data.lastEvaluatedAt)
    : OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.addRemoveSeconds(
          data.now,
          -DETECTION_EVALUATION_DELAY_IN_SECONDS,
        ),
        -Math.max(1, data.evaluationIntervalInMinutes || 1),
      );

  return {
    startTime: startTime.getTime() < earliest.getTime() ? earliest : startTime,
    endTime,
  };
}

export default class RealTimeJobs {
  // A confirming job, later for every attempt: the first after a few seconds, then twice as long.
  public static async enqueue(job: RealTimeJobData): Promise<void> {
    await Queue.addJob(
      QueueName.Worker,
      // The rule, the first event and the attempt: never two jobs for the same work.
      `real-time-detection-${job.ruleId}-${job.events[0]?.id || "none"}-${job.attempt}`,
      REAL_TIME_DETECTION_JOB,
      job as unknown as JSONObject,
      {
        delayInMs: REAL_TIME_FIRST_DELAY_MS * Math.pow(2, job.attempt - 1),
        attempts: 1,
      },
    );
  }

  /*
   * A handover (getRealTimeHandoverWindow), run once the window's events,
   * late ones included, are in: DETECTION_EVALUATION_DELAY_IN_SECONDS after
   * its end, as a scheduled run reads.
   */
  public static async enqueueHandover(data: {
    projectId: ObjectID;
    ruleId: ObjectID;
    startTime: Date;
    endTime: Date;
  }): Promise<void> {
    const job: RealTimeJobData = {
      projectId: data.projectId.toString(),
      ruleId: data.ruleId.toString(),
      events: [],
      attempt: 1,
      window: {
        startTime: data.startTime.toISOString(),
        endTime: data.endTime.toISOString(),
      },
    };

    await Queue.addJob(
      QueueName.Worker,
      // The rule and the window's end: one handover for each time it starts.
      `real-time-handover-${job.ruleId}-${data.endTime.getTime()}`,
      REAL_TIME_DETECTION_JOB,
      job as unknown as JSONObject,
      {
        delayInMs:
          Math.max(
            0,
            data.endTime.getTime() - OneUptimeDate.getCurrentDate().getTime(),
          ) +
          DETECTION_EVALUATION_DELAY_IN_SECONDS * 1000,
        attempts: 1,
      },
    );
  }
}
