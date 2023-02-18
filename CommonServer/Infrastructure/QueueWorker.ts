import { Worker } from 'bullmq';
import TimeoutException from 'Common/Types/Exception/TimeoutException';
import { RedisHostname, RedisPassword, RedisPort } from '../Config';
import { QueueJob, QueueName } from './Queue';

export default class QueueWorker {
    public static getWorker(
        queueName: QueueName,
        onJobInQueue: (job: QueueJob) => Promise<void>,
        options: { concurrency: number }
    ): Worker {
        const worker: Worker = new Worker(queueName, onJobInQueue, {
            connection: {
                host: RedisHostname.toString(),
                port: RedisPort.toNumber(),
                password: RedisPassword,
            },
            concurrency: options.concurrency,
        });

        process.on('SIGINT', async () => {
            await worker.close();
        });

        return worker;
    }

    public static async runJobWithTimeout(
        timeout: number,
        jobCallback: Function
    ): Promise<void> {
        const timeoutPromise: Function = (ms: number): Promise<void> => {
            return new Promise((_resolve: Function, reject: Function) => {
                setTimeout(() => {
                    return reject(new TimeoutException('Job Timeout'));
                }, ms);
            });
        };

        return await Promise.race([timeoutPromise(timeout), jobCallback()]);
    }
}
