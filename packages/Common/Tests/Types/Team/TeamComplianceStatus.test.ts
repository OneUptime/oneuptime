import ComplianceNotificationChannel from "../../../Types/Team/ComplianceNotificationChannel";
import { ComplianceSeverityKind } from "../../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import {
  TeamComplianceIssueJSON,
  TeamComplianceRuleJSON,
  TeamComplianceSeverityJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "../../../Types/Team/TeamComplianceStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * TeamComplianceStatusJSON is the body of GET /team/compliance-status/:teamId:
 * the ee server builds exactly this and the Dashboard renders exactly this, in
 * two packages that only meet here. Changing a key is therefore a change to
 * both sides at once, and has to be made on purpose.
 *
 * The key sets are pinned at the TYPE level - `Equals<keyof X, ...>` stops
 * compiling (npm run compile-tests) the moment a key is added, renamed or
 * dropped - and a fixture typed against the contract shows it is plain JSON:
 * it survives JSON.stringify/parse unchanged, so no ObjectID, Date or class
 * instance can hide in it.
 */

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const STATUS_KEYS: Equals<
  keyof TeamComplianceStatusJSON,
  | "teamId"
  | "teamName"
  | "evaluatedAt"
  | "complianceSettings"
  | "userComplianceStatuses"
> = true;

const RULE_KEYS: Equals<
  keyof TeamComplianceRuleJSON,
  | "settingId"
  | "ruleType"
  | "enabled"
  | "notificationChannel"
  | "severityKind"
  | "appliesToAllSeverities"
  | "severities"
  | "compliantCount"
  | "nonCompliantCount"
  | "warnings"
> = true;

const SEVERITY_KEYS: Equals<
  keyof TeamComplianceSeverityJSON,
  "id" | "name" | "color"
> = true;

const MEMBER_KEYS: Equals<
  keyof TeamMemberComplianceJSON,
  | "userId"
  | "userName"
  | "userEmail"
  | "userProfilePictureId"
  | "isCompliant"
  | "nonCompliantRules"
> = true;

const ISSUE_KEYS: Equals<
  keyof TeamComplianceIssueJSON,
  "settingId" | "ruleType" | "reason"
> = true;

// Null, not undefined, is how "any channel" and "no severity kind" cross the wire.
const NULLABLE_FIELDS: Equals<
  [
    TeamComplianceRuleJSON["notificationChannel"],
    TeamComplianceRuleJSON["severityKind"],
  ],
  [ComplianceNotificationChannel | null, ComplianceSeverityKind | null]
> = true;

const EXAMPLE: TeamComplianceStatusJSON = {
  teamId: "33333333-3333-4333-8333-333333333333",
  teamName: "Platform On-Call",
  evaluatedAt: "2026-09-28T10:00:00.000Z",
  complianceSettings: [
    {
      settingId: "66666666-6666-4666-8666-000000000001",
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: true,
      notificationChannel: ComplianceNotificationChannel.Call,
      severityKind: ComplianceSeverityKind.Incident,
      appliesToAllSeverities: false,
      severities: [
        {
          id: "c1c1c1c1-0000-4000-8000-000000000001",
          name: "Critical Incident",
          color: "#ef4444",
        },
      ],
      compliantCount: 1,
      nonCompliantCount: 1,
      warnings: [
        "Call notifications are switched off for this project, so members will not be notified by Call even when they meet this rule. Turn them on in Project Settings > Notification Settings.",
      ],
    },
    {
      settingId: "66666666-6666-4666-8666-000000000002",
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      enabled: false,
      notificationChannel: null,
      severityKind: null,
      appliesToAllSeverities: false,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 0,
      warnings: [],
    },
  ],
  userComplianceStatuses: [
    {
      userId: "55555555-5555-4555-8555-555555555555",
      userName: "Jane Doe",
      userEmail: "jane@example.com",
      userProfilePictureId: "77777777-7777-4777-8777-777777777777",
      isCompliant: false,
      nonCompliantRules: [
        {
          settingId: "66666666-6666-4666-8666-000000000001",
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          reason: "No Call rule for incident severities: Critical Incident",
        },
      ],
    },
    {
      userId: "88888888-8888-4888-8888-888888888888",
      userName: "Unknown User",
      userEmail: "",
      isCompliant: true,
      nonCompliantRules: [],
    },
  ],
};

describe("TeamComplianceStatusJSON - the wire contract", () => {
  test("every key set is pinned at the type level", () => {
    expect([
      STATUS_KEYS,
      RULE_KEYS,
      SEVERITY_KEYS,
      MEMBER_KEYS,
      ISSUE_KEYS,
      NULLABLE_FIELDS,
    ]).toEqual([true, true, true, true, true, true]);
  });

  test("a status is plain JSON: it survives a trip over the wire unchanged", () => {
    expect(JSON.parse(JSON.stringify(EXAMPLE))).toEqual(EXAMPLE);
  });

  test("'any channel' and 'no severity kind' are sent as null, not dropped", () => {
    const sent: string = JSON.stringify(EXAMPLE.complianceSettings[1]);

    expect(sent).toContain('"notificationChannel":null');
    expect(sent).toContain('"severityKind":null');
  });

  test("rule types and channels travel as their stored string values", () => {
    const sent: string = JSON.stringify(EXAMPLE);

    expect(sent).toContain('"ruleType":"HasIncidentOnCallRules"');
    expect(sent).toContain('"notificationChannel":"Call"');
    expect(sent).toContain('"severityKind":"Incident"');
  });
});
