import { Queue as BullQueue } from 'bullmq';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { RedisHostname, RedisPort } from '../Config';

export enum QueueName {
    Workflow ="Workflow"
}

export default class Queue {
    public static getQueue(queueName: QueueName): BullQueue {
        return new BullQueue(queueName, { connection: {
            host: RedisHostname.toString(),
            port: RedisPort.toNumber()
          }});
    }

    public static async addJob(queueName: QueueName, jobId: ObjectID, jobName: string, data: JSONObject){
        await this.getQueue(queueName).add(jobName, data, {jobId: jobId.toString()});
    }
}