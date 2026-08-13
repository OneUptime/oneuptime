/*
 * The builder's "what happened to the run I just started" watch, exercised
 * through a real component lifecycle.
 *
 * Everything here is about timing: which run counts as ours, what happens to a
 * request that is still in flight when the answer stops mattering, and when to
 * stop asking. RunStatusWatcher.test.ts covers what the watch *says*; this
 * covers when it asks and what it holds on to.
 */

import useRunWatch, {
  FetchLatestRunFunction,
  UseRunWatchResult,
  WatchedRunDetail,
} from "../../../../UI/Components/Workflow/UseRunWatch";
import {
  MAX_RUN_WATCH_POLLS,
  RUN_WATCH_POLL_INTERVAL_MS,
} from "../../../../UI/Components/Workflow/RunStatusWatcher";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
} from "../../../../Types/Workflow/StepTrace";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

const PREVIOUS_RUN_ID: string = "run-before";
const NEW_RUN_ID: string = "run-new";

type FetchMock = Mock<FetchLatestRunFunction>;

type RunOverrides = Partial<WatchedRunDetail>;

const aRun: (overrides?: RunOverrides) => WatchedRunDetail = (
  overrides?: RunOverrides,
): WatchedRunDetail => {
  return {
    runId: NEW_RUN_ID,
    status: WorkflowStatus.Running,
    logs: "",
    stepTrace: { steps: [] },
    ...overrides,
  };
};

const traceWith: (stepCount: number) => WorkflowStepTrace = (
  stepCount: number,
): WorkflowStepTrace => {
  return {
    steps: Array.from({ length: stepCount }, (_unused: unknown, i: number) => {
      return {
        componentId: `step-${i}`,
        metadataId: "api-get",
        title: `Step ${i}`,
        status: WorkflowStepStatus.Success,
        startedAt: "2024-01-01T00:00:00.000Z",
        completedAt: "2024-01-01T00:00:01.000Z",
        durationInMs: 1000,
        argumentValues: {},
        returnValues: {},
        executedPort: "out",
      };
    }),
  };
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

const deferred: <T>() => Deferred<T> = <T,>(): Deferred<T> => {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};

  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (reason?: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
};

/*
 * The hook's handles, kept where the tests can reach them. The probe renders
 * everything the hook returns so assertions read off the DOM rather than off a
 * captured object that may be a render behind.
 */
let watch: UseRunWatchResult;

interface ProbeProps {
  fetchLatestRun: FetchLatestRunFunction;
}

const Probe: FunctionComponent<ProbeProps> = (
  props: ProbeProps,
): ReactElement => {
  const result: UseRunWatchResult = useRunWatch({
    fetchLatestRun: props.fetchLatestRun,
  });

  watch = result;

  return (
    <div>
      <span data-testid="message">{result.message ?? "(none)"}</span>
      <span data-testid="has-failed">{String(result.hasFailed)}</span>
      <span data-testid="is-watching">{String(result.isWatching)}</span>
      <span data-testid="logs">{result.logs}</span>
      <span data-testid="step-count">{result.stepTrace.steps.length}</span>
    </div>
  );
};

const message: () => string = (): string => {
  return screen.getByTestId("message").textContent || "";
};

const isWatching: () => boolean = (): boolean => {
  return screen.getByTestId("is-watching").textContent === "true";
};

const hasFailed: () => boolean = (): boolean => {
  return screen.getByTestId("has-failed").textContent === "true";
};

const logs: () => string = (): string => {
  return screen.getByTestId("logs").textContent || "";
};

const stepCount: () => number = (): number => {
  return Number(screen.getByTestId("step-count").textContent);
};

/** Let pending promise callbacks run without moving the clock. */
const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

/** Move the clock far enough for the next poll, and let it finish. */
const advanceOnePoll: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(RUN_WATCH_POLL_INTERVAL_MS);
  });

  await settle();
};

const startWatching: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    watch.startWatchingRun();
  });
};

