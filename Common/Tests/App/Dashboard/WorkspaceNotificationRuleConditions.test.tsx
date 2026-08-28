import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";
import NotificationRuleConditionsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditions";
import NotificationRuleViewConditionElement from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleViewElement/NotificationRuleViewCondition";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * #3459 as the user met it: on On-Call Duty → a policy → Notification Rules →
 * Microsoft Teams, "Add Condition" dropped in a condition block whose "Filter
 * Type" dropdown opened onto react-select's "No options". Nothing could be
 * chosen, so the rule stayed "trigger for every On-Call Duty Policy".
 *
 * OnCallDutyPolicyConditions.test.ts pins the option lists themselves. This
 * file drives the real components, because "No options" is something
 * react-select renders when the list it was handed is empty - a rule about
 * lists cannot say whether that reaches the screen, only the rendered form
 * can.
 *
 * Assertions stay on plain DOM text: jest-dom's matchers do not typecheck
 * repo-wide.
 */

// react-select's own empty-list message, i.e. the bug as it appeared.
const NO_OPTIONS: string = "No options";

const PAYMENTS_LABEL_ID: string = "a1a1a1a1a1a1a1a1a1a1a1a1";
const SEARCH_LABEL_ID: string = "b2b2b2b2b2b2b2b2b2b2b2b2";

function named<T extends { _id?: string; name?: string }>(
  model: T,
  id: string,
  name: string,
): T {
  model._id = id;
  model.name = name;
  return model;
}

function projectLabels(): Array<Label> {
  return [
    named(new Label(), PAYMENTS_LABEL_ID, "Payments"),
    named(new Label(), SEARCH_LABEL_ID, "Search"),
  ];
}

// Everything both components need to turn stored ids into names.
function lookupProps(): {
  monitors: Array<Monitor>;
  labels: Array<Label>;
  alertStates: Array<AlertState>;
  alertSeverities: Array<AlertSeverity>;
  incidentSeverities: Array<IncidentSeverity>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  monitorStatus: Array<MonitorStatus>;
} {
  return {
    monitors: [named(new Monitor(), "c7c7c7c7c7c7c7c7c7c7c7c7", "API")],
    labels: projectLabels(),
    alertStates: [
      named(new AlertState(), "c2c2c2c2c2c2c2c2c2c2c2c2", "Created"),
    ],
    alertSeverities: [
      named(new AlertSeverity(), "c1c1c1c1c1c1c1c1c1c1c1c1", "Sev 1"),
    ],
    incidentSeverities: [
      named(new IncidentSeverity(), "c3c3c3c3c3c3c3c3c3c3c3c3", "Major"),
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
    monitorStatus: [
      named(new MonitorStatus(), "c4c4c4c4c4c4c4c4c4c4c4c4", "Offline"),
    ],
  };
}

function renderConditions(eventType: NotificationRuleEventType): {
  onChange: MockFunction;
} {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <NotificationRuleConditionsElement
      {...lookupProps()}
      eventType={eventType}
      value={[]}
      onChange={
        onChange as unknown as (value: Array<NotificationRuleCondition>) => void
      }
    />,
  );

  return { onChange: onChange };
}

// The condition list the newest onChange handed back.
function lastConditionsFrom(
  onChange: MockFunction,
): Array<NotificationRuleCondition> {
  expect(onChange.mock.calls.length).toBeGreaterThan(0);

  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as Array<NotificationRuleCondition>;
}

async function clickAddCondition(): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Add Condition/i }));
}

/*
 * react-select renders one text input per dropdown, in form order:
 * 0 = Filter Type, 1 = Filter Condition, 2 = Value (when it is a dropdown).
 */
async function openDropdown(index: number): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const comboboxes: Array<HTMLElement> = screen.getAllByRole("combobox");

  expect(comboboxes.length).toBeGreaterThan(index);

  await user.click(comboboxes[index]!);
}

async function pickFromDropdown(input: {
  index: number;
  optionLabel: string;
}): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  await openDropdown(input.index);
  await user.click(await screen.findByText(input.optionLabel));
}

