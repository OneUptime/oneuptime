import { randomUUID } from "crypto";
import Redis, { ClientType } from "../../Infrastructure/Redis";
import { JSONObject } from "../../../Types/JSON";
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
 *     posted in its turn, only once every ticket before it has been
 *     (served >= ticket - 1): one after the other, in the order made.
 *   - done: a ticket is posted; the next one may go. Once the line is
 *     released and every ticket is served, the line is gone, and a message
 *     about the record is posted at once again.
 *
 * EACH MESSAGE IS POSTED ONCE, EVEN WHEN ITS SERVER STOPS (#11235):
 *
 *   - take stores, with the ticket, what the message says
 *     (message:<ticket>, the JSON WorkspaceCreatedMessageFirst.keep is
 *     handed - the message as its server would post it, nothing more), the
 *     message's own id (id:<ticket>) and the server that made it
 *     (by:<ticket>). It goes with the ticket when the ticket is served, and
 *     with the line at the latest.
 *   - A message is posted only by the server that claims it first: its
 *     claim is a key of its own, named by the line and the message's id
 *     (claimKeyOf), set once (SET NX). The server that made a message
 *     claims it as its turn comes - and before it posts it out of turn, as
 *     it shuts down, or once it has waited as long as its line could live -
 *     and that claim lasts as long as a line can; a server that takes a
 *     message over claims it for TAKEN_OVER_CLAIMED_FOR_MS. So a server that
 *     is passed over and comes back, even long after, finds its message
 *     claimed by the server that took it over, and never posts it again.
 *   - A ticket whose turn has lasted STALLED_AFTER_MS, unclaimed, is taken
 *     over: a server that finds it claims it, posts it from what was stored
 *     of it, keeping the turn while it posts as its own server would have,
 *     and passes the turn on. Its server is then known to have stopped, in
 *     that line (dead:<server>), and its next tickets there are taken over
 *     as their turns come, without the wait - until it asks about one, or
 *     takes a ticket, which says it has not.
 *   - A ticket whose server claimed it and stopped while it posted it is
 *     passed over, as before: it may have gone out, and is never posted
 *     twice. So is one nothing was stored of: a message too large to store
 *     (WorkspaceCreatedMessageFirst.MAX_STORED_MESSAGE_BYTES), or taken by
 *     a server that ran the code from before this.
 *   - Every App server looks after the lines whose turn could have stalled
 *     (lookAfterStoppedServers), whether or not it has a message waiting in
 *     them: each line is in an index, a sorted set, under the time it is
 *     next to be looked at - when its hold runs out, when its turn could
 *     stall, at once when its next ticket's server has stopped. So a line
 *     nobody else waits in is found, and a server finds the lines to look
 *     at without reading every line.
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
 *     taken over - or passed over, as above;
 *   - a server that is shut down (a deploy): what still waits on it is
 *     posted as it stops, out of turn if need be, and the line goes on
 *     without it (gone);
 *   - Valkey that cannot be asked: a message waits no longer than its line
 *     could have lived, and is posted then.
 *
 * Every time a line reads is its own lifetime (PTTL), which counts down on
 * Valkey's clock: no server's clock is asked, so one that is off cannot cut
 * a turn short. The index reads Valkey's own clock too (TIME).
 */

// A message waiting in a line, posted when its turn comes.
export type LinePost = () => Promise<void>;

/*
 * How a server posts a message another server kept in a line and stopped
 * before posting (#11235): from what was stored of it.
 */
export type StoredLinePost = (stored: JSONObject) => Promise<void>;

// What a line says to a ticket that asks whether it may go.
export enum LineTurn {
  // Not yet: tickets before it are still being posted, or no Created message yet.
  Wait = 0,
  // Its turn, and it is claimed for this server: post it, then say so (done).
  Yours = 1,
  // The record has no line (any more), and the message is claimed for this server: post it now.
  NoLine = 2,
  // Another server claimed it - took it over - and posts it, or has: never posted here.
  TakenOver = 3,
  // The ticket whose turn it is stalled, and what it says is stored: take it over first.
  Stalled = 4,
}

// What a line says to a ticket that asks, and which ticket stalled when one did.
export interface LineAnswer {
  turn: LineTurn;
  stalledTicket?: number | undefined;
  stalledMessageId?: string | undefined;
}

/*
 * What every script below that moves a line starts with. KEYS[1] is the
 * record's line, KEYS[2] the index of lines to look after.
 *
 *   - lookIn(ms): the line is to be looked at by the servers that look
 *     after lines (lookAfterLines) in `ms`, on Valkey's clock. The index
 *     lives at least as long as the lines in it can.
 *   - forget(ticket): what was kept of a served ticket goes.
 *   - isTakenAtOnce(ticket): its server is known to have stopped, what it
 *     says is stored, and nobody claimed it: it is taken over as its turn
 *     comes, without waiting for its turn to stall.
 *   - moveTo(served, stalledMs): tickets 1..served are posted - and so are
 *     the tickets right after them that were posted out of turn (gone:<n>) -
 *     and the turn of the next one starts now. A released line with every
 *     ticket served is over and deleted (answers -1).
 */
const LINE_SCRIPT_HELPERS: string = [
  "local line = KEYS[1]",
  "local index = KEYS[2]",
  "local function nowMs()",
  "  local time = redis.call('TIME')",
  "  return tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)",
  "end",
  "local function lookIn(ms)",
  "  local left = redis.call('PTTL', line)",
  "  if left < 0 then",
  "    return",
  "  end",
  "  redis.call('ZADD', index, nowMs() + math.max(ms, 0), line)",
  "  if redis.call('PTTL', index) < left then",
  "    redis.call('PEXPIRE', index, left)",
  "  end",
  "end",
  "local function forget(ticket)",
  "  redis.call('HDEL', line, 'message:' .. ticket, 'id:' .. ticket, 'by:' .. ticket, 'posting:' .. ticket)",
  "end",
  "local function isTakenAtOnce(ticket)",
  "  local by = redis.call('HGET', line, 'by:' .. ticket)",
  "  if not by then",
  "    return false",
  "  end",
  "  return redis.call('HEXISTS', line, 'dead:' .. by) == 1",
  "    and redis.call('HEXISTS', line, 'message:' .. ticket) == 1",
  "    and redis.call('HEXISTS', line, 'posting:' .. ticket) == 0",
  "end",
  "local function moveTo(served, stalledMs)",
  "  local was = tonumber(redis.call('HGET', line, 'served'))",
  "  for ticket = was + 1, served do",
  "    forget(ticket)",
  "  end",
  "  while redis.call('HEXISTS', line, 'gone:' .. (served + 1)) == 1 do",
  "    redis.call('HDEL', line, 'gone:' .. (served + 1))",
  "    forget(served + 1)",
  "    served = served + 1",
  "  end",
  "  local released = redis.call('HGET', line, 'released') == '1'",
  "  if released and served >= tonumber(redis.call('HGET', line, 'tickets')) then",
  "    redis.call('DEL', line)",
  "    redis.call('ZREM', index, line)",
  "    return -1",
  "  end",
  "  redis.call('HSET', line, 'served', served, 'turnSince', redis.call('PTTL', line))",
  "  if released then",
  "    if isTakenAtOnce(served + 1) then",
  "      lookIn(0)",
  "    else",
  "      lookIn(stalledMs)",
  "    end",
  "  end",
  "  return served",
  "end",
].join("\n");

/*
 * KEYS: the record's line, the index. ARGV: how long the line lives; how
 * long its hold lasts, after which it is looked at should nobody let it go.
 * Opens it: 1, or 0 when it is open already.
 */
const START_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "if redis.call('EXISTS', line) == 1 then",
  "  return 0",
  "end",
  "redis.call('HSET', line, 'tickets', 0, 'served', 0, 'released', 0)",
  "redis.call('PEXPIRE', line, ARGV[1])",
  "lookIn(tonumber(ARGV[2]))",
  "return 1",
].join("\n");

