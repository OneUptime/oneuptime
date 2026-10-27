import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import DayUptimeGraph, {
  BarChartRule,
  DayReading,
  NO_DATA_BAR_CLASS_NAME,
  NO_DATA_BAR_COLOR,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import {
  HistoryChartBarColorRuleValues,
  MAINTENANCE_BAR_CLASS_NAME,
  MAINTENANCE_MARK_COLOR,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
} from "../../../../Utils/StatusPage/HistoryChartBarColors";
import UptimeBarTooltipMaintenance from "../../../../Types/Monitor/UptimeBarTooltipMaintenance";
import ObjectID from "../../../../Types/ObjectID";
import { ScheduledMaintenancePhaseOfState } from "../../../../Utils/ScheduledMaintenanceStart";
import fs from "fs";
import path from "path";

/*
 * The colours of the uptime strip on a status page (issue #486).
 *
 *   - A day with no data is grey AND hatched. The grey alone is as light as
 *     the green a good day is drawn in, and to a reader with red-green
 *     colour blindness that green is grey as well - a day nobody measured
 *     read as a good one to them.
 *   - With the recommended rules a day is graded by how long it was down:
 *     two minutes offline no longer turn a whole day the red of a day spent
 *     offline.
 */

const END_DATE: Date = OneUptimeDate.getCurrentDate();
const START_DATE: Date = OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, 9);

// A CSS comment, and a run of whitespace, as the stylesheet is read flat.
const CSS_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const WHITESPACE_RUN: RegExp = /\s+/g;

// The strip's stylesheet, comments out and on one line.
function readGraphCss(): string {
  return fs
    .readFileSync(
      path.resolve(
        __dirname,
        "../../../../UI/Components/Graphs/DayUptimeGraph.css",
      ),
      "utf8",
    )
    .replace(CSS_COMMENT, "")
    .replace(WHITESPACE_RUN, " ");
}

const OPERATIONAL_COLOR: Color = Green;
const OFFLINE_COLOR: Color = Red;

const RECOMMENDED_RULES: Array<BarChartRule> =
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
    (rule: HistoryChartBarColorRuleValues): BarChartRule => {
      return {
        uptimePercentGreaterThanOrEqualTo:
          rule.uptimePercentGreaterThanOrEqualTo,
        barColor: rule.barColor,
      };
    },
  );

function operational(seconds: number): StatusDuration {
  return {
    label: "Operational",
    seconds: seconds,
    color: OPERATIONAL_COLOR,
    isDowntime: false,
    priority: 1,
  };
}

function offline(seconds: number): StatusDuration {
  return {
    label: "Offline",
    seconds: seconds,
    color: OFFLINE_COLOR,
    isDowntime: true,
    priority: 3,
  };
}

// A full day, `daysAgo` before today, with `minutesDown` of it Offline.
function dayWithDowntime(daysAgo: number, minutesDown: number): DayReading {
  const down: number = minutesDown * 60;

  return {
    dayStart: OneUptimeDate.getStartOfDay(
      OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, daysAgo),
    ),
    daySeconds: 86400,
    coveredSeconds: 86400,
    statusDurations: [operational(86400 - down), offline(down)].filter(
      (duration: StatusDuration): boolean => {
        return duration.seconds > 0;
      },
    ),
  };
}

function renderStrip(
  props: Partial<React.ComponentProps<typeof DayUptimeGraph>> = {},
): void {
  render(
    <DayUptimeGraph
      startDate={START_DATE}
      endDate={END_DATE}
      events={[]}
      defaultBarColor={Green}
      height={10}
      {...props}
    />,
  );
}

// The window is ten days ending today, so the day `daysAgo` is this bar.
function barFor(daysAgo: number): HTMLElement {
  return screen.getAllByTestId("uptime-bar")[9 - daysAgo] as HTMLElement;
}

// An hour of scheduled maintenance, over, at noon `daysAgo` before today.
function maintenanceAt(daysAgo: number): UptimeBarTooltipMaintenance {
  const noon: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.getStartOfDay(
      OneUptimeDate.getSomeDaysAgoFromDate(END_DATE, daysAgo),
    ),
    12,
  );

  return {
    id: `e4000000-0000-4000-8000-00000000000${daysAgo}`,
    title: "Database upgrade",
    startsAt: noon,
    endsAt: OneUptimeDate.addRemoveHours(noon, 1),
    currentState: { name: "Completed", color: Green },
    phase: ScheduledMaintenancePhaseOfState.Over,
    monitorIds: [new ObjectID("e4100000-0000-4000-8000-000000000001")],
  };
}

