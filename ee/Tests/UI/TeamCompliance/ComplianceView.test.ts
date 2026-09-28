import { describe, expect, test } from "@jest/globals";
import {
  CHANNEL_ICONS,
  ComplianceSummary,
  ComplianceVerdict,
  ComplianceVerdictKind,
  MemberStatusFilter,
  PROJECT_SWITCHED_CHANNELS,
  RuleWarningGroup,
  countMembersByStatus,
  countOf,
  filterMembers,
  getActiveRules,
  getAllSeveritiesLabel,
  getChannelLabel,
  getComplianceVerdict,
  getEvaluatedAt,
  getMemberDisplayName,
  getMemberFirstName,
  getMemberIssueForRule,
  getRuleChannel,
  getRuleIcon,
  getRulePassRate,
  getRuleSentence,
  getRuleTitle,
  getRuleTypeIcon,
  getRuleWarningGroups,
  getSelfFix,
  isFixedInProjectNotificationSettings,
  isRuleActive,
  isRuleKnown,
  memberMatchesSearch,
  memberMatchesStatus,
  parseComplianceStatus,
  pluralize,
  sortMembers,
  summarizeCompliance,
} from "../../../Dashboard/TeamCompliance/ComplianceView";
import {
  CALL_REASON,
  CALL_RULE_ID,
  EMAIL_REASON,
  EMAIL_RULE_ID,
  EVALUATED_AT,
  JANE_ID,
  OMAR_ID,
  PRIYA_ID,
  alertRule,
  buildMember,
  buildRule,
  buildStatus,
  callForIncidentsRule,
  emailRule,
  issue,
  standardStatus,
} from "./ComplianceFixtures";
import PageMap from "@oneuptime/dashboard/Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import {
  COMPLIANCE_RULE_DEFINITIONS,
  ComplianceRuleCategory,
  ComplianceRuleDefinition,
  ComplianceSeverityKind,
} from "Common/Types/Team/ComplianceRule";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import {
  TeamComplianceRuleJSON,
  TeamComplianceStatusJSON,
  TeamMemberComplianceJSON,
} from "Common/Types/Team/TeamComplianceStatus";

/*
 * The decisions behind Teams > Compliance, tested without rendering: the
 * verdict and its grammar, how a rule is titled and described, which members
 * a filter keeps and in what order, where a member fixes themselves, which
 * warnings interrupt the page, and how a payload is made safe to render.
 */

const ALL_CHANNELS: Array<ComplianceNotificationChannel> = Object.values(
  ComplianceNotificationChannel,
);

const summary: (overrides: Partial<ComplianceSummary>) => ComplianceSummary = (
  overrides: Partial<ComplianceSummary>,
): ComplianceSummary => {
  return {
    memberCount: 3,
    compliantCount: 3,
    attentionCount: 0,
    ruleCount: 2,
    activeRuleCount: 2,
    pausedRuleCount: 0,
    ...overrides,
  };
};

const namesOf: (members: Array<TeamMemberComplianceJSON>) => Array<string> = (
  members: Array<TeamMemberComplianceJSON>,
): Array<string> => {
  return members.map((member: TeamMemberComplianceJSON): string => {
    return member.userName;
  });
};

