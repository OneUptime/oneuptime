import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import DayUptimeGraph, {
  BarChartRule,
  DayReading,
} from "../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../UI/Components/Graphs/UptimeDaySummary";
import ResourceGroupSection from "../../../UI/Components/StatusPage/ResourceGroupSection";
import {
  STATUS_TEXT_ATTRIBUTE,
  STATUS_TEXT_DARK_PROPERTY,
  ThemedProps,
  UPTIME_BAR_EDGE_ATTRIBUTE,
  UPTIME_BAR_EDGE_DARK_PROPERTY,
  getStatusTextProps,
  getUptimeBarProps,
} from "../../../UI/Utils/StatusColorStyle";
import { Green, Moroon500, Red } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import {
  HistoryChartBarColorRuleValues,
  NO_DATA_BAR_CLASS_NAME,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
} from "../../../Utils/StatusPage/HistoryChartBarColors";
import {
  getStatusTextColorOnDark,
  getUptimeBarEdgeOnDark,
} from "../../../Utils/StatusPage/StatusColorsOnDark";
import {
  declaredValue,
  rulesFor,
  StyleRule,
  THEME_RULES,
} from "./ThemeStylesheet";

/*
 * Status colours in the dark theme (Common/UI/Utils/StatusColorStyle).
 *
 * A status's colour is any hex its owner picked for a light page, so no
 * utility class carries it and Theme.css's usual re-colouring has nothing to
 * hook: the element writes the light colour inline, as it always did, and
 * the dark one as a custom property beside a data attribute, which a rule
 * in Theme.css swaps in under html.dark. The two halves name the same
 * attribute and property in two files - this holds them together, on the
 * real components that draw status colours.
 */

const STATUS_TEXT_SELECTOR: string = `html.dark [${STATUS_TEXT_ATTRIBUTE}]`;
const BAR_EDGE_SELECTOR: string = `html.dark [${UPTIME_BAR_EDGE_ATTRIBUTE}]`;
const LOGO_PLATE_SELECTOR: string = "html.dark [data-ou-logo-plate]";
const NO_DATA_SELECTOR: string = `html.dark .${NO_DATA_BAR_CLASS_NAME}`;

afterEach(() => {
  cleanup();
});

const customProperty: (element: HTMLElement, name: string) => string = (
  element: HTMLElement,
  name: string,
): string => {
  return element.style.getPropertyValue(name);
};

describe("the dark theme's rules for status colours", () => {
  test("text in a status colour takes the shade its element carries, over its inline colour", () => {
    expect(declaredValue(STATUS_TEXT_SELECTOR, "color")).toBe(
      `var(${STATUS_TEXT_DARK_PROPERTY}) !important`,
    );
  });

  test("a bar too dark for the card gets an edge from the property its element carries", () => {
    expect(declaredValue(BAR_EDGE_SELECTOR, "box-shadow")).toBe(
      `inset 0 0 0 1px var(${UPTIME_BAR_EDGE_DARK_PROPERTY})`,
    );
  });

  test("a logo on a page that follows the visitor sits on a light backdrop", () => {
    expect(declaredValue(LOGO_PLATE_SELECTOR, "background-color")).toBe(
      "#f8fafc",
    );
    expect(declaredValue(LOGO_PLATE_SELECTOR, "border-radius")).toBe("0.5rem");
    expect(declaredValue(LOGO_PLATE_SELECTOR, "padding")).toBe(
      "0.375rem 0.625rem",
    );
  });

  test("a day with no data is a calmer grey, still hatched, over its inline grey", () => {
    expect(declaredValue(NO_DATA_SELECTOR, "background-color")).toBe(
      "#64748b !important",
    );
    expect(declaredValue(NO_DATA_SELECTOR, "background-image")).toContain(
      "repeating-linear-gradient( 135deg",
    );
  });

  test("none of them reaches the light theme", () => {
    /*
     * The light page must look exactly as it did: every rule that keys off
     * these attributes is scoped to html.dark.
     */
    const names: Array<string> = [
      STATUS_TEXT_ATTRIBUTE,
      UPTIME_BAR_EDGE_ATTRIBUTE,
      "data-ou-logo-plate",
    ];

    for (const rule of THEME_RULES) {
      for (const selector of rule.selectors) {
        for (const name of names) {
          if (selector.includes(`[${name}`)) {
            expect([selector, selector.startsWith("html.dark ")]).toEqual([
              selector,
              true,
            ]);
          }
        }
      }
    }

    // The light no-data hatch lives in the strip's own stylesheet, untouched.
    expect(rulesFor(`.${NO_DATA_BAR_CLASS_NAME}`)).toEqual([]);
  });
});

describe("the props a status colour is drawn with", () => {
  test("text keeps its picked colour inline and carries its dark shade", () => {
    const props: ThemedProps = getStatusTextProps(Moroon500, {
      fontWeight: 600,
    });

    expect(props[STATUS_TEXT_ATTRIBUTE]).toBe("");
    expect(props.style.color).toBe(Moroon500.toString());
    expect(props.style.fontWeight).toBe(600);
    expect(props.style[STATUS_TEXT_DARK_PROPERTY]).toBe(
      getStatusTextColorOnDark(Moroon500),
    );
  });

  test("text in something that is not a colour keeps its style, and no dark rule picks it up", () => {
    const props: ThemedProps = getStatusTextProps("not a colour", {
      fontSize: "11px",
    });

    expect(props[STATUS_TEXT_ATTRIBUTE]).toBeUndefined();
    expect(props.style).toEqual({ fontSize: "11px", color: "not a colour" });
    expect(getStatusTextProps(null).style).toEqual({});
  });

  test("a bar keeps its colour exactly, in both themes", () => {
    for (const color of ["#22c55e", "#fde047", "#c2410c", "#7f1d1d"]) {
      expect(getUptimeBarProps(new Color(color)).style.backgroundColor).toBe(
        color,
      );
    }
  });

  test("only a bar too dark for the card carries an edge", () => {
    const dark: ThemedProps = getUptimeBarProps(new Color("#7f1d1d"));
    const green: ThemedProps = getUptimeBarProps(new Color("#22c55e"));

    expect(dark[UPTIME_BAR_EDGE_ATTRIBUTE]).toBe("");
    expect(dark.style[UPTIME_BAR_EDGE_DARK_PROPERTY]).toBe(
      getUptimeBarEdgeOnDark("#7f1d1d"),
    );
    expect(green[UPTIME_BAR_EDGE_ATTRIBUTE]).toBeUndefined();
    expect(green.style[UPTIME_BAR_EDGE_DARK_PROPERTY]).toBeUndefined();
  });
});

