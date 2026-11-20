import { performance } from "perf_hooks";
import { SlicedWorkSteps } from "../../Utils/SlicedWork";

/*
 * How long a loop over a batch - a telemetry ingest job's records, say - may
 * hold the event loop before it hands it back, in milliseconds.
 *
 * Handing it back costs about a microsecond when nothing else is waiting, so
 * the budget is not about the loop's own speed: it is how long every other
 * request, job and health probe on the process may have to wait for it. A
 * batch of small records used to hand the loop back every 500 logs or 200
 * spans, some 10 to 60 milliseconds of work; a batch of records at the
 * scrub rules' 10,000-value bound held it for seconds that way, and for most
 * of a minute against a custom pattern. A loop that checks its budget
 * between records holds the loop for at most this long and one record more.
 */
export const EVENT_LOOP_BUDGET_MS: number = 20;

export default class EventLoop {
  /**
   * Yields control back to the Node.js event loop, resuming on a later
   * "check" phase tick.
   *
   * Use this to break up CPU-bound synchronous work — e.g. transforming
   * tens of thousands of OTLP datapoints / spans / log records inside a
   * single ingest job — so the process can service pending I/O between
   * chunks. Most importantly, this lets the Kubernetes liveness and
   * readiness probe handlers (/status/live, /status/ready) run. Without a
   * periodic yield a large batch pins the single-threaded event loop for
   * seconds at a time, the probe HTTP handler never gets scheduled, the
   * kubelet marks the probe as failed, and the pod is restarted.
   *
   * IMPORTANT: this is implemented with setImmediate, NOT
   * `await Promise.resolve()`. Awaiting a resolved promise only drains the
   * microtask queue; the event loop never advances to its poll phase, so
   * queued I/O (including probe requests) stays starved no matter how often
   * you await. setImmediate schedules a macrotask in the check phase, which
   * runs only after the poll phase has had a chance to process I/O — so a
   * loop that periodically awaits this genuinely unblocks the event loop.
   *
   * A loop over records whose work varies - one log can take a thousand
   * times another - yields by an EventLoopBudget rather than every so many
   * records.
   */
  public static async yieldToEventLoop(): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      if (typeof setImmediate === "function") {
        setImmediate(resolve);
        return;
      }

      /*
       * A runtime without setImmediate - the browser-like environment
       * Common's tests run server code in: a timer turns the loop as well.
       * Node always has it.
       */
      setTimeout(resolve, 0);
    });
  }

  /*
   * The clock an EventLoopBudget reads: milliseconds that never go back,
   * whatever happens to the wall clock - and that a test can replace.
   */
  public static now(): number {
    return performance.now();
  }

  /*
   * Runs work written to pause (SlicedWork) and hands the event loop back
   * at a pause whenever the work since the loop was last handed back has
   * taken the budget: one budget for the whole work, or the caller's, so a
   * loop that drives several pieces of work keeps one clock. Its result is
   * the work's; what it throws is thrown here.
   */
  public static async runInSlices<T>(
    work: SlicedWorkSteps<T>,
    budget: EventLoopBudget = new EventLoopBudget(),
  ): Promise<T> {
    let step: IteratorResult<void, T> = work.next();

    while (!step.done) {
      if (budget.isSpent()) {
        await budget.handBack();
      }

      step = work.next();
    }

    return step.value;
  }
}

/*
 * HAND THE EVENT LOOP BACK BY THE TIME THE WORK TOOK, NOT BY A COUNT.
 *
 * A loop that yields every so many records holds the event loop for as long
 * as that many records take, and a record's work is not bounded by the
 * count: a log or a span can carry up to 10,000 values inside its lists and
 * maps, each read by every scrub rule of its project, besides its drop
 * filters, pipelines and the encoding of its row. So a loop keeps one budget
 * for the whole batch - its resources, scopes and records alike - and asks
 * it between two records:
 *
 *   if (budget.isSpent()) {
 *     await budget.handBack();
 *   }
 *
 * The question costs one read of a monotonic clock and never awaits, so a
 * batch of small records pays nothing more for it than it did for its
 * counter; the loop is handed back only once the work since the last time
 * has taken EVENT_LOOP_BUDGET_MS. One record's own work is never split.
 */
export class EventLoopBudget {
  private readonly budgetInMs: number;
  private handedBackAt: number;

  public constructor(budgetInMs: number = EVENT_LOOP_BUDGET_MS) {
    this.budgetInMs = budgetInMs;
    this.handedBackAt = EventLoop.now();
  }

  // Whether the work since the loop was last handed back took the budget.
  public isSpent(): boolean {
    return EventLoop.now() - this.handedBackAt >= this.budgetInMs;
  }

  /*
   * Hands the event loop back (EventLoop.yieldToEventLoop), and starts the
   * budget again from when the loop has it back.
   */
  public async handBack(): Promise<void> {
    await EventLoop.yieldToEventLoop();
    this.handedBackAt = EventLoop.now();
  }
}
