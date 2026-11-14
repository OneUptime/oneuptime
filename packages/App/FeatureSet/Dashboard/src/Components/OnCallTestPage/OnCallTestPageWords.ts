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

// What a test costs, in a sentence: the first level's, or a walk's at most.
export const COST_SENTENCES: Readonly<{
  firstLevel: { withAmount: string; withoutAmount: string };
  walk: { withAmount: string; withoutAmount: string };
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
