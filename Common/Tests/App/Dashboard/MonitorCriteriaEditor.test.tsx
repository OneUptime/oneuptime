import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MonitorCriteriaElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteria";
import { ComponentProps as InstanceProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * The parent list owns selection, identity and ordering. Action/condition editors
 * have their own real-component suites; this small editor isolates list behavior.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaInstance",
  () => {
    return {
      __esModule: true,
      default: (props: InstanceProps): ReactElement => {
        return (
          <div data-testid="rule-editor">
            <input
              aria-label="Rule name"
              value={props.value?.data?.name || ""}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                const instance: MonitorCriteriaInstance =
                  new MonitorCriteriaInstance();
                instance.data = {
                  ...props.value!.data!,
                  name: event.target.value,
                };
                props.onChange?.(instance);
              }}
            />
            <button type="button" onClick={props.onDelete}>
              Delete rule
            </button>
          </div>
        );
      },
    };
  },
);

const STATUS_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_OPTIONS: Array<DropdownOption> = [
  { value: STATUS_ID.toString(), label: "Degraded" },
];

function makeRule(
  name: string,
  overrides: Partial<NonNullable<MonitorCriteriaInstance["data"]>> = {},
): MonitorCriteriaInstance {
  const rule: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  rule.data = {
    ...rule.data!,
    name,
    description: `${name} description`,
    changeMonitorStatus: true,
    monitorStatusId: STATUS_ID,
    ...overrides,
  };
  return rule;
}

