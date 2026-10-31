import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { ObjectType } from "../../../Types/JSON";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import DashboardMode from "../../../Types/Dashboard/DashboardMode";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardToolbar, {
  DASHBOARD_TOOLBAR_CONTROLS_TEST_ID,
  DASHBOARD_TOOLBAR_END_TEST_ID,
  DASHBOARD_TOOLBAR_ROW_TEST_ID,
  DASHBOARD_TOOLBAR_TEXT_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar";

/*
 * The dashboard's toolbar at a phone's width (the #5284 follow-up). Its
 * main row was one line that never wrapped, on a page at least 1000px
 * wide, so on a phone the time range, the auto-refresh and the ⋯ menu sat
 * past the right edge of the screen. Now the row wraps:
 *
 * - the controls and the ⋯ menu, in one box at the row's end, sit beside
 *   the dashboard's name while the name keeps 15rem (sm:basis-60), and wrap
 *   under it together, at the row's end, where they do not - the ⋯ menu
 *   never left on a line of its own;
 * - on a phone (below sm) that box is display: contents, so the name and
 *   the ⋯ menu share the first line - the name takes what the menu leaves
 *   (basis-0) - and the controls have a line of their own, from its start
 *   (max-sm:order-last max-sm:w-full);
 * - the rule between the variables and the time range is not drawn on a
 *   phone, where it would hang at the end of a wrapped line.
 *
 * jsdom applies no Tailwind, so this pins the structure and the classes the
 * layout is made of; packages/E2E/DashboardTimeRange measures the real row
 * on a 390px phone and at 1280.
 */

const RANGE: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_HOUR };

const noop: () => void = (): void => {};

function config(withWidget: boolean): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: withWidget
      ? [DashboardTextComponentUtil.getDefaultComponent()]
      : [],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };
}

const SERVICE: DashboardVariable = {
  id: "service",
  name: "service",
  label: "Service",
  type: DashboardVariableType.CustomList,
  customListValues: "checkout,payments",
  selectedValue: "checkout",
};

function toolbar(options: {
  mode?: DashboardMode;
  withWidget?: boolean;
  variables?: Array<DashboardVariable>;
  isSaving?: boolean;
  name?: string;
  description?: string;
}): React.ReactElement {
  return (
    <DashboardToolbar
      dashboardMode={options.mode || DashboardMode.View}
      dashboardName={options.name || "Production wall screen"}
      dashboardDescription={
        options.description || "Requests, latency and errors across the fleet"
      }
      dashboardViewConfig={config(options.withWidget !== false)}
      isSaving={Boolean(options.isSaving)}
      canEditDashboard={true}
      startAndEndDate={RANGE}
      onStartAndEndDateChange={noop}
      autoRefreshInterval={AutoRefreshInterval.OFF}
      onAutoRefreshIntervalChange={noop}
      onEditClick={noop}
      onSaveClick={noop}
      onCancelEditClick={noop}
      onFullScreenClick={noop}
      onAddComponentClick={noop}
      variables={options.variables}
      onVariableValueChange={options.variables ? noop : undefined}
      onVariablesDefinitionChange={noop}
    />
  );
}

function row(): HTMLElement {
  return screen.getByTestId(DASHBOARD_TOOLBAR_ROW_TEST_ID);
}

// A class that applies from sm up, or the phone's display: contents.
const SMALL_SCREEN_UP_OR_CONTENTS: RegExp = /^(?:sm:|max-sm:contents$)/;

// The box at the row's end: the controls, then the ⋯ menu.
function end(): HTMLElement {
  return screen.getByTestId(DASHBOARD_TOOLBAR_END_TEST_ID);
}

