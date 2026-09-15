import { Queue as BullQueue } from "bullmq";
import OneUptimeDate from "../../../../Types/Date";
import {
  ConnectorPlatformStatus,
  SecurityConnectorCheck,
} from "../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { ClickhouseAppInstance } from "../../../Infrastructure/ClickhouseDatabase";
import Queue, { QueueName } from "../../../Infrastructure/Queue";
import logger from "../../Logger";
import { makeCheck } from "./Types";

/*
 * What the "Test connection" checklist can say about OneUptime itself.
 *
 * The connector complaint this exists for reads "connected, but nothing is
 * ingested", and half the time the source is fine: the poll never ran
 * because no process consumes the Worker queue (DISABLE_QUEUE_WORKERS=true
 * on the app with no worker deployment), or the Workers feature set never
 * registered the scheduler. Those facts live in Redis, not in the
 * connection row, so a connection that was never polled looks exactly like
 * a healthy one that found nothing. These probes read them out.
 *
 * Every probe is best-effort and independent: an unreachable Redis makes a
 * value null ("unknown"), never a thrown error and never a fake pass.
 */

/*
 * The job names the two poll crons are registered under. Both connector
 * families' schedulers are listed so the check reads "the poll scheduler"
 * whichever family asked.
 *
 * These are the RAW names, colon included, because that is what BullMQ
 * reports. RunCron goes through Queue.addJob, which calls
 * queue.add(jobName, {}, { jobId, repeat: { pattern, jobId } }): BullMQ's
 * legacy repeatable API, not upsertJobScheduler. BullMQ 5.x
 * (Repeat.updateRepeatableJob, addRepeatableJob-2.lua) stores that
 * repeatable under an md5 of "name:jobId:endDate:tz:pattern" and writes
 * only `name` and `pattern` into its metadata hash, so getJobSchedulers()
 * lists it as { key: "<md5>", name: "SecurityEvents:Poll...", next,
 * pattern } with no `id`. Matching the sanitized "SecurityEvents-Poll..."
 * id against `id` therefore failed the scheduler check on every healthy
 * install (review finding scheduler-check-always-fails).
 */
export const CONNECTOR_SCHEDULER_JOB_NAMES: Array<string> = [
  "SecurityEvents:PollGoogleSecOpsConnections",
  "SecurityEvents:PollSecurityEventConnections",
];

// Two scheduler ticks of grace before a poll counts as overdue.
export const CONNECTOR_OVERDUE_GRACE_IN_MS: number = 2 * 60 * 1000;

export interface ConnectorScheduleFacts {
  isEnabled: boolean;
  pollIntervalInMinutes: number;
  createdAt?: Date | undefined;
  lastPolledAt?: Date | undefined;
  lastSuccessfulPollAt?: Date | undefined;
  lastEventIngestedAt?: Date | undefined;
  lastError?: string | undefined;
  // The oldest run still queued or running, when one exists.
  pendingRunCreatedAt?: Date | undefined;
}

/*
 * The fields of BullMQ's JobSchedulerJson this probe reads. Optional and
 * loosely typed on purpose: the value comes out of Redis, and
 * getJobSchedulers() maps a repeat key whose metadata hash is gone to
 * undefined instead of dropping it, so an entry may be missing entirely.
 */
export interface ConnectorSchedulerEntry {
  key?: string | undefined;
  name?: string | undefined;
  next?: number | null | undefined;
}

/*
 * The optional accessors may be absent or present-but-undefined: the probes
 * only call what `typeof` reports as a function, and a queue missing one
 * leaves that value unknown.
 */
interface QueueLike {
  getWorkersCount?: (() => Promise<number>) | undefined;
  getWorkers?: (() => Promise<Array<unknown>>) | undefined;
  getJobSchedulers?:
    | ((
        start?: number,
        end?: number,
        asc?: boolean,
      ) => Promise<Array<ConnectorSchedulerEntry | null | undefined>>)
    | undefined;
  getWaitingCount: () => Promise<number>;
  getFailedCount: () => Promise<number>;
}

