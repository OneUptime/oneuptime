import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

describe("NotificationRuleConditionUtil", () => {
  const makeRule: (
    overrides?: Partial<IncidentNotificationRule>,
  ) => IncidentNotificationRule = (
    overrides: Partial<IncidentNotificationRule> = {},
  ): IncidentNotificationRule => {
    return {
      filters: [],
      shouldCreateNewChannel: true,
      newChannelTemplateName: "incident-{{id}}",
      shouldPostToExistingChannel: false,
      ...overrides,
    } as unknown as IncidentNotificationRule;
  };

  const validate: (rule: IncidentNotificationRule) => string | null = (
    rule: IncidentNotificationRule,
  ): string | null => {
    return NotificationRuleConditionUtil.getValidationError({
      notificationRule: rule,
      eventType: NotificationRuleEventType.Incident,
      workspaceType: WorkspaceType.Slack,
    });
  };

  describe("getValidationError - filters", () => {
    test("requires checkOn on every filter", () => {
      const rule: IncidentNotificationRule = makeRule({
        filters: [
          {
            conditionType: ConditionType.EqualTo,
            value: "x",
          } as unknown as NotificationRuleCondition,
        ],
      });
      expect(validate(rule)).toBe("Check On is required");
    });

    test("requires a condition type", () => {
      const rule: IncidentNotificationRule = makeRule({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType: undefined,
            value: "x",
          },
        ],
      });
      expect(validate(rule)).toBe(
        `Filter Condition is required for ${NotificationRuleConditionCheckOn.IncidentTitle}`,
      );
    });

    test("requires a value", () => {
      const rule: IncidentNotificationRule = makeRule({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType: ConditionType.EqualTo,
            value: undefined,
          },
        ],
      });
      expect(validate(rule)).toBe(
        `Value is required for ${NotificationRuleConditionCheckOn.IncidentTitle}`,
      );
    });

    test("rejects an empty-array value", () => {
      const rule: IncidentNotificationRule = makeRule({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
            conditionType: ConditionType.ContainsAny,
            value: [],
          },
        ],
      });
      expect(validate(rule)).toBe(
        `Value is required for ${NotificationRuleConditionCheckOn.IncidentLabels}`,
      );
    });
  });

  describe("getValidationError - channel selection", () => {
    test("requires either create-new or post-to-existing channel", () => {
      const rule: IncidentNotificationRule = makeRule({
        shouldCreateNewChannel: false,
        shouldPostToExistingChannel: false,
      });
      expect(validate(rule)).toBe(
        "Please select either create slack channel or post to existing Slack channel",
      );
    });

    test("requires an existing channel name when posting to an existing channel", () => {
      const rule: IncidentNotificationRule = makeRule({
        shouldCreateNewChannel: false,
        shouldPostToExistingChannel: true,
        existingChannelNames: "   ",
      });
      expect(validate(rule)).toBe("Existing Slack channel name is required");
    });

    test("requires a new channel name when creating a channel", () => {
      const rule: IncidentNotificationRule = makeRule({
        shouldCreateNewChannel: true,
        newChannelTemplateName: "  ",
      });
      expect(validate(rule)).toBe("New Slack channel name is required");
    });

    test("returns null for a fully valid rule", () => {
      expect(validate(makeRule())).toBeNull();
    });

    test("skips channel validation for event types that do not post to channels", () => {
      const rule: IncidentNotificationRule = makeRule({
        shouldCreateNewChannel: false,
        shouldPostToExistingChannel: false,
      });
      // Monitor events are not in the channel-required set.
      expect(
        NotificationRuleConditionUtil.getValidationError({
          notificationRule: rule,
          eventType: NotificationRuleEventType.Monitor,
          workspaceType: WorkspaceType.Slack,
        }),
      ).toBeNull();
    });
  });

  describe("hasValueField", () => {
    test.each([
      ConditionType.IsEmpty,
      ConditionType.IsNotEmpty,
      ConditionType.True,
      ConditionType.False,
    ])(
      "returns false for the valueless condition %s",
      (conditionType: ConditionType) => {
        expect(
          NotificationRuleConditionUtil.hasValueField({
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType,
          }),
        ).toBe(false);
      },
    );

    test.each([ConditionType.EqualTo, ConditionType.Contains])(
      "returns true for the value-based condition %s",
      (conditionType: ConditionType) => {
        expect(
          NotificationRuleConditionUtil.hasValueField({
            checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
            conditionType,
          }),
        ).toBe(true);
      },
    );
  });

  describe("isDropdownValueField", () => {
    test("returns false when checkOn or conditionType is missing", () => {
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

    test.each([
      NotificationRuleConditionCheckOn.IncidentState,
      NotificationRuleConditionCheckOn.IncidentSeverity,
      NotificationRuleConditionCheckOn.MonitorLabels,
      NotificationRuleConditionCheckOn.Monitors,
    ])(
      "returns true for the dropdown checkOn %s",
      (checkOn: NotificationRuleConditionCheckOn) => {
        expect(
          NotificationRuleConditionUtil.isDropdownValueField({
            checkOn,
            conditionType: ConditionType.ContainsAny,
          }),
        ).toBe(true);
      },
    );

    test.each([
      NotificationRuleConditionCheckOn.IncidentTitle,
      NotificationRuleConditionCheckOn.IncidentDescription,
    ])(
      "returns false for the free-text checkOn %s",
      (checkOn: NotificationRuleConditionCheckOn) => {
        expect(
          NotificationRuleConditionUtil.isDropdownValueField({
            checkOn,
            conditionType: ConditionType.EqualTo,
          }),
        ).toBe(false);
      },
    );
  });

  describe("getCheckOnByEventType", () => {
    test("returns incident checkOns for the Incident event", () => {
      const checkOns: Array<NotificationRuleConditionCheckOn> =
        NotificationRuleConditionUtil.getCheckOnByEventType(
          NotificationRuleEventType.Incident,
        );
      expect(checkOns).toContain(
        NotificationRuleConditionCheckOn.IncidentTitle,
      );
      expect(checkOns).toContain(NotificationRuleConditionCheckOn.Monitors);
      expect(checkOns).not.toContain(
        NotificationRuleConditionCheckOn.AlertTitle,
      );
    });

    test("returns monitor checkOns for the Monitor event", () => {
      const checkOns: Array<NotificationRuleConditionCheckOn> =
        NotificationRuleConditionUtil.getCheckOnByEventType(
          NotificationRuleEventType.Monitor,
        );
      expect(checkOns).toContain(NotificationRuleConditionCheckOn.MonitorName);
      expect(checkOns).toContain(
        NotificationRuleConditionCheckOn.MonitorStatus,
      );
    });

    test("returns an empty list for an unhandled event type", () => {
      expect(
        NotificationRuleConditionUtil.getCheckOnByEventType(
          NotificationRuleEventType.OnCallDutyPolicy,
        ),
      ).toEqual([]);
    });
  });

  describe("getConditionTypeByCheckOn", () => {
    test("free-text fields offer the string comparison operators", () => {
      const types: Array<ConditionType> =
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.IncidentTitle,
        );
      expect(types).toContain(ConditionType.EqualTo);
      expect(types).toContain(ConditionType.Contains);
      expect(types).toContain(ConditionType.StartsWith);
      expect(types).not.toContain(ConditionType.ContainsAll);
    });

    test("state/severity fields offer ContainsAny / NotContains", () => {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.IncidentState,
        ),
      ).toEqual([ConditionType.ContainsAny, ConditionType.NotContains]);
    });

    test("label fields additionally offer ContainsAll", () => {
      const types: Array<ConditionType> =
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.IncidentLabels,
        );
      expect(types).toContain(ConditionType.ContainsAll);
    });

    test("returns an empty list for an unhandled checkOn", () => {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          "Unhandled" as NotificationRuleConditionCheckOn,
        ),
      ).toEqual([]);
    });
  });

  describe("getDropdownOptionsByCheckOn", () => {
    test("returns an empty list when the backing collections are empty", () => {
      expect(
        NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
          alertSeverities: [],
          alertStates: [],
          incidentSeverities: [],
          monitorStatus: [],
          incidentStates: [],
          scheduledMaintenanceStates: [],
          labels: [],
          monitors: [],
          checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
        }),
      ).toEqual([]);
    });
  });
});
