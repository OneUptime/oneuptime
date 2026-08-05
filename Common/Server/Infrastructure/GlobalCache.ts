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

  /*
   * Atomic acquire-once fence: SET ... EX ... NX. Returns true ONLY for the
   * caller that created the key; every concurrent caller gets false until it
   * expires.
   *
   * This exists because `getString()` followed by `setString()` is a
   * check-then-act race, and at ingest concurrency that race is not
   * theoretical — it is the whole problem. When N workers resolve the same
   * row in the same instant they ALL read a miss and they ALL proceed, so a
   * fence meant to admit one writer per window admits N. With 100 worker pods
   * that turned a once-a-minute heartbeat into thousands of simultaneous
   * UPDATEs against the same handful of rows, and the resulting row-lock
   * convoy starved the Postgres connection pool (some statements queued for
   * hours). Redis evaluates SET NX atomically, so exactly one caller wins no
   * matter how many arrive together.
   *
   * Fence keys should carry the TTL jitter from `withJitter()` — see there for
   * why synchronized expiry re-creates the herd this is meant to prevent.
   */
  @CaptureSpan()
  public static async setStringIfNotExists(
    namespace: string,
    key: string,
    value: string,
    options?: CacheSetOptions,
  ): Promise<boolean> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const expiresInSeconds: number =
      options?.expiresInSeconds ?? OneUptimeDate.getSecondsInDays(30);

    const result: string | null = await client.set(
      `${namespace}-${key}`,
      value,
      "EX",
      expiresInSeconds,
      "NX",
    );

    /*
     * ioredis resolves to "OK" when the key was created and to null when it
     * already existed. Anything else (a driver/protocol change) is treated as
     * "did not acquire" — losing the fence is safe, winning it wrongly is not.
     */
    return result === "OK";
  }

  /*
   * Atomic compare-and-claim: claim the window unless the key ALREADY holds
   * `value`. Returns true only for the caller that claimed it.
   *
   * `setStringIfNotExists` is the right primitive for a presence fence and the
   * wrong one for a fingerprint throttle. Plain NX fails whenever the key
   * exists — including when it holds a STALE fingerprint — so a genuinely
   * changed payload (a new service.version after a deploy, a changed host IP)
   * would be suppressed for the whole window and nobody would persist it. This
   * keeps the bust-on-change behaviour that callers depend on while collapsing
   * the GET-then-SET race into one atomic evaluation.
   *
   * The key is passed as KEYS[1] rather than inlined into the script body so
   * the script stays correct on Redis Cluster, which routes by declared keys.
   */
  @CaptureSpan()
  public static async setStringIfChanged(
    namespace: string,
    key: string,
    value: string,
    options?: CacheSetOptions,
  ): Promise<boolean> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const expiresInSeconds: number =
      options?.expiresInSeconds ?? OneUptimeDate.getSecondsInDays(30);

    const result: unknown = await client.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return 0 " +
        "else redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) return 1 end",
      1,
      `${namespace}-${key}`,
      value,
      String(expiresInSeconds),
    );

    return result === 1;
  }

  /*
   * Spread a fence TTL over [ttl, ttl + 25%].
   *
   * A fixed TTL makes every fence for a fleet of rows expire in lockstep once
   * their writes have been aligned by a common event — a deploy, a worker
   * scale-up, a Redis restart. The window then reopens for thousands of rows
   * in the same second and the herd re-forms on a one-minute period. Jitter
   * breaks that alignment permanently: the fences drift apart after the first
   * window and stay apart.
   *
   * The upper bound stays well inside the 15-minute disconnection sweep, so a
   * jittered heartbeat can never make a live resource look disconnected.
   */
  public static withJitter(expiresInSeconds: number): number {
    if (expiresInSeconds <= 0) {
      return expiresInSeconds;
    }

    return Math.ceil(expiresInSeconds * (1 + Math.random() * 0.25));
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
