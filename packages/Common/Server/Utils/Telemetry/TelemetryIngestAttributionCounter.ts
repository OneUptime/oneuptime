import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";
import TelemetryIngestionBudgetCounter from "./TelemetryIngestionBudgetCounter";
import { TelemetryIngestionBudgetScope } from "../../../Types/Telemetry/TelemetryIngestionBudget";
import { createHash } from "crypto";

/*
 * The counters a telemetry batch is attributed to once the worker has filed
 * its resources under their services (TelemetryIngestAttribution), in the
 * same Valkey as the ingestion budget counters, written by ONE script per
 * batch (SETTLE_SCRIPT):
 *
 *   - the day hashes of the batch's team and label budgets (#6386), in the
 *     budget counters' own format (TelemetryIngestionBudgetCounter.getDay-
 *     Key, scope "team" or "label"), so the status API, the budget metrics
 *     and the owners' emails read them as they read a project's or a key's;
 *   - the day hashes the request path charged for the batch (the project's,
 *     and its key's), less what a team or label budget dropped: what is
 *     dropped is not counted against the project, so one team's runaway
 *     service cannot use up the budget of every other;
 *   - the five-minute usage counters behind oneuptime.telemetry.usage.bytes
 *     (#6355): a hash per bucket and project, one field per signal and
 *     resource, and a set per bucket of the projects that counted anything,
 *     so the publishing sweep reads only those.
 *
 * Like the budget counters it fails open: a batch Redis cannot be reached
 * for is stored, uncounted, and the failure logged at most once a minute.
 */

const USAGE_KEY_PREFIX: string = "telemetry:usage:bucket:";
const USAGE_ACTIVE_SET_KEY_PREFIX: string = "telemetry:usage:active:";

// How long a usage bucket, written every batch, is kept for the sweep.
export const TELEMETRY_USAGE_COUNTER_TTL_SECONDS: number = 60 * 60;

// The minutes one usage bucket covers: the sweep's interval.
export const TELEMETRY_USAGE_BUCKET_MINUTES: number = 5;

const USAGE_BUCKET_MS: number = TELEMETRY_USAGE_BUCKET_MINUTES * 60 * 1000;

const USAGE_SCAN_COUNT: number = 1000;

const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

/*
 * KEYS: the n team and label day hashes, the m day hashes to refund, the
 * budgets' active set, the usage hash and the usage active set.
 * ARGV: now (ms), the day hashes' TTL, n, m, the refund (bytes), the usage
 * TTL, the number k of usage fields, the project's id; then per scope its
 * admitted bytes, dropped bytes, dropped requests, daily budget, warning
 * bytes (0 for none) and active-set member; then k pairs of a usage field
 * and its bytes. Returns each scope's used bytes once charged.
 */
