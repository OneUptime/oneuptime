import {
  ClusterKey,
  RedisHostname,
  RedisPassword,
  RedisPort,
} from "../EnvironmentConfig";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { Queue as BullQueue, Job, JobsOptions } from "bullmq";
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressRouter } from "../Utils/Express";

export enum QueueName {
  Workflow = "Workflow",
  Worker = "Worker",
}

export type QueueJob = Job;

export default class Queue {
  private static queueDict: Dictionary<BullQueue> = {};

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

  public static getInspectorRoute(): string {
    return "/api/inspect/queue/:clusterKey";
  }

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

  public static async addJob(
    queueName: QueueName,
    jobId: string,
    jobName: string,
    data: JSONObject,
    options?: {
      scheduleAt?: string | undefined;
      repeatableKey?: string | undefined;
      delay?: number | undefined; // either delay or scheduleAt
    },
  ): Promise<Job> {
    const optionsObject: JobsOptions = {
      jobId: jobId.toString(),
    };
    if (options?.delay) {
      optionsObject.delay = options.delay;
    } else if (options?.scheduleAt) {
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
