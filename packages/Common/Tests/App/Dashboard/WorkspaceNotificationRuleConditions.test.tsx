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
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestPriority,
  buildTestStatus,
} from "../../Helpers/SecurityCaseValues";
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

// A priority and a status of the project's own, beside a new project's.
const EMERGENCY_PRIORITY_ID: string = "c1000000-0000-4000-8000-0000000000e1";
const ERADICATING_STATUS_ID: string = "c2000000-0000-4000-8000-0000000000e2";

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
  securityCasePriorities: Array<SecurityCasePriority>;
  securityCaseStatuses: Array<SecurityCaseStatus>;
  monitorStatus: Array<MonitorStatus>;
} {
  // Most urgent first, as the project ranks them: its own Emergency on top.
  const priorities: Array<SecurityCasePriority> = buildDefaultTestPriorities();
  priorities.forEach((priority: SecurityCasePriority): void => {
    priority.order = (priority.order || 0) + 1;
  });

  // Its own Eradicating step between Contained and Closed.
  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
  statuses[3]!.order = 5;

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
    securityCasePriorities: [
      buildTestPriority({
        id: EMERGENCY_PRIORITY_ID,
        name: "Emergency",
        order: 1,
      }),
      ...priorities,
    ],
    securityCaseStatuses: [
      ...statuses,
      buildTestStatus({
        id: ERADICATING_STATUS_ID,
        name: "Eradicating",
        order: 4,
      }),
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

/*
 * The first condition comes with "Only ... that match conditions"; Add
 * Condition, under it, adds the next ones.
 */
async function clickAddCondition(): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const addButton: HTMLElement | null = screen.queryByRole("button", {
    name: /Add Condition/i,
  });

  if (addButton) {
    await user.click(addButton);
    return;
  }

  await user.click(screen.getByTestId("notification-rule-applies-to-matching"));
}

function renderSavedConditions(
  eventType: NotificationRuleEventType,
  conditions: Array<NotificationRuleCondition>,
): { onChange: MockFunction } {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <NotificationRuleConditionsElement
      {...lookupProps()}
      eventType={eventType}
      value={conditions}
      onChange={
        onChange as unknown as (value: Array<NotificationRuleCondition>) => void
      }
    />,
  );

  return { onChange: onChange };
}

// What each kind of rule's choice calls its records, and the step above it.
const APPLIES_TO: Array<{
  eventType: NotificationRuleEventType;
  heading: string;
  all: string;
  matching: string;
}> = [
  {
    eventType: NotificationRuleEventType.Incident,
    heading: "Which incidents",
    all: "All incidents",
    matching: "Only incidents that match conditions",
  },
  {
    eventType: NotificationRuleEventType.Alert,
    heading: "Which alerts",
    all: "All alerts",
    matching: "Only alerts that match conditions",
  },
  {
    eventType: NotificationRuleEventType.IncidentEpisode,
    heading: "Which incident episodes",
    all: "All incident episodes",
    matching: "Only incident episodes that match conditions",
  },
  {
    eventType: NotificationRuleEventType.AlertEpisode,
    heading: "Which alert episodes",
    all: "All alert episodes",
    matching: "Only alert episodes that match conditions",
  },
  {
    eventType: NotificationRuleEventType.ScheduledMaintenance,
    heading: "Which scheduled maintenance events",
    all: "All scheduled maintenance events",
    matching: "Only scheduled maintenance events that match conditions",
  },
  {
    eventType: NotificationRuleEventType.Monitor,
    heading: "Which monitors",
    all: "All monitors",
    matching: "Only monitors that match conditions",
  },
  {
    eventType: NotificationRuleEventType.OnCallDutyPolicy,
    heading: "Which on-call policies",
    all: "All on-call policies",
    matching: "Only on-call policies that match conditions",
  },
  {
    eventType: NotificationRuleEventType.SecurityCase,
    heading: "Which security cases",
    all: "All security cases",
    matching: "Only security cases that match conditions",
  },
];