/*
 * KEYS[1]: the line. ARGV: the message's id; the server's; what the message
 * says, as stored, or '' when nothing is. The next ticket in the line, with
 * what it is kept with, or 0 when there is no line. A server that takes a
 * ticket has not stopped.
 */
const TAKE_SCRIPT: string = [
  "if redis.call('EXISTS', KEYS[1]) == 0 then",
  "  return 0",
  "end",
  "local ticket = redis.call('HINCRBY', KEYS[1], 'tickets', 1)",
  "redis.call('HSET', KEYS[1], 'id:' .. ticket, ARGV[1], 'by:' .. ticket, ARGV[2])",
  "if ARGV[3] ~= '' then",
  "  redis.call('HSET', KEYS[1], 'message:' .. ticket, ARGV[3])",
  "end",
  "redis.call('HDEL', KEYS[1], 'dead:' .. ARGV[2])",
  "return ticket",
].join("\n");

/*
 * KEYS: the line, the index. ARGV: how long a turn may last unposted and
 * unkept (STALLED_AFTER_MS). The Created message is out: the first ticket's
 * turn starts, and a line nothing waits in is over at once. 1, or 0 when
 * there is no line.
 */
const RELEASE_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "if redis.call('EXISTS', line) == 0 then",
  "  return 0",
  "end",
  "if redis.call('HGET', line, 'released') ~= '1' then",
  "  redis.call('HSET', line, 'released', 1)",
  "  moveTo(tonumber(redis.call('HGET', line, 'served')), tonumber(ARGV[1]))",
  "end",
  "return 1",
].join("\n");

