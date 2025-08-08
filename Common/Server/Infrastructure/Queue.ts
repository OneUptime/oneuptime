import {
  ClusterKey,
  RedisHostname,
  RedisPassword,
  RedisPort,
} from "../EnvironmentConfig";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import { Queue as BullQueue, Job, JobsOptions } from "bullmq";
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressRouter } from "../Utils/Express";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export enum QueueName {
  Workflow = "Workflow",
  Worker = "Worker",
  Telemetry = "Telemetry",
  FluentIngest = "FluentIngest",
  IncomingRequestIngest = "IncomingRequestIngest",
  ServerMonitorIngest = "ServerMonitorIngest",
  ProbeIngest = "ProbeIngest",
}

export type QueueJob = Job;

export default class Queue {
  private static queueDict: Dictionary<BullQueue> = {};
  // track queues we have already run initial cleanup on
  private static cleanedQueueNames: Set<string> = new Set<string>();

  @CaptureSpan()
  public static getQueue(queueName: QueueName): BullQueue {
    // check if the queue is already created
    if (this.queueDict[queueName]) {
      return this.queueDict[queueName] as BullQueue;
    }

    const queue: BullQueue = new BullQueue(queueName, {
      connection: {
        host: RedisHostname.toString(),
        port: RedisPort.toNumber(),
        password: RedisPassword,
      },
      // Keep BullMQ data under control to avoid Redis bloat
      defaultJobOptions: {
        // keep only recent completed/failed jobs
        removeOnComplete: { count: 500 }, // keep last 1000 completed jobs
        removeOnFail: { count: 100 }, // keep last 500 failed jobs
      },
      // Optionally cap the event stream length (supported in BullMQ >= v5)
      // This helps prevent the :events stream from growing indefinitely
      streams: {
        events: { maxLen: 1000 },
      },
    });

    // save it to the dictionary
    this.queueDict[queueName] = queue;

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

    const job: Job | undefined = await this.getQueue(queueName).getJob(jobId);

    if (job) {
      await job.remove();
    }

    // remove existing repeatable job
    await this.getQueue(queueName).removeRepeatableByKey(jobId);
  }

  @CaptureSpan()
  public static getInspectorRoute(): string {
    return "/worker/inspect/queue/:clusterKey";
  }

  @CaptureSpan()
  public static getQueueInspectorRouter(): ExpressRouter {
    const serverAdapter: ExpressAdapter = new ExpressAdapter();

    createBullBoard({
      queues: [
        ...Object.values(QueueName).map((queueName: QueueName) => {
          return new BullMQAdapter(this.getQueue(queueName));
        }),
      ],
      serverAdapter: serverAdapter,
    });

    serverAdapter.setBasePath(
      this.getInspectorRoute().replace(
        "/:clusterKey",
        "/" + ClusterKey.toString(),
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
    },
  ): Promise<Job> {
    const optionsObject: JobsOptions = {
      jobId: jobId.toString(),
    };

    if (options && options.scheduleAt) {
      optionsObject.repeat = {
        pattern: options.scheduleAt,
      };
    }

    const job: Job | undefined = await this.getQueue(queueName).getJob(jobId);

    if (job) {
      await job.remove();
    }

    if (options?.repeatableKey) {
      // remove existing repeatable job
      await this.getQueue(queueName).removeRepeatableByKey(
        options?.repeatableKey,
      );
    }

    const jobAdded: Job = await this.getQueue(queueName).add(
      jobName,
      data,
      optionsObject,
    );

    return jobAdded;
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
}
