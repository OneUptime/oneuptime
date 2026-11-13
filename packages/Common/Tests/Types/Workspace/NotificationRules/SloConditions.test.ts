import Label from "../../../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import SloErrorBudgetPolicyChange, {
  SLO_ERROR_BUDGET_POLICY_CHANGES,
  isSloErrorBudgetPolicyChange,
} from "../../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleInvites from "../../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import WorkspaceChannelName from "../../../../Utils/Workspace/WorkspaceChannelName";
import { describe, expect, it } from "@jest/globals";

/*
 * SLO notification rules: post the changes of a project's SLOs' error
 * budget policies - an SLO entered a tier, recovered to a less severe one or
 * left every tier, its deployments were frozen or allowed again - to the
 * Slack, Microsoft Teams and Mattermost channels (and Teams chats) a rule
 * names, for the SLOs and the changes it is for. A rule asks of an SLO its
 * name, the SLO itself and its labels, and of the change what moved; a rule
 * with no condition posts every change of every SLO. Like a hunt, an SLO
 * has no channel of its own: a rule posts to channels and chats that exist,
 * and invites nobody.
 */

type CheckOnValues = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

const SLO_ID: string = "4b1f3c84-2f1f-4d55-9f0a-0b1d7b8f3e11";
const OTHER_SLO_ID: string = "a7d0c2b9-5d9e-4c1b-8a8e-1c2f3e4d5a6b";
const TIER_1_LABEL_ID: string = "11111111-1111-4111-8111-111111111111";
const CHECKOUT_LABEL_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_LABEL_ID: string = "33333333-3333-4333-8333-333333333333";
// The team on the SLO's list of owners.
const SRE_TEAM_ID: string = "44444444-4444-4444-8444-444444444444";

// What the server hands the matcher for an SLO (WorkspaceNotificationRuleService).
function sloValues(data: {
  name?: string;
  sloId?: string;
  labelIds?: Array<string>;
  changes?: Array<SloErrorBudgetPolicyChange>;
}): CheckOnValues {
  const values: Partial<CheckOnValues> = {};

  for (const key of Object.values(NotificationRuleConditionCheckOn)) {
    values[key] = undefined;
  }

  values[NotificationRuleConditionCheckOn.SloName] =
    data.name ?? "Checkout availability";
  values[NotificationRuleConditionCheckOn.Slos] = [data.sloId ?? SLO_ID];
  values[NotificationRuleConditionCheckOn.SloLabels] = data.labelIds ?? [
    TIER_1_LABEL_ID,
    CHECKOUT_LABEL_ID,
  ];
  values[NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange] =
    data.changes ?? [SloErrorBudgetPolicyChange.EnteredMoreSevereTier];
  // Read from its owner tables when a rule asks who owns it (#7583).
  values[NotificationRuleConditionCheckOn.SloOwners] = [SRE_TEAM_ID];

  return values as CheckOnValues;
}

function rule(
  overrides: Partial<IncidentNotificationRule> = {},
): IncidentNotificationRule {
  return {
    _type: "ServiceLevelObjectiveNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: true,
    existingChannelNames: "sre",
    ...overrides,
  } as unknown as IncidentNotificationRule;
}

function condition(
  checkOn: NotificationRuleConditionCheckOn,
  conditionType: ConditionType,
  value: string | Array<string>,
): NotificationRuleCondition {
  return { checkOn, conditionType, value };
}

function ruleWith(
  ...conditions: Array<NotificationRuleCondition>
): IncidentNotificationRule {
  return rule({ filters: conditions });
}

function matches(
  notificationRule: IncidentNotificationRule,
  values: CheckOnValues = sloValues({}),
): boolean {
  return WorkspaceNotificationRuleUtil.isRuleMatching({
    notificationRule,
    values,
  });
}

// In the order the Filter Type lists them: picking SLOs, which a new condition starts on, first.
const SLO_CHECK_ONS: Array<NotificationRuleConditionCheckOn> = [
  NotificationRuleConditionCheckOn.Slos,
  NotificationRuleConditionCheckOn.SloLabels,
  NotificationRuleConditionCheckOn.SloName,
  NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
  // Who owns the SLO (#7583): read from its owner tables when a rule asks.
  NotificationRuleConditionCheckOn.SloOwners,
];