function renderEditor(
  rules: Array<MonitorCriteriaInstance>,
  monitorType: MonitorType = MonitorType.Website,
): { latest: () => MonitorCriteria; changes: () => number } {
  const initial: MonitorCriteria = new MonitorCriteria();
  initial.data!.monitorCriteriaInstanceArray = rules;
  let latest: MonitorCriteria = initial;
  let changes: number = 0;
  function Harness(): ReactElement {
    const [value, setValue] = React.useState<MonitorCriteria>(initial);
    return (
      <MonitorCriteriaElement
        value={value}
        monitorType={monitorType}
        monitorStep={new MonitorStep()}
        monitorStatusDropdownOptions={STATUS_OPTIONS}
        incidentSeverityDropdownOptions={[]}
        alertSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        teamDropdownOptions={[]}
        userDropdownOptions={[]}
        offlineMonitorStatusId={STATUS_ID}
        onChange={(next: MonitorCriteria) => {
          latest = next;
          changes++;
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return {
    latest: () => {
      return latest;
    },
    changes: () => {
      return changes;
    },
  };
}

afterEach(cleanup);

describe("Monitor rule editor", () => {
  test("opens on readable summaries without mounted or tabbable editor fields", () => {
    const harness: ReturnType<typeof renderEditor> = renderEditor([
      makeRule("Site down"),
      makeRule("Site recovered", { isEnabled: false }),
    ]);
    expect(screen.queryByLabelText("Rule name")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Edit rule: Site down" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.getAllByText("Set status to Degraded")).toHaveLength(2);
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(harness.changes()).toBe(0);
  });

  test("keyboard opening and closing expose exactly one editor", async () => {
    renderEditor([makeRule("First"), makeRule("Second")]);
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    screen.getByRole("button", { name: "Edit rule: First" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByLabelText("Rule name")).toHaveLength(1);
    expect((screen.getByLabelText("Rule name") as HTMLInputElement).value).toBe(
      "First",
    );
    await user.click(screen.getByRole("button", { name: "Edit rule: Second" }));
    expect(screen.getAllByLabelText("Rule name")).toHaveLength(1);
    expect((screen.getByLabelText("Rule name") as HTMLInputElement).value).toBe(
      "Second",
    );
    await user.click(
      screen.getByRole("button", { name: "Close rule: Second" }),
    );
    expect(screen.queryByLabelText("Rule name")).toBeNull();
  });

  test("editing a name preserves editor identity and updates its summary", () => {
    const first: MonitorCriteriaInstance = makeRule("First");
    const second: MonitorCriteriaInstance = makeRule("Second");
    const harness: ReturnType<typeof renderEditor> = renderEditor([
      first,
      second,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Edit rule: First" }));
    fireEvent.change(screen.getByLabelText("Rule name"), {
      target: { value: "Slow response" },
    });
    expect(
      screen.getByRole("button", { name: "Close rule: Slow response" }),
    ).toBeTruthy();
    expect(
      harness.latest().data!.monitorCriteriaInstanceArray[0]!.data!.id,
    ).toBe(first.data!.id);
    expect(
      harness.latest().data!.monitorCriteriaInstanceArray[1]!.toJSON(),
    ).toEqual(second.toJSON());
  });

  test("reorder buttons are keyboard usable, preserve rule data, and announce position", async () => {
    const first: MonitorCriteriaInstance = makeRule("First", {
      isEnabled: false,
      filters: [
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 200,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 10,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        },
      ],
    });
    const second: MonitorCriteriaInstance = makeRule("Second");
    const third: MonitorCriteriaInstance = makeRule("Third");
    const before: unknown = first.toJSON();
    const harness: ReturnType<typeof renderEditor> = renderEditor([
      first,
      second,
      third,
    ]);
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit rule: First" }));
    screen.getByRole("button", { name: "Move rule down: First" }).focus();
    await user.keyboard("{Enter}");
    expect(
      harness
        .latest()
        .data!.monitorCriteriaInstanceArray.map(
          (rule: MonitorCriteriaInstance) => {
            return rule.data!.name;
          },
        ),
    ).toEqual(["Second", "First", "Third"]);
    expect(
      harness.latest().data!.monitorCriteriaInstanceArray[1]!.toJSON(),
    ).toEqual(before);
    expect(screen.getByRole("status").textContent).toContain(
      "First moved to position 2 of 3",
    );
    expect(
      screen.getByRole("button", { name: "Close rule: First" }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole("button", { name: "Move rule up: First" }),
    );
    expect(
      harness.latest().data!.monitorCriteriaInstanceArray[0]!.data!.id,
    ).toBe(first.data!.id);
  });

  test("boundary controls cannot remove a rule or wrap the order", () => {
    const harness: ReturnType<typeof renderEditor> = renderEditor([
      makeRule("First"),
      makeRule("Last"),
    ]);
    expect(
      (
        screen.getByRole("button", {
          name: "Move rule up: First",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Move rule down: Last",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Move rule up: First" }),
    );
    expect(harness.changes()).toBe(0);
  });

  test("deletion removes the selected rule only, including when names repeat", () => {
    const first: MonitorCriteriaInstance = makeRule("Same name");
    const second: MonitorCriteriaInstance = makeRule("Same name");
    const harness: ReturnType<typeof renderEditor> = renderEditor([
      first,
      second,
    ]);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit rule: Same name" })[1]!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete rule" }));
    expect(harness.latest().data!.monitorCriteriaInstanceArray).toHaveLength(1);
    expect(
      harness.latest().data!.monitorCriteriaInstanceArray[0]!.data!.id,
    ).toBe(first.data!.id);
    expect(screen.queryByLabelText("Rule name")).toBeNull();
  });

  test("keeps the last rule and explains how to disable it", () => {
    const harness: ReturnType<typeof renderEditor> = renderEditor([
      makeRule("Only rule"),
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit rule: Only rule" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete rule" }));
    expect(screen.getByText("Keep one rule")).toBeTruthy();
    expect(harness.changes()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Keep one rule")).toBeNull();
    expect(screen.getByLabelText("Rule name")).toBeTruthy();
  });

  test.each([
    MonitorType.Website,
    MonitorType.ExternalStatusPage,
    MonitorType.Metrics,
    MonitorType.Kubernetes,
    MonitorType.IncomingRequest,
    MonitorType.DNS,
    MonitorType.NetworkDevice,
    MonitorType.SQLQuery,
    MonitorType.Logs,
    MonitorType.SecurityEvents,
  ])(
    "adding a %s rule opens it with compatible defaults without changing existing rules",
    (monitorType: MonitorType) => {
      const first: MonitorCriteriaInstance = makeRule("Existing");
      const before: unknown = first.toJSON();
      const harness: ReturnType<typeof renderEditor> = renderEditor(
        [first],
        monitorType,
      );
      fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
      const saved: Array<MonitorCriteriaInstance> =
        harness.latest().data!.monitorCriteriaInstanceArray;
      expect(saved).toHaveLength(2);
      expect(saved[0]!.toJSON()).toEqual(before);
      expect(saved[1]!.data!.id).not.toBe(first.data!.id);
      expect(saved[1]!.data!.name).toBe("New rule");
      expect(saved[1]!.data!.filters).toEqual([
        CriteriaFilterUtil.getDefaultCriteriaFilter(monitorType),
      ]);
      expect(
        screen.getByRole("button", { name: "Close rule: New rule" }),
      ).toBeTruthy();
      expect(
        (screen.getByLabelText("Rule name") as HTMLInputElement).value,
      ).toBe("New rule");
    },
  );

  test("summarizes matching logic and action flags without claiming stale settings run", () => {
    renderEditor([
      makeRule("Any condition", {
        filterCondition: FilterCondition.Any,
        filters: [
          {
            checkOn: CheckOn.ResponseStatusCode,
            filterType: FilterType.EqualTo,
            value: 503,
          },
          {
            checkOn: CheckOn.ResponseTime,
            filterType: FilterType.GreaterThan,
            value: 2000,
          },
          { checkOn: CheckOn.IsOnline, filterType: FilterType.False },
        ],
        changeMonitorStatus: false,
        createAlerts: true,
        createIncidents: true,
      }),
    ]);
    const text: string =
      screen.getByRole("button", { name: "Edit rule: Any condition" })
        .textContent || "";
    expect(text).toContain("503");
    expect(text).toContain(" or ");
    expect(text).toContain("2000ms");
    expect(text).toContain("+1 more");
    expect(text).toContain("Create an alert · Declare an incident");
    expect(text).not.toContain("Set status");
  });

  test("shows missing actions and status configuration honestly", () => {
    renderEditor([
      makeRule("Missing status", { monitorStatusId: undefined }),
      makeRule("No actions", { changeMonitorStatus: false }),
    ]);
    expect(screen.getByText("Choose a monitor status")).toBeTruthy();
    expect(screen.getByText("No actions selected")).toBeTruthy();
  });

  test("recommended network alerts append with the supplied offline status", () => {
    const harness: ReturnType<typeof renderEditor> = renderEditor(
      [makeRule("Existing")],
      MonitorType.NetworkDevice,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add recommended alerts" }),
    );
    const added: Array<MonitorCriteriaInstance> = harness
      .latest()
      .data!.monitorCriteriaInstanceArray.slice(1);
    expect(added.length).toBeGreaterThan(1);
    for (const rule of added) {
      if (rule.data!.changeMonitorStatus) {
        expect(rule.data!.monitorStatusId?.toString()).toBe(
          STATUS_ID.toString(),
        );
      }
    }
    expect(screen.queryByLabelText("Rule name")).toBeNull();
  });
});
