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
}

export interface TeamComplianceIssueJSON {
  // The rule this member fails.
  settingId: string;
  ruleType: ComplianceRuleType;
  // What is wrong, as a sentence an admin can act on.
  reason: string;
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