describe("rule presentation", () => {
  test("every channel has an icon", () => {
    for (const channel of ALL_CHANNELS) {
      expect(CHANNEL_ICONS[channel]).toBeDefined();
    }
    expect(CHANNEL_ICONS[ComplianceNotificationChannel.Call]).toBe(
      IconProp.Call,
    );
    expect(CHANNEL_ICONS[ComplianceNotificationChannel.Push]).toBe(
      IconProp.DevicePhoneMobile,
    );
  });

  test.each(
    COMPLIANCE_RULE_DEFINITIONS.map(
      (
        definition: ComplianceRuleDefinition,
      ): [string, ComplianceRuleDefinition] => {
        return [definition.ruleType, definition];
      },
    ),
  )(
    "%s has an icon of its own kind",
    (_ruleType: string, definition: ComplianceRuleDefinition) => {
      const icon: IconProp = getRuleTypeIcon(definition.ruleType);

      if (definition.methodChannel) {
        expect(icon).toBe(CHANNEL_ICONS[definition.methodChannel]);
      } else {
        expect(icon).not.toBe(IconProp.ShieldExclamation);
      }
    },
  );

  test("the on-call kinds wear the icons the rest of the Dashboard uses", () => {
    expect(getRuleTypeIcon(ComplianceRuleType.HasIncidentOnCallRules)).toBe(
      IconProp.Alert,
    );
    expect(getRuleTypeIcon(ComplianceRuleType.HasAlertOnCallRules)).toBe(
      IconProp.ExclaimationCircle,
    );
    expect(
      getRuleTypeIcon(ComplianceRuleType.HasIncidentEpisodeOnCallRules),
    ).toBe(IconProp.SquareStack3D);
  });

  test("an unknown rule type gets a warning icon", () => {
    expect(getRuleTypeIcon("HasCarrierPigeon")).toBe(
      IconProp.ShieldExclamation,
    );
  });

  test("the channel a rule is about", () => {
    expect(getRuleChannel(emailRule())).toBe(
      ComplianceNotificationChannel.Email,
    );
    expect(getRuleChannel(callForIncidentsRule())).toBe(
      ComplianceNotificationChannel.Call,
    );
    expect(getRuleChannel(alertRule())).toBeUndefined();
    expect(
      getRuleChannel(
        buildRule({
          ruleType: "HasCarrierPigeon" as ComplianceRuleType,
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ),
    ).toBeUndefined();
    expect(
      getRuleChannel(
        callForIncidentsRule({
          notificationChannel: "Fax" as ComplianceNotificationChannel,
        }),
      ),
    ).toBeUndefined();
  });

  test("a method rule never takes the on-call rule's channel", () => {
    expect(
      getRuleChannel(
        emailRule({ notificationChannel: ComplianceNotificationChannel.Call }),
      ),
    ).toBe(ComplianceNotificationChannel.Email);
  });

  test("a channel rule wears its channel, an any-channel rule its kind", () => {
    expect(getRuleIcon(callForIncidentsRule())).toBe(IconProp.Call);
    expect(getRuleIcon(alertRule())).toBe(IconProp.ExclaimationCircle);
    expect(getRuleIcon(emailRule())).toBe(IconProp.Email);
  });

  test("channel labels come from the catalog; none means any channel", () => {
    expect(getChannelLabel(ComplianceNotificationChannel.Push)).toBe(
      "Push notification",
    );
    expect(getChannelLabel(ComplianceNotificationChannel.MicrosoftTeams)).toBe(
      "Microsoft Teams",
    );
    expect(getChannelLabel(null)).toBe("Any channel");
    expect(getChannelLabel(undefined)).toBe("Any channel");
  });

  test("titles", () => {
    expect(getRuleTitle(emailRule())).toBe("Verified email");
    expect(getRuleTitle(callForIncidentsRule())).toBe("Call for incidents");
    expect(getRuleTitle(alertRule())).toBe("Alert on-call rules");
    expect(
      getRuleTitle(
        buildRule({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
        }),
      ),
    ).toBe("Push notification for alert episodes");
    expect(
      getRuleTitle(
        buildRule({ ruleType: "HasCarrierPigeon" as ComplianceRuleType }),
      ),
    ).toBe("HasCarrierPigeon");
  });

  test("a scoped rule names its severities, in order, as prose", () => {
    expect(getRuleSentence(callForIncidentsRule())).toBe(
      "Every member has an incident on-call rule that notifies them by Call for Critical Incident and Major Incident.",
    );
  });

  test("an unscoped rule reads as every severity", () => {
    expect(getRuleSentence(alertRule())).toBe(
      "Every member has an alert on-call rule for every alert severity.",
    );
  });

  test("a rule whose selected severities are all gone reads as every severity", () => {
    expect(
      getRuleSentence(
        callForIncidentsRule({ severities: [], appliesToAllSeverities: false }),
      ),
    ).toBe(
      "Every member has an incident on-call rule that notifies them by Call for every incident severity.",
    );
  });

  test("a severity with no name is named by its id", () => {
    expect(
      getRuleSentence(
        callForIncidentsRule({ severities: [{ id: "sev-1", name: "" }] }),
      ),
    ).toContain("by Call for sev-1.");
  });

  test("method rules and unknown rules", () => {
    expect(getRuleSentence(emailRule())).toBe(
      "Every member has a verified email address.",
    );
    expect(
      getRuleSentence(
        buildRule({
          ruleType: ComplianceRuleType.HasNotificationWebhookMethod,
        }),
      ),
    ).toBe("Every member has a webhook notification method.");
    expect(
      getRuleSentence(
        buildRule({ ruleType: "HasCarrierPigeon" as ComplianceRuleType }),
      ),
    ).toBe('Unknown compliance rule "HasCarrierPigeon".');
  });

  test("the every-severity chip names the kind", () => {
    expect(getAllSeveritiesLabel(ComplianceSeverityKind.Incident)).toBe(
      "All incident severities",
    );
    expect(getAllSeveritiesLabel(ComplianceSeverityKind.Alert)).toBe(
      "All alert severities",
    );
  });

  test("pass rates", () => {
    expect(
      getRulePassRate(emailRule({ compliantCount: 3, nonCompliantCount: 1 })),
    ).toEqual({ passing: 3, failing: 1, total: 4, passingPercent: 75 });
    expect(getRulePassRate(emailRule())).toEqual({
      passing: 0,
      failing: 0,
      total: 0,
      passingPercent: 0,
    });
    expect(
      getRulePassRate(emailRule({ compliantCount: -2, nonCompliantCount: 1 })),
    ).toEqual({ passing: 0, failing: 1, total: 1, passingPercent: 0 });
  });

  test("known and active rules", () => {
    const unknown: TeamComplianceRuleJSON = buildRule({
      ruleType: "HasCarrierPigeon" as ComplianceRuleType,
    });
    const paused: TeamComplianceRuleJSON = emailRule({ enabled: false });

    expect(isRuleKnown(emailRule())).toBe(true);
    expect(isRuleKnown(unknown)).toBe(false);
    expect(isRuleActive(emailRule())).toBe(true);
    expect(isRuleActive(paused)).toBe(false);
    expect(isRuleActive(unknown)).toBe(false);
    expect(getActiveRules([emailRule(), paused, unknown])).toHaveLength(1);
  });
});

describe("the verdict", () => {
  test("summarises the payload", () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.complianceSettings.push(
      alertRule({ enabled: false }),
      buildRule({
        settingId: "unknown",
        ruleType: "HasCarrierPigeon" as ComplianceRuleType,
      }),
    );

    expect(summarizeCompliance(status)).toEqual({
      memberCount: 3,
      compliantCount: 1,
      attentionCount: 2,
      ruleCount: 4,
      activeRuleCount: 2,
      pausedRuleCount: 1,
    });
  });

  test("no rules at all", () => {
    const verdict: ComplianceVerdict = getComplianceVerdict(
      summary({ ruleCount: 0, activeRuleCount: 0 }),
    );

    expect(verdict.kind).toBe(ComplianceVerdictKind.NoRules);
    expect(verdict.badgeText).toBe("No active rules");
    expect(verdict.headline).toBe("Nothing is being checked yet");
  });

  test("every rule paused", () => {
    expect(
      getComplianceVerdict(
        summary({ ruleCount: 3, activeRuleCount: 0, pausedRuleCount: 3 }),
      ).headline,
    ).toBe("All 3 rules are paused");
    expect(
      getComplianceVerdict(
        summary({ ruleCount: 1, activeRuleCount: 0, pausedRuleCount: 1 }),
      ).headline,
    ).toBe("The only rule is paused");
  });

  test("only unrecognised rules enabled is not a clean bill of health", () => {
    const verdict: ComplianceVerdict = getComplianceVerdict(
      summary({ ruleCount: 1, activeRuleCount: 0, pausedRuleCount: 0 }),
    );

    expect(verdict.kind).toBe(ComplianceVerdictKind.NoActiveRules);
    expect(verdict.headline).toBe("No rule is being checked");
  });

  test("nobody on the team", () => {
    const verdict: ComplianceVerdict = getComplianceVerdict(
      summary({ memberCount: 0, compliantCount: 0 }),
    );

    expect(verdict.kind).toBe(ComplianceVerdictKind.NoMembers);
    expect(verdict.badgeText).toBe("No members");
  });

  test("everyone compliant", () => {
    expect(getComplianceVerdict(summary({})).headline).toBe(
      "All 3 members meet every rule",
    );
    expect(
      getComplianceVerdict(summary({ memberCount: 1, compliantCount: 1 }))
        .headline,
    ).toBe("The team's only member meets every rule");
    expect(getComplianceVerdict(summary({})).badgeText).toBe("All compliant");
  });

  test.each([
    [12, 9, "9 of 12 members meet every rule", "3 need attention"],
    [12, 1, "1 of 12 members meets every rule", "11 need attention"],
    [2, 1, "1 of 2 members meets every rule", "1 needs attention"],
    [4, 0, "None of the 4 members meet every rule", "4 need attention"],
    [
      1,
      0,
      "The team's only member does not meet every rule",
      "1 needs attention",
    ],
  ])(
    "%i members, %i compliant",
    (members: number, compliant: number, headline: string, badge: string) => {
      const verdict: ComplianceVerdict = getComplianceVerdict(
        summary({
          memberCount: members,
          compliantCount: compliant,
          attentionCount: members - compliant,
        }),
      );

      expect(verdict.kind).toBe(ComplianceVerdictKind.NeedsAttention);
      expect(verdict.headline).toBe(headline);
      expect(verdict.badgeText).toBe(badge);
    },
  );

  test("pluralisation helpers", () => {
    expect(pluralize(1, "rule")).toBe("rule");
    expect(pluralize(2, "rule")).toBe("rules");
    expect(pluralize(0, "needs", "need")).toBe("need");
    expect(countOf(1, "active rule")).toBe("1 active rule");
    expect(countOf(3, "active rule")).toBe("3 active rules");
  });
});

describe("members", () => {
  test("worst first: needing attention, most issues, then by name", () => {
    const email: TeamComplianceRuleJSON = emailRule();
    const call: TeamComplianceRuleJSON = callForIncidentsRule();
    const members: Array<TeamMemberComplianceJSON> = [
      buildMember({ userId: "1", userName: "zoe" }),
      buildMember({
        userId: "2",
        userName: "Bea",
        nonCompliantRules: [issue(call, CALL_REASON)],
      }),
      buildMember({ userId: "3", userName: "Adam" }),
      buildMember({
        userId: "4",
        userName: "Carl",
        nonCompliantRules: [
          issue(email, EMAIL_REASON),
          issue(call, CALL_REASON),
        ],
      }),
      buildMember({
        userId: "5",
        userName: "alex",
        nonCompliantRules: [issue(call, CALL_REASON)],
      }),
    ];

    expect(namesOf(sortMembers(members))).toEqual([
      "Carl",
      "alex",
      "Bea",
      "Adam",
      "zoe",
    ]);
    // The input is left alone.
    expect(namesOf(members)[0]).toBe("zoe");
  });

  test("same name sorts by email, and a nameless member sorts by email", () => {
    const members: Array<TeamMemberComplianceJSON> = [
      buildMember({ userId: "1", userName: "Sam", userEmail: "z@acme.com" }),
      buildMember({ userId: "2", userName: "Sam", userEmail: "a@acme.com" }),
      buildMember({ userId: "3", userName: "", userEmail: "b@acme.com" }),
    ];

    expect(
      sortMembers(members).map((member: TeamMemberComplianceJSON) => {
        return member.userEmail;
      }),
    ).toEqual(["b@acme.com", "a@acme.com", "z@acme.com"]);
  });

  test("display and first names", () => {
    expect(getMemberDisplayName(buildMember())).toBe("Jane Doe");
    expect(
      getMemberDisplayName(buildMember({ userName: "", userEmail: "x@y.z" })),
    ).toBe("x@y.z");
    expect(
      getMemberDisplayName(buildMember({ userName: "", userEmail: "" })),
    ).toBe("Unknown User");
    expect(getMemberFirstName(buildMember())).toBe("Jane");
    expect(
      getMemberFirstName(buildMember({ userName: "  Omar  Haddad " })),
    ).toBe("Omar");
    expect(
      getMemberFirstName(
        buildMember({ userName: "Unknown User", userEmail: "u@acme.com" }),
      ),
    ).toBe("u@acme.com");
    expect(
      getMemberFirstName(buildMember({ userName: "", userEmail: "" })),
    ).toBe("this member");
  });

  test("search matches name or email, ignoring case and padding", () => {
    const jane: TeamMemberComplianceJSON = buildMember();

    expect(memberMatchesSearch(jane, "")).toBe(true);
    expect(memberMatchesSearch(jane, "   ")).toBe(true);
    expect(memberMatchesSearch(jane, "JANE")).toBe(true);
    expect(memberMatchesSearch(jane, " doe ")).toBe(true);
    expect(memberMatchesSearch(jane, "acme.com")).toBe(true);
    expect(memberMatchesSearch(jane, "omar")).toBe(false);
  });

  test("status filters", () => {
    const compliant: TeamMemberComplianceJSON = buildMember();
    const failing: TeamMemberComplianceJSON = buildMember({
      nonCompliantRules: [issue(emailRule(), EMAIL_REASON)],
    });

    expect(memberMatchesStatus(compliant, MemberStatusFilter.All)).toBe(true);
    expect(memberMatchesStatus(failing, MemberStatusFilter.All)).toBe(true);
    expect(memberMatchesStatus(compliant, MemberStatusFilter.Compliant)).toBe(
      true,
    );
    expect(memberMatchesStatus(failing, MemberStatusFilter.Compliant)).toBe(
      false,
    );
    expect(
      memberMatchesStatus(failing, MemberStatusFilter.NeedsAttention),
    ).toBe(true);
    expect(
      memberMatchesStatus(compliant, MemberStatusFilter.NeedsAttention),
    ).toBe(false);
  });

  test("filters combine, and the result is sorted worst first", () => {
    const members: Array<TeamMemberComplianceJSON> =
      standardStatus().userComplianceStatuses;

    expect(
      namesOf(
        filterMembers({
          members: members,
          status: MemberStatusFilter.All,
          search: "",
          failingSettingId: null,
        }),
      ),
    ).toEqual(["Jane Doe", "Omar Haddad", "Priya Patel"]);

    expect(
      namesOf(
        filterMembers({
          members: members,
          status: MemberStatusFilter.All,
          search: "",
          failingSettingId: EMAIL_RULE_ID,
        }),
      ),
    ).toEqual(["Jane Doe"]);

    expect(
      namesOf(
        filterMembers({
          members: members,
          status: MemberStatusFilter.NeedsAttention,
          search: "omar",
          failingSettingId: CALL_RULE_ID,
        }),
      ),
    ).toEqual(["Omar Haddad"]);

    expect(
      filterMembers({
        members: members,
        status: MemberStatusFilter.Compliant,
        search: "",
        failingSettingId: CALL_RULE_ID,
      }),
    ).toEqual([]);
  });

  test("counts by status", () => {
    expect(
      countMembersByStatus(standardStatus().userComplianceStatuses),
    ).toEqual({ all: 3, needsAttention: 2, compliant: 1 });
    expect(countMembersByStatus([])).toEqual({
      all: 0,
      needsAttention: 0,
      compliant: 0,
    });
  });

  test("a member's issue for a rule", () => {
    const jane: TeamMemberComplianceJSON =
      standardStatus().userComplianceStatuses[2]!;

    expect(getMemberIssueForRule(jane, EMAIL_RULE_ID)?.reason).toBe(
      EMAIL_REASON,
    );
    expect(getMemberIssueForRule(jane, "nope")).toBeUndefined();
  });
});

describe("where a member fixes themselves", () => {
  test.each([
    [
      ComplianceRuleType.HasIncidentOnCallRules,
      PageMap.USER_SETTINGS_INCIDENT_ON_CALL_RULES,
      "Open my incident on-call rules",
    ],
    [
      ComplianceRuleType.HasAlertOnCallRules,
      PageMap.USER_SETTINGS_ALERT_ON_CALL_RULES,
      "Open my alert on-call rules",
    ],
    [
      ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      PageMap.USER_SETTINGS_INCIDENT_EPISODE_ON_CALL_RULES,
      "Open my incident episode on-call rules",
    ],
    [
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
      PageMap.USER_SETTINGS_ALERT_EPISODE_ON_CALL_RULES,
      "Open my alert episode on-call rules",
    ],
  ])("%s → %s", (ruleType: string, page: PageMap, title: string) => {
    expect(getSelfFix(ruleType)).toEqual({ page: page, title: title });
  });

  test("every method rule is fixed on the notification methods page", () => {
    for (const definition of COMPLIANCE_RULE_DEFINITIONS) {
      if (definition.category !== ComplianceRuleCategory.NotificationMethod) {
        continue;
      }

      expect(getSelfFix(definition.ruleType)).toEqual({
        page: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
        title: "Open my notification methods",
      });
    }
  });

  test("an unknown or missing rule type falls back to the methods page", () => {
    expect(getSelfFix("HasCarrierPigeon").page).toBe(
      PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
    );
    expect(getSelfFix(undefined).page).toBe(
      PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
    );
  });
});

describe("rule warnings", () => {
  const CALL_WARNING: string =
    "Call notifications are switched off for this project, so members will not be notified by Call even when they meet this rule. Turn them on in Project Settings > Notification Settings.";

  test("only enabled rules with warnings interrupt the page", () => {
    const groups: Array<RuleWarningGroup> = getRuleWarningGroups([
      callForIncidentsRule({ warnings: [CALL_WARNING] }),
      emailRule(),
      alertRule({ enabled: false, warnings: ["paused problem"] }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe("Call for incidents");
    expect(groups[0]!.warnings).toEqual([CALL_WARNING]);
    expect(groups[0]!.channel).toBe(ComplianceNotificationChannel.Call);
  });

  test.each(ALL_CHANNELS)(
    "a %s rule is fixed in project notification settings only for switchable channels",
    (channel: ComplianceNotificationChannel) => {
      const group: RuleWarningGroup = getRuleWarningGroups([
        callForIncidentsRule({
          notificationChannel: channel,
          warnings: ["x"],
        }),
      ])[0]!;

      expect(isFixedInProjectNotificationSettings(group)).toBe(
        PROJECT_SWITCHED_CHANNELS.includes(channel),
      );
    },
  );

  test("the switchable channels are exactly Call, SMS, WhatsApp and Telegram", () => {
    expect([...PROJECT_SWITCHED_CHANNELS]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.SMS,
      ComplianceNotificationChannel.WhatsApp,
      ComplianceNotificationChannel.Telegram,
    ]);
  });

  test("a method rule's channel counts too", () => {
    const group: RuleWarningGroup = getRuleWarningGroups([
      buildRule({
        ruleType: ComplianceRuleType.HasNotificationSMSMethod,
        warnings: ["x"],
      }),
    ])[0]!;

    expect(isFixedInProjectNotificationSettings(group)).toBe(true);
  });

  test("an unknown rule's warning has no settings fix", () => {
    const group: RuleWarningGroup = getRuleWarningGroups([
      buildRule({
        ruleType: "HasCarrierPigeon" as ComplianceRuleType,
        warnings: ["This rule type is not recognised, so it is not checked."],
      }),
    ])[0]!;

    expect(group.title).toBe("HasCarrierPigeon");
    expect(isFixedInProjectNotificationSettings(group)).toBe(false);
  });
});

describe("parsing the payload", () => {
  test("a well-formed payload passes through unchanged", () => {
    const status: TeamComplianceStatusJSON = standardStatus();
    status.userComplianceStatuses[0]!.userProfilePictureId = "pic-1";

    expect(
      parseComplianceStatus(
        JSON.parse(JSON.stringify(status)) as unknown as JSONObject,
      ),
    ).toEqual(status);
  });

  test("an empty object renders as an empty team, not a crash", () => {
    expect(parseComplianceStatus({})).toEqual({
      teamId: "",
      teamName: "",
      evaluatedAt: "",
      complianceSettings: [],
      userComplianceStatuses: [],
    });
  });

  test("a legacy payload (no ids, counts or scope) still renders", () => {
    const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
      teamId: "t",
      teamName: "Legacy",
      complianceSettings: [
        { ruleType: "HasNotificationEmailMethod", enabled: true },
      ],
      userComplianceStatuses: [
        {
          userId: JANE_ID,
          userName: "Jane",
          userEmail: "jane@acme.com",
          nonCompliantRules: [
            { ruleType: "HasNotificationEmailMethod", reason: EMAIL_REASON },
          ],
        },
      ],
    });

    expect(parsed.complianceSettings[0]).toEqual({
      settingId: "rule-0",
      ruleType: "HasNotificationEmailMethod",
      enabled: true,
      notificationChannel: null,
      severityKind: null,
      appliesToAllSeverities: false,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 0,
      warnings: [],
    });
    // isCompliant missing: decided by whether any rule failed.
    expect(parsed.userComplianceStatuses[0]!.isCompliant).toBe(false);
    expect(parsed.userComplianceStatuses[0]!.nonCompliantRules[0]).toEqual({
      settingId: "",
      ruleType: "HasNotificationEmailMethod",
      reason: EMAIL_REASON,
    });
  });

  test("junk is dropped or defaulted", () => {
    const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
      teamId: 42,
      complianceSettings: [
        null,
        "rule",
        {
          settingId: "s1",
          ruleType: "HasIncidentOnCallRules",
          enabled: "yes",
          notificationChannel: "",
          severityKind: "Sideways",
          compliantCount: "7",
          nonCompliantCount: Number.NaN,
          severities: [{ id: "a", name: "A", color: "" }, { name: "no id" }, 7],
          warnings: ["w1", "", 3, null],
        },
      ],
      userComplianceStatuses: [
        { userName: "No id" },
        { userId: OMAR_ID, isCompliant: true, nonCompliantRules: "none" },
      ],
    } as unknown as JSONObject);

    expect(parsed.teamId).toBe("42");
    expect(parsed.complianceSettings).toEqual([
      {
        settingId: "s1",
        ruleType: "HasIncidentOnCallRules",
        enabled: false,
        notificationChannel: null,
        severityKind: null,
        appliesToAllSeverities: false,
        severities: [{ id: "a", name: "A" }],
        compliantCount: 0,
        nonCompliantCount: 0,
        warnings: ["w1", "3"],
      },
    ]);
    expect(parsed.userComplianceStatuses).toEqual([
      {
        userId: OMAR_ID,
        userName: "",
        userEmail: "",
        isCompliant: true,
        nonCompliantRules: [],
      },
    ]);
  });

  test("the severity kind survives for both kinds", () => {
    const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
      complianceSettings: [
        { settingId: "i", severityKind: "Incident" },
        { settingId: "a", severityKind: "Alert" },
      ],
    } as unknown as JSONObject);

    expect(
      parsed.complianceSettings.map((rule: TeamComplianceRuleJSON) => {
        return rule.severityKind;
      }),
    ).toEqual([ComplianceSeverityKind.Incident, ComplianceSeverityKind.Alert]);
  });

  test("the checked-at time", () => {
    expect(getEvaluatedAt(buildStatus())?.toISOString()).toBe(EVALUATED_AT);
    expect(getEvaluatedAt(buildStatus({ evaluatedAt: "" }))).toBeNull();
    expect(getEvaluatedAt(buildStatus({ evaluatedAt: "yesterday-ish" }))).toBe(
      null,
    );
  });

  test("the standard fixture is what the other suites assume", () => {
    const status: TeamComplianceStatusJSON = standardStatus();

    expect(
      status.userComplianceStatuses.map((member: TeamMemberComplianceJSON) => {
        return [member.userId, member.isCompliant];
      }),
    ).toEqual([
      [PRIYA_ID, true],
      [OMAR_ID, false],
      [JANE_ID, false],
    ]);
  });
});
