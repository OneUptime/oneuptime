import { ClientType } from "../../Infrastructure/Redis";
import {
  getIpv6NetworkRateLimit,
  getRateLimitClient,
  RateLimitClient,
} from "../ClientIp";

/*
 * COUNTING A CLIENT'S REQUESTS IN REDIS: EACH ADDRESS, AND EACH IPV6 /64.
 *
 * Every rate limit that counts the requests of a client address counts them
 * here. One IPv6 host is commonly given a whole /64 and can send each request
 * from another address of it, so a counter keyed on the address alone would
 * hold that host to nothing. For an IPv6 client every counter keyed on the
 * client is therefore counted twice: under its address, at the caller's
 * limit, and under its /64, with room for several addresses
 * (getIpv6NetworkRateLimit in ClientIp). An IPv4 client, and a caller that is
 * not an address at all ("unknown"), is counted under its address alone.
 *
 * In this order:
 *
 *  1. A /64 already over one of its limits is refused before anything is
 *     counted. Its addresses are not held to an allowance of their own for
 *     requests that were never served, and a host that sends from a new
 *     address every time leaves no counter behind per address.
 *
 *  2. The address counters are counted, together with the counters that are
 *     not keyed on the client at all (a signed-in user, a channel row), in
 *     one round trip. One over its limit refuses the request and the /64 is
 *     not counted: an address that sends more than its own allowance never
 *     spends the allowance of the addresses beside it, so one noisy
 *     neighbour in a shared /64 does not refuse everybody else in it.
 *
 *  3. The /64 counters are counted. One over its limit refuses the request.
 *
 * Every window is fixed: the caller puts the window in each key, and a key's
 * expiry is set only by the request that created it, so a window never
 * slides forward under load. A Redis error or a malformed answer is thrown,
 * for the caller to fail open or closed as its route decides.
 *
 * THE DIFFERENT VALUES A CLIENT PRESENTS (countDifferent).
 *
 * A limit on guessing counts what a client tries, not how often it asks:
 * the different wrong keys it presented (WrongClusterKeyLimit). A value it
 * presented before tries nothing new, so it is not counted again. Each
 * client's values are kept as a set per window, under its address and, for
 * an IPv6 client, under its /64 as well, in the order count() counts: a /64
 * or an address already over its limit is refused before anything is added,
 * so a refused client adds nothing and no set holds more than one value past
 * its limit; then the value is added for the address, and only when the
 * address is within its own limit, for its /64. A client over its limit is
 * refused whatever it presents, a value it tried before too.
 *
 * One Lua script checks and adds, so the check and the add of one request
 * are one step: a request that arrives with others is checked after the
 * values of the requests that reached Valkey before it were added, never
 * before them.
 */

export interface ClientRateLimitCounterSpec<TScope> {
  // What the caller calls this counter. It is handed back when it refuses.
  scope: TScope;

  /*
   * The counter's Redis key for one client, window included. Called with
   * the client's address, and for an IPv6 client with its /64 as well
   * ("2001:db8:0:1::/64"), which no address can be mistaken for.
   */
  keyFor: (client: string) => string;

  // How many requests one address may make in the window.
  limit: number;

  /*
   * How many requests the addresses of one IPv6 /64 may make in the window,
   * together. Ten addresses' worth unless the caller decides otherwise.
   */
  ipv6NetworkLimit?: number | undefined;
}

/*
 * A counter that is not keyed on the client - a signed-in user, a channel
 * row - counted along with the address counters.
 */
export interface FixedRateLimitCounterSpec<TScope> {
  scope: TScope;
  key: string;
  limit: number;
}

export interface ClientRateLimitRefusal<TScope> {
  scope: TScope;

  /*
   * The client's /64 when the addresses of that IPv6 /64 together went over
   * the counter's limit; undefined when the client itself did.
   */
  ipv6Network64: string | undefined;

  /*
   * True only for the request that first went over the counter's limit in
   * its window: the one refusal of the window worth a log line.
   */
  isFirstRefusalInWindow: boolean;
}

interface CountedKey<TScope> {
  scope: TScope;
  key: string;
  limit: number;
}

type PipelineResults = Array<[Error | null, unknown]>;

/*
 * countDifferent's check and add, in one step.
 *
 * KEYS[1]: the set of the different values one address presented in a
 * window; KEYS[2], for an IPv6 address, the set of its /64.
 *
 * ARGV[1]: the value to add, or "" to add nothing. ARGV[2]: how many
 * different values the address may present; ARGV[3]: how many the
 * addresses of its /64 may, together. ARGV[4]: a set's lifetime, in
 * seconds, given only by the request that made the set (its TTL is below 0
 * until then), so a window never slides forward.
 *
 * Answers {refusedBy, wentOver}: refusedBy is 0 when the request may go on,
 * 1 when the address is over its limit and 2 when its /64 is (the set
 * KEYS[refusedBy]); wentOver is 1 for the request whose new value took that
 * set over its limit - the first refusal of the window - and 0 for a client
 * that was over already. The limit of KEYS[n] is ARGV[n + 1].
 */
