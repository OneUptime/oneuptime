import { CodeTaskStage } from "../../../Types/AI/CodeTaskStage";
import {
  ActionItemCodeTaskOfferInput,
  getActionItemCodeTaskOffer,
} from "../../../Utils/Suggestions/ActionItemCodeTaskSuggestion";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import { describe, expect, test } from "@jest/globals";

/*
 * When a postmortem's action item offers "Open Pull Request with AI" and
 * "Write a Test with AI" (#6801): AI on, the item open, no task of its still
 * working or already done, and a repository to work in - or the one step
 * before it.
 */

const offerFor: (
  overrides: Partial<ActionItemCodeTaskOfferInput>,
) => SuggestionOffer = (
  overrides: Partial<ActionItemCodeTaskOfferInput>,
): SuggestionOffer => {
  return getActionItemCodeTaskOffer({
    isAiEnabled: true,
    isOpen: true,
    taskStage: null,
    hasConnectedRepository: true,
    ...overrides,
  });
};

describe("an open action item", () => {
  test("with AI on and a repository: Act", () => {
    expect(offerFor({})).toBe(SuggestionOffer.Act);
  });

  test("with AI off: nothing, as every AI action", () => {
    expect(offerFor({ isAiEnabled: false })).toBe(SuggestionOffer.None);
  });

  test("with no repository the code host reaches: the step to connect one", () => {
    expect(offerFor({ hasConnectedRepository: false })).toBe(
      SuggestionOffer.SetUp,
    );
  });

  test.each([
    CodeTaskStage.Queued,
    CodeTaskStage.Working,
    CodeTaskStage.Retrying,
  ])("its task %s: in progress, not offered twice", (stage: CodeTaskStage) => {
    expect(offerFor({ taskStage: stage })).toBe(SuggestionOffer.InProgress);
  });

  test.each([
    CodeTaskStage.PullRequestOpen,
    CodeTaskStage.Merged,
    CodeTaskStage.Done,
  ])("its task %s: done, the row shows it", (stage: CodeTaskStage) => {
    expect(offerFor({ taskStage: stage })).toBe(SuggestionOffer.Done);
  });

  test.each([
    CodeTaskStage.Failed,
    CodeTaskStage.Stopped,
    CodeTaskStage.PullRequestClosed,
    CodeTaskStage.NoChange,
    CodeTaskStage.WaitingForYou,
  ])("its task %s: asked again, a new request", (stage: CodeTaskStage) => {
    expect(offerFor({ taskStage: stage })).toBe(SuggestionOffer.Act);
  });
});

describe("a closed action item", () => {
  test("offers nothing, whatever else is true", () => {
    expect(offerFor({ isOpen: false })).toBe(SuggestionOffer.None);
    expect(offerFor({ isOpen: false, hasConnectedRepository: false })).toBe(
      SuggestionOffer.None,
    );
  });
});
