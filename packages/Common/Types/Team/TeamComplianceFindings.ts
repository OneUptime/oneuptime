import ComplianceNotificationChannel from "./ComplianceNotificationChannel";
import ComplianceRule, {
  getValueInSentence,
  joinAsProse,
} from "./ComplianceRule";
import ComplianceRuleType from "./ComplianceRuleType";
import {
  TeamComplianceFindingJSON,
  TeamComplianceFindingKind,
  TeamComplianceSeverityJSON,
  TeamComplianceWarningJSON,
  TeamComplianceWarningKind,
} from "./TeamComplianceStatus";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  getListSeparator,
  TemplateValue,
  translatableTerm,
  translationKey,
  Translator,
} from "../Translator";

/*
 * WHAT THE TEAM COMPLIANCE PAGE SAYS ABOUT A RULE AND A MEMBER, IN ANY
 * LANGUAGE (#8632).
 *
 * The server (ee/Server/TeamCompliance/TeamComplianceEvaluator) works out
 * what is wrong with a rule - a channel the project has switched off, a
 * custom channel nothing can be sent to - and why a member fails one - no
 * rule for these severities, a rule that points at an unverified phone. It
 * used to send only English sentences, which the page drew as they came,
 * so every reader met them in English. It sends what it found as data now
 * (TeamComplianceWarningJSON, TeamComplianceFindingJSON), beside the same
 * English as before, and both are worded here: the server writes its
 * English with the English translator, the Dashboard the reader's
 * language with theirs.
 *
 * Every sentence is a whole key, one per rule subject where the subject is
 * in it ("incident severities", "alert episode severities"), so a language
 * words the subject with its own grammar. A channel's name, and what a
 * rule points at ("an unverified phone number for calls"), are terms the
 * sentence takes in its own words; a severity's name is a value the caller
 * gives (a project's own name as written, a default one in the reader's
 * words). The English of each key is the server's English word for word:
 * TeamComplianceFindings tests hold them to it.
 *
 * Pure data and pure functions only - this file is bundled into the Dashboard.
 */

// The language of the server, and of a caller that hands no translator.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// What is wrong with a rule itself, each a whole sentence.
const WARNING_SENTENCES: Readonly<
  Record<
    Exclude<
      TeamComplianceWarningKind,
      TeamComplianceWarningKind.ChannelsSwitchedOff
    >,
    string
  >
> = {
  [TeamComplianceWarningKind.UnknownRuleType]: translationKey(
    "This rule type is not recognised, so it is not checked.",
  ),
  [TeamComplianceWarningKind.SeveritiesDeleted]: translationKey(
    "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.",
  ),
  [TeamComplianceWarningKind.CustomChannelsNotActive]: translationKey(
    "Custom channels are a OneUptime Enterprise feature, and this server has no Enterprise license that includes them, so nothing is sent to a custom channel and members are not checked for one.",
  ),
  [TeamComplianceWarningKind.NoCustomChannelOn]: translationKey(
    "No custom channel is turned on, so nothing is sent to one and members are not checked for one. A server admin can turn one on in the Admin Dashboard, under Settings > Notifications > Custom Channels.",
  ),
  [TeamComplianceWarningKind.WhatsAppSwitchedOff]: translationKey(
    "WhatsApp is switched off for this project, so members cannot add a WhatsApp number to meet this rule. A Project Owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings > Notifications > Notification Channels.",
  ),
};

/*
 * One channel the project has switched off, and several: each ends saying
 * who can switch them on, and where (Utils/Project/NotificationChannels).
 */
const ONE_CHANNEL_SWITCHED_OFF: string = translationKey(
  "{{channel}} notifications are switched off for this project, so members will not be notified by {{channel}} even when they meet this rule. A Project Owner, a Billing Admin or someone with Manage Billing can turn them on in Project Settings > Notifications > Notification Channels.",
);

const CHANNELS_SWITCHED_OFF: string = translationKey(
  "{{channels}} notifications are switched off for this project, so members will not be notified on these channels even when they meet this rule. A Project Owner, a Billing Admin or someone with Manage Billing can turn them on in Project Settings > Notifications > Notification Channels.",
);

/*
 * The four "has a verified method" reasons, kept word for word as existing
 * installs have shown them to admins, and one for each channel since.
 */
export const METHOD_MISSING_SENTENCES: Readonly<
  Partial<Record<ComplianceNotificationChannel, string>>
