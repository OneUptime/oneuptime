import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { describe, expect, test } from "@jest/globals";

/*
 * A workspace notification rule is asked on two steps of its wizard -
 * Conditions (when it fires), then Destination (where it posts) - and each
 * step checks only its own half: getConditionsValidationError and
 * getDestinationValidationError. getValidationError, which still gates a
 * whole rule, is exactly the two in that order, so a rule valid on both steps
 * is valid, and a rule's first problem is reported the same as before.
 */

function rule(
  overrides: Partial<IncidentNotificationRule> = {},
): IncidentNotificationRule {
  return {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.Any,
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

const HALF_WRITTEN_CONDITION: NotificationRuleCondition = {
  checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
  conditionType: ConditionType.Contains,
  value: "",
};

const COMPLETE_CONDITION: NotificationRuleCondition = {
  checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
  conditionType: ConditionType.Contains,
  value: "database",
};

const POSTS_TO_CHANNEL: Partial<IncidentNotificationRule> = {
  shouldPostToExistingChannel: true,
  existingChannelNames: "#incidents",
};

const NO_DESTINATION: string =
  "Please select a destination: create a Slack channel or post to an existing Slack channel";

describe("the Conditions step's check", () => {
  test("passes a rule with no conditions: it fires for every event", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: rule(),
      }),
    ).toBeNull();
  });

  test("passes a rule nobody has filled in yet", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: undefined,
      }),
    ).toBeNull();
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: {} as IncidentNotificationRule,
      }),
    ).toBeNull();
  });

  test("refuses a condition left half-written", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: rule({ filters: [HALF_WRITTEN_CONDITION] }),
      }),
    ).toBe(
      `Value is required for ${NotificationRuleConditionCheckOn.IncidentTitle}`,
    );
  });

  test("passes complete conditions", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: rule({ filters: [COMPLETE_CONDITION] }),
      }),
    ).toBeNull();
  });

  // Where the rule posts is the next step's question.
  test("says nothing about a missing destination", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: rule(),
      }),
    ).toBeNull();
  });
});

describe("the Destination step's check", () => {
  function destinationError(
    notificationRule: IncidentNotificationRule | undefined,
    eventType: NotificationRuleEventType = NotificationRuleEventType.Incident,
    workspaceType: WorkspaceType = WorkspaceType.Slack,
  ): string | null {
    return NotificationRuleConditionUtil.getDestinationValidationError({
      notificationRule,
      eventType,
      workspaceType,
    });
  }

  test("asks an incident rule for somewhere to post", () => {
    expect(destinationError(rule())).toBe(NO_DESTINATION);
  });

  test("asks for somewhere to post even before anything is filled in", () => {
    expect(destinationError(undefined)).toBe(NO_DESTINATION);
  });

  test("passes a rule that posts to an existing channel it names", () => {
    expect(destinationError(rule(POSTS_TO_CHANNEL))).toBeNull();
  });

  test("asks for the existing channel's name", () => {
    expect(destinationError(rule({ shouldPostToExistingChannel: true }))).toBe(
      "Existing Slack channel name is required",
    );
  });

  test("asks for the new channel's name", () => {
    expect(destinationError(rule({ shouldCreateNewChannel: true }))).toBe(
      "New Slack channel name is required",
    );
  });

  test("offers Microsoft Teams chats as a destination too", () => {
    expect(
      destinationError(
        rule(),
        NotificationRuleEventType.Incident,
        WorkspaceType.MicrosoftTeams,
      ),
    ).toContain("or post to an existing Microsoft Teams chat");
  });

  // A half-written condition is the previous step's to report.
  test("says nothing about the conditions", () => {
    expect(
      destinationError(
        rule({ filters: [HALF_WRITTEN_CONDITION], ...POSTS_TO_CHANNEL }),
      ),
    ).toBeNull();
  });
});

describe("the whole rule's check", () => {
  const CASES: Array<[string, IncidentNotificationRule]> = [
    ["a valid rule", rule(POSTS_TO_CHANNEL)],
    ["a rule with nowhere to post", rule()],
    [
      "a rule with a half-written condition and nowhere to post",
      rule({ filters: [HALF_WRITTEN_CONDITION] }),
    ],
    [
      "a rule with a half-written condition and a destination",
      rule({ filters: [HALF_WRITTEN_CONDITION], ...POSTS_TO_CHANNEL }),
    ],
    [
      "a rule with complete conditions and an unnamed channel",
      rule({ filters: [COMPLETE_CONDITION], shouldCreateNewChannel: true }),
    ],
  ];

  test.each(CASES)(
    "is the Conditions check, then the Destination check, for %s",
    (_name: string, notificationRule: IncidentNotificationRule) => {
      const data: {
        notificationRule: IncidentNotificationRule;
        eventType: NotificationRuleEventType;
        workspaceType: WorkspaceType;
      } = {
        notificationRule,
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      };

      expect(NotificationRuleConditionUtil.getValidationError(data)).toBe(
        NotificationRuleConditionUtil.getConditionsValidationError(data) ||
          NotificationRuleConditionUtil.getDestinationValidationError(data),
      );
    },
  );

  test("reports the conditions first when both halves are wrong", () => {
    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ filters: [HALF_WRITTEN_CONDITION] }),
        eventType: NotificationRuleEventType.Incident,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe(
      `Value is required for ${NotificationRuleConditionCheckOn.IncidentTitle}`,
    );
  });
});
