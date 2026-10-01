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
 *
 * A rule's channels cross the wire as one list, `notificationChannels`: every
 * channel a member needs a rule on, empty for "any channel". The single
 * `notificationChannel` an older API sent is gone from the contract (the
 * Dashboard still reads it from an older replica during a rolling deploy).
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
  | "notificationChannels"
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

/*
 * "Any channel" is an empty list - never null, never a missing key - and "no
 * severity kind" is null, not undefined, so neither is dropped on the way.
 */
const CHANNELS_AND_KIND: Equals<
  [
    TeamComplianceRuleJSON["notificationChannels"],
    TeamComplianceRuleJSON["severityKind"],
  ],
  [Array<ComplianceNotificationChannel>, ComplianceSeverityKind | null]
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
      notificationChannels: [ComplianceNotificationChannel.Call],
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
      notificationChannels: [],
      severityKind: null,
      appliesToAllSeverities: false,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 0,
      warnings: [],
    },
    {
      // "Call and Push notification for alerts", every alert severity.
      settingId: "66666666-6666-4666-8666-000000000003",
      ruleType: ComplianceRuleType.HasAlertOnCallRules,
      enabled: true,
      notificationChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ],
      severityKind: ComplianceSeverityKind.Alert,
      appliesToAllSeverities: true,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 2,
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
        {
          settingId: "66666666-6666-4666-8666-000000000003",
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          reason: "No Push notification rule for alert severities: High",
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
      CHANNELS_AND_KIND,
    ]).toEqual([true, true, true, true, true, true]);
  });

  test("a status is plain JSON: it survives a trip over the wire unchanged", () => {
    expect(JSON.parse(JSON.stringify(EXAMPLE))).toEqual(EXAMPLE);
  });

  test("'any channel' is sent as an empty list and 'no severity kind' as null - neither is dropped", () => {
    const sent: string = JSON.stringify(EXAMPLE.complianceSettings[1]);

    expect(sent).toContain('"notificationChannels":[]');
    expect(sent).toContain('"severityKind":null');
  });

  test("rule types and channels travel as their stored string values", () => {
    const sent: string = JSON.stringify(EXAMPLE);

    expect(sent).toContain('"ruleType":"HasIncidentOnCallRules"');
    expect(sent).toContain('"notificationChannels":["Call"]');
    expect(sent).toContain('"severityKind":"Incident"');
  });

  test("a rule on several channels sends every one of them, as one list, in the order given", () => {
    const sent: string = JSON.stringify(EXAMPLE.complianceSettings[2]);

    expect(sent).toContain('"notificationChannels":["Call","Push"]');
    expect(
      (JSON.parse(sent) as TeamComplianceRuleJSON).notificationChannels,
    ).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
  });

  test("no rule carries the single notificationChannel key any more", () => {
    const sent: string = JSON.stringify(EXAMPLE);

    // `"notificationChannels"` does not contain the closed key `"notificationChannel"`.
    expect(sent).not.toContain('"notificationChannel"');

    for (const rule of EXAMPLE.complianceSettings) {
      expect(Object.keys(rule)).not.toContain("notificationChannel");
      expect(Array.isArray(rule.notificationChannels)).toBe(true);
    }
  });
});
