import type { JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import type { ClientType } from './Redis';
import Redis from './Redis';
import DatabaseNotConnectedException from 'Common/Types/Exception/DatabaseNotConnectedException';
import OneUptimeDate from 'Common/Types/Date';
import logger from '../Utils/Logger';

export default abstract class Cache {
    public static async getJSON(
        namespace: string,
        key: string
    ): Promise<JSONObject | null> {
        const value: string | null = await this.getString(namespace, key);

        if (!value) {
            return null;
        }

        try {
            const jsonObject: JSONObject = JSONFunctions.deserialize(
                JSON.parse(value)
            ) as JSONObject;

            if (!jsonObject) {
                return null;
            }

            return jsonObject;
        } catch (err) {
            logger.error(err);
            return null;
        }
    }

    public static async getString(
        namespace: string,
        key: string
    ): Promise<string | null> {
        const client: ClientType | null = Redis.getClient();

        if (!client || !Redis.isConnected()) {
            throw new DatabaseNotConnectedException('Cache is not connected');
        }

        const value: string | null = await client?.get(`${namespace}-${key}`);

        if (!value) {
            return null;
        }

        return value;
    }

    public static async setJSON(
        namespace: string,
        key: string,
        value: JSONObject
    ): Promise<void> {
        await this.setString(
            namespace,
            key,
            JSON.stringify(JSONFunctions.serialize(value))
        );
    }

    public static async setString(
        namespace: string,
        key: string,
        value: string
    ): Promise<void> {
        const client: ClientType | null = Redis.getClient();

        if (!client || !Redis.isConnected()) {
            throw new DatabaseNotConnectedException('Cache is not connected');
        }

        await client.set(`${namespace}-${key}`, value);
        await client.expire(
            `${namespace}-${key}`,
            OneUptimeDate.getSecondsInDays(30)
        );
    }
}
