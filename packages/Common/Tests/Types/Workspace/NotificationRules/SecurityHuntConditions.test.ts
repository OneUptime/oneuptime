import FilterCondition from "../../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import NotificationRuleInvites from "../../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { describe, expect, it } from "@jest/globals";

/*
 * Security Hunt notification rules: post what a project's scheduled hunts
 * find to the Slack and Microsoft Teams channels (and Teams chats) it
 * names, for the hunts that match. A rule asks one thing of a hunt, its
 * name - "starts with IR -", "contains ransomware" - typed as text and
 * matched as every record's text is; a rule with no condition is for every
 * hunt. Like a security case, a hunt has no channel of its own: a rule
 * posts to channels and chats that exist, and invites nobody.
 */

type CheckOnValues = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

// What the server hands the matcher for a hunt (WorkspaceNotificationRuleService).
function huntValues(name: string): CheckOnValues {
  const values: Partial<CheckOnValues> = {};

  for (const key of Object.values(NotificationRuleConditionCheckOn)) {
    values[key] = undefined;
  }

  values[NotificationRuleConditionCheckOn.SecurityHuntName] = name;

  return values as CheckOnValues;
}

function rule(
  overrides: Partial<IncidentNotificationRule> = {},
): IncidentNotificationRule {
  return {
    _type: "SecurityHuntNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: true,
    existingChannelNames: "threat-hunting",
    ...overrides,
  } as unknown as IncidentNotificationRule;
}

function byName(
  conditionType: ConditionType,
  value: string,
): IncidentNotificationRule {
  return rule({
    filters: [
      {
        checkOn: NotificationRuleConditionCheckOn.SecurityHuntName,
        conditionType,
        value,
      },
    ],
  });
}

function matches(
  notificationRule: IncidentNotificationRule,
  name: string,
): boolean {
  return WorkspaceNotificationRuleUtil.isRuleMatching({
    notificationRule,
    values: huntValues(name),
  });
}

describe("Security Hunt notification rule conditions", () => {
  it("asks one thing of a hunt, its name - which the server always fills", () => {
    const checkOns: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.SecurityHunt,
      );

    expect(checkOns).toEqual([
      NotificationRuleConditionCheckOn.SecurityHuntName,
    ]);
    expect(
      huntValues("Encoded PowerShell")[
        NotificationRuleConditionCheckOn.SecurityHuntName
      ],
    ).toBeDefined();
  });

  it("no other kind of rule offers a hunt's name", () => {
    for (const eventType of Object.values(NotificationRuleEventType)) {
      if (eventType === NotificationRuleEventType.SecurityHunt) {
        continue;
      }

      expect(
        NotificationRuleConditionUtil.getCheckOnByEventType(eventType),
      ).not.toContain(NotificationRuleConditionCheckOn.SecurityHuntName);
    }
  });

  it("offers the text operators every record's title has, and types the value", () => {
    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.SecurityHuntName,
      ),
    ).toEqual(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.IncidentTitle,
      ),
    );
    expect(
      NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: NotificationRuleConditionCheckOn.SecurityHuntName,
        conditionType: ConditionType.Contains,
      }),
    ).toBe(false);
  });

  it("matches the hunt's name as written: is, contains, starts and ends with - and their nots", () => {
    const name: string = "IR - Encoded PowerShell";

    expect(matches(byName(ConditionType.EqualTo, name), name)).toBe(true);
    expect(
      matches(byName(ConditionType.EqualTo, "Encoded PowerShell"), name),
    ).toBe(false);
    expect(
      matches(byName(ConditionType.NotEqualTo, "Admin sign-ins"), name),
    ).toBe(true);
    expect(matches(byName(ConditionType.Contains, "PowerShell"), name)).toBe(
      true,
    );
    expect(matches(byName(ConditionType.NotContains, "PowerShell"), name)).toBe(
      false,
    );
    expect(matches(byName(ConditionType.StartsWith, "IR - "), name)).toBe(true);
    expect(matches(byName(ConditionType.EndsWith, "PowerShell"), name)).toBe(
      true,
    );
    expect(matches(byName(ConditionType.EndsWith, "Admin"), name)).toBe(false);
  });

  it("a rule with no condition is for every hunt", () => {
    expect(matches(rule(), "Encoded PowerShell")).toBe(true);
    expect(matches(rule(), "Admin sign-ins")).toBe(true);
  });

  it("a rule saves with its name condition complete, and is told what is missing when it is not", () => {
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: byName(ConditionType.StartsWith, "IR - "),
      }),
    ).toBeNull();
    expect(
      NotificationRuleConditionUtil.getConditionsValidationError({
        notificationRule: byName(ConditionType.StartsWith, ""),
      }),
    ).toBe("Value is required for Security Hunt Name");
  });

  it("a rule for hunts names where it posts: a channel, or on Teams a chat - never a channel of the hunt's own", () => {
    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule(),
        eventType: NotificationRuleEventType.SecurityHunt,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBeNull();

    // A channel the rule would create is no destination for a hunt.
    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({
          shouldPostToExistingChannel: false,
          shouldCreateNewChannel: true,
        }),
        eventType: NotificationRuleEventType.SecurityHunt,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Please select a destination: post to an existing Slack channel");

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ shouldPostToExistingChannel: false }),
        eventType: NotificationRuleEventType.SecurityHunt,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBe(
      "Please select a destination: post to an existing Microsoft Teams channel or to an existing Microsoft Teams chat",
    );

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ existingChannelNames: "  " }),
        eventType: NotificationRuleEventType.SecurityHunt,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Existing Slack channel name is required");

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({
          shouldPostToExistingChannel: false,
          shouldPostToExistingChat: true,
          existingChatIds: ["19:soc-on-call@thread.v2"],
        }),
        eventType: NotificationRuleEventType.SecurityHunt,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBeNull();
  });

  it("invites nobody: a hunt has no channel of its own to add anybody to", () => {
    expect(
      NotificationRuleInvites.getInvitees(
        NotificationRuleEventType.SecurityHunt,
      ),
    ).toEqual([]);
  });
});
