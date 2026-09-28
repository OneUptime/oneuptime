import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRule, {
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
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
 * links to that settings page when one of them is involved.
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
 * A rule members are actually measured against. A paused rule is listed but
 * not checked, and a rule whose type this build does not recognise is not
 * checked either (the server passes every member on it and says so in a
 * warning), so neither may count towards the verdict.
 */
export const isRuleActive: (rule: TeamComplianceRuleJSON) => boolean = (
  rule: TeamComplianceRuleJSON,
): boolean => {
  return rule.enabled && isRuleKnown(rule);
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
 * severities - or whose selected severities have all since been deleted -
 * reads as "every severity", which is what the server then enforces.
 */
export const getRuleSentence: (rule: TeamComplianceRuleJSON) => string = (
  rule: TeamComplianceRuleJSON,
): string => {
  return ComplianceRule.describe({
    ruleType: rule.ruleType,
    notificationChannel: rule.notificationChannel,
    severityNames: rule.appliesToAllSeverities
      ? []
      : rule.severities.map((severity: TeamComplianceSeverityJSON): string => {
          return severity.name || severity.id;
        }),
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

export interface ComplianceSummary {
  memberCount: number;
  compliantCount: number;
  attentionCount: number;
  ruleCount: number;
  activeRuleCount: number;
  pausedRuleCount: number;
}

export const summarizeCompliance: (
  status: TeamComplianceStatusJSON,
) => ComplianceSummary = (
  status: TeamComplianceStatusJSON,
): ComplianceSummary => {
  const compliantCount: number = status.userComplianceStatuses.filter(
    (member: TeamMemberComplianceJSON): boolean => {
      return member.isCompliant;
    },
  ).length;

  return {
    memberCount: status.userComplianceStatuses.length,
    compliantCount: compliantCount,
    attentionCount: status.userComplianceStatuses.length - compliantCount,
    ruleCount: status.complianceSettings.length,
    activeRuleCount: getActiveRules(status.complianceSettings).length,
    pausedRuleCount: status.complianceSettings.filter(
      (rule: TeamComplianceRuleJSON): boolean => {
        return !rule.enabled;
      },
    ).length,
  };
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
        "A rule says what everyone on this team must have set up to be reachable - a phone call for critical incidents, say.",
    };
  }

  if (summary.activeRuleCount === 0) {
    return {
      kind: ComplianceVerdictKind.NoActiveRules,
      badgeText: "No active rules",
      headline:
        summary.pausedRuleCount === summary.ruleCount
          ? `${summary.ruleCount === 1 ? "The only rule is" : `All ${summary.ruleCount} rules are`} paused`
          : "No rule is being checked",
      detail:
        "Nobody is being checked right now. Turn a rule on to see who meets it.",
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

export interface RuleWarningGroup {
  rule: TeamComplianceRuleJSON;
  title: string;
  warnings: Array<string>;
  channel: ComplianceNotificationChannel | undefined;
}

/*
 * The warnings worth interrupting the page for: those on rules that are
 * actually being checked. A paused rule's problems wait until it is turned
 * back on.
 */
export const getRuleWarningGroups: (
  rules: Array<TeamComplianceRuleJSON>,
) => Array<RuleWarningGroup> = (
  rules: Array<TeamComplianceRuleJSON>,
): Array<RuleWarningGroup> => {
  return rules
    .filter((rule: TeamComplianceRuleJSON): boolean => {
      return rule.enabled && rule.warnings.length > 0;
    })
    .map((rule: TeamComplianceRuleJSON): RuleWarningGroup => {
      return {
        rule: rule,
        title: getRuleTitle(rule),
        warnings: rule.warnings,
        channel: getRuleChannel(rule),
      };
    });
};

export const isFixedInProjectNotificationSettings: (
  group: RuleWarningGroup,
) => boolean = (group: RuleWarningGroup): boolean => {
  return Boolean(
    group.channel && PROJECT_SWITCHED_CHANNELS.includes(group.channel),
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

const parseRule: (json: JSONObject, index: number) => TeamComplianceRuleJSON = (
  json: JSONObject,
  index: number,
): TeamComplianceRuleJSON => {
  const ruleType: string = asString(json["ruleType"]);
  const channel: string = asString(json["notificationChannel"]);
  const severityKind: string = asString(json["severityKind"]);

  return {
    settingId: asString(json["settingId"]) || `rule-${index}`,
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
    appliesToAllSeverities: json["appliesToAllSeverities"] === true,
    severities: asObjects(json["severities"])
      .map(parseSeverity)
      .filter((severity: TeamComplianceSeverityJSON): boolean => {
        return Boolean(severity.id);
      }),
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

export const parseComplianceStatus: (
  json: JSONObject,
) => TeamComplianceStatusJSON = (
  json: JSONObject,
): TeamComplianceStatusJSON => {
  return {
    teamId: asString(json["teamId"]),
    teamName: asString(json["teamName"]),
    evaluatedAt: asString(json["evaluatedAt"]),
    complianceSettings: asObjects(json["complianceSettings"]).map(parseRule),
    userComplianceStatuses: asObjects(json["userComplianceStatuses"])
      .map(parseMember)
      .filter((member: TeamMemberComplianceJSON): boolean => {
        return Boolean(member.userId);
      }),
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
