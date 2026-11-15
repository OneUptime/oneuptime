import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import Dictionary from "Common/Types/Dictionary";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import { getSettingsPageForRuleType } from "@oneuptime/dashboard/Components/OnCallPolicy/Readiness/ReadinessTypes";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
  getValueInSentence,
  joinAsProse,
} from "Common/Types/Team/ComplianceRule";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import type {
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceSeverityJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";
import {
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  TemplateValue,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import { recordNameInSentence } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * Everything the Teams > Compliance page decides, as plain functions over the
 * status payload - which verdict to show, how a rule reads, which members a
 * filter keeps, where a member goes to fix themselves. The components only
 * draw what these return, so the decisions are testable without rendering
 * anything and cannot drift between the hero, the rules card and the members
 * section, which all read the same payload.
 *
 * The wire types are type-only imports of the shared contract
 * (Common/Types/Team/TeamComplianceStatus), the same file the server builds
 * its response from: a field renamed there breaks this build instead of
 * quietly rendering blanks.
 *
 * Every sentence the page reads is written here with the reader's
 * Translator (#8296, #8461): each is one whole key - a count picks its
 * language's form (translatePlural), a name or a rule's title goes in as a
 * value - so a German page reads German from the verdict to the last
 * member's line. Called without one (a unit test), each writes English, as
 * the page always did. What the server words itself - a rule's warnings,
 * why a member fails a rule - arrives in English and is drawn as it came.
 */

// The language of a caller that hands no translator: English, word for word.
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

export const CHANNEL_ICONS: Record<ComplianceNotificationChannel, IconProp> = {
  [ComplianceNotificationChannel.Call]: IconProp.Call,
  [ComplianceNotificationChannel.SMS]: IconProp.SMS,
  [ComplianceNotificationChannel.Push]: IconProp.DevicePhoneMobile,
  [ComplianceNotificationChannel.Email]: IconProp.Email,
  [ComplianceNotificationChannel.WhatsApp]: IconProp.WhatsApp,
  [ComplianceNotificationChannel.Telegram]: IconProp.Telegram,
  [ComplianceNotificationChannel.Slack]: IconProp.Slack,
  [ComplianceNotificationChannel.MicrosoftTeams]: IconProp.MicrosoftTeams,
  [ComplianceNotificationChannel.Mattermost]: IconProp.Mattermost,
  [ComplianceNotificationChannel.Webhook]: IconProp.Webhook,
  // A channel the server's admin added (#5332), not one of the member's own.
  [ComplianceNotificationChannel.CustomChannel]: IconProp.PuzzlePiece,
};

// The icons the rest of the Dashboard already uses for these four surfaces.
const ON_CALL_RULE_ICONS: Partial<Record<ComplianceRuleType, IconProp>> = {
  [ComplianceRuleType.HasIncidentOnCallRules]: IconProp.Alert,
  [ComplianceRuleType.HasAlertOnCallRules]: IconProp.ExclaimationCircle,
  [ComplianceRuleType.HasIncidentEpisodeOnCallRules]: IconProp.SquareStack3D,
  [ComplianceRuleType.HasAlertEpisodeOnCallRules]: IconProp.SquareStack3D,
};

/*
 * The channels a project can switch off in Project Settings > Notification
 * Settings. A rule on one of these can be unsatisfiable for reasons no member
 * can fix, which is what the server's rule warnings say - and why the page
 * links to that settings page when one of them is involved. The same list as
 * the server's PROJECT_CHANNEL_SWITCHES.
 *
 * Call, SMS and Telegram: switched off, nobody is notified that way. WhatsApp:
 * switched off, nobody can ADD a WhatsApp number - which is the only way to
 * meet a WhatsApp rule - so it is fixed on the same settings page.
 */
export const PROJECT_SWITCHED_CHANNELS: ReadonlyArray<ComplianceNotificationChannel> =
  [
    ComplianceNotificationChannel.Call,
    ComplianceNotificationChannel.SMS,
    ComplianceNotificationChannel.WhatsApp,
    ComplianceNotificationChannel.Telegram,
  ];

export type RuleIdentity = Pick<
  TeamComplianceRuleJSON,
  "ruleType" | "notificationChannels"
>;

export const pluralize: (
  count: number,
  singular: string,
  plural?: string,
) => string = (count: number, singular: string, plural?: string): string => {
  return count === 1 ? singular : plural || `${singular}s`;
};

// "1 rule", "3 rules".
export const countOf: (
  count: number,
  singular: string,
  plural?: string,
) => string = (count: number, singular: string, plural?: string): string => {
  return `${count} ${pluralize(count, singular, plural)}`;
};

export const isRuleKnown: (rule: RuleIdentity) => boolean = (
  rule: RuleIdentity,
): boolean => {
  return ComplianceRule.isKnownRuleType(rule.ruleType);
};

/*
 * An on-call rule whose every selected severity has since been deleted. The
 * server pauses such a rule - it checks nothing until an admin picks new
 * severities - and sends it with no severities and appliesToAllSeverities
 * false. No other rule has that shape: an on-call rule that was scoped to no
 * severities applies to every severity, and says so.
 *
 * It must never read as an "every severity" rule. It is not one, a team can
 * hold a real one of the same type and channels beside it, and turning it
 * back on as it stands would only make a copy of that rule.
 */
export const hasNoSeveritiesLeft: (rule: TeamComplianceRuleJSON) => boolean = (
  rule: TeamComplianceRuleJSON,
): boolean => {
  return (
    ComplianceRule.supportsSeverityScope(rule.ruleType) &&
    !rule.appliesToAllSeverities &&
    rule.severities.length === 0
  );
};

// The scope chip of a rule that has no severities left.
export const NO_SEVERITIES_LEFT_LABEL: string =
  translationKey("No severities left");

/*
 * What the page says about a rule with no severities left when the server did
 * not say it itself - the server's own warning, word for word.
 */
export const NO_SEVERITIES_LEFT_WARNING: string = translationKey(
  "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.",
);

// A rule on no channel in particular: any channel meets it.
export const ANY_CHANNEL: string = translationKey("Any channel");

// The scope of a rule whose every severity has since been deleted.
const DELETED_SEVERITIES: string = translationKey(
  "severities that have since been deleted",
);

/*
 * The channels of an on-call rule that members are not checked on, because
 * no page can go out on them on this server right now - the custom channel,
 * while custom channels are not part of the license or none is turned on.
 * The server says which (channelsNotChecked) and why, in the rule's
 * warnings; an older server says none.
 */
export const getChannelsNotChecked: (
  rule: TeamComplianceRuleJSON,
) => Array<ComplianceNotificationChannel> = (
  rule: TeamComplianceRuleJSON,
): Array<ComplianceNotificationChannel> => {
  return ComplianceRule.normaliseChannels(rule.channelsNotChecked);
};

/*
 * An on-call rule that insists on channels, not one of which members can be
 * checked on right now: a rule on the custom channel alone, while no custom
 * channel can carry a page. The server checks nobody against it and says
 * why. It is on, and nothing a member does changes that - only the server's
 * custom channels can - so it is neither failing nor passing, and not
 * paused either.
 */
export const hasNoChannelToCheck: (rule: TeamComplianceRuleJSON) => boolean = (
  rule: TeamComplianceRuleJSON,
): boolean => {
  if (!ComplianceRule.supportsChannel(rule.ruleType)) {
    return false;
  }

  const channels: Array<ComplianceNotificationChannel> = getRuleChannels(rule);
  const notChecked: Array<ComplianceNotificationChannel> =
    getChannelsNotChecked(rule);

  return (
    channels.length > 0 &&
    channels.every((channel: ComplianceNotificationChannel): boolean => {
      return notChecked.includes(channel);
    })
  );
};

/*
 * A rule members are actually measured against. A paused rule is listed but
 * not checked, and a rule whose type this build does not recognise is not
 * checked either (the server passes every member on it and says so in a
 * warning), nor is one with no severities left, whatever its switch says, nor
 * one with no channel members can be checked on right now - so none of them
 * may count towards the verdict.
 */
export const isRuleActive: (rule: TeamComplianceRuleJSON) => boolean = (
  rule: TeamComplianceRuleJSON,
): boolean => {
  return (
    rule.enabled &&
    isRuleKnown(rule) &&
    !hasNoSeveritiesLeft(rule) &&
    !hasNoChannelToCheck(rule)
  );
};

export const getActiveRules: (
  rules: Array<TeamComplianceRuleJSON>,
) => Array<TeamComplianceRuleJSON> = (
  rules: Array<TeamComplianceRuleJSON>,
): Array<TeamComplianceRuleJSON> => {
  return rules.filter((rule: TeamComplianceRuleJSON): boolean => {
    return isRuleActive(rule);
  });
};

export const getRuleTypeIcon: (ruleType: string) => IconProp = (
  ruleType: string,
): IconProp => {
  const definition: ComplianceRuleDefinition | undefined =
    ComplianceRule.getDefinition(ruleType);

  if (!definition) {
    return IconProp.ShieldExclamation;
  }

  if (definition.methodChannel) {
    return CHANNEL_ICONS[definition.methodChannel];
  }

  return ON_CALL_RULE_ICONS[definition.ruleType] || IconProp.BellRinging;
};

/*
 * The channels a rule is about, in catalog order: the method channel of a
 * method rule, or every channel an on-call rule insists on. Empty for "any
 * channel" and for rule types this build does not know.
 */
export const getRuleChannels: (
  rule: RuleIdentity,
) => Array<ComplianceNotificationChannel> = (
  rule: RuleIdentity,
): Array<ComplianceNotificationChannel> => {
  const definition: ComplianceRuleDefinition | undefined =
    ComplianceRule.getDefinition(rule.ruleType);

  if (!definition) {
    return [];
  }

  if (definition.category === ComplianceRuleCategory.NotificationMethod) {
    return definition.methodChannel ? [definition.methodChannel] : [];
  }

  return ComplianceRule.normaliseChannels(rule.notificationChannels);
};

/*
 * A rule on one channel wears that channel; a rule on several, or on any
 * channel, wears its kind - no one channel stands for it (its channel chips
 * show them all).
 */
export const getRuleIcon: (rule: RuleIdentity) => IconProp = (
  rule: RuleIdentity,
): IconProp => {
  const channels: Array<ComplianceNotificationChannel> = getRuleChannels(rule);

  if (channels.length === 1) {
    return CHANNEL_ICONS[channels[0]!];
  }

  return getRuleTypeIcon(rule.ruleType);
};

// A channel's chip: its name, or "Any channel", in the reader's words.
export const getChannelLabel: (
  channel: ComplianceNotificationChannel | null | undefined,
  translator?: Translator,
) => string = (
  channel: ComplianceNotificationChannel | null | undefined,
  translator: Translator = ENGLISH,
): string => {
  if (!ComplianceRule.getChannelDefinition(channel)) {
    return translator.translateText(ANY_CHANNEL) || ANY_CHANNEL;
  }

  return ComplianceRule.getChannelLabel(channel, translator);
};

export const getRuleTitle: (
  rule: RuleIdentity,
  translator?: Translator,
) => string = (
  rule: RuleIdentity,
  translator: Translator = ENGLISH,
): string => {
  return ComplianceRule.getTitle(
    {
      ruleType: rule.ruleType,
      notificationChannels: rule.notificationChannels,
    },
    translator,
  );
};

/*
 * The list a rule's severities belong to: a default name in it ("Critical
 * Incident") is OneUptime's and reads in the reader's language, a name the
 * project gave its severity reads as written (Common/Utils/DefaultRecordNames).
 */
export const getSeverityList: (
  rule: Pick<TeamComplianceRuleJSON, "ruleType" | "severityKind">,
) => StateListType = (
  rule: Pick<TeamComplianceRuleJSON, "ruleType" | "severityKind">,
): StateListType => {
  return (rule.severityKind ||
    ComplianceRule.getSeverityKind(rule.ruleType)) ===
    ComplianceSeverityKind.Alert
    ? StateListType.AlertSeverity
    : StateListType.IncidentSeverity;
};

/*
 * A severity's name as a sentence takes it: by its list, so a default name
 * takes the sentence's language and a project's name reads as written. One
 * that arrived without a name reads as its id.
 */
const getSeverityInSentence: (
  rule: TeamComplianceRuleJSON,
  severity: TeamComplianceSeverityJSON,
) => TemplateValue = (
  rule: TeamComplianceRuleJSON,
  severity: TeamComplianceSeverityJSON,
): TemplateValue => {
  if (!severity.name) {
    return severity.id;
  }

  return recordNameInSentence(getSeverityList(rule), severity.name);
};

/*
 * The rule as the sentence a reviewer reads. An on-call rule scoped to no
 * severities reads as "every severity", which is what the server enforces.
 * A rule whose selected severities have all since been deleted says so rather
 * than claiming every severity: it checks none.
 */
export const getRuleSentence: (
  rule: TeamComplianceRuleJSON,
  translator?: Translator,
) => string = (
  rule: TeamComplianceRuleJSON,
  translator: Translator = ENGLISH,
): string => {
  let severityNames: Array<TemplateValue> = rule.severities.map(
    (severity: TeamComplianceSeverityJSON): TemplateValue => {
      return getSeverityInSentence(rule, severity);
    },
  );

  if (rule.appliesToAllSeverities) {
    severityNames = [];
  } else if (hasNoSeveritiesLeft(rule)) {
    severityNames = [translatableTerm(DELETED_SEVERITIES)];
  }

  return ComplianceRule.describe(
    {
      ruleType: rule.ruleType,
      notificationChannels: rule.notificationChannels,
      severityNames: severityNames,
    },
    translator,
  );
};

// The scope chip of a rule on every severity of its kind: English, a key.
export const getAllSeveritiesLabel: (
  kind: ComplianceSeverityKind | null | undefined,
) => string = (kind: ComplianceSeverityKind | null | undefined): string => {
  return kind === ComplianceSeverityKind.Alert
    ? translationKey("All alert severities")
    : translationKey("All incident severities");
};

/*
 * A rule's name with its scope, each shape one sentence: "{{title}} (no
 * severities left)", "{{title}} (all alert severities)".
 */
const RULE_LABEL_NO_SEVERITIES_LEFT: string = translationKey(
  "{{title}} (no severities left)",
);

const RULE_LABEL_ALL_ALERT_SEVERITIES: string = translationKey(
  "{{title}} (all alert severities)",
);

const RULE_LABEL_ALL_INCIDENT_SEVERITIES: string = translationKey(
  "{{title}} (all incident severities)",
);

const RULE_LABEL_WITH_SEVERITIES: string = translationKey(
  "{{title}} ({{severities}})",
);

/*
 * The rule's name wherever it has to be told apart from every other rule on
 * its own: a switch's or a button's accessible name, the delete confirmation,
 * a warning line, the "Failing ..." chip, a member's result square. A team may
 * hold several rules of one type on the same channels - Call for Critical
 * incidents and Call for Major incidents - and the title alone names them all
 * alike, so an on-call rule's name carries its severity scope: "Call for
 * incidents (Critical Incident)", "Incident on-call rules (all incident
 * severities)", "Call for incidents (no severities left)" - the last never
 * named like the team's every-severity rule of the same type and channels.
 * The rules card's heading stays the short title; the sentence and the scope
 * chips under it already say the rest.
 */
export const getRuleLabel: (
  rule: TeamComplianceRuleJSON,
  translator?: Translator,
) => string = (
  rule: TeamComplianceRuleJSON,
  translator: Translator = ENGLISH,
): string => {
  if (!ComplianceRule.supportsSeverityScope(rule.ruleType)) {
    return getRuleTitle(rule, translator);
  }

  // The title in the language of the sentence it is put into.
  const title: TemplateValue = composedValue((sentence: Translator): string => {
    return getRuleTitle(rule, sentence);
  });

  if (hasNoSeveritiesLeft(rule)) {
    return translator.translateTemplate(RULE_LABEL_NO_SEVERITIES_LEFT, {
      title: title,
    });
  }

  if (rule.appliesToAllSeverities || rule.severities.length === 0) {
    return translator.translateTemplate(
      getSeverityList(rule) === StateListType.AlertSeverity
        ? RULE_LABEL_ALL_ALERT_SEVERITIES
        : RULE_LABEL_ALL_INCIDENT_SEVERITIES,
      { title: title },
    );
  }

  return translator.translateTemplate(RULE_LABEL_WITH_SEVERITIES, {
    title: title,
    severities: composedValue((sentence: Translator): string => {
      return joinAsProse(
        rule.severities.map((severity: TeamComplianceSeverityJSON): string => {
          return getValueInSentence(
            getSeverityInSentence(rule, severity),
            sentence,
          );
        }),
        sentence,
      );
    }),
  });
};

/*
 * A rule's pass rate as the page states it. `total` is 0 for a paused or
 * unrecognised rule - neither is evaluated - and for a team with no members.
 */
export interface RulePassRate {
  passing: number;
  failing: number;
  total: number;
  passingPercent: number;
}

export const getRulePassRate: (rule: TeamComplianceRuleJSON) => RulePassRate = (
  rule: TeamComplianceRuleJSON,
): RulePassRate => {
  const passing: number = Math.max(0, rule.compliantCount);
  const failing: number = Math.max(0, rule.nonCompliantCount);
  const total: number = passing + failing;

  return {
    passing: passing,
    failing: failing,
    total: total,
    passingPercent: total === 0 ? 0 : Math.round((passing / total) * 100),
  };
};

/*
 * A rule's pass rate in words: "All 5 meet it", "2 of 3 members meet it",
 * "1 of 1 member meets it" - one sentence, its count's form in the reader's
 * language. `label` says the same for the bar's accessible name. Only
 * meaningful when `total` > 0.
 */
export interface RulePassRateText {
  text: string;
  label: string;
}

const EVERY_MEMBER_MEETS_IT: PluralTemplate = {
  one: "All {{count}} meet it",
  other: "All {{count}} meet it",
};

const EVERY_MEMBER_MEETS_THIS_RULE: PluralTemplate = {
  one: "All {{count}} meet this rule",
  other: "All {{count}} meet this rule",
};

const MEMBERS_MEET_IT: PluralTemplate = {
  one: "{{passing}} of {{count}} member meets it",
  other: "{{passing}} of {{count}} members meet it",
};

const MEMBERS_MEET_THIS_RULE: PluralTemplate = {
  one: "{{passing}} of {{count}} member meets this rule",
  other: "{{passing}} of {{count}} members meet this rule",
};

export const getRulePassRateText: (
  rate: RulePassRate,
  translator?: Translator,
) => RulePassRateText = (
  rate: RulePassRate,
  translator: Translator = ENGLISH,
): RulePassRateText => {
  if (rate.failing === 0 && rate.total > 1) {
    return {
      text: translator.translatePlural(EVERY_MEMBER_MEETS_IT, rate.total),
      label: translator.translatePlural(
        EVERY_MEMBER_MEETS_THIS_RULE,
        rate.total,
      ),
    };
  }

  const values: { passing: string } = {
    passing: translator.formatNumber(rate.passing),
  };

  return {
    text: translator.translatePlural(MEMBERS_MEET_IT, rate.total, values),
    label: translator.translatePlural(
      MEMBERS_MEET_THIS_RULE,
      rate.total,
      values,
    ),
  };
};

export interface ComplianceSummary {
  memberCount: number;
  /*
   * People invited to the team who have not accepted yet: not members, so
   * not checked (TeamComplianceStatusJSON.invitedMemberCount).
   */
  invitedCount: number;
  compliantCount: number;
  attentionCount: number;
  ruleCount: number;
  activeRuleCount: number;
  // Every rule that is switched off, whatever else is true of it.
  pausedRuleCount: number;
  /*
   * The paused rules that turning on would actually check someone against:
   * of a type this build knows, and with severities left to check.
   */
  resumableRuleCount: number;
  /*
   * Rules whose every severity has been deleted: paused, and nothing to
   * check until they are edited to choose new severities, whatever their
   * switch says (see hasNoSeveritiesLeft).
   */
  noSeveritiesLeftRuleCount: number;
  /*
   * Rules of a type this build does not recognise, switched on or off: listed,
   * never checked - and turning one on changes nothing.
   */
  unrecognisedRuleCount: number;
  /*
   * Rules that are on but have no channel members can be checked on right
   * now (see hasNoChannelToCheck): not checked until a custom channel can
   * carry a page, or the rule asks for another channel.
   */
  noChannelToCheckRuleCount: number;
}

export const summarizeCompliance: (
  status: TeamComplianceStatusJSON,
) => ComplianceSummary = (
  status: TeamComplianceStatusJSON,
): ComplianceSummary => {
  const rules: Array<TeamComplianceRuleJSON> = status.complianceSettings;
  const compliantCount: number = status.userComplianceStatuses.filter(
    (member: TeamMemberComplianceJSON): boolean => {
      return member.isCompliant;
    },
  ).length;
  const countRules: (
    matches: (rule: TeamComplianceRuleJSON) => boolean,
  ) => number = (
    matches: (rule: TeamComplianceRuleJSON) => boolean,
  ): number => {
    return rules.filter(matches).length;
  };

  return {
    memberCount: status.userComplianceStatuses.length,
    invitedCount: Math.max(0, Math.floor(status.invitedMemberCount || 0)),
    compliantCount: compliantCount,
    attentionCount: status.userComplianceStatuses.length - compliantCount,
    ruleCount: rules.length,
    activeRuleCount: getActiveRules(rules).length,
    pausedRuleCount: countRules((rule: TeamComplianceRuleJSON): boolean => {
      return !rule.enabled;
    }),
    resumableRuleCount: countRules((rule: TeamComplianceRuleJSON): boolean => {
      return !rule.enabled && isRuleKnown(rule) && !hasNoSeveritiesLeft(rule);
    }),
    noSeveritiesLeftRuleCount: countRules(hasNoSeveritiesLeft),
    unrecognisedRuleCount: countRules(
      (rule: TeamComplianceRuleJSON): boolean => {
        return !isRuleKnown(rule);
      },
    ),
    noChannelToCheckRuleCount: countRules(
      (rule: TeamComplianceRuleJSON): boolean => {
        return (
          rule.enabled &&
          isRuleKnown(rule) &&
          !hasNoSeveritiesLeft(rule) &&
          hasNoChannelToCheck(rule)
        );
      },
    ),
  };
};

/*
 * Why nothing is being checked when a team has rules but none is active, and
 * what to do about it. "Turn a rule on" is only advice where turning one on
 * would check somebody: not for a rule of a type this build does not
 * recognise (on or off, it is never checked), and not for a rule whose every
 * severity was deleted (it has nothing to check until it is edited). Shared
 * by the hero and the members section so the two can never disagree.
 */
export const areAllRulesPaused: (summary: ComplianceSummary) => boolean = (
  summary: ComplianceSummary,
): boolean => {
  return (
    summary.ruleCount > 0 && summary.resumableRuleCount === summary.ruleCount
  );
};

// "A, or B", "A, B, or C": the ways out, as one choice, each shape a key.
const CHOICE_LISTS: Readonly<Record<2 | 3 | 4, string>> = {
  2: translationKey("{{first}}, or {{second}}"),
  3: translationKey("{{first}}, {{second}}, or {{third}}"),
  4: translationKey("{{first}}, {{second}}, {{third}}, or {{fourth}}"),
};

const joinAsChoice: (items: Array<string>, translator: Translator) => string = (
  items: Array<string>,
  translator: Translator,
): string => {
  if (items.length <= 1) {
    return items[0] || "";
  }

  const [first, second, third, fourth] = items;
  const values: Record<string, string> = {
    first: first!,
    second: second!,
  };

  if (third !== undefined) {
    values["third"] = third;
  }

  if (fourth !== undefined) {
    values["fourth"] = fourth;
  }

  return translator.translateTemplate(
    CHOICE_LISTS[Math.min(items.length, 4) as 2 | 3 | 4],
    values,
  );
};

// The first letter as a sentence starts it, in a script that has capitals.
const capitalize: (text: string, language: string) => string = (
  text: string,
  language: string,
): string => {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
};

/*
 * Why nothing can be checked, when every rule of the team is in one of the
 * states below - one whole sentence for each, in the form its count takes:
 * "This team's rule ..." for one, "All 3 of this team's rules ..." for more.
 */
const ALL_UNRECOGNISED: PluralTemplate = {
  one: "This team's rule is of a type this version does not recognise, so it is not checked. Delete it and add a supported rule.",
  other:
    "All {{count}} of this team's rules are of a type this version does not recognise, so they are not checked. Delete them and add a supported rule.",
};

const ALL_WITHOUT_SEVERITIES: PluralTemplate = {
  one: "This team's rule has no severities left: every severity it was scoped to has been deleted. Edit it to choose new severities, or delete it.",
  other:
    "All {{count}} of this team's rules have no severities left: every severity they were scoped to has been deleted. Edit them to choose new severities, or delete them.",
};

const ALL_WITHOUT_A_CHANNEL: PluralTemplate = {
  one: "This team's rule asks only for channels that cannot carry a page on this server right now, so it is not checked. Its warning says why.",
  other:
    "All {{count}} of this team's rules ask only for channels that cannot carry a page on this server right now, so they are not checked. Their warnings say why.",
};

// When the rules are in more than one of those states: each state, then each way out.
const PAUSED_RULES: PluralTemplate = {
  one: "{{count}} rule is paused",
  other: "{{count}} rules are paused",
};

const RULES_WITHOUT_SEVERITIES: PluralTemplate = {
  one: "{{count}} rule has no severities left",
  other: "{{count}} rules have no severities left",
};

const UNRECOGNISED_RULES: PluralTemplate = {
  one: "{{count}} rule is of a type this version does not recognise",
  other: "{{count}} rules are of a type this version does not recognise",
};

const RULES_WITHOUT_A_CHANNEL: PluralTemplate = {
  one: "{{count}} rule asks only for channels that cannot carry a page right now",
  other:
    "{{count}} rules ask only for channels that cannot carry a page right now",
};

const TURN_A_PAUSED_RULE_ON: string = translationKey("turn a paused rule on");

const EDIT_THE_RULES_WITHOUT_SEVERITIES: PluralTemplate = {
  one: "edit the one with no severities left to choose new severities",
  other: "edit the ones with no severities left to choose new severities",
};

const REPLACE_THE_UNRECOGNISED_RULES: PluralTemplate = {
  one: "replace the unrecognised one",
  other: "replace the unrecognised ones",
};

const ADD_A_CHANNEL_TO_THE_RULES: PluralTemplate = {
  one: "add another channel to the one that cannot be checked",
  other: "add another channel to the ones that cannot be checked",
};

// The states, then the ways out: "{{states}}. {{choices}}."
const STATES_AND_CHOICES: string = translationKey("{{states}}. {{choices}}.");

export const TURN_A_RULE_ON: string = translationKey(
  "Turn a rule on to see who meets it.",
);

export const getNoActiveRulesAdvice: (
  summary: ComplianceSummary,
  translator?: Translator,
) => string = (
  summary: ComplianceSummary,
  translator: Translator = ENGLISH,
): string => {
  const resumable: number = summary.resumableRuleCount;
  const noSeveritiesLeft: number = summary.noSeveritiesLeftRuleCount;
  const unrecognised: number = summary.unrecognisedRuleCount;
  const noChannel: number = summary.noChannelToCheckRuleCount;

  if (
    resumable === 0 &&
    noSeveritiesLeft === 0 &&
    unrecognised === 0 &&
    noChannel === 0
  ) {
    return translator.translateText(TURN_A_RULE_ON) || TURN_A_RULE_ON;
  }

  if (resumable === 0 && noSeveritiesLeft === 0 && noChannel === 0) {
    return translator.translatePlural(ALL_UNRECOGNISED, unrecognised);
  }

  if (resumable === 0 && unrecognised === 0 && noChannel === 0) {
    return translator.translatePlural(ALL_WITHOUT_SEVERITIES, noSeveritiesLeft);
  }

  if (resumable === 0 && noSeveritiesLeft === 0 && unrecognised === 0) {
    return translator.translatePlural(ALL_WITHOUT_A_CHANNEL, noChannel);
  }

  // Each piece in the language of the sentence it is put into.
  const states: (sentence: Translator) => Array<string> = (
    sentence: Translator,
  ): Array<string> => {
    const words: Array<string> = [];

    if (resumable > 0) {
      words.push(sentence.translatePlural(PAUSED_RULES, resumable));
    }

    if (noSeveritiesLeft > 0) {
      words.push(
        sentence.translatePlural(RULES_WITHOUT_SEVERITIES, noSeveritiesLeft),
      );
    }

    if (unrecognised > 0) {
      words.push(sentence.translatePlural(UNRECOGNISED_RULES, unrecognised));
    }

    if (noChannel > 0) {
      words.push(sentence.translatePlural(RULES_WITHOUT_A_CHANNEL, noChannel));
    }

    return words;
  };

  const choices: (sentence: Translator) => Array<string> = (
    sentence: Translator,
  ): Array<string> => {
    const words: Array<string> = [];

    if (resumable > 0) {
      words.push(
        sentence.translateText(TURN_A_PAUSED_RULE_ON) || TURN_A_PAUSED_RULE_ON,
      );
    }

    if (noSeveritiesLeft > 0) {
      words.push(
        sentence.translatePlural(
          EDIT_THE_RULES_WITHOUT_SEVERITIES,
          noSeveritiesLeft,
        ),
      );
    }

    if (unrecognised > 0) {
      words.push(
        sentence.translatePlural(REPLACE_THE_UNRECOGNISED_RULES, unrecognised),
      );
    }

    if (noChannel > 0) {
      words.push(
        sentence.translatePlural(ADD_A_CHANNEL_TO_THE_RULES, noChannel),
      );
    }

    return words;
  };

  return translator.translateTemplate(STATES_AND_CHOICES, {
    states: composedValue((sentence: Translator): string => {
      return capitalize(
        joinAsProse(states(sentence), sentence),
        sentence.language,
      );
    }),
    choices: composedValue((sentence: Translator): string => {
      return capitalize(
        joinAsChoice(choices(sentence), sentence),
        sentence.language,
      );
    }),
  });
};

const INVITED_NOTE: PluralTemplate = {
  one: "{{count}} person invited to this team is not checked until they accept their invitation.",
  other:
    "{{count}} people invited to this team are not checked until they accept their invitation.",
};

/*
 * Why people invited to the team are not listed or counted, in one sentence:
 * nothing reaches them through the team until they accept, so there is
 * nothing to check yet. Empty when nobody is waiting.
 */
export const getInvitedNote: (
  invitedCount: number,
  translator?: Translator,
) => string = (
  invitedCount: number,
  translator: Translator = ENGLISH,
): string => {
  if (invitedCount <= 0) {
    return "";
  }

  return translator.translatePlural(INVITED_NOTE, invitedCount);
};

export enum ComplianceVerdictKind {
  NoRules = "NoRules",
  NoActiveRules = "NoActiveRules",
  NoMembers = "NoMembers",
  AllCompliant = "AllCompliant",
  NeedsAttention = "NeedsAttention",
}

export interface ComplianceVerdict {
  kind: ComplianceVerdictKind;
  // Each in the reader's words already: drawn as given, never looked up again.
  badgeText: string;
  headline: string;
  detail: string;
}

const NO_ACTIVE_RULES: string = translationKey("No active rules");

const EVERY_RULE_PAUSED: PluralTemplate = {
  one: "All {{count}} rules are paused",
  other: "All {{count}} rules are paused",
};

const NEED_ATTENTION: PluralTemplate = {
  one: "{{count}} needs attention",
  other: "{{count}} need attention",
};

const EVERY_MEMBER_MEETS_EVERY_RULE: PluralTemplate = {
  one: "All {{count}} members meet every rule",
  other: "All {{count}} members meet every rule",
};

const NO_MEMBER_MEETS_EVERY_RULE: PluralTemplate = {
  one: "None of the {{count}} members meet every rule",
  other: "None of the {{count}} members meet every rule",
};

const SOME_MEMBERS_MEET_EVERY_RULE: PluralTemplate = {
  one: "{{compliant}} of {{count}} member meets every rule",
  other: "{{compliant}} of {{count}} members meet every rule",
};

const NOBODY_IS_CHECKED: string = translationKey(
  "Nobody is being checked right now. {{advice}}",
);

/*
 * The one-line answer at the top of the page. "All compliant" is only ever
 * claimed over at least one active rule and at least one member: a team with
 * nothing checked, or nobody to check, gets a neutral answer that says so
 * rather than a green one it has not earned.
 *
 * A count of one that means "the only one" is a sentence of its own, never
 * a plural's "one" form: Russian reads 21 by that form.
 */
export const getComplianceVerdict: (
  summary: ComplianceSummary,
  translator?: Translator,
) => ComplianceVerdict = (
  summary: ComplianceSummary,
  translator: Translator = ENGLISH,
): ComplianceVerdict => {
  const text: (english: string) => string = (english: string): string => {
    return translator.translateText(english) || english;
  };

  if (summary.ruleCount === 0) {
    return {
      kind: ComplianceVerdictKind.NoRules,
      badgeText: text(NO_ACTIVE_RULES),
      headline: text(translationKey("Nothing is being checked yet")),
      detail: text(
        translationKey(
          "Add a rule to say what everyone on this team must set up to be reachable - for example, a phone call for critical incidents.",
        ),
      ),
    };
  }

  if (summary.activeRuleCount === 0) {
    let headline: string = text(translationKey("No rule is being checked"));

    if (areAllRulesPaused(summary)) {
      headline =
        summary.ruleCount === 1
          ? text(translationKey("The only rule is paused"))
          : translator.translatePlural(EVERY_RULE_PAUSED, summary.ruleCount);
    }

    return {
      kind: ComplianceVerdictKind.NoActiveRules,
      badgeText: text(NO_ACTIVE_RULES),
      headline: headline,
      detail: translator.translateTemplate(NOBODY_IS_CHECKED, {
        advice: composedValue((sentence: Translator): string => {
          return areAllRulesPaused(summary)
            ? sentence.translateText(TURN_A_RULE_ON) || TURN_A_RULE_ON
            : getNoActiveRulesAdvice(summary, sentence);
        }),
      }),
    };
  }

  if (summary.memberCount === 0) {
    return {
      kind: ComplianceVerdictKind.NoMembers,
      badgeText: text(translationKey("No members")),
      headline: text(translationKey("This team has no members to check")),
      detail:
        summary.invitedCount > 0
          ? getInvitedNote(summary.invitedCount, translator)
          : text(
              translationKey(
                "Add people on the team's Members page and their compliance shows up here.",
              ),
            ),
    };
  }

  if (summary.attentionCount === 0) {
    return {
      kind: ComplianceVerdictKind.AllCompliant,
      badgeText: text(translationKey("All compliant")),
      headline:
        summary.memberCount === 1
          ? text(translationKey("The team's only member meets every rule"))
          : translator.translatePlural(
              EVERY_MEMBER_MEETS_EVERY_RULE,
              summary.memberCount,
            ),
      detail: "",
    };
  }

  let headline: string;

  if (summary.compliantCount === 0) {
    headline =
      summary.memberCount === 1
        ? text(
            translationKey("The team's only member does not meet every rule"),
          )
        : translator.translatePlural(
            NO_MEMBER_MEETS_EVERY_RULE,
            summary.memberCount,
          );
  } else {
    headline = translator.translatePlural(
      SOME_MEMBERS_MEET_EVERY_RULE,
      summary.memberCount,
      { compliant: translator.formatNumber(summary.compliantCount) },
    );
  }

  return {
    kind: ComplianceVerdictKind.NeedsAttention,
    badgeText: translator.translatePlural(
      NEED_ATTENTION,
      summary.attentionCount,
    ),
    headline: headline,
    detail: "",
  };
};

export enum MemberStatusFilter {
  All = "All",
  NeedsAttention = "NeedsAttention",
  Compliant = "Compliant",
}

// A member who has neither a name nor an email address.
export const UNKNOWN_USER: string = translationKey("Unknown User");

// "this member", in "Open this member's on-call setup".
const THIS_MEMBER: string = translationKey("this member");

export const getMemberDisplayName: (
  member: TeamMemberComplianceJSON,
  translator?: Translator,
) => string = (
  member: TeamMemberComplianceJSON,
  translator: Translator = ENGLISH,
): string => {
  return (
    member.userName ||
    member.userEmail ||
    translator.translateText(UNKNOWN_USER) ||
    UNKNOWN_USER
  );
};

// "Jane" from "Jane Doe"; the email when there is no name.
export const getMemberFirstName: (
  member: TeamMemberComplianceJSON,
) => string = (member: TeamMemberComplianceJSON): string => {
  const name: string = (member.userName || "").trim();

  if (!name || name === UNKNOWN_USER) {
    return member.userEmail || THIS_MEMBER;
  }

  return name.split(/\s+/)[0] || name;
};

/*
 * The same, as a sentence takes it: a name or an email as written, "this
 * member" in the sentence's language.
 */
export const getMemberFirstNameInSentence: (
  member: TeamMemberComplianceJSON,
) => TemplateValue = (member: TeamMemberComplianceJSON): TemplateValue => {
  const firstName: string = getMemberFirstName(member);

  return firstName === THIS_MEMBER && !member.userEmail
    ? translatableTerm(THIS_MEMBER)
    : firstName;
};

/*
 * Worst first: members who need attention, those failing the most rules
 * leading, then everyone else - alphabetically within each group, so the
 * order is stable between refreshes and a name is easy to find.
 */
export const sortMembers: (
  members: Array<TeamMemberComplianceJSON>,
) => Array<TeamMemberComplianceJSON> = (
  members: Array<TeamMemberComplianceJSON>,
): Array<TeamMemberComplianceJSON> => {
  return [...members].sort(
    (a: TeamMemberComplianceJSON, b: TeamMemberComplianceJSON): number => {
      if (a.isCompliant !== b.isCompliant) {
        return a.isCompliant ? 1 : -1;
      }

      const issueDifference: number =
        b.nonCompliantRules.length - a.nonCompliantRules.length;

      if (issueDifference !== 0) {
        return issueDifference;
      }

      const byName: number = getMemberDisplayName(a).localeCompare(
        getMemberDisplayName(b),
        undefined,
        { sensitivity: "base" },
      );

      if (byName !== 0) {
        return byName;
      }

      return (a.userEmail || "").localeCompare(b.userEmail || "");
    },
  );
};

/*
 * Where focus goes within a member's row of rule squares for a key pressed on
 * the square at `current`, or null for a key the row leaves alone (Tab, say).
 * The row is one tab stop with a roving tabindex - a stop per square would put
 * members x rules stops between a keyboard user and the rest of the page - so
 * the arrows (and Home / End) are how the squares, and their tooltips, are
 * reached. Clamped, not wrapped, like the uptime strip's bars.
 */
export const getNextRuleSquareIndex: (data: {
  key: string;
  current: number;
  count: number;
}) => number | null = (data: {
  key: string;
  current: number;
  count: number;
}): number | null => {
  if (data.count <= 0) {
    return null;
  }

  const last: number = data.count - 1;
  const current: number = Math.min(Math.max(data.current, 0), last);
  let next: number;

  switch (data.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = current + 1;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = current - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
    default:
      return null;
  }

  return Math.min(Math.max(next, 0), last);
};

export const getMemberIssueForRule: (
  member: TeamMemberComplianceJSON,
  settingId: string,
) => TeamComplianceIssueJSON | undefined = (
  member: TeamMemberComplianceJSON,
  settingId: string,
): TeamComplianceIssueJSON | undefined => {
  return member.nonCompliantRules.find(
    (issue: TeamComplianceIssueJSON): boolean => {
      return issue.settingId === settingId;
    },
  );
};

export const memberMatchesSearch: (
  member: TeamMemberComplianceJSON,
  search: string,
) => boolean = (member: TeamMemberComplianceJSON, search: string): boolean => {
  const needle: string = search.trim().toLowerCase();

  if (!needle) {
    return true;
  }

  return (
    (member.userName || "").toLowerCase().includes(needle) ||
    (member.userEmail || "").toLowerCase().includes(needle)
  );
};

export const memberMatchesStatus: (
  member: TeamMemberComplianceJSON,
  filter: MemberStatusFilter,
) => boolean = (
  member: TeamMemberComplianceJSON,
  filter: MemberStatusFilter,
): boolean => {
  if (filter === MemberStatusFilter.NeedsAttention) {
    return !member.isCompliant;
  }

  if (filter === MemberStatusFilter.Compliant) {
    return member.isCompliant;
  }

  return true;
};

export const filterMembers: (data: {
  members: Array<TeamMemberComplianceJSON>;
  status: MemberStatusFilter;
  search: string;
  failingSettingId: string | null;
}) => Array<TeamMemberComplianceJSON> = (data: {
  members: Array<TeamMemberComplianceJSON>;
  status: MemberStatusFilter;
  search: string;
  failingSettingId: string | null;
}): Array<TeamMemberComplianceJSON> => {
  return sortMembers(data.members).filter(
    (member: TeamMemberComplianceJSON): boolean => {
      if (!memberMatchesStatus(member, data.status)) {
        return false;
      }

      if (
        data.failingSettingId &&
        !getMemberIssueForRule(member, data.failingSettingId)
      ) {
        return false;
      }

      return memberMatchesSearch(member, data.search);
    },
  );
};

export interface MemberStatusCounts {
  all: number;
  needsAttention: number;
  compliant: number;
}

export const countMembersByStatus: (
  members: Array<TeamMemberComplianceJSON>,
) => MemberStatusCounts = (
  members: Array<TeamMemberComplianceJSON>,
): MemberStatusCounts => {
  const compliant: number = members.filter(
    (member: TeamMemberComplianceJSON): boolean => {
      return member.isCompliant;
    },
  ).length;

  return {
    all: members.length,
    needsAttention: members.length - compliant,
    compliant: compliant,
  };
};

/*
 * The members section's status segments, counted within whatever else
 * narrows the list - the rule filter and the search. Each badge then says
 * exactly how many rows its segment would show, so "Needs attention 4" never
 * sits over "3 of 4 members", and a segment that would show nobody under a
 * rule filter (Compliant, always) carries no count at all.
 */
export const countFilteredMembersByStatus: (data: {
  members: Array<TeamMemberComplianceJSON>;
  search: string;
  failingSettingId: string | null;
}) => MemberStatusCounts = (data: {
  members: Array<TeamMemberComplianceJSON>;
  search: string;
  failingSettingId: string | null;
}): MemberStatusCounts => {
  return countMembersByStatus(
    filterMembers({
      members: data.members,
      status: MemberStatusFilter.All,
      search: data.search,
      failingSettingId: data.failingSettingId,
    }),
  );
};

/*
 * Where the signed-in member goes to fix a rule they fail, and what the
 * button says. A method rule is fixed on the notification methods page; an
 * on-call rule on the On-Call Rules page, opened on the tab for its own rule
 * type (`query`, `?type=alerts`) - sending somebody to a tab that does not
 * carry the rule they are missing is how a "fix this" link turns into noise.
 */
export interface SelfFix {
  page: PageMap;
  query?: Dictionary<string> | undefined;
  // English, a key: the link looks it up as it draws it.
  title: string;
}

// The link to the member's own On-Call Rules tab for each kind of rule.
const OWN_ON_CALL_RULES_LINKS: Readonly<Record<string, string>> = {
  [ComplianceRuleType.HasIncidentOnCallRules]: translationKey(
    "Open my incident on-call rules",
  ),
  [ComplianceRuleType.HasAlertOnCallRules]: translationKey(
    "Open my alert on-call rules",
  ),
  [ComplianceRuleType.HasIncidentEpisodeOnCallRules]: translationKey(
    "Open my incident episode on-call rules",
  ),
  [ComplianceRuleType.HasAlertEpisodeOnCallRules]: translationKey(
    "Open my alert episode on-call rules",
  ),
};

// One fix per page AND tab: two links to the same tab are one link.
export const getSelfFixKey: (fix: SelfFix) => string = (
  fix: SelfFix,
): string => {
  return `${fix.page}?${new URLSearchParams(fix.query || {}).toString()}`;
};

export const getSelfFix: (ruleType: string | undefined) => SelfFix = (
  ruleType: string | undefined,
): SelfFix => {
  const definition: ComplianceRuleDefinition | undefined =
    ComplianceRule.getDefinition(ruleType);

  if (
    !definition ||
    definition.category === ComplianceRuleCategory.NotificationMethod
  ) {
    return {
      page: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
      title: translationKey("Open my notification methods"),
    };
  }

  /*
   * The same page and tab a policy's readiness card and the setup checklist
   * send somebody to for a gap of this rule type: one opinion about where a
   * hole is fixed.
   */
  return {
    ...getSettingsPageForRuleType(
      definition.notificationRuleType ||
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    ),
    title:
      OWN_ON_CALL_RULES_LINKS[definition.ruleType] ||
      translationKey("Open my incident on-call rules"),
  };
};

/*
 * Every page (and On-Call Rules tab) the signed-in member has to visit to fix
 * what they fail, once each, in the order their failures are listed (oldest
 * rule first). A member failing both a method rule and an on-call rule needs
 * both pages - one link for the first failure alone leaves the second without
 * a way there - and one failing incident and alert rules needs both tabs.
 */
export const getSelfFixes: (
  member: TeamMemberComplianceJSON,
) => Array<SelfFix> = (member: TeamMemberComplianceJSON): Array<SelfFix> => {
  const fixes: Array<SelfFix> = [];

  for (const issue of member.nonCompliantRules) {
    const fix: SelfFix = getSelfFix(issue.ruleType);

    if (
      !fixes.some((existing: SelfFix): boolean => {
        return getSelfFixKey(existing) === getSelfFixKey(fix);
      })
    ) {
      fixes.push(fix);
    }
  }

  return fixes;
};

export interface RuleWarningGroup {
  rule: TeamComplianceRuleJSON;
  title: string;
  warnings: Array<string>;
  // In catalog order; empty for "any channel".
  channels: Array<ComplianceNotificationChannel>;
}

/*
 * The warnings worth interrupting the page for: those on rules that are
 * actually being checked. A paused rule's problems wait until it is turned
 * back on - except a rule paused because every severity it was scoped to was
 * deleted. Nobody paused that one on purpose, and it stays paused until an
 * admin edits it, so its warning is the only way anyone hears of it.
 */
export const getRuleWarningGroups: (
  rules: Array<TeamComplianceRuleJSON>,
  translator?: Translator,
) => Array<RuleWarningGroup> = (
  rules: Array<TeamComplianceRuleJSON>,
  translator: Translator = ENGLISH,
): Array<RuleWarningGroup> => {
  return rules
    .filter((rule: TeamComplianceRuleJSON): boolean => {
      return (
        (rule.enabled || hasNoSeveritiesLeft(rule)) && rule.warnings.length > 0
      );
    })
    .map((rule: TeamComplianceRuleJSON): RuleWarningGroup => {
      return {
        rule: rule,
        title: getRuleLabel(rule, translator),
        warnings: rule.warnings,
        channels: getRuleChannels(rule),
      };
    });
};

/*
 * Whether the way out of a warning is a project switch: one of the rule's
 * channels is one a project can switch off. Never for a rule with no
 * severities left, whatever its channels: that one is fixed by editing the
 * rule itself.
 */
export const isFixedInProjectNotificationSettings: (
  group: RuleWarningGroup,
) => boolean = (group: RuleWarningGroup): boolean => {
  return (
    !hasNoSeveritiesLeft(group.rule) &&
    group.channels.some((channel: ComplianceNotificationChannel): boolean => {
      return PROJECT_SWITCHED_CHANNELS.includes(channel);
    })
  );
};

/*
 * The payload, made safe to render. The server builds exactly the contract,
 * but a page that crashes on one missing array - during a rolling deploy, say,
 * when an older API answers - is a worse failure than one that shows zeros,
 * so every collection defaults to empty and every count to 0.
 */
const asString: (value: unknown) => string = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
};

const asCount: (value: unknown) => number = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const asObjects: (value: unknown) => Array<JSONObject> = (
  value: unknown,
): Array<JSONObject> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as Array<unknown>).filter((item: unknown): boolean => {
    return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  }) as Array<JSONObject>;
};

