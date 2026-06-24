import { QueueDashboardSecret } from "../EnvironmentConfig";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import { Queue as BullQueue, Job, JobsOptions, RepeatableJob } from "bullmq";
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressRouter } from "../Utils/Express";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import Telemetry from "../Utils/Telemetry";
import type { Attributes, ObservableResult } from "@opentelemetry/api";
import Redis from "./Redis";

export enum QueueName {
  Workflow = "Workflow",
  Worker = "Worker",
  Telemetry = "Telemetry",
  Runbook = "Runbook",
}

export type QueueJob = Job;
type BullBoardQueues = Parameters<typeof createBullBoard>[0]["queues"];

export default class Queue {
  private static queueDict: Dictionary<BullQueue> = {};
  // track queues we have already run initial cleanup on
  private static cleanedQueueNames: Set<string> = new Set<string>();
  private static queueSizeMetricRegistered: boolean = false;
  // store repeatable jobs to re-add on reconnect
  private static repeatableJobs: Dictionary<
    Dictionary<{
      jobName: string;
      data: JSONObject;
      options: JobsOptions;
    }>
  > = {};

  // BullMQ rejects custom IDs containing colons, so normalize them early.
  private static sanitizeJobId(jobId: string): string {
    return jobId.replace(/:/g, "-");
  }

  private static async setupReconnectListener(
    queue: BullQueue,
    queueName: QueueName,
  ): Promise<void> {
    const client: Awaited<typeof queue.client> = await queue.client;
    client.on("ready", async () => {
      logger.debug(`Queue ${queueName} reconnected, re-adding repeatable jobs`);
      const jobs:
        | Dictionary<{
            jobName: string;
            data: JSONObject;
            options: JobsOptions;
          }>
        | undefined = Queue.repeatableJobs[queueName];
      if (jobs) {
        for (const jobId in jobs) {
          const job:
            | { jobName: string; data: JSONObject; options: JobsOptions }
            | undefined = jobs[jobId];
          if (job) {
            try {
              logger.debug(
                `Re-adding repeatable job ${job.jobName} to queue ${queueName}`,
              );
              await queue.add(job.jobName, job.data, job.options);
            } catch (err: unknown) {
              logger.error("Error re-adding repeatable job");
              logger.error(err);
            }
          }
        }
      }
    });
  }

  @CaptureSpan()
  public static getQueue(queueName: QueueName): BullQueue {
    // check if the queue is already created
    if (this.queueDict[queueName]) {
      return this.queueDict[queueName] as BullQueue;
    }

    const queue: BullQueue = new BullQueue(queueName, {
      connection: Redis.getRedisOptions(),
      // Keep BullMQ data under control to avoid Redis bloat
      defaultJobOptions: {
        // keep only recent completed/failed jobs
        removeOnComplete: { count: 500 }, // keep last 1000 completed jobs
        removeOnFail: { count: 100 }, // keep last 500 failed jobs
      },
      /*
       * Optionally cap the event stream length (supported in BullMQ >= v5)
       * This helps prevent the :events stream from growing indefinitely
       */
      streams: {
        events: { maxLen: 1000 },
      },
    });

    // save it to the dictionary
    this.queueDict[queueName] = queue;

    // Register the observable gauge once any queue exists in this process.
    this.registerQueueSizeMetric();

    // Add event listener to re-add repeatable jobs on reconnect
    this.setupReconnectListener(queue, queueName).catch((err: unknown) => {
      logger.error("Error setting up reconnect listener for queue");
      logger.error(err);
    });

    // Fire-and-forget initial cleanup for legacy/old data if not done before
    if (!this.cleanedQueueNames.has(queueName)) {
      this.cleanedQueueNames.add(queueName);
      // Clean jobs older than 1 days to reclaim memory from historic runs
      const oneDaysMs: number = 1 * 24 * 60 * 60 * 1000;
      void (async () => {
        try {
          await queue.clean(oneDaysMs, 1000, "completed");
          await queue.clean(oneDaysMs, 1000, "failed");
        } catch {
          // ignore cleanup errors to not impact normal flow
        }
      })();
    }

    return queue;
  }

