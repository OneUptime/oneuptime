import TeamComplianceEvaluator, {
  ComplianceCoverageCellInput,
  ComplianceLoadPlan,
  ComplianceMemberInput,
  ComplianceMethodInput,
  ComplianceNotificationRuleInput,
  ComplianceRuleInput,
  ComplianceSeverityInput,
  METHOD_RULE_FAILURE_REASONS,
  PROJECT_CHANNEL_SWITCHES,
  ProjectChannelSwitch,
  ResolvedComplianceRule,
  SEVERITIES_DELETED_WARNING,
  TeamComplianceEvaluationInput,
  UNKNOWN_RULE_TYPE_WARNING,
  WHATSAPP_SWITCHED_OFF_WARNING,
} from "../../../Server/TeamCompliance/TeamComplianceEvaluator";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
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
import { describe, expect, test } from "@jest/globals";

/*
 * TeamComplianceEvaluator is the whole of the compliance JUDGEMENT - who
 * passes which rule, why not, what each rule warns about and the exact JSON the
 * Dashboard renders - as pure functions over data the service has already
 * read. Nothing here is mocked because nothing here reads anything: every test
 * builds the loaded data by hand and asserts on the verdict.
 *
 * The reading half (which queries run, how they are batched and scoped) is
 * TeamComplianceServiceBehaviour.test.ts; the route end to end, with the real
 * readiness service, is TeamComplianceAPI.test.ts.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "99999999-9999-4999-8999-999999999999";
const TEAM_ID: string = "22222222-2222-4222-8222-222222222222";

const ADA: string = "aaaaaaaa-0000-4000-8000-000000000001";
const GRACE: string = "aaaaaaaa-0000-4000-8000-000000000002";
const LINUS: string = "aaaaaaaa-0000-4000-8000-000000000003";

const CRITICAL: ComplianceSeverityInput = {
  id: "5e000000-0000-4000-8000-000000000001",
  name: "Critical Incident",
  color: "#9f1239",
  order: 1,
  projectId: PROJECT_ID,
};
const MAJOR: ComplianceSeverityInput = {
  id: "5e000000-0000-4000-8000-000000000002",
  name: "Major Incident",
  color: "#dc2626",
  order: 2,
  projectId: PROJECT_ID,
};
const MINOR: ComplianceSeverityInput = {
  id: "5e000000-0000-4000-8000-000000000003",
  name: "Minor Incident",
  order: 3,
  projectId: PROJECT_ID,
};
const HIGH: ComplianceSeverityInput = {
  id: "a5000000-0000-4000-8000-000000000001",
  name: "High",
  color: "#ef4444",
  order: 1,
  projectId: PROJECT_ID,
};
const LOW: ComplianceSeverityInput = {
  id: "a5000000-0000-4000-8000-000000000002",
  name: "Low",
  order: 2,
  projectId: PROJECT_ID,
};
// A severity from somebody else's project, which must never be honoured.
const FOREIGN: ComplianceSeverityInput = {
  id: "f0000000-0000-4000-8000-000000000001",
  name: "Somebody Else's Sev1",
  order: 0,
  projectId: OTHER_PROJECT_ID,
};

const INCIDENT_SEVERITIES: Array<ComplianceSeverityInput> = [
  CRITICAL,
  MAJOR,
  MINOR,
];
const ALERT_SEVERITIES: Array<ComplianceSeverityInput> = [HIGH, LOW];

let settingCounter: number = 0;

function rule(data: {
  ruleType: ComplianceRuleType | string | undefined;
  enabled?: boolean | undefined;
  notificationChannel?: string | null | undefined;
  incidentSeverities?: Array<ComplianceSeverityInput> | undefined;
  alertSeverities?: Array<ComplianceSeverityInput> | undefined;
  settingId?: string | undefined;
  createdAt?: Date | undefined;
  severitiesDeleted?: boolean | undefined;
}): ComplianceRuleInput {
  settingCounter++;

  return {
    ...(data.severitiesDeleted !== undefined
      ? { severitiesDeleted: data.severitiesDeleted }
      : {}),
    settingId:
      data.settingId ||
      `5e771000-0000-4000-8000-${settingCounter.toString().padStart(12, "0")}`,
    ruleType: data.ruleType,
    enabled: data.enabled === undefined ? true : data.enabled,
    notificationChannel: data.notificationChannel,
    createdAt:
      "createdAt" in data
        ? data.createdAt
        : new Date(Date.UTC(2026, 0, 1, 0, 0, settingCounter)),
    incidentSeverities: data.incidentSeverities || [],
    alertSeverities: data.alertSeverities || [],
  };
}

function member(userId: string, name?: string): ComplianceMemberInput {
  return {
    userId: userId,
    name: name,
    email: name ? `${name.toLowerCase()}@example.com` : undefined,
  };
}

function cell(data: {
  ruleType: NotificationRuleType;
  severity?: ComplianceSeverityInput | undefined;
  hasRule?: boolean | undefined;
  isOptOut?: boolean | undefined;
  severityName?: string | undefined;
}): ComplianceCoverageCellInput {
  return {
    ruleType: data.ruleType,
    severityId: data.severity ? new ObjectID(data.severity.id) : undefined,
    severityName:
      "severityName" in data ? data.severityName : data.severity?.name,
    hasRule: data.hasRule === true,
    isOptOut: data.isOptOut === true,
  };
}

function notificationRule(data: {
  userId: string;
  ruleType: NotificationRuleType;
  incidentSeverity?: ComplianceSeverityInput | undefined;
  alertSeverity?: ComplianceSeverityInput | undefined;
  isOptOut?: boolean | undefined;
  methodIds?:
    | Partial<Record<ComplianceNotificationChannel, string>>
    | undefined;
}): ComplianceNotificationRuleInput {
  return {
    userId: data.userId,
    ruleType: data.ruleType,
    incidentSeverityId: data.incidentSeverity?.id,
    alertSeverityId: data.alertSeverity?.id,
    isOptOut: data.isOptOut === true,
    methodIds: data.methodIds || {},
  };
}

function methods(
  channel: ComplianceNotificationChannel,
  rows: Array<ComplianceMethodInput>,
): Map<ComplianceNotificationChannel, Map<string, ComplianceMethodInput>> {
  return new Map<
    ComplianceNotificationChannel,
    Map<string, ComplianceMethodInput>
  >([
    [
      channel,
      new Map<string, ComplianceMethodInput>(
        rows.map(
          (row: ComplianceMethodInput): [string, ComplianceMethodInput] => {
            return [row.methodId, row];
          },
        ),
      ),
    ],
  ]);
}

function buildInput(
  overrides: Partial<TeamComplianceEvaluationInput>,
): TeamComplianceEvaluationInput {
  return {
    teamId: TEAM_ID,
    teamName: "Platform On-Call",
    projectId: PROJECT_ID,
    evaluatedAt: new Date("2026-09-28T10:00:00.000Z"),
    rules: [],
    members: [member(ADA, "Ada")],
    coverageByUserId: new Map<string, Array<ComplianceCoverageCellInput>>(),
    verifiedMethodOwnersByChannel: new Map<
      ComplianceNotificationChannel,
      Set<string>
    >(),
    projectSeveritiesByKind: new Map<
      ComplianceSeverityKind,
      Array<ComplianceSeverityInput>
    >([
      [ComplianceSeverityKind.Incident, INCIDENT_SEVERITIES],
      [ComplianceSeverityKind.Alert, ALERT_SEVERITIES],
    ]),
    notificationRules: [],
    methodsByChannel: new Map<
      ComplianceNotificationChannel,
      Map<string, ComplianceMethodInput>
    >(),
    projectSwitches: null,
    ...overrides,
  };
}

function evaluate(
  overrides: Partial<TeamComplianceEvaluationInput>,
): TeamComplianceStatusJSON {
  return TeamComplianceEvaluator.evaluate(buildInput(overrides));
}

function statusOf(
  result: TeamComplianceStatusJSON,
  userId: string,
): TeamMemberComplianceJSON {
  const status: TeamMemberComplianceJSON | undefined =
    result.userComplianceStatuses.find(
      (candidate: TeamMemberComplianceJSON): boolean => {
        return candidate.userId === userId;
      },
    );

  if (!status) {
    throw new Error(`No status for ${userId}`);
  }

  return status;
}

// The reasons a member fails, in rule order.
function reasonsOf(
  result: TeamComplianceStatusJSON,
  userId: string,
): Array<string> {
  return statusOf(result, userId).nonCompliantRules.map(
    (issue: TeamComplianceIssueJSON): string => {
      return issue.reason;
    },
  );
}

function onlyRule(result: TeamComplianceStatusJSON): TeamComplianceRuleJSON {
  expect(result.complianceSettings).toHaveLength(1);
  return result.complianceSettings[0]!;
}

// Ada, evaluated against exactly one rule: her reason, or null when she passes.
function adaVerdict(
  complianceRule: ComplianceRuleInput,
  overrides: Partial<TeamComplianceEvaluationInput> = {},
): string | null {
  const result: TeamComplianceStatusJSON = evaluate({
    rules: [complianceRule],
    ...overrides,
  });
  const reasons: Array<string> = reasonsOf(result, ADA);

  expect(reasons.length).toBeLessThanOrEqual(1);

  return reasons[0] === undefined ? null : reasons[0];
}

function coverageFor(
  cells: Array<ComplianceCoverageCellInput>,
  userId: string = ADA,
): Map<string, Array<ComplianceCoverageCellInput>> {
  return new Map<string, Array<ComplianceCoverageCellInput>>([[userId, cells]]);
}

function resolveOne(
  complianceRule: ComplianceRuleInput,
): ResolvedComplianceRule {
  const resolved: Array<ResolvedComplianceRule> =
    TeamComplianceEvaluator.resolveRules([complianceRule], PROJECT_ID);
  expect(resolved).toHaveLength(1);
  return resolved[0]!;
}

function plan(rules: Array<ComplianceRuleInput>): ComplianceLoadPlan {
  return TeamComplianceEvaluator.planLoads(
    TeamComplianceEvaluator.resolveRules(rules, PROJECT_ID),
  );
}

// The on-call rule types, with what each one reads and how it is worded.
const ON_CALL_RULES: Array<
  [ComplianceRuleType, NotificationRuleType, string, ComplianceSeverityKind]
> = [
  [
    ComplianceRuleType.HasIncidentOnCallRules,
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    "incident",
    ComplianceSeverityKind.Incident,
  ],
  [
    ComplianceRuleType.HasAlertOnCallRules,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    "alert",
    ComplianceSeverityKind.Alert,
  ],
  [
    ComplianceRuleType.HasIncidentEpisodeOnCallRules,
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    "incident episode",
    ComplianceSeverityKind.Incident,
  ],
  [
    ComplianceRuleType.HasAlertEpisodeOnCallRules,
    NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    "alert episode",
    ComplianceSeverityKind.Alert,
  ],
];

function severitiesOfKind(
  kind: ComplianceSeverityKind,
): Array<ComplianceSeverityInput> {
  return kind === ComplianceSeverityKind.Incident
    ? INCIDENT_SEVERITIES
    : ALERT_SEVERITIES;
}

// A rule scoped to `selected`, putting them in the list the rule's kind uses.
function scopedRule(data: {
  ruleType: ComplianceRuleType;
  kind: ComplianceSeverityKind;
  selected: Array<ComplianceSeverityInput>;
  notificationChannel?: ComplianceNotificationChannel | undefined;
}): ComplianceRuleInput {
  return rule({
    ruleType: data.ruleType,
    notificationChannel: data.notificationChannel,
    incidentSeverities:
      data.kind === ComplianceSeverityKind.Incident ? data.selected : [],
    alertSeverities:
      data.kind === ComplianceSeverityKind.Alert ? data.selected : [],
  });
}

// A notification rule for Ada of `ruleType`, addressed by `severity`.
function adaRuleFor(data: {
  ruleType: NotificationRuleType;
  kind: ComplianceSeverityKind;
  severity: ComplianceSeverityInput;
  methodIds?:
    | Partial<Record<ComplianceNotificationChannel, string>>
    | undefined;
  isOptOut?: boolean | undefined;
  userId?: string | undefined;
}): ComplianceNotificationRuleInput {
  return notificationRule({
    userId: data.userId || ADA,
    ruleType: data.ruleType,
    incidentSeverity:
      data.kind === ComplianceSeverityKind.Incident ? data.severity : undefined,
    alertSeverity:
      data.kind === ComplianceSeverityKind.Alert ? data.severity : undefined,
    methodIds: data.methodIds,
    isOptOut: data.isOptOut,
  });
}

const CALL_ID: string = "ca110000-0000-4000-8000-000000000001";
const CALL_ID_2: string = "ca110000-0000-4000-8000-000000000002";
const PUSH_ID: string = "b0500000-0000-4000-8000-000000000001";
const EMAIL_ID: string = "e3a10000-0000-4000-8000-000000000001";
const WEBHOOK_ID: string = "3eb00000-0000-4000-8000-000000000001";

const CALL_FOR_CRITICAL_INCIDENTS: () => ComplianceRuleInput =
  (): ComplianceRuleInput => {
    return rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [CRITICAL],
    });
  };

/*
 * ------------------------------------------------------------------------- *
 * resolveRules - the stored rows, checked against the catalog.
 * -------------------------------------------------------------------------
 */