describe("useRunWatch", () => {
  let fetchLatestRun: FetchMock;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchLatestRun = jest.fn<FetchLatestRunFunction>();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  describe("before a run is triggered", () => {
    test("asks nothing and says nothing", async () => {
      fetchLatestRun.mockResolvedValue(aRun());

      render(<Probe fetchLatestRun={fetchLatestRun} />);

      await act(async () => {
        jest.advanceTimersByTime(RUN_WATCH_POLL_INTERVAL_MS * 10);
      });

      expect(fetchLatestRun).not.toHaveBeenCalled();
      expect(message()).toBe("(none)");
      expect(isWatching()).toBe(false);
      expect(hasFailed()).toBe(false);
      expect(logs()).toBe("");
    });
  });

  describe("noting the run that came before", () => {
    /*
     * The trigger endpoint does not hand back a log id, so a run is only
     * *ours* once its id differs from the one that was newest beforehand.
     */
    test("does not mistake the previous run for the one just started", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ runId: PREVIOUS_RUN_ID, status: WorkflowStatus.Success }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);

      await act(async () => {
        await watch.captureRunBeforeTrigger();
      });

      await startWatching();
      await settle();

      // Still waiting for a run of our own, not reporting the old one's ending.
      expect(message()).toMatch(/starting/i);
      expect(isWatching()).toBe(true);
    });

    test("takes the first run it sees when there were none before", async () => {
      fetchLatestRun.mockResolvedValueOnce(null);

      render(<Probe fetchLatestRun={fetchLatestRun} />);

      await act(async () => {
        await watch.captureRunBeforeTrigger();
      });

      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Success, logs: "done" }),
      );

      await startWatching();
      await settle();

      expect(message()).toMatch(/finished successfully/i);
      expect(logs()).toBe("done");
    });

    /*
     * Without a baseline the first run seen counts as ours. Showing the run
     * before this one beats showing nothing at all.
     */
    test("falls back to that when it cannot ask", async () => {
      fetchLatestRun.mockRejectedValueOnce(new Error("network"));

      render(<Probe fetchLatestRun={fetchLatestRun} />);

      await act(async () => {
        await watch.captureRunBeforeTrigger();
      });

      fetchLatestRun.mockResolvedValue(
        aRun({ runId: PREVIOUS_RUN_ID, status: WorkflowStatus.Success }),
      );

      await startWatching();
      await settle();

      expect(message()).toMatch(/finished successfully/i);
    });

    test("does not poll while capturing", async () => {
      fetchLatestRun.mockResolvedValue(aRun());

      render(<Probe fetchLatestRun={fetchLatestRun} />);

      await act(async () => {
        await watch.captureRunBeforeTrigger();
      });

      expect(fetchLatestRun).toHaveBeenCalledTimes(1);
      expect(isWatching()).toBe(false);
    });
  });

  describe("while the run is going", () => {
    test("says the run is starting before the first answer arrives", async () => {
      const pending: Deferred<WatchedRunDetail | null> =
        deferred<WatchedRunDetail | null>();
      fetchLatestRun.mockReturnValue(pending.promise);

      render(<Probe fetchLatestRun={fetchLatestRun} />);

      await startWatching();

      expect(message()).toBe("Starting run…");
      expect(isWatching()).toBe(true);
    });

    test("reports what the run is doing", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Running }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(message()).toMatch(/running/i);
      expect(isWatching()).toBe(true);
    });

    test("hands over the run's log and steps", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ logs: "first line", stepTrace: traceWith(2) }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(logs()).toBe("first line");
      expect(stepCount()).toBe(2);
    });

    test("keeps up as the run writes more", async () => {
      fetchLatestRun
        .mockResolvedValueOnce(aRun({ logs: "one", stepTrace: traceWith(1) }))
        .mockResolvedValueOnce(
          aRun({ logs: "one\ntwo", stepTrace: traceWith(2) }),
        )
        .mockResolvedValue(
          aRun({
            logs: "one\ntwo\nthree",
            stepTrace: traceWith(3),
            status: WorkflowStatus.Success,
          }),
        );

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(logs()).toBe("one");
      expect(stepCount()).toBe(1);

      await advanceOnePoll();

      expect(logs()).toBe("one\ntwo");
      expect(stepCount()).toBe(2);

      await advanceOnePoll();

      expect(logs()).toBe("one\ntwo\nthree");
      expect(stepCount()).toBe(3);
      expect(isWatching()).toBe(false);
    });

    test("polls on the interval, not faster", async () => {
      fetchLatestRun.mockResolvedValue(aRun());

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(fetchLatestRun).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(RUN_WATCH_POLL_INTERVAL_MS - 1);
      });
      await settle();

      expect(fetchLatestRun).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      await settle();

      expect(fetchLatestRun).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the run ends", () => {
    test("stops on success", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Success }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(message()).toMatch(/finished successfully/i);
      expect(isWatching()).toBe(false);
      expect(hasFailed()).toBe(false);

      await advanceOnePoll();
      await advanceOnePoll();

      expect(fetchLatestRun).toHaveBeenCalledTimes(1);
    });

    test("stops on failure, and says it failed", async () => {
      fetchLatestRun.mockResolvedValue(aRun({ status: WorkflowStatus.Error }));

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(hasFailed()).toBe(true);
      expect(isWatching()).toBe(false);
      expect(message()).toMatch(/run log/i);
    });

    test.each([
      [WorkflowStatus.Timeout],
      [WorkflowStatus.WorkflowCountExceeded],
    ])("stops on %s", async (status: WorkflowStatus) => {
      fetchLatestRun.mockResolvedValue(aRun({ status: status }));

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(hasFailed()).toBe(true);
      expect(isWatching()).toBe(false);
    });

    /*
     * A Sleep step parks a run for as long as it likes. Following it is not
     * worth an open request every two seconds.
     */
    test("stops following a run that went to sleep", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Waiting, logs: "sleeping now" }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(message()).toMatch(/sleeping/i);
      expect(isWatching()).toBe(false);
      expect(hasFailed()).toBe(false);
      // What it managed to log before parking is still worth showing.
      expect(logs()).toBe("sleeping now");
    });

    test("gives up rather than polling forever", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Running }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      for (let i: number = 0; i < MAX_RUN_WATCH_POLLS; i++) {
        await advanceOnePoll();
      }

      expect(message()).toMatch(/taking a while/i);
      expect(isWatching()).toBe(false);

      const callsWhenItGaveUp: number = fetchLatestRun.mock.calls.length;

      await advanceOnePoll();

      expect(fetchLatestRun).toHaveBeenCalledTimes(callsWhenItGaveUp);
    });
  });

  describe("when a poll fails", () => {
    test("keeps watching — a failed request is not a failed run", async () => {
      fetchLatestRun.mockRejectedValueOnce(new Error("network"));

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(isWatching()).toBe(true);
      expect(hasFailed()).toBe(false);

      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Success, logs: "recovered" }),
      );

      await advanceOnePoll();

      expect(message()).toMatch(/finished successfully/i);
      expect(logs()).toBe("recovered");
    });

    test("holds on to the log it already has", async () => {
      fetchLatestRun.mockResolvedValueOnce(aRun({ logs: "some output" }));

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(logs()).toBe("some output");

      fetchLatestRun.mockRejectedValueOnce(new Error("network"));

      await advanceOnePoll();

      expect(logs()).toBe("some output");
    });
  });

  describe("starting another run", () => {
    test("clears the run before it", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({
          status: WorkflowStatus.Error,
          logs: "it broke",
          stepTrace: traceWith(3),
        }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();
      await settle();

      expect(hasFailed()).toBe(true);
      expect(logs()).toBe("it broke");

      const stillPending: Deferred<WatchedRunDetail | null> =
        deferred<WatchedRunDetail | null>();
      fetchLatestRun.mockReturnValue(stillPending.promise);

      await startWatching();

      expect(message()).toBe("Starting run…");
      expect(hasFailed()).toBe(false);
      expect(logs()).toBe("");
      expect(stepCount()).toBe(0);
      expect(isWatching()).toBe(true);
    });

    /*
     * A poll is a request in flight. Starting a second run before the first
     * answers leaves that answer coming — it must not report on the new run's
     * behalf, and it must not leave a second chain of timers running.
     */
    test("ignores an answer to the watch it replaced", async () => {
      const firstPoll: Deferred<WatchedRunDetail | null> =
        deferred<WatchedRunDetail | null>();
      fetchLatestRun.mockReturnValueOnce(firstPoll.promise);

      render(<Probe fetchLatestRun={fetchLatestRun} />);
      await startWatching();

      const secondPoll: Deferred<WatchedRunDetail | null> =
        deferred<WatchedRunDetail | null>();
      fetchLatestRun.mockReturnValue(secondPoll.promise);

      await startWatching();

      // The abandoned request answers late, claiming the run is over.
      await act(async () => {
        firstPoll.resolve(aRun({ status: WorkflowStatus.Success }));
      });
      await settle();

      expect(isWatching()).toBe(true);
      expect(message()).toBe("Starting run…");
    });

    test("leaves only one chain of polls running", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Running }),
      );

      render(<Probe fetchLatestRun={fetchLatestRun} />);

      await startWatching();
      await settle();
      await startWatching();
      await settle();

      const callsSoFar: number = fetchLatestRun.mock.calls.length;

      await advanceOnePoll();

      expect(fetchLatestRun.mock.calls.length - callsSoFar).toBe(1);

      await advanceOnePoll();

      expect(fetchLatestRun.mock.calls.length - callsSoFar).toBe(2);
    });
  });

  describe("lifecycle", () => {
    test("stops polling once the page is gone", async () => {
      fetchLatestRun.mockResolvedValue(
        aRun({ status: WorkflowStatus.Running }),
      );

      const view: RenderResult = render(
        <Probe fetchLatestRun={fetchLatestRun} />,
      );
      await startWatching();
      await settle();

      const callsWhileMounted: number = fetchLatestRun.mock.calls.length;

      view.unmount();

      await act(async () => {
        jest.advanceTimersByTime(RUN_WATCH_POLL_INTERVAL_MS * 5);
      });

      expect(fetchLatestRun).toHaveBeenCalledTimes(callsWhileMounted);
    });

    test("swallows an answer that arrives after the page is gone", async () => {
      const pending: Deferred<WatchedRunDetail | null> =
        deferred<WatchedRunDetail | null>();
      fetchLatestRun.mockReturnValue(pending.promise);

      const view: RenderResult = render(
        <Probe fetchLatestRun={fetchLatestRun} />,
      );
      await startWatching();

      view.unmount();

      await act(async () => {
        pending.resolve(aRun({ status: WorkflowStatus.Success }));
      });
      await settle();

      // Nothing was scheduled on the way out, and nothing threw.
      expect(jest.getTimerCount()).toBe(0);
    });

    test("uses the newest fetch function, not the one the watch started with", async () => {
      const stale: FetchMock = jest.fn<FetchLatestRunFunction>();
      stale.mockResolvedValue(aRun({ logs: "stale" }));

      const view: RenderResult = render(<Probe fetchLatestRun={stale} />);
      await startWatching();
      await settle();

      const fresh: FetchMock = jest.fn<FetchLatestRunFunction>();
      fresh.mockResolvedValue(
        aRun({ logs: "fresh", status: WorkflowStatus.Success }),
      );

      view.rerender(<Probe fetchLatestRun={fresh} />);

      await advanceOnePoll();

      expect(fresh).toHaveBeenCalled();
      expect(logs()).toBe("fresh");
    });
  });
});