describe("The workspace notification rule Conditions editor", () => {
  describe("the On-Call Duty Policy editor reported in #3459", () => {
    test("the Filter Type dropdown lists the on-call fields instead of 'No options'", async () => {
      renderConditions(NotificationRuleEventType.OnCallDutyPolicy);

      await clickAddCondition();
      await openDropdown(0);

      expect(screen.queryByText(NO_OPTIONS)).toBeNull();
      expect(
        screen.getAllByText(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
        ).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
        ).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(
          NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
        ).length,
      ).toBeGreaterThan(0);
    });

    test("Add Condition seeds a usable row rather than an undefined check-on", async () => {
      const { onChange } = renderConditions(
        NotificationRuleEventType.OnCallDutyPolicy,
      );

      await clickAddCondition();

      const conditions: Array<NotificationRuleCondition> =
        lastConditionsFrom(onChange);

      expect(conditions.length).toBe(1);
      expect(conditions[0]!.checkOn).toBe(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
      );
      expect(conditions[0]!.conditionType).toBe(ConditionType.EqualTo);
    });

    test("the Filter Condition dropdown offers the text operators once a field is chosen", async () => {
      renderConditions(NotificationRuleEventType.OnCallDutyPolicy);

      await clickAddCondition();
      await pickFromDropdown({
        index: 0,
        optionLabel:
          NotificationRuleConditionCheckOn.OnCallDutyPolicyDescription,
      });
      await openDropdown(1);

      expect(screen.queryByText(NO_OPTIONS)).toBeNull();
      expect(
        screen.getAllByText(ConditionType.Contains).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByText(ConditionType.StartsWith).length,
      ).toBeGreaterThan(0);
    });

    test("choosing the labels field offers the project's labels as the value", async () => {
      renderConditions(NotificationRuleEventType.OnCallDutyPolicy);

      await clickAddCondition();
      await pickFromDropdown({
        index: 0,
        optionLabel: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      });
      await pickFromDropdown({
        index: 1,
        optionLabel: ConditionType.ContainsAny,
      });
      await openDropdown(2);

      expect(screen.queryByText(NO_OPTIONS)).toBeNull();
      expect(screen.getAllByText("Payments").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Search").length).toBeGreaterThan(0);
    });

    test("a chosen label is recorded on the condition by id", async () => {
      const { onChange } = renderConditions(
        NotificationRuleEventType.OnCallDutyPolicy,
      );

      await clickAddCondition();
      await pickFromDropdown({
        index: 0,
        optionLabel: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      });
      await pickFromDropdown({
        index: 1,
        optionLabel: ConditionType.ContainsAny,
      });
      await pickFromDropdown({ index: 2, optionLabel: "Payments" });

      const conditions: Array<NotificationRuleCondition> =
        lastConditionsFrom(onChange);

      expect(conditions[0]!.checkOn).toBe(
        NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      );
      expect(conditions[0]!.conditionType).toBe(ConditionType.ContainsAny);
      expect(conditions[0]!.value).toEqual([PAYMENTS_LABEL_ID]);
    });
  });

  describe("every event type a Workspace Connections page can open", () => {
    /*
     * The On-Call page was not special: any event type missing from
     * getCheckOnByEventType renders the same dead condition block. Walk the
     * whole enum so the next resource cannot ship the same way.
     */
    test.each(Object.values(NotificationRuleEventType))(
      "%s seeds a fully-formed condition and shows filter types",
      async (eventType: NotificationRuleEventType) => {
        const { onChange } = renderConditions(eventType);

        await clickAddCondition();

        const conditions: Array<NotificationRuleCondition> =
          lastConditionsFrom(onChange);

        expect(conditions.length).toBe(1);
        expect(conditions[0]!.checkOn).toBeDefined();
        expect(conditions[0]!.conditionType).toBeDefined();

        await openDropdown(0);
        expect(screen.queryByText(NO_OPTIONS)).toBeNull();
      },
    );

    test.each(Object.values(NotificationRuleEventType))(
      "%s seeds the first check-on its own option list starts with",
      async (eventType: NotificationRuleEventType) => {
        const { onChange } = renderConditions(eventType);

        await clickAddCondition();

        expect(lastConditionsFrom(onChange)[0]!.checkOn).toBe(
          NotificationRuleConditionUtil.getCheckOnByEventType(eventType)[0],
        );
      },
    );
  });
});

