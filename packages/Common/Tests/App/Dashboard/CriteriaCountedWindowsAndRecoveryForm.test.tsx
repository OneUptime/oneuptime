import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import CriteriaRecoveryAndActiveHours, {
  ACTIVE_HOURS_SECTION_TEST_ID,
  RECOVERY_SECTION_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaRecoveryAndActiveHours";
import MonitorCriteriaInstanceView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorCriteriaInstance";
import { WORKING_HOURS_PICKER_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallRule/WorkingHoursPicker";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";

/*
 * The criteria editor's side of #10355, on the real components held in a
 * little stateful parent: a count of the window's checks and a percentile
 * under the over-time box, a criteria's recovery condition and active hours
 * under its Settings, and both read back in the criteria list. Assertions
 * stay on plain DOM: jest-dom's matchers do not typecheck repo-wide.
 */

const OVER_TIME_OPTIONS: string = "criteria-filter-over-time-options";
const COUNT_ROW: string = "criteria-filter-over-time-count";
const PERCENTILE_ROW: string = "criteria-filter-over-time-percentile";
const SENTENCE: string = "criteria-filter-over-time-sentence";

afterEach(() => {
  cleanup();
});

interface Emitted<T> {
  emitted: Array<T>;
}

function renderFilter(
  initial: CriteriaFilter,
  monitorType: MonitorType = MonitorType.Ping,
): Emitted<CriteriaFilter> {
  const emitted: Array<CriteriaFilter> = [];

  const Parent: React.FunctionComponent = (): React.ReactElement => {
    const [criteriaFilter, setCriteriaFilter] =
      React.useState<CriteriaFilter>(initial);

    return (
      <CriteriaFilterElement
        monitorType={monitorType}
        monitorStep={new MonitorStep()}
        value={criteriaFilter}
        onChange={(value: CriteriaFilter) => {
          emitted.push(value);
          setCriteriaFilter(value);
        }}
      />
    );
  };

  render(<Parent />);

  return { emitted: emitted };
}

function last<T>(rendered: Emitted<T>): T {
  expect(rendered.emitted.length).toBeGreaterThan(0);
  return rendered.emitted[rendered.emitted.length - 1]!;
}

// Opens a dropdown under the over-time box and picks the option by its name.
async function pick(
  combobox: HTMLElement,
  optionName: string,
): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  await user.click(combobox);

  const option: HTMLElement | undefined = screen
    .getAllByRole("option")
    .find((candidate: HTMLElement): boolean => {
      const description: string =
        within(candidate).queryByTestId("dropdown-option-description")
          ?.textContent || "";

      return (
        (candidate.textContent || "").replace(description, "") === optionName
      );
    });

  expect(option).toBeDefined();
  await user.click(option!);
}

function overTimeCombobox(name: string): HTMLElement {
  return within(screen.getByTestId(OVER_TIME_OPTIONS)).getByRole("combobox", {
    name: name,
  });
}

const OFFLINE_OVER_AN_HOUR: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 60,
    evaluateOverTimeType: EvaluateOverTimeType.AllValues,
  },
};

const SLOW_OVER_TEN_MINUTES: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 300,
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 10,
    evaluateOverTimeType: EvaluateOverTimeType.Average,
  },
};

