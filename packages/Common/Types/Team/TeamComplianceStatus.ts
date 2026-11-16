import ComplianceNotificationChannel from "./ComplianceNotificationChannel";
import { ComplianceSeverityKind } from "./ComplianceRule";
import ComplianceRuleType from "./ComplianceRuleType";

/*
 * The JSON body of GET /team/compliance-status/:teamId (OneUptime Enterprise).
 *
 * The server (ee/Server/TeamCompliance) builds exactly this shape and the
 * Dashboard page (ee/Dashboard/TeamCompliance) renders exactly this shape, so
 * it is declared once, here, as plain JSON types - ids are strings, never
 * ObjectIDs, because this is what crosses the wire.
 */

export interface TeamComplianceSeverityJSON {
  id: string;
  name: string;
  // Hex colour of the severity, when it has one.
  color?: string | undefined;
}

/*
 * What is wrong with a rule itself, as data the Dashboard words in the
 * reader's language (TeamComplianceFindings, #8632). The English sentence
 * the server always sent stays beside it, in `warnings`.
 */
export enum TeamComplianceWarningKind {
  UnknownRuleType = "unknownRuleType",
  SeveritiesDeleted = "severitiesDeleted",
  CustomChannelsNotActive = "customChannelsNotActive",
  NoCustomChannelOn = "noCustomChannelOn",
  // WhatsApp is off: members cannot add a number.
  WhatsAppSwitchedOff = "whatsAppSwitchedOff",
  // Call, SMS or Telegram is off: pages on it are never sent.
  ChannelsSwitchedOff = "channelsSwitchedOff",
}

export interface TeamComplianceWarningJSON {
  kind: TeamComplianceWarningKind;
  // The channels switched off, in catalog order (ChannelsSwitchedOff only).
  channels?: Array<ComplianceNotificationChannel> | undefined;
}

/*
 * Why a member fails a rule, as data (TeamComplianceFindings, #8632): one
 * finding per sentence of the English `reason` the server always sent.
 */
export enum TeamComplianceFindingKind {
  // No verified method on the rule's channel.
  MethodMissing = "methodMissing",
  // No readiness could be read for the member: not checked.
  CouldNotCheck = "couldNotCheck",
  // No notification rule for these severities.
  MissingRules = "missingRules",
  // No rule on the channel for these severities.
  NoChannelRule = "noChannelRule",
  // A rule on the channel points at an unverified method, or an off custom channel.
  UnusableChannelRule = "unusableChannelRule",
  // A rule on the channel is never sent: another method on it is someone else's.
  RefusedChannelRule = "refusedChannelRule",
  // Opted out of these severities.
  OptedOut = "optedOut",
}

export interface TeamComplianceFindingJSON {
  kind: TeamComplianceFindingKind;
  channel?: ComplianceNotificationChannel | undefined;
  // The severities it is about, in the rule's order; a name may be empty.
  severities?: Array<TeamComplianceSeverityJSON> | undefined;
}

export interface TeamComplianceRuleJSON {
  // TeamComplianceSetting._id. A team may hold several rules of one type.
  settingId: string;
  ruleType: ComplianceRuleType;
  enabled: boolean;
  /*
   * The channels an on-call rule insists on - a member needs a rule on each
   * - in catalog order. Empty means "any channel", and is always empty for
   * method rules.
   */
  notificationChannels: Array<ComplianceNotificationChannel>;
  /*
   * Those of notificationChannels that members are NOT checked on, because
   * no page can go out on them on this server right now: the custom channel,
   * while custom channels are not part of the license or none is turned on.
   * The rule's warnings say why. A rule whose every channel is here checks
   * nobody. Only an enabled rule's are worked out; empty for every other
   * rule, and absent from a server from before custom channels.
   */
  channelsNotChecked?: Array<ComplianceNotificationChannel> | undefined;
  // Which severity list scopes the rule; null for method rules.
  severityKind: ComplianceSeverityKind | null;
  /*
   * True when the rule applies to every severity of its kind - an on-call
   * rule with no severities selected. Always false for method rules.
   */
  appliesToAllSeverities: boolean;
  /*
   * The severities the rule is scoped to, in severity order (most severe
   * first). Empty when appliesToAllSeverities, and for method rules.
   */
  severities: Array<TeamComplianceSeverityJSON>;
  /*
   * Members who pass / fail this rule. Both are 0 for a disabled rule, which
   * is not evaluated at all.
   */
  compliantCount: number;
  nonCompliantCount: number;
  /*
   * Problems with the rule itself rather than with any member - e.g. the
   * project has the rule's channel switched off, so nobody can pass it.
   */
  warnings: Array<string>;
  /*
   * The same warnings as data, one for each of `warnings`, in order, for
   * the Dashboard to word in the reader's language. Absent from a server
   * from before #8632, which sent only the English.
   */
  warningDetails?: Array<TeamComplianceWarningJSON> | undefined;
}

export interface TeamComplianceIssueJSON {
  // The rule this member fails.
  settingId: string;
  ruleType: ComplianceRuleType;
  // What is wrong, as a sentence an admin can act on - in English.
  reason: string;
  /*
   * The same as data, for the Dashboard to word in the reader's language:
   * one finding for each sentence of `reason`. Absent from a server from
   * before #8632.
   */
  findings?: Array<TeamComplianceFindingJSON> | undefined;
}

export interface TeamMemberComplianceJSON {
  userId: string;
  userName: string;
  userEmail: string;
  userProfilePictureId?: string | undefined;
  // False when the member fails at least one enabled rule.
  isCompliant: boolean;
  nonCompliantRules: Array<TeamComplianceIssueJSON>;
}

export interface TeamComplianceStatusJSON {
  teamId: string;
  teamName: string;
  // ISO-8601 time the status was computed.
  evaluatedAt: string;
  /*
   * Every rule on the team, enabled or not, in the order they were created.
   */
  complianceSettings: Array<TeamComplianceRuleJSON>;
  /*
   * The team's members: the people who have accepted their invitation to
   * it. Somebody invited who has not accepted yet is not on the team's
   * roster and is never paged through it, so they are not checked.
   */
  userComplianceStatuses: Array<TeamMemberComplianceJSON>;
  // How many people invited to the team have not accepted yet.
  invitedMemberCount?: number | undefined;
}