function classesOf(element: Element): Array<string> {
  return element.className.split(/\s+/).filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe("the toolbar's main row at a phone's width", () => {
  test("wraps, with nothing that keeps it one line wide", () => {
    render(toolbar({}));

    expect(classesOf(row())).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "items-center"]),
    );
    expect(classesOf(row())).not.toContain("justify-between");
  });

  test("the name, then the controls, then the ⋯ menu, in that order", () => {
    render(toolbar({}));

    const children: Array<Element> = Array.from(row().children);
    const controls: HTMLElement = screen.getByTestId(
      DASHBOARD_TOOLBAR_CONTROLS_TEST_ID,
    );
    const more: HTMLElement = screen.getByLabelText("More dashboard options");

    expect(children).toHaveLength(2);
    expect(
      within(children[0] as HTMLElement).getByText("Production wall screen"),
    ).toBeInTheDocument();
    expect(children[1]).toBe(end());

    // The controls first, the menu last, in one box.
    const ends: Array<Element> = Array.from(end().children);

    expect(ends).toHaveLength(2);
    expect(ends[0]).toBe(controls);
    expect(ends[1]!.contains(more)).toBe(true);
    // The menu is not one of the controls: on a phone it stays by the name.
    expect(controls.contains(more)).toBe(false);
  });

  test("the controls and the ⋯ menu wrap together beside the name; on a phone their box gives way so each is a part of the row", () => {
    render(toolbar({}));

    expect(classesOf(end())).toEqual(
      expect.arrayContaining([
        "max-sm:contents",
        "sm:ms-auto",
        "sm:flex",
        "sm:flex-wrap",
        "sm:items-center",
        "sm:justify-end",
      ]),
    );
    // Nothing of it applies on a phone but display: contents.
    for (const name of classesOf(end())) {
      expect([name, SMALL_SCREEN_UP_OR_CONTENTS.test(name)]).toEqual([
        name,
        true,
      ]);
    }
  });

  test("the name keeps 15rem beside the controls, and on a phone takes what the ⋯ menu leaves", () => {
    render(toolbar({}));

    const name: Element = row().children[0]!;

    expect(classesOf(name)).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1", "basis-0", "sm:basis-60"]),
    );
  });

  test("on a phone the controls have a line of their own, from its start; beside the name they sit at its end", () => {
    render(toolbar({}));

    const controls: HTMLElement = screen.getByTestId(
      DASHBOARD_TOOLBAR_CONTROLS_TEST_ID,
    );

    expect(classesOf(controls)).toEqual(
      expect.arrayContaining([
        "flex",
        "flex-wrap",
        "max-sm:order-last",
        "max-sm:w-full",
        "sm:justify-end",
      ]),
    );
    // No end margin or alignment on a phone: the line starts where the name does.
    expect(classesOf(controls)).not.toContain("ms-auto");
    expect(classesOf(controls)).not.toContain("justify-end");
  });

  test("the ⋯ menu never shrinks", () => {
    render(toolbar({}));

    expect(classesOf(end().children[1]!)).toContain("shrink-0");
  });

  test("the rule between the variables and the time range is not drawn on a phone", () => {
    render(toolbar({ variables: [SERVICE] }));

    const controls: HTMLElement = screen.getByTestId(
      DASHBOARD_TOOLBAR_CONTROLS_TEST_ID,
    );
    const rules: Array<Element> = Array.from(
      controls.querySelectorAll(".w-px"),
    );

    expect(rules).toHaveLength(1);
    expect(classesOf(rules[0]!)).toContain("max-sm:hidden");
  });

  test("an empty dashboard has no controls, so no empty line on a phone: only the ⋯ menu", () => {
    render(toolbar({ withWidget: false }));

    expect(
      screen.queryByTestId(DASHBOARD_TOOLBAR_CONTROLS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(end().children).toHaveLength(1);
    expect(
      end().contains(screen.getByLabelText("More dashboard options")),
    ).toBe(true);
  });
});