describe("SLO notification rule conditions", () => {
  it("asks of an SLO its name, the SLO itself and its labels, and what moved - each of which the server fills", () => {
    expect(
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.ServiceLevelObjective,
      ),
    ).toEqual(SLO_CHECK_ONS);

    const values: CheckOnValues = sloValues({});

    for (const checkOn of SLO_CHECK_ONS) {
      expect({ checkOn, value: values[checkOn] }).toEqual({
        checkOn,
        value: expect.anything(),
      });
    }
  });

  it("names its conditions as the Dashboard draws them", () => {
    expect(SLO_CHECK_ONS).toEqual([
      "SLOs",
      "SLO Labels",
      "SLO Name",
      "Error Budget Policy Change",
      "SLO Owner",
    ]);
  });

  it("no other kind of rule offers an SLO's conditions", () => {
    for (const eventType of Object.values(NotificationRuleEventType)) {
      if (eventType === NotificationRuleEventType.ServiceLevelObjective) {
        continue;
      }

      for (const checkOn of SLO_CHECK_ONS) {
        expect({
          eventType,
          offered:
            NotificationRuleConditionUtil.getCheckOnByEventType(
              eventType,
            ).includes(checkOn),
        }).toEqual({ eventType, offered: false });
      }
    }
  });

  it("offers the text operators of every record's title for the name, and types the value", () => {
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.SloName,
      ),
    ).toEqual(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.MonitorName,
      ),
    );
    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: NotificationRuleConditionCheckOn.SloName,
        conditionType: ConditionType.Contains,
      }),
    ).toBe(false);
  });

  it("picks SLOs and their labels from dropdowns, as a monitor rule picks monitors and labels", () => {
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.Slos,
      ),
    ).toEqual([ConditionType.ContainsAny, ConditionType.NotContains]);
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.SloLabels,
      ),
    ).toEqual(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.MonitorLabels,
      ),
    );
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
      ),
    ).toEqual([ConditionType.ContainsAny, ConditionType.NotContains]);

    for (const checkOn of [
      NotificationRuleConditionCheckOn.Slos,
      NotificationRuleConditionCheckOn.SloLabels,
      NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
    ]) {
      expect({
        checkOn,
        dropdown: NotificationRuleConditionUtil.isDropdownValueField({
          checkOn,
          conditionType: ConditionType.ContainsAny,
        }),
      }).toEqual({ checkOn, dropdown: true });
    }
  });

  describe("what each dropdown offers", () => {
    function optionsFor(
      checkOn: NotificationRuleConditionCheckOn,
      serviceLevelObjectives?: Array<ServiceLevelObjective>,
    ): Array<DropdownOption> {
      const label: Label = new Label();
      label._id = TIER_1_LABEL_ID;
      label.name = "tier-1";

      return NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
        alertSeverities: [],
        alertStates: [],
        incidentSeverities: [],
        monitorStatus: [],
        incidentStates: [],
        scheduledMaintenanceStates: [],
        labels: [label],
        monitors: [],
        serviceLevelObjectives,
        checkOn,
      });
    }

    function slo(id: string, name: string): ServiceLevelObjective {
      const model: ServiceLevelObjective = new ServiceLevelObjective();
      model._id = id;
      model.name = name;
      return model;
    }

    it("SLOs: the project's SLOs by name, drawn as their team wrote them in every language", () => {
      expect(
        optionsFor(NotificationRuleConditionCheckOn.Slos, [
          slo(SLO_ID, "Checkout availability"),
          slo(OTHER_SLO_ID, "Status"),
        ]),
      ).toEqual([
        {
          label: "Checkout availability",
          value: SLO_ID,
          isUserContent: true,
        },
        { label: "Status", value: OTHER_SLO_ID, isUserContent: true },
      ]);
    });

    it("SLOs: nothing to pick before the SLOs are read", () => {
      expect(optionsFor(NotificationRuleConditionCheckOn.Slos)).toEqual([]);
    });

    it("SLO Labels: the project's labels, as every label condition offers them", () => {
      expect(
        optionsFor(NotificationRuleConditionCheckOn.SloLabels).map(
          (option: DropdownOption) => {
            return { label: option.label, value: option.value };
          },
        ),
      ).toEqual([{ label: "tier-1", value: TIER_1_LABEL_ID }]);
    });

    it("Error Budget Policy Change: every change, in the order a tier change reads, then the deploy gate", () => {
      expect(
        optionsFor(NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange),
      ).toEqual([
        {
          label: "Entered a more severe tier",
          value: "Entered a more severe tier",
        },
        {
          label: "Recovered to a less severe tier",
          value: "Recovered to a less severe tier",
        },
        { label: "Left every tier", value: "Left every tier" },
        { label: "Deployments frozen", value: "Deployments frozen" },
        {
          label: "Deployments allowed again",
          value: "Deployments allowed again",
        },
      ]);
    });
  });

  describe("matching an SLO", () => {
    it("by its name as written: is, contains, starts and ends with - and their nots", () => {
      const name: string = "Checkout availability";
      const byName: (
        conditionType: ConditionType,
        value: string,
      ) => IncidentNotificationRule = (
        conditionType: ConditionType,
        value: string,
      ): IncidentNotificationRule => {
        return ruleWith(
          condition(
            NotificationRuleConditionCheckOn.SloName,
            conditionType,
            value,
          ),
        );
      };

      expect(matches(byName(ConditionType.EqualTo, name))).toBe(true);
      expect(matches(byName(ConditionType.EqualTo, "Checkout"))).toBe(false);
      expect(matches(byName(ConditionType.NotEqualTo, "Search"))).toBe(true);
      expect(matches(byName(ConditionType.NotEqualTo, name))).toBe(false);
      expect(matches(byName(ConditionType.Contains, "Checkout"))).toBe(true);
      expect(matches(byName(ConditionType.Contains, "Search"))).toBe(false);
      expect(matches(byName(ConditionType.NotContains, "Checkout"))).toBe(
        false,
      );
      expect(matches(byName(ConditionType.StartsWith, "Checkout"))).toBe(true);
      expect(matches(byName(ConditionType.StartsWith, "availability"))).toBe(
        false,
      );
      expect(matches(byName(ConditionType.EndsWith, "availability"))).toBe(
        true,
      );
    });

    it("by the SLOs a rule picks: any of them, or none of them", () => {
      expect(
        matches(
          ruleWith(
            condition(
              NotificationRuleConditionCheckOn.Slos,
              ConditionType.ContainsAny,
              [OTHER_SLO_ID, SLO_ID],
            ),
          ),
        ),
      ).toBe(true);
      expect(
        matches(
          ruleWith(
            condition(
              NotificationRuleConditionCheckOn.Slos,
              ConditionType.ContainsAny,
              [OTHER_SLO_ID],
            ),
          ),
        ),
      ).toBe(false);
      expect(
        matches(
          ruleWith(
            condition(
              NotificationRuleConditionCheckOn.Slos,
              ConditionType.NotContains,
              [OTHER_SLO_ID],
            ),
          ),
        ),
      ).toBe(true);
      expect(
        matches(
          ruleWith(
            condition(
              NotificationRuleConditionCheckOn.Slos,
              ConditionType.NotContains,
              [SLO_ID],
            ),
          ),
        ),
      ).toBe(false);
    });

    it("by its labels: any, all, or none of the rule's", () => {
      const byLabels: (
        conditionType: ConditionType,
        labelIds: Array<string>,
      ) => IncidentNotificationRule = (
        conditionType: ConditionType,
        labelIds: Array<string>,
      ): IncidentNotificationRule => {
        return ruleWith(
          condition(
            NotificationRuleConditionCheckOn.SloLabels,
            conditionType,
            labelIds,
          ),
        );
      };

      expect(
        matches(byLabels(ConditionType.ContainsAny, [OTHER_LABEL_ID])),
      ).toBe(false);
      expect(
        matches(
          byLabels(ConditionType.ContainsAny, [
            OTHER_LABEL_ID,
            TIER_1_LABEL_ID,
          ]),
        ),
      ).toBe(true);
      expect(
        matches(
          byLabels(ConditionType.ContainsAll, [
            TIER_1_LABEL_ID,
            CHECKOUT_LABEL_ID,
          ]),
        ),
      ).toBe(true);
      expect(
        matches(
          byLabels(ConditionType.ContainsAll, [
            TIER_1_LABEL_ID,
            OTHER_LABEL_ID,
          ]),
        ),
      ).toBe(false);
      expect(
        matches(byLabels(ConditionType.NotContains, [OTHER_LABEL_ID])),
      ).toBe(true);
      expect(
        matches(byLabels(ConditionType.NotContains, [CHECKOUT_LABEL_ID])),
      ).toBe(false);

      // An SLO without labels has none of them.
      expect(
        matches(
          byLabels(ConditionType.ContainsAny, [TIER_1_LABEL_ID]),
          sloValues({ labelIds: [] }),
        ),
      ).toBe(false);
    });

    it("by what moved: a rule for freezes hears a tier change that froze deployments, and a freeze on its own", () => {
      const forFreezes: IncidentNotificationRule = ruleWith(
        condition(
          NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
          ConditionType.ContainsAny,
          [
            SloErrorBudgetPolicyChange.DeploymentsFrozen,
            SloErrorBudgetPolicyChange.DeploymentsAllowed,
          ],
        ),
      );

      expect(
        matches(
          forFreezes,
          sloValues({
            changes: [
              SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
              SloErrorBudgetPolicyChange.DeploymentsFrozen,
            ],
          }),
        ),
      ).toBe(true);
      expect(
        matches(
          forFreezes,
          sloValues({
            changes: [SloErrorBudgetPolicyChange.DeploymentsAllowed],
          }),
        ),
      ).toBe(true);
      expect(
        matches(
          forFreezes,
          sloValues({
            changes: [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
          }),
        ),
      ).toBe(false);
    });

    it("by what did not move: a rule that leaves out recoveries hears every escalation", () => {
      const noRecoveries: IncidentNotificationRule = ruleWith(
        condition(
          NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
          ConditionType.NotContains,
          [
            SloErrorBudgetPolicyChange.RecoveredToLessSevereTier,
            SloErrorBudgetPolicyChange.LeftEveryTier,
          ],
        ),
      );

      expect(
        matches(
          noRecoveries,
          sloValues({
            changes: [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
          }),
        ),
      ).toBe(true);
      expect(
        matches(
          noRecoveries,
          sloValues({
            changes: [
              SloErrorBudgetPolicyChange.RecoveredToLessSevereTier,
              SloErrorBudgetPolicyChange.DeploymentsAllowed,
            ],
          }),
        ),
      ).toBe(false);
      expect(
        matches(
          noRecoveries,
          sloValues({ changes: [SloErrorBudgetPolicyChange.LeftEveryTier] }),
        ),
      ).toBe(false);
    });

    it("each change is told apart from every other: none is a part of another", () => {
      for (const change of SLO_ERROR_BUDGET_POLICY_CHANGES) {
        for (const picked of SLO_ERROR_BUDGET_POLICY_CHANGES) {
          expect({
            change,
            picked,
            matched: matches(
              ruleWith(
                condition(
                  NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
                  ConditionType.ContainsAny,
                  [picked],
                ),
              ),
              sloValues({ changes: [change] }),
            ),
          }).toEqual({ change, picked, matched: change === picked });
        }
      }
    });

    it("Any of its conditions, or All of them, as the rule says", () => {
      const conditions: Array<NotificationRuleCondition> = [
        condition(
          NotificationRuleConditionCheckOn.SloLabels,
          ConditionType.ContainsAny,
          [TIER_1_LABEL_ID],
        ),
        condition(
          NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
          ConditionType.ContainsAny,
          [SloErrorBudgetPolicyChange.DeploymentsFrozen],
        ),
      ];

      const escalation: CheckOnValues = sloValues({
        changes: [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
      });

      expect(
        matches(
          rule({ filters: conditions, filterCondition: FilterCondition.Any }),
          escalation,
        ),
      ).toBe(true);
      expect(
        matches(
          rule({ filters: conditions, filterCondition: FilterCondition.All }),
          escalation,
        ),
      ).toBe(false);
    });

    it("a rule with no condition posts every change of every SLO", () => {
      for (const change of SLO_ERROR_BUDGET_POLICY_CHANGES) {
        expect(matches(rule(), sloValues({ changes: [change] }))).toBe(true);
      }

      expect(
        matches(rule(), sloValues({ name: "Search", sloId: OTHER_SLO_ID })),
      ).toBe(true);
    });

    it("a condition an SLO cannot answer - a monitor's name - never matches it", () => {
      expect(
        matches(
          ruleWith(
            condition(
              NotificationRuleConditionCheckOn.MonitorName,
              ConditionType.Contains,
              "Checkout",
            ),
          ),
        ),
      ).toBe(false);
    });
  });

  it("a rule saves with its conditions complete, and is told what is missing when it is not", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: ruleWith(
          condition(
            NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
            ConditionType.ContainsAny,
            [SloErrorBudgetPolicyChange.DeploymentsFrozen],
          ),
        ),
      }),
    ).toBeNull();
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: ruleWith(
          condition(
            NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
            ConditionType.ContainsAny,
            [],
          ),
        ),
      }),
    ).toBe("Value is required for Error Budget Policy Change");
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: ruleWith(
          condition(
            NotificationRuleConditionCheckOn.SloName,
            ConditionType.StartsWith,
            "",
          ),
        ),
      }),
    ).toBe("Value is required for SLO Name");
  });

  it("a rule for SLOs names where it posts: a channel, or on Teams a chat - never a channel of the SLO's own", () => {
    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule(),
        eventType: NotificationRuleEventType.ServiceLevelObjective,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBeNull();

    // A channel the rule would create is no destination for an SLO.
    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({
          shouldPostToExistingChannel: false,
          shouldCreateNewChannel: true,
        }),
        eventType: NotificationRuleEventType.ServiceLevelObjective,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Please select a destination: post to an existing Slack channel");

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ shouldPostToExistingChannel: false }),
        eventType: NotificationRuleEventType.ServiceLevelObjective,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe(
      "Please select a destination: post to an existing Microsoft Teams channel or to an existing Microsoft Teams chat",
    );

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ shouldPostToExistingChannel: false }),
        eventType: NotificationRuleEventType.ServiceLevelObjective,
        workspaceType: WorkspaceType.Mattermost,
      }),
    ).toBe(
      "Please select a destination: post to an existing Mattermost channel",
    );

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ existingChannelNames: "  " }),
        eventType: NotificationRuleEventType.ServiceLevelObjective,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Existing Slack channel name is required");

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({
          shouldPostToExistingChannel: false,
          shouldPostToExistingChat: true,
          existingChatIds: ["19:release-managers@thread.v2"],
        }),
        eventType: NotificationRuleEventType.ServiceLevelObjective,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBeNull();
  });

  it("invites nobody: an SLO has no channel of its own to add anybody to", () => {
    expect(
      NotificationRuleInvites.getInvitees(
        NotificationRuleEventType.ServiceLevelObjective,
      ),
    ).toEqual([]);
  });

  it("has a word for a channel name, as every kind of rule does, though it never opens one", () => {
    expect(
      WorkspaceChannelName.getChannelName({
        workspaceType: WorkspaceType.Slack,
        prefix: "",
        parts: WorkspaceChannelName.forNamedRecord({
          eventType: NotificationRuleEventType.ServiceLevelObjective,
          name: "Checkout",
        }),
      }),
    ).toContain("checkout");
  });
});

describe("SloErrorBudgetPolicyChange", () => {
  it("lists every change once, in the enum's order", () => {
    expect([...SLO_ERROR_BUDGET_POLICY_CHANGES]).toEqual(
      Object.values(SloErrorBudgetPolicyChange),
    );
  });

  it("knows its own values and nothing else", () => {
    for (const change of SLO_ERROR_BUDGET_POLICY_CHANGES) {
      expect(isSloErrorBudgetPolicyChange(change)).toBe(true);
    }

    expect(isSloErrorBudgetPolicyChange("Entered a tier")).toBe(false);
    expect(isSloErrorBudgetPolicyChange("")).toBe(false);
    expect(isSloErrorBudgetPolicyChange(undefined)).toBe(false);
    expect(isSloErrorBudgetPolicyChange(ObjectID.generate().toString())).toBe(
      false,
    );
  });
});
