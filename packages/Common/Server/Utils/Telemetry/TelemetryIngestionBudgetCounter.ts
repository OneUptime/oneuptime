import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import { TelemetryIngestionBudgetScope } from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { createHash } from "crypto";

/*
 * The shared counters behind telemetry ingestion budgets, in Valkey/Redis.
 *
 * Every ingest pod charges the same keys, so a project's budget is one budget
 * however many pods its telemetry lands on - a per-process count would let
 * each of N pods admit the whole budget. One script (BUDGET_SCRIPT) does the
 * whole decision in one round trip, atomically: it reads the day's count,
 * checks the per-second rate, and charges both, so two requests racing for
 * the last bytes of a budget cannot both be admitted on a stale read.
 *
 * Per scope (the project, and an ingestion key with a budget of its own) and
 * signal:
 *
 *   - a hash per budget day, `telemetry:budget:day:<day>:<scope>:<id>:<signal>`
 *     with the day's `used` bytes, the `dropped` bytes and `droppedRequests`
 *     refused because the budget was used up, the `throttledRequests` the
 *     rate refused, and when the warning was crossed (`warnedAt`) and the
 *     budget used up (`exhaustedAt`). It expires a day after its budget day
 *     ends.
 *   - a rate key, `telemetry:budget:rate:<scope>:<id>:<signal>`: the
 *     theoretical arrival time of a GCRA (a token bucket kept as one number),
 *     in microseconds, expiring as soon as the bucket is full again.
 *   - a set per budget day, `telemetry:budget:active:<day>`, listing every
 *     scope that counted anything that day, so the metrics sweep reads only
 *     those instead of scanning the keyspace.
 *
 * The rules, which the script enforces in this order:
 *
 *   1. A daily budget admits a request while the day's count is BELOW it, so
 *      the request that crosses the line is stored and everything after it is
 *      refused until the reset. used >= budget is "used up" everywhere: here,
 *      in the status API and in the published percent.
 *   2. A rate admits a request while the bucket owes less than one second of
 *      the rate, then charges the request's bytes. A batch larger than a
 *      second's worth is admitted on a full bucket and pays for itself by
 *      holding the next requests back - a fixed one-second window would let a
 *      sender of large batches through every second.
 *   3. A refused request is counted, as dropped bytes or a throttled request,
 *      and charges nothing.
 *
 * It FAILS OPEN, like the per-key rate limiter
 * (TelemetryIngestionKeyRateLimiter): without Redis no budget can be counted
 * either way, and refusing every project's telemetry for the length of a
 * Redis blip would turn an infrastructure hiccup into permanent data loss.
 * The caller admits the request and nothing is counted for it.
 */

const DAY_KEY_PREFIX: string = "telemetry:budget:day:";
const RATE_KEY_PREFIX: string = "telemetry:budget:rate:";
const ACTIVE_SET_KEY_PREFIX: string = "telemetry:budget:active:";

const ACTIVE_SET_SCAN_COUNT: number = 1000;
const DAY_COUNTERS_PIPELINE_CHUNK: number = 500;

/*
 * A Redis outage puts every budgeted ingest request on the unavailable path,
 * so one line per interval is enough to make it visible without burying it.
 */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export enum TelemetryIngestionBudgetCounterMode {
  // Check the daily budget and the rate, then count: a sender that can retry.
  Refuse = "refuse",
  /*
   * Check the daily budget, then count. No rate: the sender cannot be asked
   * to come back (MQTT, a cloud provider's stream, OneUptime's own
   * collectors), so a burst over a rate would only be lost.
   */
  Drop = "drop",
  // Check both and count nothing: the request's size is not known yet.
  Check = "check",
  // Count only: a Check admitted the request earlier.
  Charge = "charge",
}

export enum TelemetryIngestionBudgetCounterOutcome {
  Admitted = "admitted",
  DailyBudgetExhausted = "daily-budget-exhausted",
  RateLimited = "rate-limited",
  // Redis is unreachable: the caller admits the request, counting nothing.
  CounterUnavailable = "counter-unavailable",
}