  @CaptureSpan()
  public static async removeJob(
    queueName: QueueName,
    jobId: string,
  ): Promise<void> {
    if (!jobId) {
      return;
    }

    const sanitizedJobId: string = this.sanitizeJobId(jobId.toString());

    const job: Job | undefined =
      await this.getQueue(queueName).getJob(sanitizedJobId);

    if (job) {
      await job.remove();
    }

    // remove existing repeatable job
    await this.getQueue(queueName).removeRepeatableByKey(sanitizedJobId);
  }

  @CaptureSpan()
  public static getInspectorRoute(): string {
    return "/worker/inspect/queue/:dashboardSecret";
  }

  @CaptureSpan()
  public static getQueueInspectorRouter(): ExpressRouter {
    const serverAdapter: ExpressAdapter = new ExpressAdapter();

    const queueAdapters: BullMQAdapter[] = Object.values(QueueName).map(
      (queueName: QueueName) => {
        return new BullMQAdapter(this.getQueue(queueName));
      },
    );

    createBullBoard({
      // Cast keeps compatibility until bull-board widens QueueJob.progress
      queues: queueAdapters as unknown as BullBoardQueues,
      serverAdapter: serverAdapter,
    });

    serverAdapter.setBasePath(
      this.getInspectorRoute().replace(
        "/:dashboardSecret",
        "/" + QueueDashboardSecret,
      ),
    );

    return serverAdapter.getRouter();
  }

  @CaptureSpan()
  public static async addJob(
    queueName: QueueName,
    jobId: string,
    jobName: string,
    data: JSONObject,
    options?: {
      scheduleAt?: string | undefined;
      repeatableKey?: string | undefined;
      /**
       * One-off delay in milliseconds before the job becomes eligible to run.
       * Mutually exclusive with `scheduleAt` (a repeatable cron pattern); if
       * both are set, `scheduleAt` wins. Used to park a delayed job (e.g. the
       * Sleep component's durable resume).
       */
      delayInMs?: number | undefined;
      /**
       * Total number of times BullMQ runs the job before marking it
       * failed (1 = no retries). Defaults to 3 for the Telemetry queue
       * (consumers there are idempotent via insert dedup tokens) and 1
       * everywhere else, preserving prior behavior.
       */
      attempts?: number | undefined;
      /**
       * Base delay in milliseconds for exponential backoff between
       * attempts (delay * 2^attempt). Only used when attempts > 1.
       */
      backoffDelayInMs?: number | undefined;
      /**
       * Skip the getJob()+remove() round trips that guard against
       * duplicate job ids. Safe (and two Redis calls cheaper per
       * enqueue) when the caller's job ids are globally unique, e.g.
       * the telemetry enqueue path which suffixes ids with a unix-nano
       * timestamp.
       */
      skipExistenceCheck?: boolean | undefined;
    },
  ): Promise<Job> {
    const sanitizedJobId: string = this.sanitizeJobId(jobId.toString());

    const optionsObject: JobsOptions = {
      jobId: sanitizedJobId,
    };

    if (options && options.delayInMs && options.delayInMs > 0) {
      optionsObject.delay = options.delayInMs;
    }

    const attempts: number =
      options?.attempts ?? (queueName === QueueName.Telemetry ? 3 : 1);

    if (attempts > 1) {
      optionsObject.attempts = attempts;
      optionsObject.backoff = {
        type: "exponential",
        delay: options?.backoffDelayInMs ?? 5000,
      };
    }

    const queue: BullQueue = this.getQueue(queueName);

    if (options && options.scheduleAt) {
      optionsObject.repeat = {
        pattern: options.scheduleAt,
        // keep repeatable job keyed by jobId so multiple workers do not register duplicates
        jobId: sanitizedJobId,
      };

      const repeatableJobs: RepeatableJob[] = await queue.getRepeatableJobs();

      for (const repeatableJob of repeatableJobs) {
        const isSameJob: boolean =
          repeatableJob.name === jobName &&
          repeatableJob.pattern === options.scheduleAt;

        if (isSameJob) {
          await queue.removeRepeatableByKey(repeatableJob.key);
        }
      }
    }

    if (!options?.skipExistenceCheck) {
      const job: Job | undefined = await queue.getJob(sanitizedJobId);

      if (job) {
        await job.remove();
      }
    }

    if (options?.repeatableKey) {
      // remove existing repeatable job
      await queue.removeRepeatableByKey(options?.repeatableKey);
    }

    // Store repeatable jobs for re-adding on reconnect
    if (options && options.scheduleAt) {
      if (!this.repeatableJobs[queueName]) {
        this.repeatableJobs[queueName] = {};
      }
      this.repeatableJobs[queueName]![sanitizedJobId] = {
        jobName,
        data,
        options: optionsObject,
      };
    }

    const jobAdded: Job = await queue.add(jobName, data, optionsObject);

    return jobAdded;
  }