describe("resolveRules", () => {
  test("lists rules oldest first, whatever order the rows arrived in", () => {
    const first: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      settingId: "cccccccc-0000-4000-8000-000000000003",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const second: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationCallMethod,
      settingId: "aaaaaaaa-0000-4000-8000-000000000001",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });
    const third: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      settingId: "bbbbbbbb-0000-4000-8000-000000000002",
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });

    const resolved: Array<ResolvedComplianceRule> =
      TeamComplianceEvaluator.resolveRules([third, first, second], PROJECT_ID);

    expect(
      resolved.map((entry: ResolvedComplianceRule): string => {
        return entry.settingId;
      }),
    ).toEqual([first.settingId, second.settingId, third.settingId]);
  });

  test("rules created in the same instant are ordered by id, and a rule with no timestamp goes last", () => {
    const sameTime: Date = new Date("2026-01-01T00:00:00Z");
    const undated: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      settingId: "00000000-0000-4000-8000-000000000000",
      createdAt: undefined,
    });
    const b: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      settingId: "bbbbbbbb-0000-4000-8000-000000000000",
      createdAt: sameTime,
    });
    const a: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      settingId: "aaaaaaaa-0000-4000-8000-000000000000",
      createdAt: sameTime,
    });

    expect(
      TeamComplianceEvaluator.resolveRules([undated, b, a], PROJECT_ID).map(
        (entry: ResolvedComplianceRule): string => {
          return entry.settingId;
        },
      ),
    ).toEqual([a.settingId, b.settingId, undated.settingId]);
  });

  test("a method rule carries no channel and no severities, whatever the row holds", () => {
    const resolved: ResolvedComplianceRule = resolveOne(
      rule({
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL],
        alertSeverities: [HIGH],
      }),
    );

    expect(resolved.definition?.ruleType).toBe(
      ComplianceRuleType.HasNotificationEmailMethod,
    );
    expect(resolved.notificationChannel).toBeNull();
    expect(resolved.severityKind).toBeNull();
    expect(resolved.severities).toEqual([]);
  });

  test.each(ON_CALL_RULES)(
    "%s keeps only the severity list of its own kind",
    (
      ruleType: ComplianceRuleType,
      _notificationRuleType: NotificationRuleType,
      _subject: string,
      kind: ComplianceSeverityKind,
    ) => {
      const resolved: ResolvedComplianceRule = resolveOne(
        rule({
          ruleType: ruleType,
          notificationChannel: ComplianceNotificationChannel.Push,
          incidentSeverities: [CRITICAL],
          alertSeverities: [HIGH],
        }),
      );

      expect(resolved.severityKind).toBe(kind);
      expect(resolved.notificationChannel).toBe(
        ComplianceNotificationChannel.Push,
      );
      expect(
        resolved.severities.map((severity: ComplianceSeverityInput): string => {
          return severity.id;
        }),
      ).toEqual([
        kind === ComplianceSeverityKind.Incident ? CRITICAL.id : HIGH.id,
      ]);
    },
  );

  test("selected severities are put most severe first, de-duplicated, and one with no order goes last", () => {
    const unordered: ComplianceSeverityInput = {
      id: "5e000000-0000-4000-8000-0000000000ff",
      name: "Unranked",
      projectId: PROJECT_ID,
    };

    const resolved: ResolvedComplianceRule = resolveOne(
      rule({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverities: [unordered, MINOR, CRITICAL, MINOR, MAJOR],
      }),
    );

    expect(
      resolved.severities.map((severity: ComplianceSeverityInput): string => {
        return severity.name || "";
      }),
    ).toEqual([
      "Critical Incident",
      "Major Incident",
      "Minor Incident",
      "Unranked",
    ]);
  });

  test("SECURITY: a selected severity from another project - or of unknown project - is dropped", () => {
    const unknownProject: ComplianceSeverityInput = {
      id: "5e000000-0000-4000-8000-0000000000ee",
      name: "Orphan",
      order: 1,
    };

    const resolved: ResolvedComplianceRule = resolveOne(
      rule({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        incidentSeverities: [FOREIGN, unknownProject, MAJOR],
      }),
    );

    expect(resolved.severities).toEqual([MAJOR]);
  });

  test("an unrecognised rule type is kept, but interpreted as nothing", () => {
    const resolved: ResolvedComplianceRule = resolveOne(
      rule({
        ruleType: "HasCarrierPigeon",
        notificationChannel: ComplianceNotificationChannel.Call,
        incidentSeverities: [CRITICAL],
      }),
    );

    expect(resolved.ruleType).toBe("HasCarrierPigeon");
    expect(resolved.definition).toBeUndefined();
    expect(resolved.notificationChannel).toBeNull();
    expect(resolved.severityKind).toBeNull();
    expect(resolved.severities).toEqual([]);
  });

  test("a channel value that is not a channel reads as any channel", () => {
    expect(
      resolveOne(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: "CarrierPigeon",
        }),
      ).notificationChannel,
    ).toBeNull();
  });

  test("an unset enabled flag is off", () => {
    expect(
      resolveOne({
        ...rule({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
        enabled: undefined,
      }).enabled,
    ).toBe(false);
  });
});

/*
 * ------------------------------------------------------------------------- *
 * planLoads - what the service must read, and nothing more.
 * -------------------------------------------------------------------------
 */

