import PageMap from "../../Utils/PageMap";
import {
  ChannelGatedMethodList,
  getChannelGatedMethodList,
} from "../NotificationMethods/ProjectNotificationChannelsCopy";
import Color from "Common/Types/Color";
import {
  Blue500,
  Gray500,
  Green500,
  Red500,
  Yellow500,
} from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageDeliveryStatus,
  OnCallTestPageFix,
  OnCallTestPageLine,
  OnCallTestPageLineCode,
  OnCallTestPageNotPaged,
  OnCallTestPageNotPagedCode,
  OnCallTestPagePreviewMethod,
  OnCallTestPagePreviewPerson,
  OnCallTestPageReachedThrough,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageStatus,
  OnCallTestPageStepStatus,
  OnCallTestPageWarning,
  OnCallTestPageWarningCode,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { NOTIFICATION_METHOD_NAMES } from "Common/UI/Utils/NotificationMethodUtil";
import {
  PluralTemplate,
  TemplateValue,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE WORDS A TEST PAGE'S DIALOG AND RESULT USE (OnCallTestPage), each a
 * whole phrase translated as one - and the page each fix opens.
 */

/*
 * What a channel is called in a line of the result: "SMS", "Phone call" -
 * the names a notification method's line uses everywhere
 * (NotificationMethodUtil).
 */
export const CHANNEL_NAMES: Readonly<Record<OnCallPageChannel, string>> =
  NOTIFICATION_METHOD_NAMES;

/*
 * "by SMS", "by phone call": the channel the test was acknowledged from, in
 * the result's sentence.
 */
export const ACKNOWLEDGED_BY_SENTENCES: Readonly<
  Record<OnCallPageChannel, string>
> = {
  [OnCallPageChannel.Call]: translationKey(
    "{{name}} acknowledged it by phone call after {{time}}.",
  ),
  [OnCallPageChannel.SMS]: translationKey(
    "{{name}} acknowledged it by SMS after {{time}}.",
  ),
  [OnCallPageChannel.WhatsApp]: translationKey(
    "{{name}} acknowledged it by WhatsApp after {{time}}.",
  ),
  [OnCallPageChannel.Telegram]: translationKey(
    "{{name}} acknowledged it by Telegram after {{time}}.",
  ),
  [OnCallPageChannel.Push]: translationKey(
    "{{name}} acknowledged it by push notification after {{time}}.",
  ),
  [OnCallPageChannel.Email]: translationKey(
    "{{name}} acknowledged it by email after {{time}}.",
  ),
  [OnCallPageChannel.Slack]: translationKey(
    "{{name}} acknowledged it in Slack after {{time}}.",
  ),
  [OnCallPageChannel.MicrosoftTeams]: translationKey(
    "{{name}} acknowledged it in Microsoft Teams after {{time}}.",
  ),
  [OnCallPageChannel.Mattermost]: translationKey(
    "{{name}} acknowledged it in Mattermost after {{time}}.",
  ),
  [OnCallPageChannel.Webhook]: translationKey(
    "{{name}} acknowledged it by webhook after {{time}}.",
  ),
  [OnCallPageChannel.CustomChannel]: translationKey(
    "{{name}} acknowledged it by custom channel after {{time}}.",
  ),
};

export const DELIVERY_STATUS_WORDS: Readonly<
  Record<OnCallTestPageDeliveryStatus, { text: string; color: Color }>
> = {
  [OnCallTestPageDeliveryStatus.Sending]: {
    text: translationKey("Sending"),
    color: Gray500,
  },
  [OnCallTestPageDeliveryStatus.Sent]: {
    text: translationKey("Sent"),
    color: Blue500,
  },
  [OnCallTestPageDeliveryStatus.Delivered]: {
    text: translationKey("Delivered"),
    color: Green500,
  },
  [OnCallTestPageDeliveryStatus.NotAnswered]: {
    text: translationKey("Not answered"),
    color: Yellow500,
  },
  [OnCallTestPageDeliveryStatus.Acknowledged]: {
    text: translationKey("Acknowledged"),
    color: Green500,
  },
  [OnCallTestPageDeliveryStatus.Failed]: {
    text: translationKey("Failed"),
    color: Red500,
  },
};

export const STEP_STATUS_WORDS: Readonly<
  Record<OnCallTestPageStepStatus, { text: string; color: Color }>
> = {
  [OnCallTestPageStepStatus.Paged]: {
    text: translationKey("Paged"),
    color: Blue500,
  },
  [OnCallTestPageStepStatus.Acknowledged]: {
    text: translationKey("Acknowledged"),
    color: Green500,
  },
  [OnCallTestPageStepStatus.Skipped]: {
    text: translationKey("Not paged"),
    color: Yellow500,
  },
  [OnCallTestPageStepStatus.Failed]: {
    text: translationKey("Failed"),
    color: Red500,
  },
};

// The result's headline, and its color.
export const RESULT_STATUS_WORDS: Readonly<
  Record<OnCallTestPageStatus, { title: string; color: Color }>
> = {
  [OnCallTestPageStatus.Paging]: {
    title: translationKey("Waiting for an acknowledgement"),
    color: Blue500,
  },
  [OnCallTestPageStatus.Acknowledged]: {
    title: translationKey("It works"),
    color: Green500,
  },
  [OnCallTestPageStatus.Ended]: {
    title: translationKey("Nobody acknowledged it"),
    color: Yellow500,
  },
  [OnCallTestPageStatus.Failed]: {
    title: translationKey("The test could not run"),
    color: Red500,
  },
};

// Where a message that did not go out is put right, and the link's words.
export interface OnCallTestPageFixLink {
  pageMap: PageMap;
  text: string;
}

export const FIX_LINKS: Readonly<
  Record<OnCallTestPageFix, OnCallTestPageFixLink>
> = {
  [OnCallTestPageFix.NotificationMethods]: {
    pageMap: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
    text: translationKey("Open Notification Methods"),
  },
  [OnCallTestPageFix.OnCallRules]: {
    pageMap: PageMap.USER_SETTINGS_ON_CALL_RULES,
    text: translationKey("Open How to Reach Me"),
  },
  [OnCallTestPageFix.ProjectNotificationSettings]: {
    pageMap: PageMap.SETTINGS_NOTIFICATION_SETTINGS,
    text: translationKey("Open Notification Channels"),
  },
  [OnCallTestPageFix.ProjectBalance]: {
    pageMap: PageMap.SETTINGS_BILLING,
    text: translationKey("Open Billing"),
  },
  [OnCallTestPageFix.ProjectCallAndSms]: {
    pageMap: PageMap.SETTINGS_NOTIFICATION_SETTINGS,
    text: translationKey("Open Notification Channels"),
  },
  [OnCallTestPageFix.ProjectWorkspaceConnections]: {
    pageMap: PageMap.SETTINGS_SLACK_INTEGRATION,
    text: translationKey("Open the workspace connection"),
  },
};

/*
 * The workspace a fix of a chat message opens: the one the message was
 * sent through, Slack when it is not known.
 */
export function getFixLink(data: {
  fix: OnCallTestPageFix;
  channel: OnCallPageChannel | null;
}): OnCallTestPageFixLink {
  if (data.fix === OnCallTestPageFix.ProjectWorkspaceConnections) {
    if (data.channel === OnCallPageChannel.MicrosoftTeams) {
      return {
        ...FIX_LINKS[data.fix],
        pageMap: PageMap.SETTINGS_MICROSOFT_TEAMS_INTEGRATION,
      };
    }

    if (data.channel === OnCallPageChannel.Mattermost) {
      return {
        ...FIX_LINKS[data.fix],
        pageMap: PageMap.SETTINGS_MATTERMOST_INTEGRATION,
      };
    }
  }

  return FIX_LINKS[data.fix];
}

/*
 * WHAT A PREVIEW SAYS, IN THE READER'S WORDS (#7015). The server sends each
 * warning, each target that reaches nobody and each "why them" as a code
 * with its values (Types/OnCallDutyPolicy/OnCallTestPage), and each is one
 * whole sentence here. A code this Dashboard does not know - or a preview
 * from a server that sent none - shows the server's English.
 */

// Why a policy's test pages a person: "Team Platform", "Schedule Primary".
export const REACHED_THROUGH_WORDS: Readonly<
  Record<OnCallTestPageReachedThroughCode, string>
> = {
  [OnCallTestPageReachedThroughCode.Team]: translationKey("Team {{name}}"),
  [OnCallTestPageReachedThroughCode.Schedule]:
    translationKey("Schedule {{name}}"),
  [OnCallTestPageReachedThroughCode.ScheduleNextInRotation]: translationKey(
    "Schedule {{name}} (next in rotation)",
  ),
  [OnCallTestPageReachedThroughCode.CoveringFor]: translationKey(
    "Covering for {{name}}",
  ),
};

/*
 * What a preview warns about a person, the ones that name no channel. A
 * person with no rule falls back to the methods listed above the warning,
 * the ones the fallback picks (FALLS_BACK_TO_LISTED) - or has none it may
 * use (#7262); a server that does not list them says the test goes to
 * every verified method.
 */
export const WARNING_SENTENCES: Readonly<
  Record<
    | OnCallTestPageWarningCode.OptedOut
    | OnCallTestPageWarningCode.NoRuleNoFallback
    | OnCallTestPageWarningCode.NoRuleFallsBack
    | OnCallTestPageWarningCode.NoRuleNothingToFallBackTo,
    string
  >
> = {
  [OnCallTestPageWarningCode.OptedOut]: translationKey(
    "Opted out of pages of this severity, so the test sends nothing.",
  ),
  [OnCallTestPageWarningCode.NoRuleNoFallback]: translationKey(
    "No on-call rule covers this severity, and this project does not fall back to verified methods: the test sends nothing.",
  ),
  [OnCallTestPageWarningCode.NoRuleFallsBack]: translationKey(
    "No on-call rule covers this severity: like a real page, the test goes to every verified method instead.",
  ),
  [OnCallTestPageWarningCode.NoRuleNothingToFallBackTo]: translationKey(
    "No on-call rule covers this severity, and no verified method can be used instead: the test sends nothing.",
  ),
};

/*
 * A person with no rule, listed with the methods the fallback picks
 * (#7262): "the method above" for one - most often the email address every
 * member verifies when they join - and "the methods above" for more.
 */
export const FALLS_BACK_TO_LISTED: PluralTemplate = {
  one: "No on-call rule covers this severity: like a real page, the test falls back to the method above.",
  other:
    "No on-call rule covers this severity: like a real page, the test falls back to the methods above.",
};

// A method a rule uses that is not verified, by its channel.
export const METHOD_NOT_VERIFIED_SENTENCES: Readonly<
  Record<OnCallPageChannel, string>
> = {
  [OnCallPageChannel.Call]: translationKey(
    "This phone call method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.SMS]: translationKey(
    "This SMS method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.WhatsApp]: translationKey(
    "This WhatsApp method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.Telegram]: translationKey(
    "This Telegram method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.Push]: translationKey(
    "This push notification method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.Email]: translationKey(
    "This email method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.Slack]: translationKey(
    "This Slack method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.MicrosoftTeams]: translationKey(
    "This Microsoft Teams method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.Mattermost]: translationKey(
    "This Mattermost method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.Webhook]: translationKey(
    "This webhook method is not verified, so the test can't use it.",
  ),
  [OnCallPageChannel.CustomChannel]: translationKey(
    "This custom channel is turned off, so the test can't use it.",
  ),
};

/*
 * A channel switched off in the project: what Notification Methods says of
 * it, who can turn it on and where (ProjectNotificationChannelsCopy).
 */
const CHANNEL_OFF_LISTS: Readonly<
  Partial<Record<OnCallPageChannel, ChannelGatedMethodList>>
> = {
  [OnCallPageChannel.SMS]: ChannelGatedMethodList.SMS,
  [OnCallPageChannel.Call]: ChannelGatedMethodList.Call,
  [OnCallPageChannel.WhatsApp]: ChannelGatedMethodList.WhatsApp,
  [OnCallPageChannel.Telegram]: ChannelGatedMethodList.Telegram,
};

// Why a target of a policy's level reaches nobody.
export const NOT_PAGED_SENTENCES: Readonly<{
  policyHasNoLevels: string;
  firstLevelNamesNobody: string;
  levelNamesNobody: string;
  teamHasNoMembers: string;
  nobodyNextInRotation: string;
  nobodyOnCall: string;
  awayWithNobodyCovering: string;
  notProjectMember: string;
}> = {
  policyHasNoLevels: translationKey(
    "This policy has no escalation rules yet, so a test pages nobody.",
  ),
  firstLevelNamesNobody: translationKey(
    "The first escalation rule pages nobody yet. Add people, a team or a schedule to it.",
  ),
  levelNamesNobody: translationKey(
    "Escalation rule {{order}} pages nobody yet. Add people, a team or a schedule to it.",
  ),
  teamHasNoMembers: translationKey("Team {{name}} has no members."),
  nobodyNextInRotation: translationKey(
    "Nobody is next in the rotation of schedule {{name}}.",
  ),
  nobodyOnCall: translationKey("Nobody is on call in schedule {{name}} now."),
  awayWithNobodyCovering: translationKey(
    "{{name}} is away until {{time}}, with nobody covering.",
  ),
  notProjectMember: translationKey("{{name}} is not a member of this project."),
};

/*
 * THE WALK (#7016): a policy's test that walks every level pages each in
 * turn until somebody acknowledges it - each level's heading, the levels it
 * never reaches, and what it costs at most.
 */
export const WALK_LEVEL_RIGHT_AWAY: string = translationKey(
  "Level {{order}}, right away",
);

export const WALK_LEVEL_AFTER: PluralTemplate = {
  one: "Level {{order}}, after {{count}} minute",
  other: "Level {{order}}, after {{count}} minutes",
};

/*
 * Where a walk stops short of the policy's last level: a test ends
 * ON_CALL_TEST_PAGE_ANSWER_WINDOW_IN_MINUTES after it is sent ({{minutes}}),
 * whatever levels are left.
 */
export const WALK_UNREACHED_LEVELS: PluralTemplate = {
  one: "The test ends after {{minutes}} minutes, before it reaches {{count}} more level.",
  other:
    "The test ends after {{minutes}} minutes, before it reaches {{count}} more levels.",
};

/*
 * WHEN A TEST WOULD SEND NOTHING (#7529, #7259): Send is off, and one line
 * under the preview says why and the one thing to do. For yourself, the page
 * that puts it right (FIX_LINKS): a way to reach you to verify, or how you
 * are reached for the severity. For a member or a policy, that the lines
 * above say why - they are somebody else's to fix. For a policy whose first
 * level reaches nobody while a later one can, walking every level, which
 * the line turns on in one click (WALK_EVERY_LEVEL).
 */
export const REACHES_NOBODY_SENTENCES: Readonly<{
  selfVerify: string;
  selfChooseHow: string;
  member: string;
  memberUnnamed: string;
  policy: string;
  firstLevelOnly: string;
}> = {
  selfVerify: translationKey(
    "This test would send you nothing yet. Verify a way to reach you, then send it.",
  ),
  selfChooseHow: translationKey(
    "This test would send you nothing yet. Choose how you are reached for this severity, then send it.",
  ),
  member: translationKey(
    "This test would send {{name}} nothing yet. The line above says why.",
  ),
  memberUnnamed: translationKey(
    "This test would send them nothing yet. The line above says why.",
  ),
  policy: translationKey(
    "This test would send nothing yet: nobody it pages can receive it right now. Each line above says why.",
  ),
  firstLevelOnly: translationKey(
    "Nobody on the first level can receive this test right now, so it would send nothing. A later level can.",
  ),
};

/*
 * What the line's button says: the walk's own name, as the box above it
 * says it - pressing it ticks that box.
 */
export const WALK_EVERY_LEVEL: string = translationKey(
  "Walk every escalation level",
);

/*
 * A MONITOR'S FIRE DRILL (#7012): one test of each on-call policy the
 * failure picked pages, said plainly before it starts - that it is a test,
 * which policies it pages and who each pages - and each policy's result
 * after.
 */
export const FIRE_DRILL_WORDS: Readonly<{
  button: string;
  title: string;
  description: string;
  whatFails: string;
  start: string;
  policyYouCantSee: string;
  cantTestPolicy: string;
  reachesNobody: string;
  firstLevelsReachNobody: string;
  walkDescription: string;
  declaredIncident: string;
  declaredNow: string;
  declaredNowHiddenRule: string;
  started: string;
}> = {
  button: translationKey("Run Fire Drill"),
  title: translationKey("Fire Drill"),
  description: translationKey(
    "Tests everyone this monitor's failure would page. Every message says TEST. No incident or alert is created, and no status page or channel is told.",
  ),
  whatFails: translationKey("What fails"),
  start: translationKey("Start Fire Drill"),
  policyYouCantSee: translationKey("An on-call policy you can't see"),
  cantTestPolicy: translationKey(
    "You can't test this policy, so who it pages is not shown.",
  ),
  reachesNobody: translationKey(
    "This fire drill would send nothing yet: nobody these policies page can receive it right now. Each line above says why.",
  ),
  /*
   * Nobody on any policy's first level can receive it, and a later level of
   * one can (#9385): walking every level, in one click, as a policy's own
   * test offers it (#7259).
   */
  firstLevelsReachNobody: translationKey(
    "Nobody on these policies' first levels can receive this fire drill right now, so it would send nothing. A later level can.",
  ),
  // Under Walk every escalation level, folded under More fields (#9385).
  walkDescription: translationKey(
    "Pages each level of every policy in turn, up to {{minutes}} minutes apart, until someone acknowledges. Off, it pages each policy's first level only.",
  ),
  /*
   * The incident an alert incident rule declares from an alert of the
   * criteria (#9397), as the picker offers it: "Slow · An incident
   * (Critical) declared from its alert".
   */
  declaredIncident: translationKey(
    "An incident ({{severity}}) declared from its alert",
  ),
  declaredNow: translationKey(
    "Alert incident rule {{rule}} declares this incident from the alert right away.",
  ),
  declaredNowHiddenRule: translationKey(
    "An alert incident rule you can't see declares this incident from the alert right away.",
  ),
  started: translationKey(
    "Started. Each policy's messages are below as they go out. Each test ends when someone acknowledges it, or after {{minutes}} minutes.",
  ),
};

/*
 * The incident an alert incident rule declares once its alert has been open
 * a while (#9397): by the rule, or one the reader can't see - and that the
 * drill does not wait for it.
 */
export const FIRE_DRILL_DECLARED_AFTER: PluralTemplate = {
  one: "Alert incident rule {{rule}} declares this incident from the alert if it's still open after {{count}} minute. The fire drill tests it now, without the wait.",
  other:
    "Alert incident rule {{rule}} declares this incident from the alert if it's still open after {{count}} minutes. The fire drill tests it now, without the wait.",
};

export const FIRE_DRILL_DECLARED_AFTER_HIDDEN_RULE: PluralTemplate = {
  one: "An alert incident rule you can't see declares this incident from the alert if it's still open after {{count}} minute. The fire drill tests it now, without the wait.",
  other:
    "An alert incident rule you can't see declares this incident from the alert if it's still open after {{count}} minutes. The fire drill tests it now, without the wait.",
};

/*
 * Why a fire drill can't start: a policy of it the reader may not test. It
 * tests every policy, or none - a drill that skipped one would say all is
 * well.
 */
export const FIRE_DRILL_CANT_TEST: PluralTemplate = {
  one: "You can't start this fire drill: it tests every policy this failure pages, and you can't test {{count}} of them. Ask a Project Admin, or the policy's owners.",
  other:
    "You can't start this fire drill: it tests every policy this failure pages, and you can't test {{count}} of them. Ask a Project Admin, or the policies' owners.",
};

/*
 * A MONITOR'S LAST FIRE DRILL (#9386), on its When this goes down card:
 * the failure it rehearsed, then when and by whom - "Offline · An incident
 * (Critical) · Started 2 hours ago by Ana Lopez" - how many of its tests
 * were acknowledged, and, folded until wanted, each policy's.
 */
export const FIRE_DRILL_LAST_WORDS: Readonly<{
  title: string;
  startedBy: string;
  started: string;
  walked: string;
}> = {
  title: translationKey("Last fire drill"),
  startedBy: translationKey("Started {{time}} by {{name}}"),
  // Who started it is gone.
  started: translationKey("Started {{time}}"),
  walked: translationKey("Each test walked every escalation level."),
};

// How many of its tests were acknowledged: the drill is over.
export const FIRE_DRILL_LAST_ACKNOWLEDGED: PluralTemplate = {
  one: "{{acknowledged}} of {{count}} test acknowledged.",
  other: "{{acknowledged}} of {{count}} tests acknowledged.",
};

// The same while a test of it still waits for somebody.
export const FIRE_DRILL_LAST_ACKNOWLEDGED_SO_FAR: PluralTemplate = {
  one: "{{acknowledged}} of {{count}} test acknowledged so far.",
  other: "{{acknowledged}} of {{count}} tests acknowledged so far.",
};

// What a test costs, in a sentence: the first level's, or a walk's at most.
export const COST_SENTENCES: Readonly<{
  firstLevel: { withAmount: string; withoutAmount: string };
  walk: { withAmount: string; withoutAmount: string };
  fireDrill: { withAmount: string; withoutAmount: string };
  fireDrillWalk: { withAmount: string; withoutAmount: string };
}> = {
  firstLevel: {
    withAmount: translationKey(
      "This test sends {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
    ),
    withoutAmount: translationKey(
      "This test sends {{items}}, paid from this project's SMS and call balance.",
    ),
  },
  walk: {
    withAmount: translationKey(
      "If nobody acknowledges it, walking every level sends up to {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
    ),
    withoutAmount: translationKey(
      "If nobody acknowledges it, walking every level sends up to {{items}}, paid from this project's SMS and call balance.",
    ),
  },
  // A fire drill's: every policy's first level together.
  fireDrill: {
    withAmount: translationKey(
      "This fire drill sends {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
    ),
    withoutAmount: translationKey(
      "This fire drill sends {{items}}, paid from this project's SMS and call balance.",
    ),
  },
  // A fire drill's that walks every level of each policy (#9385), at most.
  fireDrillWalk: {
    withAmount: translationKey(
      "If nobody acknowledges them, walking every level of each policy sends up to {{items}}, paid from this project's SMS and call balance: about {{amount}}.",
    ),
    withoutAmount: translationKey(
      "If nobody acknowledges them, walking every level of each policy sends up to {{items}}, paid from this project's SMS and call balance.",
    ),
  },
};

// A name in a sentence, or "Someone" when the server had none.
function nameOr(name: string | undefined): TemplateValue {
  return name || translatableTerm("Someone");
}

// Why a policy's test pages this person, in the reader's words.
export function getReachedThroughWords(
  translator: Translator,
  person: Pick<
    OnCallTestPagePreviewPerson,
    "reachedThrough" | "reachedThroughCode"
  >,
): string {
  const code: OnCallTestPageReachedThrough | undefined =
    person.reachedThroughCode;
  const template: string | undefined = code
    ? REACHED_THROUGH_WORDS[code.code]
    : undefined;

  if (!code || !template) {
    return person.reachedThrough || "";
  }

  return translator.translateTemplate(
    template,
    { name: code.name },
    { setsValuesApart: true },
  );
}

/*
 * How many methods a fallback picked are said to be "above" when that is
 * not known: more than one, the general form of the sentence.
 */
const UNKNOWN_FALLBACK_METHOD_COUNT: number = 2;

/*
 * One warning about a person, in the reader's words. The one that says the
 * test falls back to the methods listed above it names one method or more
 * by how many the fallback picked (fallbackMethodCount); not known, more.
 */
export function getWarningSentence(
  translator: Translator,
  warning: OnCallTestPageWarning,
  options?: { fallbackMethodCount?: number | undefined } | undefined,
): string {
  switch (warning.code) {
    case OnCallTestPageWarningCode.NoRuleFallsBackToListed:
      return translator.translatePlural(
        FALLS_BACK_TO_LISTED,
        options?.fallbackMethodCount || UNKNOWN_FALLBACK_METHOD_COUNT,
      );
    case OnCallTestPageWarningCode.OptedOut:
    case OnCallTestPageWarningCode.NoRuleNoFallback:
    case OnCallTestPageWarningCode.NoRuleFallsBack:
    case OnCallTestPageWarningCode.NoRuleNothingToFallBackTo:
      return translator.translateTemplate(WARNING_SENTENCES[warning.code]);
    case OnCallTestPageWarningCode.ChannelOff: {
      const list: ChannelGatedMethodList | undefined = warning.channel
        ? CHANNEL_OFF_LISTS[warning.channel]
        : undefined;

      return list
        ? translator.translateTemplate(
            getChannelGatedMethodList(list).offSentence,
          )
        : warning.message;
    }
    case OnCallTestPageWarningCode.MethodNotVerified: {
      const sentence: string | undefined = warning.channel
        ? METHOD_NOT_VERIFIED_SENTENCES[warning.channel]
        : undefined;

      return sentence
        ? translator.translateTemplate(sentence)
        : warning.message;
    }
  }

  return warning.message;
}

/*
 * A person's warnings, in the reader's words: from their codes, or the
 * server's English when it sent none.
 */
export function getPersonWarnings(
  translator: Translator,
  person: Pick<OnCallTestPagePreviewPerson, "warnings" | "warningCodes"> &
    Partial<Pick<OnCallTestPagePreviewPerson, "methods">>,
): Array<string> {
  if (!Array.isArray(person.warningCodes)) {
    return person.warnings;
  }

  // The methods the fallback picked, listed above the warning that says so.
  const fallbackMethodCount: number = (person.methods || []).filter(
    (method: OnCallTestPagePreviewMethod): boolean => {
      return Boolean(method.isFallback);
    },
  ).length;

  return person.warningCodes.map((warning: OnCallTestPageWarning): string => {
    return getWarningSentence(translator, warning, {
      fallbackMethodCount: fallbackMethodCount,
    });
  });
}

// Why one target of a level reaches nobody, in the reader's words.
export function getNotPagedSentence(
  translator: Translator,
  notPaged: OnCallTestPageNotPaged,
): string {
  switch (notPaged.code) {
    case OnCallTestPageNotPagedCode.PolicyHasNoLevels:
      return translator.translateTemplate(
        NOT_PAGED_SENTENCES.policyHasNoLevels,
      );
    case OnCallTestPageNotPagedCode.LevelNamesNobody:
      return notPaged.levelOrder && notPaged.levelOrder > 1
        ? translator.translateTemplate(NOT_PAGED_SENTENCES.levelNamesNobody, {
            order: translator.formatNumber(notPaged.levelOrder),
          })
        : translator.translateTemplate(
            NOT_PAGED_SENTENCES.firstLevelNamesNobody,
          );
    case OnCallTestPageNotPagedCode.TeamHasNoMembers:
      return translator.translateTemplate(
        NOT_PAGED_SENTENCES.teamHasNoMembers,
        { name: notPaged.teamName || "" },
        { setsValuesApart: true },
      );
    case OnCallTestPageNotPagedCode.NobodyNextInRotation:
      return translator.translateTemplate(
        NOT_PAGED_SENTENCES.nobodyNextInRotation,
        { name: notPaged.scheduleName || "" },
        { setsValuesApart: true },
      );
    case OnCallTestPageNotPagedCode.NobodyOnCall:
      return translator.translateTemplate(
        NOT_PAGED_SENTENCES.nobodyOnCall,
        { name: notPaged.scheduleName || "" },
        { setsValuesApart: true },
      );
    case OnCallTestPageNotPagedCode.AwayWithNobodyCovering:
      return notPaged.awayUntil
        ? translator.translateTemplate(
            NOT_PAGED_SENTENCES.awayWithNobodyCovering,
            {
              name: nameOr(notPaged.userName),
              time: OneUptimeDate.getDateAsUserFriendlyFormattedString(
                OneUptimeDate.fromString(notPaged.awayUntil),
              ),
            },
            { setsValuesApart: true },
          )
        : notPaged.message;
    case OnCallTestPageNotPagedCode.NotProjectMember:
      return translator.translateTemplate(
        NOT_PAGED_SENTENCES.notProjectMember,
        { name: nameOr(notPaged.userName) },
        { setsValuesApart: true },
      );
  }

  return notPaged.message;
}

/*
 * The targets of a level that reach nobody, in the reader's words: from
 * their codes, or the server's English when it sent none.
 */
export function getNotPagedLines(
  translator: Translator,
  level: {
    notPaged: Array<string>;
    notPagedCodes?: Array<OnCallTestPageNotPaged> | undefined;
  },
): Array<string> {
  if (!Array.isArray(level.notPagedCodes)) {
    return level.notPaged;
  }

  return level.notPagedCodes.map((notPaged: OnCallTestPageNotPaged): string => {
    return getNotPagedSentence(translator, notPaged);
  });
}

/*
 * A walked level's heading: "Level 2, after 2 minutes". Its number is
 * written in the reader's digits, as the minutes are.
 */
export function getWalkLevelHeading(
  translator: Translator,
  level: { order: number; startsAfterMinutes: number },
): string {
  const order: string = translator.formatNumber(level.order);

  if (level.startsAfterMinutes <= 0) {
    return translator.translateTemplate(WALK_LEVEL_RIGHT_AWAY, {
      order: order,
    });
  }

  return translator.translatePlural(
    WALK_LEVEL_AFTER,
    level.startsAfterMinutes,
    { order: order },
  );
}

/*
 * THE RESULT'S LINES (#7260): what became of a message, a person or a
 * target, and how the test ended, sent as a code with its values
 * (Types/OnCallDutyPolicy/OnCallTestPageLine). Each is one whole sentence -
 * the preview's own, where it says the same - so a German or a Persian
 * reader reads why an SMS was not sent in their language. A line with no
 * code, or with one this Dashboard does not know, is shown as the server
 * wrote it (TestPageResult).
 */
export const RESULT_LINE_SENTENCES: Readonly<{
  pushAppNoLongerReceives: string;
  pushBrowserNoLongerReceives: string;
  noVerifiedMethod: string;
  fallbackFailed: string;
  levelHasNoResponders: string;
  levelPagedNobody: string;
  alreadyPaged: string;
  sendingToPerson: string;
  rulesRan: string;
  runUnreadable: string;
  nobodyPaged: string;
  firstLevelReachedNobody: string;
  wentThroughEveryLevel: string;
}> = {
  pushAppNoLongerReceives: translationKey(
    "The mobile app was removed from this device, or its push token is no longer valid. Open the mobile app on it to register it again.",
  ),
  pushBrowserNoLongerReceives: translationKey(
    "This device's push subscription expired or was revoked. Register it again from the browser or app it belongs to.",
  ),
  noVerifiedMethod: translationKey(
    "{{name}} has no verified notification method.",
  ),
  fallbackFailed: translationKey(
    "No on-call rule covers this severity, and paging the verified methods instead failed.",
  ),
  levelHasNoResponders: translationKey(
    "This level has no responders, so the policy moved on at once.",
  ),
  levelPagedNobody: translationKey(
    "Nobody at this level could be paged, so the policy moved on at once.",
  ),
  alreadyPaged: translationKey(
    "Already paged by this test, so not paged again.",
  ),
  sendingToPerson: translationKey("Sending the test page..."),
  rulesRan: translationKey("Every on-call rule for this severity ran at once."),
  runUnreadable: translationKey(
    "This test page does not say which kind of page and severity it tests, so nothing was sent.",
  ),
  nobodyPaged: translationKey(
    "The test page reached nobody. Each person's line says why.",
  ),
  firstLevelReachedNobody: translationKey(
    "Test ended: the first escalation level reached nobody. Each person's line says why.",
  ),
  wentThroughEveryLevel: translationKey(
    "Test ended: it went through every escalation level and nobody acknowledged it.",
  ),
};

// A test nobody acknowledged within its answer window.
export const RESULT_ENDED_UNANSWERED: PluralTemplate = {
  one: "Test ended: nobody acknowledged it within {{count}} minute.",
  other: "Test ended: nobody acknowledged it within {{count}} minutes.",
};

/*
 * WHY A MESSAGE WAS NOT SENT, IN ONEUPTIME'S OWN WORDS (#7550,
 * Types/OnCallDutyPolicy/OnCallSendFailureLine). The Notification service's
 * own words after a refusal, an HTTP status and a socket's code are not
 * OneUptime's: they go into the sentence as written, set apart, so they
 * read left to right in an Arabic or Persian one.
 */

// A send that failed, and whose error said nothing more.
export const SEND_FAILED_SENTENCES: Readonly<
  Record<Exclude<OnCallPageChannel, OnCallPageChannel.CustomChannel>, string>
> = {
  [OnCallPageChannel.Email]: translationKey("Error sending email."),
  [OnCallPageChannel.SMS]: translationKey("Error sending SMS."),
  [OnCallPageChannel.WhatsApp]: translationKey(
    "Error sending WhatsApp message.",
  ),
  [OnCallPageChannel.Telegram]: translationKey(
    "Error sending Telegram message.",
  ),
  [OnCallPageChannel.Webhook]: translationKey("Error sending webhook."),
  [OnCallPageChannel.Call]: translationKey("Error making call."),
  [OnCallPageChannel.Push]: translationKey("Error sending push notification."),
  [OnCallPageChannel.Slack]: translationKey("Error sending Slack message."),
  [OnCallPageChannel.MicrosoftTeams]: translationKey(
    "Error sending Microsoft Teams message.",
  ),
  [OnCallPageChannel.Mattermost]: translationKey(
    "Error sending Mattermost message.",
  ),
};

// A custom channel's: by its name, or with none.
export const CUSTOM_CHANNEL_SEND_FAILED_SENTENCE: string = translationKey(
  "Error sending to {{name}}.",
);
export const UNNAMED_CUSTOM_CHANNEL_SEND_FAILED_SENTENCE: string =
  translationKey("Error sending to the custom channel.");

export const NOTIFICATION_SERVICE_SENTENCES: Readonly<{
  refusedWithWords: string;
  refused: string;
  answerFailedWithStatusAndWords: string;
  answerFailedWithStatus: string;
  answerFailedWithWords: string;
  answerFailed: string;
  notReached: string;
}> = {
  refusedWithWords: translationKey(
    "The Notification service refused to send this (HTTP {{statusCode}}): {{words}}",
  ),
  refused: translationKey(
    "The Notification service refused to send this (HTTP {{statusCode}}).",
  ),
  answerFailedWithStatusAndWords: translationKey(
    "The Notification service answered with an error (HTTP {{statusCode}}), so this may not have been sent: {{words}}",
  ),
  answerFailedWithStatus: translationKey(
    "The Notification service answered with an error (HTTP {{statusCode}}), so this may not have been sent.",
  ),
  answerFailedWithWords: translationKey(
    "The Notification service answered with an error, so this may not have been sent: {{words}}",
  ),
  answerFailed: translationKey(
    "The Notification service answered with an error, so this may not have been sent.",
  ),
  notReached: translationKey(
    "Could not reach the Notification service to send this ({{reason}}).",
  ),
};

/*
 * The project's balance could not pay for a message: used up, or less
 * than one message on its channel costs - then who can add balance, and
 * where, the sentence the on-call setup says too.
 */
export const BALANCE_USED_UP_SENTENCE: string = translationKey(
  "This project's balance is used up.",
);

export const BALANCE_LESS_THAN_COST_SENTENCES: Readonly<
  Partial<Record<OnCallPageChannel, string>>
> = {
  [OnCallPageChannel.SMS]: translationKey(
    "This project's balance ({{balance}}) is less than this SMS costs ({{cost}}).",
  ),
  [OnCallPageChannel.Call]: translationKey(
    "This project's balance ({{balance}}) is less than this call costs ({{cost}}).",
  ),
  [OnCallPageChannel.WhatsApp]: translationKey(
    "This project's balance ({{balance}}) is less than this WhatsApp message costs ({{cost}}).",
  ),
  [OnCallPageChannel.Telegram]: translationKey(
    "This project's balance ({{balance}}) is less than this Telegram message costs ({{cost}}).",
  ),
};

export const WHO_CAN_ADD_BALANCE_SENTENCE: string = translationKey(
  "A Project Owner or someone with Manage Billing can add balance in Project Settings → Notifications → Notification Channels.",
);

/*
 * A chat workspace that is not connected: the project's connection to it,
 * or the person's own account - by the workspace's name, as written.
 */
export const WORKSPACE_NOT_CONNECTED_SENTENCES: Readonly<{
  project: string;
  account: string;
}> = {
  project: translationKey(
    "This project is not connected to {{workspace}}, so nothing was sent there. A Project Admin can connect it in Project Settings → Workspace → {{workspace}}.",
  ),
  account: translationKey(
    "This {{workspace}} account is not connected to OneUptime in this project, so nothing was sent to it. Its owner can connect it in User Settings → Workspace → {{workspace}}.",
  ),
};

// The values a line sets apart in its sentence: written as they came.
const SET_APART: { setsValuesApart: boolean } = { setsValuesApart: true };

function getSendFailedSentence(
  translator: Translator,
  line: OnCallTestPageLine,
): string | null {
  if (!line.channel) {
    return null;
  }

  if (line.channel === OnCallPageChannel.CustomChannel) {
    return line.name
      ? translator.translateTemplate(
          CUSTOM_CHANNEL_SEND_FAILED_SENTENCE,
          { name: line.name },
          SET_APART,
        )
      : translator.translateTemplate(
          UNNAMED_CUSTOM_CHANNEL_SEND_FAILED_SENTENCE,
        );
  }

  const sentence: string | undefined = SEND_FAILED_SENTENCES[line.channel];

  return sentence ? translator.translateTemplate(sentence) : null;
}

function getNotificationServiceSentence(
  translator: Translator,
  line: OnCallTestPageLine,
): string | null {
  // An HTTP status is a code, drawn as written in every language.
  const statusCode: string | null =
    typeof line.statusCode === "number" ? String(line.statusCode) : null;
  const words: string | null = line.words || null;

  if (line.code === OnCallTestPageLineCode.NotificationServiceRefused) {
    if (statusCode === null) {
      return null;
    }

    return words
      ? translator.translateTemplate(
          NOTIFICATION_SERVICE_SENTENCES.refusedWithWords,
          { statusCode: statusCode, words: words },
          SET_APART,
        )
      : translator.translateTemplate(
          NOTIFICATION_SERVICE_SENTENCES.refused,
          { statusCode: statusCode },
          SET_APART,
        );
  }

  if (statusCode !== null) {
    return words
      ? translator.translateTemplate(
          NOTIFICATION_SERVICE_SENTENCES.answerFailedWithStatusAndWords,
          { statusCode: statusCode, words: words },
          SET_APART,
        )
      : translator.translateTemplate(
          NOTIFICATION_SERVICE_SENTENCES.answerFailedWithStatus,
          { statusCode: statusCode },
          SET_APART,
        );
  }

  return words
    ? translator.translateTemplate(
        NOTIFICATION_SERVICE_SENTENCES.answerFailedWithWords,
        { words: words },
        SET_APART,
      )
    : translator.translateTemplate(NOTIFICATION_SERVICE_SENTENCES.answerFailed);
}

function getBalanceTooLowSentence(
  translator: Translator,
  line: OnCallTestPageLine,
): string | null {
  let shortfall: string | null = null;

  if (!line.balance && !line.cost) {
    shortfall = translator.translateTemplate(BALANCE_USED_UP_SENTENCE);
  } else {
    const sentence: string | undefined = line.channel
      ? BALANCE_LESS_THAN_COST_SENTENCES[line.channel]
      : undefined;

    shortfall =
      sentence && line.balance && line.cost
        ? translator.translateTemplate(
            sentence,
            { balance: line.balance, cost: line.cost },
            SET_APART,
          )
        : null;
  }

  if (shortfall === null) {
    return null;
  }

  return `${shortfall} ${translator.translateTemplate(WHO_CAN_ADD_BALANCE_SENTENCE)}`;
}

function getWorkspaceNotConnectedSentence(
  translator: Translator,
  line: OnCallTestPageLine,
): string | null {
  if (!line.channel) {
    return null;
  }

  return translator.translateTemplate(
    line.isProjectConnection
      ? WORKSPACE_NOT_CONNECTED_SENTENCES.project
      : WORKSPACE_NOT_CONNECTED_SENTENCES.account,
    { workspace: line.channel },
    SET_APART,
  );
}

/*
 * One line of the result, in the reader's words: from its code and the
 * values it names. Null when there is no code, the Dashboard does not know
 * it, or a value its sentence names is missing - the line is then shown as
 * the server wrote it.
 */
export function getResultLineSentence(
  translator: Translator,
  line: OnCallTestPageLine | null | undefined,
): string | null {
  if (!line) {
    return null;
  }

  switch (line.code) {
    case OnCallTestPageLineCode.MethodNotVerified: {
      const sentence: string | undefined = line.channel
        ? METHOD_NOT_VERIFIED_SENTENCES[line.channel]
        : undefined;

      return sentence ? translator.translateTemplate(sentence) : null;
    }
    case OnCallTestPageLineCode.ChannelOff: {
      const list: ChannelGatedMethodList | undefined = line.channel
        ? CHANNEL_OFF_LISTS[line.channel]
        : undefined;

      return list
        ? translator.translateTemplate(
            getChannelGatedMethodList(list).offSentence,
          )
        : null;
    }
    case OnCallTestPageLineCode.PushDeviceNoLongerReceives:
      return translator.translateTemplate(
        line.isMobileApp
          ? RESULT_LINE_SENTENCES.pushAppNoLongerReceives
          : RESULT_LINE_SENTENCES.pushBrowserNoLongerReceives,
      );
    case OnCallTestPageLineCode.NotificationServiceRefused:
    case OnCallTestPageLineCode.NotificationServiceAnswerFailed:
      return getNotificationServiceSentence(translator, line);
    case OnCallTestPageLineCode.NotificationServiceNotReached:
      return line.reason
        ? translator.translateTemplate(
            NOTIFICATION_SERVICE_SENTENCES.notReached,
            { reason: line.reason },
            SET_APART,
          )
        : null;
    case OnCallTestPageLineCode.SendFailed:
      return getSendFailedSentence(translator, line);
    case OnCallTestPageLineCode.ProjectBalanceTooLow:
      return getBalanceTooLowSentence(translator, line);
    case OnCallTestPageLineCode.WorkspaceNotConnected:
      return getWorkspaceNotConnectedSentence(translator, line);
    case OnCallTestPageLineCode.OptedOut:
      return translator.translateTemplate(
        WARNING_SENTENCES[OnCallTestPageWarningCode.OptedOut],
      );
    case OnCallTestPageLineCode.NoRuleNoFallback:
      return translator.translateTemplate(
        WARNING_SENTENCES[OnCallTestPageWarningCode.NoRuleNoFallback],
      );
    case OnCallTestPageLineCode.NoRuleFallsBack:
      return translator.translateTemplate(
        WARNING_SENTENCES[OnCallTestPageWarningCode.NoRuleFallsBack],
      );
    case OnCallTestPageLineCode.NoVerifiedMethod:
      return translator.translateTemplate(
        RESULT_LINE_SENTENCES.noVerifiedMethod,
        { name: nameOr(line.name) },
        { setsValuesApart: true },
      );
    case OnCallTestPageLineCode.FallbackFailed:
      return translator.translateTemplate(RESULT_LINE_SENTENCES.fallbackFailed);
    case OnCallTestPageLineCode.NotProjectMember:
      return translator.translateTemplate(
        NOT_PAGED_SENTENCES.notProjectMember,
        { name: nameOr(line.name) },
        { setsValuesApart: true },
      );
    case OnCallTestPageLineCode.AwayWithNobodyCovering:
      return line.awayUntil
        ? translator.translateTemplate(
            NOT_PAGED_SENTENCES.awayWithNobodyCovering,
            {
              name: nameOr(line.name),
              time: OneUptimeDate.getDateAsUserFriendlyFormattedString(
                OneUptimeDate.fromString(line.awayUntil),
              ),
            },
            { setsValuesApart: true },
          )
        : null;
    case OnCallTestPageLineCode.TeamHasNoMembers:
      return line.name
        ? translator.translateTemplate(
            NOT_PAGED_SENTENCES.teamHasNoMembers,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallTestPageLineCode.NobodyNextInRotation:
      return line.name
        ? translator.translateTemplate(
            NOT_PAGED_SENTENCES.nobodyNextInRotation,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallTestPageLineCode.NobodyOnCall:
      return line.name
        ? translator.translateTemplate(
            NOT_PAGED_SENTENCES.nobodyOnCall,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallTestPageLineCode.LevelHasNoResponders:
      return translator.translateTemplate(
        RESULT_LINE_SENTENCES.levelHasNoResponders,
      );
    case OnCallTestPageLineCode.LevelPagedNobody:
      return translator.translateTemplate(
        RESULT_LINE_SENTENCES.levelPagedNobody,
      );
    case OnCallTestPageLineCode.AlreadyPaged:
      return translator.translateTemplate(RESULT_LINE_SENTENCES.alreadyPaged);
    case OnCallTestPageLineCode.SendingToPerson:
      return translator.translateTemplate(
        RESULT_LINE_SENTENCES.sendingToPerson,
      );
    case OnCallTestPageLineCode.RulesRan:
      return translator.translateTemplate(RESULT_LINE_SENTENCES.rulesRan);
    case OnCallTestPageLineCode.RunUnreadable:
      return translator.translateTemplate(RESULT_LINE_SENTENCES.runUnreadable);
    case OnCallTestPageLineCode.NobodyPaged:
      return translator.translateTemplate(RESULT_LINE_SENTENCES.nobodyPaged);
    case OnCallTestPageLineCode.FirstLevelReachedNobody:
      return translator.translateTemplate(
        RESULT_LINE_SENTENCES.firstLevelReachedNobody,
      );
    case OnCallTestPageLineCode.EndedUnanswered:
      return typeof line.minutes === "number"
        ? translator.translatePlural(RESULT_ENDED_UNANSWERED, line.minutes)
        : null;
    case OnCallTestPageLineCode.WentThroughEveryLevel:
      return translator.translateTemplate(
        RESULT_LINE_SENTENCES.wentThroughEveryLevel,
      );
    case OnCallTestPageLineCode.PolicyHasNoLevels:
      return translator.translateTemplate(
        NOT_PAGED_SENTENCES.policyHasNoLevels,
      );
  }

  return null;
}
