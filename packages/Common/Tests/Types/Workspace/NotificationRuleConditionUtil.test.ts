import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, it } from "@jest/globals";

/*
 * NotificationRuleConditionUtil backs the workspace-notification-rule editor:
 * getValidationError gates saving a rule, and the smaller helpers drive which
 * inputs the form shows. A regression here either lets an unsavable rule
 * through or hides the field the user needs, so the branches are pinned here.
 */

function baseRule(
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

describe("NotificationRuleConditionUtil.getValidationError", () => {
  it("requires a conditionType when a filter has a checkOn but no condition", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule({
          shouldCreateNewChannel: true,
          newChannelTemplateName: "incident-{{id}}",
          filters: [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: undefined,
              value: "x",
            },
          ],
        }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      });

    expect(error).toBe(
      `Filter Condition is required for ${NotificationRuleConditionCheckOn.IncidentTitle}`,
    );
  });

  it("requires a value when a filter has checkOn and condition but no value", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule({
          shouldCreateNewChannel: true,
          newChannelTemplateName: "incident-{{id}}",
          filters: [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.EqualTo,
              value: undefined,
            },
          ],
        }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      });

    expect(error).toBe(
      `Value is required for ${NotificationRuleConditionCheckOn.IncidentTitle}`,
    );
  });

  it("treats an empty array value as a missing value", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule({
          shouldCreateNewChannel: true,
          newChannelTemplateName: "incident-{{id}}",
          filters: [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
              conditionType: ConditionType.ContainsAny,
              value: [],
            },
          ],
        }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      });

    expect(error).toBe(
      `Value is required for ${NotificationRuleConditionCheckOn.IncidentLabels}`,
    );
  });

  it("requires a destination for incident rules when none is selected", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule(),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      });

    expect(error).toBe(
      "Please select a destination: create a Slack channel or post to an existing Slack channel",
    );
  });

  it("mentions the chat option for Microsoft Teams destinations", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule(),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    expect(error).toBe(
      "Please select a destination: create a Microsoft Teams channel, post to an existing Microsoft Teams channel, or post to an existing Microsoft Teams chat",
    );
  });

  it("requires an existing channel name when posting to an existing channel", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule({
          shouldPostToExistingChannel: true,
          existingChannelNames: "   ",
        }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      });

    expect(error).toBe("Existing Slack channel name is required");
  });

  it("requires a template name when creating a new channel", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule({
          shouldCreateNewChannel: true,
          newChannelTemplateName: "",
        }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      });

    expect(error).toBe("New Slack channel name is required");
  });

  it("requires at least one chat when posting to an existing chat", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule({
          shouldPostToExistingChat: true,
          existingChatIds: [],
        }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    expect(error).toContain(
      "Please select at least one Microsoft Teams chat to post to",
    );
  });

  it("returns null for a fully valid rule that creates a channel", () => {
    const error: string | null =
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: baseRule({
          shouldCreateNewChannel: true,
          newChannelTemplateName: "incident-{{id}}",
          filters: [
            {
              checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
              conditionType: ConditionType.Contains,
              value: "down",
            },
          ],
        }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      });

    expect(error).toBeNull();
  });
});

describe("NotificationRuleConditionUtil.hasValueField", () => {
  it.each([
    ConditionType.IsEmpty,
    ConditionType.IsNotEmpty,
    ConditionType.True,
    ConditionType.False,
  ])("hides the value field for %s", (conditionType: ConditionType) => {
    expect(
      NotificationRuleConditionUtil.hasValueField({
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType,
      }),
    ).toBe(false);
  });

  it.each([
    ConditionType.EqualTo,
    ConditionType.Contains,
    ConditionType.GreaterThan,
    ConditionType.ContainsAll,
  ])("shows the value field for %s", (conditionType: ConditionType) => {
    expect(
      NotificationRuleConditionUtil.hasValueField({
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType,
      }),
    ).toBe(true);
  });
});

describe("NotificationRuleConditionUtil.isDropdownValueField", () => {
  it("returns false when checkOn or conditionType is missing", () => {
    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: undefined,
        conditionType: ConditionType.ContainsAny,
      }),
    ).toBe(false);
    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: NotificationRuleConditionCheckOn.IncidentState,
        conditionType: undefined,
      }),
    ).toBe(false);
  });

  it("returns true for enum/label-backed check-ons", () => {
    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: NotificationRuleConditionCheckOn.IncidentState,
        conditionType: ConditionType.ContainsAny,
      }),
    ).toBe(true);
    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: NotificationRuleConditionCheckOn.MonitorLabels,
        conditionType: ConditionType.ContainsAny,
      }),
    ).toBe(true);
  });

  it("returns false for free-text check-ons", () => {
    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.Contains,
      }),
    ).toBe(false);
  });
});