describe("planLoads", () => {
  test("no rules means nothing to read", () => {
    expect(plan([])).toEqual({
      needsCoverage: false,
      methodChannels: [],
      onCallChannels: [],
      onCallRuleTypes: [],
      onCallSeverityKinds: [],
      projectSwitches: [],
    });
  });

  test("a method rule needs only its channel's methods", () => {
    expect(
      plan([rule({ ruleType: ComplianceRuleType.HasNotificationEmailMethod })]),
    ).toEqual({
      needsCoverage: false,
      methodChannels: [ComplianceNotificationChannel.Email],
      onCallChannels: [],
      onCallRuleTypes: [],
      onCallSeverityKinds: [],
      projectSwitches: [],
    });
  });

  test.each<[ComplianceNotificationChannel, ProjectChannelSwitch | undefined]>([
    [ComplianceNotificationChannel.Call, "enableCallNotifications"],
    [ComplianceNotificationChannel.SMS, "enableSmsNotifications"],
    /*
     * WhatsApp's switch does not stop pages being sent, but it stops members
     * adding a number: see PROJECT_CHANNEL_SWITCHES.
     */
    [ComplianceNotificationChannel.WhatsApp, "enableWhatsAppNotifications"],
    [ComplianceNotificationChannel.Telegram, "enableTelegramNotifications"],
    [ComplianceNotificationChannel.Push, undefined],
    [ComplianceNotificationChannel.Email, undefined],
    [ComplianceNotificationChannel.Slack, undefined],
    [ComplianceNotificationChannel.MicrosoftTeams, undefined],
    [ComplianceNotificationChannel.Webhook, undefined],
  ])(
    "%s: the project switch read is %s",
    (
      channel: ComplianceNotificationChannel,
      projectSwitch: ProjectChannelSwitch | undefined,
    ) => {
      expect(PROJECT_CHANNEL_SWITCHES[channel]).toBe(projectSwitch);

      const methodPlan: ComplianceLoadPlan = plan([
        rule({ ruleType: `HasNotification${channel}Method` }),
      ]);
      const onCallPlan: ComplianceLoadPlan = plan([
        rule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: channel,
        }),
      ]);

      const expected: Array<ProjectChannelSwitch> = projectSwitch
        ? [projectSwitch]
        : [];

      expect(methodPlan.methodChannels).toEqual([channel]);
      expect(methodPlan.projectSwitches).toEqual(expected);
      expect(onCallPlan.onCallChannels).toEqual([channel]);
      expect(onCallPlan.projectSwitches).toEqual(expected);
    },
  );

  test("an on-call rule with no channel needs readiness coverage and nothing else", () => {
    expect(
      plan([
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [CRITICAL],
        }),
      ]),
    ).toEqual({
      needsCoverage: true,
      methodChannels: [],
      onCallChannels: [],
      onCallRuleTypes: [],
      onCallSeverityKinds: [],
      projectSwitches: [],
    });
  });

  test("an on-call rule with a channel needs its rule type, its severity kind, its channel and its switch", () => {
    expect(plan([CALL_FOR_CRITICAL_INCIDENTS()])).toEqual({
      needsCoverage: false,
      methodChannels: [],
      onCallChannels: [ComplianceNotificationChannel.Call],
      onCallRuleTypes: [NotificationRuleType.ON_CALL_EXECUTED_INCIDENT],
      onCallSeverityKinds: [ComplianceSeverityKind.Incident],
      projectSwitches: ["enableCallNotifications"],
    });
  });

  test("disabled and unrecognised rules plan nothing at all", () => {
    expect(
      plan([
        rule({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          enabled: false,
        }),
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: false,
        }),
        {
          ...CALL_FOR_CRITICAL_INCIDENTS(),
          enabled: false,
        },
        rule({ ruleType: "HasCarrierPigeon" }),
      ]),
    ).toEqual({
      needsCoverage: false,
      methodChannels: [],
      onCallChannels: [],
      onCallRuleTypes: [],
      onCallSeverityKinds: [],
      projectSwitches: [],
    });
  });

  test("many rules plan each read once, in catalog order", () => {
    expect(
      plan([
        rule({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Telegram,
        }),
        rule({ ruleType: ComplianceRuleType.HasNotificationSMSMethod }),
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
        rule({
          ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
        rule({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
        rule({ ruleType: ComplianceRuleType.HasNotificationSMSMethod }),
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [CRITICAL],
        }),
        rule({ ruleType: ComplianceRuleType.HasAlertOnCallRules }),
      ]),
    ).toEqual({
      needsCoverage: true,
      methodChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.SMS,
      ],
      onCallChannels: [
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Telegram,
      ],
      onCallRuleTypes: [
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      ],
      onCallSeverityKinds: [
        ComplianceSeverityKind.Incident,
        ComplianceSeverityKind.Alert,
      ],
      projectSwitches: [
        "enableCallNotifications",
        "enableSmsNotifications",
        "enableTelegramNotifications",
      ],
    });
  });
});

/*
 * ------------------------------------------------------------------------- *
 * Method rules - "has a verified <channel> method".
 * -------------------------------------------------------------------------
 */

describe("method rules", () => {
  const METHOD_RULES: Array<
    [ComplianceRuleType, ComplianceNotificationChannel, string]
  > = [
    [
      ComplianceRuleType.HasNotificationEmailMethod,
      ComplianceNotificationChannel.Email,
      "No verified email address configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationSMSMethod,
      ComplianceNotificationChannel.SMS,
      "No verified phone number configured for SMS notifications",
    ],
    [
      ComplianceRuleType.HasNotificationCallMethod,
      ComplianceNotificationChannel.Call,
      "No verified phone number configured for call notifications",
    ],
    [
      ComplianceRuleType.HasNotificationPushMethod,
      ComplianceNotificationChannel.Push,
      "No verified push notification device configured",
    ],
    [
      ComplianceRuleType.HasNotificationWhatsAppMethod,
      ComplianceNotificationChannel.WhatsApp,
      "No verified WhatsApp number configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationTelegramMethod,
      ComplianceNotificationChannel.Telegram,
      "No verified Telegram account configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationSlackMethod,
      ComplianceNotificationChannel.Slack,
      "No verified Slack account configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationMicrosoftTeamsMethod,
      ComplianceNotificationChannel.MicrosoftTeams,
      "No verified Microsoft Teams account configured for notifications",
    ],
    [
      ComplianceRuleType.HasNotificationWebhookMethod,
      ComplianceNotificationChannel.Webhook,
      "No webhook configured for notifications",
    ],
  ];

  test("every channel has a reason, and the four original ones are unchanged", () => {
    expect(Object.keys(METHOD_RULE_FAILURE_REASONS).sort()).toEqual(
      Object.values(ComplianceNotificationChannel).sort(),
    );
    expect(METHOD_RULES).toHaveLength(9);
  });

  test.each(METHOD_RULES)(
    "%s: a member who owns a verified method passes",
    (ruleType: ComplianceRuleType, channel: ComplianceNotificationChannel) => {
      expect(
        adaVerdict(rule({ ruleType: ruleType }), {
          verifiedMethodOwnersByChannel: new Map<
            ComplianceNotificationChannel,
            Set<string>
          >([[channel, new Set<string>([ADA])]]),
        }),
      ).toBeNull();
    },
  );

  test.each(METHOD_RULES)(
    "%s: a member without one fails with the exact reason",
    (
      ruleType: ComplianceRuleType,
      channel: ComplianceNotificationChannel,
      reason: string,
    ) => {
      expect(METHOD_RULE_FAILURE_REASONS[channel]).toBe(reason);
      expect(
        adaVerdict(rule({ ruleType: ruleType }), {
          verifiedMethodOwnersByChannel: new Map<
            ComplianceNotificationChannel,
            Set<string>
          >([[channel, new Set<string>([GRACE])]]),
        }),
      ).toBe(reason);
    },
  );

  test("another channel's verified method does not satisfy the rule", () => {
    expect(
      adaVerdict(
        rule({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
        {
          verifiedMethodOwnersByChannel: new Map<
            ComplianceNotificationChannel,
            Set<string>
          >([
            [ComplianceNotificationChannel.SMS, new Set<string>([ADA])],
            [ComplianceNotificationChannel.Call, new Set<string>()],
          ]),
        },
      ),
    ).toBe("No verified phone number configured for call notifications");
  });

  test("a channel that was never read fails closed, not open", () => {
    expect(
      adaVerdict(
        rule({ ruleType: ComplianceRuleType.HasNotificationPushMethod }),
      ),
    ).toBe("No verified push notification device configured");
  });

  test("each member is judged on their own methods", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      ],
      members: [member(ADA, "Ada"), member(GRACE, "Grace")],
      verifiedMethodOwnersByChannel: new Map<
        ComplianceNotificationChannel,
        Set<string>
      >([[ComplianceNotificationChannel.Email, new Set<string>([GRACE])]]),
    });

    expect(statusOf(result, ADA).isCompliant).toBe(false);
    expect(statusOf(result, GRACE).isCompliant).toBe(true);
  });
});

/*
 * ------------------------------------------------------------------------- *
 * On-call rules with NO channel - answered from readiness coverage cells,
 * exactly as the readiness pages answer them.
 * -------------------------------------------------------------------------
 */