export interface TelemetryIngestionBudgetCounterScope {
  scope: TelemetryIngestionBudgetScope;
  // The project's id, or the ingestion key's.
  scopeId: string;
  dailyBudgetBytes: number | null;
  warningBytes: number | null;
  rateLimitBytesPerSecond: number | null;
}

export interface TelemetryIngestionBudgetCounterRequest {
  projectId: string;
  signalSlug: string;
  dayId: string;
  // How long a new day hash lives: until a day after its budget day ends.
  dayTtlSeconds: number;
  bytes: number;
  mode: TelemetryIngestionBudgetCounterMode;
  // The project first, then the key's when it has limits of its own.
  scopes: Array<TelemetryIngestionBudgetCounterScope>;
  nowMs: number;
}

export interface TelemetryIngestionBudgetCounterDecision {
  outcome: TelemetryIngestionBudgetCounterOutcome;
  // The scope that refused, as an index into the request's scopes.
  scopeIndex?: number | undefined;
  retryAfterSeconds?: number | undefined;
  // True on the first request refused for the day, in that scope.
  isFirstExhaustion?: boolean | undefined;
  // The scopes whose warning this request crossed.
  warningCrossedScopeIndexes?: Array<number> | undefined;
}

export interface TelemetryIngestionBudgetDayCounters {
  usedBytes: number;
  droppedBytes: number;
  droppedRequests: number;
  throttledRequests: number;
  warningCrossedAt: Date | null;
  exhaustedAt: Date | null;
  warningNoticeSentAt: Date | null;
  exhaustedNoticeSentAt: Date | null;
}

export interface TelemetryIngestionBudgetDayKeyParts {
  dayId: string;
  scope: TelemetryIngestionBudgetScope;
  scopeId: string;
  signalSlug: string;
}

export interface TelemetryIngestionBudgetActiveMember {
  projectId: string;
  scope: TelemetryIngestionBudgetScope;
  scopeId: string;
  signalSlug: string;
}

export enum TelemetryIngestionBudgetNoticeKind {
  Warning = "warning",
  Exhausted = "exhausted",
}

/*
 * KEYS[2i-1] and KEYS[2i] are scope i's day hash and rate key; KEYS[2n+1] is
 * the day's active set. ARGV: now (ms), bytes, mode, n, the day hash's TTL,
 * then per scope its daily budget, warning bytes, rate (bytes per second),
 * burst (bytes) and active-set member. 0 is "no limit" for each.
 *
 * Returns { code, scope, retry-after seconds, flags }: code 0 admitted (flags:
 * a bit per scope whose warning this request crossed), 1 the daily budget of
 * scope `scope` is used up (flags 1 on the day's first such refusal), 2 the
 * rate of scope `scope` refused it.
 */
