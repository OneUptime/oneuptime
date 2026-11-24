import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  PreviousCheckChangeType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";

/*
 * The criteria editor's side of #10821, on the real component held in a
 * little stateful parent: Previous Check under the over-time box, the
 * change a measured value takes and the value it no longer needs, a yes or
 * no check that takes neither, and the sentence that reads it back:
 * "... is more than 50% above the previous check". Assertions stay on plain
 * DOM: jest-dom's matchers do not typecheck repo-wide.
 */

const OVER_TIME_OPTIONS: string = "criteria-filter-over-time-options";
const CHANGE_ROW: string = "criteria-filter-over-time-previous-check-change";
const SENTENCE: string = "criteria-filter-over-time-sentence";
const CHANGE_TITLE: string = "Change From the Previous Check";

afterEach(() => {
  cleanup();
});

interface Emitted<T> {
  emitted: Array<T>;
}

function renderFilter(
  initial: CriteriaFilter,
  monitorType: MonitorType = MonitorType.Website,
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

// Opens a dropdown and picks the option by its name.
async function pick(combobox: HTMLElement, optionName: string): Promise<void> {
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

function sentence(): string {
  return screen.getByTestId(SENTENCE).textContent || "";
}

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

const SLOWER_THAN_THE_LAST_CHECK: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 300,
  evaluateOverTime: true,
  evaluateOverTimeOptions: {
    timeValueInMinutes: 10,
    evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
    changeType: PreviousCheckChangeType.Percentage,
    changeValue: 50,
  },
};

describe("a measured value compared with the previous check", () => {
  test("picking Previous Check starts at more than 50% above it, and the value goes", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter(
      SLOW_OVER_TEN_MINUTES,
    );

    // The threshold the average is compared with, until then.
    expect(screen.getByRole("textbox", { name: "Value" })).toBeTruthy();
    expect(screen.queryByTestId(CHANGE_ROW)).toBeNull();

    await pick(overTimeCombobox("Evaluate"), "Previous Check");

    expect(last(rendered).evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      changeType: PreviousCheckChangeType.Percentage,
      changeValue: 50,
    });

    // Its threshold comes from the previous check now.
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();

    const row: HTMLElement = screen.getByTestId(CHANGE_ROW);

    expect(
      (
        within(row).getByRole("spinbutton", {
          name: CHANGE_TITLE,
        }) as HTMLInputElement
      ).value,
    ).toBe("50");
    expect(
      within(row).getByRole("combobox", { name: CHANGE_TITLE }),
    ).toBeTruthy();
    expect(sentence()).toBe(
      'Check if "Response Time (in ms)" is more than 50% above the previous check',
    );
  });

  test("typing the change and picking Amount change the threshold, and the sentence follows", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter(
      SLOWER_THAN_THE_LAST_CHECK,
    );
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    const row: HTMLElement = screen.getByTestId(CHANGE_ROW);
    const number: HTMLElement = within(row).getByRole("spinbutton", {
      name: CHANGE_TITLE,
    });

    await user.clear(number);
    await user.type(number, "200");

    expect(last(rendered).evaluateOverTimeOptions?.changeValue).toBe(200);
    expect(sentence()).toBe(
      'Check if "Response Time (in ms)" is more than 200% above the previous check',
    );

    await pick(
      within(row).getByRole("combobox", { name: CHANGE_TITLE }),
      "Amount in the check's own unit",
    );

    expect(last(rendered).evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
      changeType: PreviousCheckChangeType.Amount,
      changeValue: 200,
    });
    expect(sentence()).toBe(
      'Check if "Response Time (in ms)" is more than 200 ms above the previous check',
    );
  });

  test("an emptied change is read as 0: any rise", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter(
      SLOWER_THAN_THE_LAST_CHECK,
    );
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    await user.clear(
      within(screen.getByTestId(CHANGE_ROW)).getByRole("spinbutton", {
        name: CHANGE_TITLE,
      }),
    );

    expect(last(rendered).evaluateOverTimeOptions?.changeValue).toBe(0);
    expect(sentence()).toBe(
      'Check if "Response Time (in ms)" is above the previous check',
    );
  });

  test("Less Than reads below; Not Equal To takes no change", async () => {
    renderFilter({
      ...SLOWER_THAN_THE_LAST_CHECK,
      filterType: FilterType.LessThan,
    });

    expect(sentence()).toBe(
      'Check if "Response Time (in ms)" is more than 50% below the previous check',
    );

    cleanup();

    renderFilter({
      ...SLOWER_THAN_THE_LAST_CHECK,
      checkOn: CheckOn.ResponseStatusCode,
      filterType: FilterType.NotEqualTo,
    });

    expect(screen.queryByTestId(CHANGE_ROW)).toBeNull();
    expect(sentence()).toBe(
      'Check if "Response Status Code" is different from the previous check',
    );
  });

  test("the window and If No Data say what they mean for the previous check", () => {
    renderFilter(SLOWER_THAN_THE_LAST_CHECK);

    const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

    expect(options.textContent).toContain(
      "How long ago the previous check may be. Make it longer than the monitoring interval.",
    );
    expect(options.textContent).toContain(
      "What happens when there is no previous check in the window, such as on the first check.",
    );
  });

  test("going back to Average brings the value back and drops the change", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter(
      SLOWER_THAN_THE_LAST_CHECK,
    );

    await pick(overTimeCombobox("Evaluate"), "Average");

    expect(last(rendered).evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 10,
      evaluateOverTimeType: EvaluateOverTimeType.Average,
    });
    expect(last(rendered).value).toBe(300);
    expect(screen.getByRole("textbox", { name: "Value" })).toBeTruthy();
    expect(screen.queryByTestId(CHANGE_ROW)).toBeNull();
  });
});

describe("a yes or no check compared with the previous check", () => {
  test("a body keeps the text it looks for, takes no change, and reads as started", async () => {
    const rendered: Emitted<CriteriaFilter> = renderFilter({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "Maintenance",
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    });

    await pick(overTimeCombobox("Evaluate"), "Previous Check");

    expect(last(rendered).evaluateOverTimeOptions).toEqual({
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
    });
    expect(screen.queryByTestId(CHANGE_ROW)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Value" })).toBeTruthy();
    expect(sentence()).toBe(
      'Check if "Response Body" contains "Maintenance" now, but not on the previous check',
    );
  });

  test("Is Online False reads as the check it went down", async () => {
    renderFilter(
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.False,
        value: undefined,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.PreviousCheck,
        },
      },
      MonitorType.Ping,
    );

    expect(screen.queryByTestId(CHANGE_ROW)).toBeNull();
    expect(sentence()).toBe(
      'Check if "Is Online" is false now, but not on the previous check',
    );
  });
});
