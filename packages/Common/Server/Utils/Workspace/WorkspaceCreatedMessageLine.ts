import Redis, { ClientType } from "../../Infrastructure/Redis";
import logger from "../Logger";

/*
 * THE LINE A NEW RECORD'S MESSAGES WAIT IN, KEPT IN VALKEY, SO THAT EVERY
 * APP SERVER KEEPS TO IT (#11198).
 *
 * While a record is being created, every message about it but its Created
 * message waits for that one (WorkspaceCreatedMessageFirst). The record's
 * create chain runs on one App server, but a message about the record can
 * be made on any of them: the Incident Commander role the Dashboard gives
 * the declarer as the incident's page opens, a note, a monitor's first
 * probe result. Each waits in one line, kept in Valkey, which every server
 * of an installation shares:
 *
 *   - start: the chain begins. The record's line is opened, a hash of
 *     three counters - "tickets" handed out, tickets "served", and whether
 *     the line is "released" yet - which lives as long as a hold lasts
 *     (WorkspaceCreatedMessageFirst.HELD_FOR_AT_MOST_MS) and
 *     RELEASED_FOR_AT_MOST_MS more: its lifetime (PTTL), set once.
 *   - take: a message about the record, on any server, takes the next
 *     ticket while the line is open (one atomic step: is there a line, and
 *     the next number in it). Tickets are handed out in the order the
 *     messages are made, the one order all servers agree on.
 *   - release: the Created message is out. From then on each ticket is
 *     posted by the server that made it, and only once every ticket before
 *     it has been (served >= ticket - 1): one after the other, in the order
 *     made, each once - nothing is handed from one server to another, so
 *     nothing can be posted twice or lost on the way.
 *   - done: a ticket is posted; the next one may go. Once the line is
 *     released and every ticket is served, the line is gone, and a message
 *     about the record is posted at once again.
 *
 * NOTHING WAITS FOR GOOD:
 *
 *   - a chain that never says its Created message is out: once the line
 *     has waited as long as a hold lasts it moves on by itself (its PTTL is
 *     down to RELEASED_FOR_AT_MOST_MS), in the same order, and once it has
 *     lived both it is gone, and whatever still waits is posted at once;
 *   - a server that stops while it is a message's turn: a ticket whose
 *     turn has lasted STALLED_AFTER_MS, without its server posting it or
 *     saying it still is (keep, every KEPT_EVERY_MS while it posts), is
 *     passed over;
 *   - a server that is shut down (a deploy): what still waits on it is
 *     posted as it stops, out of turn if need be, and the line goes on
 *     without it (gone);
 *   - Valkey that cannot be asked: a message waits no longer than its line
 *     could have lived, and is posted then.
 *
 * Every time the line reads is its own lifetime (PTTL), which counts down
 * on Valkey's clock: no server's clock is asked, so one that is off cannot
 * cut a turn short.
 */

// A message waiting in a line, posted when its turn comes.
export type LinePost = () => Promise<void>;

// What a line says to a ticket that asks whether it may go.
export enum LineTurn {
  // Not yet: tickets before it are still being posted, or no Created message yet.
  Wait = 0,
  // Its turn: post it, then say so (done).
  Yours = 1,
  // The record has no line (any more): post it now.
  NoLine = 2,
}

/*
 * Shared by the scripts below. moveTo(line, served): tickets 1..served are
 * posted - and so are the tickets right after them that were posted out of
 * turn (gone:<n>) - and the turn of the next one starts now. A released
 * line with every ticket served is over and deleted (answers -1).
 */
const MOVE_TO: string = [
  "local function moveTo(line, served)",
  "  while redis.call('HEXISTS', line, 'gone:' .. (served + 1)) == 1 do",
  "    redis.call('HDEL', line, 'gone:' .. (served + 1))",
  "    served = served + 1",
  "  end",
  "  if redis.call('HGET', line, 'released') == '1' and served >= tonumber(redis.call('HGET', line, 'tickets')) then",
  "    redis.call('DEL', line)",
  "    return -1",
  "  end",
  "  redis.call('HSET', line, 'served', served, 'turnSince', redis.call('PTTL', line))",
  "  return served",
  "end",
].join("\n");

