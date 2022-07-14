import { JSONFunctions, JSONObject } from "Common/Types/JSON";
import Redis, { ClientType } from "./Redis";
import DatabaseNotConnectedException from "Common/Types/Exception/DatabaseNotConnectedException";
import OneUptimeDate from "Common/Types/Date";

export default abstract class Cache {

    public static async getJSON(namespace: string, key: string): Promise<JSONObject | null> {
        const client: ClientType | null = Redis.getClient();

        if (!client || !Redis.isConnected()) {
            throw new DatabaseNotConnectedException("Cache is not connected");
        }

        const jsonObject: any = await client?.HMGET(`${namespace}`, key);

        if (!jsonObject) {
            return null;
        }
        
        return jsonObject;
    }

    public static async setJSON(namespace: string, key: string, value: JSONObject): Promise<void> {
        const client: ClientType | null = Redis.getClient();

        if (!client || !Redis.isConnected()) {
            throw new DatabaseNotConnectedException("Cache is not connected");
        }

        await client?.hSet(`${namespace}-${key}`, JSONFunctions.toJSON(value) as any);
        await client.expire(`${namespace}-${key}`, OneUptimeDate.getSecondsInDays(30));
    }
}