describe("while editing", () => {
  test("the editing actions are the controls, wrapping from the line's start on a phone; there is no ⋯ menu", () => {
    render(toolbar({ mode: DashboardMode.Edit }));

    const controls: HTMLElement = screen.getByTestId(
      DASHBOARD_TOOLBAR_CONTROLS_TEST_ID,
    );

    expect(within(controls).getByText("Add Widget")).toBeInTheDocument();
    expect(within(controls).getByText("Save Changes")).toBeInTheDocument();
    expect(within(controls).getByText("Cancel")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("More dashboard options"),
    ).not.toBeInTheDocument();

    const actions: Element = within(controls)
      .getByText("Add Widget")
      .closest(".flex-wrap")!;

    expect(classesOf(actions)).toEqual(
      expect.arrayContaining(["flex", "flex-wrap", "sm:justify-end"]),
    );
    expect(classesOf(actions)).not.toContain("justify-end");
  });

  test("while saving, the controls hold the saving notice", () => {
    render(toolbar({ mode: DashboardMode.Edit, isSaving: true }));

    expect(
      within(screen.getByTestId(DASHBOARD_TOOLBAR_CONTROLS_TEST_ID)).getByText(
        "Saving...",
      ),
    ).toBeInTheDocument();
  });
});

describe("the toolbar's card", () => {
  test("is inset from the board's sides beside the side menu only (md:mx-3); below, it lines up with the page's menu", () => {
    const { container } = render(toolbar({}));

    const outer: Element = container.firstElementChild!;

    expect(classesOf(outer)).toContain("md:mx-3");
    expect(classesOf(outer)).not.toContain("mx-3");
  });
});

describe("the dashboard's name and description", () => {
  /*
   * Words someone wrote, in their language whatever the page's. Laid out as
   * the page reads, an English name on a Persian page was cut at its start
   * ("...ency and errors across the fleet"); each now reads its own way
   * (IsolatedText) and is cut short at its own end, and sits on the page's
   * side beside the icon, as wide as its words (inline-block). The name is
   * the page's second heading: the page's title above the toolbar is its
   * one h1.
   */
  const PERSIAN_NAME: string = "نمای تولید";
  const PERSIAN_DESCRIPTION: string = "درخواست‌ها و خطاها";

  function bdiOf(text: string): HTMLElement {
    const element: HTMLElement = screen.getByText(text);

    expect(element.tagName).toBe("BDI");

    return element;
  }

  test("the name is a second-level heading, under the page's own title", () => {
    render(toolbar({}));

    expect(
      within(row()).getByRole("heading", {
        level: 2,
        name: "Production wall screen",
      }),
    ).toBeInTheDocument();
    expect(
      within(row()).queryByRole("heading", { level: 1 }),
    ).not.toBeInTheDocument();
  });

  test("an English name and description read left to right, each cut at its own end, whole under the pointer", () => {
    render(toolbar({}));

    for (const text of [
      "Production wall screen",
      "Requests, latency and errors across the fleet",
    ]) {
      const element: HTMLElement = bdiOf(text);

      expect(element).toHaveAttribute("dir", "ltr");
      expect(element).toHaveAttribute("title", text);
      expect(classesOf(element)).toEqual(
        DASHBOARD_TOOLBAR_TEXT_CLASS_NAME.split(" "),
      );
    }

    // The heading itself gives way beside the Editing badge.
    expect(classesOf(screen.getByRole("heading", { level: 2 }))).toContain(
      "min-w-0",
    );
  });

  test("each is on one line, as wide as its words and never wider than its line", () => {
    expect(DASHBOARD_TOOLBAR_TEXT_CLASS_NAME.split(" ").sort()).toEqual(
      ["align-top", "inline-block", "max-w-full", "truncate"].sort(),
    );
  });

  test("a Persian name and description read right to left on any page", () => {
    render(toolbar({ name: PERSIAN_NAME, description: PERSIAN_DESCRIPTION }));

    expect(bdiOf(PERSIAN_NAME)).toHaveAttribute("dir", "rtl");
    expect(bdiOf(PERSIAN_DESCRIPTION)).toHaveAttribute("dir", "rtl");
  });
});