  private static registerQueueSizeMetric(): void {
    if (this.queueSizeMetricRegistered) {
      return;
    }

    if (!Telemetry.isMetricsEnabled()) {
      return;
    }

    try {
      Telemetry.getObservableGauge({
        name: "queue.size",
        description:
          "Number of BullMQ jobs in each queue, partitioned by job state.",
        unit: "1",
        callback: async (
          result: ObservableResult<Attributes>,
        ): Promise<void> => {
          for (const queueName of Object.keys(this.queueDict)) {
            try {
              const stats: {
                waiting: number;
                active: number;
                completed: number;
                failed: number;
                delayed: number;
                total: number;
              } = await this.getQueueStats(queueName as QueueName);

              const baseAttrs: Attributes = {
                "messaging.system": "bullmq",
                "messaging.destination.name": queueName,
              };

              result.observe(stats.waiting, { ...baseAttrs, state: "waiting" });
              result.observe(stats.active, { ...baseAttrs, state: "active" });
              result.observe(stats.delayed, { ...baseAttrs, state: "delayed" });
              result.observe(stats.failed, { ...baseAttrs, state: "failed" });
            } catch (err) {
              // Don't let one queue's stat failure break others.
              logger.debug("Failed to read queue stats");
              logger.debug(err);
            }
          }
        },
      });

      this.queueSizeMetricRegistered = true;
    } catch (err) {
      logger.error("Failed to register queue.size metric");
      logger.error(err);
    }
  }

  @CaptureSpan()
  public static async getQueueSize(queueName: QueueName): Promise<number> {
    const queue: BullQueue = this.getQueue(queueName);
    const waitingCount: number = await queue.getWaitingCount();
    const activeCount: number = await queue.getActiveCount();
    const delayedCount: number = await queue.getDelayedCount();

    return waitingCount + activeCount + delayedCount;
  }

