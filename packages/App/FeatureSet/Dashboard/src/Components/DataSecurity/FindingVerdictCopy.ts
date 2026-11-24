import { PillTone } from "Common/UI/Components/Pill/PillTone";
import {
  DATA_STORE_FINDING_VERDICT_TITLES,
  DataStoreFindingVerdict,
} from "Common/Types/DataSecurity/DataStoreFindingVerdict";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF ONEUPTIME AI'S VERDICTS ON FINDINGS, AND OF APPLY TO SIMILAR
 * (#10372), in English: each a key the Dashboard looks up in the reader's
 * language.
 */

export const FindingVerdictCopy: {
  oneUptimeAi: string;
  verdictLabel: string;
  suggestedByAi: string;
  confirmedByAi: string;
  undoInAiPage: string;
  showDecisions: string;
  hideDecisions: string;
  decisionsTitle: string;
  anotherStore: string;
  markedNotSensitive: string;
  confirmed: string;
  sameName: string;
  nameLikeIt: string;
  decisionsNotLoaded: string;
  markedNotSensitiveOnStores: PluralTemplate;
  confirmedOnStores: PluralTemplate;
  markedLikeItNotSensitiveOnStores: PluralTemplate;
  confirmedLikeItOnStores: PluralTemplate;
  verdictFilter: string;
} = {
  oneUptimeAi: translationKey("OneUptime AI"),
  // What a screen reader hears before the verdict's chip.
  verdictLabel: translationKey("OneUptime AI's verdict"),
  suggestedByAi: translationKey("Suggested by OneUptime AI"),
  confirmedByAi: translationKey(
    "Confirmed by OneUptime AI on its own, as one of your AI rules allows.",
  ),
  undoInAiPage: translationKey("Undo it in Data Security > AI"),
  showDecisions: translationKey("Show the decisions"),
  hideDecisions: translationKey("Hide the decisions"),
  decisionsTitle: translationKey("Your team's decisions it rests on"),
  anotherStore: translationKey("Another store"),
  markedNotSensitive: translationKey("Marked not sensitive"),
  confirmed: translationKey("Confirmed"),
  sameName: translationKey("Same field name"),
  nameLikeIt: translationKey("A name like it"),
  decisionsNotLoaded: translationKey("The stores could not be read."),
  markedNotSensitiveOnStores: {
    one: "Your team marked {{field}} not sensitive on {{count}} store.",
    other: "Your team marked {{field}} not sensitive on {{count}} stores.",
  },
  confirmedOnStores: {
    one: "Your team confirmed {{field}} on {{count}} store.",
    other: "Your team confirmed {{field}} on {{count}} stores.",
  },
  markedLikeItNotSensitiveOnStores: {
    one: "Your team marked a field like it not sensitive on {{count}} store.",
    other: "Your team marked fields like it not sensitive on {{count}} stores.",
  },
  confirmedLikeItOnStores: {
    one: "Your team confirmed a field like it on {{count}} store.",
    other: "Your team confirmed fields like it on {{count}} stores.",
  },
  verdictFilter: translationKey("OneUptime AI's Verdict"),
};

// How each verdict's chip looks: a real finding needs a look; the others, none.
export const FINDING_VERDICT_TONES: Readonly<
  Record<DataStoreFindingVerdict, PillTone>
> = {
  [DataStoreFindingVerdict.Confirm]: PillTone.Warning,
  [DataStoreFindingVerdict.NotSensitive]: PillTone.Info,
  [DataStoreFindingVerdict.CannotTell]: PillTone.Neutral,
};

export { DATA_STORE_FINDING_VERDICT_TITLES };

export const ApplyToSimilarCopy: {
  title: string;
  notSensitiveDescription: string;
  confirmDescription: string;
  withReason: string;
  tickAll: string;
  tickNone: string;
  ticked: string;
  sameStore: string;
  notNow: string;
  markNotSensitive: PluralTemplate;
  confirmThem: PluralTemplate;
  markedNotSensitiveToast: PluralTemplate;
  confirmedToast: PluralTemplate;
  skippedToast: PluralTemplate;
  whatFailed: string;
  listLabel: string;
} = {
  title: translationKey("Apply to Similar Findings"),
  notSensitiveDescription: translationKey(
    "The same data type in a field of the same name, on this store and others, that nobody decided yet. Untick any you want to judge on its own.",
  ),
  confirmDescription: translationKey(
    "The same data type in a field of the same name, on this store and others, that nobody decided yet. Each you keep ticked is confirmed too.",
  ),
  withReason: translationKey("Each keeps your reason: {{reason}}"),
  tickAll: translationKey("Tick all"),
  tickNone: translationKey("Untick all"),
  ticked: translationKey("{{ticked}} of {{total}} ticked"),
  sameStore: translationKey("This store"),
  notNow: translationKey("Not Now"),
  markNotSensitive: {
    one: "Mark {{count}} as Not Sensitive",
    other: "Mark {{count}} as Not Sensitive",
  },
  confirmThem: {
    one: "Confirm {{count}}",
    other: "Confirm {{count}}",
  },
  markedNotSensitiveToast: {
    one: "{{count}} more finding marked as not sensitive.",
    other: "{{count}} more findings marked as not sensitive.",
  },
  confirmedToast: {
    one: "{{count}} more finding confirmed.",
    other: "{{count}} more findings confirmed.",
  },
  skippedToast: {
    one: "{{count}} was left as it was: someone decided it, or you may not change it.",
    other:
      "{{count}} were left as they were: someone decided them, or you may not change them.",
  },
  whatFailed: translationKey(
    "The decision was not applied to similar findings.",
  ),
  listLabel: translationKey("Similar findings"),
};