/*
 * KEYS[1]: the record's line. ARGV[1]: how long it lives, in milliseconds.
 * Opens it: 1, or 0 when it is open already.
 */
const START_SCRIPT: string = [
  "if redis.call('EXISTS', KEYS[1]) == 1 then",
  "  return 0",
  "end",
  "redis.call('HSET', KEYS[1], 'tickets', 0, 'served', 0, 'released', 0)",
  "redis.call('PEXPIRE', KEYS[1], ARGV[1])",
  "return 1",
].join("\n");

// KEYS[1]: the line. The next ticket in it, or 0 when there is no line.
const TAKE_SCRIPT: string = [
  "if redis.call('EXISTS', KEYS[1]) == 0 then",
  "  return 0",
  "end",
  "return redis.call('HINCRBY', KEYS[1], 'tickets', 1)",
].join("\n");

/*
 * KEYS[1]: the line. The Created message is out: the first ticket's turn
 * starts, and a line nothing waits in is over at once. 1, or 0 when there
 * is no line.
 */
const RELEASE_SCRIPT: string = [
  MOVE_TO,
  "if redis.call('EXISTS', KEYS[1]) == 0 then",
  "  return 0",
  "end",
  "if redis.call('HGET', KEYS[1], 'released') ~= '1' then",
  "  redis.call('HSET', KEYS[1], 'released', 1)",
  "  moveTo(KEYS[1], tonumber(redis.call('HGET', KEYS[1], 'served')))",
  "end",
  "return 1",
].join("\n");

/*
 * KEYS[1]: the line. ARGV: the ticket asking; the lifetime left at which
 * an unreleased line moves on by itself (RELEASED_FOR_AT_MOST_MS); how long
 * a turn may last unposted and unkept (STALLED_AFTER_MS). A LineTurn.
 */
const TURN_SCRIPT: string = [
  MOVE_TO,
  "local line = KEYS[1]",
  "if redis.call('EXISTS', line) == 0 then",
  "  return 2",
  "end",
  "if redis.call('HGET', line, 'released') ~= '1' then",
  "  local left = redis.call('PTTL', line)",
  "  if left < 0 or left > tonumber(ARGV[2]) then",
  "    return 0",
  "  end",
  // Held as long as a hold lasts: the line moves on without its Created message.
  "  redis.call('HSET', line, 'released', 1)",
  "  moveTo(line, tonumber(redis.call('HGET', line, 'served')))",
  "  if redis.call('EXISTS', line) == 0 then",
  "    return 2",
  "  end",
  "end",
  "local ticket = tonumber(ARGV[1])",
  "local served = tonumber(redis.call('HGET', line, 'served'))",
  "if served >= ticket - 1 then",
  "  return 1",
  "end",
  "local left = redis.call('PTTL', line)",
  "local since = tonumber(redis.call('HGET', line, 'turnSince') or left)",
  "if since - left < tonumber(ARGV[3]) then",
  "  return 0",
  "end",
  // The ticket whose turn it is has gone unposted and unkept that long: its server stopped.
  "served = moveTo(line, served + 1)",
  "if served < 0 or served >= ticket - 1 then",
  "  return 1",
  "end",
  "return 0",
].join("\n");

/*
 * KEYS[1]: the line. ARGV[1]: the ticket being posted. Its turn goes on:
 * nobody passes it over while its server posts it. 1, or 0 when it is not
 * its turn (any more).
 */
const KEEP_SCRIPT: string = [
  "if redis.call('EXISTS', KEYS[1]) == 0 then",
  "  return 0",
  "end",
  "if tonumber(redis.call('HGET', KEYS[1], 'served')) ~= tonumber(ARGV[1]) - 1 then",
  "  return 0",
  "end",
  "redis.call('HSET', KEYS[1], 'turnSince', redis.call('PTTL', KEYS[1]))",
  "return 1",
].join("\n");

/*
 * KEYS[1]: the line. ARGV[1]: the ticket just posted in its turn. The next
 * ticket's turn starts - unless this one was passed over meanwhile. 1, or 0
 * when there is no line.
 */
