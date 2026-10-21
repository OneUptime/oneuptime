import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { act } from "react";
import type { Mock } from "jest-mock";
import { ObjectType } from "../../../Types/JSON";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import DashboardMode from "../../../Types/Dashboard/DashboardMode";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import { DASHBOARD_TIME_RANGES } from "../../../Types/Dashboard/DashboardTimeRange";
import DashboardToolbar from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar";
import {
  AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
  DASHBOARD_DEFAULTS_BAR_TEST_ID,
  DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
  DEFAULT_TIME_RANGE_PICKER_TEST_ID,
  DashboardDefaultsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardDefaultsCopy";

/*
 * The dashboard toolbar's own menus of choices as a keyboard and a screen
 * reader meet them (issue #5080's UI review): the auto-refresh menu while
 * viewing, with its "Default (...)" first, and the editing row's Default
 * time range and Default auto-refresh.
 *
 * Each is a menu button - aria-haspopup, aria-expanded, aria-controls - whose
 * menu names what it sets and whose choices are radio items, the one in use
 * checked. Opening one puts the focus on the choice in use; the arrows, Home
 * and End move it; Escape closes the menu back on its button; Tab closes it
 * from its button; a choice made hands the focus back to the button. Before,
 * the editing row's choices were Tab stops of their own and the auto-refresh
 * menu was plain buttons a screen reader could not tell were choices.
 *
 * The editing row also waits for the dashboard's first widget, as the
 * viewer's own time range and auto-refresh do.
 *
 * The dashboard around the toolbar, and what the picks do, are covered by
 * DashboardDefaultTimeRange.test.tsx; the browser by the offline suite
 * packages/E2E/DashboardTimeRange.
 */

const RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_DAY,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-10-19T10:00:00.000Z"),
    new Date("2026-10-20T10:00:00.000Z"),
  ),
};

function makeConfig(data: {
  hasWidget: boolean;
  timeRange?: TimeRange | undefined;
  refreshInterval?: AutoRefreshInterval | undefined;
}): DashboardViewConfig {
  const config: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components: data.hasWidget
      ? [DashboardTextComponentUtil.getDefaultComponent()]
      : [],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };

  if (data.timeRange) {
    config.timeRange = data.timeRange;
  }

  if (data.refreshInterval) {
    config.refreshInterval = data.refreshInterval;
  }

  return config;
}

function noop(): void {
  return undefined;
}

type OnDefaultsChange = (defaults: {
  timeRange?: TimeRange | undefined;
  refreshInterval?: AutoRefreshInterval | undefined;
}) => void;

type OnIntervalChange = (interval: AutoRefreshInterval) => void;

type OnDefaultSelect = () => void;

interface ToolbarOptions {
  mode: DashboardMode;
  config: DashboardViewConfig;
  autoRefreshInterval?: AutoRefreshInterval | undefined;
  isOnDefaultAutoRefresh?: boolean | undefined;
  onAutoRefreshIntervalChange?:
    | ((interval: AutoRefreshInterval) => void)
    | undefined;
  onDefaultAutoRefreshSelect?: (() => void) | undefined;
  onDashboardDefaultsChange?:
    | ((defaults: {
        timeRange?: TimeRange | undefined;
        refreshInterval?: AutoRefreshInterval | undefined;
      }) => void)
    | undefined;
}

function toolbar(options: ToolbarOptions): React.ReactElement {
  return (
    <DashboardToolbar
      dashboardMode={options.mode}
      dashboardName="Production wall screen"
      dashboardViewConfig={options.config}
      isSaving={false}
      canEditDashboard={true}
      startAndEndDate={RANGE}
      onStartAndEndDateChange={noop}
      autoRefreshInterval={
        options.autoRefreshInterval || AutoRefreshInterval.ONE_MINUTE
      }
      onAutoRefreshIntervalChange={options.onAutoRefreshIntervalChange || noop}
      defaultTimeRange={TimeRange.PAST_ONE_DAY}
      isOnDefaultTimeRange={true}
      onDefaultTimeRangeSelect={noop}
      defaultAutoRefreshInterval={AutoRefreshInterval.ONE_MINUTE}
      isOnDefaultAutoRefresh={
        options.isOnDefaultAutoRefresh === undefined
          ? true
          : options.isOnDefaultAutoRefresh
      }
      onDefaultAutoRefreshSelect={options.onDefaultAutoRefreshSelect || noop}
      onDashboardDefaultsChange={options.onDashboardDefaultsChange || noop}
      onEditClick={noop}
      onSaveClick={noop}
      onCancelEditClick={noop}
      onFullScreenClick={noop}
      onAddComponentClick={noop}
    />
  );
}

