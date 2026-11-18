import { getOnCallRuleKindDefinition } from "../OnCallRuleKinds";
import {
  PagingLadderCell,
  PagingLadderStep,
} from "Common/Types/NotificationRule/PagingLadder";
import PushNotificationLevel from "Common/Types/NotificationRule/PushNotificationLevel";
import { NO_NOTIFICATION_REPEAT } from "Common/Types/NotificationRule/NotificationRepeat";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import { toSentenceTerm } from "Common/Types/Translator";
import { joinList } from "Common/UI/Utils/ListSeparator";
import NotificationMethodUtil from "Common/UI/Utils/NotificationMethodUtil";
import {
  ComposedValue,
  PluralTemplate,
  TemplateValues,
  Translator,
  composedValue,
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
  add: string;
  addStep: string;
  ownNoMethods: string;
  memberNoMethods: string;
  setUpMoreMethods: string;
  notVerifiedTitle: string;
  verify: string;
  changeWait: string;
  ifNobodyAcknowledged: string;
  remove: string;
  removeMethod: string;
  save: string;
  discard: string;
  unsaved: string;
  leaveDescription: string;
  saved: string;
  scope: string;
  differentForSome: string;
  backToLadder: string;
  ownGridSame: string;
  memberGridSame: string;
  keepsNote: string;
  savedKeepingDifferences: string;
  useForEverySeverity: string;
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
  // What the steps below do, said once, under the title (#8139).
  ownDescription: translationKey(
    "When you are paged, OneUptime tries each step in turn until somebody acknowledges.",
  ),
  memberDescription: translationKey(
    "When {{name}} is paged, OneUptime tries each step in turn until somebody acknowledges.",
  ),
  ownNoSteps: translationKey(
    "Nothing reaches you when you are paged yet. Add a way to reach you.",
  ),
  memberNoSteps: translationKey(
    "Nothing reaches {{name}} when they are paged yet.",
  ),
  // The empty ladder's button, and what each step's Add says to a screen reader.
  ownAddPlaceholder: translationKey("Add a way to reach you"),
  memberAddPlaceholder: translationKey("Add a way to reach {{name}}"),
  // A method more in a step: it goes out with the others at that step's time.
  add: translationKey("Add"),
  // One step more at the end, after the last one's time.
  addStep: translationKey("Add Step"),
  // Your phone, this browser or the app are added under it (#7451).
  ownNoMethods: translationKey(
    "You have no verified notification method yet. Add one below to put it in your ladder.",
  ),
  memberNoMethods: translationKey(
    "{{name}} has no verified notification method yet. Send them a setup reminder from their Readiness page.",
  ),
  setUpMoreMethods: translationKey("Set up more ways to be reached"),
  notVerifiedTitle: translationKey("Not verified yet"),
  verify: translationKey("Verify"),
  // A step's time, said to a screen reader on the button that changes it.
  changeWait: translationKey("{{wait}}. Change when this step is sent."),
  // Beside every step but one sent at once: it is skipped once somebody acknowledges.
  ifNobodyAcknowledged: translationKey("If nobody has acknowledged yet"),
  remove: translationKey("Remove"),
  // "Remove SMS: +15550100", said to a screen reader on a method's ×.
  removeMethod: translationKey("Remove {{name}}"),
  save: translationKey("Save Changes"),
  discard: translationKey("Discard Changes"),
  unsaved: translationKey("You have unsaved changes"),
  leaveDescription: translationKey(
    "You have unsaved changes to these steps. If you leave now, they will be lost.",
  ),
  saved: translationKey("Saved. Every severity now uses this ladder."),
  // What the steps are for, beside the way to make some severities differ.
  scope: translationKey(
    "Used for every incident, alert and episode, of every severity.",
  ),
  // The way to the grid of cards: a button beside the title (#8890).
  differentForSome: translationKey("Different for Some Severities"),
  backToLadder: translationKey("Back to One Ladder"),
  ownGridSame: translationKey(
    "Every card below uses your ladder. Change a card to make it different.",
  ),
  memberGridSame: translationKey(
    "Every card below uses {{name}}'s ladder. Change a card to make it different.",
  ),
  // Over the cards that differ: what Save Changes does to them (#8890).
  keepsNote: translationKey(
    "These keep their own rules when you save changes to the steps.",
  ),
  savedKeepingDifferences: translationKey(
    "Saved. The severities that differ keep their own rules.",
  ),
  // Gives the cards that differ the ladder too, after naming them.
  useForEverySeverity: translationKey("Use This Ladder for Every Severity"),
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

/*
 * START FROM THE PROJECT'S DEFAULT (#9445): the button beside the ladder's
 * title, and what the steps it filled say until they are saved. A channel
 * of the default the person has not verified is left out, and named; while
 * one is, their own steps of the channels the default does not use stay
 * (getPagingLadderFromDefault), and are named too.
 */
export const PAGING_LADDER_DEFAULT_START_COPY: {
  start: string;
  started: string;
  ownLeftOut: string;
  ownLeftOutKeepingOwn: string;
  memberLeftOut: string;
  memberLeftOutKeepingOwn: string;
} = {
  start: translationKey("Start From the Project's Default"),
  started: translationKey("Started from the project's default ladder."),
  ownLeftOut: translationKey(
    "You have not verified {{channels}} yet, so those steps are left out.",
  ),
  ownLeftOutKeepingOwn: translationKey(
    "You have not verified {{channels}} yet, so those steps are left out, and your own {{kept}} steps stay meanwhile.",
  ),
  memberLeftOut: translationKey(
    "{{name}} has not verified {{channels}} yet, so those steps are left out.",
  ),
  memberLeftOutKeepingOwn: translationKey(
    "{{name}} has not verified {{channels}} yet, so those steps are left out, and their own {{kept}} steps stay meanwhile.",
  ),
};

/*
 * Channels named in a sentence of the reader's: "SMS and phone call", each
 * by the name the ladder gives its method (NotificationMethodUtil), as the
 * middle of a sentence words it.
 */
export const describeChannelsInSentence: (
  channels: ReadonlyArray<OnCallPageChannel>,
) => ComposedValue = (
  channels: ReadonlyArray<OnCallPageChannel>,
): ComposedValue => {
  return composedValue((translator: Translator): string => {
    return joinList(
      channels.map((channel: OnCallPageChannel): string => {
        return toSentenceTerm(
          NotificationMethodUtil.getMethodName(translator, channel),
          translator.language,
        );
      }),
    );
  });
};

/*
 * What the steps filled from the project's default say they left out, in
 * the reader's words: "You have not verified SMS and phone call yet, so
 * those steps are left out." Empty when nothing was left out. For a
 * member's page, `memberName` names them.
 */
export const describeDefaultStartLeftOut: (data: {
  translator: Translator;
  leftOutChannels: ReadonlyArray<OnCallPageChannel>;
  // The channels of their own steps kept meanwhile; a custom channel is never named.
  keptChannels: ReadonlyArray<OnCallPageChannel>;
  memberName?: string | undefined;
}) => string = (data: {
  translator: Translator;
  leftOutChannels: ReadonlyArray<OnCallPageChannel>;
  keptChannels: ReadonlyArray<OnCallPageChannel>;
  memberName?: string | undefined;
}): string => {
  if (data.leftOutChannels.length === 0) {
    return "";
  }

  const kept: Array<OnCallPageChannel> = data.keptChannels.filter(
    (channel: OnCallPageChannel): boolean => {
      return channel !== OnCallPageChannel.CustomChannel;
    },
  );

  const values: TemplateValues = {
    channels: describeChannelsInSentence(data.leftOutChannels),
    kept: describeChannelsInSentence(kept),
  };

  if (data.memberName) {
    return data.translator.translateTemplate(
      kept.length > 0
        ? PAGING_LADDER_DEFAULT_START_COPY.memberLeftOutKeepingOwn
        : PAGING_LADDER_DEFAULT_START_COPY.memberLeftOut,
      { ...values, name: data.memberName },
    );
  }

  return data.translator.translateTemplate(
    kept.length > 0
      ? PAGING_LADDER_DEFAULT_START_COPY.ownLeftOutKeepingOwn
      : PAGING_LADDER_DEFAULT_START_COPY.ownLeftOut,
    values,
  );
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