describe("NotificationRuleConditionUtil.getCheckOnByEventType", () => {
  it("returns incident-scoped check-ons for the Incident event", () => {
    const checkOns: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.Incident,
      );

    expect(checkOns).toContain(NotificationRuleConditionCheckOn.IncidentTitle);
    expect(checkOns).toContain(NotificationRuleConditionCheckOn.IncidentState);
    // Alert-only check-ons must not leak into the incident editor.
    expect(checkOns).not.toContain(NotificationRuleConditionCheckOn.AlertTitle);
  });

  it("returns monitor-scoped check-ons for the Monitor event", () => {
    const checkOns: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.Monitor,
      );

    expect(checkOns).toContain(NotificationRuleConditionCheckOn.MonitorName);
    expect(checkOns).toContain(NotificationRuleConditionCheckOn.MonitorStatus);
  });

  it("returns on-call-scoped check-ons for the OnCallDutyPolicy event", () => {
    /*
     * #3459: this returned [] and the Filter Type dropdown on the on-call
     * rule editor read "No options", so no on-call rule could be scoped.
     */
    const checkOns: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.OnCallDutyPolicy,
      );

    expect(checkOns).toEqual([
      NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
      NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
      NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
    ]);
    // Incident-only check-ons must not leak into the on-call editor.
    expect(checkOns).not.toContain(
      NotificationRuleConditionCheckOn.IncidentTitle,
    );
  });

  it("returns a non-empty list for every event type the editor can be opened with", () => {
    /*
     * The editor renders one dropdown per event type off this list, so an
     * event type missing from the switch is a dead form - which is exactly
     * how #3459 shipped. Enumerating the enum catches the next one.
     */
    for (const eventType of Object.values(NotificationRuleEventType)) {
      expect(
        NotificationRuleConditionUtil.getCheckOnByEventType(eventType),
      ).not.toEqual([]);
    }
  });
});

describe("NotificationRuleConditionUtil.getConditionTypeByCheckOn", () => {
  it("offers text operators for free-text fields", () => {
    const conditions: Array<ConditionType> =
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.IncidentTitle,
      );

    expect(conditions).toEqual([
      ConditionType.EqualTo,
      ConditionType.NotEqualTo,
      ConditionType.Contains,
      ConditionType.NotContains,
      ConditionType.StartsWith,
      ConditionType.EndsWith,
    ]);
  });

  it("offers set operators including ContainsAll for label fields", () => {
    const conditions: Array<ConditionType> =
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.IncidentLabels,
      );

    expect(conditions).toEqual([
      ConditionType.ContainsAny,
      ConditionType.NotContains,
      ConditionType.ContainsAll,
    ]);
  });

  it("offers only ContainsAny / NotContains for severity fields", () => {
    const conditions: Array<ConditionType> =
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.IncidentSeverity,
      );

    expect(conditions).toEqual([
      ConditionType.ContainsAny,
      ConditionType.NotContains,
    ]);
  });

  it("offers text operators for the on-call policy name and description", () => {
    const textOperators: Array<ConditionType> = [
      ConditionType.EqualTo,
      ConditionType.NotEqualTo,
      ConditionType.Contains,
      ConditionType.NotContains,
      ConditionType.StartsWith,
      ConditionType.EndsWith,
    ];

    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
      ),
    ).toEqual(textOperators);
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
      ),
    ).toEqual(textOperators);
  });

  it("offers set operators for on-call policy labels", () => {
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      ),
    ).toEqual([
      ConditionType.ContainsAny,
      ConditionType.NotContains,
      ConditionType.ContainsAll,
    ]);
  });

  it("returns operators for every check-on any event type offers", () => {
    /*
     * A check-on the Filter Type dropdown lists but that has no operators
     * leaves the Filter Condition dropdown empty, and the rule then fails
     * validation with "Filter Condition is required" and no way to satisfy
     * it. Walk both lists together so the pair stays complete.
     */
    for (const eventType of Object.values(NotificationRuleEventType)) {
      for (const checkOn of NotificationRuleConditionUtil.getCheckOnByEventType(
        eventType,
      )) {
        expect(
          NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn),
        ).not.toEqual([]);
      }
    }
  });
});
