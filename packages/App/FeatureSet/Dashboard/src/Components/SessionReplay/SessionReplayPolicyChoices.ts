import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import SessionReplayMaskingMode from "Common/Types/Rum/SessionReplayMaskingMode";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE REPLAY POLICY'S THREE MODES, AS PLAIN CHOICES.
 *
 * "Shouldnt this be two buttons ... to make it easier for people to
 * understand whats going on." (the maintainer, on a switch whose
 * description explained both of its modes)
 *
 * When to upload a recording, Masking mode and Consent were dropdowns whose
 * one description listed every mode ("Always uploads every sampled
 * session. On error or frustration uploads only ..."), so a reader had to
 * open the list and match the names back to the sentence. Edit Policy now
 * shows the answers themselves, each with one line under it saying what
 * picking it does, and the field above says only what the answers do not.
 *
 * The answers are named as the Session Replay docs and the policy card
 * name them (_Always_, _On error or frustration_, _Mask sensitive inputs
 * only_, _Not required_, _Require explicit_ ...), the first answer of each
 * is the column's default, and the stored values are the enum values they
 * always were: the API, Terraform and existing applications are unchanged.
 *
 * React-free on purpose: App's tests read these without the page.
 */

export const CAPTURE_TRIGGER_CHOICES: Array<RadioButton> = [
  {
    value: SessionReplayCaptureTrigger.Always,
    title: translationKey("Always"),
    description: translationKey(
      "Uploads every sampled session, whether or not anything goes wrong.",
    ),
  },
  {
    value: SessionReplayCaptureTrigger.OnErrorOrFrustration,
    title: translationKey("On error or frustration"),
    description: translationKey(
      "Uploads only sessions where something goes wrong, at a fraction of the cost.",
    ),
  },
];

// Least to most private, as the docs' table of the three modes reads.
export const MASKING_MODE_CHOICES: Array<RadioButton> = [
  {
    value: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
    title: translationKey("Mask sensitive inputs only"),
    description: translationKey(
      "Hides passwords and card fields. Page text and other inputs are recorded.",
    ),
  },
  {
    value: SessionReplayMaskingMode.MaskInputsOnly,
    title: translationKey("Mask inputs only"),
    description: translationKey(
      "Hides everything people type. Page text is still recorded.",
    ),
  },
  {
    value: SessionReplayMaskingMode.MaskAllText,
    title: translationKey("Mask all text"),
    description: translationKey(
      "Hides all text. A replay shows the page's layout only.",
    ),
  },
];

export const CONSENT_MODE_CHOICES: Array<RadioButton> = [
  {
    value: SessionReplayConsentMode.NotRequired,
    title: translationKey("Not required"),
    description: translationKey(
      "Uploads start at once. You rely on another lawful basis.",
    ),
  },
  {
    value: SessionReplayConsentMode.RequireExplicit,
    title: translationKey("Require explicit"),
    description: translationKey(
      "Nothing uploads until your page calls grantConsent().",
    ),
  },
];

/*
 * Ignored error patterns only decide which errors may start an upload
 * (ErrorRecorder's isTriggerWorthy): under Always every sampled session
 * uploads from its first event, so they change nothing there and the field
 * is asked for only under On error or frustration. A value the application
 * already holds is kept, and applies again if the trigger changes back.
 */
export function asksForIgnoredErrorPatterns(captureTrigger: unknown): boolean {
  return captureTrigger === SessionReplayCaptureTrigger.OnErrorOrFrustration;
}

/*
 * What an emptied number box on the policy is saved as: the number its
 * placeholder shows. A number box hands back "" once it is emptied, and
 * these columns cannot hold "" - the save failed with a server error about
 * a column the reader did not know was wrong. The three budgets and the
 * sample percentage are NOT NULL (0 turns a budget off, 100 records every
 * session); the monthly budget may be null, which is no ceiling - what its
 * help says ("Leave empty for no limit").
 */
export const EMPTIED_POLICY_NUMBER_VALUES: Readonly<
  Record<string, number | null>
> = {
  sessionReplaySamplePercentage: 100,
  sessionReplayLcpBudgetMs: 0,
  sessionReplayLongTaskBudgetMs: 0,
  sessionReplaySlowRequestBudgetMs: 0,
  sessionReplayMonthlyBudgetInGB: null,
};

/**
 * Replaces each emptied number of the policy (a blank string) with what
 * EMPTIED_POLICY_NUMBER_VALUES says it means. Run on the model Edit Policy
 * is about to save; every other value is left exactly as the form holds it.
 */
export function fillEmptiedPolicyNumbers<TModel>(item: TModel): TModel {
  const record: Record<string, unknown> = item as unknown as Record<
    string,
    unknown
  >;

  for (const column of Object.keys(EMPTIED_POLICY_NUMBER_VALUES)) {
    const value: unknown = record[column];

    if (typeof value === "string" && value.trim().length === 0) {
      record[column] = EMPTIED_POLICY_NUMBER_VALUES[column];
    }
  }

  return item;
}