describe("on-call rules for any channel", () => {
  test.each(ON_CALL_RULES)(
    "%s: every cell of its type covered => compliant",
    (
      ruleType: ComplianceRuleType,
      notificationRuleType: NotificationRuleType,
      _subject: string,
      kind: ComplianceSeverityKind,
    ) => {
      expect(
        adaVerdict(rule({ ruleType: ruleType }), {
          coverageByUserId: coverageFor(
            severitiesOfKind(kind).map(
              (
                severity: ComplianceSeverityInput,
              ): ComplianceCoverageCellInput => {
                return cell({
                  ruleType: notificationRuleType,
                  severity: severity,
                  hasRule: true,
                });
              },
            ),
          ),
        }),
      ).toBeNull();
    },
  );

  test.each(ON_CALL_RULES)(
    "%s: missing severities are named in coverage order, in the legacy wording",
    (
      ruleType: ComplianceRuleType,
      notificationRuleType: NotificationRuleType,
      subject: string,
      kind: ComplianceSeverityKind,
    ) => {
      const [first, second]: Array<ComplianceSeverityInput> =
        severitiesOfKind(kind);

      expect(
        adaVerdict(rule({ ruleType: ruleType }), {
          coverageByUserId: coverageFor([
            cell({ ruleType: notificationRuleType, severity: second }),
            cell({ ruleType: notificationRuleType, severity: first }),
          ]),
        }),
      ).toBe(
        `Missing notification rules for ${subject} severities: ${second!.name}, ${first!.name}`,
      );
    },
  );

  test.each(ON_CALL_RULES)(
    "%s: a member missing from readiness is reported as unchecked, never as compliant",
    (
      ruleType: ComplianceRuleType,
      _type: NotificationRuleType,
      subject: string,
    ) => {
      expect(
        adaVerdict(rule({ ruleType: ruleType }), {
          coverageByUserId: coverageFor([], GRACE),
        }),
      ).toBe(
        `Could not check ${subject} notification rules for this user - they may no longer be a member of this project`,
      );
    },
  );

  test("an explicitly opted-out cell is coverage, not a gap", () => {
    expect(
      adaVerdict(
        rule({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
        {
          coverageByUserId: coverageFor([
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severity: CRITICAL,
              isOptOut: true,
            }),
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severity: MAJOR,
              hasRule: true,
            }),
          ]),
        },
      ),
    ).toBeNull();
  });

  test("a severity with no name is named by its id", () => {
    expect(
      adaVerdict(
        rule({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
        {
          coverageByUserId: coverageFor([
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severity: CRITICAL,
              severityName: undefined,
            }),
          ]),
        },
      ),
    ).toBe(
      `Missing notification rules for incident severities: ${CRITICAL.id}`,
    );
  });

  test("no cells at all (a project with no severities) is vacuously compliant", () => {
    expect(
      adaVerdict(rule({ ruleType: ComplianceRuleType.HasAlertOnCallRules }), {
        coverageByUserId: coverageFor([]),
      }),
    ).toBeNull();
  });

  test("cells of every other rule type are ignored - off-call, on-call, the other kind, and the episode twin", () => {
    expect(
      adaVerdict(
        rule({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
        {
          coverageByUserId: coverageFor([
            cell({ ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL }),
            cell({ ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL }),
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
              severity: HIGH,
            }),
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
              severity: CRITICAL,
            }),
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severity: CRITICAL,
              hasRule: true,
            }),
          ]),
        },
      ),
    ).toBeNull();
  });

  test("an off-call rule is not incident coverage (the old false green)", () => {
    expect(
      adaVerdict(
        rule({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
        {
          coverageByUserId: coverageFor([
            cell({
              ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
              hasRule: true,
            }),
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severity: CRITICAL,
            }),
          ]),
        },
      ),
    ).toBe(
      "Missing notification rules for incident severities: Critical Incident",
    );
  });

  test("an episode rule is not satisfied by plain incident coverage", () => {
    expect(
      adaVerdict(
        rule({ ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules }),
        {
          coverageByUserId: coverageFor([
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              severity: CRITICAL,
              hasRule: true,
            }),
            cell({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
              severity: CRITICAL,
            }),
          ]),
        },
      ),
    ).toBe(
      "Missing notification rules for incident episode severities: Critical Incident",
    );
  });

  test("a scoped rule checks only its severities", () => {
    const coverage: Map<
      string,
      Array<ComplianceCoverageCellInput>
    > = coverageFor([
      cell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severity: CRITICAL,
      }),
      cell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severity: MAJOR,
        hasRule: true,
      }),
      cell({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severity: MINOR,
      }),
    ]);

    // Scoped to Major only: the uncovered Critical and Minor are not its business.
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [MAJOR],
        }),
        { coverageByUserId: coverage },
      ),
    ).toBeNull();

    // Scoped to Critical and Major: Critical is named, Minor is not.
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [MAJOR, CRITICAL],
        }),
        { coverageByUserId: coverage },
      ),
    ).toBe(
      "Missing notification rules for incident severities: Critical Incident",
    );
  });

  test("a rule scoped only to a foreign severity is treated as every severity, not as nothing", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [FOREIGN],
        }),
      ],
      coverageByUserId: coverageFor([
        cell({
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          severity: MINOR,
        }),
      ]),
    });

    expect(onlyRule(result).appliesToAllSeverities).toBe(true);
    expect(onlyRule(result).severities).toEqual([]);
    expect(reasonsOf(result, ADA)).toEqual([
      "Missing notification rules for incident severities: Minor Incident",
    ]);
  });

  test("the readiness answer is read from the method-agnostic hasRule flag - no channel data is consulted", () => {
    /*
     * A readiness cell carries no channel at all, so a responder whose only
     * rule is on Telegram, WhatsApp or a webhook arrives here identical to one
     * on email - and an any-channel rule is satisfied by either.
     */
    expect(
      adaVerdict(rule({ ruleType: ComplianceRuleType.HasAlertOnCallRules }), {
        coverageByUserId: coverageFor([
          cell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severity: HIGH,
            hasRule: true,
          }),
          cell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            severity: LOW,
            hasRule: true,
          }),
        ]),
        methodsByChannel: new Map<
          ComplianceNotificationChannel,
          Map<string, ComplianceMethodInput>
        >(),
      }),
    ).toBeNull();
  });
});

/*
 * ------------------------------------------------------------------------- *
 * On-call rules WITH a channel - "Call for Critical incidents".
 * -------------------------------------------------------------------------
 */