const DONE_SCRIPT: string = [
  MOVE_TO,
  "if redis.call('EXISTS', KEYS[1]) == 0 then",
  "  return 0",
  "end",
  "local ticket = tonumber(ARGV[1])",
  "if tonumber(redis.call('HGET', KEYS[1], 'served')) == ticket - 1 then",
  "  moveTo(KEYS[1], ticket)",
  "end",
  "return 1",
].join("\n");

/*
 * KEYS[1]: the line. ARGV[1]: a ticket posted out of its turn - by a server
 * shutting down, or one that could not ask Valkey for as long as the line
 * could live. The line passes it by when it comes to it. 1, or 0 when there
 * is no line.
 */
const GONE_SCRIPT: string = [
  MOVE_TO,
  "if redis.call('EXISTS', KEYS[1]) == 0 then",
  "  return 0",
  "end",
  "local ticket = tonumber(ARGV[1])",
  "local served = tonumber(redis.call('HGET', KEYS[1], 'served'))",
  "if served >= ticket then",
  "  return 1",
  "end",
  "if served == ticket - 1 then",
  "  moveTo(KEYS[1], ticket)",
  "  return 1",
  "end",
  "redis.call('HSET', KEYS[1], 'gone:' .. ticket, 1)",
  "return 1",
].join("\n");

// A message of this server waiting in a line, and when it goes whatever happens.
interface Waiting {
  post: LinePost;
  postAtTheLatestAt: number;
}

/*
 * This server's messages in one record's line, by ticket, and the loop that
 * posts each in its turn.
 */
class ServerLine {
  public readonly waiting: Map<number, Waiting> = new Map<number, Waiting>();

  // Set when the server shuts down: what waits goes now.
  public leaving: boolean = false;

  private running: boolean = false;
  private wakeUp: (() => void) | null = null;
  private drainedWaiters: Array<() => void> = [];

  public constructor(
    private readonly key: string,
    /*
     * Whether this server holds the record's line and its Created message is
     * not out yet: its own messages wait for that without asking Valkey,
     * and stay behind the Created message whatever Valkey says.
     */
    private readonly isHeldHere: () => boolean,
  ) {}

  public add(ticket: number, post: LinePost, postAtTheLatestAt: number): void {
    this.waiting.set(ticket, {
      post: post,
      postAtTheLatestAt: postAtTheLatestAt,
    });
    this.wake();
    void this.run();
  }

  public wake(): void {
    const wakeUp: (() => void) | null = this.wakeUp;
    this.wakeUp = null;
    wakeUp?.();
  }

  // Settles once none of this server's messages waits in the line.
  public drained(): Promise<void> {
    if (!this.running && this.waiting.size === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve: () => void) => {
      this.drainedWaiters.push(resolve);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        this.wakeUp = null;
        resolve();
      }, ms);

      // Never what keeps a server running.
      timer.unref?.();

      this.wakeUp = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  private async run(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      while (this.waiting.size > 0) {
        const ticket: number = Math.min(...Array.from(this.waiting.keys()));
        const waiting: Waiting = this.waiting.get(ticket)!;
        const isOverdue: boolean = Date.now() >= waiting.postAtTheLatestAt;

        if (!this.leaving && !isOverdue && this.isHeldHere()) {
          // Until this server's chain says its Created message is out.
          await this.sleep(WorkspaceCreatedMessageLine.ASKED_EVERY_MS * 10);
          continue;
        }

        let turn: LineTurn = LineTurn.Wait;

        if (this.leaving || isOverdue) {
          turn = LineTurn.NoLine;
        } else {
          turn = await WorkspaceCreatedMessageLine.turnOf(this.key, ticket);
        }

        if (turn === LineTurn.Wait) {
          await this.sleep(WorkspaceCreatedMessageLine.ASKED_EVERY_MS);
          continue;
        }

        this.waiting.delete(ticket);

        await WorkspaceCreatedMessageLine.postInTurn({
          key: this.key,
          ticket: ticket,
          post: waiting.post,
          isInTurn: turn === LineTurn.Yours,
          // Out of its turn while the line may still be there: it passes it by.
          isOutOfTurn: this.leaving || isOverdue,
        });
      }
    } finally {
      this.running = false;

      if (this.waiting.size === 0) {
        if (LINES.get(this.key) === this) {
          LINES.delete(this.key);
        }

        const waiters: Array<() => void> = this.drainedWaiters;
        this.drainedWaiters = [];

        for (const resolve of waiters) {
          resolve();
        }
      } else {
        // Something joined as the loop ended.
        void this.run();
      }
    }
  }
}

