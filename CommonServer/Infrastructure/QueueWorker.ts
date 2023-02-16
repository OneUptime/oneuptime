import { Worker, Job } from 'bullmq';
import { RedisHostname, RedisPort } from '../Config';
import { QueueJob, QueueName } from './Queue';

export default class QueueWorker { 
    public static getWorker(queueName: QueueName, onJobInQueue: (job: QueueJob)=> Promise<void>, options: {concurrency: number}){
        return new Worker(queueName, onJobInQueue, { connection: {
            host: RedisHostname.toString(),
            port: RedisPort.toNumber()
          }, concurrency: options.concurrency});
    }
}