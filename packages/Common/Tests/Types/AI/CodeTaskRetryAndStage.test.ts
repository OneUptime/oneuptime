import TransientAIFailure, {
  MAX_FAILURE_TEXT_READ,
  TransientAIFailureKind,
} from "../../../Types/AI/TransientAIFailure";
import CodeTaskRetry, {
  CODE_TASK_MAX_ATTEMPTS,
  CODE_TASK_RETRY_DELAYS_IN_MINUTES,
} from "../../../Types/AI/CodeTaskRetry";
import CodeTaskStageUtil, {
  CodeTaskStage,
  CodeTaskStageInput,
} from "../../../Types/AI/CodeTaskStage";
import { CodeTaskState } from "../../../Types/AI/CodeTask";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Whether an AI failure is worth trying again by itself (the one shared
 * classifier), how a code task's turn is tried again (attempts, waits),
 * and where a task stands in one word (what an insight's fix says).
 */

describe("TransientAIFailure.classify", () => {
  test.each([
    [
      'Anthropic API error: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
      TransientAIFailureKind.ProviderUnavailable,
    ],
    [
      "The AI could not finish: LLM completion request failed",
      TransientAIFailureKind.ProviderUnavailable,
    ],
    [
      "Request failed with status code 503.",
      TransientAIFailureKind.ProviderUnavailable,
    ],
    ["502 Bad Gateway", TransientAIFailureKind.ProviderUnavailable],
    [
      'OpenAI API error: {"error":{"message":"Rate limit reached for gpt-4o on tokens per min"}}',
      TransientAIFailureKind.RateLimited,
    ],
    ["HTTP 429 Too Many Requests", TransientAIFailureKind.RateLimited],
    ["timeout of 120000ms exceeded", TransientAIFailureKind.TimedOut],
    ["connect ETIMEDOUT 10.0.0.4:443", TransientAIFailureKind.TimedOut],
    ["read ECONNRESET", TransientAIFailureKind.NetworkError],
    ["socket hang up", TransientAIFailureKind.NetworkError],
    [
      "The Runner working on it stopped reporting progress (it may have restarted).",
      TransientAIFailureKind.RunnerWentAway,
    ],
  ])(
    "%s is transient (%s)",
    (message: string, kind: TransientAIFailureKind) => {
      expect(TransientAIFailure.classify(message)).toBe(kind);
      expect(TransientAIFailure.isTransient(message)).toBe(true);
    },
  );

  test.each([
    // Will fail the same way again: a key, money, a limit, a request.
    'OpenAI API error: {"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}} 429',
    "Invalid API key provided",
    "401 Unauthorized",
    "403 Forbidden",
    "This fix run has reached its LLM call budget (40 of 40 completion calls). The run must finish with the work done so far.",
    "The project reached its daily limit of AI runs.",
    "prompt is too long: 210000 tokens > 200000 maximum",
    "The model claude-x does not exist",
    // Nothing transient in it.
    "git push failed: ! [rejected] main -> main (non-fast-forward)",
    "Tests failed: 3 of 120",
    "Task was stopped",
    "",
  ])("%s is not", (message: string) => {
    expect(TransientAIFailure.classify(message)).toBeNull();
  });

  test("a status code is read only where it stands on its own", () => {
    expect(TransientAIFailure.classify("used 15030 tokens")).toBeNull();
    expect(TransientAIFailure.classify("version 5.503.2")).toBeNull();
    expect(TransientAIFailure.classify("status (503)")).toBe(
      TransientAIFailureKind.ProviderUnavailable,
    );
  });

  test("reads only the start of a long text, so no message can make it slow", () => {
    const filler: string = "x".repeat(MAX_FAILURE_TEXT_READ);

    expect(TransientAIFailure.classify(`${filler} overloaded`)).toBeNull();
    expect(TransientAIFailure.classify(`overloaded ${filler}`)).toBe(
      TransientAIFailureKind.ProviderUnavailable,
    );

    // A text of millions of characters reads in the time of its first 2,000.
    const long: string = "5".repeat(5_000_000);
    const timed: FastestRun<TransientAIFailureKind | null> = fastestRun({
      run: (): TransientAIFailureKind | null => {
        return TransientAIFailure.classify(long);
      },
      limitInMs: 1000,
    });
    expect(timed.result).toBeNull();
    expect(timed.inMs).toBeLessThan(1000);
  });

  test("a value that is not text says nothing", () => {
    expect(TransientAIFailure.classify(undefined)).toBeNull();
    expect(TransientAIFailure.classify(null)).toBeNull();
    expect(TransientAIFailure.isKind("RateLimited")).toBe(true);
    expect(TransientAIFailure.isKind("Nope")).toBe(false);
  });
});

describe("CodeTaskRetry", () => {
  test("three attempts in all: two retries, then it fails", () => {
    expect(CODE_TASK_MAX_ATTEMPTS).toBe(3);
    expect(CodeTaskRetry.mayTryAgain(0)).toBe(true);
    expect(CodeTaskRetry.mayTryAgain(1)).toBe(true);
    expect(CodeTaskRetry.mayTryAgain(2)).toBe(false);
    expect(CodeTaskRetry.mayTryAgain(7)).toBe(false);
  });

  test("waits longer before each retry: 1 minute, then 4", () => {
    expect(CODE_TASK_RETRY_DELAYS_IN_MINUTES).toEqual([1, 4]);
    expect(CodeTaskRetry.getDelayInMinutes(0)).toBe(1);
    expect(CodeTaskRetry.getDelayInMinutes(1)).toBe(4);
    expect(CodeTaskRetry.getDelayInMinutes(9)).toBe(4);
    expect(CodeTaskRetry.getDelayInMinutes(-1)).toBe(1);
  });

  test("a turn never tried again says nothing of attempts", () => {
    expect(
      CodeTaskRetry.describe({ retriesDone: 0, isQueued: true }),
    ).toBeUndefined();
    expect(CodeTaskRetry.describe({ isQueued: false })).toBeUndefined();
  });

  test("a turn waiting for its second attempt says when, and why", () => {
    expect(
      CodeTaskRetry.describe({
        retriesDone: 1,
        isQueued: true,
        nextAttemptAt: new Date("2026-11-09T10:04:00.000Z"),
        reason: "read ECONNRESET",
        kind: TransientAIFailureKind.NetworkError,
      }),
    ).toEqual({
      attempt: 2,
      maxAttempts: 3,
      nextAttemptAt: "2026-11-09T10:04:00.000Z",
      kind: TransientAIFailureKind.NetworkError,
      reason: "read ECONNRESET",
    });
  });

  test("a running attempt, or one that failed, has no next attempt to wait for", () => {
    expect(
      CodeTaskRetry.describe({
        retriesDone: 2,
        isQueued: false,
        nextAttemptAt: new Date("2026-11-09T10:04:00.000Z"),
      }),
    ).toEqual({ attempt: 3, maxAttempts: 3 });
  });
});

describe("CodeTaskStageUtil.fromSummary", () => {
  function stageOf(input: Partial<CodeTaskStageInput>): CodeTaskStage {
    return CodeTaskStageUtil.fromSummary({
      state: CodeTaskState.Done,
      isQueued: false,
      ...input,
    });
  }

  const openPullRequest: CodeTaskStageInput["pullRequest"] = {
    number: 12,
    state: PullRequestState.Open,
  };

  test("still happening comes first", () => {
    expect(stageOf({ state: CodeTaskState.Working, isQueued: true })).toBe(
      CodeTaskStage.Queued,
    );
    expect(stageOf({ state: CodeTaskState.Working })).toBe(
      CodeTaskStage.Working,
    );
    expect(
      stageOf({
        state: CodeTaskState.Working,
        isQueued: true,
        retry: {
          attempt: 2,
          maxAttempts: 3,
          nextAttemptAt: "2026-11-09T10:04:00.000Z",
        },
      }),
    ).toBe(CodeTaskStage.Retrying);
    // A reply at work on an open pull request is at work.
    expect(
      stageOf({ state: CodeTaskState.Working, pullRequest: openPullRequest }),
    ).toBe(CodeTaskStage.Working);
    expect(
      stageOf({
        state: CodeTaskState.WaitingForYou,
        pullRequest: openPullRequest,
      }),
    ).toBe(CodeTaskStage.WaitingForYou);
  });

  test("then the pull request, which is the fix", () => {
    expect(stageOf({ pullRequest: openPullRequest })).toBe(
      CodeTaskStage.PullRequestOpen,
    );
    expect(
      stageOf({
        state: CodeTaskState.Failed,
        pullRequest: { state: PullRequestState.Merged },
      }),
    ).toBe(CodeTaskStage.Merged);
    expect(
      stageOf({
        state: CodeTaskState.Failed,
        pullRequest: openPullRequest,
      }),
    ).toBe(CodeTaskStage.PullRequestOpen);
  });

  test("then how the latest turn ended", () => {
    expect(stageOf({ state: CodeTaskState.Failed })).toBe(CodeTaskStage.Failed);
    expect(stageOf({ state: CodeTaskState.Stopped })).toBe(
      CodeTaskStage.Stopped,
    );
    expect(stageOf({ pullRequest: { state: PullRequestState.Closed } })).toBe(
      CodeTaskStage.PullRequestClosed,
    );
    expect(
      stageOf({ changes: { files: 2, additions: 10, deletions: 1 } }),
    ).toBe(CodeTaskStage.Done);
    expect(stageOf({})).toBe(CodeTaskStage.NoChange);
  });

  test("only queued, working and retrying are moving", () => {
    const moving: Array<CodeTaskStage> = Object.values(CodeTaskStage).filter(
      (stage: CodeTaskStage): boolean => {
        return CodeTaskStageUtil.isMoving(stage);
      },
    );

    expect(moving.sort()).toEqual(
      [
        CodeTaskStage.Queued,
        CodeTaskStage.Retrying,
        CodeTaskStage.Working,
      ].sort(),
    );
  });
});
