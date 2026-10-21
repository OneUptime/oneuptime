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
import { translationKey } from "../../Utils/TranslateTemplate";

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

/*
 * What the strip says, one whole sentence per status: the builder's page
 * shows it with translateText, so a language switch re-words it on the spot.
 */
export const RUN_STARTING_MESSAGE: string = translationKey("Starting run…");

export const RUN_TAKING_A_WHILE_MESSAGE: string = translationKey(
  "This run is taking a while. Open the Logs tab to follow it from there.",
);

export const RUN_SUCCEEDED_MESSAGE: string = translationKey(
  "Run finished successfully.",
);

export const RUN_SLEEPING_MESSAGE: string = translationKey(
  "This run is sleeping and will carry on by itself. Follow it in the Logs tab.",
);

// A status no message below names: one added after this was written.
export const RUN_IN_PROGRESS_MESSAGE: string =
  translationKey("Run in progress…");

export const RUN_FAILED_MESSAGES: Partial<Record<WorkflowStatus, string>> = {
  [WorkflowStatus.Error]: translationKey(
    "Run error. Open the run log to see why.",
  ),
  [WorkflowStatus.Timeout]: translationKey(
    "Run timeout. Open the run log to see why.",
  ),
  [WorkflowStatus.WorkflowCountExceeded]: translationKey(
    "Run workflow count exceeded. Open the run log to see why.",
  ),
};

export const RUN_FAILED_MESSAGE: string = translationKey(
  "The run failed. Open the run log to see why.",
);

export const RUN_GOING_MESSAGES: Partial<Record<WorkflowStatus, string>> = {
  [WorkflowStatus.Scheduled]: translationKey("Run scheduled…"),
  [WorkflowStatus.Running]: translationKey("Run running…"),
};

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
      message: RUN_TAKING_A_WHILE_MESSAGE,
    };
  }

  if (!params.run) {
    return { shouldContinue: true, message: RUN_STARTING_MESSAGE };
  }

  if (isTerminalRunStatus(params.run.status)) {
    return {
      shouldContinue: false,
      message: isFailedRunStatus(params.run.status)
        ? RUN_FAILED_MESSAGES[params.run.status] || RUN_FAILED_MESSAGE
        : RUN_SUCCEEDED_MESSAGE,
    };
  }

  if (params.run.status === WorkflowStatus.Waiting) {
    return {
      shouldContinue: false,
      message: RUN_SLEEPING_MESSAGE,
    };
  }

  return {
    shouldContinue: true,
    message: RUN_GOING_MESSAGES[params.run.status] || RUN_IN_PROGRESS_MESSAGE,
  };
};