describe("on-call rules for one channel", () => {
  const verifiedCall: ComplianceMethodInput = {
    methodId: CALL_ID,
    userId: ADA,
    isVerified: true,
  };

  function callRuleFor(
    severity: ComplianceSeverityInput,
    methodId: string = CALL_ID,
  ): ComplianceNotificationRuleInput {
    return adaRuleFor({
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      kind: ComplianceSeverityKind.Incident,
      severity: severity,
      methodIds: { [ComplianceNotificationChannel.Call]: methodId },
    });
  }

  test("a rule of the right type, for the severity, on a verified method the member owns => compliant", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [callRuleFor(CRITICAL)],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          verifiedCall,
        ]),
      }),
    ).toBeNull();
  });

  test("no rule at all => the severity is missing", () => {
    expect(adaVerdict(CALL_FOR_CRITICAL_INCIDENTS())).toBe(
      "No Call rule for incident severities: Critical Incident",
    );
  });

  test("a rule on ANOTHER channel for the severity does not count", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          adaRuleFor({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            kind: ComplianceSeverityKind.Incident,
            severity: CRITICAL,
            methodIds: { [ComplianceNotificationChannel.Email]: EMAIL_ID },
          }),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          verifiedCall,
        ]),
      }),
    ).toBe("No Call rule for incident severities: Critical Incident");
  });

  test("a rule pointing at an UNVERIFIED method is reported as such", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [callRuleFor(CRITICAL)],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          { ...verifiedCall, isVerified: false },
        ]),
      }),
    ).toBe(
      "The Call rule for incident severities Critical Incident points at an unverified phone number for calls",
    );
  });

  test("a rule pointing at somebody ELSE'S verified method is not coverage - the runtime refuses it", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [callRuleFor(CRITICAL)],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          { ...verifiedCall, userId: GRACE },
        ]),
      }),
    ).toBe(
      "The Call rule for incident severities Critical Incident points at an unverified phone number for calls",
    );
  });

  /*
   * The runtime checks the owner of ALL nine of a rule's methods before it
   * sends anything, and refuses the whole rule when any one is somebody
   * else's (UserNotificationRuleService.executeNotificationRuleItem). A Call
   * rule on Ada's own verified phone that also names Grace's email therefore
   * never rings Ada's phone - so it is not coverage for "Call for Critical".
   */
  test("a rule on the member's own verified method is NOT coverage when another method on it belongs to someone else", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          { ...callRuleFor(CRITICAL), hasForeignMethod: true },
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          verifiedCall,
        ]),
      }),
    ).toBe(
      "The Call rule for incident severities Critical Incident is never sent, because another notification method on it belongs to a different user",
    );
  });

  test("a refused rule is not coverage on any channel - a webhook rule included", () => {
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Webhook,
          incidentSeverities: [CRITICAL],
        }),
        {
          notificationRules: [
            {
              ...adaRuleFor({
                ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
                kind: ComplianceSeverityKind.Incident,
                severity: CRITICAL,
                methodIds: {
                  [ComplianceNotificationChannel.Webhook]: WEBHOOK_ID,
                },
              }),
              hasForeignMethod: true,
            },
          ],
          methodsByChannel: methods(ComplianceNotificationChannel.Webhook, [
            { methodId: WEBHOOK_ID, userId: ADA, isVerified: true },
          ]),
        },
      ),
    ).toBe(
      "The Webhook rule for incident severities Critical Incident is never sent, because another notification method on it belongs to a different user",
    );
  });

  test("another rule for the severity that the runtime does send still covers it", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          { ...callRuleFor(CRITICAL, CALL_ID_2), hasForeignMethod: true },
          callRuleFor(CRITICAL, CALL_ID),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          { methodId: CALL_ID_2, userId: ADA, isVerified: true },
          verifiedCall,
        ]),
      }),
    ).toBeNull();
  });

  test("the headings, in order: missing, then a broken method, then a refused rule, then an opt-out", () => {
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
        {
          projectSeveritiesByKind: new Map<
            ComplianceSeverityKind,
            Array<ComplianceSeverityInput>
          >([[ComplianceSeverityKind.Incident, [CRITICAL, MAJOR, MINOR]]]),
          notificationRules: [
            { ...callRuleFor(CRITICAL), hasForeignMethod: true },
            callRuleFor(MAJOR, CALL_ID_2),
            adaRuleFor({
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              kind: ComplianceSeverityKind.Incident,
              severity: MINOR,
              isOptOut: true,
            }),
          ],
          methodsByChannel: methods(ComplianceNotificationChannel.Call, [
            verifiedCall,
            { methodId: CALL_ID_2, userId: ADA, isVerified: false },
          ]),
        },
      ),
    ).toBe(
      "The Call rule for incident severities Major Incident points at an unverified phone number for calls. " +
        "The Call rule for incident severities Critical Incident is never sent, because another notification method on it belongs to a different user. " +
        "Opted out of incident notifications for: Minor Incident",
    );
  });

  test("a rule pointing at a method row that was not found (deleted, or in another project) is not coverage", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [callRuleFor(CRITICAL)],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, []),
      }),
    ).toBe(
      "The Call rule for incident severities Critical Incident points at an unverified phone number for calls",
    );
  });

  test("one good rule among broken ones is enough", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          callRuleFor(CRITICAL, CALL_ID_2),
          callRuleFor(CRITICAL, CALL_ID),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          { methodId: CALL_ID_2, userId: ADA, isVerified: false },
          verifiedCall,
        ]),
      }),
    ).toBeNull();
  });

  test("an opt-out does NOT satisfy a channel rule, and is named as an opt-out", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          adaRuleFor({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            kind: ComplianceSeverityKind.Incident,
            severity: CRITICAL,
            isOptOut: true,
          }),
        ],
      }),
    ).toBe("Opted out of incident notifications for: Critical Incident");
  });

  test("an opt-out row that (incoherently) carries a method still covers nothing", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          adaRuleFor({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            kind: ComplianceSeverityKind.Incident,
            severity: CRITICAL,
            isOptOut: true,
            methodIds: { [ComplianceNotificationChannel.Call]: CALL_ID },
          }),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          verifiedCall,
        ]),
      }),
    ).toBe("Opted out of incident notifications for: Critical Incident");
  });

  test("a working rule beats an opt-out for the same severity", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          adaRuleFor({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            kind: ComplianceSeverityKind.Incident,
            severity: CRITICAL,
            isOptOut: true,
          }),
          callRuleFor(CRITICAL),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          verifiedCall,
        ]),
      }),
    ).toBeNull();
  });

  test("a broken rule is reported ahead of an opt-out for the same severity - fixing the method is the actionable part", () => {
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          adaRuleFor({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            kind: ComplianceSeverityKind.Incident,
            severity: CRITICAL,
            isOptOut: true,
          }),
          callRuleFor(CRITICAL),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          { ...verifiedCall, isVerified: false },
        ]),
      }),
    ).toBe(
      "The Call rule for incident severities Critical Incident points at an unverified phone number for calls",
    );
  });

  test("a rule of the WRONG TYPE does not cover, even for the same severity id", () => {
    /*
     * An alert rule that (wrongly) carries the incident severity id, an
     * episode rule, and an off-call rule: none of them is what pages Ada for a
     * Critical incident.
     */
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        notificationRules: [
          notificationRule({
            userId: ADA,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
            incidentSeverity: CRITICAL,
            methodIds: { [ComplianceNotificationChannel.Call]: CALL_ID },
          }),
          notificationRule({
            userId: ADA,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
            incidentSeverity: CRITICAL,
            methodIds: { [ComplianceNotificationChannel.Call]: CALL_ID },
          }),
          notificationRule({
            userId: ADA,
            ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
            incidentSeverity: CRITICAL,
            methodIds: { [ComplianceNotificationChannel.Call]: CALL_ID },
          }),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Call, [
          verifiedCall,
        ]),
      }),
    ).toBe("No Call rule for incident severities: Critical Incident");
  });

  test("a severity in the column the rule type does NOT use is ignored", () => {
    // An incident rule row carrying only an alert severity id covers no alert severity.
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          alertSeverities: [HIGH],
        }),
        {
          notificationRules: [
            notificationRule({
              userId: ADA,
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
              alertSeverity: HIGH,
              methodIds: { [ComplianceNotificationChannel.Call]: CALL_ID },
            }),
            // And an alert rule whose only severity is in the incident column.
            notificationRule({
              userId: ADA,
              ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
              incidentSeverity: CRITICAL,
              methodIds: { [ComplianceNotificationChannel.Call]: CALL_ID },
            }),
          ],
          methodsByChannel: methods(ComplianceNotificationChannel.Call, [
            verifiedCall,
          ]),
        },
      ),
    ).toBe("No Call rule for alert severities: High");
  });

  test("another member's rule does not cover this member", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [CALL_FOR_CRITICAL_INCIDENTS()],
      members: [member(ADA, "Ada"), member(GRACE, "Grace")],
      notificationRules: [callRuleFor(CRITICAL)],
      methodsByChannel: methods(ComplianceNotificationChannel.Call, [
        verifiedCall,
      ]),
    });

    expect(statusOf(result, ADA).isCompliant).toBe(true);
    expect(reasonsOf(result, GRACE)).toEqual([
      "No Call rule for incident severities: Critical Incident",
    ]);
  });

  test("with no severities selected, EVERY project severity of the kind is checked, most severe first", () => {
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
        {
          notificationRules: [callRuleFor(MAJOR)],
          methodsByChannel: methods(ComplianceNotificationChannel.Call, [
            verifiedCall,
          ]),
          projectSeveritiesByKind: new Map<
            ComplianceSeverityKind,
            Array<ComplianceSeverityInput>
          >([
            // Deliberately out of order: the scope is put in severity order.
            [ComplianceSeverityKind.Incident, [MINOR, CRITICAL, MAJOR]],
          ]),
        },
      ),
    ).toBe(
      "No Call rule for incident severities: Critical Incident, Minor Incident",
    );
  });

  test("a scoped rule checks only its severities, and a rule for an unscoped severity does not help", () => {
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [MAJOR, CRITICAL],
        }),
        {
          notificationRules: [callRuleFor(MINOR), callRuleFor(MAJOR)],
          methodsByChannel: methods(ComplianceNotificationChannel.Call, [
            verifiedCall,
          ]),
        },
      ),
    ).toBe("No Call rule for incident severities: Critical Incident");
  });

  test("a foreign severity in the selection is ignored: the rule checks every project severity", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [FOREIGN],
        }),
      ],
      notificationRules: [callRuleFor(CRITICAL), callRuleFor(MAJOR)],
      methodsByChannel: methods(ComplianceNotificationChannel.Call, [
        verifiedCall,
      ]),
    });

    expect(onlyRule(result).severities).toEqual([]);
    expect(onlyRule(result).appliesToAllSeverities).toBe(true);
    expect(reasonsOf(result, ADA)).toEqual([
      "No Call rule for incident severities: Minor Incident",
    ]);
    expect(reasonsOf(result, ADA)[0]).not.toContain(FOREIGN.name);
  });

  test("a selected severity the project no longer has is not checked", () => {
    const deleted: ComplianceSeverityInput = {
      id: "5e000000-0000-4000-8000-0000000000dd",
      name: "Deleted",
      order: 9,
      projectId: PROJECT_ID,
    };

    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [deleted, CRITICAL],
        }),
        {
          notificationRules: [callRuleFor(CRITICAL)],
          methodsByChannel: methods(ComplianceNotificationChannel.Call, [
            verifiedCall,
          ]),
        },
      ),
    ).toBeNull();
  });

  test("a project with no severities of the kind is vacuously compliant", () => {
    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
        {
          projectSeveritiesByKind: new Map<
            ComplianceSeverityKind,
            Array<ComplianceSeverityInput>
          >(),
        },
      ),
    ).toBeNull();
  });

  test("every kind of gap in one rule: missing, unverified and opted out, each in severity order", () => {
    const pushForEveryIncidentSeverity: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Push,
    });
    const fourth: ComplianceSeverityInput = {
      id: "5e000000-0000-4000-8000-000000000004",
      name: "Trivial Incident",
      order: 4,
      projectId: PROJECT_ID,
    };
    const fifth: ComplianceSeverityInput = {
      id: "5e000000-0000-4000-8000-000000000005",
      name: "Informational",
      order: 5,
      projectId: PROJECT_ID,
    };

    const pushRuleFor: (
      severity: ComplianceSeverityInput,
    ) => ComplianceNotificationRuleInput = (
      severity: ComplianceSeverityInput,
    ): ComplianceNotificationRuleInput => {
      return adaRuleFor({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        kind: ComplianceSeverityKind.Incident,
        severity: severity,
        methodIds: { [ComplianceNotificationChannel.Push]: PUSH_ID },
      });
    };

    const optOutFor: (
      severity: ComplianceSeverityInput,
    ) => ComplianceNotificationRuleInput = (
      severity: ComplianceSeverityInput,
    ): ComplianceNotificationRuleInput => {
      return adaRuleFor({
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        kind: ComplianceSeverityKind.Incident,
        severity: severity,
        isOptOut: true,
      });
    };

    expect(
      adaVerdict(pushForEveryIncidentSeverity, {
        // Critical: nothing. Major: unverified. Minor: nothing. Trivial: opted out. Informational: unverified.
        notificationRules: [
          optOutFor(fourth),
          pushRuleFor(fifth),
          pushRuleFor(MAJOR),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Push, [
          { methodId: PUSH_ID, userId: ADA, isVerified: false },
        ]),
        projectSeveritiesByKind: new Map<
          ComplianceSeverityKind,
          Array<ComplianceSeverityInput>
        >([
          [
            ComplianceSeverityKind.Incident,
            [fifth, fourth, MINOR, MAJOR, CRITICAL],
          ],
        ]),
      }),
    ).toBe(
      "No Push notification rule for incident severities: Critical Incident, Minor Incident. " +
        "The Push notification rule for incident severities Major Incident, Informational points at an unverified push notification device. " +
        "Opted out of incident notifications for: Trivial Incident",
    );
  });

  test("a severity with no name is named by its id", () => {
    const unnamed: ComplianceSeverityInput = {
      id: "5e000000-0000-4000-8000-0000000000aa",
      order: 1,
      projectId: PROJECT_ID,
    };

    expect(
      adaVerdict(
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.SMS,
        }),
        {
          projectSeveritiesByKind: new Map<
            ComplianceSeverityKind,
            Array<ComplianceSeverityInput>
          >([[ComplianceSeverityKind.Incident, [unnamed]]]),
        },
      ),
    ).toBe(`No SMS rule for incident severities: ${unnamed.id}`);
  });

  test.each(ON_CALL_RULES)(
    "%s with a channel checks its own rule type and severity column, in its own words",
    (
      ruleType: ComplianceRuleType,
      notificationRuleType: NotificationRuleType,
      subject: string,
      kind: ComplianceSeverityKind,
    ) => {
      const [first, second]: Array<ComplianceSeverityInput> =
        severitiesOfKind(kind);

      expect(
        adaVerdict(
          scopedRule({
            ruleType: ruleType,
            kind: kind,
            selected: [first!, second!],
            notificationChannel: ComplianceNotificationChannel.Telegram,
          }),
          {
            notificationRules: [
              adaRuleFor({
                ruleType: notificationRuleType,
                kind: kind,
                severity: second!,
                methodIds: {
                  [ComplianceNotificationChannel.Telegram]:
                    "7e1e0000-0000-4000-8000-000000000001",
                },
              }),
            ],
            methodsByChannel: methods(ComplianceNotificationChannel.Telegram, [
              {
                methodId: "7e1e0000-0000-4000-8000-000000000001",
                userId: ADA,
                isVerified: true,
              },
            ]),
          },
        ),
      ).toBe(`No Telegram rule for ${subject} severities: ${first!.name}`);
    },
  );

  test("webhooks have no verification: an owned webhook covers, whatever its flag says", () => {
    const webhookForCritical: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Webhook,
      incidentSeverities: [CRITICAL],
    });

    expect(
      adaVerdict(webhookForCritical, {
        notificationRules: [
          adaRuleFor({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            kind: ComplianceSeverityKind.Incident,
            severity: CRITICAL,
            methodIds: { [ComplianceNotificationChannel.Webhook]: WEBHOOK_ID },
          }),
        ],
        methodsByChannel: methods(ComplianceNotificationChannel.Webhook, [
          { methodId: WEBHOOK_ID, userId: ADA, isVerified: false },
        ]),
      }),
    ).toBeNull();
  });

  test("a webhook rule pointing at nothing usable is never called 'unverified' - it is no webhook rule", () => {
    const webhookForCritical: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Webhook,
      incidentSeverities: [CRITICAL],
    });

    const reason: string | null = adaVerdict(webhookForCritical, {
      notificationRules: [
        adaRuleFor({
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          kind: ComplianceSeverityKind.Incident,
          severity: CRITICAL,
          methodIds: { [ComplianceNotificationChannel.Webhook]: WEBHOOK_ID },
        }),
      ],
      methodsByChannel: methods(ComplianceNotificationChannel.Webhook, [
        { methodId: WEBHOOK_ID, userId: GRACE, isVerified: true },
      ]),
    });

    expect(reason).toBe(
      "No Webhook rule for incident severities: Critical Incident",
    );
    expect(reason).not.toContain("unverified");
  });

  test("two channel rules on the same severities are judged independently", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        CALL_FOR_CRITICAL_INCIDENTS(),
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          incidentSeverities: [CRITICAL],
        }),
      ],
      notificationRules: [callRuleFor(CRITICAL)],
      methodsByChannel: new Map<
        ComplianceNotificationChannel,
        Map<string, ComplianceMethodInput>
      >([
        [
          ComplianceNotificationChannel.Call,
          new Map<string, ComplianceMethodInput>([[CALL_ID, verifiedCall]]),
        ],
        [
          ComplianceNotificationChannel.Push,
          new Map<string, ComplianceMethodInput>(),
        ],
      ]),
    });

    expect(reasonsOf(result, ADA)).toEqual([
      "No Push notification rule for incident severities: Critical Incident",
    ]);
    expect(result.complianceSettings[0]!.compliantCount).toBe(1);
    expect(result.complianceSettings[1]!.nonCompliantCount).toBe(1);
  });

  test("a channel rule never consults readiness coverage", () => {
    // Coverage says "covered"; the channel rule still wants a Call rule.
    expect(
      adaVerdict(CALL_FOR_CRITICAL_INCIDENTS(), {
        coverageByUserId: coverageFor([
          cell({
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            severity: CRITICAL,
            hasRule: true,
          }),
        ]),
      }),
    ).toBe("No Call rule for incident severities: Critical Incident");
  });
});