// jsdom reports a style colour as rgb().
function rgbOf(hex: string): string {
  const value: number = parseInt(hex.replace("#", ""), 16);

  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

afterEach(() => {
  cleanup();
});

describe("a day with no data is hatched, not only grey", () => {
  test("its bar carries the hatch over the no-data grey", () => {
    renderStrip({ dayReadings: [dayWithDowntime(1, 0)] });

    const bar: HTMLElement = barFor(5);

    expect(bar).toHaveAttribute("data-has-data", "false");
    expect(bar).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(bar).toHaveStyle({
      backgroundColor: NO_DATA_BAR_COLOR.toString(),
    });
  });

  test("so is a day with no events and no reading at all", () => {
    renderStrip();

    for (const bar of screen.getAllByTestId("uptime-bar")) {
      expect(bar).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    }
  });

  test("a measured day has no hatch, whatever its colour", () => {
    renderStrip({
      dayReadings: [dayWithDowntime(1, 0), dayWithDowntime(2, 600)],
    });

    for (const daysAgo of [1, 2]) {
      expect(barFor(daysAgo)).toHaveAttribute("data-has-data", "true");
      expect(barFor(daysAgo)).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
    }
  });

  test("rules never reach a day with no data: it stays hatched grey", () => {
    renderStrip({
      barColorRules: RECOMMENDED_RULES,
      dayReadings: [dayWithDowntime(1, 0)],
    });

    expect(barFor(5)).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(barFor(5)).toHaveStyle({
      backgroundColor: NO_DATA_BAR_COLOR.toString(),
    });
  });

  /*
   * jsdom draws no gradients, so the stripes themselves are read from the
   * stylesheet the strip imports: pale and see-through, over the grey the
   * bar keeps as its background colour.
   */
  test("the hatch is pale stripes in the strip's own stylesheet, so the grey still shows", () => {
    const graphSource: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../UI/Components/Graphs/DayUptimeGraph.tsx",
      ),
      "utf8",
    );
    const css: string = readGraphCss();

    expect(graphSource).toContain('import "./DayUptimeGraph.css";');
    expect(css).toContain(
      `.${NO_DATA_BAR_CLASS_NAME} { background-image: repeating-linear-gradient( 135deg, rgba(255, 255, 255, 0.55) 0, rgba(255, 255, 255, 0.55) 2px, transparent 2px, transparent 5px ); }`,
    );

    /*
     * Only the image: the colour stays the bar's own. Every rule that names
     * the no-data class is read, so a colour slipped into another one is
     * caught too; the maintenance band colours its own pseudo-element only.
     */
    const noDataRules: Array<string> = css
      .split("}")
      .filter((rule: string): boolean => {
        return rule.includes(`.${NO_DATA_BAR_CLASS_NAME}`);
      });

    expect(noDataRules.length).toBeGreaterThan(0);

    for (const rule of noDataRules) {
      expect(rule).not.toContain("background-color");
    }

    const colouredRules: Array<string> = css
      .split("}")
      .filter((rule: string): boolean => {
        return rule.includes("background-color");
      });

    for (const rule of colouredRules) {
      expect(rule).toContain(`.${MAINTENANCE_BAR_CLASS_NAME}::before`);
    }
  });
});

/*
 * A day with scheduled maintenance keeps its colour, and wears a blue band
 * across its top: a pseudo-element of its own, so the no-data hatch (a
 * background image) and the dark theme's edge (a box shadow) still show.
 */