export const SETTLE_SCRIPT: string = `
local now = ARGV[1]
local ttl = tonumber(ARGV[2])
local n = tonumber(ARGV[3])
local m = tonumber(ARGV[4])
local refund = tonumber(ARGV[5]) or 0
local usageTtl = tonumber(ARGV[6])
local k = tonumber(ARGV[7])
local projectMember = ARGV[8]
local budgetActive = KEYS[n + m + 1]
local usageKey = KEYS[n + m + 2]
local usageActive = KEYS[n + m + 3]
local base = 8
local used = {}

for i = 1, n do
  local o = base + (i - 1) * 6
  local admitted = tonumber(ARGV[o + 1]) or 0
  local dropped = tonumber(ARGV[o + 2]) or 0
  local droppedRequests = tonumber(ARGV[o + 3]) or 0
  local warn = tonumber(ARGV[o + 5]) or 0
  local day = KEYS[i]
  if redis.call('HSETNX', day, 'createdAt', now) == 1 then
    redis.call('EXPIRE', day, ttl)
    if redis.call('SADD', budgetActive, ARGV[o + 6]) == 1 then
      redis.call('EXPIRE', budgetActive, ttl)
    end
  end
  local after = tonumber(redis.call('HGET', day, 'used') or '0') or 0
  if admitted > 0 then
    after = redis.call('HINCRBY', day, 'used', admitted)
    if warn > 0 and after >= warn then
      redis.call('HSETNX', day, 'warnedAt', now)
    end
  end
  if dropped > 0 then
    redis.call('HINCRBY', day, 'dropped', dropped)
  end
  if droppedRequests > 0 then
    redis.call('HINCRBY', day, 'droppedRequests', droppedRequests)
    redis.call('HSETNX', day, 'exhaustedAt', now)
  end
  used[i] = after
end

if refund > 0 then
  for j = 1, m do
    local day = KEYS[n + j]
    if redis.call('EXISTS', day) == 1 then
      local after = redis.call('HINCRBY', day, 'used', -refund)
      if after < 0 then
        redis.call('HSET', day, 'used', 0)
      end
    end
  end
end

if k > 0 then
  local u = base + n * 6
  for j = 1, k do
    local bytes = tonumber(ARGV[u + (j - 1) * 2 + 2]) or 0
    if bytes > 0 then
      redis.call('HINCRBY', usageKey, ARGV[u + (j - 1) * 2 + 1], bytes)
    end
  end
  redis.call('EXPIRE', usageKey, usageTtl)
  if redis.call('SADD', usageActive, projectMember) == 1 then
    redis.call('EXPIRE', usageActive, usageTtl)
  end
end

return used
`;

const SETTLE_SCRIPT_SHA: string = createHash("sha1")
  .update(SETTLE_SCRIPT)
  .digest("hex");

// One team's or label's share of a batch.
export interface TelemetryIngestAttributionScopeCharge {
  scope: TelemetryIngestionBudgetScope;
  // The team's id, or the label's.
  scopeId: string;
  admittedBytes: number;
  droppedBytes: number;
  // 1 when the batch dropped any of its telemetry, else 0.
  droppedRequests: number;
  dailyBudgetBytes: number | null;
  warningBytes: number | null;
}

// One resource's usage in a batch: its usage field and its bytes.
export interface TelemetryIngestAttributionUsage {
  field: string;
  bytes: number;
}

export interface TelemetryIngestAttributionSettle {
  projectId: string;
  signalSlug: string;
  dayId: string;
  dayTtlSeconds: number;
  nowMs: number;
  scopes: Array<TelemetryIngestAttributionScopeCharge>;
  // What the request path counted that a team or label budget dropped.
  refund: {
    bytes: number;
    scopes: Array<{ scope: TelemetryIngestionBudgetScope; scopeId: string }>;
  } | null;
  usage: Array<TelemetryIngestAttributionUsage>;
}

// A usage field read back: what one resource sent of one signal.
export interface TelemetryUsageCounterEntry {
  signalSlug: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  bytes: number;
}

const toCount: (value: number) => string = (value: number): string => {
  return Number.isFinite(value) && value > 0 ? String(Math.floor(value)) : "0";
};

export default class TelemetryIngestAttributionCounter {
  private static counterUnavailableLastLoggedAt: number = 0;

  // The five-minute bucket an instant is in, as its keys name it.
  public static getUsageBucketId(nowMs: number): string {
    return String(Math.floor(nowMs / USAGE_BUCKET_MS));
  }

  // When a bucket starts.
  public static getUsageBucketStart(bucketId: string): Date {
    return new Date(Number(bucketId) * USAGE_BUCKET_MS);
  }

  public static getUsageKey(bucketId: string, projectId: string): string {
    return `${USAGE_KEY_PREFIX}${bucketId}:${projectId}`;
  }

  public static getUsageActiveSetKey(bucketId: string): string {
    return `${USAGE_ACTIVE_SET_KEY_PREFIX}${bucketId}`;
  }

  /*
   * A resource's usage field: its signal, kind, id and name, as JSON, so a
   * name can hold any character.
   */
  public static getUsageField(data: {
    signalSlug: string;
    resourceType: string;
    resourceId: string;
    resourceName: string;
  }): string {
    return JSON.stringify([
      data.signalSlug,
      data.resourceType,
      data.resourceId,
      data.resourceName,
    ]);
  }