/*
 * ------------------------------------------------------------------------- *
 * The whole status - counts, warnings, disabled and unknown rules, members,
 * and the exact JSON shape the Dashboard is typed against.
 * -------------------------------------------------------------------------
 */

describe("evaluate - the status payload", () => {
  test("the exact keys of every object on the wire", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [CALL_FOR_CRITICAL_INCIDENTS()],
      members: [
        {
          ...member(ADA, "Ada"),
          profilePictureId: "b1c7e000-0000-4000-8000-000000000001",
        },
      ],
      projectSwitches: { enableCallNotifications: true },
    });

    expect(Object.keys(result).sort()).toEqual([
      "complianceSettings",
      "evaluatedAt",
      "teamId",
      "teamName",
      "userComplianceStatuses",
    ]);
    expect(Object.keys(onlyRule(result)).sort()).toEqual([
      "appliesToAllSeverities",
      "compliantCount",
      "enabled",
      "nonCompliantCount",
      "notificationChannel",
      "ruleType",
      "settingId",
      "severities",
      "severityKind",
      "warnings",
    ]);
    expect(Object.keys(onlyRule(result).severities[0]!).sort()).toEqual([
      "color",
      "id",
      "name",
    ]);
    expect(Object.keys(statusOf(result, ADA)).sort()).toEqual([
      "isCompliant",
      "nonCompliantRules",
      "userEmail",
      "userId",
      "userName",
      "userProfilePictureId",
    ]);
    expect(
      Object.keys(statusOf(result, ADA).nonCompliantRules[0]!).sort(),
    ).toEqual(["reason", "ruleType", "settingId"]);
  });

  test("absent optional values are OMITTED, not sent as undefined", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: [MINOR],
        }),
      ],
      coverageByUserId: coverageFor([]),
    });

    // MINOR has no colour, and Ada has no profile picture.
    expect(Object.keys(onlyRule(result).severities[0]!).sort()).toEqual([
      "id",
      "name",
    ]);
    expect("userProfilePictureId" in statusOf(result, ADA)).toBe(false);
  });

  test("team identity and the evaluation time", () => {
    const result: TeamComplianceStatusJSON = evaluate({});

    expect(result.teamId).toBe(TEAM_ID);
    expect(result.teamName).toBe("Platform On-Call");
    expect(result.evaluatedAt).toBe("2026-09-28T10:00:00.000Z");
  });

  test("a team with no name is Unknown Team", () => {
    expect(evaluate({ teamName: undefined }).teamName).toBe("Unknown Team");
    expect(evaluate({ teamName: "" }).teamName).toBe("Unknown Team");
  });

  test("rule JSON: a channel rule scoped to severities", () => {
    const complianceRule: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [MAJOR, CRITICAL],
    });

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [complianceRule],
    });

    expect(onlyRule(result)).toEqual({
      settingId: complianceRule.settingId,
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: true,
      notificationChannel: ComplianceNotificationChannel.Call,
      severityKind: ComplianceSeverityKind.Incident,
      appliesToAllSeverities: false,
      severities: [
        { id: CRITICAL.id, name: "Critical Incident", color: "#9f1239" },
        { id: MAJOR.id, name: "Major Incident", color: "#dc2626" },
      ],
      compliantCount: 0,
      nonCompliantCount: 1,
      warnings: [],
    });
  });

  test("rule JSON: an on-call rule for every severity on any channel", () => {
    const complianceRule: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
    });

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [complianceRule],
      coverageByUserId: coverageFor([]),
    });

    expect(onlyRule(result)).toEqual({
      settingId: complianceRule.settingId,
      ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
      enabled: true,
      notificationChannel: null,
      severityKind: ComplianceSeverityKind.Alert,
      appliesToAllSeverities: true,
      severities: [],
      compliantCount: 1,
      nonCompliantCount: 0,
      warnings: [],
    });
  });

  test("rule JSON: a method rule", () => {
    const complianceRule: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationSlackMethod,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [CRITICAL],
    });

    expect(onlyRule(evaluate({ rules: [complianceRule] }))).toEqual({
      settingId: complianceRule.settingId,
      ruleType: ComplianceRuleType.HasNotificationSlackMethod,
      enabled: true,
      notificationChannel: null,
      severityKind: null,
      appliesToAllSeverities: false,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 1,
      warnings: [],
    });
  });

  test("a severity with no name is listed by its id", () => {
    const unnamed: ComplianceSeverityInput = {
      id: "5e000000-0000-4000-8000-0000000000bb",
      order: 1,
      projectId: PROJECT_ID,
    };

    expect(
      onlyRule(
        evaluate({
          rules: [
            rule({
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              incidentSeverities: [unnamed],
            }),
          ],
          coverageByUserId: coverageFor([]),
        }),
      ).severities,
    ).toEqual([{ id: unnamed.id, name: unnamed.id }]);
  });

  test("counts: every member is counted once per enabled rule", () => {
    const email: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
    });
    const sms: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationSMSMethod,
    });

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [email, sms],
      members: [
        member(ADA, "Ada"),
        member(GRACE, "Grace"),
        member(LINUS, "Linus"),
      ],
      verifiedMethodOwnersByChannel: new Map<
        ComplianceNotificationChannel,
        Set<string>
      >([
        [ComplianceNotificationChannel.Email, new Set<string>([ADA, GRACE])],
        [ComplianceNotificationChannel.SMS, new Set<string>([LINUS])],
      ]),
    });

    expect(result.complianceSettings[0]!.compliantCount).toBe(2);
    expect(result.complianceSettings[0]!.nonCompliantCount).toBe(1);
    expect(result.complianceSettings[1]!.compliantCount).toBe(1);
    expect(result.complianceSettings[1]!.nonCompliantCount).toBe(2);

    expect(statusOf(result, ADA).isCompliant).toBe(false);
    expect(statusOf(result, LINUS).isCompliant).toBe(false);
    expect(statusOf(result, GRACE).nonCompliantRules).toEqual([
      {
        settingId: sms.settingId,
        ruleType: ComplianceRuleType.HasNotificationSMSMethod,
        reason: "No verified phone number configured for SMS notifications",
      },
    ]);
  });

  test("a member's failures are listed in rule order, each naming the rule it belongs to", () => {
    const later: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      createdAt: new Date("2026-05-01T00:00:00Z"),
    });
    const earlier: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationPushMethod,
      createdAt: new Date("2026-04-01T00:00:00Z"),
    });

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [later, earlier],
    });

    expect(
      statusOf(result, ADA).nonCompliantRules.map(
        (issue: TeamComplianceIssueJSON): string => {
          return issue.settingId;
        },
      ),
    ).toEqual([earlier.settingId, later.settingId]);
  });

  test("two rules of the same type are told apart by settingId", () => {
    const call: ComplianceRuleInput = CALL_FOR_CRITICAL_INCIDENTS();
    const push: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Push,
      incidentSeverities: [CRITICAL],
    });

    const result: TeamComplianceStatusJSON = evaluate({ rules: [call, push] });

    expect(statusOf(result, ADA).nonCompliantRules).toEqual([
      {
        settingId: call.settingId,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason: "No Call rule for incident severities: Critical Incident",
      },
      {
        settingId: push.settingId,
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason:
          "No Push notification rule for incident severities: Critical Incident",
      },
    ]);
  });

  test("a DISABLED rule is listed but not evaluated: no failures, no counts, no warnings", () => {
    const disabled: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationCallMethod,
      enabled: false,
    });

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [disabled],
      members: [member(ADA, "Ada"), member(GRACE, "Grace")],
      projectSwitches: { enableCallNotifications: false },
    });

    expect(onlyRule(result).enabled).toBe(false);
    expect(onlyRule(result).compliantCount).toBe(0);
    expect(onlyRule(result).nonCompliantCount).toBe(0);
    expect(onlyRule(result).warnings).toEqual([]);
    expect(statusOf(result, ADA)).toMatchObject({
      isCompliant: true,
      nonCompliantRules: [],
    });
    expect(statusOf(result, GRACE).isCompliant).toBe(true);
  });

  test("an UNRECOGNISED rule is listed, never failed, never counted, and says why", () => {
    const unknown: ComplianceRuleInput = rule({
      ruleType: "HasCarrierPigeon",
      notificationChannel: ComplianceNotificationChannel.Call,
    });

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [unknown],
      members: [member(ADA, "Ada"), member(GRACE, "Grace")],
    });

    expect(onlyRule(result)).toEqual({
      settingId: unknown.settingId,
      ruleType: "HasCarrierPigeon",
      enabled: true,
      notificationChannel: null,
      severityKind: null,
      appliesToAllSeverities: false,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 0,
      warnings: [UNKNOWN_RULE_TYPE_WARNING],
    });
    expect(UNKNOWN_RULE_TYPE_WARNING).toBe(
      "This rule type is not recognised, so it is not checked.",
    );
    expect(statusOf(result, ADA).isCompliant).toBe(true);
    expect(statusOf(result, GRACE).isCompliant).toBe(true);
  });

  test("an unrecognised rule warns even while disabled, and an empty rule type is unrecognised too", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({ ruleType: "HasCarrierPigeon", enabled: false }),
        rule({ ruleType: undefined }),
      ],
    });

    expect(result.complianceSettings[0]!.warnings).toEqual([
      UNKNOWN_RULE_TYPE_WARNING,
    ]);
    expect(result.complianceSettings[1]!.ruleType).toBe("");
    expect(result.complianceSettings[1]!.warnings).toEqual([
      UNKNOWN_RULE_TYPE_WARNING,
    ]);
  });

  test("no rules at all: everybody is compliant", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      members: [member(ADA, "Ada"), member(GRACE, "Grace")],
    });

    expect(result.complianceSettings).toEqual([]);
    expect(
      result.userComplianceStatuses.every(
        (status: TeamMemberComplianceJSON): boolean => {
          return status.isCompliant;
        },
      ),
    ).toBe(true);
  });

  test("no members: rules are listed with zero counts", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
      ],
      members: [],
    });

    expect(result.userComplianceStatuses).toEqual([]);
    expect(onlyRule(result).compliantCount).toBe(0);
    expect(onlyRule(result).nonCompliantCount).toBe(0);
  });

  test("members are listed in the order given, once each, and blank ids are dropped", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      members: [
        member(GRACE, "Grace"),
        member(ADA, "Ada"),
        member(GRACE, "Grace again"),
        member("", "Nobody"),
      ],
    });

    expect(
      result.userComplianceStatuses.map(
        (status: TeamMemberComplianceJSON): string => {
          return status.userName;
        },
      ),
    ).toEqual(["Grace", "Ada"]);
  });

  test("a member with no name is shown by email, then as Unknown User; a missing email is empty", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      members: [
        { userId: ADA, email: "nameless@example.com" },
        { userId: GRACE },
        {
          userId: LINUS,
          name: "Linus",
          profilePictureId: "b1c7e000-0000-4000-8000-000000000002",
        },
      ],
    });

    expect(statusOf(result, ADA).userName).toBe("nameless@example.com");
    expect(statusOf(result, ADA).userEmail).toBe("nameless@example.com");
    expect(statusOf(result, GRACE).userName).toBe("Unknown User");
    expect(statusOf(result, GRACE).userEmail).toBe("");
    expect(statusOf(result, LINUS).userProfilePictureId).toBe(
      "b1c7e000-0000-4000-8000-000000000002",
    );
  });
});

