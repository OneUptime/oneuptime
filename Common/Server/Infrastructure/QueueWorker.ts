import { RedisHostname, RedisPassword, RedisPort } from "../EnvironmentConfig";
import { QueueJob, QueueName } from "./Queue";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import {
  PromiseRejectErrorFunction,
  PromiseVoidFunction,
  VoidFunction,
} from "Common/Types/FunctionTypes";
import { Worker } from "bullmq";

export default class QueueWorker {
  public static getWorker(
    queueName: QueueName,
    onJobInQueue: (job: QueueJob) => Promise<void>,
    options: { concurrency: number },
  ): Worker {
    const worker: Worker = new Worker(queueName, onJobInQueue, {
      connection: {
        host: RedisHostname.toString(),
        port: RedisPort.toNumber(),
        password: RedisPassword,
      },
      concurrency: options.concurrency,
    });

    process.on("SIGINT", async () => {
      await worker.close();
    });

    return worker;
  }

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
