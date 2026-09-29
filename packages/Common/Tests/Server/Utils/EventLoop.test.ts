import { describe, expect, test } from "@jest/globals";
import timers from "timers";
import EventLoop from "../../../Server/Utils/EventLoop";

/*
 * Common's jest environment is jsdom, which does not expose setImmediate -
 * and setImmediate is the entire subject of this file. A `@jest-environment
 * node` docblock is not an option (Common's shared jest.setup.ts touches
 * `window`), so lend jsdom the real one from Node, exactly as
 * MultipartFormData.test.ts does.
 *
 * This matters beyond the plumbing: the helper is server-only code, so jsdom
 * not having setImmediate is correct - but it does mean nothing under
 * Common's default environment can reach this function at all, which is
 * most of why it went untested.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * The whole value of this one-line helper is the DIFFERENCE between it and
 * `await Promise.resolve()`, and that difference is invisible in the source.
 *
 * The failure it exists to prevent: a telemetry ingest job transforms tens of
 * thousands of OTLP records in one synchronous run. While it does, the
 * single-threaded event loop never reaches its poll phase, so the HTTP handler
 * for /status/live never gets scheduled, the kubelet's liveness probe times
 * out, and Kubernetes restarts a pod that was working perfectly - mid-ingest.
 *
 * Awaiting a resolved promise does NOT fix that. It drains the microtask
 * queue and hands control straight back, so a loop that awaits one on every
 * iteration still starves the probe handler exactly as badly. Only a macrotask
 * - setImmediate, scheduled in the check phase, which runs after the poll
 * phase has had its turn - actually lets pending I/O and timers through.
 *
 * So the tests below are comparative on purpose. Asserting that
 * yieldToEventLoop resolves would pass equally well for the broken
 * implementation this file was written to rule out; asserting that a timer
 * already past its deadline runs across it, and does NOT run across a
 * microtask drain, is what distinguishes them.
 */

/**
 * Hold the event loop for at least `milliseconds` without ever yielding -
 * exactly what a chunk of synchronous OTLP transformation does to it. There
 * is no await in here, so no callback of any kind can run while it spins,
 * which is what lets the tests below assert on a timer being OVERDUE rather
 * than on how much wall clock a handful of loop turns happens to cover.
 *
 * Timed off the monotonic clock rather than Date.now(), because that is the
 * clock family libuv computes timer deadlines from: a wall-clock reading can
 * be stepped by NTP mid-spin, which would quietly turn "the timer is due now"
 * back into the guess this file exists to get rid of.
 */
function blockEventLoopFor(milliseconds: number): void {
  const startedAtNs: bigint = process.hrtime.bigint();
  const spinForNs: number = milliseconds * 1000 * 1000;

  while (Number(process.hrtime.bigint() - startedAtNs) < spinForNs) {
    // Holding the thread IS the work here.
  }
}

/*
 * Five milliseconds, and the arithmetic behind it:
 *
 * setTimeout(fn, 0) is not a zero millisecond timer. Node's timers
 * documentation is explicit that when the delay is "less than 1 [...] the
 * delay will be set to 1", so the deadline these tests block past is 1 ms.
 *
 * libuv checks that deadline against the loop's cached clock rather than a
 * fresh reading, and it only adopts the coarse monotonic clock when
 * clock_getres reports a resolution of 1 ms or better - otherwise it keeps
 * fine-grained CLOCK_MONOTONIC. So the worst case granularity of the loop
 * clock is 1 ms; it is NOT the kernel tick (4 ms at HZ=250) that the word
 * "coarse" suggests.
 *
 * 1 ms of deadline plus 1 ms of clock granularity is a 2 ms worst case. Five
 * is more than double that, and a 5 ms spin costs a test nothing.
 */
const BLOCK_UNTIL_TIMER_IS_OVERDUE_MS: number = 5;

/*
 * A ceiling for the starvation test below - a bound on how long that test may
 * spend failing, not a prediction of how many turns it needs. The reasoning
 * for the number, and for why the loop is bounded at all, is with the test.
 */
const MAX_YIELDS_BEFORE_A_TIMER_MUST_HAVE_FIRED: number = 100000;