describe("evaluate - rule warnings", () => {
  const SWITCHED_CHANNELS: Array<
    [ComplianceNotificationChannel, ProjectChannelSwitch, string]
  > = [
    [ComplianceNotificationChannel.Call, "enableCallNotifications", "Call"],
    [ComplianceNotificationChannel.SMS, "enableSmsNotifications", "SMS"],
    [
      ComplianceNotificationChannel.Telegram,
      "enableTelegramNotifications",
      "Telegram",
    ],
  ];

  test.each(SWITCHED_CHANNELS)(
    "%s switched off: a method rule and a channel rule both say so, in full",
    (
      channel: ComplianceNotificationChannel,
      projectSwitch: ProjectChannelSwitch,
      label: string,
    ) => {
      const warning: string = `${label} notifications are switched off for this project, so members will not be notified by ${label} even when they meet this rule. Turn them on in Project Settings > Notification Settings.`;

      expect(
        TeamComplianceEvaluator.getChannelSwitchedOffWarning(channel),
      ).toBe(warning);

      const result: TeamComplianceStatusJSON = evaluate({
        rules: [
          rule({ ruleType: `HasNotification${channel}Method` }),
          rule({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: channel,
          }),
        ],
        projectSwitches: { [projectSwitch]: false },
      });

      expect(result.complianceSettings[0]!.warnings).toEqual([warning]);
      expect(result.complianceSettings[1]!.warnings).toEqual([warning]);
    },
  );

  test.each(SWITCHED_CHANNELS)(
    "%s switched on: no warning",
    (
      channel: ComplianceNotificationChannel,
      projectSwitch: ProjectChannelSwitch,
    ) => {
      const result: TeamComplianceStatusJSON = evaluate({
        rules: [
          rule({ ruleType: `HasNotification${channel}Method` }),
          rule({
            ruleType: ComplianceRuleType.HasAlertOnCallRules,
            notificationChannel: channel,
          }),
        ],
        projectSwitches: { [projectSwitch]: true },
      });

      expect(result.complianceSettings[0]!.warnings).toEqual([]);
      expect(result.complianceSettings[1]!.warnings).toEqual([]);
    },
  );

  test("a warning is not a member failure: a member who meets the rule still passes it", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [rule({ ruleType: ComplianceRuleType.HasNotificationCallMethod })],
      verifiedMethodOwnersByChannel: new Map<
        ComplianceNotificationChannel,
        Set<string>
      >([[ComplianceNotificationChannel.Call, new Set<string>([ADA])]]),
      projectSwitches: { enableCallNotifications: false },
    });

    expect(onlyRule(result).warnings).toHaveLength(1);
    expect(onlyRule(result).compliantCount).toBe(1);
    expect(statusOf(result, ADA).isCompliant).toBe(true);
  });

  test("a switch missing from a project record that WAS read is off", () => {
    expect(
      onlyRule(
        evaluate({
          rules: [
            rule({ ruleType: ComplianceRuleType.HasNotificationSMSMethod }),
          ],
          projectSwitches: {},
        }),
      ).warnings,
    ).toEqual([
      TeamComplianceEvaluator.getChannelSwitchedOffWarning(
        ComplianceNotificationChannel.SMS,
      ),
    ]);
  });

  /*
   * Project.enableWhatsAppNotifications does not stop WhatsAppService sending
   * to numbers verified before it went off - so "members will not be
   * notified by WhatsApp" would be untrue - but UserWhatsAppService refuses
   * to ADD a number while it is off, and it is off by default. A member
   * without a number can then never meet a WhatsApp rule, and that is what
   * the warning says.
   */
  test("WhatsApp switched off warns that members cannot add a number - not that pages stop", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({ ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod }),
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.WhatsApp,
        }),
      ],
      projectSwitches: { enableWhatsAppNotifications: false },
    });

    expect(WHATSAPP_SWITCHED_OFF_WARNING).toBe(
      "WhatsApp is switched off for this project, so members cannot add a WhatsApp number to meet this rule. Turn it on in Project Settings > Notification Settings.",
    );

    expect(
      result.complianceSettings.map(
        (complianceRule: TeamComplianceRuleJSON) => {
          return complianceRule.warnings;
        },
      ),
    ).toEqual([
      [WHATSAPP_SWITCHED_OFF_WARNING],
      [WHATSAPP_SWITCHED_OFF_WARNING],
    ]);

    expect(
      TeamComplianceEvaluator.getChannelSwitchedOffWarning(
        ComplianceNotificationChannel.WhatsApp,
      ),
    ).not.toContain("will not be notified");
  });

  test("WhatsApp switched on warns about nothing", () => {
    expect(
      onlyRule(
        evaluate({
          rules: [
            rule({
              ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod,
            }),
          ],
          projectSwitches: { enableWhatsAppNotifications: true },
        }),
      ).warnings,
    ).toEqual([]);
  });

  test.each([
    [ComplianceNotificationChannel.Call],
    [ComplianceNotificationChannel.SMS],
    [ComplianceNotificationChannel.Telegram],
  ])(
    "%s keeps the 'will not be notified' warning: its send path honours the switch",
    (channel: ComplianceNotificationChannel) => {
      expect(
        TeamComplianceEvaluator.getChannelSwitchedOffWarning(channel),
      ).toBe(
        `${channel} notifications are switched off for this project, so members will not be notified by ${channel} even when they meet this rule. Turn them on in Project Settings > Notification Settings.`,
      );
    },
  );

  test("channels with no project switch, and on-call rules for any channel, never warn", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        rule({ ruleType: ComplianceRuleType.HasNotificationPushMethod }),
        rule({ ruleType: ComplianceRuleType.HasNotificationEmailMethod }),
        rule({ ruleType: ComplianceRuleType.HasNotificationWebhookMethod }),
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Slack,
        }),
        rule({ ruleType: ComplianceRuleType.HasIncidentOnCallRules }),
      ],
      coverageByUserId: coverageFor([]),
      projectSwitches: {},
    });

    for (const complianceRule of result.complianceSettings) {
      expect(complianceRule.warnings).toEqual([]);
    }
  });

  test("with no project record at all (not read), nothing is guessed", () => {
    expect(
      onlyRule(
        evaluate({
          rules: [
            rule({ ruleType: ComplianceRuleType.HasNotificationCallMethod }),
          ],
          projectSwitches: null,
        }),
      ).warnings,
    ).toEqual([]);
  });

  test("a disabled rule on a switched-off channel does not warn", () => {
    expect(
      onlyRule(
        evaluate({
          rules: [
            {
              ...CALL_FOR_CRITICAL_INCIDENTS(),
              enabled: false,
            },
          ],
          projectSwitches: { enableCallNotifications: false },
        }),
      ).warnings,
    ).toEqual([]);
  });
});