describe("a window that counts its checks", () => {
  test("picking Count shows its number, named by the row, and the sentence says it", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter(OFFLINE_OVER_AN_HOUR);

    expect(screen.queryByTestId(COUNT_ROW)).toBeNull();

    await pick(overTimeCombobox("Evaluate"), "Count");

    expect(last(rendered).evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 60,
      evaluateOverTimeType: EvaluateOverTimeType.Count,
      countFilterType: FilterType.GreaterThan,
      countValue: 0,
    });

    const row: HTMLElement = screen.getByTestId(COUNT_ROW);

    // The row's comparison and number, apart from the filter's own condition.
    expect(
      within(row).getByRole("combobox", { name: "Checks That Match" }),
    ).toBeTruthy();
    expect(
      within(row).getByRole("spinbutton", { name: "Checks That Match" }),
    ).toBeTruthy();
    expect(row.textContent).toContain("checks");
    expect(screen.getAllByRole("combobox", { name: "Filter Condition" }).length).toBe(1);
  });

  test("typing the number and picking its comparison change the count, and the sentence follows", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter({
      ...OFFLINE_OVER_AN_HOUR,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 480,
        evaluateOverTimeType: EvaluateOverTimeType.Count,
        countFilterType: FilterType.GreaterThan,
        countValue: 0,
      },
    });
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const row: HTMLElement = screen.getByTestId(COUNT_ROW);
    const number: HTMLElement = within(row).getByRole("spinbutton", {
      name: "Checks That Match",
    });

    await user.clear(number);
    await user.type(number, "30");

    expect(last(rendered).evaluateOverTimeOptions?.countValue).toBe(30);
    expect(screen.getByTestId(SENTENCE).textContent).toContain(
      "on more than 30 checks in the past 8 hours",
    );

    await pick(
      within(row).getByRole("combobox", { name: "Checks That Match" }),
      "Greater Than Or Equal To",
    );

    expect(last(rendered).evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 480,
      evaluateOverTimeType: EvaluateOverTimeType.Count,
      countFilterType: FilterType.GreaterThanOrEqualTo,
      countValue: 30,
    });
    expect(screen.getByTestId(SENTENCE).textContent).toContain(
      "at least 30 checks",
    );
  });

  test("Status Changes counts times, and the sentence says how often the check changed", async () => {
    renderFilter({
      ...OFFLINE_OVER_AN_HOUR,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 60,
        evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
        countFilterType: FilterType.GreaterThan,
        countValue: 5,
      },
    });

    const row: HTMLElement = screen.getByTestId(COUNT_ROW);

    expect(
      within(row).getByRole("spinbutton", { name: "Times It Changed" }),
    ).toBeTruthy();
    expect(row.textContent).toContain("times");
    expect(screen.getByTestId(SENTENCE).textContent).toBe(
      'Check if "Is Online" changed more than 5 times in the past 1 hour',
    );
  });

  test("an emptied number counts from 0, never from no number", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter({
      ...OFFLINE_OVER_AN_HOUR,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 60,
        evaluateOverTimeType: EvaluateOverTimeType.Percentage,
        countFilterType: FilterType.GreaterThan,
        countValue: 10,
      },
    });

    await userEvent
      .setup()
      .clear(
        within(screen.getByTestId(COUNT_ROW)).getByRole("spinbutton", {
          name: "Share of Checks That Match",
        }),
      );

    expect(last(rendered).evaluateOverTimeOptions?.countValue).toBe(0);
  });

  test("For the last offers whole hours up to a day, saved as minutes", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter(OFFLINE_OVER_AN_HOUR);

    await pick(overTimeCombobox("For the last"), "8 Hours");

    expect(last(rendered).evaluateOverTimeOptions?.timeValueInMinutes).toBe(
      480,
    );
  });
});

describe("a percentile", () => {
  test("picking Percentile starts at p95, and p99 is saved as 99", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter(
      SLOW_OVER_TEN_MINUTES,
    );

    await pick(overTimeCombobox("Evaluate"), "Percentile");

    expect(last(rendered).evaluateOverTimeOptions?.percentile).toBe(95);
    expect(screen.queryByTestId(COUNT_ROW)).toBeNull();

    const row: HTMLElement = screen.getByTestId(PERCENTILE_ROW);

    await pick(within(row).getByRole("combobox", { name: "Percentile" }), "p99");

    expect(last(rendered).evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.Percentile,
      percentile: 99,
    });
    expect(screen.getByTestId(SENTENCE).textContent).toBe(
      'Check if p99 of "Response Time (in ms)" in the past 10 minutes is greater than 300 ms',
    );
  });

  test("a check-by-check filter is offered no percentile", async () => {
    renderFilter({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "error",
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    }, MonitorType.Website);

    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.click(overTimeCombobox("Evaluate"));

    expect(
      screen
        .getAllByRole("option")
        .some((option: HTMLElement): boolean => {
          return (option.textContent || "").startsWith("Percentile");
        }),
    ).toBe(false);
  });
});

