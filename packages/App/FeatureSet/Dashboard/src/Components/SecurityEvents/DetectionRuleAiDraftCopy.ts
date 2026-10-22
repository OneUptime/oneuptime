import {
  DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH,
  isDetectionRuleDraftDescription,
} from "Common/Types/SecurityEvent/DetectionRuleAiDraft";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Draft with AI on the Detection Rules form (DetectionRuleAiDraft): its
 * words, each an English key the form translates, and when it may draft.
 * React-free, so a plain test pins every word.
 */

export const DETECTION_RULE_AI_DRAFT_DESCRIPTION_MAX_LENGTH: number =
  DETECTION_RULE_DRAFT_DESCRIPTION_MAX_LENGTH;

export const DetectionRuleAiDraftCopy: {
  openButton: string;
  openAgainButton: string;
  label: string;
  placeholder: string;
  replaces: string;
  draftButton: string;
  cancelButton: string;
  drafted: string;
  emptyDraft: string;
} = {
  openButton: translationKey("Draft with AI"),
  openAgainButton: translationKey("Redraft with AI"),
  label: translationKey("What should this rule catch?"),
  placeholder: translationKey(
    "e.g. Ten failed sign-ins from one IP address within five minutes",
  ),
  replaces: translationKey("The draft replaces the rule above."),
  draftButton: translationKey("Draft rule"),
  cancelButton: translationKey("Cancel"),
  drafted: translationKey(
    "OneUptime AI wrote this rule. Read it before you save.",
  ),
  emptyDraft: translationKey(
    "OneUptime AI did not write a rule. Try describing it differently.",
  ),
};

// Whether the description is one OneUptime AI may draft a rule from.
export function canDraftDetectionRule(description: string): boolean {
  return isDetectionRuleDraftDescription(description);
}
