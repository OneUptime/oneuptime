import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeTaskAccess from "./CodeTaskAccess";
import CodeTaskGate from "./CodeTaskGate";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { CodeFixTaskTypeHelper } from "../../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
  CodeTaskState,
  CodeTaskSummaryJSON,
} from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHICH TASKS OF A LIST THE READER MAY TRY AGAIN NOW (#6508, #6509).
 *
 * A list of tasks - a repository's, every repository's on Code's own page,
 * or an insight's fix task - offers Try again, and a box to pick for Retry
 * selected, on a failed or stopped task the reader may ask again now, and
 * on no other: its row keeps its reason, and nothing to press that would
 * only be refused. The same check a repository's page makes before it
 * shows its request box and Try again, per repository, so a list across
 * repositories offers it on the rows of the repositories the reader may
 * ask AI in, and on none of the others:
 *
 *  - the task's latest turn failed or was stopped, and its recipe can be
 *    asked again (CodeFixTaskTypeHelper.canBeAskedAgain): a request, or a
 *    fix OneUptime started - and that fix has no pull request, which a new
 *    turn would open a second of (CodeTaskFixRetry refuses it);
 *  - the task is in a repository the reader may ask AI in
 *    (CodeTaskAccess.canAskInRepository) and nothing stops AI working there
 *    now (CodeTaskGate.getBlocker: the plan, the AI switch, credits, the
 *    repository's connection, its Runner).
 *
 * Each repository of the rows is asked once, and a reason that stops AI in
 * the whole project - the bill, the plan, the AI switch, the LLM provider
 * and its credits, the daily limits - stops the asking at the first: no
 * repository's row can be tried again then. Pressing Try again still asks
 * everything again (CodeTaskRuns.retry), whatever a list said.
 */

// The reasons that stop AI in every repository of the project at once.
const PROJECT_WIDE_BLOCKERS: ReadonlySet<CodeTaskBlockerType> = new Set([
  CodeTaskBlockerType.SubscriptionUnpaid,
  CodeTaskBlockerType.PlanRequired,
  CodeTaskBlockerType.AiDisabled,
  CodeTaskBlockerType.NoLlmProvider,
  CodeTaskBlockerType.NoAiCredits,
  CodeTaskBlockerType.DailyLimitReached,
]);

export default class CodeTaskTryAgain {
  /*
   * Whether a task's row could offer Try again, before asking who reads it:
   * its latest turn failed or was stopped, in a repository, and a turn of
   * its recipe can be asked again - a fix only while its task has no pull
   * request.
   */
  public static isAskableAgain(summary: CodeTaskSummaryJSON): boolean {
    if (
      summary.state !== CodeTaskState.Failed &&
      summary.state !== CodeTaskState.Stopped
    ) {
      return false;
    }

    if (!summary.codeRepositoryId) {
      return false;
    }

    // A production review is reviewed again in place, never asked again.
    if (CodeFixTaskTypeHelper.isProductionReview(summary.recipe)) {
      return false;
    }

    const recipe: string = summary.latestRecipe || summary.recipe;

    if (!CodeFixTaskTypeHelper.canBeAskedAgain(recipe)) {
      return false;
    }

    return !(
      CodeFixTaskTypeHelper.isFixAskedAgain(recipe) && summary.pullRequest
    );
  }

  /*
   * Sets canTryAgain on each summary the reader may try again now, and
   * leaves it out on every other.
   */
  @CaptureSpan()
  public static async markWhoMayTryAgain(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    summaries: Array<CodeTaskSummaryJSON>;
  }): Promise<void> {
    const candidates: Array<CodeTaskSummaryJSON> = data.summaries.filter(
      (summary: CodeTaskSummaryJSON): boolean => {
        return CodeTaskTryAgain.isAskableAgain(summary);
      },
    );

    if (candidates.length === 0) {
      return;
    }

    const repositoryIds: Array<string> = [];

    for (const summary of candidates) {
      const id: string = summary.codeRepositoryId!.toLowerCase();

      if (!repositoryIds.includes(id)) {
        repositoryIds.push(id);
      }
    }

    const askable: Set<string> =
      await CodeTaskTryAgain.getRepositoriesTheReaderMayAskIn({
        projectId: data.projectId,
        props: data.props,
        repositoryIds,
      });

    for (const summary of candidates) {
      if (askable.has(summary.codeRepositoryId!.toLowerCase())) {
        summary.canTryAgain = true;
      }
    }
  }

  /*
   * Of the repositories (ids in lower case), those the reader may ask AI in
   * now, as a repository's page decides it before it offers its request
   * box and Try again. One at a time, stopping at the first reason that
   * stops AI in every repository.
   */
  @CaptureSpan()
  public static async getRepositoriesTheReaderMayAskIn(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    repositoryIds: Array<string>;
  }): Promise<Set<string>> {
    const askable: Set<string> = new Set<string>();

    for (const id of data.repositoryIds) {
      if (!ObjectID.isValidUUID(id)) {
        continue;
      }

      const repositoryId: ObjectID = new ObjectID(id);

      const repository: CodeRepository | null =
        await CodeTaskAccess.findReadableRepository({
          props: data.props,
          projectId: data.projectId,
          repositoryId,
        });

      if (!repository) {
        continue;
      }

      const canAsk: boolean = await CodeTaskAccess.canAskInRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId,
      });

      if (!canAsk) {
        continue;
      }

      const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
        props: data.props,
        projectId: data.projectId,
        repository,
        canAsk,
      });

      if (!blocker) {
        askable.add(id.toLowerCase());
        continue;
      }

      if (PROJECT_WIDE_BLOCKERS.has(blocker.type)) {
        // Nothing can be asked anywhere in the project now.
        return new Set<string>();
      }
    }

    return askable;
  }
}
