import FilterCondition from "../../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, it } from "@jest/globals";

/*
 * #3459: "Create On-Call Duty Policy Notification Rule (Microsoft Teams):
 * Filter Type dropdown shows No options".
 *
 * The On-Call Duty Policy check-ons existed in the enum and the server already
 * populated them when it evaluated a rule, but none of the four editor-facing
 * helpers knew about them:
 *
 *   getCheckOnByEventType      -> [] , so the Filter Type dropdown was empty
 *   getConditionTypeByCheckOn  -> [] , so Filter Condition would be empty too
 *   isDropdownValueField       -> false for labels, so a label id had to be typed
 *   getDropdownOptionsByCheckOn-> [] for labels, so there was nothing to pick
 *
 * The chain from "the dropdown lists it" through "the rule saves" to "the
 * server matches it" is pinned end to end below, and the same chain is walked
 * for every other event type so the next resource added cannot ship half-wired.
 */

type CheckOnValues = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

const POLICY_LABEL_ID: string = "a1a1a1a1a1a1a1a1a1a1a1a1";
const OTHER_LABEL_ID: string = "b2b2b2b2b2b2b2b2b2b2b2b2";

/*
 * getDropdownOptionsByCheckOn only ever reads `id` and `name`, and every model
 * below derives `id` from `_id`, so a bare instance with those two set is all
 * a fixture needs.
 */
function named<T extends { _id?: string; name?: string }>(
  model: T,
  id: string,
  name: string,
): T {
  model._id = id;
  model.name = name;
  return model;
}

// Everything getDropdownOptionsByCheckOn needs, populated for every check-on.
function dropdownData(): {
  alertSeverities: Array<AlertSeverity>;
  alertStates: Array<AlertState>;
  incidentSeverities: Array<IncidentSeverity>;
  monitorStatus: Array<MonitorStatus>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  labels: Array<Label>;
  monitors: Array<Monitor>;
} {
  return {
    alertSeverities: [
      named(new AlertSeverity(), "c1c1c1c1c1c1c1c1c1c1c1c1", "Sev 1"),
    ],
    alertStates: [
      named(new AlertState(), "c2c2c2c2c2c2c2c2c2c2c2c2", "Created"),
    ],
    incidentSeverities: [
      named(new IncidentSeverity(), "c3c3c3c3c3c3c3c3c3c3c3c3", "Major"),
    ],
    monitorStatus: [
      named(new MonitorStatus(), "c4c4c4c4c4c4c4c4c4c4c4c4", "Offline"),
    ],
    incidentStates: [
      named(new IncidentState(), "c5c5c5c5c5c5c5c5c5c5c5c5", "Acknowledged"),
    ],
    scheduledMaintenanceStates: [
      named(
        new ScheduledMaintenanceState(),
        "c6c6c6c6c6c6c6c6c6c6c6c6",
        "Ongoing",
      ),
    ],
    labels: [
      named(new Label(), POLICY_LABEL_ID, "Payments"),
      named(new Label(), OTHER_LABEL_ID, "Search"),
    ],
    monitors: [named(new Monitor(), "c7c7c7c7c7c7c7c7c7c7c7c7", "API")],
  };
}

function onCallRule(
  overrides: Partial<IncidentNotificationRule> = {},
): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldCreateNewChannel: false,
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    inviteTeamsToNewChannel: [],
    inviteUsersToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
    newChannelTemplateName: "",
    archiveChannelAutomatically: false,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
    ...overrides,
  } as IncidentNotificationRule;
}

/*
 * The server hands isRuleMatching a value for every check-on; only the on-call
 * ones are populated when the notification is for an on-call duty policy.
 */
function valuesFor(partial: Partial<CheckOnValues>): CheckOnValues {
  const base: Partial<CheckOnValues> = {};
  for (const key of Object.values(NotificationRuleConditionCheckOn)) {
    base[key] = undefined;
  }
  return { ...base, ...partial } as CheckOnValues;
}

