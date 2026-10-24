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
import SecurityCasePriorityLevel, {
  SECURITY_CASE_PRIORITY_LEVELS,
} from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
} from "../../../../Types/SecurityCase/SecurityCaseStage";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
} from "../../../Helpers/SecurityCaseValues";
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
 * priority and status are the project's own, picked and matched by id like
 * an incident's severity and state, in the project's order; source is a
 * fixed scale every project shares, from its enum; labels are the project's
 * own; title and description are text.
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
    securityCasePriorities: buildDefaultTestPriorities(),
    securityCaseStatuses: buildDefaultTestStatuses(),
    checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
  };
}

const priorityId: (level: SecurityCasePriorityLevel) => string = (
  level: SecurityCasePriorityLevel,
): string => {
  return TEST_PRIORITY_IDS[level];
};

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
    [NotificationRuleConditionCheckOn.SecurityCasePriority]: priorityId(
      SecurityCasePriorityLevel.Critical,
    ),
    [NotificationRuleConditionCheckOn.SecurityCaseStatus]:
      TEST_STATUS_IDS[SecurityCaseStage.New],
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

  it("lists the project's priorities and statuses by id, every source in its own order, and the project's labels", () => {
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
    ).toEqual(
      SECURITY_CASE_PRIORITY_LEVELS.map((level: SecurityCasePriorityLevel) => {
        return priorityId(level);
      }),
    );
    expect(
      options(NotificationRuleConditionCheckOn.SecurityCaseStatus),
    ).toEqual(
      SECURITY_CASE_STAGES.map((stage: SecurityCaseStage) => {
        return TEST_STATUS_IDS[stage];
      }),
    );
    expect(
      options(NotificationRuleConditionCheckOn.SecurityCaseSource),
    ).toEqual([...SECURITY_DETECTION_SOURCES]);
    expect(
      options(NotificationRuleConditionCheckOn.SecurityCaseLabels),
    ).toEqual([CASE_LABEL_ID]);
  });

  it("names each priority and status as the project calls it, renamed or its own", () => {
    const priorities: ReturnType<typeof buildDefaultTestPriorities> =
      buildDefaultTestPriorities();
    priorities[0]!.name = "Sev 1";

    expect(
      NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
        ...emptyData(),
        securityCasePriorities: priorities,
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
      }).map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual(["Sev 1", "High", "Medium", "Low", "Informational"]);
    expect(
      NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
        ...emptyData(),
        checkOn: NotificationRuleConditionCheckOn.SecurityCaseStatus,
      }).map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual(["New", "Investigating", "Contained", "Closed"]);
    // Nothing read yet: nothing to offer, never another project's.
    expect(
      NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
        ...emptyData(),
        securityCasePriorities: undefined,
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
      }),
    ).toEqual([]);
  });

  it("a rule for High and Critical matches a Critical case and not a Medium one", () => {
    const highAndCritical: IncidentNotificationRule = rule({
      filters: [
        {
          checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
          conditionType: ConditionType.ContainsAny,
          value: [
            priorityId(SecurityCasePriorityLevel.Critical),
            priorityId(SecurityCasePriorityLevel.High),
          ],
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
          [NotificationRuleConditionCheckOn.SecurityCasePriority]: priorityId(
            SecurityCasePriorityLevel.Medium,
          ),
        }),
      }),
    ).toBe(false);
  });

  it("no priority is read inside another, so a choice never matches a priority it did not pick", () => {
    const ids: Array<string> = SECURITY_CASE_PRIORITY_LEVELS.map(
      (level: SecurityCasePriorityLevel): string => {
        return priorityId(level);
      },
    );

    for (const picked of ids) {
      for (const priority of ids) {
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