function criteriaWith(
  data: Partial<NonNullable<MonitorCriteriaInstance["data"]>>,
): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  instance.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 60,
          evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
          countFilterType: FilterType.GreaterThan,
          countValue: 5,
        },
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: "Access point is unstable",
    description: "",
    ...data,
  };

  return instance;
}

function renderSettings(
  initial: MonitorCriteriaInstance,
): Emitted<MonitorCriteriaInstance> {
  const emitted: Array<MonitorCriteriaInstance> = [];

  const Parent: React.FunctionComponent = (): React.ReactElement => {
    const [criteria, setCriteria] =
      React.useState<MonitorCriteriaInstance>(initial);

    return (
      <CriteriaRecoveryAndActiveHours
        criteriaInstance={criteria}
        monitorType={MonitorType.Ping}
        monitorStep={new MonitorStep()}
        onChange={(value: MonitorCriteriaInstance) => {
          emitted.push(value);
          setCriteria(value);
        }}
      />
    );
  };

  render(<Parent />);

  return { emitted: emitted };
}

function switchIn(sectionTestId: string): HTMLElement {
  return within(screen.getByTestId(sectionTestId)).getByRole("switch");
}

describe("when a criteria recovers", () => {
  test("is off for a new criteria, with nothing under it", () => {
    renderSettings(criteriaWith({}));

    expect(switchIn(RECOVERY_SECTION_TEST_ID).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(
      screen.getByTestId(RECOVERY_SECTION_TEST_ID).textContent,
    ).not.toContain("Recover When");
  });

  test("turned on, it starts as the opposite of the criteria's filters over the last 10 minutes", async () => {
    const rendered: Emitted<MonitorCriteriaInstance> = renderSettings(
      criteriaWith({}),
    );

    await userEvent.setup().click(switchIn(RECOVERY_SECTION_TEST_ID));

    expect(last(rendered).data?.recoveryFilterCondition).toBe(
      FilterCondition.All,
    );
    expect(last(rendered).data?.recoveryFilters).toEqual([
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
      },
    ]);
    // The criteria's own filters stay as they were.
    expect(last(rendered).data?.filters?.[0]?.filterType).toBe(
      FilterType.False,
    );
    expect(screen.getByTestId(RECOVERY_SECTION_TEST_ID).textContent).toContain(
      "Recover When",
    );
  });

  test("turned off, it drops the recovery condition", async () => {
    const rendered: Emitted<MonitorCriteriaInstance> = renderSettings(
      criteriaWith({
        recoveryFilters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
          },
        ],
        recoveryFilterCondition: FilterCondition.All,
      }),
    );

    expect(switchIn(RECOVERY_SECTION_TEST_ID).getAttribute("aria-checked")).toBe(
      "true",
    );

    await userEvent.setup().click(switchIn(RECOVERY_SECTION_TEST_ID));

    expect(last(rendered).data?.recoveryFilters).toBeUndefined();
    expect(last(rendered).data?.recoveryFilterCondition).toBeUndefined();
    expect(MonitorCriteriaInstance.hasRecoveryCondition(last(rendered).data)).toBe(
      false,
    );
  });
});