const asStrings: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as Array<unknown>)
    .map((item: unknown): string => {
      return asString(item);
    })
    .filter((item: string): boolean => {
      return Boolean(item);
    });
};

const parseSeverity: (json: JSONObject) => TeamComplianceSeverityJSON = (
  json: JSONObject,
): TeamComplianceSeverityJSON => {
  const color: string = asString(json["color"]);
  const severity: TeamComplianceSeverityJSON = {
    id: asString(json["id"]),
    name: asString(json["name"]),
  };

  if (color) {
    severity.color = color;
  }

  return severity;
};

/*
 * An API from before rules had ids (an older replica answering during a
 * rolling deploy) sends rules and failures without a settingId. Such a rule
 * is given a made-up id so the page can still list it and key its rows - an
 * id no request may ever carry, so nothing that writes to a rule is offered
 * for it (see hasServerId).
 */
export const LEGACY_RULE_ID_PREFIX: string = "legacy-rule-";

// Whether the rule's id is the server's own, i.e. whether it may be changed.
export const hasServerId: (rule: TeamComplianceRuleJSON) => boolean = (
  rule: TeamComplianceRuleJSON,
): boolean => {
  return (
    Boolean(rule.settingId) && !rule.settingId.startsWith(LEGACY_RULE_ID_PREFIX)
  );
};