> = {
  [ComplianceNotificationChannel.Email]: translationKey(
    "No verified email address configured for notifications",
  ),
  [ComplianceNotificationChannel.SMS]: translationKey(
    "No verified phone number configured for SMS notifications",
  ),
  [ComplianceNotificationChannel.Call]: translationKey(
    "No verified phone number configured for call notifications",
  ),
  [ComplianceNotificationChannel.Push]: translationKey(
    "No verified push notification device configured",
  ),
  [ComplianceNotificationChannel.WhatsApp]: translationKey(
    "No verified WhatsApp number configured for notifications",
  ),
  [ComplianceNotificationChannel.Telegram]: translationKey(
    "No verified Telegram account configured for notifications",
  ),
  [ComplianceNotificationChannel.Slack]: translationKey(
    "No verified Slack account configured for notifications",
  ),
  [ComplianceNotificationChannel.MicrosoftTeams]: translationKey(
    "No verified Microsoft Teams account configured for notifications",
  ),
  [ComplianceNotificationChannel.Mattermost]: translationKey(
    "No verified Mattermost account configured for notifications",
  ),
  [ComplianceNotificationChannel.Webhook]: translationKey(
    "No webhook configured for notifications",
  ),
};

/*
 * What a member's rule on a channel points at that can never page them: an
 * unverified method of theirs, or a custom channel that is off. A whole
 * term, article and all, so a language agrees "unverified" with the thing.
 * A webhook has nothing to verify, so it never is.
 */
export const UNUSABLE_TARGETS: Readonly<
  Partial<Record<ComplianceNotificationChannel, string>>
> = {
  [ComplianceNotificationChannel.Call]: translationKey(
    "an unverified phone number for calls",
  ),
  [ComplianceNotificationChannel.SMS]: translationKey(
    "an unverified phone number for SMS",
  ),
  [ComplianceNotificationChannel.Push]: translationKey(
    "an unverified push notification device",
  ),
  [ComplianceNotificationChannel.Email]: translationKey(
    "an unverified email address",
  ),
  [ComplianceNotificationChannel.WhatsApp]: translationKey(
    "an unverified WhatsApp number",
  ),
  [ComplianceNotificationChannel.Telegram]: translationKey(
    "an unverified Telegram account",
  ),
  [ComplianceNotificationChannel.Slack]: translationKey(
    "an unverified Slack account",
  ),
  [ComplianceNotificationChannel.MicrosoftTeams]: translationKey(
    "an unverified Microsoft Teams account",
  ),
  [ComplianceNotificationChannel.Mattermost]: translationKey(
    "an unverified Mattermost account",
  ),
  [ComplianceNotificationChannel.CustomChannel]: translationKey(
    "a custom channel that is turned off",
  ),
};

// Why a member fails an on-call rule, said of the rule's own subject.
interface OnCallFindingSentences {
  couldNotCheck: string;
  missingRules: string;
  noChannelRule: string;
  unusableChannelRule: string;
  refusedChannelRule: string;
  optedOut: string;
}

export const ON_CALL_FINDING_SENTENCES: Readonly<
  Partial<Record<ComplianceRuleType, OnCallFindingSentences>>
