import { Worker } from 'bullmq';
import { RedisHostname, RedisPort } from '../Config';

export default class QueueWorker { 
    public static getWorker(queueName: string, onJobInQueue: any){
        return new Worker(queueName, onJobInQueue, { connection: {
            host: RedisHostname.toString(),
            port: RedisPort.toNumber()
          }});
    }
}