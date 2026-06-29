import { QueueJob, QueueName } from "./Queue";
import TimeoutException from "../../Types/Exception/TimeoutException";
import {
  PromiseRejectErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "../../Types/FunctionTypes";
import { Worker } from "bullmq";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AppMetrics from "../Utils/Telemetry/AppMetrics";
import TelemetryContext from "../Utils/Telemetry/TelemetryContext";
import Telemetry, {
  Span,
  SpanException,
  SpanStatusCode,
} from "../Utils/Telemetry";
import Redis from "./Redis";
import GracefulShutdown, { ShutdownPriority } from "../Utils/GracefulShutdown";

export default class QueueWorker {
  @CaptureSpan()
  public static getWorker(
    queueName: QueueName,
    onJobInQueue: (job: QueueJob) => Promise<void>,
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
    const instrumentedJobHandler: (job: QueueJob) => Promise<void> = async (
      job: QueueJob,
    ): Promise<void> => {
      const startNs: bigint = process.hrtime.bigint();
      const baseAttributes: Record<string, string> = {
        "messaging.system": "bullmq",
        "messaging.destination.name": queueName,
        "messaging.operation.name": job.name || "unknown",
      };

      AppMetrics.getWorkerJobsInFlight().add(1, baseAttributes);

      let outcome: "success" | "failure" | "timeout" = "success";

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
            ...TelemetryContext.pickKnownAttributes(job.data),
          },
          () => {
            /*
             * Wrap the job in an explicit root span so every background job has
             * a consistent, named trace root that carries the seeded context —
             * the @CaptureSpan service calls it makes become children of this.
             */
            return Telemetry.startActiveSpan<Promise<void>>({
              name: `worker.job ${queueName}/${job.name || "unknown"}`,
              fn: async (span: Span): Promise<void> => {
                try {
                  await onJobInQueue(job);
                  span.setStatus({ code: SpanStatusCode.OK });
                } catch (err) {
                  span.recordException(err as SpanException);
                  span.setStatus({ code: SpanStatusCode.ERROR });
                  throw err;
                } finally {
                  span.end();
                }
              },
            });
          },
        );
      } catch (err) {
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

    const worker: Worker = new Worker(queueName, instrumentedJobHandler, {
      connection: Redis.getRedisOptions(),
      concurrency: options.concurrency,
      // Only set these values if provided so we do not override BullMQ defaults
      ...(options.lockDuration ? { lockDuration: options.lockDuration } : {}),
      ...(options.maxStalledCount !== undefined
        ? { maxStalledCount: options.maxStalledCount }
        : {}),
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

    return worker;
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

  @CaptureSpan()
  public static async runJobWithTimeout(
    timeoutInMS: number,
    jobCallback: PromiseVoidFunction,
  ): Promise<void> {
    type TimeoutPromise = (ms: number) => Promise<void>;

    const timeoutPromise: TimeoutPromise = (ms: number): Promise<void> => {
      return new Promise(
        (_resolve: VoidFunction, reject: PromiseRejectErrorFunction) => {
          setTimeout(() => {
            return reject(new TimeoutException("Job Timeout"));
          }, ms);
        },
      );
    };

    return await Promise.race([timeoutPromise(timeoutInMS), jobCallback()]);
  }
}