> = {
  [ComplianceRuleType.HasIncidentOnCallRules]: {
    couldNotCheck: translationKey(
      "Could not check incident notification rules for this user - they may no longer be a member of this project",
    ),
    missingRules: translationKey(
      "Missing notification rules for incident severities: {{severities}}",
    ),
    noChannelRule: translationKey(
      "No {{channel}} rule for incident severities: {{severities}}",
    ),
    unusableChannelRule: translationKey(
      "The {{channel}} rule for incident severities {{severities}} points at {{target}}",
    ),
    refusedChannelRule: translationKey(
      "The {{channel}} rule for incident severities {{severities}} is never sent, because another notification method on it belongs to a different user",
    ),
    optedOut: translationKey(
      "Opted out of incident notifications for: {{severities}}",
    ),
  },
  [ComplianceRuleType.HasAlertOnCallRules]: {
    couldNotCheck: translationKey(
      "Could not check alert notification rules for this user - they may no longer be a member of this project",
    ),
    missingRules: translationKey(
      "Missing notification rules for alert severities: {{severities}}",
    ),
    noChannelRule: translationKey(
      "No {{channel}} rule for alert severities: {{severities}}",
    ),
    unusableChannelRule: translationKey(
      "The {{channel}} rule for alert severities {{severities}} points at {{target}}",
    ),
    refusedChannelRule: translationKey(
      "The {{channel}} rule for alert severities {{severities}} is never sent, because another notification method on it belongs to a different user",
    ),
    optedOut: translationKey(
      "Opted out of alert notifications for: {{severities}}",
    ),
  },
  [ComplianceRuleType.HasIncidentEpisodeOnCallRules]: {
    couldNotCheck: translationKey(
      "Could not check incident episode notification rules for this user - they may no longer be a member of this project",
    ),
    missingRules: translationKey(
      "Missing notification rules for incident episode severities: {{severities}}",
    ),
    noChannelRule: translationKey(
      "No {{channel}} rule for incident episode severities: {{severities}}",
    ),
    unusableChannelRule: translationKey(
      "The {{channel}} rule for incident episode severities {{severities}} points at {{target}}",
    ),
    refusedChannelRule: translationKey(
      "The {{channel}} rule for incident episode severities {{severities}} is never sent, because another notification method on it belongs to a different user",
    ),
    optedOut: translationKey(
      "Opted out of incident episode notifications for: {{severities}}",
    ),
  },
  [ComplianceRuleType.HasAlertEpisodeOnCallRules]: {
    couldNotCheck: translationKey(
      "Could not check alert episode notification rules for this user - they may no longer be a member of this project",
    ),
    missingRules: translationKey(
      "Missing notification rules for alert episode severities: {{severities}}",
    ),
    noChannelRule: translationKey(
      "No {{channel}} rule for alert episode severities: {{severities}}",
    ),
    unusableChannelRule: translationKey(
      "The {{channel}} rule for alert episode severities {{severities}} points at {{target}}",
    ),
    refusedChannelRule: translationKey(
      "The {{channel}} rule for alert episode severities {{severities}} is never sent, because another notification method on it belongs to a different user",
    ),
    optedOut: translationKey(
      "Opted out of alert episode notifications for: {{severities}}",
    ),
  },
};

/*
 * What ends one of a member's findings on a rule before the next, as the
 * server joins them: "No Call rule for ... . Opted out of ...". Each
 * finding is a whole sentence of the language; this is only its full stop
 * - the ideographic one in Chinese and Japanese, the danda in Hindi.
 */
const SENTENCE_BREAKS: Readonly<Record<string, string>> = {
  ja: "。",
  zh: "。",
  hi: "। ",
};

const getSentenceBreak: (language: string) => string = (
  language: string,
): string => {
  return SENTENCE_BREAKS[(language || "").split("-")[0]!.toLowerCase()] ?? ". ";
};

/*
 * A severity's name as a sentence takes it. The server writes the name it
 * stored (or the id, for one without a name); the Dashboard hands one that
 * reads a default name in the reader's words (recordNameInSentence).
 */
export type SeverityInSentence = (
  severity: TeamComplianceSeverityJSON,
) => TemplateValue;

const SEVERITY_AS_STORED: SeverityInSentence = (
  severity: TeamComplianceSeverityJSON,
): TemplateValue => {
  return severity.name || severity.id;
};

const channelTerm: (
  channel: ComplianceNotificationChannel | undefined,
) => TemplateValue = (
  channel: ComplianceNotificationChannel | undefined,
): TemplateValue => {
  const label: string | undefined =
    ComplianceRule.getChannelDefinition(channel)?.label;

  // As the channel is named on its own: "Call", "Custom channel".
  return label ? translatableTerm(label) : channel || "";
};

// The severities, with the sentence's own list separator: "Critical, Major".
const severitiesValue: (
  severities: Array<TeamComplianceSeverityJSON> | undefined,
  severityInSentence: SeverityInSentence,
) => TemplateValue = (
  severities: Array<TeamComplianceSeverityJSON> | undefined,
  severityInSentence: SeverityInSentence,
): TemplateValue => {
  const values: Array<TemplateValue> = (severities || []).map(
    severityInSentence,
  );

  return composedValue((sentence: Translator): string => {
    return values
      .map((value: TemplateValue): string => {
        return getValueInSentence(value, sentence);
      })
      .join(getListSeparator(sentence.language));
  });
};

/*
 * What is wrong with a rule, in the translator's language: English, word
 * for word as the server has always said it, when no translator is given.
 */
