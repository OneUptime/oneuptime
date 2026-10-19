/*
 * An in-memory stand-in for the ioredis client, for the commands the rate
 * limits count with (ClientRateLimitCounter): INCR, DECR, GET and EXPIRE,
 * sent in pipelines. Each does what Redis does with it - INCR and DECR
 * answer the new count (a key that is not there counts from 0), GET the
 * count as a string or null for no key, EXPIRE records the TTL and answers 1
 * (0 for no key) - and a pipeline answers each command as ioredis does,
 * [error, value] in order, a failed command's error in its place rather
 * than thrown.
 *
 * Every pipeline sent is kept, command by command, so a suite can see how
 * many round trips a request cost and which keys it read or counted.
 * `failCommand` fails one kind of command (a half-broken connection),
 * `failNextExec` rejects a whole pipeline (a dropped connection), and
 * `answerNextExecWith` hands back a malformed answer. The real-Valkey suite
 * (Utils/RateLimit/ClientRateLimitCounterValkey.test.ts) checks the same
 * behaviour against a real server.
 *
 * It also runs the one script ClientRateLimitCounter.countDifferent sends
 * (DIFFERENT_VALUES_SCRIPT), as EVAL does: a set of values per key, checked
 * and added to in one step, each set's TTL set by the call that made it.
 * Each evaluation is kept in `sent` as a round trip of its own, a single
 * "eval" command naming its keys; `failCommand`, `failNextExec` and
 * `answerNextExecWith` apply to it as to a pipeline. Any other script is
 * refused, so a suite never passes against a script the stand-in does not
 * know. The real-Valkey suite runs the script itself.
 */

import { DIFFERENT_VALUES_SCRIPT } from "../../../../Server/Utils/RateLimit/ClientRateLimitCounter";

export type FakeCounterCommandName =
  | "incr"
  | "decr"
  | "get"
  | "expire"
  | "eval";

export interface FakeCounterCommand {
  name: FakeCounterCommandName;
  key: string;
  // An eval's keys, in order (`key` is the first of them).
  keys?: Array<string>;
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

  public decr(key: string): FakeCounterPipeline {
    this.commands.push({
      command: { name: "decr", key: key },
      run: (): unknown => {
        return this.redis.runDecr(key);
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

  // The sets DIFFERENT_VALUES_SCRIPT keeps, by key.
  public readonly sets: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

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

  /*
   * EVAL, for DIFFERENT_VALUES_SCRIPT alone: rejects as a dropped
   * connection would when failNextExec or failCommand says so, hands back
   * answerNextExecWith when it is set, and otherwise answers as the script
   * does.
   */
  public async eval(
    script: string,
    numberOfKeys: number,
    ...keysAndArguments: Array<string | number>
  ): Promise<unknown> {
    const keys: Array<string> = keysAndArguments
      .slice(0, numberOfKeys)
      .map(String);
    const args: Array<string> = keysAndArguments
      .slice(numberOfKeys)
      .map(String);
    const command: FakeCounterCommand = {
      name: "eval",
      key: keys[0] || "",
      keys: keys,
    };

    this.sent.push([command]);

    if (this.failNextExec) {
      const error: Error = this.failNextExec;
      this.failNextExec = null;
      throw error;
    }

    const failure: Error | null = this.failCommand
      ? this.failCommand(command)
      : null;

    if (failure) {
      throw failure;
    }

    if (this.answerNextExecWith !== undefined) {
      const answer: unknown = this.answerNextExecWith;
      this.answerNextExecWith = undefined;
      return answer;
    }

    if (script !== DIFFERENT_VALUES_SCRIPT) {
      throw new Error("FakeCounterRedis runs DIFFERENT_VALUES_SCRIPT only");
    }

    return this.runDifferentValues(keys, args);
  }

  /*
   * DIFFERENT_VALUES_SCRIPT, step for step: a /64 (the second key) or an
   * address (the first) already over its limit refuses before anything is
   * added; "" adds nothing; otherwise the value is added to each set in
   * turn, each set made now given its TTL, and the first set it takes over
   * its limit refuses.
   */
  public runDifferentValues(
    keys: Array<string>,
    args: Array<string>,
  ): [number, number] {
    const value: string = args[0] || "";
    const limits: Array<number> = [Number(args[1]), Number(args[2])];
    const ttlSeconds: number = Number(args[3]);

    if (keys.length > 1 && this.membersOf(keys[1]!).length > limits[1]!) {
      return [2, 0];
    }

    if (this.membersOf(keys[0]!).length > limits[0]!) {
      return [1, 0];
    }

    if (value === "") {
      return [0, 0];
    }

    for (let index: number = 0; index < keys.length; index++) {
      const key: string = keys[index]!;
      const set: Set<string> = this.sets.get(key) || new Set<string>();

      set.add(value);
      this.sets.set(key, set);

      if (!this.expiries.has(key)) {
        this.expiries.set(key, [ttlSeconds]);
      }

      if (set.size > limits[index]!) {
        return [index + 1, 1];
      }
    }

    return [0, 0];
  }

  // The values a set holds, in the order they were added.
  public membersOf(key: string): Array<string> {
    return Array.from(this.sets.get(key) || []);
  }

  public runIncr(key: string): number {
    const next: number = (this.counters.get(key) || 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  public runDecr(key: string): number {
    const next: number = (this.counters.get(key) || 0) - 1;
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

  // Every key there is: the counters', then the sets'.
  public keys(): Array<string> {
    return [...Array.from(this.counters.keys()), ...Array.from(this.sets.keys())];
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
    this.sets.clear();
    this.expiries.clear();
    this.storedValues.clear();
    this.sent.length = 0;
    this.failNextExec = null;
    this.answerNextExecWith = undefined;
    this.failCommand = null;
  }
}
