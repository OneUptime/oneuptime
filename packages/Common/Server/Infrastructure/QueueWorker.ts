import { QueueJob, QueueName } from "./Queue";
import QueueJobConnections from "./Postgres/QueueJobConnections";
import TimeoutException from "../../Types/Exception/TimeoutException";
import JobDeadline from "../Utils/JobDeadline";
import { Worker } from "bullmq";
import { Link, ROOT_CONTEXT, context } from "@opentelemetry/api";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import QueueJobTraceContext from "../Utils/Telemetry/QueueJobTraceContext";
import AppMetrics from "../Utils/Telemetry/AppMetrics";
import TelemetryContext from "../Utils/Telemetry/TelemetryContext";
import {
  COMPONENT_ATTRIBUTE_KEY,
  TelemetryComponent,
  UNIT_OF_WORK_ATTRIBUTE_KEY,
  UnitOfWork,
} from "../../Types/Telemetry/UnitOfWork";
import Telemetry, { Span, SpanStatusCode } from "../Utils/Telemetry";
import Redis from "./Redis";
import GracefulShutdown, { ShutdownPriority } from "../Utils/GracefulShutdown";
import logger from "../Utils/Logger";

/*
 * A QUEUE WORKER TAKES NO JOB UNTIL ITS PROCESS HAS STARTED.
 *
 * A worker built by getWorker() does not take jobs from its queue when it is
 * built. It waits for startProcessingJobs(), which the process calls once it
 * is connected to every datastore its jobs use and has started
 * (App/Index.ts, where it opens the StartupGate). A worker built after that
 * starts at once.
 *
 * Some workers are built when their module is imported - the telemetry
 * worker (ProcessTelemetry) - and their process then takes a while before it
 * can run a job: it waits for the migrate Job to apply the schema migrations
 * its code needs (up to DATABASE_MIGRATION_WAIT_TIMEOUT_MS), and only then
 * connects to Valkey and ClickHouse. A worker that took jobs meanwhile
 * failed every one of them ("Database not connected", "Redis not
 * connected") at its full concurrency, as fast as it could take them, and
 * after three attempts each was dropped. In one rollout a migration that
 * could not finish held the new worker pods at that wait for hours, and
 * they threw away the probes' results - and the logs, metrics and traces -
 * that the older pods, still running, would have recorded.
 */
interface WorkerWaitingToStart {
  queueName: QueueName;
  worker: Worker;
}

export default class QueueWorker {
  private static jobsMayBeProcessed: boolean = false;
  private static workersWaitingToStart: Array<WorkerWaitingToStart> = [];

  /*
   * From now on the queue workers take jobs: those built so far start, and
   * every one built later starts as it is built. Called once the process is
   * connected to its datastores and started; calling it again does nothing.
   */
  public static startProcessingJobs(): void {
    if (QueueWorker.jobsMayBeProcessed) {
      return;
    }

    QueueWorker.jobsMayBeProcessed = true;

    const waiting: Array<WorkerWaitingToStart> =
      QueueWorker.workersWaitingToStart;

    QueueWorker.workersWaitingToStart = [];

    for (const entry of waiting) {
      QueueWorker.runWorker(entry.worker);
    }

    if (waiting.length > 0) {
      logger.info(
        `Queue workers now take jobs: ${waiting
          .map((entry: WorkerWaitingToStart) => {
            return entry.queueName;
          })
          .join(", ")}.`,
      );
    }
  }

  // Whether startProcessingJobs() has been called.
  public static isProcessingJobs(): boolean {
    return QueueWorker.jobsMayBeProcessed;
  }

  /*
   * The queues of the workers still waiting for startProcessingJobs(), in
   * the order they were built.
   */
  public static getQueuesWaitingToStart(): Array<QueueName> {
    return QueueWorker.workersWaitingToStart.map(
      (entry: WorkerWaitingToStart) => {
        return entry.queueName;
      },
    );
  }

