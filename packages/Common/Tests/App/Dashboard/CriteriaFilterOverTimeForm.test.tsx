import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, test } from "@jest/globals";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";

/*
 * The criteria form's "Evaluate this criteria over a period of time" on the
 * filters that keep a match history (issue #4686): a Response Body, a
 * header, a JavaScript expression, a request timeout.
 *
 * The real component, held in a little stateful parent so a tick, a pick
 * and the controls they reveal play out as they do in the form. Assertions
 * stay on plain DOM: jest-dom's matchers do not typecheck repo-wide.
 */

const OVER_TIME_BOX: string = "criteria-filter-evaluate-over-time";
const OVER_TIME_OPTIONS: string = "criteria-filter-over-time-options";

interface Rendered {
  emitted: Array<CriteriaFilter>;
}

function renderFilter(
  initial: CriteriaFilter,
  monitorType: MonitorType,
): Rendered {
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

function lastEmitted(rendered: Rendered): CriteriaFilter {
  expect(rendered.emitted.length).toBeGreaterThan(0);
  return rendered.emitted[rendered.emitted.length - 1]!;
}

function overTimeBox(): HTMLInputElement | null {
  const container: HTMLElement | null = screen.queryByTestId(OVER_TIME_BOX);

  return container ? (container as HTMLInputElement) : null;
}

const BODY_FILTER: CriteriaFilter = {
  checkOn: CheckOn.ResponseBody,
  filterType: FilterType.NotContains,
  value: "App Title",
};

function bodyOverTime(
  overrides: Partial<CriteriaFilter["evaluateOverTimeOptions"]> = {},
): CriteriaFilter {
  return {
    ...BODY_FILTER,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 5,
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      ...overrides,
    },
  };
}

// The option labels a dropdown under the over-time box offers.
async function optionsOf(dropdownIndex: number): Promise<Array<string>> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

  await user.click(within(options).getAllByRole("combobox")[dropdownIndex]!);

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return option.textContent || "";
  });
}