export const getComplianceWarningText: (
  warning: TeamComplianceWarningJSON,
  translator?: Translator,
) => string = (
  warning: TeamComplianceWarningJSON,
  translator: Translator = ENGLISH,
): string => {
  if (warning.kind === TeamComplianceWarningKind.ChannelsSwitchedOff) {
    const channels: Array<ComplianceNotificationChannel> =
      ComplianceRule.normaliseChannels(warning.channels);

    if (channels.length <= 1) {
      return translator.translateTemplate(ONE_CHANNEL_SWITCHED_OFF, {
        channel: channelTerm(channels[0]),
      });
    }

    return translator.translateTemplate(CHANNELS_SWITCHED_OFF, {
      channels: composedValue((sentence: Translator): string => {
        return joinAsProse(
          channels.map((channel: ComplianceNotificationChannel): string => {
            return ComplianceRule.getChannelLabel(channel, sentence);
          }),
          sentence,
        );
      }),
    });
  }

  const sentence: string | undefined = WARNING_SENTENCES[warning.kind];

  return sentence ? translator.translateText(sentence) || sentence : "";
};

/*
 * One finding about a member on a rule, as a sentence of the rule's
 * subject, in the translator's language. Empty for a finding this
 * Dashboard does not know - the page then draws the server's English.
 */
export const getComplianceFindingText: (
  finding: TeamComplianceFindingJSON,
  ruleType: ComplianceRuleType | string,
  translator?: Translator,
  severityInSentence?: SeverityInSentence,
) => string = (
  finding: TeamComplianceFindingJSON,
  ruleType: ComplianceRuleType | string,
  translator: Translator = ENGLISH,
  severityInSentence: SeverityInSentence = SEVERITY_AS_STORED,
): string => {
  if (finding.kind === TeamComplianceFindingKind.MethodMissing) {
    const sentence: string | undefined = finding.channel
      ? METHOD_MISSING_SENTENCES[finding.channel]
      : undefined;

    return sentence ? translator.translateText(sentence) || sentence : "";
  }

  const sentences: OnCallFindingSentences | undefined =
    ON_CALL_FINDING_SENTENCES[ruleType as ComplianceRuleType];

  if (!sentences) {
    return "";
  }

  const severities: TemplateValue = severitiesValue(
    finding.severities,
    severityInSentence,
  );

  switch (finding.kind) {
    case TeamComplianceFindingKind.CouldNotCheck:
      return translator.translateText(sentences.couldNotCheck) || "";
    case TeamComplianceFindingKind.MissingRules:
      return translator.translateTemplate(sentences.missingRules, {
        severities: severities,
      });
    case TeamComplianceFindingKind.NoChannelRule:
      return translator.translateTemplate(sentences.noChannelRule, {
        channel: channelTerm(finding.channel),
        severities: severities,
      });
    case TeamComplianceFindingKind.UnusableChannelRule: {
      const target: string | undefined = finding.channel
        ? UNUSABLE_TARGETS[finding.channel]
        : undefined;

      return translator.translateTemplate(sentences.unusableChannelRule, {
        channel: channelTerm(finding.channel),
        severities: severities,
        target: target ? translatableTerm(target, { inSentence: true }) : "",
      });
    }
    case TeamComplianceFindingKind.RefusedChannelRule:
      return translator.translateTemplate(sentences.refusedChannelRule, {
        channel: channelTerm(finding.channel),
        severities: severities,
      });
    case TeamComplianceFindingKind.OptedOut:
      return translator.translateTemplate(sentences.optedOut, {
        severities: severities,
      });
    default:
      return "";
  }
};

/*
 * Why a member fails a rule: its findings one after another, as the server
 * says them in English. Empty when one of them is a finding this Dashboard
 * does not know, so the page draws the server's own English instead of a
 * reason with a piece missing.
 */
export const getComplianceReasonText: (
  findings: Array<TeamComplianceFindingJSON>,
  ruleType: ComplianceRuleType | string,
  translator?: Translator,
  severityInSentence?: SeverityInSentence,
) => string = (
  findings: Array<TeamComplianceFindingJSON>,
  ruleType: ComplianceRuleType | string,
  translator: Translator = ENGLISH,
  severityInSentence: SeverityInSentence = SEVERITY_AS_STORED,
): string => {
  const sentences: Array<string> = findings.map(
    (finding: TeamComplianceFindingJSON): string => {
      return getComplianceFindingText(
        finding,
        ruleType,
        translator,
        severityInSentence,
      );
    },
  );

  if (sentences.length === 0 || sentences.includes("")) {
    return "";
  }

  return sentences.join(getSentenceBreak(translator.language));
};
