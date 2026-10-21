import FilterCondition from "../../../../Types/Filter/FilterCondition";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { WorkspaceNotificationRuleUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleUtil";
import NotificationRuleInvites from "../../../../Types/Workspace/NotificationRules/NotificationRuleInvites";
import IncidentNotificationRule from "../../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import SecurityCasePriority, {
  SECURITY_CASE_PRIORITIES,
} from "../../../../Types/SecurityCase/SecurityCasePriority";
import { SECURITY_CASE_STATUSES } from "../../../../Types/SecurityCase/SecurityCaseStatus";
import SecurityDetectionSource, {
  SECURITY_DETECTION_SOURCES,
} from "../../../../Types/SecurityCase/SecurityDetectionSource";
import Label from "../../../../Models/DatabaseModels/Label";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, it } from "@jest/globals";

/*
 * Security Case notification rules: post a project's security cases to the
 * Slack and Microsoft Teams channels it names, for the cases that match.
 *
 * The chain from "the editor offers it" through "the rule saves" to "the
 * server matches it" is walked for the six Security Case check-ons:
 * priority, status and source are fixed scales every project shares, so
 * their values come from the enums, in their own order; labels are the
 * project's own; title and description are text.
 */

type CheckOnValues = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

const CASE_LABEL_ID: string = "a1a1a1a1a1a1a1a1a1a1a1a1";

function emptyData(
  labels: Array<Label> = [],
): Parameters<
  typeof NotificationRuleConditionUtil.getDropdownOptionsByCheckOn
>[0] {
  return {
    alertSeverities: [],
    alertStates: [],
    incidentSeverities: [],
    monitorStatus: [],
    incidentStates: [],
    scheduledMaintenanceStates: [],
    labels,
    monitors: [],
    checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
  };
}

function values(partial: Partial<CheckOnValues>): CheckOnValues {
  const base: Partial<CheckOnValues> = {};
  for (const key of Object.values(NotificationRuleConditionCheckOn)) {
    base[key] = undefined;
  }
  return { ...base, ...partial } as CheckOnValues;
}

// What the server hands the matcher for a security case (WorkspaceNotificationRuleService).
function caseValues(overrides: Partial<CheckOnValues> = {}): CheckOnValues {
  return values({
    [NotificationRuleConditionCheckOn.SecurityCaseTitle]:
      "Brute force against admin",
    [NotificationRuleConditionCheckOn.SecurityCaseDescription]:
      "Ten failed sign-ins in a minute.",
    [NotificationRuleConditionCheckOn.SecurityCasePriority]:
      SecurityCasePriority.Critical,
    [NotificationRuleConditionCheckOn.SecurityCaseStatus]: "New",
    [NotificationRuleConditionCheckOn.SecurityCaseSource]:
      SecurityDetectionSource.DetectionRule,
    [NotificationRuleConditionCheckOn.SecurityCaseLabels]: [CASE_LABEL_ID],
    ...overrides,
  });
}

function rule(
  overrides: Partial<IncidentNotificationRule> = {},
): IncidentNotificationRule {
  return {
    _type: "SecurityCaseNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [],
    shouldPostToExistingChannel: true,
    existingChannelNames: "soc",
    ...overrides,
  } as unknown as IncidentNotificationRule;
}