  /*
   * Starts a worker's fetch loop, as BullMQ's own autorun would - outside
   * every span (see getWorker), and with a failure to run reported as the
   * worker's "error" event.
   */
  private static runWorker(worker: Worker): void {
    context.with(ROOT_CONTEXT, () => {
      worker.run().catch((error: Error) => {
        worker.emit("error", error);
      });
    });
  }

  @CaptureSpan()
  public static getWorker(
    queueName: QueueName,
    /*
     * `token` is the lock this worker holds on the job, which moving the job
     * back to its queue needs (UnknownQueueJob.handBack).
     */
    onJobInQueue: (job: QueueJob, token?: string) => Promise<void>,
    options: {
      concurrency: number;
      /**
       * How long (in ms) the worker will hold a lock on the job before it's considered stalled
       * if the event loop is blocked and the lock cannot be extended in time.
       * Defaults to BullMQ default (30s) if not provided.
       */
      lockDuration?: number;
      /**
       * Maximum number of times a job can be re-processed due to stall detection
       * before being moved to failed. Defaults to BullMQ default (1) if not provided.
       */
      maxStalledCount?: number;
    },
  ): Worker {
    const instrumentedJobHandler: (
      job: QueueJob,
      token?: string,
    ) => Promise<void> = async (
      job: QueueJob,
      token?: string,
    ): Promise<void> => {
      const startNs: bigint = process.hrtime.bigint();
      const baseAttributes: Record<string, string> = {
        "messaging.system": "bullmq",
        "messaging.destination.name": queueName,
        "messaging.operation.name": job.name || "unknown",
      };

      AppMetrics.getWorkerJobsInFlight().add(1, baseAttributes);

      /*
       * The span that enqueued the job, taken out of its data before the
       * handler sees it. The job's root span links to it (see
       * QueueJobTraceContext for why a link, not a parent).
       */
      const enqueuedBy: Link | null = QueueJobTraceContext.takeFromJobData(
        job.data,
      );

      let outcome: "success" | "failure" | "timeout" | "delayed" = "success";

      try {
        /*
         * Seed a telemetry-context scope for this job so every span and log it
         * produces inherits the queue/job name plus any tenant identifiers
         * carried in the job payload (projectId, monitorId, incidentId, ...).
         */
        await TelemetryContext.runWithContext(
          {
            queueName: queueName,
            jobName: job.name || "unknown",
            /*
             * Set EXPLICITLY, never inherited. A job enqueued from inside an
             * HTTP request would otherwise inherit that request's
             * "http-request" marker, and ErrorClassResolver would then trust a
             * user-error classification for work that has no client behind it.
             */
            [UNIT_OF_WORK_ATTRIBUTE_KEY]: UnitOfWork.WorkerJob,
            [COMPONENT_ATTRIBUTE_KEY]: TelemetryComponent.Worker,
            ...TelemetryContext.pickKnownAttributes(job.data),
          },
          () => {
            /*
             * Wrap the job in an explicit root span so every background job has
             * a consistent, named trace root that carries the seeded context —
             * the @CaptureSpan service calls it makes become children of this.
             *
             * `root: true` makes it a new trace whatever context the job
             * handler happens to run in. Without it the job joined the trace
             * of whatever span was active when the worker was built (see
             * below): every job the worker ran, for the life of the process,
             * became one endless trace.
             */
            return Telemetry.startActiveSpan<Promise<void>>({
              name: `worker.job ${queueName}/${job.name || "unknown"}`,
              options: {
                root: true,
                ...(enqueuedBy ? { links: [enqueuedBy] } : {}),
              },
              fn: async (span: Span): Promise<void> => {
                try {
                  /*
                   * As a job of this queue: the Postgres connections it
                   * borrows count against the queue jobs' share of the
                   * pool, so requests always have the rest
                   * (Postgres/QueueJobConnections).
                   */
                  await QueueJobConnections.runAsQueueJob(
                    queueName,
                    (): Promise<void> => {
                      return onJobInQueue(job, token);
                    },
                  );
                  span.setStatus({ code: SpanStatusCode.OK });
                } catch (err) {
                  if (QueueWorker.isMovedBackToQueue(err)) {
                    // Not a failure: the job waits in its queue again.
                    span.setStatus({ code: SpanStatusCode.OK });
                    throw err;
                  }

                  /*
                   * Route through the normalizer rather than calling
                   * span.recordException directly. Two reasons, both real:
                   *
                   * 1. The SDK reads `exception.code` before `exception.name`,
                   *    and every OneUptime ExceptionCode IS an HTTP status, so
                   *    the raw call typed every failed job's event "400" /
                   *    "422" — collapsing unrelated failures into a handful of
                   *    meaningless Issue groups.
                   * 2. This is the one exception-producing site the ingest
                   *    drop filter cannot reach, because the raw call set no
                   *    span attributes for a filter to match on.
                   *
                   * Because worker jobs run under unit_of_work="worker-job", a
                   * user-error class escaping a job is promoted back to
                   * code-fault — worker BUGS get louder while tenant-config
                   * noise gets quieter, which is the correct direction.
                   */
                  Telemetry.recordExceptionOnSpan({
                    span,
                    exception: err,
                  });
                  throw err;
                } finally {
                  Telemetry.endSpan(span);
                }
              },
            });
          },
        );
      } catch (err) {
        if (QueueWorker.isMovedBackToQueue(err)) {
          /*
           * Rethrown as it is: BullMQ leaves a job that throws DelayedError
           * where the handler moved it, and neither fails nor completes it.
           */
          outcome = "delayed";
          throw err;
        }

        outcome =
          err instanceof TimeoutException ||
          (err as { name?: string })?.name === "TimeoutException"
            ? "timeout"
            : "failure";
        throw QueueWorker.toReportableError(
          err,
          `${queueName}/${job.name || "unknown"} (job ${job.id ?? "unknown"})`,
        );
      } finally {
        const elapsedNs: bigint = process.hrtime.bigint() - startNs;
        const durationMs: number = Number(elapsedNs) / 1e6;
        const attributes: Record<string, string> = {
          ...baseAttributes,
          outcome,
        };

        AppMetrics.getWorkerJobCounter().add(1, attributes);
        AppMetrics.getWorkerJobDuration().record(durationMs, attributes);
        AppMetrics.getWorkerJobsInFlight().add(-1, baseAttributes);
      }
    };

    /*
     * Built, and run (runWorker), outside every span. The fetch loop BullMQ
     * starts - every job handler call, every "failed" listener and the log
     * lines they write - runs in the context it was started in for the life
     * of the process. That context held this method's own span (and a
     * caller's, when one starts a worker), so every job used to join the
     * trace of a span that ended at startup.
     */
    const worker: Worker = context.with(ROOT_CONTEXT, () => {
      return new Worker(queueName, instrumentedJobHandler, {
        connection: Redis.getRedisOptions(),
        concurrency: options.concurrency,
        // Started by runWorker, never by the constructor (see the top).
        autorun: false,
        // Only set these values if provided so we do not override BullMQ defaults
        ...(options.lockDuration ? { lockDuration: options.lockDuration } : {}),
        ...(options.maxStalledCount !== undefined
          ? { maxStalledCount: options.maxStalledCount }
          : {}),
      });
    });

    /*
     * Always log job failures to the container log, independent of telemetry
     * configuration. Error visibility used to ride on @CaptureSpan's
     * exception path, but the decorator is a passthrough when no span
     * exporter is installed — without this listener a job that throws on
     * such a deployment lands in the Redis failed set with no log line.
     */
    worker.on("failed", (job: QueueJob | undefined, error: Error) => {
      logger.error(
        `Queue job failed: ${queueName}/${job?.name || "unknown"} (job ${
          job?.id ?? "unknown"
        })`,
      );
      logger.error(error);
    });

    /*
     * Stop pulling new jobs and let in-flight ones finish on shutdown. Runs in
     * the Workers tier — before datastores are drained — so jobs mid-flight can
     * still reach Postgres / Redis. Replaces a SIGINT-only handler that never
     * fired in containers (Kubernetes / docker stop send SIGTERM).
     */
    GracefulShutdown.registerHandler(
      `QueueWorker:${queueName}`,
      ShutdownPriority.Workers,
      () => {
        return worker.close();
      },
    );

    if (QueueWorker.jobsMayBeProcessed) {
      QueueWorker.runWorker(worker);
    } else {
      QueueWorker.workersWaitingToStart.push({
        queueName: queueName,
        worker: worker,
      });
    }

    return worker;
  }

