import fs from "fs";
import { mock } from "node:test";

/*
 * "It printed something, then the time budget ran out" — deterministically.
 *
 * The fake CLIs (FakeBinary, FakeGovc, FakeCeph) are Node processes, and on
 * a loaded machine one can take longer to start and print than any small
 * time budget: a test that expects the output of a command the sandbox
 * killed would then get a kill with no output at all. A bigger budget only
 * makes that rarer (and every such test waits out the whole budget).
 *
 * killAfterOutput runs the command with setTimeout mocked (the sandbox's
 * time budget is a setTimeout), waits until the fake says everything it
 * printed is in the pipes (a response scripted with announcePrinted), and
 * only then lets the budget run out. The kill always lands after the
 * output, however slow the machine, and no real time passes waiting for it.
 * The command's result is exactly what the sandbox makes of a kill at its
 * budget: timedOut, the budget in the message, the output it had printed.
 */

// The file a fake creates in its directory once its output is in the pipes.
export const PRINTED_MARKER: string = "printed";

/*
 * Real setTimeout, captured before any test mocks it: waiting for a fake
 * to start needs real time to pass while the sandbox's clock stands still.
 */
const realSetTimeout: typeof setTimeout = setTimeout;

// However busy the machine, a fake that has not printed by now never will.
const PRINT_WAIT_LIMIT_MS: number = 60_000;
const PRINT_POLL_MS: number = 10;

/*
 * Resolves once `file` exists, or when `signal` aborts; rejects after
 * PRINT_WAIT_LIMIT_MS.
 */
export async function waitForFile(
  file: string,
  signal?: AbortSignal | undefined,
): Promise<void> {
  const deadline: number = Date.now() + PRINT_WAIT_LIMIT_MS;

  while (!fs.existsSync(file)) {
    if (signal?.aborted) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `${file} did not appear within ${PRINT_WAIT_LIMIT_MS}ms: the fake never printed its scripted output.`,
      );
    }

    await new Promise<void>((resolve: () => void): void => {
      realSetTimeout(resolve, PRINT_POLL_MS);
    });
  }
}

export async function killAfterOutput<T>(data: {
  // The command's time budget, as its request carries it.
  timeoutInMs: number;
  // Starts the command (prepare, then run). Called with the clock mocked.
  run: () => Promise<T>;
  // Resolves once the fake has printed (its waitUntilPrinted).
  printed: (signal: AbortSignal) => Promise<void>;
}): Promise<T> {
  mock.timers.enable({ apis: ["setTimeout"] });
  const stopWaiting: AbortController = new AbortController();

  try {
    const running: Promise<T> = data.run();
    // A command that ends before it prints (refused, never started) must not wait.
    const ended: Promise<"ended"> = running.then(
      (): "ended" => {
        return "ended";
      },
      (): "ended" => {
        return "ended";
      },
    );
    const printed: Promise<"printed"> = data
      .printed(stopWaiting.signal)
      .then((): "printed" => {
        return "printed";
      });

    if ((await Promise.race([printed, ended])) === "printed") {
      // The budget runs out now: the sandbox kills a fake that has printed.
      mock.timers.tick(data.timeoutInMs);
    }

    return await running;
  } finally {
    stopWaiting.abort();
    mock.timers.reset();
  }
}