describe("a day with scheduled maintenance wears a band, and keeps its colour", () => {
  const css: string = readGraphCss();

  test("the band is the maintenance blue, across the top of the bar, and lets clicks through", () => {
    expect(css).toContain(
      `.${MAINTENANCE_BAR_CLASS_NAME}::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 4px; background-color: ${MAINTENANCE_MARK_COLOR.toString().toLowerCase()}; pointer-events: none; }`,
    );
  });

  test("the dark theme draws it a shade lighter", () => {
    expect(css).toContain(
      `html.dark .${MAINTENANCE_BAR_CLASS_NAME}::before { background-color: #60a5fa; }`,
    );
  });

  test("the band is drawn on its own layer, never the bar's background or shadow", () => {
    const bandRules: Array<string> = css
      .split("}")
      .filter((rule: string): boolean => {
        return rule.includes(`.${MAINTENANCE_BAR_CLASS_NAME}`);
      });

    expect(bandRules.length).toBe(2);

    for (const rule of bandRules) {
      expect(rule).toContain("::before");
      expect(rule).not.toContain("box-shadow");
      expect(rule).not.toContain("background-image");
    }
  });

  test("a perfect day keeps the rules' green, and wears the band", () => {
    renderStrip({
      barColorRules: RECOMMENDED_RULES,
      dayReadings: [dayWithDowntime(2, 0)],
      maintenanceEvents: [maintenanceAt(2)],
    });

    expect(barFor(2)).toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
    expect(barFor(2)).toHaveAttribute("data-has-maintenance", "true");
    expect(barFor(2).style.backgroundColor).toBe(rgbOf("#22c55e"));
  });

  test("a day of downtime keeps its downtime colour under the band: maintenance is no excuse the bar makes", () => {
    renderStrip({
      barColorRules: RECOMMENDED_RULES,
      dayReadings: [dayWithDowntime(3, 1440)],
      maintenanceEvents: [maintenanceAt(3)],
    });

    expect(barFor(3)).toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
    expect(barFor(3).style.backgroundColor).toBe(rgbOf("#7f1d1d"));
  });

  test("a day with no data keeps its hatch under the band", () => {
    renderStrip({
      maintenanceEvents: [maintenanceAt(4)],
    });

    expect(barFor(4)).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(barFor(4)).toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
    expect(barFor(4)).toHaveStyle({
      backgroundColor: NO_DATA_BAR_COLOR.toString(),
    });
  });

  test("a day without maintenance has no band", () => {
    renderStrip({
      dayReadings: [dayWithDowntime(2, 0), dayWithDowntime(3, 0)],
      maintenanceEvents: [maintenanceAt(2)],
    });

    expect(barFor(3)).not.toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
    expect(barFor(3)).toHaveAttribute("data-has-maintenance", "false");
  });

  test("the band's blue is none of the colours a bar is drawn in", () => {
    const barColors: Array<string> = [
      ...RECOMMENDED_RULES.map((rule: BarChartRule): string => {
        return rule.barColor.toString().toLowerCase();
      }),
      NO_DATA_BAR_COLOR.toString().toLowerCase(),
      OPERATIONAL_COLOR.toString().toLowerCase(),
      OFFLINE_COLOR.toString().toLowerCase(),
    ];

    expect(barColors).not.toContain(
      MAINTENANCE_MARK_COLOR.toString().toLowerCase(),
    );
  });
});

describe("the recommended rules grade a day by how long it was down", () => {
  test.each([
    ["no downtime", 0, "#22c55e"],
    // The day the issue opened with.
    ["two minutes offline", 2, "#fde047"],
    ["an hour offline", 60, "#c2410c"],
    ["six hours offline", 360, "#7f1d1d"],
    ["the whole day offline", 1440, "#7f1d1d"],
  ] as Array<[string, number, string]>)(
    "%s",
    (_day: string, minutesDown: number, color: string) => {
      renderStrip({
        barColorRules: RECOMMENDED_RULES,
        dayReadings: [dayWithDowntime(3, minutesDown)],
      });

      expect(barFor(3)).toHaveStyle({ backgroundColor: color });
    },
  );

  test("without rules, two minutes offline still paint the whole day the Offline red", () => {
    renderStrip({ dayReadings: [dayWithDowntime(3, 2)] });

    expect(barFor(3)).toHaveStyle({
      backgroundColor: OFFLINE_COLOR.toString(),
    });
  });

  /*
   * The decimal column comes back from the database as text ("99.00"). The
   * strip compared it with `>=`, which reads text as the number it spells,
   * and the shared matcher it uses now does the same.
   */
  test("a rule whose percentage arrives as text matches as the number", () => {
    const rules: Array<BarChartRule> = [
      {
        uptimePercentGreaterThanOrEqualTo: "100.00" as unknown as number,
        barColor: new Color("#22c55e"),
      },
      {
        uptimePercentGreaterThanOrEqualTo: "0.00" as unknown as number,
        barColor: new Color("#7f1d1d"),
      },
    ];

    renderStrip({
      barColorRules: rules,
      dayReadings: [dayWithDowntime(1, 0), dayWithDowntime(2, 30)],
    });

    expect(barFor(1)).toHaveStyle({ backgroundColor: "#22c55e" });
    expect(barFor(2)).toHaveStyle({ backgroundColor: "#7f1d1d" });
  });

  test("a day no rule matches keeps the default bar colour, as it always has", () => {
    renderStrip({
      defaultBarColor: new Color("#123456"),
      barColorRules: [
        {
          uptimePercentGreaterThanOrEqualTo: 99,
          barColor: new Color("#22c55e"),
        },
      ],
      dayReadings: [dayWithDowntime(2, 360)],
    });

    expect(barFor(2)).toHaveStyle({ backgroundColor: "#123456" });
  });
});