function onCallValues(overrides: Partial<CheckOnValues> = {}): CheckOnValues {
  return valuesFor({
    [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]:
      "Payments Escalation",
    [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]:
      "Pages the payments team after 5 minutes.",
    [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: [
      POLICY_LABEL_ID,
    ],
    ...overrides,
  });
}

describe("On-Call Duty Policy notification rule conditions (#3459)", () => {
  describe("the Filter Type dropdown", () => {
    it("lists the three on-call check-ons instead of nothing", () => {
      expect(
        NotificationRuleConditionUtil.getCheckOnByEventType(
          NotificationRuleEventType.OnCallDutyPolicy,
        ),
      ).toEqual([
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
        NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      ]);
    });

    it("does not offer check-ons the server cannot resolve for an on-call policy", () => {
      /*
       * WorkspaceNotificationRuleService only fills the three on-call keys for
       * an on-call notification; anything else is undefined, and a filter over
       * an undefined value never matches. Offering one would build a rule that
       * silently never fires.
       */
      const checkOns: Array<NotificationRuleConditionCheckOn> =
        NotificationRuleConditionUtil.getCheckOnByEventType(
          NotificationRuleEventType.OnCallDutyPolicy,
        );

      expect(checkOns).not.toContain(
        NotificationRuleConditionCheckOn.IncidentTitle,
      );
      expect(checkOns).not.toContain(
        NotificationRuleConditionCheckOn.MonitorName,
      );
      expect(checkOns).not.toContain(NotificationRuleConditionCheckOn.Monitors);
      expect(checkOns).not.toContain(
        NotificationRuleConditionCheckOn.MonitorLabels,
      );
    });

    it("lists check-ons for every event type an editor can be opened with", () => {
      for (const eventType of Object.values(NotificationRuleEventType)) {
        expect(
          NotificationRuleConditionUtil.getCheckOnByEventType(eventType).length,
        ).toBeGreaterThan(0);
      }
    });
  });

  describe("the Filter Condition dropdown", () => {
    it("offers the text operators for the policy name", () => {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        ),
      ).toEqual([
        ConditionType.EqualTo,
        ConditionType.NotEqualTo,
        ConditionType.Contains,
        ConditionType.NotContains,
        ConditionType.StartsWith,
        ConditionType.EndsWith,
      ]);
    });

    it("offers the text operators for the policy description", () => {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
        ),
      ).toEqual([
        ConditionType.EqualTo,
        ConditionType.NotEqualTo,
        ConditionType.Contains,
        ConditionType.NotContains,
        ConditionType.StartsWith,
        ConditionType.EndsWith,
      ]);
    });

    it("offers the set operators for policy labels, matching the other label check-ons", () => {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
        ),
      ).toEqual(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.IncidentLabels,
        ),
      );
    });

    it("offers operators for every check-on any event type lists", () => {
      for (const eventType of Object.values(NotificationRuleEventType)) {
        for (const checkOn of NotificationRuleConditionUtil.getCheckOnByEventType(
          eventType,
        )) {
          expect(
            NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn)
              .length,
          ).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("the Value field", () => {
    it("renders labels as a dropdown, not a free-text box", () => {
      expect(
        NotificationRuleConditionUtil.isDropdownValueField({
          checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
          conditionType: ConditionType.ContainsAny,
        }),
      ).toBe(true);
    });

    it("keeps the name and description as free text", () => {
      expect(
        NotificationRuleConditionUtil.isDropdownValueField({
          checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
          conditionType: ConditionType.Contains,
        }),
      ).toBe(false);
      expect(
        NotificationRuleConditionUtil.isDropdownValueField({
          checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
          conditionType: ConditionType.Contains,
        }),
      ).toBe(false);
    });

    it("shows a value field for the on-call check-ons under a value-taking operator", () => {
      for (const checkOn of NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.OnCallDutyPolicy,
      )) {
        expect(
          NotificationRuleConditionUtil.hasValueField({
            checkOn: checkOn,
            conditionType: ConditionType.Contains,
          }),
        ).toBe(true);
      }
    });

    it("fills the label dropdown from the project's labels", () => {
      const options: Array<DropdownOption> =
        NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
          ...dropdownData(),
          checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
        });

      expect(options).toEqual([
        { value: POLICY_LABEL_ID, label: "Payments" },
        { value: OTHER_LABEL_ID, label: "Search" },
      ]);
    });

    it("gives the same options to on-call labels as to the other label check-ons", () => {
      const forCheckOn: (
        checkOn: NotificationRuleConditionCheckOn,
      ) => Array<DropdownOption> = (
        checkOn: NotificationRuleConditionCheckOn,
      ): Array<DropdownOption> => {
        return NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
          ...dropdownData(),
          checkOn: checkOn,
        });
      };

      expect(
        forCheckOn(NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels),
      ).toEqual(forCheckOn(NotificationRuleConditionCheckOn.IncidentLabels));
    });

    it("has options for every dropdown-backed check-on any event type lists", () => {
      /*
       * A check-on the form renders as a dropdown but for which
       * getDropdownOptionsByCheckOn returns nothing is the same dead end as
       * #3459, one field further down the form.
       */
      for (const eventType of Object.values(NotificationRuleEventType)) {
        for (const checkOn of NotificationRuleConditionUtil.getCheckOnByEventType(
          eventType,
        )) {
          const conditionType: ConditionType =
            NotificationRuleConditionUtil.getConditionTypeByCheckOn(
              checkOn,
            )[0]!;

          if (
            !NotificationRuleConditionUtil.isDropdownValueField({
              checkOn: checkOn,
              conditionType: conditionType,
            })
          ) {
            continue;
          }

          expect(
            NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
              ...dropdownData(),
              checkOn: checkOn,
            }).length,
          ).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("saving an on-call rule", () => {
    it("accepts a name filter with a destination", () => {
      expect(
        NotificationRuleConditionUtil.getValidationError({
          notificationRule: onCallRule({
            shouldCreateNewChannel: true,
            newChannelTemplateName: "oneuptime-on-call-duty-policy-",
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.Contains,
                value: "Payments",
              },
            ],
          }),
          eventType: NotificationRuleEventType.OnCallDutyPolicy,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }),
      ).toBeNull();
    });

    it("accepts a label filter holding label ids", () => {
      expect(
        NotificationRuleConditionUtil.getValidationError({
          notificationRule: onCallRule({
            shouldCreateNewChannel: true,
            newChannelTemplateName: "oneuptime-on-call-duty-policy-",
            filters: [
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
                conditionType: ConditionType.ContainsAny,
                value: [POLICY_LABEL_ID],
              },
            ],
          }),
          eventType: NotificationRuleEventType.OnCallDutyPolicy,
          workspaceType: WorkspaceType.Slack,
        }),
      ).toBeNull();
    });

    it("still rejects a filter left without a condition", () => {
      expect(
        NotificationRuleConditionUtil.getValidationError({
          notificationRule: onCallRule({
            shouldCreateNewChannel: true,
            newChannelTemplateName: "oneuptime-on-call-duty-policy-",
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: undefined,
                value: "Payments",
              },
            ],
          }),
          eventType: NotificationRuleEventType.OnCallDutyPolicy,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }),
      ).toBe(
        `Filter Condition is required for ${NotificationRuleConditionCheckOn.OnCallDutyPolicyName}`,
      );
    });

    it("does not force a destination on an on-call rule", () => {
      /*
       * On-call rules are not in the either/or destination block: the rule can
       * exist purely to name the channel the policy's messages land in.
       */
      expect(
        NotificationRuleConditionUtil.getValidationError({
          notificationRule: onCallRule(),
          eventType: NotificationRuleEventType.OnCallDutyPolicy,
          workspaceType: WorkspaceType.MicrosoftTeams,
        }),
      ).toBeNull();
    });
  });

  describe("matching an on-call policy against a saved rule", () => {
    it("matches a name filter against the policy the server resolved", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.Contains,
                value: "Payments",
              },
            ],
          }),
          values: onCallValues(),
        }),
      ).toBe(true);
    });

    it("does not match a name filter for a different policy", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.Contains,
                value: "Search",
              },
            ],
          }),
          values: onCallValues(),
        }),
      ).toBe(false);
    });

    it("matches a label filter against the policy's label ids", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
                conditionType: ConditionType.ContainsAny,
                value: [POLICY_LABEL_ID, OTHER_LABEL_ID],
              },
            ],
          }),
          values: onCallValues(),
        }),
      ).toBe(true);
    });

    it("does not match a label filter for a label the policy does not carry", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
                conditionType: ConditionType.ContainsAny,
                value: [OTHER_LABEL_ID],
              },
            ],
          }),
          values: onCallValues(),
        }),
      ).toBe(false);
    });

    it("combines a name and a description filter under All", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filterCondition: FilterCondition.All,
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.StartsWith,
                value: "Payments",
              },
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
                conditionType: ConditionType.Contains,
                value: "payments team",
              },
            ],
          }),
          values: onCallValues(),
        }),
      ).toBe(true);
    });

    it("fails All when only one of the two filters matches", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filterCondition: FilterCondition.All,
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.StartsWith,
                value: "Payments",
              },
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
                conditionType: ConditionType.Contains,
                value: "search team",
              },
            ],
          }),
          values: onCallValues(),
        }),
      ).toBe(false);
    });

    it("passes Any when one of the two filters matches", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filterCondition: FilterCondition.Any,
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.EqualTo,
                value: "Nothing Like This",
              },
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
                conditionType: ConditionType.ContainsAll,
                value: [POLICY_LABEL_ID],
              },
            ],
          }),
          values: onCallValues(),
        }),
      ).toBe(true);
    });

    it("still fires an unfiltered on-call rule for every policy", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({ filters: [] }),
          values: onCallValues(),
        }),
      ).toBe(true);
    });

    it("does not match an on-call filter when the event is not an on-call policy", () => {
      /*
       * The same rule row evaluated against, say, an incident's values: every
       * on-call key is undefined there, and an undefined value never matches.
       */
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.Contains,
                value: "Payments",
              },
            ],
          }),
          values: valuesFor({
            [NotificationRuleConditionCheckOn.IncidentTitle]: "Payments down",
          }),
        }),
      ).toBe(false);
    });
  });

  describe("the on-call policy the server resolves", () => {
    it("matches a policy with no labels only through the label-free filters", () => {
      const values: CheckOnValues = onCallValues({
        [NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels]: [],
      });

      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
                conditionType: ConditionType.ContainsAny,
                value: [POLICY_LABEL_ID],
              },
            ],
          }),
          values: values,
        }),
      ).toBe(false);

      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
                conditionType: ConditionType.Contains,
                value: "Payments",
              },
            ],
          }),
          values: values,
        }),
      ).toBe(true);
    });

    it("matches an IsEmpty filter on a policy saved without a description", () => {
      expect(
        WorkspaceNotificationRuleUtil.isRuleMatching({
          notificationRule: onCallRule({
            filters: [
              {
                checkOn:
                  NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
                conditionType: ConditionType.IsEmpty,
                value: "",
              },
            ],
          }),
          values: onCallValues({
            [NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription]: "",
          }),
        }),
      ).toBe(true);
    });
  });
});