/*
 * ------------------------------------------------------------------------- *
 * A rule a severity delete left with nothing to check.
 * -------------------------------------------------------------------------
 *
 * Deleting every severity an on-call rule was scoped to leaves it with no
 * severities - which is also how a rule for EVERY severity is stored. The
 * severity delete pauses it and marks it (options.severitiesDeleted); the
 * page must show it as checking nothing, never as "all severities", and say
 * why it cannot just be switched back on.
 */

describe("a rule whose severities were all deleted", () => {
  const EMPTIED: () => ComplianceRuleInput = (): ComplianceRuleInput => {
    return rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      enabled: false,
      severitiesDeleted: true,
    });
  };

  test("is listed paused, applying to NO severity, with a warning that says why", () => {
    expect(SEVERITIES_DELETED_WARNING).toBe(
      "Every severity this rule was scoped to has been deleted, so it is paused. Edit it to choose new severities, or delete it.",
    );

    const listed: TeamComplianceRuleJSON = onlyRule(
      evaluate({ rules: [EMPTIED()], members: [member(ADA, "Ada")] }),
    );

    expect(listed).toMatchObject({
      enabled: false,
      notificationChannel: ComplianceNotificationChannel.Call,
      severityKind: ComplianceSeverityKind.Incident,
      appliesToAllSeverities: false,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 0,
      warnings: [SEVERITIES_DELETED_WARNING],
    });
  });

  test("sits beside the team's real 'every severity' rule of the same type and channel without looking like it", () => {
    const result: TeamComplianceStatusJSON = evaluate({
      rules: [
        EMPTIED(),
        rule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ],
      members: [member(ADA, "Ada")],
    });

    expect(
      result.complianceSettings.map((listed: TeamComplianceRuleJSON) => {
        return [
          listed.appliesToAllSeverities,
          listed.warnings,
          listed.compliantCount + listed.nonCompliantCount,
        ];
      }),
    ).toEqual([
      [false, [SEVERITIES_DELETED_WARNING], 0],
      [true, [], 1],
    ]);
  });

  test("is not checked even if it is somehow enabled: members pass it, and nothing is loaded for it", () => {
    const emptied: ComplianceRuleInput = {
      ...EMPTIED(),
      enabled: true,
    };

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [emptied],
      members: [member(ADA, "Ada")],
      projectSwitches: { enableCallNotifications: false },
    });

    expect(statusOf(result, ADA)).toMatchObject({
      isCompliant: true,
      nonCompliantRules: [],
    });
    expect(onlyRule(result)).toMatchObject({
      enabled: true,
      appliesToAllSeverities: false,
      compliantCount: 0,
      nonCompliantCount: 0,
      // Its own warning, not the switched-off one: it checks nothing.
      warnings: [SEVERITIES_DELETED_WARNING],
    });

    expect(plan([emptied])).toEqual({
      needsCoverage: false,
      methodChannels: [],
      onCallChannels: [],
      onCallRuleTypes: [],
      onCallSeverityKinds: [],
      projectSwitches: [],
    });

    // The same with no channel: no readiness pass either.
    expect(
      plan([
        rule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          severitiesDeleted: true,
        }),
      ]).needsCoverage,
    ).toBe(false);
  });

  test("is resolved as severitiesDeleted, and never checked", () => {
    const resolved: ResolvedComplianceRule = resolveOne(EMPTIED());

    expect(resolved.severitiesDeleted).toBe(true);
    expect(
      TeamComplianceEvaluator.isChecked({ ...resolved, enabled: true }),
    ).toBe(false);
  });

  test("a stale mark on a rule that has severities again is ignored: the rule is checked on them", () => {
    const rescoped: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      notificationChannel: ComplianceNotificationChannel.Call,
      incidentSeverities: [MAJOR],
      severitiesDeleted: true,
    });

    expect(resolveOne(rescoped).severitiesDeleted).toBe(false);

    const result: TeamComplianceStatusJSON = evaluate({
      rules: [rescoped],
      members: [member(ADA, "Ada")],
    });

    expect(onlyRule(result)).toMatchObject({
      appliesToAllSeverities: false,
      severities: [{ id: MAJOR.id, name: "Major Incident", color: "#dc2626" }],
      nonCompliantCount: 1,
      warnings: [],
    });
    expect(reasonsOf(result, ADA)).toEqual([
      "No Call rule for incident severities: Major Incident",
    ]);
  });

  test("a mark on a rule type with no severity scope means nothing", () => {
    const method: ComplianceRuleInput = rule({
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      severitiesDeleted: true,
    });

    expect(resolveOne(method).severitiesDeleted).toBe(false);
    expect(
      onlyRule(evaluate({ rules: [method], members: [member(ADA, "Ada")] })),
    ).toMatchObject({
      appliesToAllSeverities: false,
      nonCompliantCount: 1,
      warnings: [],
    });
  });

  test("an unrecognised rule says only that it is unrecognised", () => {
    expect(
      onlyRule(
        evaluate({
          rules: [
            rule({ ruleType: "HasCarrierPigeon", severitiesDeleted: true }),
          ],
        }),
      ).warnings,
    ).toEqual([UNKNOWN_RULE_TYPE_WARNING]);
  });

  test("an unmarked rule with no severities is still a rule for every severity", () => {
    const everySeverity: TeamComplianceRuleJSON = onlyRule(
      evaluate({
        rules: [
          rule({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            enabled: false,
            severitiesDeleted: false,
          }),
        ],
      }),
    );

    expect(everySeverity).toMatchObject({
      appliesToAllSeverities: true,
      warnings: [],
    });
  });
});
