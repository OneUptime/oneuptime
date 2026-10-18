/*
 * An in-memory stand-in for the ioredis client, for the commands the rate
 * limits count with (ClientRateLimitCounter): INCR, GET and EXPIRE, sent in
 * pipelines. Each does what Redis does with it - INCR answers the new count,
 * GET the count as a string or null for no key, EXPIRE records the TTL and
 * answers 1 (0 for no key) - and a pipeline answers each command as ioredis
 * does, [error, value] in order, a failed command's error in its place
 * rather than thrown.
 *
 * Every pipeline sent is kept, command by command, so a suite can see how
 * many round trips a request cost and which keys it read or counted.
 * `failCommand` fails one kind of command (a half-broken connection),
 * `failNextExec` rejects a whole pipeline (a dropped connection), and
 * `answerNextExecWith` hands back a malformed answer. The real-Valkey suite
 * (Utils/RateLimit/ClientRateLimitCounterValkey.test.ts) checks the same
 * behaviour against a real server.
 */

export type FakeCounterCommandName = "incr" | "get" | "expire";

export interface FakeCounterCommand {
  name: FakeCounterCommandName;
  key: string;
}

type QueuedCommand = {
  command: FakeCounterCommand;
  run: () => unknown;
};

export class FakeCounterPipeline {
  private readonly commands: Array<QueuedCommand> = [];

  public constructor(private readonly redis: FakeCounterRedis) {}

  public incr(key: string): FakeCounterPipeline {
    this.commands.push({
      command: { name: "incr", key: key },
      run: (): unknown => {
        return this.redis.runIncr(key);
      },
    });

    return this;
  }

  public get(key: string): FakeCounterPipeline {
    this.commands.push({
      command: { name: "get", key: key },
      run: (): unknown => {
        return this.redis.runGet(key);
      },
    });

    return this;
  }

  public expire(key: string, ttlSeconds: number): FakeCounterPipeline {
    this.commands.push({
      command: { name: "expire", key: key },
      run: (): unknown => {
        return this.redis.runExpire(key, ttlSeconds);
      },
    });

    return this;
  }

  public async exec(): Promise<Array<[Error | null, unknown]> | unknown> {
    this.redis.sent.push(
      this.commands.map((queued: QueuedCommand): FakeCounterCommand => {
        return queued.command;
      }),
    );

    if (this.redis.failNextExec) {
      const error: Error = this.redis.failNextExec;
      this.redis.failNextExec = null;
      throw error;
    }

    if (this.redis.answerNextExecWith !== undefined) {
      const answer: unknown = this.redis.answerNextExecWith;
      this.redis.answerNextExecWith = undefined;
      return answer;
    }

    return this.commands.map(
      (queued: QueuedCommand): [Error | null, unknown] => {
        const failure: Error | null = this.redis.failCommand
          ? this.redis.failCommand(queued.command)
          : null;

        if (failure) {
          return [failure, null];
        }

        return [null, queued.run()];
      },
    );
  }
}

export default class FakeCounterRedis {
  public readonly counters: Map<string, number> = new Map<string, number>();

  // Every TTL set on a key, in order.
  public readonly expiries: Map<string, Array<number>> = new Map<
    string,
    Array<number>
  >();

  // Every pipeline sent, as the commands it held.
  public readonly sent: Array<Array<FakeCounterCommand>> = [];

  public failNextExec: Error | null = null;
  public answerNextExecWith: unknown = undefined;
  public failCommand: ((command: FakeCounterCommand) => Error | null) | null =
    null;

  // A value GET answers for a key in place of its count, as a broken store might.
  public readonly storedValues: Map<string, unknown> = new Map<
    string,
    unknown
  >();

  public pipeline(): FakeCounterPipeline {
    return new FakeCounterPipeline(this);
  }

  public runIncr(key: string): number {
    const next: number = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  public runGet(key: string): unknown {
    if (this.storedValues.has(key)) {
      return this.storedValues.get(key);
    }

    const count: number | undefined = this.counters.get(key);

    return count === undefined ? null : String(count);
  }

  public runExpire(key: string, ttlSeconds: number): number {
    if (!this.counters.has(key)) {
      return 0;
    }

    this.expiries.set(key, [...(this.expiries.get(key) || []), ttlSeconds]);

    return 1;
  }

  public count(key: string): number {
    return this.counters.get(key) || 0;
  }

  public keys(): Array<string> {
    return Array.from(this.counters.keys());
  }

  // The keys whose name holds `fragment`.
  public keysHolding(fragment: string): Array<string> {
    return this.keys().filter((key: string): boolean => {
      return key.includes(fragment);
    });
  }

  // The commands of every pipeline sent, flattened.
  public commandsSent(
    name?: FakeCounterCommandName,
  ): Array<FakeCounterCommand> {
    return this.sent.flat().filter((command: FakeCounterCommand): boolean => {
      return name === undefined || command.name === name;
    });
  }

  public reset(): void {
    this.counters.clear();
    this.expiries.clear();
    this.storedValues.clear();
    this.sent.length = 0;
    this.failNextExec = null;
    this.answerNextExecWith = undefined;
    this.failCommand = null;
  }
}
