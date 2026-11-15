import { CodeTaskStage } from "../../Types/AI/CodeTaskStage";
import { getCodeFixOffer } from "./CodeFixSuggestion";
import SuggestionOffer from "./SuggestionOffer";

/*
 * WHEN A POSTMORTEM'S ACTION ITEM OFFERS "OPEN PULL REQUEST" AND "WRITE A
 * TEST" WITH ONEUPTIME AI (issue #6801).
 *
 * An action item is a concrete thing to change, so it stands as evidence of
 * its own: the decision is Code's, as every AI pull request's is
 * (getCodeFixOffer), once the item's own rule has said it applies.
 *
 *   - It applies to an open item. A Done or Won't Do item asks for nothing
 *     more.
 *   - The item's task still working (queued, working, trying again):
 *     InProgress. The row links to the task instead of offering a second
 *     one - the server refuses one anyway.
 *   - The item's task did its work - a pull request open or merged, or a
 *     change made: Done. The row shows the pull request; a second request
 *     would only repeat it, and Code's conversation takes it further.
 *   - A task that failed, was stopped, closed its pull request unmerged,
 *     changed nothing or waits for an answer can be asked again: what the
 *     person asks now is a new request.
 *   - No repository the project's code host reaches: SetUp - the one step
 *     between the person and the pull request is connecting one.
 *   - AI off for the project: None, as every AI action.
 *
 * Pure: the Postmortem page and the Action Items list ask it, and the tests
 * pin it.
 */

export interface ActionItemCodeTaskOfferInput {
  // Project.enableAi !== false (useAiOffered).
  isAiEnabled: boolean;
  // The item is Open.
  isOpen: boolean;
  // Where the item's task stands, when it has one and it was read.
  taskStage: CodeTaskStage | null;
  // The project has a repository its code host reaches.
  hasConnectedRepository: boolean;
}

const FINISHED_STAGES: ReadonlyArray<CodeTaskStage> = [
  CodeTaskStage.PullRequestOpen,
  CodeTaskStage.Merged,
  CodeTaskStage.Done,
];

const MOVING_STAGES: ReadonlyArray<CodeTaskStage> = [
  CodeTaskStage.Queued,
  CodeTaskStage.Working,
  CodeTaskStage.Retrying,
];

export function getActionItemCodeTaskOffer(
  input: ActionItemCodeTaskOfferInput,
): SuggestionOffer {
  return getCodeFixOffer({
    isAiEnabled: input.isAiEnabled,
    applies: input.isOpen,
    hasActiveFix: Boolean(
      input.taskStage && MOVING_STAGES.includes(input.taskStage),
    ),
    hasFinishedFix: Boolean(
      input.taskStage && FINISHED_STAGES.includes(input.taskStage),
    ),
    hasConnectedRepository: input.hasConnectedRepository,
    isBackedByEvidence: true,
  });
}