/*
 * The rule's channels, each once. An API from before a rule could require
 * several channels (an older replica during a rolling deploy) sends one
 * `notificationChannel`, or null for any channel, instead of the list.
 */
const parseChannels: (
  json: JSONObject,
) => Array<ComplianceNotificationChannel> = (
  json: JSONObject,
): Array<ComplianceNotificationChannel> => {
  const channels: Array<string> = Array.isArray(json["notificationChannels"])
    ? asStrings(json["notificationChannels"])
    : asStrings([json["notificationChannel"]]);

  return Array.from(
    new Set<string>(channels),
  ) as Array<ComplianceNotificationChannel>;
};

const parseRule: (json: JSONObject, index: number) => TeamComplianceRuleJSON = (
  json: JSONObject,
  index: number,
): TeamComplianceRuleJSON => {
  const ruleType: string = asString(json["ruleType"]);
  const severityKind: string = asString(json["severityKind"]);
  const severities: Array<TeamComplianceSeverityJSON> = asObjects(
    json["severities"],
  )
    .map(parseSeverity)
    .filter((severity: TeamComplianceSeverityJSON): boolean => {
      return Boolean(severity.id);
    });

  return {
    settingId:
      asString(json["settingId"]) || `${LEGACY_RULE_ID_PREFIX}${index}`,
    ruleType: ruleType as ComplianceRuleType,
    enabled: json["enabled"] === true,
    notificationChannels: parseChannels(json),
    // An API from before custom channels sends none: every channel is checked.
    channelsNotChecked: ComplianceRule.normaliseChannels(
      json["channelsNotChecked"],
    ),
    severityKind:
      severityKind === ComplianceSeverityKind.Incident ||
      severityKind === ComplianceSeverityKind.Alert
        ? severityKind
        : null,
    /*
     * An API from before severity scopes sends no such field. Its on-call
     * rules had no scope, so they applied to every severity. They must not be
     * read as rules with no severities left (see hasNoSeveritiesLeft), which
     * would take their switches away.
     */
    appliesToAllSeverities:
      typeof json["appliesToAllSeverities"] === "boolean"
        ? json["appliesToAllSeverities"]
        : severities.length === 0 &&
          ComplianceRule.supportsSeverityScope(ruleType),
    severities: severities,
    compliantCount: asCount(json["compliantCount"]),
    nonCompliantCount: asCount(json["nonCompliantCount"]),
    warnings: asStrings(json["warnings"]),
  };
};

