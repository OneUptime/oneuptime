/*
 * An in-memory stand-in for the ioredis client, for the commands
 * ExpoPushReceiptQueue uses: sorted sets (ZADD, ZRANGEBYSCORE with LIMIT,
 * ZREM, ZREMRANGEBYSCORE, ZREMRANGEBYRANK), PEXPIRE, SET ... EX, GET, and
 * pipelines, with Redis's own semantics where the queue depends on them:
 * members ordered by score and then by member, "-inf" / "+inf" and "("
 * exclusive bounds, negative ranks, and a pipeline that answers each command
 * as [error, result] in order.
 *
 * `failing` makes a command throw (a half-broken connection), and
 * `beforeZrem` lets a test act between a ZRANGEBYSCORE and the ZREMs that
 * follow it - another worker taking the same receipts. The real-Valkey suite
 * (ExpoPushReceiptQueueValkey.test.ts) checks the same behaviour against a
 * real server.
 */

type Bound = { value: number; exclusive: boolean };

function parseBound(raw: number | string, isMin: boolean): Bound {
  if (typeof raw === "number") {
    return { value: raw, exclusive: false };
  }

  if (raw === "-inf") {
    return { value: -Infinity, exclusive: false };
  }

  if (raw === "+inf" || raw === "inf") {
    return { value: Infinity, exclusive: false };
  }

  if (raw.startsWith("(")) {
    return { value: Number(raw.substring(1)), exclusive: true };
  }

  const value: number = Number(raw);

  if (Number.isNaN(value)) {
    throw new Error(
      `ERR ${isMin ? "min" : "max"} or max is not a float: ${raw}`,
    );
  }

  return { value: value, exclusive: false };
}

function withinBounds(score: number, min: Bound, max: Bound): boolean {
  const aboveMin: boolean = min.exclusive
    ? score > min.value
    : score >= min.value;
  const belowMax: boolean = max.exclusive
    ? score < max.value
    : score <= max.value;

  return aboveMin && belowMax;
}

export type FakeRedisCommand =
  | "zadd"
  | "zrangebyscore"
  | "zrem"
  | "zremrangebyscore"
  | "zremrangebyrank"
  | "pexpire"
  | "set"
  | "get"
  | "exec";

export class FakePipeline {
  private readonly commands: Array<() => Promise<unknown>> = [];

  public constructor(private readonly redis: FakeSortedSetRedis) {}

  public zadd(key: string, score: number | string, member: string): this {
    this.commands.push(() => {
      return this.redis.zadd(key, score, member);
    });
    return this;
  }

  public zrem(key: string, ...members: Array<string>): this {
    this.commands.push(() => {
      return this.redis.zrem(key, ...members);
    });
    return this;
  }

  public zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): this {
    this.commands.push(() => {
      return this.redis.zremrangebyscore(key, min, max);
    });
    return this;
  }

  public zremrangebyrank(key: string, start: number, stop: number): this {
    this.commands.push(() => {
      return this.redis.zremrangebyrank(key, start, stop);
    });
    return this;
  }

  public pexpire(key: string, milliseconds: number): this {
    this.commands.push(() => {
      return this.redis.pexpire(key, milliseconds);
    });
    return this;
  }

  public async exec(): Promise<Array<[Error | null, unknown]>> {
    this.redis.calls.push("exec");

    if (this.redis.failing.has("exec")) {
      throw new Error("exec failed");
    }

    const results: Array<[Error | null, unknown]> = [];

    for (const command of this.commands) {
      try {
        results.push([null, await command()]);
      } catch (error) {
        results.push([error as Error, null]);
      }
    }

    return results;
  }
}

export default class FakeSortedSetRedis {
  // key -> member -> score
  public readonly sortedSets: Map<string, Map<string, number>> = new Map();
  public readonly strings: Map<string, { value: string; ttlSeconds: number }> =
    new Map();
  public readonly expiries: Map<string, number> = new Map();

  // Every command run, in order (pipelined ones included).
  public readonly calls: Array<FakeRedisCommand> = [];

  public readonly failing: Set<FakeRedisCommand> = new Set();

  /*
   * Called with the members a ZRANGEBYSCORE returned, before anything else
   * runs: a test removes some, as another worker would.
   */
  public beforeZrem: ((members: Array<string>) => void) | null = null;

