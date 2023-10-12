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
} from '../EnvironmentConfig';
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

            // Listen to 'error' events to the Redis connection
            this.client.on('error', (error: Error) => {
                if ((error as any).code === 'ECONNRESET') {
                    logger.error(
                        'Connection to Redis Session Store timed out.'
                    );
                } else if ((error as any).code === 'ECONNREFUSED') {
                    logger.error('Connection to Redis Session Store refused!');
                } else {
                    logger.error(error);
                }
            });

            // Listen to 'reconnecting' event to Redis
            this.client.on('reconnecting', () => {
                if (this.client?.status === 'reconnecting') {
                    logger.error('Reconnecting to Redis Session Store...');
                } else {
                    logger.error('Error reconnecting to Redis Session Store.');
                }
            });

            // Listen to the 'connect' event to Redis
            this.client.on('connect', (err: Error) => {
                if (!err) {
                    logger.info('Connected to Redis Session Store!');
                }
            });

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