export const BUDGET_SCRIPT: string = `
local now = tonumber(ARGV[1])
local bytes = tonumber(ARGV[2])
local mode = ARGV[3]
local n = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local active = KEYS[2 * n + 1]
local nowUs = now * 1000

local function arg(i, k)
  return ARGV[5 + (i - 1) * 5 + k]
end

local function num(i, k)
  return tonumber(arg(i, k)) or 0
end

local function touch(i)
  local day = KEYS[2 * i - 1]
  if redis.call('HSETNX', day, 'createdAt', now) == 1 then
    redis.call('EXPIRE', day, ttl)
    if redis.call('SADD', active, arg(i, 5)) == 1 then
      redis.call('EXPIRE', active, ttl)
    end
  end
end

local function readTat(i)
  local tat = tonumber(redis.call('GET', KEYS[2 * i]) or '0') or 0
  if tat < nowUs then
    tat = nowUs
  end
  return tat
end

if mode ~= 'charge' then
  for i = 1, n do
    local daily = num(i, 1)
    if daily > 0 then
      local day = KEYS[2 * i - 1]
      local used = tonumber(redis.call('HGET', day, 'used') or '0') or 0
      if used >= daily then
        touch(i)
        if bytes > 0 then
          redis.call('HINCRBY', day, 'dropped', bytes)
        end
        redis.call('HINCRBY', day, 'droppedRequests', 1)
        local first = redis.call('HSETNX', day, 'exhaustedAt', now)
        return {1, i, 0, first}
      end
    end
  end
end

if mode == 'refuse' or mode == 'check' then
  for i = 1, n do
    local rate = num(i, 3)
    if rate > 0 then
      local tat = readTat(i)
      local burstUs = num(i, 4) / rate * 1000000
      if tat - nowUs > burstUs then
        touch(i)
        redis.call('HINCRBY', KEYS[2 * i - 1], 'throttledRequests', 1)
        local wait = math.ceil((tat - nowUs - burstUs) / 1000000)
        if wait < 1 then
          wait = 1
        end
        return {2, i, wait, 0}
      end
    end
  end
end

if mode == 'check' then
  return {0, 0, 0, 0}
end

local crossed = 0
for i = 1, n do
  local day = KEYS[2 * i - 1]
  touch(i)
  local after = redis.call('HINCRBY', day, 'used', bytes)
  local warn = num(i, 2)
  if warn > 0 and after >= warn then
    if redis.call('HSETNX', day, 'warnedAt', now) == 1 then
      crossed = crossed + 2 ^ (i - 1)
    end
  end
  local rate = num(i, 3)
  if rate > 0 and mode ~= 'drop' then
    local tat = readTat(i) + bytes / rate * 1000000
    redis.call('SET', KEYS[2 * i], string.format('%.0f', tat), 'PX', math.ceil((tat - nowUs) / 1000) + 1000)
  end
end

return {0, 0, 0, crossed}
`;

/*
 * Add the difference between a body's counted size and its real one, once the
 * worker has inflated it, to each day hash that still exists (an expired
 * day's count is never recreated without its expiry). KEYS: the day hashes.
 * ARGV: the delta, now (ms), then each hash's warning bytes (0 for none).
 */
export const RECONCILE_SCRIPT: string = `
local delta = tonumber(ARGV[1])
local now = ARGV[2]
for i = 1, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    local after = redis.call('HINCRBY', KEYS[i], 'used', delta)
    local warn = tonumber(ARGV[2 + i]) or 0
    if warn > 0 and after >= warn then
      redis.call('HSETNX', KEYS[i], 'warnedAt', now)
    end
  end
end
return 1
`;

/*
 * Claim one notice of the day, on any server: true for the caller that wrote
 * the field first. Never creates a hash that has expired.
 */