const WALL_SCREEN: DashboardViewConfig = makeConfig({
  hasWidget: true,
  timeRange: TimeRange.PAST_ONE_DAY,
  refreshInterval: AutoRefreshInterval.ONE_MINUTE,
});

async function press(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function key(name: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(document.activeElement || document.body, {
      key: name,
    });
  });
}

function focused(): HTMLElement {
  return document.activeElement as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe("the editing row", () => {
  test("waits for the dashboard's first widget, as the viewer's own time range and auto-refresh do", () => {
    const view: ReturnType<typeof render> = render(
      toolbar({
        mode: DashboardMode.Edit,
        config: makeConfig({ hasWidget: false }),
      }),
    );

    // An empty dashboard's editor has one thing to do: add a widget.
    expect(screen.queryByTestId(DASHBOARD_DEFAULTS_BAR_TEST_ID)).toBeNull();
    expect(screen.getByTitle("Add Widget")).toBeInTheDocument();

    view.rerender(
      toolbar({
        mode: DashboardMode.Edit,
        config: makeConfig({ hasWidget: true }),
      }),
    );

    expect(screen.getByTestId(DASHBOARD_DEFAULTS_BAR_TEST_ID)).toBeVisible();
  });

  test("keeps its line on what the pickers do on a line of its own, under them", () => {
    render(toolbar({ mode: DashboardMode.Edit, config: WALL_SCREEN }));

    const row: HTMLElement = screen.getByTestId(DASHBOARD_DEFAULTS_BAR_TEST_ID);
    const hint: HTMLElement = within(row).getByText(DashboardDefaultsCopy.hint);
    const pickers: HTMLElement | null = screen
      .getByTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID)
      .closest(".flex-wrap");

    /*
     * Beside the pickers, it fitted for some values and not others, so a
     * longer range moved the whole board down a line. Under them, never.
     */
    expect(pickers).not.toBeNull();
    expect(pickers!.contains(hint)).toBe(false);
    expect(hint.parentElement).toBe(row);
    expect(row.lastElementChild).toBe(hint);
    // Read as easily as the labels: gray-400 on white was too faint.
    expect(hint).toHaveClass("text-gray-500");
    expect(hint).not.toHaveClass("text-gray-400");
  });

  test.each([
    [
      DashboardDefaultsCopy.timeRangeLabel,
      DEFAULT_TIME_RANGE_PICKER_TEST_ID,
      DASHBOARD_TIME_RANGES.length,
      "Past 1 Day",
    ],
    [
      DashboardDefaultsCopy.autoRefreshLabel,
      DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
      Object.values(AutoRefreshInterval).length,
      "Refresh every 1m",
    ],
  ])(
    "%s is a menu button whose choices are radio items, the one in use checked",
    async (label: string, testId: string, count: number, inUse: string) => {
      render(toolbar({ mode: DashboardMode.Edit, config: WALL_SCREEN }));

      const button: HTMLElement = screen.getByTestId(testId);

      expect(button).toHaveAttribute("aria-haspopup", "menu");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).not.toHaveAttribute("aria-controls");

      await press(button);

      const menu: HTMLElement = screen.getByRole("menu", { name: label });

      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(button).toHaveAttribute("aria-controls", menu.id);

      const choices: Array<HTMLElement> =
        within(menu).getAllByRole("menuitemradio");

      expect(choices).toHaveLength(count);

      // One Tab stop, the button: the arrows move between the choices.
      for (const choice of choices) {
        expect(choice).toHaveAttribute("tabindex", "-1");
      }

      const checked: Array<HTMLElement> = choices.filter(
        (choice: HTMLElement): boolean => {
          return choice.getAttribute("aria-checked") === "true";
        },
      );

      expect(checked).toHaveLength(1);
      // The tick is drawn, not read: the name is the choice alone.
      expect(checked[0]).toHaveAccessibleName(inUse);
    },
  );

  test("opening it puts the focus on the choice in use; the arrows, Home and End move it, wrapping round", async () => {
    render(toolbar({ mode: DashboardMode.Edit, config: WALL_SCREEN }));

    await press(screen.getByTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID));

    expect(focused()).toHaveAccessibleName("Past 1 Day");

    await key("ArrowDown");
    expect(focused()).toHaveAccessibleName("Past 2 Days");

    await key("ArrowUp");
    await key("ArrowUp");
    expect(focused()).toHaveAccessibleName("Past 3 Hours");

    await key("Home");
    expect(focused()).toHaveAccessibleName("Past 5 Minutes");

    // From the first, up goes round to the last.
    await key("ArrowUp");
    expect(focused()).toHaveAccessibleName("Past 3 Months");

    // And from the last, down goes round to the first.
    await key("ArrowDown");
    expect(focused()).toHaveAccessibleName("Past 5 Minutes");

    await key("End");
    expect(focused()).toHaveAccessibleName("Past 3 Months");
  });

  test("Escape closes it and hands the focus back to its button", async () => {
    render(toolbar({ mode: DashboardMode.Edit, config: WALL_SCREEN }));

    const button: HTMLElement = screen.getByTestId(
      DEFAULT_AUTO_REFRESH_PICKER_TEST_ID,
    );

    await press(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await key("Escape");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("Tab closes it from its button, so the next Tab stop is the one after the menu", async () => {
    render(toolbar({ mode: DashboardMode.Edit, config: WALL_SCREEN }));

    const button: HTMLElement = screen.getByTestId(
      DEFAULT_TIME_RANGE_PICKER_TEST_ID,
    );

    await press(button);
    await key("ArrowDown");
    await key("Tab");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(button);
  });

  test("a choice made from the keyboard is the one set, and the focus goes back to the button", async () => {
    const onDashboardDefaultsChange: Mock<OnDefaultsChange> =
      jest.fn<OnDefaultsChange>();

    render(
      toolbar({
        mode: DashboardMode.Edit,
        config: WALL_SCREEN,
        onDashboardDefaultsChange,
      }),
    );

    const button: HTMLElement = screen.getByTestId(
      DEFAULT_TIME_RANGE_PICKER_TEST_ID,
    );

    await press(button);
    await key("ArrowDown");
    // A browser's Enter or Space on the focused choice is its click.
    await press(focused());

    expect(onDashboardDefaultsChange).toHaveBeenCalledTimes(1);
    expect(onDashboardDefaultsChange).toHaveBeenCalledWith({
      timeRange: TimeRange.PAST_TWO_DAYS,
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(button);
  });

  test("its menu hangs from the button's start, so a right-to-left language opens it under the button too", async () => {
    render(toolbar({ mode: DashboardMode.Edit, config: WALL_SCREEN }));

    await press(screen.getByTestId(DEFAULT_TIME_RANGE_PICKER_TEST_ID));

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveClass("start-0");
    expect(menu).not.toHaveClass("left-0");
    // As wide as its longest choice, which never wraps, and every preset shows.
    expect(menu).toHaveClass("w-max");
    expect(menu).not.toHaveClass("max-h-80");

    for (const choice of within(menu).getAllByRole("menuitemradio")) {
      expect(choice).toHaveClass("whitespace-nowrap");
    }
  });
});

describe("the auto-refresh menu while viewing", () => {
  function trigger(): HTMLElement {
    return screen.getByTitle("Auto-refresh settings");
  }

  test("is a menu button whose choices are radio items; on the default, Default (...) is the one checked", async () => {
    render(toolbar({ mode: DashboardMode.View, config: WALL_SCREEN }));

    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");

    await press(trigger());

    const menu: HTMLElement = screen.getByRole("menu", {
      name: "Auto-refresh settings",
    });

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-controls", menu.id);

    const choices: Array<HTMLElement> =
      within(menu).getAllByRole("menuitemradio");

    // Default (1m), then every interval.
    expect(choices).toHaveLength(Object.values(AutoRefreshInterval).length + 1);
    expect(choices[0]).toHaveAttribute(
      "data-testid",
      AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID,
    );
    expect(choices[0]).toHaveAccessibleName("Default (1m)");
    expect(choices[0]).toHaveAttribute("aria-checked", "true");
    expect(
      within(menu).getByRole("menuitemradio", { name: "Refresh every 1m" }),
    ).toHaveAttribute("aria-checked", "false");

    for (const choice of choices) {
      expect(choice).toHaveAttribute("tabindex", "-1");
      expect(choice).toHaveClass("whitespace-nowrap");
    }

    // Under its button's end, so in a right-to-left language it stays on the board.
    expect(menu).toHaveClass("end-0");
    expect(menu).not.toHaveClass("right-0");
  });

  test("a viewer's own interval is the one checked, not Default", async () => {
    render(
      toolbar({
        mode: DashboardMode.View,
        config: WALL_SCREEN,
        autoRefreshInterval: AutoRefreshInterval.THIRTY_SECONDS,
        isOnDefaultAutoRefresh: false,
      }),
    );

    await press(trigger());

    const menu: HTMLElement = screen.getByRole("menu");

    expect(
      within(menu).getByRole("menuitemradio", { name: "Default (1m)" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(
      within(menu).getByRole("menuitemradio", { name: "Refresh every 30s" }),
    ).toHaveAttribute("aria-checked", "true");
    // And the focus starts there.
    expect(focused()).toHaveAccessibleName("Refresh every 30s");
  });

  test("the keys move between the choices, and Escape closes it back on its button", async () => {
    render(toolbar({ mode: DashboardMode.View, config: WALL_SCREEN }));

    await press(trigger());
    expect(focused()).toHaveAccessibleName("Default (1m)");

    await key("ArrowDown");
    expect(focused()).toHaveAccessibleName("Auto-refresh Off");

    await key("End");
    expect(focused()).toHaveAccessibleName("Refresh every 15m");

    await key("Escape");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(trigger());
  });

  test("a choice made hands the focus back to the button", async () => {
    const onAutoRefreshIntervalChange: Mock<OnIntervalChange> =
      jest.fn<OnIntervalChange>();
    const onDefaultAutoRefreshSelect: Mock<OnDefaultSelect> =
      jest.fn<OnDefaultSelect>();

    render(
      toolbar({
        mode: DashboardMode.View,
        config: WALL_SCREEN,
        autoRefreshInterval: AutoRefreshInterval.THIRTY_SECONDS,
        isOnDefaultAutoRefresh: false,
        onAutoRefreshIntervalChange,
        onDefaultAutoRefreshSelect,
      }),
    );

    await press(trigger());
    await key("ArrowDown");
    expect(focused()).toHaveAccessibleName("Refresh every 1m");
    await press(focused());

    expect(onAutoRefreshIntervalChange).toHaveBeenCalledWith(
      AutoRefreshInterval.ONE_MINUTE,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(trigger());

    // Default goes the same way.
    await press(trigger());
    await key("Home");
    await press(focused());

    expect(onDefaultAutoRefreshSelect).toHaveBeenCalledTimes(1);
    expect(focused()).toBe(trigger());
  });

  test("keys pressed with the menu closed, or outside it, move nothing", async () => {
    render(toolbar({ mode: DashboardMode.View, config: WALL_SCREEN }));

    trigger().focus();
    await key("ArrowDown");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe(trigger());
  });
});