const parseIssue: (json: JSONObject) => TeamComplianceIssueJSON = (
  json: JSONObject,
): TeamComplianceIssueJSON => {
  return {
    settingId: asString(json["settingId"]),
    ruleType: asString(json["ruleType"]) as ComplianceRuleType,
    reason: asString(json["reason"]),
  };
};

const parseMember: (json: JSONObject) => TeamMemberComplianceJSON = (
  json: JSONObject,
): TeamMemberComplianceJSON => {
  const nonCompliantRules: Array<TeamComplianceIssueJSON> = asObjects(
    json["nonCompliantRules"],
  ).map(parseIssue);
  const pictureId: string = asString(json["userProfilePictureId"]);
  const member: TeamMemberComplianceJSON = {
    userId: asString(json["userId"]),
    userName: asString(json["userName"]),
    userEmail: asString(json["userEmail"]),
    isCompliant:
      typeof json["isCompliant"] === "boolean"
        ? json["isCompliant"]
        : nonCompliantRules.length === 0,
    nonCompliantRules: nonCompliantRules,
  };

  if (pictureId) {
    member.userProfilePictureId = pictureId;
  }

  return member;
};

/*
 * A failure that arrived without the id of the rule it is about (the same
 * older API) belongs to the rule of its type. That API allowed one rule per
 * type, so the match is exact; when several rules share the type the failure
 * cannot be placed and is left unmatched rather than pinned on the wrong one.
 * Without this every failing member's squares would read "met" beside a
 * "Needs attention" chip and the reason they fail.
 */