export const CLAIM_NOTICE_SCRIPT: string = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
return redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2])
`;

const sha1: (script: string) => string = (script: string): string => {
  return createHash("sha1").update(script).digest("hex");
};

const BUDGET_SCRIPT_SHA: string = sha1(BUDGET_SCRIPT);
const RECONCILE_SCRIPT_SHA: string = sha1(RECONCILE_SCRIPT);
const CLAIM_NOTICE_SCRIPT_SHA: string = sha1(CLAIM_NOTICE_SCRIPT);

const DAY_FIELDS: Array<string> = [
  "used",
  "dropped",
  "droppedRequests",
  "throttledRequests",
  "warnedAt",
  "exhaustedAt",
  "warningNoticeAt",
  "exhaustedNoticeAt",
];

const NOTICE_FIELDS: Record<TelemetryIngestionBudgetNoticeKind, string> = {
  [TelemetryIngestionBudgetNoticeKind.Warning]: "warningNoticeAt",
  [TelemetryIngestionBudgetNoticeKind.Exhausted]: "exhaustedNoticeAt",
};

const toCount: (value: unknown) => number = (value: unknown): number => {
  const parsed: number = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

const toDate: (value: unknown) => Date | null = (
  value: unknown,
): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed) : null;
};

const toLimit: (value: number | null) => string = (
  value: number | null,
): string => {
  return value !== null && Number.isFinite(value) && value > 0
    ? String(Math.floor(value))
    : "0";
};

export default class TelemetryIngestionBudgetCounter {
  private static counterUnavailableLastLoggedAt: number = 0;

  public static getDayKey(data: TelemetryIngestionBudgetDayKeyParts): string {
    return `${DAY_KEY_PREFIX}${data.dayId}:${data.scope}:${data.scopeId}:${data.signalSlug}`;
  }

  public static getRateKey(data: {
    scope: TelemetryIngestionBudgetScope;
    scopeId: string;
    signalSlug: string;
  }): string {
    return `${RATE_KEY_PREFIX}${data.scope}:${data.scopeId}:${data.signalSlug}`;
  }

  public static getActiveSetKey(dayId: string): string {
    return `${ACTIVE_SET_KEY_PREFIX}${dayId}`;
  }

  public static getActiveMember(
    data: TelemetryIngestionBudgetActiveMember,
  ): string {
    return `${data.projectId}|${data.scope}|${data.scopeId}|${data.signalSlug}`;
  }

  public static parseActiveMember(
    member: string,
  ): TelemetryIngestionBudgetActiveMember | null {
    const parts: Array<string> = String(member).split("|");

    if (
      parts.length !== 4 ||
      parts.some((part: string) => {
        return !part;
      })
    ) {
      return null;
    }

    const scope: string = parts[1]!;

    if (
      scope !== TelemetryIngestionBudgetScope.Project &&
      scope !== TelemetryIngestionBudgetScope.IngestionKey
    ) {
      return null;
    }

    return {
      projectId: parts[0]!,
      scope: scope as TelemetryIngestionBudgetScope,
      scopeId: parts[2]!,
      signalSlug: parts[3]!,
    };
  }

  /*
   * Decide one request against its scopes' limits and charge it, in one
   * round trip. Never throws: an unreachable or failing Redis is
   * CounterUnavailable, which the caller admits.
   */
  public static async consume(
    request: TelemetryIngestionBudgetCounterRequest,
  ): Promise<TelemetryIngestionBudgetCounterDecision> {
    if (request.scopes.length === 0) {
      return { outcome: TelemetryIngestionBudgetCounterOutcome.Admitted };
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return this.unavailable();
    }

    const keys: Array<string> = [];
    const args: Array<string> = [
      String(Math.floor(request.nowMs)),
      String(Math.max(0, Math.floor(request.bytes))),
      request.mode,
      String(request.scopes.length),
      String(Math.max(60, Math.ceil(request.dayTtlSeconds))),
    ];

    for (const scope of request.scopes) {
      keys.push(
        this.getDayKey({
          dayId: request.dayId,
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: request.signalSlug,
        }),
        this.getRateKey({
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: request.signalSlug,
        }),
      );

      args.push(
        toLimit(scope.dailyBudgetBytes),
        toLimit(scope.warningBytes),
        toLimit(scope.rateLimitBytesPerSecond),
        // One second of the rate is the burst a full bucket allows.
        toLimit(scope.rateLimitBytesPerSecond),
        this.getActiveMember({
          projectId: request.projectId,
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: request.signalSlug,
        }),
      );
    }

    keys.push(this.getActiveSetKey(request.dayId));

    try {
      const reply: unknown = await this.runScript({
        client: client,
        script: BUDGET_SCRIPT,
        sha: BUDGET_SCRIPT_SHA,
        keys: keys,
        args: args,
      });

      return this.readDecision(reply, request.scopes.length);
    } catch (err) {
      return this.unavailable(err);
    }
  }

  /*
   * Add `deltaBytes` to each scope's count of the day: the worker settling a
   * compressed body it has now inflated. Best effort: false when it could not.
   */
  public static async reconcile(data: {
    dayId: string;
    signalSlug: string;
    scopes: Array<{
      scope: TelemetryIngestionBudgetScope;
      scopeId: string;
      warningBytes: number | null;
    }>;
    deltaBytes: number;
    nowMs: number;
  }): Promise<boolean> {
    const delta: number = Math.round(data.deltaBytes);

    if (delta === 0 || data.scopes.length === 0) {
      return true;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return false;
    }

    try {
      await this.runScript({
        client: client,
        script: RECONCILE_SCRIPT,
        sha: RECONCILE_SCRIPT_SHA,
        keys: data.scopes.map(
          (scope: {
            scope: TelemetryIngestionBudgetScope;
            scopeId: string;
          }): string => {
            return this.getDayKey({
              dayId: data.dayId,
              scope: scope.scope,
              scopeId: scope.scopeId,
              signalSlug: data.signalSlug,
            });
          },
        ),
        args: [
          String(delta),
          String(Math.floor(data.nowMs)),
          ...data.scopes.map(
            (scope: { warningBytes: number | null }): string => {
              return toLimit(scope.warningBytes);
            },
          ),
        ],
      });

      return true;
    } catch (err) {
      if (this.shouldLogCounterUnavailable()) {
        logger.warn(
          "TelemetryIngestionBudgetCounter: could not settle a compressed body's decompressed size",
        );
        logger.warn(err);
      }

      return false;
    }
  }

  /*
   * The counters of many day hashes, in as few round trips as possible. The
   * answer is positional (values[i] is days[i]); a hash that does not exist
   * reads as all zero. null when Redis is unavailable or any read fails: a
   * counter that could not be read must never be shown or posted as 0.
   */
  public static async readDayCounters(
    days: Array<TelemetryIngestionBudgetDayKeyParts>,
  ): Promise<Array<TelemetryIngestionBudgetDayCounters> | null> {
    if (days.length === 0) {
      return [];
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    const counters: Array<TelemetryIngestionBudgetDayCounters> = [];

    try {
      for (
        let start: number = 0;
        start < days.length;
        start += DAY_COUNTERS_PIPELINE_CHUNK
      ) {
        const chunk: Array<TelemetryIngestionBudgetDayKeyParts> = days.slice(
          start,
          start + DAY_COUNTERS_PIPELINE_CHUNK,
        );

        const pipeline: ReturnType<ClientType["pipeline"]> = client.pipeline();

        for (const day of chunk) {
          pipeline.hmget(this.getDayKey(day), ...DAY_FIELDS);
        }

        const results: Array<[Error | null, unknown]> | null =
          await pipeline.exec();

        if (!results || results.length !== chunk.length) {
          throw new Error(
            `The pipeline answered ${results ? results.length : "nothing"} for ${chunk.length} day counters`,
          );
        }

        for (const [error, values] of results) {
          if (error) {
            throw error;
          }

          const fields: Array<unknown> = Array.isArray(values) ? values : [];

          counters.push({
            usedBytes: toCount(fields[0]),
            droppedBytes: toCount(fields[1]),
            droppedRequests: toCount(fields[2]),
            throttledRequests: toCount(fields[3]),
            warningCrossedAt: toDate(fields[4]),
            exhaustedAt: toDate(fields[5]),
            warningNoticeSentAt: toDate(fields[6]),
            exhaustedNoticeSentAt: toDate(fields[7]),
          });
        }
      }
    } catch (err) {
      logger.warn(
        `TelemetryIngestionBudgetCounter: could not read ${days.length} budget counter(s)`,
      );
      logger.warn(err);
      return null;
    }

    return counters;
  }

  /*
   * Every scope that counted anything on a budget day. null when the set
   * could not be read.
   */
  public static async listActiveMembers(
    dayId: string,
  ): Promise<Array<TelemetryIngestionBudgetActiveMember> | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    const members: Map<string, TelemetryIngestionBudgetActiveMember> =
      new Map();

    try {
      let cursor: string = "0";

      do {
        const [nextCursor, batch]: [string, Array<string>] = await client.sscan(
          this.getActiveSetKey(dayId),
          cursor,
          "COUNT",
          ACTIVE_SET_SCAN_COUNT,
        );

        for (const raw of batch) {
          const member: TelemetryIngestionBudgetActiveMember | null =
            this.parseActiveMember(raw);

          if (member) {
            members.set(raw, member);
          }
        }

        cursor = nextCursor;
      } while (cursor !== "0");
    } catch (err) {
      logger.warn(
        `TelemetryIngestionBudgetCounter: could not list the scopes counted on budget day ${dayId}`,
      );
      logger.warn(err);
      return null;
    }

    return Array.from(members.values());
  }

  /*
   * Claim the day's warning or exhaustion notice for one scope and signal:
   * true for the one caller, on any server, that may send it.
   */
  public static async claimNotice(data: {
    day: TelemetryIngestionBudgetDayKeyParts;
    kind: TelemetryIngestionBudgetNoticeKind;
    nowMs: number;
  }): Promise<boolean> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return false;
    }

    try {
      const reply: unknown = await this.runScript({
        client: client,
        script: CLAIM_NOTICE_SCRIPT,
        sha: CLAIM_NOTICE_SCRIPT_SHA,
        keys: [this.getDayKey(data.day)],
        args: [NOTICE_FIELDS[data.kind], String(Math.floor(data.nowMs))],
      });

      return Number(reply) === 1;
    } catch (err) {
      logger.warn(
        "TelemetryIngestionBudgetCounter: could not claim a budget notice",
      );
      logger.warn(err);
      return false;
    }
  }

  /*
   * EVALSHA, and EVAL the first time a server sees the script (NOSCRIPT):
   * the script text crosses the wire once per Redis restart, not per request.
   */
  private static async runScript(data: {
    client: ClientType;
    script: string;
    sha: string;
    keys: Array<string>;
    args: Array<string>;
  }): Promise<unknown> {
    try {
      return await data.client.evalsha(
        data.sha,
        data.keys.length,
        ...data.keys,
        ...data.args,
      );
    } catch (err) {
      const message: string = err instanceof Error ? err.message : String(err);

      if (!message.includes("NOSCRIPT")) {
        throw err;
      }

      return await data.client.eval(
        data.script,
        data.keys.length,
        ...data.keys,
        ...data.args,
      );
    }
  }

  private static readDecision(
    reply: unknown,
    scopeCount: number,
  ): TelemetryIngestionBudgetCounterDecision {
    if (!Array.isArray(reply) || reply.length < 4) {
      throw new Error(
        `The budget script answered ${JSON.stringify(reply)}, not four numbers`,
      );
    }

    const code: number = Number(reply[0]);
    const scopeIndex: number = Number(reply[1]) - 1;
    const retryAfterSeconds: number = Number(reply[2]);
    const flags: number = Number(reply[3]);

    if (code === 1) {
      return {
        outcome: TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
        scopeIndex: scopeIndex,
        isFirstExhaustion: flags === 1,
      };
    }

    if (code === 2) {
      return {
        outcome: TelemetryIngestionBudgetCounterOutcome.RateLimited,
        scopeIndex: scopeIndex,
        retryAfterSeconds: Math.max(1, retryAfterSeconds),
      };
    }

    const crossed: Array<number> = [];

    for (let index: number = 0; index < scopeCount; index++) {
      if (Math.floor(flags / Math.pow(2, index)) % 2 === 1) {
        crossed.push(index);
      }
    }

    return {
      outcome: TelemetryIngestionBudgetCounterOutcome.Admitted,
      warningCrossedScopeIndexes: crossed,
    };
  }

  private static unavailable(
    err?: unknown,
  ): TelemetryIngestionBudgetCounterDecision {
    if (this.shouldLogCounterUnavailable()) {
      logger.warn(
        "TelemetryIngestionBudgetCounter: the budget counters are unavailable, so telemetry is admitted without being counted against its budget",
      );

      if (err) {
        logger.warn(err);
      }
    }

    return {
      outcome: TelemetryIngestionBudgetCounterOutcome.CounterUnavailable,
    };
  }

  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now - this.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    this.counterUnavailableLastLoggedAt = now;

    return true;
  }
}
