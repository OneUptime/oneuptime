import Sleep from 'Common/Types/Sleep';
import { createClient, RedisClientType } from 'redis';
import { RedisHostname, RedisPassword, RedisPort } from '../Config';
import logger from '../Utils/Logger';

export type ClientType = RedisClientType;

export default abstract class Redis {
    private static client: RedisClientType | null = null;

    public static isConnected(): boolean {
        if (!this.client) {
            return false;
        }

        return this.client.isReady;
    }

    public static getClient(): RedisClientType | null {
        return this.client;
    }

    public static async connect(): Promise<RedisClientType> {
        let retry: number = 0;

        try {
            this.client = createClient({
                password: RedisPassword,
                socket: {
                    host: RedisHostname,
                    port: RedisPort.toNumber(),
                },
            });

            const connectToDatabase: Function = async (
                client: RedisClientType
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

    public static async disconnect(): Promise<void> {
        if (this.isConnected()) {
            await this.client?.disconnect();
            this.client = null;
        }
    }
}
