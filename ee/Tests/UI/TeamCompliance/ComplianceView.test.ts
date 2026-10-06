import { describe, expect, test } from "@jest/globals";
import {
  CHANNEL_ICONS,
  ComplianceSummary,
  ComplianceVerdict,
  ComplianceVerdictKind,
  MemberStatusCounts,
  MemberStatusFilter,
  NO_SEVERITIES_LEFT_WARNING,
  PROJECT_SWITCHED_CHANNELS,
  RuleWarningGroup,
  SelfFix,
  areAllRulesPaused,
  countFilteredMembersByStatus,
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
  getNextRuleSquareIndex,
  getNoActiveRulesAdvice,
  getRuleChannels,
  getRuleIcon,
  getRuleLabel,
  getRulePassRate,
  getRulePassRateText,
  getRuleSentence,
  getRuleTitle,
  getRuleTypeIcon,
  getRuleWarningGroups,
  getSelfFix,
  getSelfFixKey,
  getSelfFixes,
  hasNoSeveritiesLeft,
  hasServerId,
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
  CALL_AND_PUSH_RULE_ID,
  CALL_REASON,
  CALL_RULE_ID,
  EMAIL_REASON,
  EMAIL_RULE_ID,
  EVALUATED_AT,
  JANE_ID,
  OMAR_ID,
  PRIYA_ID,
  SEVERITIES_DELETED_WARNING,
  alertRule,
  buildMember,
  buildRule,
  buildStatus,
  callAndPushForIncidentsRule,
  callForEveryIncidentRule,
  callForIncidentsRule,
  emailRule,
  issue,
  noSeveritiesLeftRule,
  standardStatus,
} from "./ComplianceFixtures";
import { PROJECT_CHANNEL_SWITCHES } from "../../../Server/TeamCompliance/TeamComplianceEvaluator";
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
    resumableRuleCount: 0,
    noSeveritiesLeftRuleCount: 0,
    unrecognisedRuleCount: 0,
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

  test("the channels a rule is about", () => {
    expect(getRuleChannels(emailRule())).toEqual([
      ComplianceNotificationChannel.Email,
    ]);
    expect(getRuleChannels(callForIncidentsRule())).toEqual([
      ComplianceNotificationChannel.Call,
    ]);
    expect(getRuleChannels(callAndPushForIncidentsRule())).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    // Any channel.
    expect(getRuleChannels(alertRule())).toEqual([]);
    expect(
      getRuleChannels(
        buildRule({
          ruleType: "HasCarrierPigeon" as ComplianceRuleType,
          notificationChannels: [ComplianceNotificationChannel.Call],
        }),
      ),
    ).toEqual([]);
    expect(
      getRuleChannels(
        callForIncidentsRule({
          notificationChannels: ["Fax" as ComplianceNotificationChannel],
        }),
      ),
    ).toEqual([]);
  });

  test("a method rule is about its own channel, never an on-call rule's list", () => {
    expect(
      getRuleChannels(
        emailRule({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toEqual([ComplianceNotificationChannel.Email]);
    expect(
      getRuleChannels(
        buildRule({
          ruleType: ComplianceRuleType.HasNotificationWebhookMethod,
        }),
      ),
    ).toEqual([ComplianceNotificationChannel.Webhook]);
  });

  test.each(
    COMPLIANCE_RULE_DEFINITIONS.filter(
      (definition: ComplianceRuleDefinition): boolean => {
        return (
          definition.category === ComplianceRuleCategory.NotificationMethod
        );
      },
    ).map(
      (
        definition: ComplianceRuleDefinition,
      ): [string, ComplianceNotificationChannel] => {
        return [definition.ruleType, definition.methodChannel!];
      },
    ),
  )(
    "the method rule %s is about exactly %s",
    (ruleType: string, channel: ComplianceNotificationChannel) => {
      expect(
        getRuleChannels(
          buildRule({ ruleType: ruleType as ComplianceRuleType }),
        ),
      ).toEqual([channel]);
    },
  );

  /*
   * The list an on-call rule arrives with is read the way the server reads
   * it: known channels only, each once, in catalog order - whatever order
   * they were picked or sent in.
   */
  test("an on-call rule's channels are read in catalog order, each once, known ones only", () => {
    expect(
      getRuleChannels(
        callForIncidentsRule({
          notificationChannels: [
            ComplianceNotificationChannel.Webhook,
            "Fax" as ComplianceNotificationChannel,
            ComplianceNotificationChannel.Push,
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
      ComplianceNotificationChannel.Webhook,
    ]);
  });

  test("a channel rule wears its channel, an any-channel rule its kind", () => {
    expect(getRuleIcon(callForIncidentsRule())).toBe(IconProp.Call);
    expect(getRuleIcon(alertRule())).toBe(IconProp.ExclaimationCircle);
    expect(getRuleIcon(emailRule())).toBe(IconProp.Email);
  });

  /*
   * No one channel stands for a rule on several - its chips show them all -
   * so it wears its kind, as an any-channel rule does.
   */
  test("a rule on several channels wears its kind, not one of its channels", () => {
    expect(getRuleIcon(callAndPushForIncidentsRule())).toBe(IconProp.Alert);
    expect(
      getRuleIcon(
        alertRule({
          notificationChannels: [
            ComplianceNotificationChannel.SMS,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toBe(IconProp.ExclaimationCircle);
    expect(
      getRuleIcon(
        buildRule({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannels: [
            ComplianceNotificationChannel.Slack,
            ComplianceNotificationChannel.Webhook,
          ],
        }),
      ),
    ).toBe(IconProp.SquareStack3D);
  });

  test("a rule whose list holds one known channel wears that channel", () => {
    expect(
      getRuleIcon(
        callForIncidentsRule({
          notificationChannels: [
            ComplianceNotificationChannel.Push,
            "Fax" as ComplianceNotificationChannel,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toBe(IconProp.DevicePhoneMobile);
  });

  test("a method rule wears its own channel, whatever list it carries", () => {
    expect(
      getRuleIcon(
        emailRule({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toBe(IconProp.Email);
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
          notificationChannels: [ComplianceNotificationChannel.Push],
        }),
      ),
    ).toBe("Push notification for alert episodes");
    expect(
      getRuleTitle(
        buildRule({ ruleType: "HasCarrierPigeon" as ComplianceRuleType }),
      ),
    ).toBe("HasCarrierPigeon");
  });

  test("a rule on several channels is titled for all of them, in catalog order", () => {
    expect(getRuleTitle(callAndPushForIncidentsRule())).toBe(
      "Call and Push notification for incidents",
    );
    expect(
      getRuleTitle(
        alertRule({
          notificationChannels: [
            ComplianceNotificationChannel.Webhook,
            ComplianceNotificationChannel.SMS,
            ComplianceNotificationChannel.Call,
          ],
        }),
      ),
    ).toBe("Call, SMS and Webhook for alerts");
    // A title needs no more of the rule than its type and channels.
    expect(
      getRuleTitle({
        ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
        notificationChannels: [
          ComplianceNotificationChannel.MicrosoftTeams,
          ComplianceNotificationChannel.Slack,
        ],
      }),
    ).toBe("Slack and Microsoft Teams for incident episodes");
    expect(
      getRuleTitle({
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        notificationChannels: [],
      }),
    ).toBe("Incident on-call rules");
  });

  test("a method rule's title ignores any channel list it carries", () => {
    expect(
      getRuleTitle(
        emailRule({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toBe("Verified email");
  });

  /*
   * Several rules of one type and channel are allowed (Call for Critical
   * incidents, Call for Major incidents), and their titles are identical - so
   * wherever one rule is named on its own (a switch, a button, the delete
   * confirmation, a warning, a filter chip) the name carries the scope.
   */
  test("labels tell rules of one type and channel apart by their scope", () => {
    const critical: TeamComplianceRuleJSON = callForIncidentsRule({
      settingId: "critical",
      severities: [{ id: "c", name: "Critical Incident" }],
    });
    const major: TeamComplianceRuleJSON = callForIncidentsRule({
      settingId: "major",
      severities: [{ id: "m", name: "Major Incident" }],
    });

    expect(getRuleTitle(critical)).toBe(getRuleTitle(major));
    expect(getRuleLabel(critical)).toBe(
      "Call for incidents (Critical Incident)",
    );
    expect(getRuleLabel(major)).toBe("Call for incidents (Major Incident)");
    expect(getRuleLabel(callForIncidentsRule())).toBe(
      "Call for incidents (Critical Incident and Major Incident)",
    );
  });

  /*
   * "Call for Critical" and "Call and Push for Critical" are different rules
   * a team may hold side by side, and their names differ by their channels.
   */
  test("rules of one type and severity are told apart by their channels", () => {
    const callOnly: TeamComplianceRuleJSON = callForIncidentsRule({
      severities: [{ id: "c", name: "Critical Incident" }],
    });
    const callAndPush: TeamComplianceRuleJSON = callAndPushForIncidentsRule();

    expect(getRuleLabel(callOnly)).toBe(
      "Call for incidents (Critical Incident)",
    );
    expect(getRuleLabel(callAndPush)).toBe(
      "Call and Push notification for incidents (Critical Incident)",
    );
    expect(getRuleLabel(callAndPush)).not.toBe(getRuleLabel(callOnly));
    expect(
      getRuleLabel(
        callAndPushForIncidentsRule({
          appliesToAllSeverities: true,
          severities: [],
        }),
      ),
    ).toBe(
      "Call and Push notification for incidents (all incident severities)",
    );
  });

  test("an unscoped on-call rule's label says every severity of its kind", () => {
    expect(getRuleLabel(alertRule())).toBe(
      "Alert on-call rules (all alert severities)",
    );
    expect(getRuleLabel(callForEveryIncidentRule())).toBe(
      "Call for incidents (all incident severities)",
    );
    // The kind comes from the catalog when the payload leaves it out.
    expect(getRuleLabel(alertRule({ severityKind: null }))).toBe(
      "Alert on-call rules (all alert severities)",
    );
    expect(
      getRuleLabel(
        callForIncidentsRule({ severities: [{ id: "sev-1", name: "" }] }),
      ),
    ).toBe("Call for incidents (sev-1)");
  });

  test("method and unknown rules have no scope, so their label is their title", () => {
    expect(getRuleLabel(emailRule())).toBe("Verified email");
    expect(
      getRuleLabel(
        buildRule({ ruleType: "HasCarrierPigeon" as ComplianceRuleType }),
      ),
    ).toBe("HasCarrierPigeon");
  });

  test("a scoped rule names its severities, in order, as prose", () => {
    expect(getRuleSentence(callForIncidentsRule())).toBe(
      "Every member has an incident on-call rule that notifies them by Call for Critical Incident and Major Incident.",
    );
  });

  /*
   * A rule on several channels is met only with a rule on each, and its
   * sentence says rules - plural - on every one of them.
   */
  test("a rule on several channels says a rule is needed on each", () => {
    expect(getRuleSentence(callAndPushForIncidentsRule())).toBe(
      "Every member has incident on-call rules that notify them by Call and by Push notification for Critical Incident.",
    );
    expect(
      getRuleSentence(
        alertRule({
          notificationChannels: [
            ComplianceNotificationChannel.Telegram,
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.SMS,
          ],
        }),
      ),
    ).toBe(
      "Every member has alert on-call rules that notify them by Call, by SMS and by Telegram for every alert severity.",
    );
  });

  test("a sentence ignores values that are not channels", () => {
    expect(
      getRuleSentence(
        callForIncidentsRule({
          notificationChannels: [
            "Fax" as ComplianceNotificationChannel,
            ComplianceNotificationChannel.Call,
          ],
        }),
      ),
    ).toBe(getRuleSentence(callForIncidentsRule()));
    expect(
      getRuleSentence(
        alertRule({
          notificationChannels: ["Fax" as ComplianceNotificationChannel],
        }),
      ),
    ).toBe("Every member has an alert on-call rule for every alert severity.");
  });

  test("an unscoped rule reads as every severity", () => {
    expect(getRuleSentence(alertRule())).toBe(
      "Every member has an alert on-call rule for every alert severity.",
    );
  });

  /*
   * The server pauses a rule whose every severity was deleted and sends it
   * with no severities and NOT every severity. It checks none, so it must not
   * claim to check every one.
   */
  test("a rule whose selected severities are all gone says so, not every severity", () => {
    expect(getRuleSentence(noSeveritiesLeftRule())).toBe(
      "Every member has an incident on-call rule that notifies them by Call for severities that have since been deleted.",
    );
    expect(getRuleSentence(noSeveritiesLeftRule())).not.toContain(
      "every incident severity",
    );
    expect(
      getRuleSentence(
        noSeveritiesLeftRule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannels: [],
          severityKind: ComplianceSeverityKind.Alert,
        }),
      ),
    ).toBe(
      "Every member has an alert on-call rule for severities that have since been deleted.",
    );
    expect(
      getRuleSentence(
        noSeveritiesLeftRule({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toBe(
      "Every member has incident on-call rules that notify them by Call and by Push notification for severities that have since been deleted.",
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

  test.each([
    [5, 5, "All 5", "meet it", "All 5 meet this rule"],
    [2, 2, "All 2", "meet it", "All 2 meet this rule"],
    [1, 1, "1 of 1", "member meets it", "1 of 1 member meets this rule"],
    [0, 1, "0 of 1", "member meets it", "0 of 1 member meets this rule"],
    [0, 3, "0 of 3", "members meet it", "0 of 3 members meet this rule"],
    [1, 3, "1 of 3", "members meets it", "1 of 3 members meets this rule"],
    [2, 3, "2 of 3", "members meet it", "2 of 3 members meet this rule"],
  ])(
    "pass rate words: %i of %i",
    (
      passing: number,
      total: number,
      count: string,
      caption: string,
      label: string,
    ) => {
      expect(
        getRulePassRateText(
          getRulePassRate(
            emailRule({
              compliantCount: passing,
              nonCompliantCount: total - passing,
            }),
          ),
        ),
      ).toEqual({ count: count, caption: caption, label: label });
    },
  );

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

/*
 * A rule whose every severity was deleted is paused by the server and sent
 * with no severities and NOT every severity. Read as an every-severity rule it
 * would be named like the team's real one, and one click on its switch would
 * turn it into a copy of it.
 */
describe("a rule whose every severity was deleted", () => {
  test("is told apart by its shape: an on-call rule with no severities that is not an every-severity rule", () => {
    expect(hasNoSeveritiesLeft(noSeveritiesLeftRule())).toBe(true);
    // The shape says it, whatever the switch says.
    expect(hasNoSeveritiesLeft(noSeveritiesLeftRule({ enabled: true }))).toBe(
      true,
    );
    expect(
      hasNoSeveritiesLeft(
        noSeveritiesLeftRule({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannels: [],
          severityKind: ComplianceSeverityKind.Alert,
        }),
      ),
    ).toBe(true);
    // However many channels it insists on.
    expect(
      hasNoSeveritiesLeft(
        noSeveritiesLeftRule({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toBe(true);

    expect(hasNoSeveritiesLeft(callForEveryIncidentRule())).toBe(false);
    expect(hasNoSeveritiesLeft(alertRule())).toBe(false);
    expect(hasNoSeveritiesLeft(callForIncidentsRule())).toBe(false);
    // Method rules and unknown rules have no severities to lose.
    expect(hasNoSeveritiesLeft(emailRule())).toBe(false);
    expect(
      hasNoSeveritiesLeft(
        buildRule({ ruleType: "HasCarrierPigeon" as ComplianceRuleType }),
      ),
    ).toBe(false);
  });

  test("is never named like the team's every-severity rule of the same type and channel", () => {
    const deleted: TeamComplianceRuleJSON = noSeveritiesLeftRule();
    const every: TeamComplianceRuleJSON = callForEveryIncidentRule();

    expect(getRuleTitle(deleted)).toBe(getRuleTitle(every));
    expect(getRuleLabel(deleted)).toBe(
      "Call for incidents (no severities left)",
    );
    expect(getRuleLabel(every)).toBe(
      "Call for incidents (all incident severities)",
    );
    expect(
      getRuleLabel(
        noSeveritiesLeftRule({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannels: [],
          severityKind: ComplianceSeverityKind.Alert,
        }),
      ),
    ).toBe("Alert episode on-call rules (no severities left)");
    expect(
      getRuleLabel(
        noSeveritiesLeftRule({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
        }),
      ),
    ).toBe("Call and Push notification for incidents (no severities left)");
  });

  /*
   * The server checks nobody against it, whatever its switch says - so the
   * page never counts it as a rule members are measured against.
   */
  test("is never active, even switched on", () => {
    const switchedOn: TeamComplianceRuleJSON = noSeveritiesLeftRule({
      enabled: true,
    });

    expect(isRuleActive(noSeveritiesLeftRule())).toBe(false);
    expect(isRuleActive(switchedOn)).toBe(false);
    expect(getActiveRules([switchedOn, emailRule()])).toEqual([emailRule()]);

    const counts: ComplianceSummary = summarizeCompliance(
      buildStatus({
        complianceSettings: [switchedOn],
        userComplianceStatuses: [buildMember()],
      }),
    );

    expect(counts).toMatchObject({
      ruleCount: 1,
      activeRuleCount: 0,
      pausedRuleCount: 0,
      resumableRuleCount: 0,
      noSeveritiesLeftRuleCount: 1,
      unrecognisedRuleCount: 0,
    });
    expect(getComplianceVerdict(counts).detail).toBe(
      "Nobody is being checked right now. This team's rule has no severities left: every severity it was scoped to has been deleted. Edit it to choose new severities, or delete it.",
    );
  });

  test("the page's own words for it, when the server sends none, are the server's", () => {
    expect(NO_SEVERITIES_LEFT_WARNING).toBe(SEVERITIES_DELETED_WARNING);
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
      buildRule({
        settingId: "unknown-paused",
        ruleType: "HasCarrierPigeon" as ComplianceRuleType,
        enabled: false,
      }),
      noSeveritiesLeftRule(),
    );

    expect(summarizeCompliance(status)).toEqual({
      memberCount: 3,
      compliantCount: 1,
      attentionCount: 2,
      ruleCount: 6,
      activeRuleCount: 2,
      // What the page shows as "(3 paused)": every rule switched off.
      pausedRuleCount: 3,
      // Only the alert rule would check anybody if it were turned on.
      resumableRuleCount: 1,
      noSeveritiesLeftRuleCount: 1,
      // On or off, a rule of an unknown type is never checked.
      unrecognisedRuleCount: 2,
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
        summary({
          ruleCount: 3,
          activeRuleCount: 0,
          pausedRuleCount: 3,
          resumableRuleCount: 3,
        }),
      ).headline,
    ).toBe("All 3 rules are paused");
    expect(
      getComplianceVerdict(
        summary({
          ruleCount: 1,
          activeRuleCount: 0,
          pausedRuleCount: 1,
          resumableRuleCount: 1,
        }),
      ).headline,
    ).toBe("The only rule is paused");
  });

  test("only unrecognised rules enabled is not a clean bill of health", () => {
    const verdict: ComplianceVerdict = getComplianceVerdict(
      summary({
        ruleCount: 1,
        activeRuleCount: 0,
        pausedRuleCount: 0,
        unrecognisedRuleCount: 1,
      }),
    );

    expect(verdict.kind).toBe(ComplianceVerdictKind.NoActiveRules);
    expect(verdict.headline).toBe("No rule is being checked");
  });

  /*
   * An enabled rule of a type this build does not know is ON: "turn a rule
   * on" sends the admin to a switch that is already on.
   */
  test("unrecognised rules that are on are not called paused, nor turned on", () => {
    const one: ComplianceVerdict = getComplianceVerdict(
      summary({
        ruleCount: 1,
        activeRuleCount: 0,
        pausedRuleCount: 0,
        unrecognisedRuleCount: 1,
      }),
    );

    expect(one.detail).toBe(
      "Nobody is being checked right now. This team's rule is of a type this version does not recognise, so it is not checked. Delete it and add a supported rule.",
    );
    expect(one.detail).not.toContain("Turn a rule on");

    expect(
      getComplianceVerdict(
        summary({
          ruleCount: 2,
          activeRuleCount: 0,
          pausedRuleCount: 0,
          unrecognisedRuleCount: 2,
        }),
      ).detail,
    ).toBe(
      "Nobody is being checked right now. All 2 of this team's rules are of a type this version does not recognise, so they are not checked. Delete them and add a supported rule.",
    );
  });

  test("paused and unrecognised rules together: turn one on, or replace the others", () => {
    const verdict: ComplianceVerdict = getComplianceVerdict(
      summary({
        ruleCount: 2,
        activeRuleCount: 0,
        pausedRuleCount: 1,
        resumableRuleCount: 1,
        unrecognisedRuleCount: 1,
      }),
    );

    expect(verdict.headline).toBe("No rule is being checked");
    expect(verdict.detail).toBe(
      "Nobody is being checked right now. 1 rule is paused and 1 rule is of a type this version does not recognise. Turn a paused rule on, or replace the unrecognised one.",
    );
  });

  test("every rule paused keeps its advice to turn one on", () => {
    expect(
      getComplianceVerdict(
        summary({
          ruleCount: 2,
          activeRuleCount: 0,
          pausedRuleCount: 2,
          resumableRuleCount: 2,
        }),
      ).detail,
    ).toBe(
      "Nobody is being checked right now. Turn a rule on to see who meets it.",
    );
  });

  /*
   * From real payloads, not count stubs: "turn a rule on" is advice only
   * where turning one on would check somebody.
   */
  describe("advice when nothing is checked", () => {
    const pigeon: (
      overrides?: Partial<TeamComplianceRuleJSON>,
    ) => TeamComplianceRuleJSON = (
      overrides?: Partial<TeamComplianceRuleJSON>,
    ): TeamComplianceRuleJSON => {
      return buildRule({
        settingId: "pigeon",
        ruleType: "HasCarrierPigeon" as ComplianceRuleType,
        ...(overrides || {}),
      });
    };

    const verdictFor: (
      rules: Array<TeamComplianceRuleJSON>,
    ) => ComplianceVerdict = (
      rules: Array<TeamComplianceRuleJSON>,
    ): ComplianceVerdict => {
      return getComplianceVerdict(
        summarizeCompliance(
          buildStatus({
            complianceSettings: rules,
            userComplianceStatuses: [buildMember()],
          }),
        ),
      );
    };

    const allPausedFor: (rules: Array<TeamComplianceRuleJSON>) => boolean = (
      rules: Array<TeamComplianceRuleJSON>,
    ): boolean => {
      return areAllRulesPaused(
        summarizeCompliance(buildStatus({ complianceSettings: rules })),
      );
    };

    test("a paused rule of an unrecognised type, alone: delete it - turning it on checks nobody", () => {
      const verdict: ComplianceVerdict = verdictFor([
        pigeon({ enabled: false }),
      ]);

      expect(verdict.kind).toBe(ComplianceVerdictKind.NoActiveRules);
      expect(verdict.headline).toBe("No rule is being checked");
      expect(verdict.detail).toBe(
        "Nobody is being checked right now. This team's rule is of a type this version does not recognise, so it is not checked. Delete it and add a supported rule.",
      );
      expect(verdict.detail).not.toContain("Turn");
      expect(allPausedFor([pigeon({ enabled: false })])).toBe(false);
    });

    test("a paused and an enabled rule of an unrecognised type: both unrecognised, neither to turn on", () => {
      const rules: Array<TeamComplianceRuleJSON> = [
        pigeon({ settingId: "pigeon-1", enabled: false }),
        pigeon({ settingId: "pigeon-2", enabled: true }),
      ];
      const verdict: ComplianceVerdict = verdictFor(rules);

      expect(verdict.detail).toBe(
        "Nobody is being checked right now. All 2 of this team's rules are of a type this version does not recognise, so they are not checked. Delete them and add a supported rule.",
      );
      expect(verdict.detail).not.toContain("paused");
      expect(allPausedFor(rules)).toBe(false);
    });

    test("a paused unrecognised rule beside a paused known one: turn the known one on, replace the other", () => {
      const rules: Array<TeamComplianceRuleJSON> = [
        emailRule({ enabled: false }),
        pigeon({ enabled: false }),
      ];

      expect(verdictFor(rules).detail).toBe(
        "Nobody is being checked right now. 1 rule is paused and 1 rule is of a type this version does not recognise. Turn a paused rule on, or replace the unrecognised one.",
      );
      expect(allPausedFor(rules)).toBe(false);
    });

    test("a rule with no severities left, alone: edit it - turning it on checks nobody", () => {
      const verdict: ComplianceVerdict = verdictFor([noSeveritiesLeftRule()]);

      expect(verdict.kind).toBe(ComplianceVerdictKind.NoActiveRules);
      expect(verdict.headline).toBe("No rule is being checked");
      expect(verdict.detail).toBe(
        "Nobody is being checked right now. This team's rule has no severities left: every severity it was scoped to has been deleted. Edit it to choose new severities, or delete it.",
      );
      expect(verdict.detail).not.toContain("Turn");
      expect(allPausedFor([noSeveritiesLeftRule()])).toBe(false);
    });

    test("several rules with no severities left", () => {
      expect(
        verdictFor([
          noSeveritiesLeftRule({ settingId: "a" }),
          noSeveritiesLeftRule({
            settingId: "b",
            ruleType: ComplianceRuleType.HasAlertOnCallRules,
            severityKind: ComplianceSeverityKind.Alert,
          }),
        ]).detail,
      ).toBe(
        "Nobody is being checked right now. All 2 of this team's rules have no severities left: every severity they were scoped to has been deleted. Edit them to choose new severities, or delete them.",
      );
    });

    test("a rule with no severities left beside a paused one: turn that one on, or edit this one", () => {
      expect(
        verdictFor([emailRule({ enabled: false }), noSeveritiesLeftRule()])
          .detail,
      ).toBe(
        "Nobody is being checked right now. 1 rule is paused and 1 rule has no severities left. Turn a paused rule on, or edit the one with no severities left to choose new severities.",
      );
    });

    test("all three at once", () => {
      expect(
        verdictFor([
          emailRule({ enabled: false }),
          noSeveritiesLeftRule(),
          pigeon(),
          pigeon({ settingId: "pigeon-2", enabled: false }),
        ]).detail,
      ).toBe(
        "Nobody is being checked right now. 1 rule is paused, 1 rule has no severities left and 2 rules are of a type this version does not recognise. Turn a paused rule on, edit the one with no severities left to choose new severities, or replace the unrecognised ones.",
      );
    });

    test("only rules that turning on would check make 'every rule is paused'", () => {
      const rules: Array<TeamComplianceRuleJSON> = [
        emailRule({ enabled: false }),
        callForIncidentsRule({ enabled: false }),
      ];

      expect(allPausedFor(rules)).toBe(true);
      expect(verdictFor(rules).headline).toBe("All 2 rules are paused");
      expect(allPausedFor([])).toBe(false);
    });

    test("with nothing to go on, the advice is still a sentence", () => {
      expect(
        getNoActiveRulesAdvice(summary({ ruleCount: 1, activeRuleCount: 0 })),
      ).toBe("Turn a rule on to see who meets it.");
    });
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

  /*
   * The members section's segment badges: counted within the rule filter and
   * the search, so each says how many rows its segment would show.
   */
  describe("counts by status within the other filters", () => {
    test("with nothing else narrowing the list, the team-wide counts", () => {
      const members: Array<TeamMemberComplianceJSON> =
        standardStatus().userComplianceStatuses;

      expect(
        countFilteredMembersByStatus({
          members: members,
          search: "",
          failingSettingId: null,
        }),
      ).toEqual(countMembersByStatus(members));
      expect(
        countFilteredMembersByStatus({
          members: members,
          search: "   ",
          failingSettingId: null,
        }),
      ).toEqual({ all: 3, needsAttention: 2, compliant: 1 });
    });

    test("a rule filter counts only who fails it, so Compliant is always nobody", () => {
      const members: Array<TeamMemberComplianceJSON> =
        standardStatus().userComplianceStatuses;

      expect(
        countFilteredMembersByStatus({
          members: members,
          search: "",
          failingSettingId: CALL_RULE_ID,
        }),
      ).toEqual({ all: 2, needsAttention: 2, compliant: 0 });
      expect(
        countFilteredMembersByStatus({
          members: members,
          search: "",
          failingSettingId: EMAIL_RULE_ID,
        }),
      ).toEqual({ all: 1, needsAttention: 1, compliant: 0 });
    });

    test("a rule filter for a rule nobody fails counts nobody", () => {
      expect(
        countFilteredMembersByStatus({
          members: standardStatus().userComplianceStatuses,
          search: "",
          failingSettingId: "no-such-rule",
        }),
      ).toEqual({ all: 0, needsAttention: 0, compliant: 0 });
    });

    test("the search narrows the counts, alone and with a rule filter", () => {
      const members: Array<TeamMemberComplianceJSON> =
        standardStatus().userComplianceStatuses;

      expect(
        countFilteredMembersByStatus({
          members: members,
          search: "PRIYA",
          failingSettingId: null,
        }),
      ).toEqual({ all: 1, needsAttention: 0, compliant: 1 });
      expect(
        countFilteredMembersByStatus({
          members: members,
          search: "@acme.com",
          failingSettingId: CALL_RULE_ID,
        }),
      ).toEqual({ all: 2, needsAttention: 2, compliant: 0 });
      expect(
        countFilteredMembersByStatus({
          members: members,
          search: "omar",
          failingSettingId: EMAIL_RULE_ID,
        }),
      ).toEqual({ all: 0, needsAttention: 0, compliant: 0 });
    });

    test("an empty team counts nobody", () => {
      expect(
        countFilteredMembersByStatus({
          members: [],
          search: "jane",
          failingSettingId: CALL_RULE_ID,
        }),
      ).toEqual({ all: 0, needsAttention: 0, compliant: 0 });
    });

    /*
     * The badge and the list are two readings of one filter: for every
     * segment, rule filter and search, the badge is the length of the list.
     */
    test("every segment's count is the length of the list it would show", () => {
      const members: Array<TeamMemberComplianceJSON> =
        standardStatus().userComplianceStatuses;
      const segments: Array<[MemberStatusFilter, keyof MemberStatusCounts]> = [
        [MemberStatusFilter.All, "all"],
        [MemberStatusFilter.NeedsAttention, "needsAttention"],
        [MemberStatusFilter.Compliant, "compliant"],
      ];

      for (const failingSettingId of [
        null,
        EMAIL_RULE_ID,
        CALL_RULE_ID,
        "no-such-rule",
      ]) {
        for (const search of ["", "jane", "OMAR", "acme", "nobody"]) {
          const counts: MemberStatusCounts = countFilteredMembersByStatus({
            members: members,
            search: search,
            failingSettingId: failingSettingId,
          });

          for (const [status, key] of segments) {
            expect(counts[key]).toBe(
              filterMembers({
                members: members,
                status: status,
                search: search,
                failingSettingId: failingSettingId,
              }).length,
            );
          }

          expect(counts.all).toBe(counts.needsAttention + counts.compliant);
        }
      }
    });
  });

  test("a row of rule squares: arrows, Home and End move, clamped; other keys are left alone", () => {
    expect(
      getNextRuleSquareIndex({ key: "ArrowRight", current: 0, count: 3 }),
    ).toBe(1);
    expect(
      getNextRuleSquareIndex({ key: "ArrowDown", current: 1, count: 3 }),
    ).toBe(2);
    expect(
      getNextRuleSquareIndex({ key: "ArrowRight", current: 2, count: 3 }),
    ).toBe(2);
    expect(
      getNextRuleSquareIndex({ key: "ArrowLeft", current: 0, count: 3 }),
    ).toBe(0);
    expect(
      getNextRuleSquareIndex({ key: "ArrowUp", current: 2, count: 3 }),
    ).toBe(1);
    expect(getNextRuleSquareIndex({ key: "Home", current: 2, count: 3 })).toBe(
      0,
    );
    expect(getNextRuleSquareIndex({ key: "End", current: 0, count: 3 })).toBe(
      2,
    );
    // An index left past the end by a shrinking rule list still moves sanely.
    expect(
      getNextRuleSquareIndex({ key: "ArrowLeft", current: 7, count: 3 }),
    ).toBe(1);
    expect(
      getNextRuleSquareIndex({ key: "Tab", current: 0, count: 3 }),
    ).toBeNull();
    expect(
      getNextRuleSquareIndex({ key: "Enter", current: 0, count: 3 }),
    ).toBeNull();
    expect(
      getNextRuleSquareIndex({ key: "ArrowRight", current: 0, count: 0 }),
    ).toBeNull();
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
  /*
   * A member's on-call rules are one On-Call Rules page with a tab per kind,
   * so an on-call rule is fixed on that page, opened on its own tab. The
   * first tab, Incidents, is the page's bare address: no query.
   */
  test.each([
    [
      ComplianceRuleType.HasIncidentOnCallRules,
      "Incidents",
      {},
      "Open my incident on-call rules",
    ],
    [
      ComplianceRuleType.HasAlertOnCallRules,
      "Alerts",
      { type: "alerts" },
      "Open my alert on-call rules",
    ],
    [
      ComplianceRuleType.HasIncidentEpisodeOnCallRules,
      "Incident Episodes",
      { type: "incident-episodes" },
      "Open my incident episode on-call rules",
    ],
    [
      ComplianceRuleType.HasAlertEpisodeOnCallRules,
      "Alert Episodes",
      { type: "alert-episodes" },
      "Open my alert episode on-call rules",
    ],
  ])(
    "%s → the %s tab",
    (
      ruleType: string,
      _tab: string,
      query: Record<string, string>,
      title: string,
    ) => {
      expect(getSelfFix(ruleType)).toEqual({
        page: PageMap.USER_SETTINGS_ON_CALL_RULES,
        query: query,
        title: title,
      });
    },
  );

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

  /*
   * A member failing a method rule and an on-call rule needs both pages; one
   * link for the first failure left the second with no way there.
   */
  test("the signed-in member gets every page their failures need, once each, oldest first", () => {
    const alert: TeamComplianceRuleJSON = alertRule();
    const sms: TeamComplianceRuleJSON = buildRule({
      settingId: "sms",
      ruleType: ComplianceRuleType.HasNotificationSMSMethod,
    });

    expect(
      getSelfFixes(
        buildMember({
          nonCompliantRules: [
            issue(emailRule(), EMAIL_REASON),
            issue(callForIncidentsRule(), CALL_REASON),
            issue(sms, "No verified phone"),
            issue(alert, "No alert rule"),
            issue(
              callForIncidentsRule({ settingId: "major-call" }),
              CALL_REASON,
            ),
          ],
        }),
      ),
    ).toEqual([
      {
        page: PageMap.USER_SETTINGS_NOTIFICATION_METHODS,
        title: "Open my notification methods",
      },
      /*
       * One page, two tabs: two links. Each opens the tab its failure is on,
       * and the second Call-for-incidents failure shares the first's link.
       */
      {
        page: PageMap.USER_SETTINGS_ON_CALL_RULES,
        query: {},
        title: "Open my incident on-call rules",
      },
      {
        page: PageMap.USER_SETTINGS_ON_CALL_RULES,
        query: { type: "alerts" },
        title: "Open my alert on-call rules",
      },
    ]);

    // The order follows the failures: an on-call failure listed first leads.
    expect(
      getSelfFixes(
        buildMember({
          nonCompliantRules: [
            issue(alert, "No alert rule"),
            issue(emailRule(), EMAIL_REASON),
          ],
        }),
      ).map((fix: SelfFix): string => {
        return getSelfFixKey(fix);
      }),
    ).toEqual([
      `${PageMap.USER_SETTINGS_ON_CALL_RULES}?type=alerts`,
      `${PageMap.USER_SETTINGS_NOTIFICATION_METHODS}?`,
    ]);

    expect(getSelfFixes(buildMember())).toEqual([]);
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
    "Call notifications are switched off for this project, so members will not be notified by Call even when they meet this rule. A project owner or someone with Manage Billing can turn them on in Project Settings > Notification Settings.";

  test("only enabled rules with warnings interrupt the page", () => {
    const groups: Array<RuleWarningGroup> = getRuleWarningGroups([
      callForIncidentsRule({ warnings: [CALL_WARNING] }),
      emailRule(),
      alertRule({ enabled: false, warnings: ["paused problem"] }),
    ]);

    expect(groups).toHaveLength(1);
    // Named with its scope: two Call rules for different severities differ.
    expect(groups[0]!.title).toBe(
      "Call for incidents (Critical Incident and Major Incident)",
    );
    expect(groups[0]!.warnings).toEqual([CALL_WARNING]);
    expect(groups[0]!.channels).toEqual([ComplianceNotificationChannel.Call]);
  });

  test.each(ALL_CHANNELS)(
    "a %s rule is fixed in project notification settings only for switchable channels",
    (channel: ComplianceNotificationChannel) => {
      const group: RuleWarningGroup = getRuleWarningGroups([
        callForIncidentsRule({
          notificationChannels: [channel],
          warnings: ["x"],
        }),
      ])[0]!;

      expect(isFixedInProjectNotificationSettings(group)).toBe(
        PROJECT_SWITCHED_CHANNELS.includes(channel),
      );
    },
  );

  test("a group carries every channel of a rule on several, in catalog order", () => {
    const group: RuleWarningGroup = getRuleWarningGroups([
      callAndPushForIncidentsRule({
        notificationChannels: [
          ComplianceNotificationChannel.Push,
          ComplianceNotificationChannel.Call,
        ],
        warnings: [CALL_WARNING],
      }),
    ])[0]!;

    expect(group.title).toBe(
      "Call and Push notification for incidents (Critical Incident)",
    );
    expect(group.channels).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.Push,
    ]);
    expect(group.rule.settingId).toBe(CALL_AND_PUSH_RULE_ID);
  });

  test("an any-channel rule's group has no channels, and no settings fix", () => {
    const group: RuleWarningGroup = getRuleWarningGroups([
      alertRule({ warnings: ["x"] }),
    ])[0]!;

    expect(group.channels).toEqual([]);
    expect(isFixedInProjectNotificationSettings(group)).toBe(false);
  });

  /*
   * One switchable channel among several is enough: that switch being off is
   * something no member can fix, and the way to it is the settings page.
   */
  test.each<[string, Array<ComplianceNotificationChannel>, boolean]>([
    [
      "Push and Call",
      [ComplianceNotificationChannel.Push, ComplianceNotificationChannel.Call],
      true,
    ],
    [
      "Email and Telegram",
      [
        ComplianceNotificationChannel.Email,
        ComplianceNotificationChannel.Telegram,
      ],
      true,
    ],
    [
      "Slack and WhatsApp",
      [
        ComplianceNotificationChannel.Slack,
        ComplianceNotificationChannel.WhatsApp,
      ],
      true,
    ],
    [
      "Call and SMS",
      [ComplianceNotificationChannel.Call, ComplianceNotificationChannel.SMS],
      true,
    ],
    [
      "Push and Email",
      [ComplianceNotificationChannel.Push, ComplianceNotificationChannel.Email],
      false,
    ],
    [
      "Slack, Microsoft Teams and Webhook",
      [
        ComplianceNotificationChannel.Slack,
        ComplianceNotificationChannel.MicrosoftTeams,
        ComplianceNotificationChannel.Webhook,
      ],
      false,
    ],
  ])(
    "a rule on %s is fixed in project notification settings: %s",
    (
      _label: string,
      channels: Array<ComplianceNotificationChannel>,
      fixedThere: boolean,
    ) => {
      const group: RuleWarningGroup = getRuleWarningGroups([
        callForIncidentsRule({
          notificationChannels: channels,
          warnings: ["x"],
        }),
      ])[0]!;

      expect(isFixedInProjectNotificationSettings(group)).toBe(fixedThere);
    },
  );

  test("a rule with no severities left is fixed by editing it, whatever its channels", () => {
    const group: RuleWarningGroup = getRuleWarningGroups([
      noSeveritiesLeftRule({
        notificationChannels: [
          ComplianceNotificationChannel.Call,
          ComplianceNotificationChannel.SMS,
          ComplianceNotificationChannel.WhatsApp,
        ],
      }),
    ])[0]!;

    expect(group.channels).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.SMS,
      ComplianceNotificationChannel.WhatsApp,
    ]);
    expect(isFixedInProjectNotificationSettings(group)).toBe(false);
  });

  /*
   * Call, SMS and Telegram: switched off, nobody is notified that way.
   * WhatsApp: switched off, nobody can add a WhatsApp number, the only way to
   * meet a WhatsApp rule. All four are fixed in Notification Settings.
   */
  test("the switchable channels are exactly Call, SMS, WhatsApp and Telegram", () => {
    expect([...PROJECT_SWITCHED_CHANNELS]).toEqual([
      ComplianceNotificationChannel.Call,
      ComplianceNotificationChannel.SMS,
      ComplianceNotificationChannel.WhatsApp,
      ComplianceNotificationChannel.Telegram,
    ]);
  });

  test("a WhatsApp rule's warning is fixed in project notification settings, as a method rule or an on-call rule", () => {
    const groups: Array<RuleWarningGroup> = getRuleWarningGroups([
      buildRule({
        settingId: "whatsapp-method",
        ruleType: ComplianceRuleType.HasNotificationWhatsAppMethod,
        warnings: ["WhatsApp is switched off for this project."],
      }),
      callForIncidentsRule({
        notificationChannels: [ComplianceNotificationChannel.WhatsApp],
        warnings: ["WhatsApp is switched off for this project."],
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(isFixedInProjectNotificationSettings(groups[0]!)).toBe(true);
    expect(isFixedInProjectNotificationSettings(groups[1]!)).toBe(true);
  });

  /*
   * Nobody paused it on purpose, and it stays paused until an admin edits it:
   * its warning is the only way anyone hears of it. An ordinary paused rule's
   * warnings still wait until it is turned back on.
   */
  test("a rule with no severities left interrupts the page though paused; an ordinary paused rule still waits", () => {
    const groups: Array<RuleWarningGroup> = getRuleWarningGroups([
      noSeveritiesLeftRule(),
      alertRule({ enabled: false, warnings: ["paused problem"] }),
      callForEveryIncidentRule({ enabled: false, warnings: ["paused Call"] }),
      buildRule({
        settingId: "pigeon",
        ruleType: "HasCarrierPigeon" as ComplianceRuleType,
        enabled: false,
        warnings: ["This rule type is not recognised, so it is not checked."],
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe("Call for incidents (no severities left)");
    expect(groups[0]!.warnings).toEqual([SEVERITIES_DELETED_WARNING]);
    // A Call rule, but its fix is the rule, not the project's Call switch.
    expect(groups[0]!.channels).toEqual([ComplianceNotificationChannel.Call]);
    expect(isFixedInProjectNotificationSettings(groups[0]!)).toBe(false);
  });

  test("a rule with no severities left and no warning has nothing to interrupt the page with", () => {
    expect(
      getRuleWarningGroups([noSeveritiesLeftRule({ warnings: [] })]),
    ).toEqual([]);
  });

  test("the page and the server agree on which channels a project switch can make unsatisfiable", () => {
    expect([...PROJECT_SWITCHED_CHANNELS].sort()).toEqual(
      Object.keys(PROJECT_CHANNEL_SWITCHES).sort(),
    );
  });

  test("a method rule's channel counts too", () => {
    const group: RuleWarningGroup = getRuleWarningGroups([
      buildRule({
        ruleType: ComplianceRuleType.HasNotificationSMSMethod,
        warnings: ["x"],
      }),
    ])[0]!;

    expect(group.channels).toEqual([ComplianceNotificationChannel.SMS]);
    expect(isFixedInProjectNotificationSettings(group)).toBe(true);
  });

  test("a method rule on a channel no project switches off has no settings fix, whatever list it carries", () => {
    const group: RuleWarningGroup = getRuleWarningGroups([
      buildRule({
        ruleType: ComplianceRuleType.HasNotificationPushMethod,
        notificationChannels: [ComplianceNotificationChannel.Call],
        warnings: ["x"],
      }),
    ])[0]!;

    expect(group.channels).toEqual([ComplianceNotificationChannel.Push]);
    expect(isFixedInProjectNotificationSettings(group)).toBe(false);
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
      settingId: "legacy-rule-0",
      ruleType: "HasNotificationEmailMethod",
      enabled: true,
      notificationChannels: [],
      severityKind: null,
      appliesToAllSeverities: false,
      severities: [],
      // No counts sent: counted from the members, so the row agrees with them.
      compliantCount: 0,
      nonCompliantCount: 1,
      warnings: [],
    });
    // isCompliant missing: decided by whether any rule failed.
    expect(parsed.userComplianceStatuses[0]!.isCompliant).toBe(false);
    /*
     * The failure is matched to its rule by type (that API allowed one rule
     * per type), so the member's square for it reads "not met" rather than
     * "met" beside a "Needs attention" chip.
     */
    expect(parsed.userComplianceStatuses[0]!.nonCompliantRules[0]).toEqual({
      settingId: "legacy-rule-0",
      ruleType: "HasNotificationEmailMethod",
      reason: EMAIL_REASON,
    });
    expect(
      getMemberIssueForRule(
        parsed.userComplianceStatuses[0]!,
        parsed.complianceSettings[0]!.settingId,
      )?.reason,
    ).toBe(EMAIL_REASON);
    // The made-up id is never offered to anything that writes.
    expect(hasServerId(parsed.complianceSettings[0]!)).toBe(false);
    expect(hasServerId(emailRule())).toBe(true);
  });

  test("counts are only worked out when none were sent, and only for active rules", () => {
    const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
      complianceSettings: [
        { ruleType: "HasNotificationEmailMethod", enabled: true },
        { ruleType: "HasNotificationSMSMethod", enabled: false },
        { ruleType: "HasCarrierPigeon", enabled: true },
        {
          ruleType: "HasNotificationPushMethod",
          enabled: true,
          compliantCount: 5,
          nonCompliantCount: 0,
        },
      ],
      userComplianceStatuses: [
        {
          userId: JANE_ID,
          nonCompliantRules: [
            { ruleType: "HasNotificationEmailMethod", reason: EMAIL_REASON },
          ],
        },
        { userId: OMAR_ID, nonCompliantRules: [] },
        { userId: PRIYA_ID, nonCompliantRules: [] },
      ],
    } as unknown as JSONObject);

    expect(
      parsed.complianceSettings.map((rule: TeamComplianceRuleJSON) => {
        return [rule.compliantCount, rule.nonCompliantCount];
      }),
    ).toEqual([
      [2, 1],
      [0, 0],
      [0, 0],
      [5, 0],
    ]);
  });

  test("a failure without an id is left unmatched when several rules share its type", () => {
    const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
      complianceSettings: [
        { settingId: "a", ruleType: "HasIncidentOnCallRules", enabled: true },
        { settingId: "b", ruleType: "HasIncidentOnCallRules", enabled: true },
        { settingId: "c", ruleType: "HasNotificationEmailMethod" },
      ],
      userComplianceStatuses: [
        {
          userId: JANE_ID,
          nonCompliantRules: [
            { ruleType: "HasIncidentOnCallRules", reason: "No rule" },
            { settingId: "b", ruleType: "HasIncidentOnCallRules", reason: "x" },
            { ruleType: "HasNotificationEmailMethod", reason: EMAIL_REASON },
          ],
        },
      ],
    } as unknown as JSONObject);

    expect(
      parsed.userComplianceStatuses[0]!.nonCompliantRules.map(
        (entry: { settingId: string }) => {
          return entry.settingId;
        },
      ),
    ).toEqual(["", "b", "c"]);
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
        notificationChannels: [],
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

  test("a rule with no severities left arrives as one", () => {
    const parsed: TeamComplianceStatusJSON = parseComplianceStatus(
      JSON.parse(
        JSON.stringify(
          buildStatus({
            complianceSettings: [
              noSeveritiesLeftRule(),
              callForEveryIncidentRule(),
            ],
          }),
        ),
      ) as unknown as JSONObject,
    );

    expect(parsed.complianceSettings).toEqual([
      noSeveritiesLeftRule(),
      callForEveryIncidentRule(),
    ]);
    expect(hasNoSeveritiesLeft(parsed.complianceSettings[0]!)).toBe(true);
    expect(hasNoSeveritiesLeft(parsed.complianceSettings[1]!)).toBe(false);
  });

  /*
   * An API from before severity scopes sends no appliesToAllSeverities. Its
   * on-call rules had no scope - every severity - and must not be read as
   * rules with no severities left, which would take their switches away.
   */
  test("an on-call rule from an API without severity scopes applies to every severity", () => {
    const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
      complianceSettings: [
        { settingId: "a", ruleType: "HasIncidentOnCallRules", enabled: true },
        { settingId: "b", ruleType: "HasNotificationEmailMethod" },
        { settingId: "c", ruleType: "HasCarrierPigeon" },
        {
          settingId: "d",
          ruleType: "HasIncidentOnCallRules",
          severities: [{ id: "s1", name: "Sev 1" }],
        },
      ],
    } as unknown as JSONObject);

    expect(
      parsed.complianceSettings.map((rule: TeamComplianceRuleJSON) => {
        return rule.appliesToAllSeverities;
      }),
    ).toEqual([true, false, false, false]);
    expect(hasNoSeveritiesLeft(parsed.complianceSettings[0]!)).toBe(false);
    expect(getRuleLabel(parsed.complianceSettings[0]!)).toBe(
      "Incident on-call rules (all incident severities)",
    );
  });

  describe("a rule's channels", () => {
    // The parsed channels of one rule sent with these fields.
    const channelsOf: (fields: JSONObject) => Array<string> = (
      fields: JSONObject,
    ): Array<string> => {
      return parseComplianceStatus({
        complianceSettings: [
          {
            settingId: "r",
            ruleType: "HasIncidentOnCallRules",
            enabled: true,
            ...fields,
          },
        ],
      } as unknown as JSONObject).complianceSettings[0]!.notificationChannels;
    };

    test("a rule on several channels passes through unchanged", () => {
      const status: TeamComplianceStatusJSON = standardStatus();
      status.complianceSettings.push(
        callAndPushForIncidentsRule({ compliantCount: 3 }),
      );

      const parsed: TeamComplianceStatusJSON = parseComplianceStatus(
        JSON.parse(JSON.stringify(status)) as unknown as JSONObject,
      );

      expect(parsed).toEqual(status);
      expect(parsed.complianceSettings[2]!.notificationChannels).toEqual([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]);
      expect(getRuleTitle(parsed.complianceSettings[2]!)).toBe(
        "Call and Push notification for incidents",
      );
    });

    test("the list is kept as it was sent", () => {
      expect(
        channelsOf({
          notificationChannels: [
            ComplianceNotificationChannel.Push,
            ComplianceNotificationChannel.Call,
          ],
        }),
      ).toEqual([
        ComplianceNotificationChannel.Push,
        ComplianceNotificationChannel.Call,
      ]);
      expect(channelsOf({ notificationChannels: [] })).toEqual([]);
    });

    test("a channel sent twice is kept once", () => {
      expect(
        channelsOf({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.SMS,
            ComplianceNotificationChannel.Call,
          ],
        }),
      ).toEqual([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.SMS,
      ]);
    });

    /*
     * An API from before a rule could require several channels - an older
     * replica answering during a rolling deploy - sends one
     * `notificationChannel` per rule, or null for any channel.
     */
    test("an API from before channel lists: its one channel becomes the list", () => {
      expect(
        channelsOf({ notificationChannel: ComplianceNotificationChannel.Call }),
      ).toEqual([ComplianceNotificationChannel.Call]);
      expect(channelsOf({ notificationChannel: null })).toEqual([]);
      expect(channelsOf({ notificationChannel: "" })).toEqual([]);

      const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
        complianceSettings: [
          {
            settingId: "legacy-call",
            ruleType: "HasIncidentOnCallRules",
            enabled: true,
            notificationChannel: "Call",
            severityKind: "Incident",
            appliesToAllSeverities: true,
            severities: [],
          },
        ],
      } as unknown as JSONObject);

      expect(getRuleTitle(parsed.complianceSettings[0]!)).toBe(
        "Call for incidents",
      );
      expect(getRuleLabel(parsed.complianceSettings[0]!)).toBe(
        "Call for incidents (all incident severities)",
      );
      expect(getRuleIcon(parsed.complianceSettings[0]!)).toBe(IconProp.Call);
    });

    test("neither field: any channel", () => {
      expect(channelsOf({})).toEqual([]);
    });

    test("a list, when there is one, wins over the single channel", () => {
      expect(
        channelsOf({
          notificationChannels: [
            ComplianceNotificationChannel.Call,
            ComplianceNotificationChannel.Push,
          ],
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ).toEqual([
        ComplianceNotificationChannel.Call,
        ComplianceNotificationChannel.Push,
      ]);
      // An empty list is "any channel", not "no list".
      expect(
        channelsOf({
          notificationChannels: [],
          notificationChannel: ComplianceNotificationChannel.Call,
        }),
      ).toEqual([]);
    });

    test("a list that is not a list falls back to the single channel, and to nothing", () => {
      expect(channelsOf({ notificationChannels: "Call" })).toEqual([]);
      expect(channelsOf({ notificationChannels: { 0: "Call" } })).toEqual([]);
      expect(channelsOf({ notificationChannels: null })).toEqual([]);
      expect(
        channelsOf({
          notificationChannels: "Call",
          notificationChannel: ComplianceNotificationChannel.SMS,
        }),
      ).toEqual([ComplianceNotificationChannel.SMS]);
    });

    test("items that are not strings are dropped, and empty strings with them", () => {
      expect(
        channelsOf({
          notificationChannels: [
            null,
            {},
            [ComplianceNotificationChannel.SMS],
            "",
            ComplianceNotificationChannel.Push,
          ],
        }),
      ).toEqual([ComplianceNotificationChannel.Push]);
      expect(channelsOf({ notificationChannel: { value: "Call" } })).toEqual(
        [],
      );
    });

    /*
     * A number or a boolean is written out as text, the way a warning is -
     * and, being no channel, is ignored everywhere a channel is read.
     */
    test("a number or a boolean becomes text, and is no channel", () => {
      const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
        complianceSettings: [
          {
            settingId: "r",
            ruleType: "HasIncidentOnCallRules",
            enabled: true,
            notificationChannels: [7, true, ComplianceNotificationChannel.Push],
          },
        ],
      } as unknown as JSONObject);
      const rule: TeamComplianceRuleJSON = parsed.complianceSettings[0]!;

      expect(rule.notificationChannels).toEqual([
        "7",
        "true",
        ComplianceNotificationChannel.Push,
      ]);
      expect(getRuleChannels(rule)).toEqual([
        ComplianceNotificationChannel.Push,
      ]);
      expect(getRuleTitle(rule)).toBe("Push notification for incidents");
    });

    /*
     * A channel a newer build added is kept as it was sent, so nothing about
     * the rule is lost in reading it - and it is left out wherever this
     * build names channels.
     */
    test("a channel this build does not know is kept, and left out of what is shown", () => {
      const parsed: TeamComplianceStatusJSON = parseComplianceStatus({
        complianceSettings: [
          {
            settingId: "r",
            ruleType: "HasIncidentOnCallRules",
            enabled: true,
            notificationChannels: ["Pager", ComplianceNotificationChannel.Call],
          },
        ],
      } as unknown as JSONObject);
      const rule: TeamComplianceRuleJSON = parsed.complianceSettings[0]!;

      expect(rule.notificationChannels).toEqual([
        "Pager",
        ComplianceNotificationChannel.Call,
      ]);
      expect(getRuleChannels(rule)).toEqual([
        ComplianceNotificationChannel.Call,
      ]);
      expect(getRuleTitle(rule)).toBe("Call for incidents");
      expect(getRuleIcon(rule)).toBe(IconProp.Call);
    });
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