  @CaptureSpan()
  public static async getQueueStats(queueName: QueueName): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  }> {
    const queue: BullQueue = this.getQueue(queueName);
    const waitingCount: number = await queue.getWaitingCount();
    const activeCount: number = await queue.getActiveCount();
    const completedCount: number = await queue.getCompletedCount();
    const failedCount: number = await queue.getFailedCount();
    const delayedCount: number = await queue.getDelayedCount();

    return {
      waiting: waitingCount,
      active: activeCount,
      completed: completedCount,
      failed: failedCount,
      delayed: delayedCount,
      total:
        waitingCount +
        activeCount +
        completedCount +
        failedCount +
        delayedCount,
    };
  }

  @CaptureSpan()
  public static async getFailedJobs(
    queueName: QueueName,
    options?: {
      start?: number;
      end?: number;
    },
  ): Promise<
    Array<{
      id: string;
      name: string;
      data: JSONObject;
      failedReason: string;
      stackTrace?: string;
      processedOn: Date | null;
      finishedOn: Date | null;
      attemptsMade: number;
    }>
  > {
    const queue: BullQueue = this.getQueue(queueName);
    const start: number = options?.start || 0;
    const end: number = options?.end || 100;
    const failed: Job[] = await queue.getFailed(start, end);

    return failed.map((job: Job) => {
      const result: {
        id: string;
        name: string;
        data: JSONObject;
        failedReason: string;
        stackTrace?: string;
        processedOn: Date | null;
        finishedOn: Date | null;
        attemptsMade: number;
      } = {
        id: job.id || "unknown",
        name: job.name || "unknown",
        data: job.data as JSONObject,
        failedReason: job.failedReason || "No reason provided",
        processedOn: job.processedOn ? new Date(job.processedOn) : null,
        finishedOn: job.finishedOn ? new Date(job.finishedOn) : null,
        attemptsMade: job.attemptsMade || 0,
      };

      if (job.stacktrace && job.stacktrace.length > 0) {
        result.stackTrace = job.stacktrace.join("\n");
      }

      return result;
    });
  }

  /**
   * Like getFailedJobs, but returns the FULL job for deep debugging: the job
   * body (data), its options, return value, progress, all the timing/attempt
   * metadata, and the per-job log lines BullMQ keeps (job.log()/getJobLogs).
   * Used by the master-admin health dashboard / support bundle. The caller is
   * responsible for redacting / size-capping before exposing this, since the
   * job body can contain customer data.
   */
  @CaptureSpan()
  public static async getFailedJobsWithDetails(
    queueName: QueueName,
    options?: {
      start?: number;
      end?: number;
    },
  ): Promise<
    Array<{
      id: string;
      name: string;
      data: JSONObject;
      opts: JSONObject;
      returnValue: unknown;
      progress: number | Record<string, unknown> | null;
      failedReason: string;
      stackTrace: Array<string>;
      logs: Array<string>;
      attemptsMade: number;
      attemptsStarted: number | null;
      stalledCounter: number | null;
      priority: number | null;
      delay: number | null;
      createdAt: Date | null;
      processedOn: Date | null;
      finishedOn: Date | null;
      queueQualifiedName: string | null;
      repeatJobKey: string | null;
      deduplicationId: string | null;
      processedBy: string | null;
      parentKey: string | null;
    }>
  > {
    const queue: BullQueue = this.getQueue(queueName);
    const start: number = options?.start || 0;
    const end: number = options?.end ?? 100;
    const failed: Job[] = await queue.getFailed(start, end);

    const results: Array<{
      id: string;
      name: string;
      data: JSONObject;
      opts: JSONObject;
      returnValue: unknown;
      progress: number | Record<string, unknown> | null;
      failedReason: string;
      stackTrace: Array<string>;
      logs: Array<string>;
      attemptsMade: number;
      attemptsStarted: number | null;
      stalledCounter: number | null;
      priority: number | null;
      delay: number | null;
      createdAt: Date | null;
      processedOn: Date | null;
      finishedOn: Date | null;
      queueQualifiedName: string | null;
      repeatJobKey: string | null;
      deduplicationId: string | null;
      processedBy: string | null;
      parentKey: string | null;
    }> = [];

    for (const job of failed) {
      // Per-job log lines are best-effort — older jobs may have none.
      let logs: Array<string> = [];

      try {
        if (job.id) {
          const jobLogs: { logs: string[]; count: number } =
            await queue.getJobLogs(job.id, 0, -1);
          logs = jobLogs?.logs || [];
        }
      } catch (err) {
        logger.debug(`Failed to read logs for job ${job.id} on ${queueName}`);
        logger.debug(err);
      }

      results.push({
        id: job.id || "unknown",
        name: job.name || "unknown",
        data: (job.data as JSONObject) || {},
        opts: (job.opts as unknown as JSONObject) || {},
        returnValue: job.returnvalue ?? null,
        progress: (job.progress as number | Record<string, unknown>) ?? null,
        failedReason: job.failedReason || "No reason provided",
        stackTrace: job.stacktrace || [],
        logs: logs,
        attemptsMade: job.attemptsMade || 0,
        attemptsStarted:
          typeof job.attemptsStarted === "number" ? job.attemptsStarted : null,
        stalledCounter:
          typeof job.stalledCounter === "number" ? job.stalledCounter : null,
        priority: typeof job.priority === "number" ? job.priority : null,
        delay: typeof job.delay === "number" ? job.delay : null,
        createdAt:
          typeof job.timestamp === "number" ? new Date(job.timestamp) : null,
        processedOn:
          typeof job.processedOn === "number"
            ? new Date(job.processedOn)
            : null,
        finishedOn:
          typeof job.finishedOn === "number" ? new Date(job.finishedOn) : null,
        queueQualifiedName: job.queueQualifiedName || null,
        repeatJobKey: job.repeatJobKey || null,
        deduplicationId: job.deduplicationId || null,
        processedBy: job.processedBy || null,
        parentKey: job.parentKey || null,
      });
    }

    return results;
  }
}