  /*
   * Whether a job handler moved its job back to the queue (job.moveToDelayed)
   * and threw BullMQ's DelayedError to say so, as UnknownQueueJob.handBack
   * does. Matched by name, as BullMQ itself also matches it.
   */
  public static isMovedBackToQueue(err: unknown): boolean {
    return (err as { name?: unknown })?.name === "DelayedError";
  }

  private static toReportableError(err: unknown, context: string): unknown {
    const messageIsUseful: (value: unknown) => boolean = (
      value: unknown,
    ): boolean => {
      const message: unknown = (value as { message?: unknown })?.message;
      if (typeof message !== "string") {
        return false;
      }

      const normalized: string = message.trim().toLowerCase();
      return (
        normalized.length > 0 &&
        normalized !== "null" &&
        normalized !== "undefined"
      );
    };

    if (err instanceof Error && messageIsUseful(err)) {
      return err;
    }

    const detailParts: Array<string> = [];

    const name: unknown = (err as { name?: unknown })?.name;
    if (typeof name === "string" && name && name !== "Error") {
      detailParts.push(name);
    }

    const rawMessage: unknown = (err as { message?: unknown })?.message;
    if (typeof rawMessage === "string" && rawMessage.trim()) {
      detailParts.push(rawMessage.trim());
    }

    if (detailParts.length === 0) {
      let serialized: string;
      try {
        serialized =
          typeof err === "object" && err !== null
            ? JSON.stringify(err)
            : String(err);
      } catch {
        serialized = Object.prototype.toString.call(err);
      }

      detailParts.push(
        serialized && serialized !== "{}" ? serialized : String(err),
      );
    }

    const reportable: Error = new Error(
      `${context} failed with a non-descriptive error (original message was empty/null). Detail: ${detailParts.join(
        ": ",
      )}`,
    );

    const originalStack: unknown = (err as { stack?: unknown })?.stack;
    if (typeof originalStack === "string" && originalStack) {
      reportable.stack = originalStack;
    }

    return reportable;
  }