const withIssueRuleIds: (
  member: TeamMemberComplianceJSON,
  rules: Array<TeamComplianceRuleJSON>,
) => TeamMemberComplianceJSON = (
  member: TeamMemberComplianceJSON,
  rules: Array<TeamComplianceRuleJSON>,
): TeamMemberComplianceJSON => {
  return {
    ...member,
    nonCompliantRules: member.nonCompliantRules.map(
      (issue: TeamComplianceIssueJSON): TeamComplianceIssueJSON => {
        if (issue.settingId) {
          return issue;
        }

        const candidates: Array<TeamComplianceRuleJSON> = rules.filter(
          (rule: TeamComplianceRuleJSON): boolean => {
            return rule.ruleType === issue.ruleType;
          },
        );

        return candidates.length === 1
          ? { ...issue, settingId: candidates[0]!.settingId }
          : issue;
      },
    ),
  };
};

/*
 * The same older API sent no pass counts at all. Counted from the members,
 * an active rule's row says "0 of 1 member meets it" beside the member who
 * fails it, rather than "No members to check". A payload that sends counts -
 * even nonsense ones, which default to 0 - is taken at its word.
 */
const withCountsFromMembers: (
  rule: TeamComplianceRuleJSON,
  json: JSONObject,
  members: Array<TeamMemberComplianceJSON>,
) => TeamComplianceRuleJSON = (
  rule: TeamComplianceRuleJSON,
  json: JSONObject,
  members: Array<TeamMemberComplianceJSON>,
): TeamComplianceRuleJSON => {
  if (
    "compliantCount" in json ||
    "nonCompliantCount" in json ||
    !isRuleActive(rule)
  ) {
    return rule;
  }

  const failing: number = members.filter(
    (member: TeamMemberComplianceJSON): boolean => {
      return Boolean(getMemberIssueForRule(member, rule.settingId));
    },
  ).length;

  return {
    ...rule,
    compliantCount: members.length - failing,
    nonCompliantCount: failing,
  };
};

