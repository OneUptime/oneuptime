import logger from "../Utils/Logger";
import Redis, { ClientType } from "./Redis";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../Types/Exception/DatabaseNotConnectedException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
  ): Promise<void> {
    await this.setString(namespace, key, JSON.stringify(value));
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

  @CaptureSpan()
  public static async setJSON(
    namespace: string,
    key: string,
    value: JSONObject,
  ): Promise<void> {
    await this.setString(
      namespace,
      key,
      JSON.stringify(JSONFunctions.serialize(value)),
    );
  }

  @CaptureSpan()
  public static async setString(
    namespace: string,
    key: string,
    value: string,
  ): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    await client.set(`${namespace}-${key}`, value);
    await client.expire(
      `${namespace}-${key}`,
      OneUptimeDate.getSecondsInDays(30),
    );
  }
}
