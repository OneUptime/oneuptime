import { Queue as BullQueue, JobsOptions, Job } from 'bullmq';
import { JSONObject } from 'Common/Types/JSON';
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
                password: RedisPassword,
            },
        });
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

        let job: Job | undefined = await this.getQueue(queueName).getJob(jobId);

        if(job){
            await job.remove();
        }

        if(options?.repeatableKey){
            // remove existing repeatable job
            await this.getQueue(queueName).removeRepeatableByKey(options?.repeatableKey)
        }

        const jobAdded = await this.getQueue(queueName).add(jobName, data, optionsObject);

        return jobAdded;
    }
}
