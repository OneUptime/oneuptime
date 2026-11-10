import { CodeTaskState, CodeTaskSummaryJSON } from "./CodeTask";
import PullRequestState from "../CodeRepository/PullRequestState";

/*
 * WHERE A TASK IS, IN ONE WORD - for a page that shows a task beside
 * something else: an insight's fix, a task list's filter. Read from the
 * task's real state (its latest turn, its attempts, its pull request), never
 * from what started it, so an insight says "Task in progress" until there is
 * a pull request, and "Task failed" when there will be none.
 *
 * Something still happening comes first (queued, working, trying again,
 * waiting for an answer); then the pull request, which is the fix; then how
 * the latest turn ended.
 */
export enum CodeTaskStage {
  Queued = "Queued",
  Working = "Working",
  // Its last attempt failed for a reason trying again can fix; it waits to.
  Retrying = "Retrying",
  WaitingForYou = "WaitingForYou",
  PullRequestOpen = "PullRequestOpen",
  Merged = "Merged",
  PullRequestClosed = "PullRequestClosed",
  // Finished, and changed code (a Git repository's branch, no pull request).
  Done = "Done",
  // Finished without changing any code.
  NoChange = "NoChange",
  Failed = "Failed",
  Stopped = "Stopped",
}

export type CodeTaskStageInput = Pick<
  CodeTaskSummaryJSON,
  "state" | "isQueued" | "retry" | "pullRequest" | "changes"
>;

export default class CodeTaskStageUtil {
  public static fromSummary(task: CodeTaskStageInput): CodeTaskStage {
    switch (task.state) {
      case CodeTaskState.Working:
        if (task.isQueued && task.retry?.nextAttemptAt) {
          return CodeTaskStage.Retrying;
        }

        return task.isQueued ? CodeTaskStage.Queued : CodeTaskStage.Working;
      case CodeTaskState.WaitingForYou:
        return CodeTaskStage.WaitingForYou;
      default:
        break;
    }

    const pullRequestState: string | undefined = task.pullRequest?.state;

    if (pullRequestState === PullRequestState.Merged) {
      return CodeTaskStage.Merged;
    }

    if (task.pullRequest && pullRequestState === PullRequestState.Open) {
      return CodeTaskStage.PullRequestOpen;
    }

    if (task.state === CodeTaskState.Failed) {
      return CodeTaskStage.Failed;
    }

    if (task.state === CodeTaskState.Stopped) {
      return CodeTaskStage.Stopped;
    }

    if (pullRequestState === PullRequestState.Closed) {
      return CodeTaskStage.PullRequestClosed;
    }

    return task.changes && task.changes.files > 0
      ? CodeTaskStage.Done
      : CodeTaskStage.NoChange;
  }

  // Whether the task is still moving: a page reads it again while it is.
  public static isMoving(stage: CodeTaskStage): boolean {
    return (
      stage === CodeTaskStage.Queued ||
      stage === CodeTaskStage.Working ||
      stage === CodeTaskStage.Retrying
    );
  }
}
