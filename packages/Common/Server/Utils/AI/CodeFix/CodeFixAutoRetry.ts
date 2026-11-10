import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunEventService from "../../../Services/AIRunEventService";
import AIRunService from "../../../Services/AIRunService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { CodeFixTaskTypeHelper } from "../../../../Types/AI/CodeFixTaskType";
import CodeTaskRetry, {
  CODE_TASK_MAX_ATTEMPTS,
} from "../../../../Types/AI/CodeTaskRetry";
import TransientAIFailure, {
  TransientAIFailureKind,
} from "../../../../Types/AI/TransientAIFailure";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A CODE-FIX RUN'S ATTEMPT FAILED: TRY IT AGAIN BY ITSELF, OR LET IT FAIL.
 *
 * A Runner reports an attempt that failed (update-task-status), or stops
 * reporting at all (the stale-run sweeper). When the failure is one trying
 * again can fix (TransientAIFailure) and the run has attempts left
 * (Types/AI/CodeTaskRetry), the run goes back to Queued IN PLACE - the same
 * run, so the same branch name - with a short wait (nextAttemptAt) no
 * worker claims it before. It never turns terminal in between, so nothing
 * that waits for its end (a GitHub reply, a reaction, the insight it
 * fixes) hears of an attempt that will be tried again.
 *
 * Never a second pull request, never a second push: a run is tried again
 * only when nothing says it may already have written anything -
 *
 *   - it recorded no pull request;
 *   - its trail holds none of the lines a Runner logs just before it writes
 *     to the repository or its host ("Pushing ...", "Posting review",
 *     a pull request opened), which reach the server within a quarter of a
 *     second (TaskLogger);
 *   - and, for a Runner that went away (nothing told why it stopped), its
 *     task has no pull request at all: a reply on a pull request's branch
 *     could have pushed there before the Runner died.
 *
 * Beside those checks, a branch's name comes from its run
 * (CodeTaskAgentBrief.newBranchName), pushes are never forced, and a host
 * opens one pull request per branch: a run tried again that finds its
 * branch already pushed fails at the push, as any run would.
 *
 * Anything that goes wrong here leaves the run to fail as it did before.
 */

// What a Runner logs just before it writes to a repository or its host.
export const CODE_FIX_WRITE_MARKERS: ReadonlyArray<string> = [
  "Pushing ",
  "Posting review",
  "Pull request opened",
  "Opened pull request",
];

// The longest failure kept on the run (AIRun.retryReason, varchar 500).
export const MAX_RETRY_REASON_LENGTH: number = 500;

// The longest failure a retry's note in the conversation quotes.
const MAX_NOTE_REASON_LENGTH: number = 200;

export default class CodeFixAutoRetry {
  /*
   * Queue the run again for its next attempt, when it may be: true when it
   * was, false when it should fail now. `kind` is given when the caller
   * knows why it failed (a Runner that went away); otherwise the failure's
   * text says (TransientAIFailure.classify).
   */
  @CaptureSpan()
  public static async tryAgainLater(data: {
    runId: ObjectID;
    failure: string;
    kind?: TransientAIFailureKind | undefined;
  }): Promise<boolean> {
    const kind: TransientAIFailureKind | null =
      data.kind || TransientAIFailure.classify(data.failure);

    if (!kind) {
      return false;
    }

    let run: AIRun | null = null;
    let retriesDone: number = 0;

    try {
      run = await AIRunService.findOneById({
        id: data.runId,
        select: {
          _id: true,
          projectId: true,
          runType: true,
          status: true,
          codeFixTaskType: true,
          codeTaskId: true,
          autoRetryCount: true,
        },
        props: { isRoot: true },
      });

      if (
        !run ||
        !run.id ||
        !run.projectId ||
        run.runType !== AIRunType.CodeFix ||
        run.status !== AIRunStatus.Running ||
        // A recipe the server runs itself has its own queue.
        CodeFixTaskTypeHelper.isRunByServer(run.codeFixTaskType)
      ) {
        return false;
      }

      retriesDone = run.autoRetryCount || 0;

      if (!CodeTaskRetry.mayTryAgain(retriesDone)) {
        return false;
      }

      if (
        await CodeFixAutoRetry.mayHaveWritten({
          run,
          isRunnerGone: kind === TransientAIFailureKind.RunnerWentAway,
        })
      ) {
        return false;
      }

      const delayInMinutes: number =
        CodeTaskRetry.getDelayInMinutes(retriesDone);

      const queuedCount: number = await AIRunService.attemptStatusTransition({
        aiRunId: run.id,
        fromStatus: AIRunStatus.Running,
        set: {
          status: AIRunStatus.Queued,
          autoRetryCount: retriesDone + 1,
          nextAttemptAt: OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            delayInMinutes,
          ),
          retryReason: CodeFixAutoRetry.cut(
            data.failure || kind,
            MAX_RETRY_REASON_LENGTH,
          ),
        },
      });

      // Another actor finished or stopped the run meanwhile: theirs stands.
      if (queuedCount === 0) {
        return false;
      }
    } catch (error) {
      logger.error(
        `Could not queue code-fix run ${data.runId.toString()} again; it fails instead: ${error}`,
      );
      return false;
    }