export const parseComplianceStatus: (
  json: JSONObject,
) => TeamComplianceStatusJSON = (
  json: JSONObject,
): TeamComplianceStatusJSON => {
  const ruleObjects: Array<JSONObject> = asObjects(json["complianceSettings"]);
  const rules: Array<TeamComplianceRuleJSON> = ruleObjects.map(parseRule);

  const members: Array<TeamMemberComplianceJSON> = asObjects(
    json["userComplianceStatuses"],
  )
    .map(parseMember)
    .filter((member: TeamMemberComplianceJSON): boolean => {
      return Boolean(member.userId);
    })
    .map((member: TeamMemberComplianceJSON): TeamMemberComplianceJSON => {
      return withIssueRuleIds(member, rules);
    });

  const status: TeamComplianceStatusJSON = {
    teamId: asString(json["teamId"]),
    teamName: asString(json["teamName"]),
    evaluatedAt: asString(json["evaluatedAt"]),
    complianceSettings: rules.map(
      (rule: TeamComplianceRuleJSON, index: number): TeamComplianceRuleJSON => {
        return withCountsFromMembers(rule, ruleObjects[index]!, members);
      },
    ),
    userComplianceStatuses: members,
  };

  /*
   * People invited who have not accepted yet travel as a whole count, never
   * as members. Left off when the API did not send one (an older API), which
   * reads as nobody waiting.
   */
  if (json["invitedMemberCount"] !== undefined) {
    status.invitedMemberCount = Math.max(
      0,
      Math.floor(asCount(json["invitedMemberCount"])),
    );
  }

  return status;
};

// The time the server checked, or null when it did not say (or said nonsense).
export const getEvaluatedAt: (
  status: TeamComplianceStatusJSON,
) => Date | null = (status: TeamComplianceStatusJSON): Date | null => {
  if (!status.evaluatedAt) {
    return null;
  }

  const date: Date = new Date(status.evaluatedAt);

  return Number.isNaN(date.getTime()) ? null : date;
};