export default class ConnectorPlatformHealth {
  public static async getPlatformStatus(data?: {
    queueOverride?: QueueLike | undefined;
    storageProbeOverride?: (() => Promise<boolean>) | undefined;
  }): Promise<ConnectorPlatformStatus> {
    const status: ConnectorPlatformStatus = {
      workerConsumers: null,
      schedulerRegistered: null,
      queueWaiting: null,
      queueFailed: null,
      storageReachable: null,
    };

    let queue: QueueLike | null = null;

    try {
      queue =
        data?.queueOverride ||
        (Queue.getQueue(QueueName.Worker) as unknown as QueueLike);
    } catch (error) {
      logger.error(
        "ConnectorPlatformHealth: the Worker queue could not be opened.",
      );
      logger.error(error);
    }

    if (queue) {
      status.workerConsumers = await this.probeWorkerCount(queue);

      try {
        if (typeof queue.getJobSchedulers === "function") {
          const schedulers: Array<ConnectorSchedulerEntry | null | undefined> =
            await queue.getJobSchedulers(0, 1000, true);
          const matches: Array<ConnectorSchedulerEntry> = [];

          for (const scheduler of schedulers) {
            if (scheduler && this.isConnectorScheduler(scheduler)) {
              matches.push(scheduler);
            }
          }

          status.schedulerRegistered = matches.length > 0;
          const nextRuns: Array<number> = matches
            .map((scheduler: ConnectorSchedulerEntry): number => {
              return typeof scheduler.next === "number" &&
                Number.isFinite(scheduler.next)
                ? scheduler.next
                : 0;
            })
            .filter((value: number): boolean => {
              return value > 0;
            });
          if (nextRuns.length > 0) {
            status.schedulerNextRunAt = new Date(
              Math.min(...nextRuns),
            ).toISOString();
          }
        }
      } catch (error) {
        logger.error("ConnectorPlatformHealth: scheduler probe failed.");
        logger.error(error);
      }

      try {
        status.queueWaiting = await queue.getWaitingCount();
      } catch (error) {
        logger.error("ConnectorPlatformHealth: waiting count probe failed.");
        logger.error(error);
      }

      try {
        status.queueFailed = await queue.getFailedCount();
      } catch (error) {
        logger.error("ConnectorPlatformHealth: failed count probe failed.");
        logger.error(error);
      }
    }

    try {
      status.storageReachable = data?.storageProbeOverride
        ? await data.storageProbeOverride()
        : await ClickhouseAppInstance.checkConnnectionStatus();
    } catch (error) {
      logger.error("ConnectorPlatformHealth: storage probe failed.");
      logger.error(error);
      status.storageReachable = false;
    }

    return status;
  }

  /*
   * Whether one getJobSchedulers() entry is a connector poll cron. `name`
   * is the match for every registration BullMQ can describe (see
   * CONNECTOR_SCHEDULER_JOB_NAMES). The key prefix covers the one shape
   * where the name cannot be read back: a repeatable still kept under a
   * pre-md5 concatenated key ("name:jobId:endDate:tz:pattern") whose
   * metadata hash is gone. BullMQ then rebuilds the entry by splitting the
   * key on ":", which cuts "SecurityEvents:Poll..." in half and reports the
   * name as "SecurityEvents", but the key still starts with the full name.
   */
  public static isConnectorScheduler(
    scheduler: ConnectorSchedulerEntry,
  ): boolean {
    const name: string =
      typeof scheduler.name === "string" ? scheduler.name : "";
    const key: string = typeof scheduler.key === "string" ? scheduler.key : "";

    return CONNECTOR_SCHEDULER_JOB_NAMES.some((jobName: string): boolean => {
      return name === jobName || key.startsWith(`${jobName}:`);
    });
  }

  private static async probeWorkerCount(
    queue: QueueLike,
  ): Promise<number | null> {
    try {
      if (typeof queue.getWorkersCount === "function") {
        return await queue.getWorkersCount();
      }

      if (typeof queue.getWorkers === "function") {
        return (await queue.getWorkers()).length;
      }
    } catch (error) {
      logger.error("ConnectorPlatformHealth: worker count probe failed.");
      logger.error(error);
    }

    return null;
  }