describe("yieldToEventLoop actually advances the event loop", () => {
  /*
   * This test used to schedule a 0 ms timer and yield up to ten times hoping
   * to catch it, which was a wall-clock bet that lost on CI. Node floors
   * setTimeout(fn, 0) at 1 ms, while a setImmediate ping-pong turns the loop
   * over in single-digit microseconds, so the timer needs however many turns
   * fit inside a millisecond: measured on this machine (Node 22, idle) that
   * is 44 to 324 turns, median around 170. The exact figure is a property of
   * the hardware, not of Node - the point is that it is hundreds of turns and
   * ten was never going to be enough. The old version only passed when the
   * process happened to be descheduled, or the loop's cached time happened to
   * be stale, inside those ten turns.
   *
   * The defect was in the test, not in the helper. yieldToEventLoop hands
   * control back to the loop, and that is all it can do: it cannot make
   * wall-clock time pass, and the one thing that could - setTimeout(resolve,
   * 1) - would be a real pessimisation, capping an ingest loop at a thousand
   * chunks a second to satisfy a test. So this test asserts the guarantee the
   * helper genuinely provides, which is also the one the liveness probe
   * needs: work that is ALREADY due - a timer past its deadline, a queued I/O
   * callback - runs across a yield instead of waiting out the synchronous
   * batch.
   *
   * Two yields rather than one, because the phase the test body resumes in is
   * not ours to choose. The documented rule for setImmediate is that "if an
   * immediate timer is queued from inside an executing callback, that timer
   * will not be triggered until the next event loop iteration", so the second
   * yield's immediate cannot run until an iteration boundary has been crossed
   * - and every iteration runs its timers phase exactly once. Note that this
   * argument deliberately does not depend on WHERE in the iteration timers
   * sit: libuv 1.45 (Node 20) moved them to after the poll phase, and the
   * guarantee survives that move because it only counts iterations. It is a
   * phase-ordering guarantee rather than a timing one, so it holds on a
   * loaded CI runner exactly as well as on an idle laptop. Measured here, one
   * yield was in fact enough 500 times out of 500; two is the bound that
   * needs no assumption about where the loop was when the test resumed.
   */
  test("lets a timer that came due during blocking work run", async () => {
    let timerFired: boolean = false;

    setTimeout((): void => {
      timerFired = true;
    }, 0);

    blockEventLoopFor(BLOCK_UNTIL_TIMER_IS_OVERDUE_MS);

    /*
     * Nothing ran while the loop was blocked - that starvation is the whole
     * problem the helper exists to relieve, and pinning it here is what keeps
     * the assertion below about the yield rather than about elapsed time.
     */
    expect(timerFired).toBe(false);

    await EventLoop.yieldToEventLoop();
    await EventLoop.yieldToEventLoop();

    expect(timerFired).toBe(true);
  });

  /*
   * The control case, and the reason the helper is not just `await
   * Promise.resolve()`. Draining the microtask queue - however many times -
   * never reaches the phase where timers and I/O are serviced.
   *
   * There is deliberately no "and now yield it through" tail here any more:
   * that used to repeat the previous test byte for byte, and the property it
   * was standing in for - that the timer is genuinely still pending rather
   * than lost - is pinned by the starvation test below, which drives the same
   * construct until it fires. Only the first assertion is this test's own.
   */
  test("a microtask drain, by contrast, does not", async () => {
    let timerFired: boolean = false;

    const timer: NodeJS.Timeout = setTimeout((): void => {
      timerFired = true;
    }, 0);

    try {
      for (let i: number = 0; i < 100000; i++) {
        await Promise.resolve();
      }

      expect(timerFired).toBe(false);
    } finally {
      // Nothing else in the file should inherit a live timer from this one.
      clearTimeout(timer);
    }
  });

  /*
   * The weaker but still real property the original ten-iteration test was
   * reaching for, restored with a bound it can actually keep: a yield loop
   * does not STARVE a timer that is not yet due. A setImmediate ping-pong
   * could in principle keep re-entering the check phase and never let the
   * loop clock advance past the deadline; it does not, and an ingest job that
   * yields in a tight loop depends on it not doing so.
   *
   * The bound here is temporal, not countable. Each yield turns the loop over
   * once, so the timer comes due after however many turns fit in its 1 ms
   * deadline - and that count goes DOWN on a slower or busier machine,
   * because each turn then costs more wall clock. The direction of error is
   * the friendly one: 100,000 is roughly three hundred times the worst case
   * measured here, and CI load only makes it more generous.
   *
   * The loop is capped rather than written `while (!timerFired)` for a
   * reason that is easy to get backwards. Against a microtask-based
   * implementation - the exact regression this file exists to catch - an
   * uncapped loop would never advance the loop clock, so the timer would
   * never fire AND jest's own testTimeout, which is itself a timer, could
   * never fire either: the worker would hang until the job timeout instead of
   * going red. Measured: the uncapped form outlived a 5 second watchdog and
   * had to be killed, while the capped form exhausts 100,000 microtask turns
   * and fails in about 6 ms.
   */
  test("a yield loop lets a timer that is not yet due through", async () => {
    let timerFired: boolean = false;

    setTimeout((): void => {
      timerFired = true;
    }, 0);

    let yields: number = 0;

    while (!timerFired && yields < MAX_YIELDS_BEFORE_A_TIMER_MUST_HAVE_FIRED) {
      await EventLoop.yieldToEventLoop();
      yields++;
    }

    // False here means the cap was exhausted: the yield never let it through.
    expect(timerFired).toBe(true);
  });

  /*
   * What separates setImmediate from setTimeout(resolve, 0), which every
   * other test in this file is blind to - a mutant helper built on a 0 ms
   * timer passes all of them, and the comment above argues against exactly
   * that substitution, so something has to hold the line.
   *
   * setImmediate resolves in the check phase of the loop iteration it is
   * queued for, and immediates run in the order they were created, so an
   * immediate queued AFTER the yield cannot have run by the time the yield's
   * continuation does. A timer-based helper cannot manage that: its resolve
   * waits out a 1 ms deadline, which is several hundred check phases away, so
   * the later immediate wins.
   *
   * Repeated a handful of times because a single probe is not quite decisive:
   * measured, setTimeout(resolve, 0) survives one probe about 3 times in 200
   * (when the process is descheduled past the 1 ms floor between the two
   * scheduling calls), but never survives five in a row - 0/200 for both
   * setTimeout(resolve, 0) and setTimeout(resolve, 1), against 200/200 for
   * the real implementation. Repetition costs five loop turns and buys the
   * distinction outright.
   */
  test("resolves ahead of an immediate queued after it", async () => {
    const probes: number = 5;

    for (let probe: number = 0; probe < probes; probe++) {
      let laterImmediateFired: boolean = false;

      const yielded: Promise<void> = EventLoop.yieldToEventLoop();

      setImmediate((): void => {
        laterImmediateFired = true;
      });

      await yielded;

      expect(laterImmediateFired).toBe(false);
    }
  });

  test("lets a pending immediate callback run", async () => {
    let immediateFired: boolean = false;

    setImmediate((): void => {
      immediateFired = true;
    });

    await EventLoop.yieldToEventLoop();

    expect(immediateFired).toBe(true);
  });

  /*
   * The real usage: a CPU-bound loop that yields every N items. Each yield
   * has to give the loop a turn, not just the first one.
   */
  test("gives the loop a turn on every iteration of a chunked loop", async () => {
    const ticks: Array<number> = [];
    let chunk: number = 0;

    const interval: NodeJS.Timeout = setInterval((): void => {
      ticks.push(chunk);
    }, 1);

    try {
      for (chunk = 0; chunk < 5; chunk++) {
        // Stand in for a chunk of synchronous transformation work.
        for (let i: number = 0; i < 10000; i++) {
          void i;
        }

        await EventLoop.yieldToEventLoop();
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 2);
        });
      }
    } finally {
      clearInterval(interval);
    }

    // The interval got scheduled repeatedly, across several different chunks.
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks).size).toBeGreaterThan(1);
  });
});

