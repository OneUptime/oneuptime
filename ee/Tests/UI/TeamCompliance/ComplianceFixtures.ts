import ObjectID from "Common/Types/ObjectID";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import { ComplianceSeverityKind } from "Common/Types/Team/ComplianceRule";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";

/*
 * Payload builders for the Teams > Compliance UI tests. Every builder returns
 * the exact wire contract (Common/Types/Team/TeamComplianceStatus) - the
 * shape the ee server is built to produce - so a test that compiles is a test
 * against the real contract, not a hand-copied look-alike.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);
export const TEAM_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000002",
);

// Members.
export const JANE_ID: string = "00000000-0000-4000-8000-000000000003";
export const OMAR_ID: string = "00000000-0000-4000-8000-000000000004";
export const PRIYA_ID: string = "00000000-0000-4000-8000-000000000005";

// Rules (TeamComplianceSetting ids).
export const EMAIL_RULE_ID: string = "00000000-0000-4000-8000-0000000000a1";
export const CALL_RULE_ID: string = "00000000-0000-4000-8000-0000000000a2";
export const ALERT_RULE_ID: string = "00000000-0000-4000-8000-0000000000a3";
export const PAUSED_RULE_ID: string = "00000000-0000-4000-8000-0000000000a4";

// Severities.
export const CRITICAL_ID: string = "00000000-0000-4000-8000-0000000000c1";
export const MAJOR_ID: string = "00000000-0000-4000-8000-0000000000c2";

export const EVALUATED_AT: string = "2026-09-28T10:00:00.000Z";

export const buildRule: (
  overrides?: Partial<TeamComplianceRuleJSON>,
) => TeamComplianceRuleJSON = (
  overrides?: Partial<TeamComplianceRuleJSON>,
): TeamComplianceRuleJSON => {
  return {
    settingId: EMAIL_RULE_ID,
    ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    enabled: true,
    notificationChannels: [],
    severityKind: null,
    appliesToAllSeverities: false,
    severities: [],
    compliantCount: 0,
    nonCompliantCount: 0,
    warnings: [],
    ...(overrides || {}),
  };
};

// "Verified email", method rule.
export const emailRule: (
  overrides?: Partial<TeamComplianceRuleJSON>,
) => TeamComplianceRuleJSON = (
  overrides?: Partial<TeamComplianceRuleJSON>,
): TeamComplianceRuleJSON => {
  return buildRule({
    settingId: EMAIL_RULE_ID,
    ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    ...(overrides || {}),
  });
};

// "Call for incidents", scoped to Critical Incident and Major Incident.
export const callForIncidentsRule: (
  overrides?: Partial<TeamComplianceRuleJSON>,
) => TeamComplianceRuleJSON = (
  overrides?: Partial<TeamComplianceRuleJSON>,
): TeamComplianceRuleJSON => {
  return buildRule({
    settingId: CALL_RULE_ID,
    ruleType: ComplianceRuleType.HasIncidentOnCallRules,
    notificationChannels: [ComplianceNotificationChannel.Call],
    severityKind: ComplianceSeverityKind.Incident,
    appliesToAllSeverities: false,
    severities: [
      { id: CRITICAL_ID, name: "Critical Incident", color: "#ff0000" },
      { id: MAJOR_ID, name: "Major Incident" },
    ],
    ...(overrides || {}),
  });
};

export const CALL_AND_PUSH_RULE_ID: string =
  "00000000-0000-4000-8000-0000000000a7";

/*
 * "Call and Push notification for incidents", scoped to Critical Incident: a
 * rule on two channels, which a member meets only with a rule on each.
 */
export const callAndPushForIncidentsRule: (
  overrides?: Partial<TeamComplianceRuleJSON>,
) => TeamComplianceRuleJSON = (
  overrides?: Partial<TeamComplianceRuleJSON>,
): TeamComplianceRuleJSON => {
  return callForIncidentsRule({
    settingId: CALL_AND_PUSH_RULE_ID,
    notificationChannels: [
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ],
    severities: [
      { id: CRITICAL_ID, name: "Critical Incident", color: "#ff0000" },
    ],
    ...(overrides || {}),
  });
};

// "Alert on-call rules", any channel, every alert severity.
export const alertRule: (
  overrides?: Partial<TeamComplianceRuleJSON>,
) => TeamComplianceRuleJSON = (
  overrides?: Partial<TeamComplianceRuleJSON>,
): TeamComplianceRuleJSON => {
  return buildRule({
    settingId: ALERT_RULE_ID,
    ruleType: ComplianceRuleType.HasAlertOnCallRules,
    notificationChannels: [],
    severityKind: ComplianceSeverityKind.Alert,
    appliesToAllSeverities: true,
    severities: [],
    ...(overrides || {}),
  });
};