    /*
     * The conversation says so in the run's own trail - its steps read
     * it - which also tells every open page to read the task again
     * (CodeTaskLive). The run is queued again whether or not this lands.
     */
    try {
      await AIRunEventService.appendEventToRun({
        projectId: run.projectId!,
        aiRunId: run.id!,
        eventType: AIRunEventType.ProgressLog,
        resultSummary: {
          message: CodeFixAutoRetry.getNote({
            attempt: retriesDone + 1,
            failure: data.failure,
            delayInMinutes: CodeTaskRetry.getDelayInMinutes(retriesDone),
          }),
          severity: "warning",
        },
      });
    } catch (error) {
      logger.error(
        `Could not note the retry of code-fix run ${data.runId.toString()}: ${error}`,
      );
    }

    return true;
  }

  // What the conversation says when an attempt is tried again.
  public static getNote(data: {
    attempt: number;
    failure: string;
    delayInMinutes: number;
  }): string {
    const failure: string = CodeFixAutoRetry.cut(
      data.failure.trim(),
      MAX_NOTE_REASON_LENGTH,
    );

    return `Attempt ${data.attempt} of ${CODE_TASK_MAX_ATTEMPTS} failed${
      failure ? `: ${failure}` : ""
    }${failure.endsWith(".") ? "" : "."} Trying again by itself in ${
      data.delayInMinutes
    } ${data.delayInMinutes === 1 ? "minute" : "minutes"}.`;
  }

  /*
   * Whether the run may already have written to its repository or host:
   * then it is never tried again by itself.
   */
  @CaptureSpan()
  public static async mayHaveWritten(data: {
    run: AIRun;
    isRunnerGone: boolean;
  }): Promise<boolean> {
    const runId: string = data.run.id!.toString();

    const recordedPullRequests: number = (
      await AIAgentTaskPullRequestService.countBy({
        query: { aiRunId: data.run.id! },
        props: { isRoot: true },
      })
    ).toNumber();

    if (recordedPullRequests > 0) {
      return true;
    }

    const markerConditions: Array<string> = CODE_FIX_WRITE_MARKERS.map(
      (_marker: string, index: number): string => {
        return `("resultSummary"->>'message') LIKE $${index + 3}`;
      },
    );

    const writeLines: Array<unknown> =
      (await AIRunService.getRepository().manager.query(
        `SELECT 1 FROM "AIRunEvent" WHERE "aiRunId" = $1 AND "deletedAt" IS NULL AND (("eventType" = $2 AND (${markerConditions.join(
          " OR ",
        )})) OR ("eventType" = $${CODE_FIX_WRITE_MARKERS.length + 3} AND "toolName" = $${CODE_FIX_WRITE_MARKERS.length + 4})) LIMIT 1`,
        [
          runId,
          AIRunEventType.ProgressLog,
          ...CODE_FIX_WRITE_MARKERS.map((marker: string): string => {
            return `%${marker}%`;
          }),
          AIRunEventType.ActionExecuted,
          "open_pull_request",
        ],
      )) as Array<unknown>;

    if (writeLines.length > 0) {
      return true;
    }

    if (!data.isRunnerGone) {
      return false;
    }

    const taskId: string = (data.run.codeTaskId || data.run.id!).toString();

    const taskPullRequests: Array<unknown> =
      (await AIRunService.getRepository().manager.query(
        `SELECT 1 FROM "AIAgentTaskPullRequest" AS "pullRequest" JOIN "AIRun" AS "turn" ON "turn"."_id" = "pullRequest"."aiRunId" WHERE "pullRequest"."deletedAt" IS NULL AND COALESCE("turn"."codeTaskId", "turn"."_id") = $1 LIMIT 1`,
        [taskId],
      )) as Array<unknown>;

    return taskPullRequests.length > 0;
  }

  private static cut(text: string, maxLength: number): string {
    return text.length > maxLength
      ? `${text.substring(0, maxLength - 1)}…`
      : text;
  }
}