describe("the shape of the helper itself", () => {
  test("resolves with nothing", async () => {
    await expect(EventLoop.yieldToEventLoop()).resolves.toBeUndefined();
  });

  test("returns a promise rather than running synchronously", () => {
    let settled: boolean = false;

    const pending: Promise<void> = EventLoop.yieldToEventLoop().then(
      (): void => {
        settled = true;
      },
    );

    // Still pending on the very next line - it is not a synchronous no-op.
    expect(settled).toBe(false);

    return pending;
  });

  /*
   * The real subject here is termination - a yield that never resolved would
   * hang this loop until jest's testTimeout, not fail an assertion - so the
   * count is asserted rather than a bare `expect(true)`: it at least pins
   * that every one of the fifty awaits settled and the loop body ran each
   * time.
   */
  test("can be awaited many times in a row", async () => {
    let completedYields: number = 0;

    for (let i: number = 0; i < 50; i++) {
      await EventLoop.yieldToEventLoop();
      completedYields++;
    }

    expect(completedYields).toBe(50);
  });

  test("several concurrent yields all resolve", async () => {
    await expect(
      Promise.all([
        EventLoop.yieldToEventLoop(),
        EventLoop.yieldToEventLoop(),
        EventLoop.yieldToEventLoop(),
      ]),
    ).resolves.toEqual([undefined, undefined, undefined]);
  });
});