// This server's lines, by record.
const LINES: Map<string, ServerLine> = new Map<string, ServerLine>();

// When Valkey could not be asked was last logged.
let unavailableLoggedAt: number = 0;

export default class WorkspaceCreatedMessageLine {
  // Where the lines are kept in Valkey: this, then the record (incidentId:<id>).
  public static readonly KEY_PREFIX: string =
    "workspace-created-message-first:";

  /*
   * How long a line goes on at most once it has waited as long as a hold
   * lasts for its Created message, for the messages in it to be posted in
   * turn. Then it is gone, and whatever still waits is posted at once.
   */
  public static readonly RELEASED_FOR_AT_MOST_MS: number = 2 * 60 * 1000;

  // How often a waiting message asks whether its turn has come.
  public static readonly ASKED_EVERY_MS: number = 100;

  /*
   * How long a turn may last without its message being posted, or its
   * server saying it is posting it: longer, and the server stopped.
   */
  public static readonly STALLED_AFTER_MS: number = 15 * 1000;

  // How often a server posting a message says it still is.
  public static readonly KEPT_EVERY_MS: number = 5 * 1000;

  // How long a line can be there at most, for a hold that lasts `heldForAtMostMs`.
  public static livesAtMostMs(heldForAtMostMs: number): number {
    return heldForAtMostMs + this.RELEASED_FOR_AT_MOST_MS;
  }

  // Whether this server can keep lines in Valkey.
  public static isAvailable(): boolean {
    return Boolean(this.client());
  }

  /*
   * Opens the record's line, for its create chain: true once Valkey holds
   * it (or held it already), false when Valkey cannot be asked - the hold
   * is then this server's alone. Never throws.
   */
  public static async start(data: {
    recordKey: string;
    // How long the record's other messages wait for its Created message at most.
    heldForAtMostMs: number;
  }): Promise<boolean> {
    const answer: number | null = await this.run(
      START_SCRIPT,
      data.recordKey,
      [String(this.livesAtMostMs(data.heldForAtMostMs))],
      [0, 1],
    );

    return answer !== null;
  }

  /*
   * A ticket in the record's line: the next number in it, 0 when the record
   * has no line, null when Valkey cannot be asked. Asked at once, before
   * anything else, so tickets follow the order messages are made in. Never
   * throws.
   */
  public static take(recordKey: string): Promise<number | null> {
    return this.run(TAKE_SCRIPT, recordKey, [], null);
  }

  /*
   * The record's Created message is out - or will not be: its line moves.
   * Never throws.
   */
  public static async release(recordKey: string): Promise<void> {
    await this.run(RELEASE_SCRIPT, recordKey, [], [0, 1]);
  }

  /*
   * A message with a ticket in the record's line, posted by this server in
   * its turn. `isHeldHere` says whether this server holds the line and has
   * not let it go yet.
   */
  public static wait(data: {
    recordKey: string;
    ticket: number;
    post: LinePost;
    isHeldHere: () => boolean;
    // How long a hold lasts at most: the line is gone that long after, at the latest.
    heldForAtMostMs: number;
  }): void {
    let line: ServerLine | undefined = LINES.get(data.recordKey);

    if (!line) {
      line = new ServerLine(data.recordKey, data.isHeldHere);
      LINES.set(data.recordKey, line);
    }

    line.add(
      data.ticket,
      data.post,
      Date.now() + this.livesAtMostMs(data.heldForAtMostMs),
    );
  }

  // This server's messages in the record's line ask again now.
  public static wake(recordKey: string): void {
    LINES.get(recordKey)?.wake();
  }

