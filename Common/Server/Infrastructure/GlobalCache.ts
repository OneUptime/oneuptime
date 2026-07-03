import logger from "../Utils/Logger";
import Redis, { ClientType } from "./Redis";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

type CacheSetOptions = {
  expiresInSeconds: number;
};

export default abstract class GlobalCache {
  @CaptureSpan()
  public static async getJSONObject(
    namespace: string,
    key: string,
  ): Promise<JSONObject | null> {
    const json: JSONArray | JSONObject | null = await this.getJSONArrayOrObject(
      namespace,
      key,
    );

    if (!json) {
      return null;
    }

    if (Array.isArray(json)) {
      throw new BadDataException("Expected JSONObject, but got JSONArray");
    }

    return json;
  }

  @CaptureSpan()
  public static async getStringArray(
    namespace: string,
    key: string,
  ): Promise<string[] | null> {
    const value: string | null = await this.getString(namespace, key);

    if (!value) {
      return null;
    }

    const stringArr: string[] = JSON.parse(value) as string[];

    if (!Array.isArray(stringArr)) {
      throw new BadDataException(
        "Expected String Array, but got something else",
      );
    }

    return stringArr;
  }

  @CaptureSpan()
  public static async setStringArray(
    namespace: string,
    key: string,
    value: string[],
    options?: CacheSetOptions,
  ): Promise<void> {
    await this.setString(namespace, key, JSON.stringify(value), options);
  }

  @CaptureSpan()
  public static async getJSONArray(
    namespace: string,
    key: string,
  ): Promise<JSONArray | null> {
    const json: JSONArray | JSONObject | null = await this.getJSONArrayOrObject(
      namespace,
      key,
    );

    if (!json) {
      return null;
    }

    if (!Array.isArray(json)) {
      throw new BadDataException("Expected JSONArray, but got JSONObject");
    }

    return json;
  }

  private static async getJSONArrayOrObject(
    namespace: string,
    key: string,
  ): Promise<JSONObject | JSONArray | null> {
    const value: string | null = await this.getString(namespace, key);

    if (!value) {
      return null;
    }

    try {
      let jsonObject: JSONObject | JSONArray = JSONFunctions.parse(value);

      if (Array.isArray(jsonObject)) {
        jsonObject = JSONFunctions.deserializeArray(jsonObject);
      } else {
        jsonObject = JSONFunctions.deserialize(jsonObject);
      }

      if (!jsonObject) {
        return null;
      }

      return jsonObject;
    } catch (err) {
      logger.error(err);
      return null;
    }
  }

  @CaptureSpan()
  public static async getString(
    namespace: string,
    key: string,
  ): Promise<string | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const value: string | null = await client?.get(`${namespace}-${key}`);

    if (!value) {
      return null;
    }

    return value;
  }

  /**
   * Bulk string read — ONE Redis round trip (MGET) for the whole batch.
   * Returns one entry per key, in key order, null for misses.
   *
   * Unlike getString this does NOT throw when the cache is unavailable:
   * bulk reads are used for advisory lookups (e.g. the alert-hysteresis
   * reopen-cooldown gate, which can probe thousands of per-series keys
   * per evaluation tick) that must fail open — an unavailable client
   * degrades to "no values" instead of failing the caller's batch.
   */
  @CaptureSpan()
  public static async getStrings(
    namespace: string,
    keys: Array<string>,
  ): Promise<Array<string | null>> {
    if (keys.length === 0) {
      return [];
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return keys.map(() => {
        return null;
      });
    }

    const values: Array<string | null> = await client.mget(
      ...keys.map((key: string) => {
        return `${namespace}-${key}`;
      }),
    );

    return values.map((value: string | null) => {
      return value ?? null;
    });
  }

  @CaptureSpan()
  public static async setJSON(
    namespace: string,
    key: string,
    value: JSONObject,
    options?: CacheSetOptions,
  ): Promise<void> {
    await this.setString(
      namespace,
      key,
      JSON.stringify(JSONFunctions.serialize(value)),
      options,
    );
  }

  @CaptureSpan()
  public static async setString(
    namespace: string,
    key: string,
    value: string,
    options?: CacheSetOptions,
  ): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const expiresInSeconds: number =
      options?.expiresInSeconds ?? OneUptimeDate.getSecondsInDays(30);

    /*
     * Atomic SET ... EX — a separate SET followed by EXPIRE can crash
     * in between and leave the key with no TTL. For fence / throttle
     * keys (e.g. otel-maintenance-fence) a TTL-less key never expires
     * and permanently suppresses the work it gates.
     */
    await client.set(`${namespace}-${key}`, value, "EX", expiresInSeconds);
  }

  @CaptureSpan()
  public static async deleteKey(namespace: string, key: string): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    await client.del(`${namespace}-${key}`);
  }
}