/*
 * KEYS: the line, the index, the asking ticket's claim. ARGV: how long a
 * turn may last unposted and unkept; the ticket asking; the lifetime left
 * at which an unreleased line moves on by itself (RELEASED_FOR_AT_MOST_MS);
 * this server; how long a claim lasts; whether this server takes over a
 * stalled ticket ('1') or passes it over ('0').
 *
 * {LineTurn}, or {Stalled, the stalled ticket, its message's id}. Yours and
 * NoLine come only with the message claimed for this server, and a ticket
 * claimed for another server is TakenOver.
 */
const TURN_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "local stalledMs = tonumber(ARGV[1])",
  "local ticket = tonumber(ARGV[2])",
  "local function claimed()",
  "  if redis.call('SET', KEYS[3], ARGV[4], 'NX', 'PX', ARGV[5]) then",
  "    return true",
  "  end",
  "  return redis.call('GET', KEYS[3]) == ARGV[4]",
  "end",
  "local function postNow()",
  "  if claimed() then",
  "    return {2}",
  "  end",
  "  return {3}",
  "end",
  "local function yours()",
  "  if not claimed() then",
  "    return {3}",
  "  end",
  "  if tonumber(redis.call('HGET', line, 'served')) == ticket - 1 then",
  "    redis.call('HSET', line, 'posting:' .. ticket, ARGV[4], 'turnSince', redis.call('PTTL', line))",
  "    lookIn(stalledMs)",
  "  end",
  "  return {1}",
  "end",
  "if redis.call('EXISTS', line) == 0 then",
  "  return postNow()",
  "end",
  // A server that asks has not stopped.
  "redis.call('HDEL', line, 'dead:' .. ARGV[4])",
  "if redis.call('HGET', line, 'released') ~= '1' then",
  "  local left = redis.call('PTTL', line)",
  "  if left < 0 or left > tonumber(ARGV[3]) then",
  "    return {0}",
  "  end",
  // Held as long as a hold lasts: the line moves on without its Created message.
  "  redis.call('HSET', line, 'released', 1)",
  "  if moveTo(tonumber(redis.call('HGET', line, 'served')), stalledMs) < 0 then",
  "    return postNow()",
  "  end",
  "end",
  "local served = tonumber(redis.call('HGET', line, 'served'))",
  "if served >= ticket - 1 then",
  "  return yours()",
  "end",
  "local head = served + 1",
  "local left = redis.call('PTTL', line)",
  "local since = tonumber(redis.call('HGET', line, 'turnSince') or left)",
  "local stalled = since - left >= stalledMs",
  "local headId = redis.call('HGET', line, 'id:' .. head)",
  "if ARGV[6] == '1' and headId and redis.call('HEXISTS', line, 'message:' .. head) == 1 then",
  "  if stalled or isTakenAtOnce(head) then",
  "    return {4, head, headId}",
  "  end",
  "  return {0}",
  "end",
  "if not stalled then",
  "  return {0}",
  "end",
  // Its server stopped, and nothing of it is stored to post it from: passed over.
  "served = moveTo(head, stalledMs)",
  "if served < 0 then",
  "  return postNow()",
  "end",
  "if served >= ticket - 1 then",
  "  return yours()",
  "end",
  "return {0}",
].join("\n");

/*
 * KEYS: the line, the index, the stalled ticket's claim. ARGV: how long a
 * turn may last unposted and unkept; the stalled ticket; its message's id;
 * this server; how long a claim lasts.
 *
 * {0}: nothing to do now - the line moved on, or the turn is not stalled
 * after all. {1}: passed over - its server claimed it and stopped while it
 * posted it, or nothing of it is stored. {2, what is stored}: claimed for
 * this server, whose turn it now is: post it, keep the turn while posting,
 * then say it is done.
 */
