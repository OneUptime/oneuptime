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
import Redis from "./Redis";

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
        await onJobInQueue(job);
      } catch (err) {
        outcome =
          err instanceof TimeoutException ||
          (err as { name?: string })?.name === "TimeoutException"
            ? "timeout"
            : "failure";
        throw err;
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

    process.on("SIGINT", async () => {
      await worker.close();
    });

    return worker;
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