export const DIFFERENT_VALUES_SCRIPT: string = [
  "if #KEYS > 1 and redis.call('SCARD', KEYS[2]) > tonumber(ARGV[3]) then",
  "  return {2, 0}",
  "end",
  "if redis.call('SCARD', KEYS[1]) > tonumber(ARGV[2]) then",
  "  return {1, 0}",
  "end",
  "if ARGV[1] == '' then",
  "  return {0, 0}",
  "end",
  "for index, key in ipairs(KEYS) do",
  "  redis.call('SADD', key, ARGV[1])",
  "  if redis.call('TTL', key) < 0 then",
  "    redis.call('EXPIRE', key, tonumber(ARGV[4]))",
  "  end",
  "  if redis.call('SCARD', key) > tonumber(ARGV[index + 1]) then",
  "    return {index, 1}",
  "  end",
  "end",
  "return {0, 0}",
].join("\n");

// What refused a request, as DIFFERENT_VALUES_SCRIPT answers it.
const NOT_REFUSED: number = 0;
const REFUSED_BY_ADDRESS: number = 1;
const REFUSED_BY_NETWORK: number = 2;

export default class ClientRateLimitCounter {
  /*
   * How a log line names the limit that refused a request: "ip limit", or
   * "ip limit of 2001:db8:0:1::/64" when the addresses of the client's /64
   * together went over it.
   */
  public static describeLimit(
    scope: string,
    ipv6Network64?: string | undefined,
  ): string {
    return ipv6Network64
      ? `${scope} limit of ${ipv6Network64}`
      : `${scope} limit`;
  }

  /*
   * Counts one request of a client against its counters and answers the
   * counter that refused it, or null when it may go on. When more than one
   * is over, the first is answered, in the order given: the counters not
   * keyed on the client, then the client's own, then its /64's.
   */
  public static async count<TScope>(data: {
    redis: ClientType;

    /*
     * The address the request is attributed to (resolveClientIp), or the
     * key every caller that cannot be placed shares ("unknown").
     */
    clientIp: string;

    // How long each counter's key lives, in seconds: longer than its window.
    ttlSeconds: number;

    counters: Array<ClientRateLimitCounterSpec<TScope>>;
    fixedCounters?: Array<FixedRateLimitCounterSpec<TScope>> | undefined;
  }): Promise<ClientRateLimitRefusal<TScope> | null> {
    const client: RateLimitClient = getRateLimitClient(data.clientIp);
    const network: string | null = client.ipv6Network64;

    const networkKeys: Array<CountedKey<TScope>> = network
      ? data.counters.map(
          (counter: ClientRateLimitCounterSpec<TScope>): CountedKey<TScope> => {
            return {
              scope: counter.scope,
              key: counter.keyFor(network),
              limit:
                counter.ipv6NetworkLimit ??
                getIpv6NetworkRateLimit(counter.limit),
            };
          },
        )
      : [];

    if (network && networkKeys.length > 0) {
      const counts: Array<number> = await ClientRateLimitCounter.read({
        redis: data.redis,
        keys: networkKeys,
      });

      const full: CountedKey<TScope> | undefined = networkKeys.find(
        (networkKey: CountedKey<TScope>, index: number): boolean => {
          return (counts[index] ?? 0) > networkKey.limit;
        },
      );

      if (full) {
        return {
          scope: full.scope,
          ipv6Network64: network,
          isFirstRefusalInWindow: false,
        };
      }
    }

    const addressKeys: Array<CountedKey<TScope>> = [
      ...(data.fixedCounters || []).map(
        (counter: FixedRateLimitCounterSpec<TScope>): CountedKey<TScope> => {
          return {
            scope: counter.scope,
            key: counter.key,
            limit: counter.limit,
          };
        },
      ),
      ...data.counters.map(
        (counter: ClientRateLimitCounterSpec<TScope>): CountedKey<TScope> => {
          return {
            scope: counter.scope,
            key: counter.keyFor(client.address),
            limit: counter.limit,
          };
        },
      ),
    ];

    const addressRefusal: ClientRateLimitRefusal<TScope> | null =
      await ClientRateLimitCounter.increment({
        redis: data.redis,
        keys: addressKeys,
        ttlSeconds: data.ttlSeconds,
        ipv6Network64: undefined,
      });

    if (addressRefusal || !network || networkKeys.length === 0) {
      return addressRefusal;
    }

    return await ClientRateLimitCounter.increment({
      redis: data.redis,
      keys: networkKeys,
      ttlSeconds: data.ttlSeconds,
      ipv6Network64: network,
    });
  }