const TAKE_OVER_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "local stalledMs = tonumber(ARGV[1])",
  "local head = tonumber(ARGV[2])",
  "if redis.call('EXISTS', line) == 0 or redis.call('HGET', line, 'released') ~= '1' then",
  "  return {0}",
  "end",
  "if tonumber(redis.call('HGET', line, 'served')) ~= head - 1 or redis.call('HGET', line, 'id:' .. head) ~= ARGV[3] then",
  "  return {0}",
  "end",
  "local left = redis.call('PTTL', line)",
  "local since = tonumber(redis.call('HGET', line, 'turnSince') or left)",
  "local stalled = since - left >= stalledMs",
  "if redis.call('EXISTS', KEYS[3]) == 1 then",
  "  if not stalled then",
  "    return {0}",
  "  end",
  // Claimed, and its server stopped while it posted it: it may have gone out.
  "  moveTo(head, stalledMs)",
  "  return {1}",
  "end",
  "if not stalled and not isTakenAtOnce(head) then",
  "  return {0}",
  "end",
  "local message = redis.call('HGET', line, 'message:' .. head)",
  "if not message then",
  "  moveTo(head, stalledMs)",
  "  return {1}",
  "end",
  "redis.call('SET', KEYS[3], ARGV[4], 'PX', ARGV[5])",
  "local by = redis.call('HGET', line, 'by:' .. head)",
  "if by and by ~= ARGV[4] then",
  "  redis.call('HSET', line, 'dead:' .. by, 1)",
  "end",
  "redis.call('HSET', line, 'posting:' .. head, ARGV[4], 'turnSince', redis.call('PTTL', line))",
  "lookIn(stalledMs)",
  "return {2, message}",
].join("\n");

/*
 * KEYS: the line, the index. ARGV: how long a turn may last unposted and
 * unkept; the ticket being posted. Its turn goes on: nobody passes it over
 * or takes it over while its server posts it. 1, or 0 when it is not its
 * turn (any more).
 */
const KEEP_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "if redis.call('EXISTS', line) == 0 then",
  "  return 0",
  "end",
  "if tonumber(redis.call('HGET', line, 'served')) ~= tonumber(ARGV[2]) - 1 then",
  "  return 0",
  "end",
  "redis.call('HSET', line, 'turnSince', redis.call('PTTL', line))",
  "lookIn(tonumber(ARGV[1]))",
  "return 1",
].join("\n");

/*
 * KEYS: the line, the index. ARGV: how long a turn may last unposted and
 * unkept; the ticket just posted in its turn. The next ticket's turn starts -
 * unless this one was passed over meanwhile. 1, or 0 when there is no line.
 */
const DONE_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "if redis.call('EXISTS', line) == 0 then",
  "  return 0",
  "end",
  "local ticket = tonumber(ARGV[2])",
  "if tonumber(redis.call('HGET', line, 'served')) == ticket - 1 then",
  "  moveTo(ticket, tonumber(ARGV[1]))",
  "end",
  "return 1",
].join("\n");

/*
 * KEYS: the line, the index. ARGV: how long a turn may last unposted and
 * unkept; a ticket posted out of its turn - by a server shutting down, or
 * one that could not ask Valkey for as long as the line could live. The
 * line passes it by when it comes to it, and what is stored of it goes. 1,
 * or 0 when there is no line.
 */
const GONE_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "if redis.call('EXISTS', line) == 0 then",
  "  return 0",
  "end",
  "local ticket = tonumber(ARGV[2])",
  "local served = tonumber(redis.call('HGET', line, 'served'))",
  "if served >= ticket then",
  "  return 1",
  "end",
  "if served == ticket - 1 then",
  "  moveTo(ticket, tonumber(ARGV[1]))",
  "  return 1",
  "end",
  "redis.call('HSET', line, 'gone:' .. ticket, 1)",
  "redis.call('HDEL', line, 'message:' .. ticket)",
  "return 1",
].join("\n");

/*
 * KEYS[1]: a message's claim. ARGV: this server; how long a claim lasts.
 * 1 when the message is claimed for this server - now, or before - or 0
 * when another server claimed it.
 */
const CLAIM_SCRIPT: string = [
  "if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then",
  "  return 1",
  "end",
  "if redis.call('GET', KEYS[1]) == ARGV[1] then",
  "  return 1",
  "end",
  "return 0",
].join("\n");

/*
 * KEYS: the line, the index. ARGV: how long a turn may last unposted and
 * unkept; the lifetime left at which an unreleased line moves on by itself.
 * A server that looks after lines asks what one needs.
 *
 * {0}: nothing, for now - the line is gone (and out of the index), or waits
 * on a server that is posting or has not stalled; it is looked at again
 * when it could need something. {1}: a stalled ticket nothing was stored of
 * was passed over: ask again. {2, the stalled ticket, its message's id}:
 * take it over.
 */
