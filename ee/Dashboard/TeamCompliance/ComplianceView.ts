import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
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
 */

export const CHANNEL_ICONS: Record<ComplianceNotificationChannel, IconProp> = {
  [ComplianceNotificationChannel.Call]: IconProp.Call,
  [ComplianceNotificationChannel.SMS]: IconProp.SMS,
  [ComplianceNotificationChannel.Push]: IconProp.DevicePhoneMobile,
  [ComplianceNotificationChannel.Email]: IconProp.Email,
  [ComplianceNotificationChannel.WhatsApp]: IconProp.WhatsApp,
  [ComplianceNotificationChannel.Telegram]: IconProp.Telegram,
  [ComplianceNotificationChannel.Slack]: IconProp.Slack,
  [ComplianceNotificationChannel.MicrosoftTeams]: IconProp.MicrosoftTeams,
  [ComplianceNotificationChannel.Webhook]: IconProp.Webhook,
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
  "ruleType" | "notificationChannel"
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
 * hold a real one of the same type and channel beside it, and turning it back
 * on as it stands would only make a copy of that rule.
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
export const NO_SEVERITIES_LEFT_LABEL: string = "No severities left";

/*
 * What the page says about a rule with no severities left when the server did
 * not say it itself - the server's own warning, word for word.
 */
export const NO_SEVERITIES_LEFT_WARNING: string =
  "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.";

/*
 * A rule members are actually measured against. A paused rule is listed but
 * not checked, and a rule whose type this build does not recognise is not
 * checked either (the server passes every member on it and says so in a
 * warning), nor is one with no severities left, whatever its switch says -
 * so none of them may count towards the verdict.
 */
export const isRuleActive: (rule: TeamComplianceRuleJSON) => boolean = (
  rule: TeamComplianceRuleJSON,
): boolean => {
  return rule.enabled && isRuleKnown(rule) && !hasNoSeveritiesLeft(rule);
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
 * The channel a rule is about: the method channel of a method rule, or the
 * channel an on-call rule insists on. Undefined for "any channel" and for rule
 * types this build does not know.
 */
export const getRuleChannel: (
  rule: RuleIdentity,
) => ComplianceNotificationChannel | undefined = (
  rule: RuleIdentity,
): ComplianceNotificationChannel | undefined => {
  const definition: ComplianceRuleDefinition | undefined =
    ComplianceRule.getDefinition(rule.ruleType);

  if (!definition) {
    return undefined;
  }

  if (definition.category === ComplianceRuleCategory.NotificationMethod) {
    return definition.methodChannel;
  }

  return ComplianceRule.isKnownChannel(rule.notificationChannel)
    ? rule.notificationChannel
    : undefined;
};

// A channel rule wears its channel; an "any channel" rule wears its kind.
export const getRuleIcon: (rule: RuleIdentity) => IconProp = (
  rule: RuleIdentity,
): IconProp => {
  const channel: ComplianceNotificationChannel | undefined =
    getRuleChannel(rule);

  if (channel) {
    return CHANNEL_ICONS[channel];
  }

  return getRuleTypeIcon(rule.ruleType);
};

export const getChannelLabel: (
  channel: ComplianceNotificationChannel | null | undefined,
) => string = (
  channel: ComplianceNotificationChannel | null | undefined,
): string => {
  return ComplianceRule.getChannelDefinition(channel)?.label || "Any channel";
};

export const getRuleTitle: (rule: RuleIdentity) => string = (
  rule: RuleIdentity,
): string => {
  return ComplianceRule.getTitle({
    ruleType: rule.ruleType,
    notificationChannel: rule.notificationChannel,
  });
};

/*
 * The rule as the sentence a reviewer reads. An on-call rule scoped to no
 * severities reads as "every severity", which is what the server enforces.
 * A rule whose selected severities have all since been deleted says so rather
 * than claiming every severity: it checks none.
 */
export const getRuleSentence: (rule: TeamComplianceRuleJSON) => string = (
  rule: TeamComplianceRuleJSON,
): string => {
  let severityNames: Array<string> = rule.severities.map(
    (severity: TeamComplianceSeverityJSON): string => {
      return severity.name || severity.id;
    },
  );

  if (rule.appliesToAllSeverities) {
    severityNames = [];
  } else if (hasNoSeveritiesLeft(rule)) {
    severityNames = ["severities that have since been deleted"];
  }

  return ComplianceRule.describe({
    ruleType: rule.ruleType,
    notificationChannel: rule.notificationChannel,
    severityNames: severityNames,
  });
};

export const getAllSeveritiesLabel: (
  kind: ComplianceSeverityKind | null | undefined,
) => string = (kind: ComplianceSeverityKind | null | undefined): string => {
  return kind === ComplianceSeverityKind.Alert
    ? "All alert severities"
    : "All incident severities";
};

/*
 * The rule's name wherever it has to be told apart from every other rule on
 * its own: a switch's or a button's accessible name, the delete confirmation,
 * a warning line, the "Failing ..." chip, a member's result square. A team may
 * hold several rules of one type and channel - Call for Critical incidents
 * and Call for Major incidents - and the title alone names them all alike, so
 * an on-call rule's name carries its severity scope: "Call for incidents
 * (Critical Incident)", "Incident on-call rules (all incident severities)",
 * "Call for incidents (no severities left)" - the last never named like the
 * team's every-severity rule of the same type and channel.
 * The rules card's heading stays the short title; the sentence and the scope
 * chips under it already say the rest.
 */
export const getRuleLabel: (rule: TeamComplianceRuleJSON) => string = (
  rule: TeamComplianceRuleJSON,
): string => {
  const title: string = getRuleTitle(rule);

  if (!ComplianceRule.supportsSeverityScope(rule.ruleType)) {
    return title;
  }

  if (hasNoSeveritiesLeft(rule)) {
    return `${title} (${NO_SEVERITIES_LEFT_LABEL.toLowerCase()})`;
  }

  if (rule.appliesToAllSeverities || rule.severities.length === 0) {
    return `${title} (${getAllSeveritiesLabel(
      rule.severityKind || ComplianceRule.getSeverityKind(rule.ruleType),
    ).toLowerCase()})`;
  }

  return `${title} (${joinAsProse(
    rule.severities.map((severity: TeamComplianceSeverityJSON): string => {
      return severity.name || severity.id;
    }),
  )})`;
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
 * A rule's pass rate in words, as a bold count and the phrase after it:
 * "All 5" + "meet it", "2 of 3" + "members meet it", "1 of 1" + "member meets
 * it". `label` is the same sentence for the bar's accessible name. Only
 * meaningful when `total` > 0.
 */
export interface RulePassRateText {
  count: string;
  caption: string;
  label: string;
}

export const getRulePassRateText: (rate: RulePassRate) => RulePassRateText = (
  rate: RulePassRate,
): RulePassRateText => {
  let count: string = `${rate.passing} of ${rate.total}`;
  let phrase: string = `${pluralize(rate.total, "member")} ${
    rate.passing === 1 || rate.total === 1 ? "meets" : "meet"
  }`;

  if (rate.failing === 0 && rate.total > 1) {
    count = `All ${rate.total}`;
    phrase = "meet";
  }

  return {
    count: count,
    caption: `${phrase} it`,
    label: `${count} ${phrase} this rule`,
  };
};

export interface ComplianceSummary {
  memberCount: number;
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

// "A, or B", "A, B, or C": the ways out, as one choice.
const joinAsChoice: (items: Array<string>) => string = (
  items: Array<string>,
): string => {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
};

const capitalize: (text: string) => string = (text: string): string => {
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const getNoActiveRulesAdvice: (summary: ComplianceSummary) => string = (
  summary: ComplianceSummary,
): string => {
  const resumable: number = summary.resumableRuleCount;
  const noSeveritiesLeft: number = summary.noSeveritiesLeftRuleCount;
  const unrecognised: number = summary.unrecognisedRuleCount;
  const isOrAre: (count: number) => string = (count: number): string => {
    return count === 1 ? "is" : "are";
  };
  const itOrThem: (count: number) => string = (count: number): string => {
    return count === 1 ? "it" : "them";
  };
  // "This team's rule is", "All 2 of this team's rules are".
  const everyRule: (count: number, verb: string, verbs: string) => string = (
    count: number,
    verb: string,
    verbs: string,
  ): string => {
    return count === 1
      ? `This team's rule ${verb}`
      : `All ${count} of this team's rules ${verbs}`;
  };

  if (resumable === 0 && noSeveritiesLeft === 0 && unrecognised === 0) {
    return "Turn a rule on to see who meets it.";
  }

  if (resumable === 0 && noSeveritiesLeft === 0) {
    return `${everyRule(unrecognised, "is", "are")} of a type this version does not recognise, so ${
      unrecognised === 1 ? "it is" : "they are"
    } not checked. Delete ${itOrThem(unrecognised)} and add a supported rule.`;
  }

  if (resumable === 0 && unrecognised === 0) {
    return `${everyRule(noSeveritiesLeft, "has", "have")} no severities left: every severity ${
      noSeveritiesLeft === 1 ? "it was" : "they were"
    } scoped to has been deleted. Edit ${itOrThem(
      noSeveritiesLeft,
    )} to choose new severities, or delete ${itOrThem(noSeveritiesLeft)}.`;
  }

  const states: Array<string> = [];
  const choices: Array<string> = [];

  if (resumable > 0) {
    states.push(`${countOf(resumable, "rule")} ${isOrAre(resumable)} paused`);
    choices.push("turn a paused rule on");
  }

  if (noSeveritiesLeft > 0) {
    states.push(
      `${countOf(noSeveritiesLeft, "rule")} ${
        noSeveritiesLeft === 1 ? "has" : "have"
      } no severities left`,
    );
    choices.push(
      `edit the ${pluralize(noSeveritiesLeft, "one")} with no severities left to choose new severities`,
    );
  }

  if (unrecognised > 0) {
    states.push(
      `${countOf(unrecognised, "rule")} ${isOrAre(
        unrecognised,
      )} of a type this version does not recognise`,
    );
    choices.push(`replace the unrecognised ${pluralize(unrecognised, "one")}`);
  }

  return `${joinAsProse(states)}. ${capitalize(joinAsChoice(choices))}.`;
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
  badgeText: string;
  headline: string;
  detail: string;
}

/*
 * The one-line answer at the top of the page. "All compliant" is only ever
 * claimed over at least one active rule and at least one member: a team with
 * nothing checked, or nobody to check, gets a neutral answer that says so
 * rather than a green one it has not earned.
 */
export const getComplianceVerdict: (
  summary: ComplianceSummary,
) => ComplianceVerdict = (summary: ComplianceSummary): ComplianceVerdict => {
  if (summary.ruleCount === 0) {
    return {
      kind: ComplianceVerdictKind.NoRules,
      badgeText: "No active rules",
      headline: "Nothing is being checked yet",
      detail:
        "Add a rule to say what everyone on this team must set up to be reachable - for example, a phone call for critical incidents.",
    };
  }

  if (summary.activeRuleCount === 0) {
    return {
      kind: ComplianceVerdictKind.NoActiveRules,
      badgeText: "No active rules",
      headline: areAllRulesPaused(summary)
        ? `${summary.ruleCount === 1 ? "The only rule is" : `All ${summary.ruleCount} rules are`} paused`
        : "No rule is being checked",
      detail: areAllRulesPaused(summary)
        ? "Nobody is being checked right now. Turn a rule on to see who meets it."
        : `Nobody is being checked right now. ${getNoActiveRulesAdvice(summary)}`,
    };
  }

  if (summary.memberCount === 0) {
    return {
      kind: ComplianceVerdictKind.NoMembers,
      badgeText: "No members",
      headline: "This team has no members to check",
      detail:
        "Add people on the team's Members page and their compliance shows up here.",
    };
  }

  if (summary.attentionCount === 0) {
    return {
      kind: ComplianceVerdictKind.AllCompliant,
      badgeText: "All compliant",
      headline:
        summary.memberCount === 1
          ? "The team's only member meets every rule"
          : `All ${summary.memberCount} members meet every rule`,
      detail: "",
    };
  }

  let headline: string;

  if (summary.compliantCount === 0) {
    headline =
      summary.memberCount === 1
        ? "The team's only member does not meet every rule"
        : `None of the ${summary.memberCount} members meet every rule`;
  } else {
    headline = `${summary.compliantCount} of ${countOf(
      summary.memberCount,
      "member",
    )} ${summary.compliantCount === 1 ? "meets" : "meet"} every rule`;
  }

  return {
    kind: ComplianceVerdictKind.NeedsAttention,
    badgeText: `${summary.attentionCount} ${pluralize(
      summary.attentionCount,
      "needs",
      "need",
    )} attention`,
    headline: headline,
    detail: "",
  };
};

export enum MemberStatusFilter {
  All = "All",
  NeedsAttention = "NeedsAttention",
  Compliant = "Compliant",
}

export const getMemberDisplayName: (
  member: TeamMemberComplianceJSON,
) => string = (member: TeamMemberComplianceJSON): string => {
  return member.userName || member.userEmail || "Unknown User";
};

// "Jane" from "Jane Doe"; the email when there is no name.
export const getMemberFirstName: (
  member: TeamMemberComplianceJSON,
) => string = (member: TeamMemberComplianceJSON): string => {
  const name: string = (member.userName || "").trim();

  if (!name || name === "Unknown User") {
    return member.userEmail || "this member";
  }

  return name.split(/\s+/)[0] || name;
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
 * on-call rule on the on-call rules page for its own rule type - sending
 * somebody to a page that does not carry the rule they are missing is how a
 * "fix this" link turns into noise.
 */
export interface SelfFix {
  page: PageMap;
  title: string;
}

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
      title: "Open my notification methods",
    };
  }

  let page: PageMap = PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES;

  switch (definition.notificationRuleType) {
    case NotificationRuleType.ON_CALL_EXECUTED_ALERT:
      page = PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES;
      break;
    case NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE:
      page = PageMap.USER_SETTINGS_ALERT_EPISODE_ON_CALL_RULES;
      break;
    case NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE:
      page = PageMap.USER_SETTINGS_INCIDENT_EPISODE_ON_CALL_RULES;
      break;
    default:
      page = PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES;
  }

  return {
    page: page,
    title: `Open my ${definition.subject || "on-call"} on-call rules`,
  };
};

/*
 * Every page the signed-in member has to visit to fix what they fail, once
 * each, in the order their failures are listed (oldest rule first). A member
 * failing both a method rule and an on-call rule needs both pages - one link
 * for the first failure alone leaves the second without a way there.
 */
export const getSelfFixes: (
  member: TeamMemberComplianceJSON,
) => Array<SelfFix> = (member: TeamMemberComplianceJSON): Array<SelfFix> => {
  const fixes: Array<SelfFix> = [];

  for (const issue of member.nonCompliantRules) {
    const fix: SelfFix = getSelfFix(issue.ruleType);

    if (
      !fixes.some((existing: SelfFix): boolean => {
        return existing.page === fix.page;
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
  channel: ComplianceNotificationChannel | undefined;
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
) => Array<RuleWarningGroup> = (
  rules: Array<TeamComplianceRuleJSON>,
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
        title: getRuleLabel(rule),
        warnings: rule.warnings,
        channel: getRuleChannel(rule),
      };
    });
};

/*
 * Whether the way out of a warning is a project switch. Never for a rule with
 * no severities left, whatever its channel: that one is fixed by editing the
 * rule itself.
 */
export const isFixedInProjectNotificationSettings: (
  group: RuleWarningGroup,
) => boolean = (group: RuleWarningGroup): boolean => {
  return (
    !hasNoSeveritiesLeft(group.rule) &&
    Boolean(group.channel && PROJECT_SWITCHED_CHANNELS.includes(group.channel))
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

const parseRule: (json: JSONObject, index: number) => TeamComplianceRuleJSON = (
  json: JSONObject,
  index: number,
): TeamComplianceRuleJSON => {
  const ruleType: string = asString(json["ruleType"]);
  const channel: string = asString(json["notificationChannel"]);
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
    notificationChannel: channel
      ? (channel as ComplianceNotificationChannel)
      : null,
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

  return {
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
