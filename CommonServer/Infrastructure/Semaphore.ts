import Redis, { ClientType } from './Redis';
import Dictionary from 'Common/Types/Dictionary';
import ObjectID from 'Common/Types/ObjectID';
import { Mutex } from 'redis-semaphore';

export default class Semaphore {
    private static mutexDictionary: Dictionary<Mutex> = {};

    // returns the mutex id
    public static async lock(data: {
        key: string;
        lockTimeout?: number;
    }): Promise<ObjectID> {
        if (!data.lockTimeout) {
            data.lockTimeout = 1000;
        }

        const { key } = data;

        const client: ClientType | null = Redis.getClient();

        if (!client) {
            throw new Error('Redis client is not connected');
        }

        const mutex: Mutex = new Mutex(client, key, {
            lockTimeout: data.lockTimeout,
        });

        await mutex.acquire();

        const mutexId: ObjectID = ObjectID.generate();

        // add to the dictionary
        this.mutexDictionary[mutexId.toString()] = mutex;

        return mutexId;
    }

    public static async release(mutexId: ObjectID): Promise<void> {
        const mutex: Mutex | undefined =
            this.mutexDictionary[mutexId.toString()];

        if (!mutex) {
            return; // already released
        }

        await mutex.release();

        // remove from the dictionary
        delete this.mutexDictionary[mutexId.toString()];
    }
}
