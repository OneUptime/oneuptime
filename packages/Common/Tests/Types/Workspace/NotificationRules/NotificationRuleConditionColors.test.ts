import { NotificationRuleConditionUtil } from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { NotificationRuleConditionCheckOn } from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Color from "../../../../Types/Color";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import { describe, expect, test } from "@jest/globals";

/*
 * A workspace (Slack / Microsoft Teams) notification rule's conditions pick
 * states, severities, monitor statuses and labels from dropdowns. The rows
 * come from the project with their colours; the options used to drop them,
 * so "Incident State is one of [...]" listed plain names while every other
 * state picker drew each state's colour.
 */

function named<T extends { _id?: string; name?: string; color?: Color }>(
  model: T,
  id: string,
  name: string,
  color?: string | undefined,
): T {
  model._id = id;
  model.name = name;

  if (color) {
    model.color = new Color(color);
  }

  return model;
}

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
      named(new AlertSeverity(), "alert-sev-1", "Critical", "#dc2626"),
      named(new AlertSeverity(), "alert-sev-2", "Warning", "#f59e0b"),
    ],
    alertStates: [
      named(new AlertState(), "alert-state-1", "Created", "#ef4444"),
      named(new AlertState(), "alert-state-2", "Resolved", "#10b981"),
    ],
    incidentSeverities: [
      named(new IncidentSeverity(), "inc-sev-1", "Major", "#b91c1c"),
    ],
    monitorStatus: [
      named(new MonitorStatus(), "status-1", "Operational", "#22c55e"),
      named(new MonitorStatus(), "status-2", "Offline", "#ef4444"),
    ],
    incidentStates: [
      named(new IncidentState(), "inc-state-1", "Identified", "#ef4444"),
      named(new IncidentState(), "inc-state-2", "Acknowledged", "#f59e0b"),
      named(new IncidentState(), "inc-state-3", "Resolved", "#10b981"),
    ],
    scheduledMaintenanceStates: [
      named(new ScheduledMaintenanceState(), "sm-1", "Scheduled", "#6366f1"),
      named(new ScheduledMaintenanceState(), "sm-2", "Ongoing", "#f59e0b"),
    ],
    labels: [named(new Label(), "label-1", "Payments", "#0ea5e9")],
    monitors: [named(new Monitor(), "monitor-1", "API")],
  };
}

type OptionTriple = [string, string, string | undefined];

function optionsFor(checkOn: NotificationRuleConditionCheckOn): Array<OptionTriple> {
  return NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
    ...dropdownData(),
    checkOn: checkOn,
  }).map((option: DropdownOption): OptionTriple => {
    return [
      option.label,
      option.value as string,
      option.color?.toString(),
    ];
  });
}

describe("workspace rule condition options carry their colours", () => {
  test.each([
    [
      NotificationRuleConditionCheckOn.IncidentState,
      [
        ["Identified", "inc-state-1", "#ef4444"],
        ["Acknowledged", "inc-state-2", "#f59e0b"],
        ["Resolved", "inc-state-3", "#10b981"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.IncidentEpisodeState,
      [
        ["Identified", "inc-state-1", "#ef4444"],
        ["Acknowledged", "inc-state-2", "#f59e0b"],
        ["Resolved", "inc-state-3", "#10b981"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.AlertState,
      [
        ["Created", "alert-state-1", "#ef4444"],
        ["Resolved", "alert-state-2", "#10b981"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.AlertEpisodeState,
      [
        ["Created", "alert-state-1", "#ef4444"],
        ["Resolved", "alert-state-2", "#10b981"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.ScheduledMaintenanceState,
      [
        ["Scheduled", "sm-1", "#6366f1"],
        ["Ongoing", "sm-2", "#f59e0b"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.IncidentSeverity,
      [["Major", "inc-sev-1", "#b91c1c"]],
    ],
    [
      NotificationRuleConditionCheckOn.IncidentEpisodeSeverity,
      [["Major", "inc-sev-1", "#b91c1c"]],
    ],
    [
      NotificationRuleConditionCheckOn.AlertSeverity,
      [
        ["Critical", "alert-sev-1", "#dc2626"],
        ["Warning", "alert-sev-2", "#f59e0b"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.AlertEpisodeSeverity,
      [
        ["Critical", "alert-sev-1", "#dc2626"],
        ["Warning", "alert-sev-2", "#f59e0b"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.MonitorStatus,
      [
        ["Operational", "status-1", "#22c55e"],
        ["Offline", "status-2", "#ef4444"],
      ],
    ],
    [
      NotificationRuleConditionCheckOn.IncidentLabels,
      [["Payments", "label-1", "#0ea5e9"]],
    ],
    [
      NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      [["Payments", "label-1", "#0ea5e9"]],
    ],
  ])(
    "%s: each option is its row's name, id and colour",
    (
      checkOn: NotificationRuleConditionCheckOn,
      expected: Array<Array<string>>,
    ) => {
      expect(optionsFor(checkOn)).toEqual(expected);
    },
  );

  test("monitors have no colour, so their options have none", () => {
    expect(optionsFor(NotificationRuleConditionCheckOn.Monitors)).toEqual([
      ["API", "monitor-1", undefined],
    ]);
  });

  test("a row fetched without its colour still gives a plain option", () => {
    const options: Array<DropdownOption> =
      NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
        ...dropdownData(),
        incidentStates: [named(new IncidentState(), "inc-state-1", "Identified")],
        checkOn: NotificationRuleConditionCheckOn.IncidentState,
      });

    expect(options).toEqual([{ label: "Identified", value: "inc-state-1" }]);
  });

  test("the option value is the row's id, the same one a rule saves", () => {
    const state: IncidentState = named(
      new IncidentState(),
      "0193c0de-0000-4aaa-8bbb-000000000009",
      "Identified",
      "#ef4444",
    );

    const options: Array<DropdownOption> =
      NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
        ...dropdownData(),
        incidentStates: [state],
        checkOn: NotificationRuleConditionCheckOn.IncidentState,
      });

    expect(options[0]!.value).toBe(state.id!.toString());
  });
});