const LOOK_SCRIPT: string = [
  LINE_SCRIPT_HELPERS,
  "local stalledMs = tonumber(ARGV[1])",
  "if redis.call('EXISTS', line) == 0 then",
  "  redis.call('ZREM', index, line)",
  "  return {0}",
  "end",
  "if redis.call('HGET', line, 'released') ~= '1' then",
  "  local left = redis.call('PTTL', line)",
  "  local releasedFor = tonumber(ARGV[2])",
  "  if left > releasedFor then",
  "    lookIn(left - releasedFor)",
  "    return {0}",
  "  end",
  "  redis.call('HSET', line, 'released', 1)",
  "  if moveTo(tonumber(redis.call('HGET', line, 'served')), stalledMs) < 0 then",
  "    return {0}",
  "  end",
  "end",
  "local head = tonumber(redis.call('HGET', line, 'served')) + 1",
  "local left = redis.call('PTTL', line)",
  "local since = tonumber(redis.call('HGET', line, 'turnSince') or left)",
  "local elapsed = since - left",
  "local headId = redis.call('HGET', line, 'id:' .. head)",
  "if headId and redis.call('HEXISTS', line, 'message:' .. head) == 1 then",
  "  if elapsed >= stalledMs or isTakenAtOnce(head) then",
  "    return {2, head, headId}",
  "  end",
  "elseif elapsed >= stalledMs then",
  "  if moveTo(head, stalledMs) < 0 then",
  "    return {0}",
  "  end",
  "  return {1}",
  "end",
  "lookIn(stalledMs - elapsed)",
  "return {0}",
].join("\n");

/*
 * KEYS[1]: the index. ARGV[1]: how many. The lines due to be looked at by
 * now, on Valkey's clock: their keys.
 */
const DUE_SCRIPT: string = [
  "local time = redis.call('TIME')",
  "local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)",
  "return redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, tonumber(ARGV[1]))",
].join("\n");