  /*
   * Runs a job with a time limit. Once the limit runs out the job is failed
   * with a TimeoutException AND its deadline passes: the job is handed that
   * deadline (JobDeadline), so its own loops stop at their next check
   * instead of going on beside the job's next run. Nothing cuts off work
   * already in flight - a job that never checks its deadline runs on as
   * before, only failed.
   */
  @CaptureSpan()
  public static async runJobWithTimeout(
    timeoutInMS: number,
    jobCallback: (deadline: JobDeadline) => Promise<void>,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const deadline: JobDeadline = new JobDeadline({
      endsAt: new Date(Date.now() + Math.max(0, timeoutInMS)),
    });

    try {
      const timeoutPromise: Promise<void> = new Promise<void>(
        (_resolve: () => void, reject: (reason: Error) => void) => {
          timeout = setTimeout(() => {
            const timedOut: TimeoutException = new TimeoutException(
              "Job Timeout",
            );

            deadline.end(timedOut);
            reject(timedOut);
          }, timeoutInMS);
        },
      );

      await Promise.race([timeoutPromise, jobCallback(deadline)]);
    } finally {
      /*
       * A settled job no longer needs its deadline. Leaving this timer alive
       * retains its async context until the timeout and schedules needless
       * callbacks for every completed job. This also covers synchronous throws
       * from jobCallback.
       */
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
