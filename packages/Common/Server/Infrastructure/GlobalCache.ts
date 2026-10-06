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

  /*
   * Several keys of one namespace in a single round-trip (MGET). The result
   * is positional: one entry per requested key, null where the key is
   * missing or empty.
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
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const values: Array<string | null> = await client.mget(
      keys.map((key: string) => {
        return `${namespace}-${key}`;
      }),
    );

    return keys.map((_key: string, index: number) => {
      const value: string | null | undefined = values[index];
      return value ? value : null;
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

  /*
   * Atomic compare-and-delete: drop the key only if it still holds `value`.
   * Returns true only when this caller's value was the one removed.
   *
   * This is the release half of a lease taken with `setStringIfNotExists`, and
   * the comparison is what makes the release safe. A plain `deleteKey` is a
   * check-then-act race in disguise: if the holder overruns its TTL the key
   * expires, a second worker legitimately acquires the lease, and the first
   * worker's release then deletes the SECOND worker's lease — handing the same
   * lease to a third. Comparing the holder token collapses that into one
   * atomic evaluation, so a late release is a no-op instead of a double-grant.
   *
   * The key is passed as KEYS[1] rather than inlined into the script body so
   * the script stays correct on Redis Cluster, which routes by declared keys.
   */
  @CaptureSpan()
  public static async deleteKeyIfValue(
    namespace: string,
    key: string,
    value: string,
  ): Promise<boolean> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const result: unknown = await client.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      `${namespace}-${key}`,
      value,
    );

    return result === 1;
  }

  /*
   * Atomic read-and-remove: return the value and delete the key in one
   * evaluation, so exactly one caller ever sees it.
   *
   * This is the primitive for single-use tokens (OAuth `state` nonces and the
   * like). `getString()` followed by `deleteKey()` is a check-then-act race:
   * two requests replaying the same token in the same instant would both read
   * it before either deleted it, and both would be honoured. A Lua script
   * rather than GETDEL keeps this working on Redis versions older than 6.2.
   *
   * The key is passed as KEYS[1] rather than inlined into the script body so
   * the script stays correct on Redis Cluster, which routes by declared keys.
   */
  @CaptureSpan()
  public static async getAndDeleteString(
    namespace: string,
    key: string,
  ): Promise<string | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const result: unknown = await client.eval(
      "local value = redis.call('GET', KEYS[1]) " +
        "if value then redis.call('DEL', KEYS[1]) end " +
        "return value",
      1,
      `${namespace}-${key}`,
    );

    return typeof result === "string" && result ? result : null;
  }

  /*
   * Adds one to a counter and returns the new count. The first add also
   * sets the counter's expiry, in the same atomic evaluation, so a counter
   * is never left without one - the primitive for a fixed-window budget
   * whose key names its window.
   *
   * The key is passed as KEYS[1] rather than inlined into the script body so
   * the script stays correct on Redis Cluster, which routes by declared keys.
   */
  @CaptureSpan()
  public static async incrementWithExpiry(
    namespace: string,
    key: string,
    options: CacheSetOptions,
  ): Promise<number> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const result: unknown = await client.eval(
      "local count = redis.call('INCR', KEYS[1]) " +
        "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end " +
        "return count",
      1,
      `${namespace}-${key}`,
      String(options.expiresInSeconds),
    );

    const count: number = Number(result);

    if (!Number.isFinite(count)) {
      throw new BadDataException("The cache counter is not a number");
    }

    return count;
  }

  /*
   * Adds one to a counter only while it is below limit, and returns the new
   * count - or null, adding nothing, once the counter has reached limit. As
   * with incrementWithExpiry, the first add sets the expiry in the same
   * atomic evaluation.
   *
   * A refusal adds nothing. That is what lets several limits share one
   * counter: callers that may only take the first few units of a window and
   * callers that may take all of them can count against the same key, and
   * the ones refused at the lower limit do not use up what the others still
   * may take.
   */
  @CaptureSpan()
  public static async incrementIfBelow(
    namespace: string,
    key: string,
    options: CacheSetOptions & { limit: number },
  ): Promise<number | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const result: unknown = await client.eval(
      "local current = tonumber(redis.call('GET', KEYS[1]) or '0') " +
        "if current >= tonumber(ARGV[1]) then return -1 end " +
        "local count = redis.call('INCR', KEYS[1]) " +
        "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end " +
        "return count",
      1,
      `${namespace}-${key}`,
      String(Math.floor(options.limit)),
      String(options.expiresInSeconds),
    );

    const count: number = Number(result);

    if (!Number.isFinite(count)) {
      throw new BadDataException("The cache counter is not a number");
    }

    return count < 0 ? null : count;
  }

  /*
   * Atomic monotonic advance: store value only when it is greater than the
   * number the key already holds, refresh the expiry either way, and return
   * the number the key holds afterwards.
   *
   * GET, compare, then SET from the client is a check-then-act race: two
   * writers read the same old value, both write, and the smaller one can land
   * last and move the value backwards. One evaluation makes the comparison and
   * the write a single step.
   *
   * onlyIfExists makes the call update-only: a missing key stays missing and
   * the call answers null. That lets a caller that cannot vouch for its key
   * (an unauthenticated request path) advance keys a trusted caller created,
   * without being able to create keys of its own.
   *
   * The key is passed as KEYS[1] rather than inlined into the script body so
   * the script stays correct on Redis Cluster, which routes by declared keys.
   */
  @CaptureSpan()
  public static async setNumberIfGreater(
    namespace: string,
    key: string,
    value: number,
    options: CacheSetOptions & { onlyIfExists?: boolean | undefined },
  ): Promise<number | null> {
    if (!Number.isFinite(value)) {
      throw new BadDataException("The value to store is not a number");
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new DatabaseNotConnectedException("Cache is not connected");
    }

    const result: unknown = await client.eval(
      "local stored = redis.call('GET', KEYS[1]) " +
        "if not stored and ARGV[3] == '1' then return false end " +
        "local current = stored and tonumber(stored) " +
        "if not current or tonumber(ARGV[1]) > current then " +
        "redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2]) " +
        "return ARGV[1] end " +
        "redis.call('EXPIRE', KEYS[1], ARGV[2]) " +
        "return stored",
      1,
      `${namespace}-${key}`,
      String(value),
      String(options.expiresInSeconds),
      options.onlyIfExists ? "1" : "0",
    );

    if (result === null || result === undefined) {
      return null;
    }

    const stored: number = Number(result);

    if (!Number.isFinite(stored)) {
      throw new BadDataException("The cached value is not a number");
    }

    return stored;
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