// A message of this server waiting in a line, and when it goes whatever happens.
interface Waiting {
  messageId: string;
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
    // How long a hold lasts at most: its messages' claims last as long as the line can.
    private readonly heldForAtMostMs: number,
  ) {}

  public add(
    ticket: number,
    messageId: string,
    post: LinePost,
    postAtTheLatestAt: number,
  ): void {
    this.waiting.set(ticket, {
      messageId: messageId,
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

        if (this.leaving || isOverdue) {
          /*
           * Out of its turn, while the line may still be there: posted, and
           * passed by in the line - unless another server took it over.
           */
          this.waiting.delete(ticket);

          if (
            (await WorkspaceCreatedMessageLine.claim({
              recordKey: this.key,
              messageId: waiting.messageId,
              heldForAtMostMs: this.heldForAtMostMs,
            })) === false
          ) {
            continue;
          }

          await WorkspaceCreatedMessageLine.postInTurn({
            key: this.key,
            ticket: ticket,
            post: waiting.post,
            isInTurn: false,
            isOutOfTurn: true,
          });
          continue;
        }

        const answer: LineAnswer = await WorkspaceCreatedMessageLine.turnOf({
          recordKey: this.key,
          ticket: ticket,
          messageId: waiting.messageId,
          heldForAtMostMs: this.heldForAtMostMs,
        });

        if (answer.turn === LineTurn.Wait) {
          await this.sleep(WorkspaceCreatedMessageLine.ASKED_EVERY_MS);
          continue;
        }

        if (answer.turn === LineTurn.Stalled) {
          // The ticket before it first: its server stopped before posting it.
          const isMoved: boolean = await WorkspaceCreatedMessageLine.takeOver({
            recordKey: this.key,
            ticket: answer.stalledTicket!,
            messageId: answer.stalledMessageId!,
            heldForAtMostMs: this.heldForAtMostMs,
          });

          if (!isMoved) {
            await this.sleep(WorkspaceCreatedMessageLine.ASKED_EVERY_MS);
          }

          continue;
        }

        this.waiting.delete(ticket);

        if (answer.turn === LineTurn.TakenOver) {
          // Passed over as stopped, and posted by the server that took it over.
          continue;
        }

        await WorkspaceCreatedMessageLine.postInTurn({
          key: this.key,
          ticket: ticket,
          post: waiting.post,
          isInTurn: answer.turn === LineTurn.Yours,
          isOutOfTurn: false,
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

/*
 * How this server takes over the messages of a server that stopped
 * (lookAfterStoppedServers): what posts one, and how long a hold lasts.
 * Null until the App starts it, and once it shuts down.
 */
let takingOver: {
  post: StoredLinePost;
  heldForAtMostMs: () => number;
} | null = null;

// The next look at the lines, and the one under way.
let lookTimer: ReturnType<typeof setTimeout> | null = null;
let lookingAfterLines: Promise<void> | null = null;

export default class WorkspaceCreatedMessageLine {
  // Where the lines are kept in Valkey: this, then the record (incidentId:<id>).
  public static readonly KEY_PREFIX: string =
    "workspace-created-message-first:";

  /*
   * The index of the lines to look after, after KEY_PREFIX: no record's key,
   * which always has a ":" in it.
   */
  public static readonly INDEX_NAME: string = "lines-to-look-after";

  // This server, as the lines name it: one id for each process.
  public static readonly SERVER_ID: string = randomUUID();

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

  /*
   * How often a server looks after the lines that may need it
   * (lookAfterStoppedServers): a stopped server's message waits its stalled
   * turn and at most this much more.
   */
  public static readonly LOOKED_AFTER_EVERY_MS: number = 5 * 1000;

  // How many lines a server looks at each time, and how many turns of one.
  public static readonly LINES_LOOKED_AT_EACH_TIME: number = 100;
  public static readonly TURNS_TAKEN_OVER_IN_A_LINE_AT_A_TIME: number = 100;

  /*
   * How long the claim of a message taken over lasts. The server that made
   * it may only have been frozen - a long pause, a node cut off for a
   * while - and comes back to post it, however late: it finds the claim
   * for as long as this, and never posts the message again. A server's
   * claim of its own message lasts as long as its line can: nobody else can
   * post that message once the line is gone.
   */
  public static readonly TAKEN_OVER_CLAIMED_FOR_MS: number = 60 * 60 * 1000;

  // How long a line can be there at most, for a hold that lasts `heldForAtMostMs`.
  public static livesAtMostMs(heldForAtMostMs: number): number {
    return heldForAtMostMs + this.RELEASED_FOR_AT_MOST_MS;
  }

  // The key of a record's line.
  public static lineKeyOf(recordKey: string): string {
    return this.KEY_PREFIX + recordKey;
  }

  // The key of the index of lines to look after.
  public static indexKey(): string {
    return this.KEY_PREFIX + this.INDEX_NAME;
  }

  /*
   * The key of a message's claim: set once, by the server that posts it,
   * and kept as long as a line can live from then on.
   */
  public static claimKeyOf(recordKey: string, messageId: string): string {
    return `${this.lineKeyOf(recordKey)}:claim:${messageId}`;
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
      this.lineKeys(data.recordKey),
      [
        String(this.livesAtMostMs(data.heldForAtMostMs)),
        String(data.heldForAtMostMs),
      ],
      [0, 1],
    );

    return answer !== null;
  }

  /*
   * A ticket in the record's line, kept with the message's id and what is
   * stored of it - what another server posts it from, should this one stop
   * before its turn (null: nothing is). The next number in the line, 0 when
   * the record has no line, null when Valkey cannot be asked. Asked at
   * once, before anything else, so tickets follow the order messages are
   * made in. Never throws.
   */
  public static take(
    recordKey: string,
    message: { messageId: string; stored: string | null },
  ): Promise<number | null> {
    return this.run(
      TAKE_SCRIPT,
      [this.lineKeyOf(recordKey)],
      [message.messageId, this.SERVER_ID, message.stored || ""],
      null,
    );
  }

  /*
   * The record's Created message is out - or will not be: its line moves.
   * Never throws.
   */
  public static async release(recordKey: string): Promise<void> {
    await this.run(
      RELEASE_SCRIPT,
      this.lineKeys(recordKey),
      [String(this.STALLED_AFTER_MS)],
      [0, 1],
    );
  }

  /*
   * A message with a ticket in the record's line, posted by this server in
   * its turn. `isHeldHere` says whether this server holds the line and has
   * not let it go yet.
   */
  public static wait(data: {
    recordKey: string;
    ticket: number;
    messageId: string;
    post: LinePost;
    isHeldHere: () => boolean;
    // How long a hold lasts at most: the line is gone that long after, at the latest.
    heldForAtMostMs: number;
  }): void {
    let line: ServerLine | undefined = LINES.get(data.recordKey);

    if (!line) {
      line = new ServerLine(
        data.recordKey,
        data.isHeldHere,
        data.heldForAtMostMs,
      );
      LINES.set(data.recordKey, line);
    }

    line.add(
      data.ticket,
      data.messageId,
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
   * The server is shutting down: it takes over no other server's messages
   * from now on - one it is posting is finished - and every message of its
   * own still waiting is posted now, in each line's order, each passed by in
   * its line, unless another server took it over. Settles once they are.
   */
  public static async postEverythingNow(): Promise<void> {
    this.stopLookingAfterStoppedServers();

    if (lookingAfterLines) {
      await lookingAfterLines;
    }

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

  /*
   * Where a ticket stands (LineAnswer): claimed for this server when it may
   * be posted. Valkey that cannot be asked says Wait.
   */
  public static async turnOf(data: {
    recordKey: string;
    ticket: number;
    messageId: string;
    heldForAtMostMs: number;
  }): Promise<LineAnswer> {
    const answer: Array<unknown> | null = await this.runForList(
      TURN_SCRIPT,
      [
        ...this.lineKeys(data.recordKey),
        this.claimKeyOf(data.recordKey, data.messageId),
      ],
      [
        String(this.STALLED_AFTER_MS),
        String(data.ticket),
        String(this.RELEASED_FOR_AT_MOST_MS),
        this.SERVER_ID,
        String(this.livesAtMostMs(data.heldForAtMostMs)),
        takingOver ? "1" : "0",
      ],
    );

    const turn: unknown = answer?.[0];

    if (turn === LineTurn.Stalled) {
      const stalledTicket: unknown = answer?.[1];
      const stalledMessageId: unknown = answer?.[2];

      if (
        typeof stalledTicket === "number" &&
        Number.isInteger(stalledTicket) &&
        typeof stalledMessageId === "string"
      ) {
        return {
          turn: LineTurn.Stalled,
          stalledTicket: stalledTicket,
          stalledMessageId: stalledMessageId,
        };
      }

      return { turn: LineTurn.Wait };
    }

    if (
      turn === LineTurn.Yours ||
      turn === LineTurn.NoLine ||
      turn === LineTurn.TakenOver
    ) {
      return { turn: turn };
    }

    return { turn: LineTurn.Wait };
  }

  /*
   * A message of this server about to be posted out of its turn: claimed
   * for this server first. True when it is, false when another server took
   * it over - it is not posted here - and null when Valkey cannot be asked,
   * when it is posted anyway, rather than never. Never throws.
   */
  public static async claim(data: {
    recordKey: string;
    messageId: string;
    heldForAtMostMs: number;
  }): Promise<boolean | null> {
    const answer: number | null = await this.run(
      CLAIM_SCRIPT,
      [this.claimKeyOf(data.recordKey, data.messageId)],
      [this.SERVER_ID, String(this.livesAtMostMs(data.heldForAtMostMs))],
      [0, 1],
    );

    return answer === null ? null : answer === 1;
  }

  /*
   * The ticket whose turn stalled - its server stopped before posting it -
   * is taken over: claimed for this server, posted from what was stored of
   * it in its turn, which this server keeps while it posts, and passed on.
   * One its server claimed before it stopped, or nothing was stored of, is
   * passed over instead. True when the line moved on, false when nothing
   * could be done now. Never throws.
   */
  public static async takeOver(data: {
    recordKey: string;
    ticket: number;
    messageId: string;
    heldForAtMostMs: number;
  }): Promise<boolean> {
    const post: StoredLinePost | null = takingOver?.post || null;

    if (!post) {
      return false;
    }

    const answer: Array<unknown> | null = await this.runForList(
      TAKE_OVER_SCRIPT,
      [
        ...this.lineKeys(data.recordKey),
        this.claimKeyOf(data.recordKey, data.messageId),
      ],
      [
        String(this.STALLED_AFTER_MS),
        String(data.ticket),
        data.messageId,
        this.SERVER_ID,
        String(
          Math.max(
            this.livesAtMostMs(data.heldForAtMostMs),
            this.TAKEN_OVER_CLAIMED_FOR_MS,
          ),
        ),
      ],
    );

    if (answer?.[0] === 1) {
      return true;
    }

    const stored: unknown = answer?.[1];

    if (answer?.[0] !== 2 || typeof stored !== "string") {
      return false;
    }

    logger.info(
      `A message about ${data.recordKey} waited on an App server that stopped before its turn: this server posts it, in its turn (ticket ${data.ticket}).`,
    );

    await this.postInTurn({
      key: data.recordKey,
      ticket: data.ticket,
      post: async (): Promise<void> => {
        await post(JSON.parse(stored) as JSONObject);
      },
      isInTurn: true,
      isOutOfTurn: false,
    });

    return true;
  }

  /*
   * From now on this server also posts the messages another App server kept
   * in a line and stopped before posting - each in its turn, from what was
   * stored of it, with `post` (#11235). It looks after the lines that may
   * need it every LOOKED_AFTER_EVERY_MS, and takes over a stalled ticket it
   * finds while its own messages wait too. Once is enough: called again, it
   * posts with the `post` given last.
   */
  public static lookAfterStoppedServers(data: {
    post: StoredLinePost;
    heldForAtMostMs: () => number;
  }): void {
    takingOver = data;
    this.scheduleLook();
  }

  // This server takes over no other server's messages any more.
  public static stopLookingAfterStoppedServers(): void {
    takingOver = null;

    if (lookTimer) {
      clearTimeout(lookTimer);
      lookTimer = null;
    }
  }

  /*
   * Looks after the lines due to be looked at: each one's hold that ran out
   * is let go, and each stalled turn of one is taken over (or passed over),
   * until it waits on a server that has not stopped. Settles once it has;
   * one look at a time. Never throws.
   */
  public static async lookAfterLines(): Promise<void> {
    if (!lookingAfterLines) {
      lookingAfterLines = this.lookAfterDueLines()
        .catch((error: unknown) => {
          logger.error(
            `Looking after the lines new records' messages wait in failed: ${error}`,
          );
        })
        .finally(() => {
          lookingAfterLines = null;
        });
    }

    await lookingAfterLines;
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
        void this.run(
          KEEP_SCRIPT,
          this.lineKeys(data.key),
          [String(this.STALLED_AFTER_MS), String(data.ticket)],
          [0, 1],
        );
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
      await this.run(
        DONE_SCRIPT,
        this.lineKeys(data.key),
        [String(this.STALLED_AFTER_MS), String(data.ticket)],
        [0, 1],
      );
    } else if (data.isOutOfTurn) {
      await this.run(
        GONE_SCRIPT,
        this.lineKeys(data.key),
        [String(this.STALLED_AFTER_MS), String(data.ticket)],
        [0, 1],
      );
    }
  }

  // The next look at the lines, LOOKED_AFTER_EVERY_MS from now.
  private static scheduleLook(): void {
    if (!takingOver || lookTimer) {
      return;
    }

    lookTimer = setTimeout(() => {
      lookTimer = null;

      void this.lookAfterLines().finally(() => {
        this.scheduleLook();
      });
    }, this.LOOKED_AFTER_EVERY_MS);

    // Never what keeps a server running.
    lookTimer.unref?.();
  }

  private static async lookAfterDueLines(): Promise<void> {
    if (!takingOver || !this.client()) {
      return;
    }

    const due: Array<unknown> | null = await this.runForList(
      DUE_SCRIPT,
      [this.indexKey()],
      [String(this.LINES_LOOKED_AT_EACH_TIME)],
    );

    for (const lineKey of due || []) {
      if (
        typeof lineKey !== "string" ||
        !lineKey.startsWith(this.KEY_PREFIX)
      ) {
        continue;
      }

      await this.lookAfterLine(lineKey.slice(this.KEY_PREFIX.length));
    }
  }

  private static async lookAfterLine(recordKey: string): Promise<void> {
    for (
      let turns: number = 0;
      turns < this.TURNS_TAKEN_OVER_IN_A_LINE_AT_A_TIME;
      turns++
    ) {
      const current: typeof takingOver = takingOver;

      if (!current) {
        return;
      }

      const look: Array<unknown> | null = await this.runForList(
        LOOK_SCRIPT,
        this.lineKeys(recordKey),
        [String(this.STALLED_AFTER_MS), String(this.RELEASED_FOR_AT_MOST_MS)],
      );

      if (look?.[0] === 1) {
        continue;
      }

      const stalledTicket: unknown = look?.[1];
      const stalledMessageId: unknown = look?.[2];

      if (
        look?.[0] !== 2 ||
        typeof stalledTicket !== "number" ||
        typeof stalledMessageId !== "string"
      ) {
        return;
      }

      const isMoved: boolean = await this.takeOver({
        recordKey: recordKey,
        ticket: stalledTicket,
        messageId: stalledMessageId,
        heldForAtMostMs: current.heldForAtMostMs(),
      });

      if (!isMoved) {
        return;
      }
    }
  }

  // The keys every script that moves a line reads: the line, and the index.
  private static lineKeys(recordKey: string): Array<string> {
    return [this.lineKeyOf(recordKey), this.indexKey()];
  }

  private static client(): ClientType | null {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return null;
    }

    return client;
  }

  /*
   * One script: its answer when it is one of `answers` (any whole number
   * from 0 up, when null), null when Valkey cannot be asked or answers
   * anything else. Never throws.
   */
  private static async run(
    script: string,
    keys: Array<string>,
    args: Array<string>,
    answers: Array<number> | null,
  ): Promise<number | null> {
    const answer: unknown = await this.evaluate(script, keys, args);

    if (
      typeof answer !== "number" ||
      !Number.isInteger(answer) ||
      answer < 0 ||
      (answers && !answers.includes(answer))
    ) {
      if (answer !== undefined) {
        this.logUnavailable(new Error(`Valkey answered ${String(answer)}`));
      }

      return null;
    }

    return answer;
  }

  // One script that answers with a list: the list, or null as run's.
  private static async runForList(
    script: string,
    keys: Array<string>,
    args: Array<string>,
  ): Promise<Array<unknown> | null> {
    const answer: unknown = await this.evaluate(script, keys, args);

    if (!Array.isArray(answer)) {
      if (answer !== undefined) {
        this.logUnavailable(new Error(`Valkey answered ${String(answer)}`));
      }

      return null;
    }

    return answer;
  }

  // What Valkey answers the script with, or undefined when it cannot be asked.
  private static async evaluate(
    script: string,
    keys: Array<string>,
    args: Array<string>,
  ): Promise<unknown> {
    const client: ClientType | null = this.client();

    if (!client) {
      return undefined;
    }

    try {
      return await client.eval(script, keys.length, ...keys, ...args);
    } catch (error) {
      this.logUnavailable(error);
      return undefined;
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