  // A usage field read back, or null when it is not one.
  public static parseUsageField(
    field: string,
    bytes: unknown,
  ): TelemetryUsageCounterEntry | null {
    try {
      const parsed: unknown = JSON.parse(field);
      const count: number = Number(bytes);

      if (
        !Array.isArray(parsed) ||
        parsed.length !== 4 ||
        !parsed.every((part: unknown): boolean => {
          return typeof part === "string";
        }) ||
        !parsed[0] ||
        !parsed[2] ||
        !Number.isFinite(count) ||
        count <= 0
      ) {
        return null;
      }

      return {
        signalSlug: parsed[0] as string,
        resourceType: parsed[1] as string,
        resourceId: parsed[2] as string,
        resourceName: parsed[3] as string,
        bytes: count,
      };
    } catch {
      return null;
    }
  }

  /*
   * Charge one batch's attribution, in one round trip. Returns each team or
   * label scope's used bytes once charged, positionally, or null when Redis
   * could not be reached (nothing was counted). Never throws.
   */
  public static async settle(
    data: TelemetryIngestAttributionSettle,
  ): Promise<Array<number> | null> {
    const refund: TelemetryIngestAttributionSettle["refund"] =
      data.refund && data.refund.bytes > 0 ? data.refund : null;

    if (data.scopes.length === 0 && !refund && data.usage.length === 0) {
      return [];
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      this.logUnavailable();
      return null;
    }

    const bucketId: string = this.getUsageBucketId(data.nowMs);
    const keys: Array<string> = [];
    const args: Array<string> = [
      String(Math.floor(data.nowMs)),
      String(Math.max(60, Math.ceil(data.dayTtlSeconds))),
      String(data.scopes.length),
      String(refund ? refund.scopes.length : 0),
      toCount(refund ? refund.bytes : 0),
      String(TELEMETRY_USAGE_COUNTER_TTL_SECONDS),
      String(data.usage.length),
      data.projectId,
    ];

    for (const scope of data.scopes) {
      keys.push(
        TelemetryIngestionBudgetCounter.getDayKey({
          dayId: data.dayId,
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: data.signalSlug,
        }),
      );

      args.push(
        toCount(scope.admittedBytes),
        toCount(scope.droppedBytes),
        toCount(scope.droppedRequests),
        toCount(scope.dailyBudgetBytes ?? 0),
        toCount(scope.warningBytes ?? 0),
        TelemetryIngestionBudgetCounter.getActiveMember({
          projectId: data.projectId,
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: data.signalSlug,
        }),
      );
    }

    for (const scope of refund ? refund.scopes : []) {
      keys.push(
        TelemetryIngestionBudgetCounter.getDayKey({
          dayId: data.dayId,
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: data.signalSlug,
        }),
      );
    }

    keys.push(
      TelemetryIngestionBudgetCounter.getActiveSetKey(data.dayId),
      this.getUsageKey(bucketId, data.projectId),
      this.getUsageActiveSetKey(bucketId),
    );

    for (const usage of data.usage) {
      args.push(usage.field, toCount(usage.bytes));
    }

    try {
      const reply: unknown = await this.runScript(client, keys, args);

      if (!Array.isArray(reply)) {
        throw new Error(
          `The attribution script answered ${JSON.stringify(reply)}`,
        );
      }

      return data.scopes.map((_scope: unknown, index: number): number => {
        const used: number = Number(reply[index]);

        return Number.isFinite(used) ? used : 0;
      });
    } catch (err) {
      this.logUnavailable(err);
      return null;
    }
  }

  // The projects that counted any usage in a bucket, or null when unreadable.
  public static async listUsageProjects(
    bucketId: string,
  ): Promise<Array<string> | null> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    const projects: Set<string> = new Set<string>();

