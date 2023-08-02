import Sleep from 'Common/Types/Sleep';
import { Redis as RedisClient, RedisOptions } from 'ioredis';
import {
    RedisHostname,
    RedisPort,
    RedisUsername,
    RedisPassword,
    RedisDb,
    RedisTlsCa,
    RedisTlsSentinelMode,
    ShouldRedisTlsEnable,
} from '../Config';
import logger from '../Utils/Logger';

export type ClientType = RedisClient;

export default abstract class Redis {
    private static client: RedisClient | null = null;

    public static isConnected(): boolean {
        if (!this.client) {
            return false;
        }

        return this.client.status === 'ready';
    }

    public static getClient(): RedisClient | null {
        return this.client;
    }

    public static async connect(): Promise<RedisClient> {
        let retry: number = 0;

        try {

            const redisOptions: RedisOptions = {
                host: RedisHostname,
                port: RedisPort.toNumber(),
                username: RedisUsername,
                password: RedisPassword,
                db: RedisDb,
                enableTLSForSentinelMode: RedisTlsSentinelMode,
                lazyConnect: true,
            };

            if (ShouldRedisTlsEnable) {
                redisOptions.tls = { ca: RedisTlsCa };
            }

            this.client = new RedisClient(redisOptions);

            const connectToDatabase: Function = async (
                client: RedisClient
            ): Promise<void> => {
                try {
                    await client.connect();
                } catch (err) {
                    if (retry < 3) {
                        logger.info(
                            'Cannot connect to Redis. Retrying again in 5 seconds'
                        );
                        // sleep for 5 seconds.

                        await Sleep.sleep(5000);

                        retry++;
                        return await connectToDatabase(client);
                    }
                    throw err;
                }
            };

            await connectToDatabase(this.client);

            logger.info(
                `Redis connected on ${RedisHostname}:${RedisPort.toNumber()}`
            );
            return this.client;
        } catch (err) {
            logger.error('Redis Connection Failed');
            logger.error(err);
            throw err;
        }
    }

    public static disconnect(): void {
        if (this.isConnected()) {
            this.client?.disconnect();
            this.client = null;
        }
    }
}