const INCIDENT_TITLE_CONDITION: NotificationRuleCondition = {
  checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
  conditionType: ConditionType.Contains,
  value: "database",
};

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
  /*
   * "We have customers who think they need to add at least one condition,
   * but the idea is that if they don't add any condition, it matches all the
   * incidents. ... Can we please do this everywhere you have conditions?"
   */
  describe("what a rule is for: every record, or only those its conditions match", () => {
    test("the kinds of rule listed here are every kind there is", () => {
      expect(
        APPLIES_TO.map((entry: { eventType: NotificationRuleEventType }) => {
          return entry.eventType;
        }).sort(),
      ).toEqual([...Object.values(NotificationRuleEventType)].sort());
    });

    test.each(APPLIES_TO)(
      "a new $eventType rule starts on '$all', with no condition to fill in",
      (entry: {
        eventType: NotificationRuleEventType;
        heading: string;
        all: string;
        matching: string;
      }) => {
        const { onChange } = renderConditions(entry.eventType);

        const group: HTMLElement = screen.getByRole("radiogroup", {
          name: entry.heading,
        });
        expect(
          (screen.getByRole("radio", { name: entry.all }) as HTMLInputElement)
            .checked,
        ).toBe(true);
        expect(
          (
            screen.getByRole("radio", {
              name: entry.matching,
            }) as HTMLInputElement
          ).checked,
        ).toBe(false);
        expect(group.querySelectorAll("input[type='radio']").length).toBe(2);

        // Nothing waits to be filled in, and nothing is said twice.
        expect(screen.queryByRole("combobox")).toBeNull();
        expect(
          screen.queryByRole("button", { name: /Add Condition/i }),
        ).toBeNull();
        expect(screen.queryByText(/^No conditions:/)).toBeNull();
        expect(
          screen.queryByTestId("notification-rule-no-conditions-yet"),
        ).toBeNull();
        expect(lastConditionsFrom(onChange)).toEqual([]);
      },
    );

    test("'Only incidents that match conditions' opens one condition to fill in, and Add Condition under it", async () => {
      const { onChange } = renderConditions(NotificationRuleEventType.Incident);
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      await user.click(
        screen.getByRole("radio", {
          name: "Only incidents that match conditions",
        }),
      );

      const conditions: Array<NotificationRuleCondition> =
        lastConditionsFrom(onChange);
      expect(conditions).toHaveLength(1);
      expect(conditions[0]!.checkOn).toBe(
        NotificationRuleConditionUtil.getCheckOnByEventType(
          NotificationRuleEventType.Incident,
        )[0],
      );

      const panel: HTMLElement = screen.getByTestId(
        "notification-rule-applies-to-conditions",
      );
      expect(
        panel.querySelectorAll("[data-testid='notification-rule-conditions']")
          .length,
      ).toBe(1);
      expect(
        screen.getByRole("button", { name: /Add Condition/i }),
      ).toBeTruthy();
    });

    test("'All incidents' takes the conditions out, and 'Only ...' brings them back as they were", async () => {
      const { onChange } = renderSavedConditions(
        NotificationRuleEventType.Incident,
        [INCIDENT_TITLE_CONDITION],
      );
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      expect(
        (
          screen.getByRole("radio", {
            name: "Only incidents that match conditions",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);

      await user.click(screen.getByRole("radio", { name: "All incidents" }));
      expect(lastConditionsFrom(onChange)).toEqual([]);
      expect(screen.queryByRole("combobox")).toBeNull();

      await user.click(
        screen.getByRole("radio", {
          name: "Only incidents that match conditions",
        }),
      );
      expect(lastConditionsFrom(onChange)).toEqual([INCIDENT_TITLE_CONDITION]);
    });

    test("deleting the last condition is going back to 'All incidents'", async () => {
      const { onChange } = renderSavedConditions(
        NotificationRuleEventType.Incident,
        [INCIDENT_TITLE_CONDITION],
      );
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Delete Filter" }));

      expect(lastConditionsFrom(onChange)).toEqual([]);
      expect(
        (
          screen.getByRole("radio", {
            name: "All incidents",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
      /*
       * The Delete Filter button went with the conditions, and the focus
       * with it: it is on the answer now picked, not lost to the page.
       */
      expect(document.activeElement).toBe(
        screen.getByRole("radio", { name: "All incidents" }),
      );
    });
  });

  /*
   * The step as it reads: the question, its two answers, and - only once
   * there are conditions - when they are checked, the conditions, Add
   * Condition, and a divider over Match Condition when there is one.
   */
  describe("the step around the conditions", () => {
    const CHECKED_WHEN: string =
      "Conditions are checked when an incident is created and again each time it changes, so a rule for acknowledged incidents acts when an incident is acknowledged.";

    function renderWithDescription(
      conditions: Array<NotificationRuleCondition>,
    ): { container: HTMLElement } {
      const { container } = render(
        <NotificationRuleConditionsElement
          {...lookupProps()}
          eventType={NotificationRuleEventType.Incident}
          value={conditions}
          conditionsDescription={CHECKED_WHEN}
          onChange={(): void => {}}
        />,
      );

      return { container: container };
    }

    // The divider is the element's own last child, after the choice.
    function divider(container: HTMLElement): Element | null {
      const root: Element = container.firstElementChild as Element;
      const last: Element | null = root.lastElementChild;

      return last && last.className.split(/\s+/).includes("border-b")
        ? last
        : null;
    }

    test("when conditions are checked is said over them, and not over 'All incidents'", async () => {
      renderWithDescription([]);
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      expect(screen.queryByText(CHECKED_WHEN)).toBeNull();

      await user.click(
        screen.getByRole("radio", {
          name: "Only incidents that match conditions",
        }),
      );

      const line: HTMLElement = screen.getByText(CHECKED_WHEN);
      const panel: HTMLElement = screen.getByTestId(
        "notification-rule-applies-to-conditions",
      );
      expect(panel.firstElementChild).toBe(line);
      const radio: HTMLElement = screen.getByRole("radio", {
        name: "Only incidents that match conditions",
      });
      expect(radio.getAttribute("aria-describedby")).toBe(line.id);

      await user.click(screen.getByRole("radio", { name: "All incidents" }));
      expect(screen.queryByText(CHECKED_WHEN)).toBeNull();
    });

    test("a summary's conditions, given no such line, say none", async () => {
      renderConditions(NotificationRuleEventType.Incident);
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      await user.click(
        screen.getByRole("radio", {
          name: "Only incidents that match conditions",
        }),
      );

      expect(
        screen.queryByTestId(
          "notification-rule-applies-to-matching-description",
        ),
      ).toBeNull();
      expect(screen.queryByText(/^Conditions are checked when/)).toBeNull();
    });

    /*
     * The divider separates the conditions from Match Condition, the form's
     * next field, which only appears with two or more. Under "All incidents"
     * or one condition it closed off nothing: a line over empty space at the
     * bottom of the step.
     */
    test("the divider waits for Match Condition: none with fewer than two conditions", async () => {
      const { container } = renderWithDescription([]);
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      expect(divider(container)).toBeNull();

      await user.click(
        screen.getByRole("radio", {
          name: "Only incidents that match conditions",
        }),
      );
      expect(divider(container)).toBeNull();

      await user.click(screen.getByRole("button", { name: /Add Condition/i }));
      expect(divider(container)).not.toBeNull();

      await user.click(
        screen.getAllByRole("button", { name: "Delete Filter" })[1]!,
      );
      expect(divider(container)).toBeNull();
    });

    test("a saved rule with two conditions opens with its divider", () => {
      const { container } = renderWithDescription([
        INCIDENT_TITLE_CONDITION,
        {
          checkOn: NotificationRuleConditionCheckOn.IncidentDescription,
          conditionType: ConditionType.Contains,
          value: "timeout",
        },
      ]);

      expect(divider(container)).not.toBeNull();
    });

    /*
     * A Button is full width under md, and only from md up sits 12px in
     * (md:ml-3, for a dialog's footer). Taking those 12px back at every
     * width pushed the full-width button 12px out of line with the
     * conditions on a phone.
     */
    test("Add Condition lines up with the conditions at every width", async () => {
      renderConditions(NotificationRuleEventType.Incident);
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      await user.click(
        screen.getByRole("radio", {
          name: "Only incidents that match conditions",
        }),
      );

      const wrapper: HTMLElement = screen.getByTestId(
        "notification-rule-add-condition",
      ).parentElement as HTMLElement;
      const classes: Array<string> = wrapper.className.split(/\s+/);
      expect(classes).toContain("md:-ml-3");
      expect(classes).not.toContain("-ml-3");
    });
  });

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

/*
 * A security case rule's conditions (Security Events > Workspace > Slack or
 * Microsoft Teams): the case's title and description as text, its priority
 * and status as the project's own (Security Events > Settings), by id and in
 * the project's order, its source as the fixed scale every project shares,
 * and its labels as the project's own.
 */
describe("A security case rule's conditions", () => {
  const SECURITY_CASE_FIELDS: Array<NotificationRuleConditionCheckOn> = [
    NotificationRuleConditionCheckOn.SecurityCasePriority,
    NotificationRuleConditionCheckOn.SecurityCaseTitle,
    NotificationRuleConditionCheckOn.SecurityCaseDescription,
    NotificationRuleConditionCheckOn.SecurityCaseStatus,
    NotificationRuleConditionCheckOn.SecurityCaseSource,
    NotificationRuleConditionCheckOn.SecurityCaseLabels,
  ];

  // The options the open dropdown lists, in order.
  function listedOptions(): Array<string> {
    return Array.from(document.querySelectorAll("[id*='-option-']")).map(
      (option: Element): string => {
        return (option.textContent || "").trim();
      },
    );
  }

  test("the Filter Type lists the six fields of a case, and no other record's", async () => {
    renderConditions(NotificationRuleEventType.SecurityCase);

    await clickAddCondition();
    await openDropdown(0);

    expect(screen.queryByText(NO_OPTIONS)).toBeNull();
    expect(listedOptions()).toEqual(SECURITY_CASE_FIELDS);
    expect(
      screen.queryByText(NotificationRuleConditionCheckOn.IncidentTitle),
    ).toBeNull();
    expect(
      screen.queryByText(NotificationRuleConditionCheckOn.OnCallDutyPolicyName),
    ).toBeNull();
  });

  test("'Only security cases that match conditions' starts on the case's priority, as one of a list", async () => {
    const { onChange } = renderConditions(
      NotificationRuleEventType.SecurityCase,
    );

    await clickAddCondition();

    const conditions: Array<NotificationRuleCondition> =
      lastConditionsFrom(onChange);

    expect(conditions).toHaveLength(1);
    expect(conditions[0]!.checkOn).toBe(
      NotificationRuleConditionCheckOn.SecurityCasePriority,
    );
    expect(conditions[0]!.conditionType).toBe(ConditionType.ContainsAny);
  });

  test("priority offers the project's priorities, most urgent first, and records each by id", async () => {
    const { onChange } = renderConditions(
      NotificationRuleEventType.SecurityCase,
    );

    await clickAddCondition();
    await openDropdown(2);

    expect(listedOptions()).toEqual([
      "Emergency",
      "Critical",
      "High",
      "Medium",
      "Low",
      "Informational",
    ]);

    await userEvent.setup().click(screen.getByText("Emergency"));
    await pickFromDropdown({ index: 2, optionLabel: "Critical" });

    const conditions: Array<NotificationRuleCondition> =
      lastConditionsFrom(onChange);

    expect(conditions[0]!.checkOn).toBe(
      NotificationRuleConditionCheckOn.SecurityCasePriority,
    );
    expect(conditions[0]!.value).toEqual([
      EMERGENCY_PRIORITY_ID,
      TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    ]);
  });

  test("status offers the project's statuses, in the order a case moves through them, and records each by id", async () => {
    const { onChange } = renderConditions(
      NotificationRuleEventType.SecurityCase,
    );

    await clickAddCondition();
    await pickFromDropdown({
      index: 0,
      optionLabel: NotificationRuleConditionCheckOn.SecurityCaseStatus,
    });
    await pickFromDropdown({
      index: 1,
      optionLabel: ConditionType.ContainsAny,
    });
    await openDropdown(2);

    expect(listedOptions()).toEqual([
      "New",
      "Investigating",
      "Contained",
      "Eradicating",
      "Closed",
    ]);

    await userEvent.setup().click(screen.getByText("Eradicating"));

    const conditions: Array<NotificationRuleCondition> =
      lastConditionsFrom(onChange);

    expect(conditions[0]!.checkOn).toBe(
      NotificationRuleConditionCheckOn.SecurityCaseStatus,
    );
    expect(conditions[0]!.value).toEqual([ERADICATING_STATUS_ID]);
  });

  test.each([
    [
      NotificationRuleConditionCheckOn.SecurityCaseSource,
      [
        "Detection Rule",
        "Threat Intel",
        "Connected Product",
        "Manual",
        "Entity Risk",
        // A case a Data Security issue opened (DataSecurityIntegrations).
        "Data Security",
      ],
    ],
  ])(
    "%s offers its own fixed list",
    async (checkOn: string, expected: Array<string>) => {
      renderConditions(NotificationRuleEventType.SecurityCase);

      await clickAddCondition();
      await pickFromDropdown({ index: 0, optionLabel: checkOn });
      await pickFromDropdown({
        index: 1,
        optionLabel: ConditionType.ContainsAny,
      });
      await openDropdown(2);

      expect(listedOptions()).toEqual(expected);
    },
  );

  test("labels offer the project's labels, and record the one chosen by id", async () => {
    const { onChange } = renderConditions(
      NotificationRuleEventType.SecurityCase,
    );

    await clickAddCondition();
    await pickFromDropdown({
      index: 0,
      optionLabel: NotificationRuleConditionCheckOn.SecurityCaseLabels,
    });
    await pickFromDropdown({
      index: 1,
      optionLabel: ConditionType.ContainsAny,
    });
    await openDropdown(2);

    expect(listedOptions()).toEqual(["Payments", "Search"]);

    await userEvent.setup().click(screen.getByText("Payments"));

    const conditions: Array<NotificationRuleCondition> =
      lastConditionsFrom(onChange);

    expect(conditions[0]!.checkOn).toBe(
      NotificationRuleConditionCheckOn.SecurityCaseLabels,
    );
    expect(conditions[0]!.value).toEqual([PAYMENTS_LABEL_ID]);
  });

  test("the title is compared as text, written in a box", async () => {
    const { onChange } = renderConditions(
      NotificationRuleEventType.SecurityCase,
    );

    await clickAddCondition();
    await pickFromDropdown({
      index: 0,
      optionLabel: NotificationRuleConditionCheckOn.SecurityCaseTitle,
    });
    await openDropdown(1);

    expect(listedOptions()).toEqual(
      NotificationRuleConditionUtil.getConditionTypeByCheckOn(
        NotificationRuleConditionCheckOn.SecurityCaseTitle,
      ),
    );

    await userEvent.setup().click(screen.getByText(ConditionType.Contains));
    await userEvent.setup().type(screen.getByRole("textbox"), "ransomware");

    const conditions: Array<NotificationRuleCondition> =
      lastConditionsFrom(onChange);

    expect(conditions[0]).toEqual({
      checkOn: NotificationRuleConditionCheckOn.SecurityCaseTitle,
      conditionType: ConditionType.Contains,
      value: "ransomware",
    });
  });
});

describe("A saved security case condition, on the rule's card", () => {
  function renderView(condition: NotificationRuleCondition): void {
    render(
      <NotificationRuleViewConditionElement
        {...lookupProps()}
        notificationRuleCondition={condition}
      />,
    );
  }

  test("names the case's labels, not their ids", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.SecurityCaseLabels,
      conditionType: ConditionType.ContainsAny,
      value: [PAYMENTS_LABEL_ID, SEARCH_LABEL_ID],
    });

    expect(screen.getAllByText("Payments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Search").length).toBeGreaterThan(0);
    expect(screen.queryByText(PAYMENTS_LABEL_ID)).toBeNull();
    expect(
      screen.queryByText(new RegExp(PAYMENTS_LABEL_ID)),
    ).not.toBeInTheDocument();
  });

  test.each([
    [
      NotificationRuleConditionCheckOn.SecurityCasePriority,
      [
        EMERGENCY_PRIORITY_ID,
        TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
      ],
      ["Emergency", "High"],
    ],
    [
      NotificationRuleConditionCheckOn.SecurityCaseStatus,
      [TEST_STATUS_IDS[SecurityCaseStage.New], ERADICATING_STATUS_ID],
      ["New", "Eradicating"],
    ],
  ])(
    "draws each %s as its own pill, named as the project names it",
    (
      checkOn: NotificationRuleConditionCheckOn,
      ids: Array<string>,
      names: Array<string>,
    ) => {
      renderView({
        checkOn: checkOn,
        conditionType: ConditionType.ContainsAny,
        value: ids,
      });

      for (const name of names) {
        expect(screen.getByText(name)).toBeInTheDocument();
      }

      // Never the ids, and one pill each, never the names run together.
      for (const id of ids) {
        expect(screen.queryByText(new RegExp(id))).toBeNull();
      }

      expect(screen.queryByText(names.join(", "))).toBeNull();
    },
  );

  test("leaves out a priority the project no longer has", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
      conditionType: ConditionType.ContainsAny,
      value: [
        "c1000000-0000-4000-8000-0000000000ff",
        TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low],
      ],
    });

    expect(screen.getByText("Low")).toBeInTheDocument();
    expect(
      screen.queryByText(/c1000000-0000-4000-8000-0000000000ff/),
    ).toBeNull();
  });

  test("names the sources it is for, as words", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.SecurityCaseSource,
      conditionType: ConditionType.NotContains,
      value: ["Threat Intel", "Manual"],
    });

    expect(screen.getByText("Threat Intel, Manual")).toBeInTheDocument();
  });

  test("survives a priority condition saved without a value", () => {
    renderView({
      checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
      conditionType: ConditionType.ContainsAny,
      value: undefined,
    });

    expect(
      screen.getAllByText(NotificationRuleConditionCheckOn.SecurityCasePriority)
        .length,
    ).toBeGreaterThan(0);
  });
});
