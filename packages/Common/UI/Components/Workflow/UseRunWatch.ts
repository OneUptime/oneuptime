/*
 * Following the run the builder just started, until it settles.
 *
 * RunStatusWatcher decides what to say and when to stop; this is the part that
 * holds a timer, a generation counter and the run's log, and it lives here
 * rather than in the page so it can be exercised through a real component
 * lifecycle. Fetching is injected: the page knows how to ask the API for a
 * run, and the hook only cares that asking returns one.
 */

import {
  RUN_WATCH_POLL_INTERVAL_MS,
  RunWatchDecision,
  WatchedRun,
  decideRunWatch,
  isFailedRunStatus,
} from "./RunStatusWatcher";
import {
  WorkflowStepTrace,
  emptyTrace,
} from "../../../Types/Workflow/StepTrace";
import React, { useEffect, useRef, useState } from "react";

/** A run, with everything the run log modal needs to show it. */
export interface WatchedRunDetail extends WatchedRun {
  logs: string;
  stepTrace: WorkflowStepTrace;
}

export type FetchLatestRunFunction = () => Promise<WatchedRunDetail | null>;

export interface UseRunWatchResult {
  /** What the run is doing, in a sentence. Null before anything is watched. */
  message: string | null;
  /** The run ended badly. */
  hasFailed: boolean;
  /** Still following: what is on screen is not the final word. */
  isWatching: boolean;
  /** The run's log so far. */
  logs: string;
  /** The run's steps so far. */
  stepTrace: WorkflowStepTrace;
  /**
   * Note which run is newest *before* triggering a new one. Await this before
   * the request that starts the run: a worker can pick the job up and create
   * its log while that request is still in flight, and asking afterwards can
   * record the new run as the old one — leaving the watch waiting for a run
   * that already exists.
   */
  captureRunBeforeTrigger: () => Promise<void>;
  /** Start following the run that was just triggered. */
  startWatchingRun: () => void;
}

export interface UseRunWatchParams {
  fetchLatestRun: FetchLatestRunFunction;
}

export type UseRunWatchFunction = (
  params: UseRunWatchParams,
) => UseRunWatchResult;

const useRunWatch: UseRunWatchFunction = (
  params: UseRunWatchParams,
): UseRunWatchResult => {
  const [message, setMessage] = useState<string | null>(null);
  const [hasFailed, setHasFailed] = useState<boolean>(false);
  const [isWatching, setIsWatching] = useState<boolean>(false);
  const [logs, setLogs] = useState<string>("");
  const [stepTrace, setStepTrace] = useState<WorkflowStepTrace>(emptyTrace());

  /*
   * The page rebuilds its fetch function on every render. Reading it through a
   * ref keeps a poll that is already in flight from being pinned to the
   * function it started with.
   */
  const fetchLatestRun: React.MutableRefObject<FetchLatestRunFunction> =
    useRef<FetchLatestRunFunction>(params.fetchLatestRun);

  useEffect(() => {
    fetchLatestRun.current = params.fetchLatestRun;
  }, [params.fetchLatestRun]);

  const pollTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runIdBeforeTrigger: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  /*
   * Which watch a poll belongs to. A poll is a pending promise, so starting a
   * second run while the first is mid-request leaves that request in flight —
   * it comes back, and without this would report on the wrong run and schedule
   * a second chain of timers alongside the new one.
   */
  const watchGeneration: React.MutableRefObject<number> = useRef<number>(0);

  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;

      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, []);

  type PollRunFunction = (
    pollCount: number,
    generation: number,
  ) => Promise<void>;

  const pollRun: PollRunFunction = async (
    pollCount: number,
    generation: number,
  ): Promise<void> => {
    let run: WatchedRunDetail | null = null;

    try {
      run = await fetchLatestRun.current();
    } catch {
      /*
       * A failed poll is not a failed run. Keep watching — the next poll may
       * well succeed, and the Logs tab is the fallback either way.
       */
      run = null;
    }

    // This watch was replaced or the page went away while we were asking.
    if (!isMounted.current || generation !== watchGeneration.current) {
      return;
    }

    // Not our run yet: the worker has not created its log.
    if (run && run.runId === runIdBeforeTrigger.current) {
      run = null;
    }

    if (run) {
      setLogs(run.logs);
      setStepTrace(run.stepTrace);
    }

    const decision: RunWatchDecision = decideRunWatch({
      run: run,
      pollCount: pollCount,
    });

    setMessage(decision.message);
    setHasFailed(isFailedRunStatus(run?.status));

    if (!decision.shouldContinue) {
      setIsWatching(false);
      return;
    }

    pollTimer.current = setTimeout(() => {
      void pollRun(pollCount + 1, generation);
    }, RUN_WATCH_POLL_INTERVAL_MS);
  };

  const captureRunBeforeTrigger: () => Promise<void> =
    async (): Promise<void> => {
      try {
        const existing: WatchedRunDetail | null =
          await fetchLatestRun.current();
        runIdBeforeTrigger.current = existing ? existing.runId : null;
      } catch {
        /*
         * Without a baseline the first run we see counts as ours. That is the
         * kinder failure: showing the previous run beats showing nothing.
         */
        runIdBeforeTrigger.current = null;
      }
    };

  const startWatchingRun: () => void = (): void => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }

    watchGeneration.current = watchGeneration.current + 1;

    setHasFailed(false);
    setMessage("Starting run…");
    setLogs("");
    setStepTrace(emptyTrace());
    setIsWatching(true);

    void pollRun(0, watchGeneration.current);
  };

  return {
    message: message,
    hasFailed: hasFailed,
    isWatching: isWatching,
    logs: logs,
    stepTrace: stepTrace,
    captureRunBeforeTrigger: captureRunBeforeTrigger,
    startWatchingRun: startWatchingRun,
  };
};

export default useRunWatch;