export const EVERY_SEVERITY_CALL_RULE_ID: string =
  "00000000-0000-4000-8000-0000000000a5";
export const NO_SEVERITIES_LEFT_RULE_ID: string =
  "00000000-0000-4000-8000-0000000000a6";

// The server's warning on a rule whose every severity has been deleted.
export const SEVERITIES_DELETED_WARNING: string =
  "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.";

// "Call for incidents" for every incident severity.
export const callForEveryIncidentRule: (
  overrides?: Partial<TeamComplianceRuleJSON>,
) => TeamComplianceRuleJSON = (
  overrides?: Partial<TeamComplianceRuleJSON>,
): TeamComplianceRuleJSON => {
  return callForIncidentsRule({
    settingId: EVERY_SEVERITY_CALL_RULE_ID,
    appliesToAllSeverities: true,
    severities: [],
    ...(overrides || {}),
  });
};

/*
 * "Call for incidents" whose every severity has since been deleted, exactly
 * as the server sends it: paused, no severities, NOT every severity, no
 * counts, and the warning saying why - sent although the rule is paused.
 */
export const noSeveritiesLeftRule: (
  overrides?: Partial<TeamComplianceRuleJSON>,
) => TeamComplianceRuleJSON = (
  overrides?: Partial<TeamComplianceRuleJSON>,
): TeamComplianceRuleJSON => {
  return callForIncidentsRule({
    settingId: NO_SEVERITIES_LEFT_RULE_ID,
    enabled: false,
    appliesToAllSeverities: false,
    severities: [],
    compliantCount: 0,
    nonCompliantCount: 0,
    warnings: [SEVERITIES_DELETED_WARNING],
    ...(overrides || {}),
  });
};

export const buildMember: (
  overrides?: Partial<TeamMemberComplianceJSON>,
) => TeamMemberComplianceJSON = (
  overrides?: Partial<TeamMemberComplianceJSON>,
): TeamMemberComplianceJSON => {
  const nonCompliantRules: Array<TeamComplianceIssueJSON> =
    overrides?.nonCompliantRules || [];

  return {
    userId: JANE_ID,
    userName: "Jane Doe",
    userEmail: "jane@acme.com",
    isCompliant: nonCompliantRules.length === 0,
    nonCompliantRules: nonCompliantRules,
    ...(overrides || {}),
  };
};

export const issue: (
  rule: TeamComplianceRuleJSON,
  reason: string,
) => TeamComplianceIssueJSON = (
  rule: TeamComplianceRuleJSON,
  reason: string,
): TeamComplianceIssueJSON => {
  return {
    settingId: rule.settingId,
    ruleType: rule.ruleType,
    reason: reason,
  };
};

export const EMAIL_REASON: string =
  "No verified email address configured for notifications";
export const CALL_REASON: string =
  "No Call rule for incident severities: Critical Incident";

export const buildStatus: (
  overrides?: Partial<TeamComplianceStatusJSON>,
) => TeamComplianceStatusJSON = (
  overrides?: Partial<TeamComplianceStatusJSON>,
): TeamComplianceStatusJSON => {
  return {
    teamId: TEAM_ID.toString(),
    teamName: "Platform On-Call",
    evaluatedAt: EVALUATED_AT,
    complianceSettings: [],
    userComplianceStatuses: [],
    ...(overrides || {}),
  };
};

/*
 * The team most tests start from: two active rules (email, Call for
 * incidents) and three members - Jane fails both, Omar fails the Call rule,
 * Priya passes everything.
 */
export const standardStatus: () => TeamComplianceStatusJSON =
  (): TeamComplianceStatusJSON => {
    const email: TeamComplianceRuleJSON = emailRule({
      compliantCount: 2,
      nonCompliantCount: 1,
    });
    const call: TeamComplianceRuleJSON = callForIncidentsRule({
      compliantCount: 1,
      nonCompliantCount: 2,
    });

    return buildStatus({
      complianceSettings: [email, call],
      userComplianceStatuses: [
        buildMember({
          userId: PRIYA_ID,
          userName: "Priya Patel",
          userEmail: "priya@acme.com",
        }),
        buildMember({
          userId: OMAR_ID,
          userName: "Omar Haddad",
          userEmail: "omar@acme.com",
          nonCompliantRules: [issue(call, CALL_REASON)],
        }),
        buildMember({
          userId: JANE_ID,
          userName: "Jane Doe",
          userEmail: "jane@acme.com",
          nonCompliantRules: [
            issue(email, EMAIL_REASON),
            issue(call, CALL_REASON),
          ],
        }),
      ],
    });
  };