describe("Evaluate this criteria over a period of time, on checks with a match history", () => {
  describe("where the box is offered", () => {
    test.each([
      [MonitorType.Website, CheckOn.ResponseBody, FilterType.NotContains],
      [MonitorType.API, CheckOn.ResponseBody, FilterType.Contains],
      [MonitorType.Website, CheckOn.ResponseHeader, FilterType.Contains],
      [MonitorType.API, CheckOn.ResponseHeaderValue, FilterType.NotContains],
      [
        MonitorType.Website,
        CheckOn.JavaScriptExpression,
        FilterType.EvaluatesToTrue,
      ],
      [MonitorType.API, CheckOn.IsRequestTimeout, FilterType.True],
      [MonitorType.Ping, CheckOn.IsRequestTimeout, FilterType.True],
      [MonitorType.IP, CheckOn.IsRequestTimeout, FilterType.True],
      [MonitorType.Port, CheckOn.IsRequestTimeout, FilterType.False],
    ])(
      "a %s monitor's %s filter has it",
      (monitorType: MonitorType, checkOn: CheckOn, filterType: FilterType) => {
        renderFilter(
          { checkOn: checkOn, filterType: filterType, value: "x" },
          monitorType,
        );

        expect(overTimeBox()).not.toBeNull();
        expect(
          screen.getByText("Evaluate this criteria over a period of time"),
        ).toBeTruthy();
      },
    );

    test.each([
      [MonitorType.SQLQuery, CheckOn.JavaScriptExpression],
      [MonitorType.IncomingRequest, CheckOn.JavaScriptExpression],
      [MonitorType.IncomingRequest, CheckOn.RequestBody],
      [MonitorType.Domain, CheckOn.IsRequestTimeout],
      [MonitorType.SyntheticMonitor, CheckOn.Error],
    ])(
      "a %s monitor's %s filter does not - it keeps no history",
      (monitorType: MonitorType, checkOn: CheckOn) => {
        renderFilter(
          { checkOn: checkOn, filterType: FilterType.Contains, value: "x" },
          monitorType,
        );

        expect(overTimeBox()).toBeNull();
      },
    );
  });

  describe("ticking the box", () => {
    test("gives the filter a window at once: All Values over 5 minutes", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const rendered: Rendered = renderFilter(BODY_FILTER, MonitorType.Website);

      await user.click(overTimeBox()!);

      expect(lastEmitted(rendered)).toEqual({
        ...BODY_FILTER,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
      });
    });

    test("shows that window, rather than empty dropdowns", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      renderFilter(BODY_FILTER, MonitorType.Website);

      expect(screen.queryByTestId(OVER_TIME_OPTIONS)).toBeNull();

      await user.click(overTimeBox()!);

      const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

      expect(within(options).getAllByText("All Values").length).toBe(1);
      expect(within(options).getAllByText("5 Minutes").length).toBe(1);
      expect(within(options).getAllByText(NoDataPolicy.Ignore).length).toBe(1);
      expect(within(options).queryByText("Select...")).toBeNull();
    });

    test("unticking keeps the window, so ticking again brings it back", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const rendered: Rendered = renderFilter(
        bodyOverTime({
          timeValueInMinutes: 15,
          evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
        }),
        MonitorType.Website,
      );

      await user.click(overTimeBox()!);

      expect(lastEmitted(rendered).evaluateOverTime).toBe(false);
      expect(lastEmitted(rendered).evaluateOverTimeOptions).toEqual({
        timeValueInMinutes: 15,
        evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
      });
      expect(screen.queryByTestId(OVER_TIME_OPTIONS)).toBeNull();

      await user.click(overTimeBox()!);

      expect(lastEmitted(rendered).evaluateOverTimeOptions).toEqual({
        timeValueInMinutes: 15,
        evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
      });
    });
  });

  describe("the window's settings", () => {
    test("a body filter is offered All Values and Any Value only", async () => {
      renderFilter(bodyOverTime(), MonitorType.Website);

      expect(await optionsOf(0)).toEqual(["All Values", "Any Value"]);
    });

    test("Response Time keeps every aggregate", async () => {
      renderFilter(
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 3000,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        },
        MonitorType.Website,
      );

      expect(await optionsOf(0)).toEqual([
        "Average",
        "Sum",
        "Maximum Value",
        "Minimum Value",
        "All Values",
        "Any Value",
      ]);
    });

    test("picking Any Value keeps the window's length", async () => {
      const rendered: Rendered = renderFilter(
        bodyOverTime({ timeValueInMinutes: 10 }),
        MonitorType.API,
      );

      await optionsOf(0);
      await userEvent.setup().click(screen.getByText("Any Value"));

      expect(lastEmitted(rendered).evaluateOverTimeOptions).toEqual({
        timeValueInMinutes: 10,
        evaluateOverTimeType: EvaluateOverTimeType.AnyValue,
      });
    });

    test("a window saved as a number - by the API, or Terraform - shows its option", () => {
      renderFilter(bodyOverTime({ timeValueInMinutes: 10 }), MonitorType.API);

      const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

      expect(within(options).getAllByText("10 Minutes").length).toBe(1);
      expect(within(options).queryByText("Select...")).toBeNull();
    });

    test("a window saved as a string, as the form used to save it, shows its option too", () => {
      renderFilter(
        bodyOverTime({ timeValueInMinutes: "30" as unknown as number }),
        MonitorType.API,
      );

      expect(
        within(screen.getByTestId(OVER_TIME_OPTIONS)).getAllByText("30 Minutes")
          .length,
      ).toBe(1);
    });

    test("the minutes picked are saved as a number", async () => {
      const rendered: Rendered = renderFilter(
        bodyOverTime(),
        MonitorType.Website,
      );

      await optionsOf(1);
      await userEvent.setup().click(screen.getByText("15 Minutes"));

      expect(lastEmitted(rendered).evaluateOverTimeOptions).toEqual({
        timeValueInMinutes: 15,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      });
    });

    test("If No Data still offers Ignore, Treat As Zero and Trigger", async () => {
      const rendered: Rendered = renderFilter(
        bodyOverTime(),
        MonitorType.Website,
      );

      expect(await optionsOf(2)).toEqual([
        NoDataPolicy.Ignore,
        NoDataPolicy.TreatAsZero,
        NoDataPolicy.Trigger,
      ]);

      await userEvent.setup().click(screen.getByText(NoDataPolicy.Trigger));

      expect(lastEmitted(rendered).evaluateOverTimeOptions).toEqual({
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        onNoDataPolicy: NoDataPolicy.Trigger,
      });
    });

    test("say what All Values and Any Value mean for a yes/no check", () => {
      renderFilter(bodyOverTime(), MonitorType.Website);

      expect(
        screen.getByText(
          "All Values matches only when every check in the window matched. Any Value matches as soon as one check did.",
        ),
      ).toBeTruthy();
    });

    test("say what the aggregates mean for a measured value", () => {
      renderFilter(
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 3000,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        },
        MonitorType.Website,
      );

      expect(
        screen.getByText(
          "Average, Sum, Maximum Value and Minimum Value compare one figure for the whole window. All Values needs every check to meet the condition, Any Value just one.",
        ),
      ).toBeTruthy();
    });

    test("warn that a window no longer than the monitoring interval holds one check", () => {
      renderFilter(bodyOverTime(), MonitorType.Website);

      expect(
        screen.getByText(
          "Make it longer than the monitoring interval, so the window holds several checks.",
        ),
      ).toBeTruthy();
    });
  });

  /*
   * The window's three settings always hold a value - ticking the box gives
   * them one - so none of them can be cleared: a cleared "For the last" left
   * a ticked box over no window, and the filter was judged on the latest
   * check alone. And each is named for screen readers by its label.
   */
  describe("the window's dropdowns", () => {
    test("are named for screen readers by their labels", () => {
      renderFilter(bodyOverTime(), MonitorType.Website);

      const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

      expect(
        within(options)
          .getAllByRole("combobox")
          .map((combobox: HTMLElement): string | null => {
            return combobox.getAttribute("aria-label");
          }),
      ).toEqual(["Evaluate", "For the last (in minutes)", "If No Data"]);
    });

    test("offer no clear control, as no list a filter cannot be without does", () => {
      const { container }: { container: HTMLElement } = render(
        <CriteriaFilterElement
          monitorType={MonitorType.Website}
          monitorStep={new MonitorStep()}
          value={bodyOverTime({ onNoDataPolicy: NoDataPolicy.Trigger })}
          onChange={() => {}}
        />,
      );

      const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

      expect(
        options.querySelectorAll(".ou-select__clear-indicator").length,
      ).toBe(0);

      /*
       * Nor do Filter Type and Filter Condition (#5281): a filter cannot be
       * without them, and on a phone their × took a sixth of the list.
       */
      expect(
        container.querySelectorAll(".ou-select__clear-indicator").length,
      ).toBe(0);
    });

    test("never send a window without minutes from the form", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
      const rendered: Rendered = renderFilter(
        bodyOverTime({ timeValueInMinutes: 10 }),
        MonitorType.API,
      );

      const minutes: HTMLElement = screen.getByRole("combobox", {
        name: "For the last (in minutes)",
      });

      // Backspace is react-select's other way to clear a value.
      await user.click(minutes);
      await user.keyboard("{Backspace}{Escape}");

      for (const emitted of rendered.emitted) {
        expect(emitted.evaluateOverTimeOptions?.timeValueInMinutes).toBe(10);
      }

      expect(
        within(screen.getByTestId(OVER_TIME_OPTIONS)).getAllByText("10 Minutes")
          .length,
      ).toBe(1);
    });
  });

  describe("the filter's own controls", () => {
    test("are named for screen readers by their labels", () => {
      renderFilter(BODY_FILTER, MonitorType.Website);

      expect(
        screen.getByRole("combobox", { name: "Filter Type" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("combobox", { name: "Filter Condition" }),
      ).toBeTruthy();
      expect(screen.getByRole("textbox", { name: "Value" })).toBeTruthy();
    });
  });

  describe("the order a filter reads in", () => {
    /*
     * What the filter checks first - Response Body, Not Contains, "App
     * Title" - then for how long.
     */
    test("the box comes after the condition and the value", () => {
      const { container }: { container: HTMLElement } = render(
        <CriteriaFilterElement
          monitorType={MonitorType.Website}
          monitorStep={new MonitorStep()}
          value={bodyOverTime()}
          onChange={() => {}}
        />,
      );

      const text: string = container.textContent || "";

      const conditionAt: number = text.indexOf("Filter Condition");
      const valueAt: number = text.indexOf("Value", conditionAt);
      const boxAt: number = text.indexOf(
        "Evaluate this criteria over a period of time",
      );
      const windowAt: number = text.indexOf("For the last (in minutes)");

      expect(conditionAt).toBeGreaterThan(-1);
      expect(valueAt).toBeGreaterThan(conditionAt);
      expect(boxAt).toBeGreaterThan(valueAt);
      expect(windowAt).toBeGreaterThan(boxAt);
    });

    test("the window's settings sit inside the box's own group", () => {
      renderFilter(bodyOverTime(), MonitorType.Website);

      const group: HTMLElement = screen.getByTestId(
        "criteria-filter-over-time",
      );
      const options: HTMLElement = screen.getByTestId(OVER_TIME_OPTIONS);

      expect(group.contains(options)).toBe(true);
      expect(group.contains(overTimeBox())).toBe(true);
    });
  });
});