  /*
   * Checks a client against the different values it presented in the
   * window, and adds the value this request presents (see THE DIFFERENT
   * VALUES A CLIENT PRESENTS above). Answers the refusal when the client -
   * its address, or the addresses of its IPv6 /64 together - has presented
   * more different values than its limit, the request whose value made it
   * one too many included; or null when the request may go on. With `value`
   * null the request is only checked: it adds nothing, and a client over
   * its limit is refused all the same.
   */
  public static async countDifferent<TScope>(data: {
    redis: ClientType;

    /*
     * The address the request is attributed to (resolveClientIp), or the
     * key every caller that cannot be placed shares ("unknown").
     */
    clientIp: string;

    // How long each set lives, in seconds: longer than its window.
    ttlSeconds: number;

    /*
     * The sets' keys (keyFor, window included) and how many different
     * values one address, and one /64, may present in the window.
     */
    counter: ClientRateLimitCounterSpec<TScope>;

    // The value as the caller keeps it, or null to add nothing.
    value: string | null;
  }): Promise<ClientRateLimitRefusal<TScope> | null> {
    if (data.value !== null && data.value.length === 0) {
      throw new Error("An empty value cannot be counted as a different one");
    }

    const client: RateLimitClient = getRateLimitClient(data.clientIp);
    const network: string | null = client.ipv6Network64;
    const keys: Array<string> = [data.counter.keyFor(client.address)];

    if (network) {
      keys.push(data.counter.keyFor(network));
    }

    const answer: unknown = await data.redis.eval(
      DIFFERENT_VALUES_SCRIPT,
      keys.length,
      ...keys,
      data.value === null ? "" : data.value,
      String(data.counter.limit),
      String(
        data.counter.ipv6NetworkLimit ??
          getIpv6NetworkRateLimit(data.counter.limit),
      ),
      String(data.ttlSeconds),
    );

    if (
      !Array.isArray(answer) ||
      answer.length !== 2 ||
      !answer.every((part: unknown): boolean => {
        return typeof part === "number" && Number.isInteger(part);
      }) ||
      ![NOT_REFUSED, REFUSED_BY_ADDRESS, REFUSED_BY_NETWORK].includes(
        answer[0] as number,
      ) ||
      (answer[0] === REFUSED_BY_NETWORK && !network)
    ) {
      throw new Error("The different values counter answered something else");
    }

    const [refusedBy, wentOver] = answer as Array<number>;

    if (refusedBy === NOT_REFUSED) {
      return null;
    }

    return {
      scope: data.counter.scope,
      ipv6Network64:
        refusedBy === REFUSED_BY_NETWORK ? network || undefined : undefined,
      isFirstRefusalInWindow: wentOver === 1,
    };
  }

  /*
   * Counts one request against counters that are not keyed on a client at
   * all - a form's ceiling across every address, a runbook's runs - and
   * answers the first one over its limit, or null.
   */
  public static async countFixed<TScope>(data: {
    redis: ClientType;
    ttlSeconds: number;
    counters: Array<FixedRateLimitCounterSpec<TScope>>;
  }): Promise<ClientRateLimitRefusal<TScope> | null> {
    return await ClientRateLimitCounter.increment({
      redis: data.redis,
      keys: data.counters.map(
        (counter: FixedRateLimitCounterSpec<TScope>): CountedKey<TScope> => {
          return {
            scope: counter.scope,
            key: counter.key,
            limit: counter.limit,
          };
        },
      ),
      ttlSeconds: data.ttlSeconds,
      ipv6Network64: undefined,
    });
  }

  /*
   * Takes one request back off counters countFixed counted it under, for a
   * request that ended before it did what it was counted for: DECR each
   * key, in one pipeline. Called by the same request moments after it
   * counted, so each key is still there with its expiry; one Redis lost in
   * between comes back below zero, and is given an expiry too, so that it
   * is not left behind without one.
   */
  public static async uncountFixed(data: {
    redis: ClientType;
    keys: Array<string>;
    ttlSeconds: number;
  }): Promise<void> {
    if (data.keys.length === 0) {
      return;
    }

    const pipeline: ReturnType<ClientType["pipeline"]> = data.redis.pipeline();

    for (const key of data.keys) {
      pipeline.decr(key);
    }

    const results: PipelineResults = ClientRateLimitCounter.readResults(
      (await pipeline.exec()) as PipelineResults | null,
      data.keys.length,
    );

    const lostKeys: Array<string> = data.keys.filter(
      (_key: string, index: number): boolean => {
        const value: unknown = ClientRateLimitCounter.readResult(
          results[index],
        );

        return typeof value === "number" && value < 0;
      },
    );

    if (lostKeys.length === 0) {
      return;
    }

    const expirePipeline: ReturnType<ClientType["pipeline"]> =
      data.redis.pipeline();

    for (const key of lostKeys) {
      expirePipeline.expire(key, data.ttlSeconds);
    }

    const expireResults: PipelineResults = ClientRateLimitCounter.readResults(
      (await expirePipeline.exec()) as PipelineResults | null,
      lostKeys.length,
    );

    for (const expireResult of expireResults) {
      ClientRateLimitCounter.readResult(expireResult);
    }
  }