  private record(command: FakeRedisCommand): void {
    this.calls.push(command);

    if (this.failing.has(command)) {
      throw new Error(`${command} failed`);
    }
  }

  private setOf(key: string): Map<string, number> {
    let set: Map<string, number> | undefined = this.sortedSets.get(key);

    if (!set) {
      set = new Map<string, number>();
      this.sortedSets.set(key, set);
    }

    return set;
  }

  // The set's members as Redis orders them: by score, then by member.
  public ordered(key: string): Array<[string, number]> {
    return Array.from(this.sortedSets.get(key)?.entries() || []).sort(
      (a: [string, number], b: [string, number]): number => {
        if (a[1] !== b[1]) {
          return a[1] - b[1];
        }

        return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
      },
    );
  }

  public zcard(key: string): number {
    return this.sortedSets.get(key)?.size || 0;
  }

  public score(key: string, member: string): number | undefined {
    return this.sortedSets.get(key)?.get(member);
  }

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public async zadd(
    key: string,
    score: number | string,
    member: string,
  ): Promise<number> {
    this.record("zadd");

    const set: Map<string, number> = this.setOf(key);
    const isNew: boolean = !set.has(member);

    set.set(member, Number(score));

    return isNew ? 1 : 0;
  }

  public async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    limit?: "LIMIT",
    offset?: number,
    count?: number,
  ): Promise<Array<string>> {
    this.record("zrangebyscore");

    const minBound: Bound = parseBound(min, true);
    const maxBound: Bound = parseBound(max, false);

    let members: Array<string> = this.ordered(key)
      .filter((entry: [string, number]): boolean => {
        return withinBounds(entry[1], minBound, maxBound);
      })
      .map((entry: [string, number]): string => {
        return entry[0];
      });

    if (limit === "LIMIT") {
      const start: number = offset || 0;
      members =
        count === undefined || count < 0
          ? members.slice(start)
          : members.slice(start, start + count);
    }

    if (this.beforeZrem) {
      const hook: (members: Array<string>) => void = this.beforeZrem;
      this.beforeZrem = null;
      hook(members);
    }

    return members;
  }

  public async zrem(key: string, ...members: Array<string>): Promise<number> {
    this.record("zrem");

    const set: Map<string, number> | undefined = this.sortedSets.get(key);
    let removed: number = 0;

    for (const member of members) {
      if (set?.delete(member)) {
        removed++;
      }
    }

    return removed;
  }

  public async zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<number> {
    this.record("zremrangebyscore");

    const minBound: Bound = parseBound(min, true);
    const maxBound: Bound = parseBound(max, false);
    const set: Map<string, number> | undefined = this.sortedSets.get(key);
    let removed: number = 0;

    for (const [member, score] of this.ordered(key)) {
      if (withinBounds(score, minBound, maxBound)) {
        set?.delete(member);
        removed++;
      }
    }

    return removed;
  }

  public async zremrangebyrank(
    key: string,
    start: number,
    stop: number,
  ): Promise<number> {
    this.record("zremrangebyrank");

    const ordered: Array<[string, number]> = this.ordered(key);
    const size: number = ordered.length;

    let from: number = start < 0 ? size + start : start;
    let to: number = stop < 0 ? size + stop : stop;

    from = Math.max(0, from);
    to = Math.min(size - 1, to);

    if (from > to || size === 0) {
      return 0;
    }

    const set: Map<string, number> | undefined = this.sortedSets.get(key);

    for (let index: number = from; index <= to; index++) {
      set?.delete(ordered[index]![0]);
    }

    return to - from + 1;
  }

  public async pexpire(key: string, milliseconds: number): Promise<number> {
    this.record("pexpire");

    if (!this.sortedSets.has(key) && !this.strings.has(key)) {
      return 0;
    }

    this.expiries.set(key, milliseconds);

    return 1;
  }

  public async set(
    key: string,
    value: string,
    mode: string,
    ttlSeconds: number,
  ): Promise<string> {
    this.record("set");

    if (mode !== "EX") {
      throw new Error(`Unexpected SET mode ${mode}`);
    }

    this.strings.set(key, { value: value, ttlSeconds: ttlSeconds });

    return "OK";
  }

  public async get(key: string): Promise<string | null> {
    this.record("get");

    return this.strings.get(key)?.value ?? null;
  }
}