describe("Security Case notification rule conditions", () => {
  it("lists the six Security Case check-ons, priority first, and nothing the server cannot fill", () => {
    const checkOns: Array<NotificationRuleConditionCheckOn> =
      NotificationRuleConditionUtil.getCheckOnByEventType(
        NotificationRuleEventType.SecurityCase,
      );

    expect(checkOns).toEqual([
      NotificationRuleConditionCheckOn.SecurityCasePriority,
      NotificationRuleConditionCheckOn.SecurityCaseTitle,
      NotificationRuleConditionCheckOn.SecurityCaseDescription,
      NotificationRuleConditionCheckOn.SecurityCaseStatus,
      NotificationRuleConditionCheckOn.SecurityCaseSource,
      NotificationRuleConditionCheckOn.SecurityCaseLabels,
    ]);

    for (const checkOn of checkOns) {
      expect(caseValues()[checkOn]).toBeDefined();
    }
  });

  it("offers text operators for title and description, set operators for the rest", () => {
    for (const checkOn of [
      NotificationRuleConditionCheckOn.SecurityCaseTitle,
      NotificationRuleConditionCheckOn.SecurityCaseDescription,
    ]) {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn),
      ).toEqual(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(
          NotificationRuleConditionCheckOn.IncidentTitle,
        ),
      );
    }

    for (const checkOn of [
      NotificationRuleConditionCheckOn.SecurityCasePriority,
      NotificationRuleConditionCheckOn.SecurityCaseStatus,
      NotificationRuleConditionCheckOn.SecurityCaseSource,
    ]) {
      expect(
        NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn),
      ).toEqual([ConditionType.ContainsAny, ConditionType.NotContains]);
    }

    expect(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.SecurityCaseLabels,
      ),
    ).toEqual(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.IncidentLabels,
      ),
    );
  });

  it("picks priority, status, source and labels from a list, and types title and description", () => {
    const isDropdown: (checkOn: NotificationRuleConditionCheckOn) => boolean = (
      checkOn: NotificationRuleConditionCheckOn,
    ): boolean => {
      return NotificationRuleConditionUtil.isDropdownValueField({
        checkOn,
        conditionType: ConditionType.ContainsAny,
      });
    };

    expect(
      isDropdown(NotificationRuleConditionCheckOn.SecurityCasePriority),
    ).toBe(true);
    expect(
      isDropdown(NotificationRuleConditionCheckOn.SecurityCaseStatus),
    ).toBe(true);
    expect(
      isDropdown(NotificationRuleConditionCheckOn.SecurityCaseSource),
    ).toBe(true);
    expect(
      isDropdown(NotificationRuleConditionCheckOn.SecurityCaseLabels),
    ).toBe(true);
    expect(isDropdown(NotificationRuleConditionCheckOn.SecurityCaseTitle)).toBe(
      false,
    );
  });

  it("lists every priority, status and source in their own order, and the project's labels", () => {
    const options: (
      checkOn: NotificationRuleConditionCheckOn,
    ) => Array<string> = (
      checkOn: NotificationRuleConditionCheckOn,
    ): Array<string> => {
      const label: Label = new Label();
      label._id = CASE_LABEL_ID;
      label.name = "Production";

      return NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
        ...emptyData([label]),
        checkOn,
      }).map((option: DropdownOption): string => {
        return String(option.value);
      });
    };

    expect(
      options(NotificationRuleConditionCheckOn.SecurityCasePriority),
    ).toEqual([...SECURITY_CASE_PRIORITIES]);
    expect(
      options(NotificationRuleConditionCheckOn.SecurityCaseStatus),
    ).toEqual([...SECURITY_CASE_STATUSES]);
    expect(
      options(NotificationRuleConditionCheckOn.SecurityCaseSource),
    ).toEqual([...SECURITY_DETECTION_SOURCES]);
    expect(
      options(NotificationRuleConditionCheckOn.SecurityCaseLabels),
    ).toEqual([CASE_LABEL_ID]);
  });

  it("a rule for High and Critical matches a Critical case and not a Medium one", () => {
    const highAndCritical: IncidentNotificationRule = rule({
      filters: [
        {
          checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
          conditionType: ConditionType.ContainsAny,
          value: [SecurityCasePriority.Critical, SecurityCasePriority.High],
        },
      ],
    });

    expect(
      WorkspaceNotificationRuleUtil.isRuleMatching({
        notificationRule: highAndCritical,
        values: caseValues(),
      }),
    ).toBe(true);
    expect(
      WorkspaceNotificationRuleUtil.isRuleMatching({
        notificationRule: highAndCritical,
        values: caseValues({
          [NotificationRuleConditionCheckOn.SecurityCasePriority]:
            SecurityCasePriority.Medium,
        }),
      }),
    ).toBe(false);
  });

  it("no priority name is read inside another, so a choice never matches a priority it did not pick", () => {
    for (const picked of SECURITY_CASE_PRIORITIES) {
      for (const priority of SECURITY_CASE_PRIORITIES) {
        expect(
          WorkspaceNotificationRuleUtil.isRuleMatching({
            notificationRule: rule({
              filters: [
                {
                  checkOn:
                    NotificationRuleConditionCheckOn.SecurityCasePriority,
                  conditionType: ConditionType.ContainsAny,
                  value: [picked],
                },
              ],
            }),
            values: caseValues({
              [NotificationRuleConditionCheckOn.SecurityCasePriority]: priority,
            }),
          }),
        ).toBe(picked === priority);
      }
    }
  });

  it("matches on labels, source and title like every other record", () => {
    expect(
      WorkspaceNotificationRuleUtil.isRuleMatching({
        notificationRule: rule({
          filters: [
            {
              checkOn: NotificationRuleConditionCheckOn.SecurityCaseLabels,
              conditionType: ConditionType.ContainsAny,
              value: [CASE_LABEL_ID],
            },
            {
              checkOn: NotificationRuleConditionCheckOn.SecurityCaseSource,
              conditionType: ConditionType.NotContains,
              value: [SecurityDetectionSource.Manual],
            },
            {
              checkOn: NotificationRuleConditionCheckOn.SecurityCaseTitle,
              conditionType: ConditionType.Contains,
              value: "Brute force",
            },
          ],
        }),
        values: caseValues(),
      }),
    ).toBe(true);
  });

  it("a rule for security cases names where it posts: a channel, or on Teams a chat", () => {
    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule(),
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBeNull();

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ shouldPostToExistingChannel: false }),
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Please select a destination: post to an existing Slack channel");

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({ existingChannelNames: "  " }),
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.Slack,
      }),
    ).toBe("Existing Slack channel name is required");

    expect(
      NotificationRuleConditionUtil.getValidationError({
        notificationRule: rule({
          shouldPostToExistingChannel: false,
          shouldPostToExistingChat: true,
          existingChatIds: ["19:chat@thread.v2"],
        }),
        eventType: NotificationRuleEventType.SecurityCase,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ).toBeNull();
  });

  it("invites nobody: a security case has no channel of its own", () => {
    expect(
      NotificationRuleInvites.getInvitees(
        NotificationRuleEventType.SecurityCase,
      ),
    ).toEqual([]);
  });
});