  /*
   * Settles once none of this server's messages waits in the record's line:
   * a message that joins it meanwhile is waited for too.
   */
  public static async drained(recordKey: string): Promise<void> {
    let line: ServerLine | undefined = LINES.get(recordKey);

    while (line) {
      await line.drained();

      const next: ServerLine | undefined = LINES.get(recordKey);

      if (next === line) {
        return;
      }

      line = next;
    }
  }

  // Whether any message of this server waits in a line.
  public static isAnyWaitingHere(): boolean {
    return LINES.size > 0;
  }

  /*
   * The server is shutting down: every message of it still waiting is
   * posted now, in each line's order, each passed by in its line. Settles
   * once they are.
   */
  public static async postEverythingNow(): Promise<void> {
    const lines: Array<ServerLine> = Array.from(LINES.values());

    for (const line of lines) {
      line.leaving = true;
      line.wake();
    }

    await Promise.all(
      lines.map((line: ServerLine): Promise<void> => {
        return line.drained();
      }),
    );
  }

  // Where a ticket stands. Valkey that cannot be asked says Wait.
  public static async turnOf(key: string, ticket: number): Promise<LineTurn> {
    const answer: number | null = await this.run(
      TURN_SCRIPT,
      key,
      [
        String(ticket),
        String(this.RELEASED_FOR_AT_MOST_MS),
        String(this.STALLED_AFTER_MS),
      ],
      [LineTurn.Wait, LineTurn.Yours, LineTurn.NoLine],
    );

    return answer === null ? LineTurn.Wait : (answer as LineTurn);
  }

  /*
   * Posts a message whose turn came - saying it still is while it posts, and
   * that it is posted once it is - or that goes out of turn. Never throws:
   * a message that fails is logged, and the line moves on.
   */
  public static async postInTurn(data: {
    key: string;
    ticket: number;
    post: LinePost;
    isInTurn: boolean;
    isOutOfTurn: boolean;
  }): Promise<void> {
    let keeping: ReturnType<typeof setInterval> | null = null;

    if (data.isInTurn) {
      keeping = setInterval(() => {
        void this.run(KEEP_SCRIPT, data.key, [String(data.ticket)], [0, 1]);
      }, this.KEPT_EVERY_MS);

      keeping.unref?.();
    }

    try {
      await data.post();
    } catch (error) {
      logger.error(
        `Posting a message held for a record's Created message failed: ${error}`,
      );
    } finally {
      if (keeping) {
        clearInterval(keeping);
      }
    }

    if (data.isInTurn) {
      await this.run(DONE_SCRIPT, data.key, [String(data.ticket)], [0, 1]);
    } else if (data.isOutOfTurn) {
      await this.run(GONE_SCRIPT, data.key, [String(data.ticket)], [0, 1]);
    }
  }

  private static client(): ClientType | null {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    return client;
  }

  /*
   * One script, on the record's line: its answer when it is one of
   * `answers` (any whole number from 0 up, when null), null when Valkey
   * cannot be asked or answers anything else. Never throws.
   */
  private static async run(
    script: string,
    recordKey: string,
    args: Array<string>,
    answers: Array<number> | null,
  ): Promise<number | null> {
    const client: ClientType | null = this.client();

    if (!client) {
      return null;
    }

    try {
      const answer: unknown = await client.eval(
        script,
        1,
        this.KEY_PREFIX + recordKey,
        ...args,
      );

      if (
        typeof answer !== "number" ||
        !Number.isInteger(answer) ||
        answer < 0 ||
        (answers && !answers.includes(answer))
      ) {
        throw new Error(`Valkey answered ${String(answer)}`);
      }

      return answer;
    } catch (error) {
      this.logUnavailable(error);
      return null;
    }
  }

  private static logUnavailable(error: unknown): void {
    if (Date.now() - unavailableLoggedAt < 60 * 1000) {
      return;
    }

    unavailableLoggedAt = Date.now();

    logger.warn(
      `The line a new record's messages wait in for its Created message could not be read in Valkey: ${error}. Its messages are held on this server alone, or posted at once.`,
    );
  }
}
