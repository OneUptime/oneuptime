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
}

export type QueueJob = Job;

export default class Queue {
  private static queueDict: Dictionary<BullQueue> = {};

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
    });

    // save it to the dictionary
    this.queueDict[queueName] = queue;

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
}