  /*
   * Deployment-level checks. The same three for every connection.
   */
  public static toPlatformChecks(
    status: ConnectorPlatformStatus,
  ): Array<SecurityConnectorCheck> {
    const startedAtMs: number = Date.now();
    const checks: Array<SecurityConnectorCheck> = [];

    if (status.workerConsumers === null) {
      checks.push(
        makeCheck({
          key: "worker-consumers",
          name: "Background workers",
          status: "warn",
          startedAtMs,
          message:
            "Could not determine how many processes consume the Worker queue.",
          remediation:
            "Check that Redis is reachable from the API and worker processes.",
        }),
      );
    } else if (status.workerConsumers === 0) {
      checks.push(
        makeCheck({
          key: "worker-consumers",
          name: "Background workers",
          status: "fail",
          startedAtMs,
          message:
            "No process is consuming the Worker queue, so scheduled polls, on-demand runs and imports never execute.",
          remediation:
            "Set DISABLE_QUEUE_WORKERS=false on the app (the config.example.env default) or run the dedicated worker deployment (Helm: worker.enabled: true). A connection test from this page does not need a worker, which is why it can report this while polling stays silent.",
          details: { workerConsumers: 0 },
        }),
      );
    } else {
      checks.push(
        makeCheck({
          key: "worker-consumers",
          name: "Background workers",
          status: "pass",
          startedAtMs,
          message: `${status.workerConsumers} process${status.workerConsumers === 1 ? "" : "es"} consuming the Worker queue.`,
          details: {
            workerConsumers: status.workerConsumers,
            ...(status.queueWaiting !== null
              ? { queueWaiting: status.queueWaiting }
              : {}),
            ...(status.queueFailed !== null
              ? { queueFailed: status.queueFailed }
              : {}),
          },
        }),
      );
    }

    if (status.schedulerRegistered === null) {
      checks.push(
        makeCheck({
          key: "scheduler",
          name: "Poll scheduler",
          status: "warn",
          startedAtMs,
          message: "Could not read the scheduler registration from the queue.",
          remediation:
            "Check that Redis is reachable and that the Workers feature set started without errors.",
        }),
      );
    } else if (!status.schedulerRegistered) {
      checks.push(
        makeCheck({
          key: "scheduler",
          name: "Poll scheduler",
          status: "fail",
          startedAtMs,
          message:
            "The minute-cadence poll scheduler is not registered, so no connection is ever enqueued for polling.",
          remediation:
            "The Workers feature set registers the scheduler when a process boots. Restart the app or worker and check its startup logs for Workers errors.",
        }),
      );
    } else {
      checks.push(
        makeCheck({
          key: "scheduler",
          name: "Poll scheduler",
          status: "pass",
          startedAtMs,
          message: status.schedulerNextRunAt
            ? `Registered; next tick at ${status.schedulerNextRunAt}.`
            : "Registered.",
          ...(status.schedulerNextRunAt
            ? { details: { nextRunAt: status.schedulerNextRunAt } }
            : {}),
        }),
      );
    }

    if (status.storageReachable === null) {
      checks.push(
        makeCheck({
          key: "storage",
          name: "Security event storage",
          status: "warn",
          startedAtMs,
          message: "Could not probe the analytics database.",
        }),
      );
    } else if (!status.storageReachable) {
      checks.push(
        makeCheck({
          key: "storage",
          name: "Security event storage",
          status: "fail",
          startedAtMs,
          message:
            "The analytics database that stores security events did not answer, so imported records cannot be written.",
          remediation:
            "Check ClickHouse health and the CLICKHOUSE_* connection settings on the API and worker processes.",
        }),
      );
    } else {
      checks.push(
        makeCheck({
          key: "storage",
          name: "Security event storage",
          status: "pass",
          startedAtMs,
          message: "The analytics database answered.",
        }),
      );
    }

    return checks;
  }

