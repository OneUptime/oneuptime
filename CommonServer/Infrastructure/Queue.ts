import { Queue as BullQueue, JobsOptions, Job } from 'bullmq';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { RedisHostname, RedisPassword, RedisPort } from '../Config';

export enum QueueName {
    Workflow = 'Workflow',
}

export type QueueJob = Job;

export default class Queue {
    public static getQueue(queueName: QueueName): BullQueue {
        return new BullQueue(queueName, {
            connection: {
                host: RedisHostname.toString(),
                port: RedisPort.toNumber(),
                password: RedisPassword
            },
        });
    }

    public static async addJob(
        queueName: QueueName,
        jobId: ObjectID,
        jobName: string,
        data: JSONObject,
        options?: {
            scheduleAt?: string;
        }
    ): Promise<void> {
        const optionsObject: JobsOptions = {
            jobId: jobId.toString(),
        };

        if (options && options.scheduleAt) {
            optionsObject.repeat = {
                pattern: options.scheduleAt,
            };
        }

        await this.getQueue(queueName).add(jobName, data, {...optionsObject });
    }
}