describe("the uptime strip draws its bars with them", () => {
  const END_DATE: Date = OneUptimeDate.getCurrentDate();
  const START_DATE: Date = OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, 9);

  const RULES: Array<BarChartRule> =
    RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
      (rule: HistoryChartBarColorRuleValues): BarChartRule => {
        return {
          uptimePercentGreaterThanOrEqualTo:
            rule.uptimePercentGreaterThanOrEqualTo,
          barColor: rule.barColor,
        };
      },
    );

  const duration: (
    label: string,
    seconds: number,
    color: Color,
    isDowntime: boolean,
  ) => StatusDuration = (
    label: string,
    seconds: number,
    color: Color,
    isDowntime: boolean,
  ): StatusDuration => {
    return { label, seconds, color, isDowntime, priority: isDowntime ? 3 : 1 };
  };

  const day: (daysAgo: number, minutesDown: number) => DayReading = (
    daysAgo: number,
    minutesDown: number,
  ): DayReading => {
    const down: number = minutesDown * 60;

    return {
      dayStart: OneUptimeDate.getStartOfDay(
        OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, daysAgo),
      ),
      daySeconds: 86400,
      coveredSeconds: 86400,
      statusDurations: [
        duration("Operational", 86400 - down, Green, false),
        duration("Offline", down, Red, true),
      ].filter((entry: StatusDuration): boolean => {
        return entry.seconds > 0;
      }),
    };
  };

  test("a long outage's very dark red bar carries an edge; the others, and days with no data, do not", () => {
    render(
      <DayUptimeGraph
        startDate={START_DATE}
        endDate={END_DATE}
        events={[]}
        defaultBarColor={Green}
        height={10}
        barColorRules={RULES}
        dayReadings={[day(1, 0), day(2, 10), day(3, 60), day(4, 360)]}
      />,
    );

    const bars: Array<HTMLElement> = screen.getAllByTestId("uptime-bar");
    const barFor: (daysAgo: number) => HTMLElement = (
      daysAgo: number,
    ): HTMLElement => {
      return bars[9 - daysAgo] as HTMLElement;
    };

    // Six hours down: the very dark red.
    expect(barFor(4)).toHaveStyle({ backgroundColor: "#7f1d1d" });
    expect(barFor(4)).toHaveAttribute(UPTIME_BAR_EDGE_ATTRIBUTE, "");
    expect(customProperty(barFor(4), UPTIME_BAR_EDGE_DARK_PROPERTY)).toBe(
      getUptimeBarEdgeOnDark("#7f1d1d"),
    );

    for (const daysAgo of [1, 2, 3]) {
      expect(barFor(daysAgo)).not.toHaveAttribute(UPTIME_BAR_EDGE_ATTRIBUTE);
    }

    // A day with no data: hatched grey, no edge.
    expect(barFor(6)).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(barFor(6)).not.toHaveAttribute(UPTIME_BAR_EDGE_ATTRIBUTE);
  });
});

describe("a group's rollup draws its status colour with them", () => {
  test("the rollup label carries the dark shade of its colour", () => {
    render(
      <ResourceGroupSection
        depth={0}
        name="Core services"
        rollupLabel="Offline"
        rollupColor={Moroon500.toString()}
        hasOwnResources={true}
        subGroupCount={0}
        resourcesElement={<div>resources</div>}
      />,
    );

    const label: HTMLElement = screen.getByText("Offline");

    expect(label).toHaveAttribute(STATUS_TEXT_ATTRIBUTE, "");
    expect(label).toHaveStyle({ color: Moroon500.toString() });
    expect(customProperty(label, STATUS_TEXT_DARK_PROPERTY)).toBe(
      getStatusTextColorOnDark(Moroon500),
    );
  });

  test("a rollup without a colour has nothing to swap", () => {
    render(
      <ResourceGroupSection
        depth={0}
        name="Core services"
        rollupLabel="All good"
        hasOwnResources={true}
        subGroupCount={0}
        resourcesElement={<div>resources</div>}
      />,
    );

    expect(screen.getByText("All good")).not.toHaveAttribute(
      STATUS_TEXT_ATTRIBUTE,
    );
  });

  test("every rule that swaps a status colour reads a property a component writes", () => {
    const read: Array<string> = [];

    for (const rule of [
      ...rulesFor(STATUS_TEXT_SELECTOR),
      ...rulesFor(BAR_EDGE_SELECTOR),
    ] as Array<StyleRule>) {
      for (const value of Object.values(rule.declarations)) {
        for (const match of value.matchAll(/var\((--[\w-]+)\)/g)) {
          read.push(match[1]!);
        }
      }
    }

    expect(read.sort()).toEqual(
      [STATUS_TEXT_DARK_PROPERTY, UPTIME_BAR_EDGE_DARK_PROPERTY].sort(),
    );
  });
});