  /*
   * The connection's own schedule, read off its row. Only meaningful for a
   * saved connection; the unsaved-settings test skips it.
   */
  public static toScheduleCheck(
    facts: ConnectorScheduleFacts,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): SecurityConnectorCheck {
    const startedAtMs: number = Date.now();
    const intervalMs: number =
      Math.max(1, facts.pollIntervalInMinutes || 5) * 60 * 1000;

    if (!facts.isEnabled) {
      return makeCheck({
        key: "connection-schedule",
        name: "Scheduled polling",
        status: "warn",
        startedAtMs,
        message:
          "Scheduled polling is disabled for this connection, so nothing is imported automatically.",
        remediation:
          "Enable the connection to poll on its interval. On-demand runs and imports still work while it is disabled.",
      });
    }

    if (
      facts.pendingRunCreatedAt &&
      now.getTime() - facts.pendingRunCreatedAt.getTime() >
        CONNECTOR_OVERDUE_GRACE_IN_MS
    ) {
      return makeCheck({
        key: "connection-schedule",
        name: "Scheduled polling",
        status: "fail",
        startedAtMs,
        message: `A run has been queued since ${facts.pendingRunCreatedAt.toISOString()} and no worker has picked it up. New polls are blocked until it finishes or expires (20 minutes).`,
        remediation:
          "Fix the background workers (see the Background workers check). The stale run expires on its own and polling resumes.",
      });
    }

    if (!facts.lastPolledAt) {
      const ageMs: number = facts.createdAt
        ? now.getTime() - facts.createdAt.getTime()
        : 0;

      if (ageMs > CONNECTOR_OVERDUE_GRACE_IN_MS) {
        return makeCheck({
          key: "connection-schedule",
          name: "Scheduled polling",
          status: "fail",
          startedAtMs,
          message: `This connection was created ${Math.round(ageMs / 60000)} minutes ago and has never been polled.`,
          remediation:
            "Polling is driven by the background workers and the poll scheduler; see those checks. If both pass, use Run now to trigger a poll and read its run history.",
        });
      }

      return makeCheck({
        key: "connection-schedule",
        name: "Scheduled polling",
        status: "pass",
        startedAtMs,
        message:
          "Not polled yet; the first scheduled poll runs within the next scheduler tick.",
      });
    }

    const dueAtMs: number = facts.lastPolledAt.getTime() + intervalMs;

    if (now.getTime() > dueAtMs + CONNECTOR_OVERDUE_GRACE_IN_MS) {
      return makeCheck({
        key: "connection-schedule",
        name: "Scheduled polling",
        status: "fail",
        startedAtMs,
        message: `The last poll attempt was at ${facts.lastPolledAt.toISOString()}, which is later than the ${facts.pollIntervalInMinutes} minute interval allows.`,
        remediation:
          "Polls are overdue. Check the Background workers and Poll scheduler checks, then the worker logs.",
        details: {
          lastPolledAt: facts.lastPolledAt.toISOString(),
          intervalMinutes: facts.pollIntervalInMinutes,
        },
      });
    }

    if (facts.lastError) {
      return makeCheck({
        key: "connection-schedule",
        name: "Scheduled polling",
        status: "fail",
        startedAtMs,
        message: `The last poll attempt failed: ${facts.lastError}`,
        remediation:
          "Read the error prefix to see which step failed. The checks above exercise the same steps live.",
        details: {
          lastPolledAt: facts.lastPolledAt.toISOString(),
          ...(facts.lastSuccessfulPollAt
            ? { lastSuccessfulPollAt: facts.lastSuccessfulPollAt.toISOString() }
            : {}),
        },
      });
    }

    return makeCheck({
      key: "connection-schedule",
      name: "Scheduled polling",
      status: "pass",
      startedAtMs,
      message: facts.lastEventIngestedAt
        ? `Polling on schedule; last poll ${facts.lastPolledAt.toISOString()}, last event imported ${facts.lastEventIngestedAt.toISOString()}.`
        : `Polling on schedule; last poll ${facts.lastPolledAt.toISOString()}. No event has been imported yet, which is expected while the source creates none.`,
      details: {
        lastPolledAt: facts.lastPolledAt.toISOString(),
        ...(facts.lastSuccessfulPollAt
          ? { lastSuccessfulPollAt: facts.lastSuccessfulPollAt.toISOString() }
          : {}),
        ...(facts.lastEventIngestedAt
          ? { lastEventIngestedAt: facts.lastEventIngestedAt.toISOString() }
          : {}),
      },
    });
  }

  /*
   * Exported for tests that hand-build a queue: the real BullMQ class is
   * only referenced for its type.
   */
  public static isQueueLike(value: unknown): value is BullQueue {
    return Boolean(value) && typeof value === "object";
  }
}
