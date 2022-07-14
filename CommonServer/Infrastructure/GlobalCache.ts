import { JSONObject } from 'Common/Types/JSON';
import Redis, { ClientType } from './Redis';
import DatabaseNotConnectedException from 'Common/Types/Exception/DatabaseNotConnectedException';
import OneUptimeDate from 'Common/Types/Date';
import logger from '../Utils/Logger';

export default abstract class Cache {
    public static async getJSON(
        namespace: string,
        key: string
    ): Promise<JSONObject | null> {
        const client: ClientType | null = Redis.getClient();

        if (!client || !Redis.isConnected()) {
            throw new DatabaseNotConnectedException('Cache is not connected');
        }

        const value: string | null = await client?.get(`${namespace}-${key}`);

        if (!value) {
            return null;
        }

        try {
            const jsonObject: JSONObject = JSON.parse(value);

            if (!jsonObject) {
                return null;
            }

            return jsonObject;
        } catch (err) {
            logger.error(err);
            return null;
        }
    }

    public static async setJSON(
        namespace: string,
        key: string,
        value: JSONObject
    ): Promise<void> {
        const client: ClientType | null = Redis.getClient();

        if (!client || !Redis.isConnected()) {
            throw new DatabaseNotConnectedException('Cache is not connected');
        }

        await client.set(`${namespace}-${key}`, JSON.stringify(value));
        await client.expire(
            `${namespace}-${key}`,
            OneUptimeDate.getSecondsInDays(30)
        );
    }
}