describe("when a criteria is judged", () => {
  test("turned on, it starts on weekdays in the reader's time zone", async () => {
    const rendered: Emitted<MonitorCriteriaInstance> = renderSettings(
      criteriaWith({}),
    );

    expect(screen.queryByTestId(WORKING_HOURS_PICKER_TEST_ID)).toBeNull();

    await userEvent.setup().click(switchIn(ACTIVE_HOURS_SECTION_TEST_ID));

    const timezone: string = OneUptimeDate.getCurrentTimezone().toString();
    const data: MonitorCriteriaInstance["data"] = last(rendered).data;

    expect(data?.activeHoursTimezone).toBe(timezone);
    expect(MonitorCriteriaInstance.hasActiveHours(data)).toBe(true);
    expect(MonitorCriteriaInstance.getActiveHoursError(data)).toBeNull();
    expect(
      WorkingHours.toSimpleHours({
        hours: data?.activeHours,
        timezone: timezone,
      })?.days,
    ).toEqual([0, 1, 2, 3, 4]);
    expect(screen.getByTestId(WORKING_HOURS_PICKER_TEST_ID)).toBeTruthy();
  });

  test("a new time zone keeps the hours on the clock", async () => {
    const oslo: string = "Europe/Oslo";
    const rendered: Emitted<MonitorCriteriaInstance> = renderSettings(
      criteriaWith({
        activeHours: WorkingHours.fromSimpleHours({
          days: [0, 1, 2, 3, 4],
          from: "08:00",
          to: "18:00",
          timezone: oslo,
        }).toJSON(),
        activeHoursTimezone: oslo,
      }),
    );
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const zone: HTMLElement = within(
      screen.getByTestId(ACTIVE_HOURS_SECTION_TEST_ID),
    ).getByRole("combobox", { name: "Timezone" });

    await user.click(zone);
    await user.type(zone, "New_York");
    await user.keyboard("{Enter}");

    const data: MonitorCriteriaInstance["data"] = last(rendered).data;

    expect(data?.activeHoursTimezone).toBe("America/New_York");
    expect(
      WorkingHours.toSimpleHours({
        hours: data?.activeHours,
        timezone: "America/New_York",
      }),
    ).toEqual({ days: [0, 1, 2, 3, 4], from: "08:00", to: "18:00" });
  });

  test("turned off, it drops the hours and their time zone", async () => {
    const rendered: Emitted<MonitorCriteriaInstance> = renderSettings(
      criteriaWith({
        activeHours: WorkingHours.fromSimpleHours({
          days: [0, 1, 2, 3, 4],
          from: "08:00",
          to: "18:00",
          timezone: "UTC",
        }).toJSON(),
        activeHoursTimezone: "UTC",
      }),
    );

    await userEvent.setup().click(switchIn(ACTIVE_HOURS_SECTION_TEST_ID));

    expect(last(rendered).data?.activeHours).toBeUndefined();
    expect(last(rendered).data?.activeHoursTimezone).toBeUndefined();
  });
});

describe("the criteria list", () => {
  function renderView(instance: MonitorCriteriaInstance): void {
    render(
      <MonitorCriteriaInstanceView
        monitorStatusOptions={[]}
        incidentSeverityOptions={[]}
        alertSeverityOptions={[]}
        isLastCriteria={true}
        monitorCriteriaInstance={instance}
        onCallPolicyOptions={[]}
        labelOptions={[]}
        teamOptions={[]}
        userOptions={[]}
        incidentRoleOptions={[]}
        monitorType={MonitorType.Ping}
      />,
    );
  }

  test("says when a criteria recovers, and its recovery filters as its filters are said", () => {
    renderView(
      criteriaWith({
        recoveryFilters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.False,
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 60,
              evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
              countFilterType: FilterType.LessThanOrEqualTo,
              countValue: 1,
            },
          },
        ],
        recoveryFilterCondition: FilterCondition.All,
      }),
    );

    const recovery: HTMLElement = screen.getByTestId(
      "monitor-criteria-recovery-heading",
    );

    expect(recovery.textContent).toContain(
      "Recover When Once its filters stop matching, this criteria stays in effect until all of these match:",
    );
    expect(recovery.textContent).toContain(
      'Check if "Is Online" changed at most 1 time in the past 1 hour',
    );
  });

  test("says the days and times a criteria is judged in, with their time zone", () => {
    renderView(
      criteriaWith({
        activeHours: WorkingHours.fromSimpleHours({
          days: [0, 1, 2, 3, 4],
          from: "08:00",
          to: "18:00",
          timezone: "Europe/Oslo",
        }).toJSON(),
        activeHoursTimezone: "Europe/Oslo",
      }),
    );

    const line: string =
      screen.getByTestId("monitor-criteria-active-hours-line").textContent ||
      "";

    expect(line.startsWith("Active Hours ")).toBe(true);
    expect(line).toContain("Europe/Oslo");
  });

  test("says neither for a criteria without them", () => {
    renderView(criteriaWith({}));

    expect(screen.queryByTestId("monitor-criteria-recovery-heading")).toBeNull();
    expect(
      screen.queryByTestId("monitor-criteria-active-hours-line"),
    ).toBeNull();
  });
});
