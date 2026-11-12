import { getOnCallRuleKindDefinition } from "../OnCallRuleKinds";
import {
  PagingLadderCell,
  PagingLadderStep,
} from "Common/Types/NotificationRule/PagingLadder";
import PushNotificationLevel from "Common/Types/NotificationRule/PushNotificationLevel";
import { NO_NOTIFICATION_REPEAT } from "Common/Types/NotificationRule/NotificationRepeat";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS OF HOW TO REACH ME (#6820): the ladder, the grid behind it, and
 * what each card that differs from the ladder does instead.
 *
 * React-free, so a test can read every sentence and hand it any locale.
 */

// The page's name, in the menu, the breadcrumbs and Search (#6817).
export const HOW_TO_REACH_ME_TITLE: string = translationKey("How to Reach Me");

// What Search still finds it by: the name it had.
export const HOW_TO_REACH_ME_OLD_NAME: string = "On-Call Rules";

export const PAGING_LADDER_COPY: {
  ownTitle: string;
  memberTitle: string;
  ownDescription: string;
  memberDescription: string;
  ownNoSteps: string;
  memberNoSteps: string;
  ownAddPlaceholder: string;
  memberAddPlaceholder: string;
  ownNoMethods: string;
  memberNoMethods: string;
  setUpMoreMethods: string;
  notVerifiedTitle: string;
  verify: string;
  waitLabel: string;
  removeStep: string;
  save: string;
  discard: string;
  saved: string;
  differentForSome: string;
  useOneLadder: string;
  backToLadder: string;
  ownGridSame: string;
  memberGridSame: string;
  replacesNote: string;
  confirmTitle: string;
  ownConfirmDescription: string;
  memberConfirmDescription: string;
  also: string;
  not: string;
  pushDiffers: string;
  muted: string;
  differsTag: string;
  gridIntro: string;
  readOnlyNote: string;
} = {
  ownTitle: translationKey("How to reach me when I am on call"),
  memberTitle: translationKey("How to reach {{name}} when they are on call"),
  ownDescription: translationKey(
    "One list for every incident, alert and episode, of every severity. Each step is used after its wait, until somebody acknowledges.",
  ),
  memberDescription: translationKey(
    "One list for every incident, alert and episode {{name}} is paged for, of every severity. Each step is used after its wait, until somebody acknowledges.",
  ),
  ownNoSteps: translationKey(
    "Nothing reaches you when you are paged yet. Add a way to reach you.",
  ),
  memberNoSteps: translationKey(
    "Nothing reaches {{name}} when they are paged yet.",
  ),
  ownAddPlaceholder: translationKey("Add a way to reach you"),
  memberAddPlaceholder: translationKey("Add a way to reach {{name}}"),
  ownNoMethods: translationKey(
    "You have no verified notification method yet. Add your phone or the app in Notification Methods, then come back to put it in your ladder.",
  ),
  memberNoMethods: translationKey(
    "{{name}} has no verified notification method yet. Send them a setup reminder from their Readiness page.",
  ),
  setUpMoreMethods: translationKey("Set up more ways to be reached"),
  notVerifiedTitle: translationKey("Not verified yet"),
  verify: translationKey("Verify"),
  waitLabel: translationKey("When to use it"),
  removeStep: translationKey("Remove this step"),
  save: translationKey("Save Ladder"),
  discard: translationKey("Discard Changes"),
  saved: translationKey("Saved. Every severity now uses this ladder."),
  differentForSome: translationKey("Different for Some Severities"),
  useOneLadder: translationKey("Use One Ladder for Everything"),
  backToLadder: translationKey("Back to One Ladder"),
  ownGridSame: translationKey(
    "Every card below uses your ladder. Change a card to make it different.",
  ),
  memberGridSame: translationKey(
    "Every card below uses {{name}}'s ladder. Change a card to make it different.",
  ),
  replacesNote: translationKey(
    "Saving uses this ladder for every severity: the cards that differ now lose what makes them different.",
  ),
  confirmTitle: translationKey("Use This Ladder for Every Severity?"),
  ownConfirmDescription: translationKey(
    "These cards lose what makes them different, and page you by this ladder instead:",
  ),
  memberConfirmDescription: translationKey(
    "These cards lose what makes them different, and page {{name}} by this ladder instead:",
  ),
  also: translationKey("Also"),
  not: translationKey("Not"),
  pushDiffers: translationKey("Push sounds or repeats differently"),
  muted: translationKey("Muted: no page is sent"),
  differsTag: translationKey("Differs from the ladder"),
  gridIntro: translationKey("Different from the ladder"),
  readOnlyNote: translationKey(
    "Only the person, or someone who may edit members' notification rules, can change this ladder.",
  ),
};

// When a step is used.
export const AT_ONCE: string = translationKey("At once");

export const AFTER_MINUTES: PluralTemplate = {
  one: "After {{count}} minute",
  other: "After {{count}} minutes",
};

// How many cards differ, over the grid's ladder summary.
export const CARDS_DIFFER: PluralTemplate = {
  one: "{{count}} card is different from the ladder.",
  other: "{{count}} cards are different from the ladder.",
};

// A push step's settings, beside its method.
export const PUSH_LEVEL_WORDS: Readonly<Record<PushNotificationLevel, string>> =
  {
    [PushNotificationLevel.Critical]: translationKey("Critical alert"),
    [PushNotificationLevel.Standard]: translationKey("Standard"),
  };

export const REPEATS_EVERY: PluralTemplate = {
  one: "Repeats every minute",
  other: "Repeats every {{count}} minutes",
};

// "At once", "After 5 minutes".
export const describeWait: (
  translator: Translator,
  notifyAfterMinutes: number,
) => string = (translator: Translator, notifyAfterMinutes: number): string => {
  if (!notifyAfterMinutes) {
    return translator.translateTemplate(AT_ONCE);
  }

  return translator.translatePlural(AFTER_MINUTES, notifyAfterMinutes);
};

// "Critical alert", "Standard notification · Repeats every 5 minutes", or "".
export const describePushSettings: (
  translator: Translator,
  step: PagingLadderStep,
) => string = (translator: Translator, step: PagingLadderStep): string => {
  if (step.methodColumn !== "userPushId") {
    return "";
  }

  const parts: Array<string> = [
    translator.translateTemplate(
      PUSH_LEVEL_WORDS[
        step.pushNotificationLevel || PushNotificationLevel.Critical
      ],
    ),
  ];

  if (
    step.repeatEveryMinutes &&
    step.repeatEveryMinutes !== NO_NOTIFICATION_REPEAT
  ) {
    parts.push(
      translator.translatePlural(REPEATS_EVERY, step.repeatEveryMinutes),
    );
  }

  return parts.join(" · ");
};

// A card's kind, as its tab is called: "Incidents", "Alert Episodes".
export const describeCardKind: (
  translator: Translator,
  cell: PagingLadderCell,
) => string = (translator: Translator, cell: PagingLadderCell): string => {
  return translator.translateTemplate(
    getOnCallRuleKindDefinition(cell.kind).tabName,
  );
};
