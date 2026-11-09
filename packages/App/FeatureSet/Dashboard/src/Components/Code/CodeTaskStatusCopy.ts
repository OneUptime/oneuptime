import { CodeTaskListFilter } from "Common/Types/AI/CodeTask";
import { CodeTaskRetryJSON } from "Common/Types/AI/CodeTaskRetry";
import { CodeTaskStage } from "Common/Types/AI/CodeTaskStage";
import { TransientAIFailureKind } from "Common/Types/AI/TransientAIFailure";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Where a task stands, in words a page beside Code can say (an insight's
 * fix, a list's filter), and how a turn that AI tries again by itself says
 * so. English keys (translationKey), translated where they are drawn.
 * React-free, so App's tests can read it.
 */

export interface CodeTaskStageCopy {
  label: string;
  // The badge: text, background and ring, light and dark (Theme.css remaps them).
  badgeClassName: string;
  dotClassName: string;
  // Whether the dot pulses: the task is moving.
  isLive: boolean;
}

/*
 * A task in one word, from its real state (CodeTaskStageUtil): "Task in
 * progress" until there is a pull request, "Task failed" when there will
 * be none.
 */
export const CODE_TASK_STAGE_COPY: Record<CodeTaskStage, CodeTaskStageCopy> = {
  [CodeTaskStage.Queued]: {
    label: translationKey("Task queued"),
    badgeClassName: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
    dotClassName: "bg-indigo-400",
    isLive: false,
  },
  [CodeTaskStage.Working]: {
    label: translationKey("Task in progress"),
    badgeClassName: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
    dotClassName: "bg-indigo-500",
    isLive: true,
  },
  [CodeTaskStage.Retrying]: {
    label: translationKey("Retrying"),
    badgeClassName: "bg-amber-50 text-amber-800 ring-amber-600/20",
    dotClassName: "bg-amber-500",
    isLive: true,
  },
  [CodeTaskStage.WaitingForYou]: {
    label: translationKey("Waiting for you"),
    badgeClassName: "bg-amber-50 text-amber-800 ring-amber-600/20",
    dotClassName: "bg-amber-500",
    isLive: false,
  },
  [CodeTaskStage.PullRequestOpen]: {
    label: translationKey("Pull request open"),
    badgeClassName: "bg-purple-50 text-purple-700 ring-purple-600/20",
    dotClassName: "bg-purple-500",
    isLive: false,
  },
  [CodeTaskStage.Merged]: {
    label: translationKey("Fix merged"),
    badgeClassName: "bg-green-50 text-green-700 ring-green-600/20",
    dotClassName: "bg-green-500",
    isLive: false,
  },
  [CodeTaskStage.PullRequestClosed]: {
    label: translationKey("Pull request closed"),
    badgeClassName: "bg-gray-100 text-gray-600 ring-gray-500/20",
    dotClassName: "bg-gray-400",
    isLive: false,
  },
  [CodeTaskStage.Done]: {
    label: translationKey("Task done"),
    badgeClassName: "bg-green-50 text-green-700 ring-green-600/20",
    dotClassName: "bg-green-500",
    isLive: false,
  },
  [CodeTaskStage.NoChange]: {
    label: translationKey("No change made"),
    badgeClassName: "bg-gray-100 text-gray-600 ring-gray-500/20",
    dotClassName: "bg-gray-400",
    isLive: false,
  },
  [CodeTaskStage.Failed]: {
    label: translationKey("Task failed"),
    badgeClassName: "bg-red-50 text-red-700 ring-red-600/20",
    dotClassName: "bg-red-500",
    isLive: false,
  },
  [CodeTaskStage.Stopped]: {
    label: translationKey("Task stopped"),
    badgeClassName: "bg-gray-100 text-gray-600 ring-gray-500/20",
    dotClassName: "bg-gray-400",
    isLive: false,
  },
};

/*
 * An insight's fix task whose state cannot be read (the reader may not
 * read Code, or the read failed): a task is attached, nothing more is said.
 */
export const CODE_TASK_STAGE_UNKNOWN_LABEL: string = translationKey("Fix task");

// Why an attempt failed, for a turn AI tries again by itself.
export const TRANSIENT_FAILURE_SENTENCES: Record<
  TransientAIFailureKind,
  string
> = {
  [TransientAIFailureKind.RateLimited]: translationKey(
    "The AI model provider was busy (rate limited).",
  ),
  [TransientAIFailureKind.ProviderUnavailable]: translationKey(
    "The AI model provider did not answer.",
  ),
  [TransientAIFailureKind.TimedOut]: translationKey(
    "A call to the AI model provider timed out.",
  ),
  [TransientAIFailureKind.NetworkError]: translationKey(
    "The connection to the AI model provider dropped.",
  ),
  [TransientAIFailureKind.RunnerWentAway]: translationKey(
    "The Runner working on it stopped responding.",
  ),
};

// "Attempt 2 of 3".
export const CODE_TASK_ATTEMPT: string = translationKey(
  "Attempt {{attempt}} of {{max}}",
);

// A turn waiting for its next attempt: "Trying again in 4 minutes".
export const CODE_TASK_RETRYING_IN: string = translationKey(
  "Trying again in {{duration}}",
);

// Its wait is over; a Runner is about to take it.
export const CODE_TASK_RETRYING_NOW: string =
  translationKey("Trying again now…");

export const CODE_TASK_RETRY_NOW: string = translationKey("Retry now");

// A turn that failed after AI tried it again by itself.
export const CODE_TASK_FAILED_AFTER_ATTEMPTS: string = translationKey(
  "Failed after {{count}} attempts.",
);

// The filters a task list offers, in order, with their labels.
export const CODE_TASK_LIST_FILTERS: ReadonlyArray<{
  filter: CodeTaskListFilter;
  label: string;
}> = [
  { filter: CodeTaskListFilter.All, label: translationKey("All") },
  {
    filter: CodeTaskListFilter.InProgress,
    label: translationKey("In progress"),
  },
  {
    filter: CodeTaskListFilter.WaitingForYou,
    label: translationKey("Waiting for you"),
  },
  {
    filter: CodeTaskListFilter.PullRequestOpen,
    label: translationKey("Pull request open"),
  },
  { filter: CodeTaskListFilter.Failed, label: translationKey("Failed") },
  { filter: CodeTaskListFilter.Done, label: translationKey("Done") },
];

/*
 * Why the attempt before failed, in the reader's words when its kind is
 * known; the reason as it was reported otherwise.
 */
export function getRetryReasonKey(
  retry: CodeTaskRetryJSON | undefined,
): string {
  if (!retry) {
    return "";
  }

  if (retry.kind && TRANSIENT_FAILURE_SENTENCES[retry.kind]) {
    return TRANSIENT_FAILURE_SENTENCES[retry.kind];
  }

  return retry.reason || "";
}