  /*
   * INCR each key in one pipeline, set the expiry of each key this request
   * created, and answer the first key over its limit.
   */
  private static async increment<TScope>(data: {
    redis: ClientType;
    keys: Array<CountedKey<TScope>>;
    ttlSeconds: number;
    ipv6Network64: string | undefined;
  }): Promise<ClientRateLimitRefusal<TScope> | null> {
    if (data.keys.length === 0) {
      return null;
    }

    const pipeline: ReturnType<ClientType["pipeline"]> = data.redis.pipeline();

    for (const countedKey of data.keys) {
      pipeline.incr(countedKey.key);
    }

    const results: PipelineResults = ClientRateLimitCounter.readResults(
      (await pipeline.exec()) as PipelineResults | null,
      data.keys.length,
    );

    const counts: Array<number> = data.keys.map(
      (_countedKey: CountedKey<TScope>, index: number): number => {
        const value: unknown = ClientRateLimitCounter.readResult(
          results[index],
        );

        if (typeof value !== "number") {
          throw new Error("Rate limit counter returned a non-numeric value");
        }

        return value;
      },
    );

    /*
     * Only the request that created a key sets its expiry. Setting it on
     * every request would slide the window forward for as long as requests
     * kept coming, and a client that went over once could never recover.
     */
    const createdKeys: Array<string> = data.keys
      .filter((_countedKey: CountedKey<TScope>, index: number): boolean => {
        return counts[index] === 1;
      })
      .map((countedKey: CountedKey<TScope>): string => {
        return countedKey.key;
      });

    if (createdKeys.length > 0) {
      const expirePipeline: ReturnType<ClientType["pipeline"]> =
        data.redis.pipeline();

      for (const key of createdKeys) {
        expirePipeline.expire(key, data.ttlSeconds);
      }

      /*
       * A key whose expiry could not be set would never be removed, so a
       * failed EXPIRE is a failed count like a failed INCR.
       */
      const expireResults: PipelineResults = ClientRateLimitCounter.readResults(
        (await expirePipeline.exec()) as PipelineResults | null,
        createdKeys.length,
      );

      for (const expireResult of expireResults) {
        ClientRateLimitCounter.readResult(expireResult);
      }
    }

    const refusedIndex: number = data.keys.findIndex(
      (countedKey: CountedKey<TScope>, index: number): boolean => {
        return (counts[index] ?? 0) > countedKey.limit;
      },
    );

    if (refusedIndex === -1) {
      return null;
    }

    const refusedBy: CountedKey<TScope> = data.keys[refusedIndex]!;

    return {
      scope: refusedBy.scope,
      ipv6Network64: data.ipv6Network64,
      isFirstRefusalInWindow: counts[refusedIndex] === refusedBy.limit + 1,
    };
  }

  // How many requests each key has counted so far, without counting one.
  private static async read<TScope>(data: {
    redis: ClientType;
    keys: Array<CountedKey<TScope>>;
  }): Promise<Array<number>> {
    const pipeline: ReturnType<ClientType["pipeline"]> = data.redis.pipeline();

    for (const countedKey of data.keys) {
      pipeline.get(countedKey.key);
    }

    const results: PipelineResults = ClientRateLimitCounter.readResults(
      (await pipeline.exec()) as PipelineResults | null,
      data.keys.length,
    );

    return data.keys.map(
      (_countedKey: CountedKey<TScope>, index: number): number => {
        const value: unknown = ClientRateLimitCounter.readResult(
          results[index],
        );

        // A key that does not exist yet has counted nothing.
        if (value === null || value === undefined) {
          return 0;
        }

        const count: number =
          typeof value === "number" ? value : Number(String(value));

        if (!Number.isFinite(count)) {
          throw new Error("Rate limit counter holds a non-numeric value");
        }

        return count;
      },
    );
  }

  private static readResults(
    results: PipelineResults | null,
    expectedLength: number,
  ): PipelineResults {
    if (!results || results.length < expectedLength) {
      throw new Error("Rate limit pipeline returned no result");
    }

    return results;
  }

  private static readResult(
    result: [Error | null, unknown] | undefined,
  ): unknown {
    if (!result) {
      throw new Error("Rate limit counter returned no result");
    }

    const [error, value] = result;

    if (error) {
      throw error;
    }

    return value;
  }
}
