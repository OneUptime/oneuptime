import { Queue as BullQueue, JobsOptions, Job } from 'bullmq';
import { JSONObject } from 'Common/Types/JSON';
import { RedisHostname, RedisPassword, RedisPort } from '../EnvironmentConfig';
import Dictionary from 'Common/Types/Dictionary';

export enum QueueName {
    Workflow = 'Workflow',
    Worker = 'Worker',
}

export type QueueJob = Job;

export default class Queue {
    private static queueDict: Dictionary<BullQueue> = {};

    public static getQueue(queueName: QueueName): BullQueue {
        // check if the queue is already created
        if (this.queueDict[queueName]) {
            return this.queueDict[queueName] as BullQueue;
        }

        const queue = new BullQueue(queueName, {
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
        jobId: string
    ): Promise<void> {
        if (!jobId) {
            return;
        }

        const job: Job | undefined = await this.getQueue(queueName).getJob(
            jobId
        );

        if (job) {
            await job.remove();
        }

        // remove existing repeatable job
        await this.getQueue(queueName).removeRepeatableByKey(jobId);
    }

    public static async addJob(
        queueName: QueueName,
        jobId: string,
        jobName: string,
        data: JSONObject,
        options?: {
            scheduleAt?: string | undefined;
            repeatableKey?: string | undefined;
        }
    ): Promise<Job> {
        const optionsObject: JobsOptions = {
            jobId: jobId.toString(),
        };

        if (options && options.scheduleAt) {
            optionsObject.repeat = {
                pattern: options.scheduleAt,
            };
        }

        const job: Job | undefined = await this.getQueue(queueName).getJob(
            jobId
        );

        if (job) {
            await job.remove();
        }

        if (options?.repeatableKey) {
            // remove existing repeatable job
            await this.getQueue(queueName).removeRepeatableByKey(
                options?.repeatableKey
            );
        }

        const jobAdded: Job = await this.getQueue(queueName).add(
            jobName,
            data,
            optionsObject
        );

        return jobAdded;
    }
}
