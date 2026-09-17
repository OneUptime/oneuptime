/*
 * Pure helpers behind the builder's "what happened to the run I just started"
 * strip.
 *
 * Triggering a run from the builder used to end at a modal saying the workflow
 * had been scheduled and that the Logs tab would know more. That left the one
 * question the builder actually has — did it work — to a different page, a
 * table, and a text blob. The runner does not hand back a log id at enqueue
 * time (RunWorkflow creates the WorkflowLog itself once it picks the job up),
 * so the builder watches for the run instead of being told about it.
 *
 * The logic that decides when to stop watching lives here, separate from the
 * page, because it is the part worth testing.
 */

import WorkflowStatus from "../../../Types/Workflow/WorkflowStatus";

/**
 * Statuses a run never moves on from. Waiting is not one of them — a Sleep
 * step parks a run for as long as it likes and it carries on afterwards.
 */
const TERMINAL_STATUSES: Array<WorkflowStatus> = [
  WorkflowStatus.Success,
  WorkflowStatus.Error,
  WorkflowStatus.Timeout,
  WorkflowStatus.WorkflowCountExceeded,
];

export type IsTerminalRunStatusFunction = (
  status: WorkflowStatus | null | undefined,
) => boolean;

export const isTerminalRunStatus: IsTerminalRunStatusFunction = (
  status: WorkflowStatus | null | undefined,
): boolean => {
  if (!status) {
    return false;
  }

  return TERMINAL_STATUSES.includes(status);
};

export type IsFailedRunStatusFunction = (
  status: WorkflowStatus | null | undefined,
) => boolean;

export const isFailedRunStatus: IsFailedRunStatusFunction = (
  status: WorkflowStatus | null | undefined,
): boolean => {
  return (
    status === WorkflowStatus.Error ||
    status === WorkflowStatus.Timeout ||
    status === WorkflowStatus.WorkflowCountExceeded
  );
};

/*
 * How long to keep watching. A run that suspends on a Sleep step can outlive
 * any sensible watch, so the strip stops following it and points at the Logs
 * tab rather than polling for hours.
 */
export const MAX_RUN_WATCH_POLLS: number = 60;
export const RUN_WATCH_POLL_INTERVAL_MS: number = 2000;

export interface WatchedRun {
  runId: string;
  status: WorkflowStatus;
}

export interface RunWatchDecision {
  /** Poll again? */
  shouldContinue: boolean;
  /** Text for the strip. Null when there is nothing to say yet. */
  message: string | null;
}

export type DecideRunWatchFunction = (params: {
  run: WatchedRun | null;
  pollCount: number;
}) => RunWatchDecision;

/**
 * What the strip should say, and whether to keep looking.
 */
export const decideRunWatch: DecideRunWatchFunction = (params: {
  run: WatchedRun | null;
  pollCount: number;
}): RunWatchDecision => {
  if (params.pollCount >= MAX_RUN_WATCH_POLLS) {
    return {
      shouldContinue: false,
      message:
        "This run is taking a while. Open the Logs tab to follow it from there.",
    };
  }

  if (!params.run) {
    return { shouldContinue: true, message: "Starting run…" };
  }

  if (isTerminalRunStatus(params.run.status)) {
    return {
      shouldContinue: false,
      message: isFailedRunStatus(params.run.status)
        ? `Run ${params.run.status.toLowerCase()}. Open the run log to see why.`
        : "Run finished successfully.",
    };
  }

  if (params.run.status === WorkflowStatus.Waiting) {
    return {
      shouldContinue: false,
      message:
        "This run is sleeping and will carry on by itself. Follow it in the Logs tab.",
    };
  }

  return {
    shouldContinue: true,
    message: `Run ${params.run.status.toLowerCase()}…`,
  };
};
