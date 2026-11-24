/*
 * WHEN THIS PROCESS'S EVENT LOOP WAS BLOCKED, FOR WHAT WAITED ON IT
 * (issue #10108).
 *
 * An answer from a socket - a Postgres row, a ClickHouse result - is only
 * read when the event loop gets to it. While a piece of work holds the loop,
 * the answer waits in the socket, and whoever timed the request counts the
 * wait as the request's: TypeORM's slow-query log named a one-row SELECT by
 * id "slow" at 2.5 seconds, every one of them the time a grouped monitor's
 * evaluation held the loop.
 *
 * A timer ticks every TICK_MS. A tick that comes late says the loop was
 * blocked from when it was due to when it ran, and the stretch is kept for a
 * while. getBlockedStretchBefore says how long the loop had been blocked
 * right before a moment - the stretch going on now (the tick is overdue), or
 * one that has only just ended (its late tick ran just before) - which is
 * the most an answer read at that moment can have waited for it: had the
 * loop been free before the stretch, the answer would have been read then.
 *
 * The timer starts on first use, and never keeps the process alive.
 */

export const EVENT_LOOP_TICK_MS: number = 10;

// How much later than due a tick must run to count as a blocked loop.
export const EVENT_LOOP_STALL_MS: number = 20;

// How long a stall is kept, for a request that started before it.
const KEPT_FOR_MS: number = 5 * 60 * 1000;
const KEPT_AT_MOST: number = 1024;

export interface EventLoopStall {
  startMs: number;
  endMs: number;
}

export default class EventLoopStalls {
  private static timer: NodeJS.Timeout | null = null;
  private static lastTickAt: number = 0;
  private static stalls: Array<EventLoopStall> = [];

  // Starts the timer, once. Cheap to call on every request.
  public static start(): void {
    if (EventLoopStalls.timer) {
      return;
    }

    EventLoopStalls.lastTickAt = Date.now();
    EventLoopStalls.timer = setInterval((): void => {
      EventLoopStalls.tick(Date.now());
    }, EVENT_LOOP_TICK_MS);

    // Never what keeps the process from exiting.
    if (typeof EventLoopStalls.timer.unref === "function") {
      EventLoopStalls.timer.unref();
    }
  }

  // Stops the timer and forgets every stall (for tests).
  public static stop(): void {
    if (EventLoopStalls.timer) {
      clearInterval(EventLoopStalls.timer);
    }

    EventLoopStalls.timer = null;
    EventLoopStalls.stalls = [];
    EventLoopStalls.lastTickAt = 0;
  }

  public static isStarted(): boolean {
    return EventLoopStalls.timer !== null;
  }

  // A tick, at nowMs: a late one keeps the stretch the loop was blocked.
  public static tick(nowMs: number): void {
    const dueAt: number = EventLoopStalls.lastTickAt + EVENT_LOOP_TICK_MS;

    if (nowMs - dueAt > EVENT_LOOP_STALL_MS) {
      EventLoopStalls.stalls.push({ startMs: dueAt, endMs: nowMs });

      // Old stalls, and more than enough of them, go.
      const keptFrom: number = nowMs - KEPT_FOR_MS;
      let firstKept: number = 0;

      while (
        firstKept < EventLoopStalls.stalls.length &&
        (EventLoopStalls.stalls[firstKept]!.endMs < keptFrom ||
          EventLoopStalls.stalls.length - firstKept > KEPT_AT_MOST)
      ) {
        firstKept++;
      }

      if (firstKept > 0) {
        EventLoopStalls.stalls = EventLoopStalls.stalls.slice(firstKept);
      }
    }

    EventLoopStalls.lastTickAt = nowMs;
  }

  /*
   * How long the event loop had been blocked right before atMs: the most
   * something read at atMs - an answer from a socket - can have waited for
   * it. 0 when the loop was free just before, and when the timer has not
   * started.
   */
  public static getBlockedStretchBefore(atMs: number = Date.now()): number {
    if (!EventLoopStalls.timer) {
      return 0;
    }

    // Still blocked: the tick that was due has not run.
    const overdueMs: number =
      atMs - (EventLoopStalls.lastTickAt + EVENT_LOOP_TICK_MS);

    if (overdueMs > EVENT_LOOP_STALL_MS) {
      return overdueMs;
    }

    // A stall that has just ended: its late tick ran before atMs.
    const last: EventLoopStall | undefined =
      EventLoopStalls.stalls[EventLoopStalls.stalls.length - 1];

    if (
      last &&
      last.endMs <= atMs &&
      atMs - last.endMs <= EVENT_LOOP_TICK_MS + EVENT_LOOP_STALL_MS
    ) {
      return atMs - last.startMs;
    }

    return 0;
  }

  // The stalls kept, oldest first (for tests and diagnostics).
  public static getStalls(): Array<EventLoopStall> {
    return [...EventLoopStalls.stalls];
  }
}