    try {
      let cursor: string = "0";

      do {
        const [nextCursor, batch]: [string, Array<string>] = await client.sscan(
          this.getUsageActiveSetKey(bucketId),
          cursor,
          "COUNT",
          USAGE_SCAN_COUNT,
        );

        for (const projectId of batch) {
          if (projectId) {
            projects.add(projectId);
          }
        }

        cursor = nextCursor;
      } while (cursor !== "0");
    } catch (err) {
      logger.warn(
        `TelemetryIngestAttributionCounter: could not list the projects that counted usage in bucket ${bucketId}`,
      );
      logger.warn(err);
      return null;
    }

    return Array.from(projects);
  }

  /*
   * Each project's usage in a bucket, in one round trip, or null when it
   * could not be read: a count that could not be read is never published.
   */
  public static async readUsage(
    bucketId: string,
    projectIds: Array<string>,
  ): Promise<Map<string, Array<TelemetryUsageCounterEntry>> | null> {
    const usage: Map<string, Array<TelemetryUsageCounterEntry>> = new Map();

    if (projectIds.length === 0) {
      return usage;
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    try {
      const pipeline: ReturnType<ClientType["pipeline"]> = client.pipeline();

      for (const projectId of projectIds) {
        pipeline.hgetall(this.getUsageKey(bucketId, projectId));
      }

      const results: Array<[Error | null, unknown]> | null =
        await pipeline.exec();

      if (!results || results.length !== projectIds.length) {
        throw new Error(
          `The pipeline answered ${results ? results.length : "nothing"} for ${projectIds.length} usage counters`,
        );
      }

      results.forEach(
        ([error, value]: [Error | null, unknown], index: number): void => {
          if (error) {
            throw error;
          }

          const entries: Array<TelemetryUsageCounterEntry> = [];

          for (const [field, bytes] of Object.entries(
            (value as Record<string, string>) || {},
          )) {
            const entry: TelemetryUsageCounterEntry | null =
              this.parseUsageField(field, bytes);

            if (entry) {
              entries.push(entry);
            }
          }

          usage.set(projectIds[index]!, entries);
        },
      );
    } catch (err) {
      logger.warn(
        `TelemetryIngestAttributionCounter: could not read ${projectIds.length} project(s)' usage in bucket ${bucketId}`,
      );
      logger.warn(err);
      return null;
    }

    return usage;
  }

  /*
   * Forget a bucket's counts once they are published, so a sweep that
   * runs again does not publish them twice. Best effort.
   */
  public static async deleteUsage(
    bucketId: string,
    projectIds: Array<string>,
  ): Promise<void> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected() || projectIds.length === 0) {
      return;
    }

    try {
      const pipeline: ReturnType<ClientType["pipeline"]> = client.pipeline();

      for (const projectId of projectIds) {
        pipeline.del(this.getUsageKey(bucketId, projectId));
        pipeline.srem(this.getUsageActiveSetKey(bucketId), projectId);
      }

      await pipeline.exec();
    } catch (err) {
      logger.warn(
        `TelemetryIngestAttributionCounter: could not forget bucket ${bucketId}'s published usage`,
      );
      logger.warn(err);
    }
  }

  private static async runScript(
    client: ClientType,
    keys: Array<string>,
    args: Array<string>,
  ): Promise<unknown> {
    try {
      return await client.evalsha(
        SETTLE_SCRIPT_SHA,
        keys.length,
        ...keys,
        ...args,
      );
    } catch (err) {
      const message: string = err instanceof Error ? err.message : String(err);

      if (!message.includes("NOSCRIPT")) {
        throw err;
      }

      return await client.eval(SETTLE_SCRIPT, keys.length, ...keys, ...args);
    }
  }

  private static logUnavailable(err?: unknown): void {
    const now: number = Date.now();

    if (
      now - this.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return;
    }

    this.counterUnavailableLastLoggedAt = now;
    logger.warn(
      "TelemetryIngestAttributionCounter: the counters are unavailable, so a batch's team and label budgets and usage were not counted",
    );

    if (err) {
      logger.warn(err);
    }
  }
}