describe("The saved-rule condition view", () => {
  function renderView(condition: NotificationRuleCondition): void {
    render(
      <NotificationRuleViewConditionElement
        {...lookupProps()}
        notificationRuleCondition={condition}
      />,
    );
  }

  test("renders on-call policy labels by name, not by stored id", () => {
    /*
     * The label check-ons were listed one by one in the view, and the on-call
     * one was missing - so a saved on-call rule read back as a raw uuid.
     */
    renderView({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
      conditionType: ConditionType.ContainsAny,
      value: [PAYMENTS_LABEL_ID],
    });

    expect(screen.getAllByText("Payments").length).toBeGreaterThan(0);
    expect(screen.queryByText(PAYMENTS_LABEL_ID)).toBeNull();
  });

  test("renders alert episode labels by name", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.AlertEpisodeLabels,
      conditionType: ConditionType.ContainsAny,
      value: [SEARCH_LABEL_ID],
    });

    expect(screen.getAllByText("Search").length).toBeGreaterThan(0);
    expect(screen.queryByText(SEARCH_LABEL_ID)).toBeNull();
  });

  test("renders incident episode labels by name", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.IncidentEpisodeLabels,
      conditionType: ConditionType.ContainsAny,
      value: [PAYMENTS_LABEL_ID],
    });

    expect(screen.getAllByText("Payments").length).toBeGreaterThan(0);
    expect(screen.queryByText(PAYMENTS_LABEL_ID)).toBeNull();
  });

  test("renders alert episode severity by name", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.AlertEpisodeSeverity,
      conditionType: ConditionType.ContainsAny,
      value: ["c1c1c1c1c1c1c1c1c1c1c1c1"],
    });

    expect(screen.getAllByText("Sev 1").length).toBeGreaterThan(0);
  });

  test("renders alert episode state by name", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.AlertEpisodeState,
      conditionType: ConditionType.ContainsAny,
      value: ["c2c2c2c2c2c2c2c2c2c2c2c2"],
    });

    expect(screen.getAllByText("Created").length).toBeGreaterThan(0);
  });

  test("renders incident episode severity by name", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.IncidentEpisodeSeverity,
      conditionType: ConditionType.ContainsAny,
      value: ["c3c3c3c3c3c3c3c3c3c3c3c3"],
    });

    expect(screen.getAllByText("Major").length).toBeGreaterThan(0);
  });

  test("renders incident episode state by name", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.IncidentEpisodeState,
      conditionType: ConditionType.ContainsAny,
      value: ["c5c5c5c5c5c5c5c5c5c5c5c5"],
    });

    expect(screen.getAllByText("Acknowledged").length).toBeGreaterThan(0);
  });

  test("renders the on-call policy name filter as plain text", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
      conditionType: ConditionType.Contains,
      value: "Payments Escalation",
    });

    expect(screen.getAllByText("Payments Escalation").length).toBeGreaterThan(
      0,
    );
  });

  test.each([
    NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
    NotificationRuleConditionCheckOn.IncidentLabels,
    NotificationRuleConditionCheckOn.IncidentState,
    NotificationRuleConditionCheckOn.Monitors,
  ])(
    "survives a %s condition saved without a value",
    (checkOn: NotificationRuleConditionCheckOn) => {
      /*
       * A dropdown-backed condition whose value never got picked used to reach
       * `undefined.includes(...)` and take the whole rule view down with it.
       */
      renderView({
        checkOn: checkOn,
        conditionType: ConditionType.ContainsAny,
        value: undefined,
      });

      expect(screen.getAllByText(checkOn).length).toBeGreaterThan(0);
      expect(screen.queryByText("Payments")).toBeNull();
    },
  );

  test("survives a label condition saved as a single string", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
      conditionType: ConditionType.ContainsAny,
      value: PAYMENTS_LABEL_ID,
    });

    expect(screen.getAllByText("Payments").length).toBeGreaterThan(0);
  });
});
