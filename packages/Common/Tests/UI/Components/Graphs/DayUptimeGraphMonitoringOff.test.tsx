/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import DayUptimeGraph, {
  DayReading,
  Event,
  MONITORING_OFF_BAR_CLASS_NAME,
  MONITORING_OFF_BAR_COLOR,
  NO_DATA_BAR_CLASS_NAME,
  NO_DATA_BAR_COLOR,
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import UptimeBarDayModal from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import { Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../../Types/Monitor/UptimeHistoryLabels";
import {
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
  HistoryChartBarColorRuleValues,
} from "../../../../Utils/StatusPage/HistoryChartBarColors";
import fs from "fs";
import path from "path";

/*
 * Contract under test - the uptime strip says "monitoring off" on a day a
 * monitor's monitoring was off, not "no data" (issue #7112).
 *
 *   - A day nothing was checked on, but monitoring was off for, is drawn in
 *     the monitoring-off grey with its own stripes - never the no-data
 *     hatch, never a status - and its name and tooltip say monitoring was
 *     off, in the words the caller hands in (the status page's "Not
 *     monitored").
 *   - A day off in part keeps the colour and uptime of the time that was
 *     checked, and its tooltip says for how long monitoring was off.
 *   - A day nothing was recorded on stays a day with no data.
 *   - The day dialog says what the tooltip says.
 *   - Painted from timeline rows, the same: the rows' spans with
 *     monitoring off, less what was checked.
 *
 * A UTC strip of ten days ending at a pinned "now", so bar indexes mean
 * days: bar 0 is Oct 17, bar 9 is today, Oct 26.
 */

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const START: Date = new Date("2026-10-17T15:30:00.000Z");
const HOUR: number = 3600;

function bars(): Array<HTMLElement> {
  return screen.getAllByTestId("uptime-bar");
}

function barOn(date: string): HTMLElement {
  const index: number = Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() -
      new Date("2026-10-17T00:00:00.000Z").getTime()) /
      (24 * HOUR * 1000),
  );

  return bars()[index] as HTMLElement;
}

function operational(seconds: number): StatusDuration {
  return {
    label: "Operational",
    seconds: seconds,
    color: Green,
    isDowntime: false,
    priority: 1,
  };
}

function offline(seconds: number): StatusDuration {
  return {
    label: "Offline",
    seconds: seconds,
    color: Red,
    isDowntime: true,
    priority: 3,
  };
}

function reading(data: {
  date: string;
  coveredSeconds: number;
  statusDurations?: Array<StatusDuration>;
  monitoringOffSeconds?: number | undefined;
}): DayReading {
  return {
    dayStart: new Date(`${data.date}T00:00:00.000Z`),
    daySeconds: 86400,
    coveredSeconds: data.coveredSeconds,
    statusDurations: data.statusDurations || [],
    monitoringOffSeconds: data.monitoringOffSeconds,
  };
}

type OnBarClick = (
  date: Date,
  incidents: Array<UptimeBarTooltipIncident>,
  summary: UptimeBarDaySummary,
) => void;

function renderStrip(
  props: Partial<React.ComponentProps<typeof DayUptimeGraph>> = {},
): { onBarClick: ReturnType<typeof jest.fn<OnBarClick>> } {
  const onBarClick: ReturnType<typeof jest.fn<OnBarClick>> =
    jest.fn<OnBarClick>();

  render(
    <DayUptimeGraph
      startDate={START}
      endDate={NOW}
      timezone="UTC"
      events={[]}
      defaultBarColor={Green}
      height={10}
      onBarClick={onBarClick}
      {...props}
    />,
  );

  return { onBarClick: onBarClick };
}

function summaryOf(
  onBarClick: ReturnType<typeof jest.fn<OnBarClick>>,
  bar: HTMLElement,
): UptimeBarDaySummary {
  onBarClick.mockClear();
  fireEvent.click(bar);
  return onBarClick.mock.calls[0]![2];
}

async function hover(bar: HTMLElement): Promise<HTMLElement> {
  fireEvent.mouseEnter(bar);

  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  return screen.getByRole("tooltip");
}

// The status page's words: its own "Not monitored", handed in.
const STATUS_PAGE_LABELS: UptimeHistoryLabels = {
  ...DefaultUptimeHistoryLabels,
  dayLabelMonitoringOff: "{{date}}: not monitored",
  dayLabelMonitoringOffWithIncidents:
    "{{date}}: not monitored, {{total}} incidents",
  monitoringOffOnThisDay: "Not monitored on this day",
  monitoringOffFor: "Not monitored for {{duration}}",
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a day a reading says monitoring was off for", () => {
  test("is drawn in the monitoring-off grey with its stripes, not as a day with no data", () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 0,
          monitoringOffSeconds: 86400,
        }),
      ],
    });

    const bar: HTMLElement = barOn("2026-10-21");

    expect(bar).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(bar).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(bar).toHaveStyle({
      backgroundColor: MONITORING_OFF_BAR_COLOR.toString(),
    });
    expect(bar).toHaveAttribute("data-monitoring-off", "true");
    expect(bar).toHaveAttribute("data-has-data", "false");
  });

  test("is named so for a screen reader, with its incidents", () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 0,
          monitoringOffSeconds: 86400,
        }),
        reading({
          date: "2026-10-22",
          coveredSeconds: 0,
          monitoringOffSeconds: 86400,
        }),
      ],
      incidents: [
        {
          id: "e7000000-0000-4000-8000-000000000001",
          title: "Declared by hand",
          declaredAt: new Date("2026-10-22T09:00:00.000Z"),
          incidentSeverity: { name: "Major", color: Red },
        } as unknown as UptimeBarTooltipIncident,
        {
          id: "e7000000-0000-4000-8000-000000000002",
          title: "Declared again",
          declaredAt: new Date("2026-10-22T10:00:00.000Z"),
          incidentSeverity: { name: "Major", color: Red },
        } as unknown as UptimeBarTooltipIncident,
      ],
    });

    expect(barOn("2026-10-21")).toHaveAttribute(
      "aria-label",
      "Oct 21, 2026: monitoring off",
    );
    expect(barOn("2026-10-22")).toHaveAttribute(
      "aria-label",
      "Oct 22, 2026: monitoring off, 2 incidents",
    );
  });

  test("its tooltip says monitoring was off, in place of no monitoring data", async () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 0,
          monitoringOffSeconds: 86400,
        }),
      ],
    });

    const tooltip: HTMLElement = await hover(barOn("2026-10-21"));

    expect(tooltip).toHaveTextContent("Monitoring was off on this day");
    expect(tooltip).not.toHaveTextContent("No monitoring data for this day");
    expect(tooltip).not.toHaveTextContent("Uptime");
  });

  test("says it in the caller's words: a status page's Not monitored", async () => {
    renderStrip({
      labels: STATUS_PAGE_LABELS,
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 0,
          monitoringOffSeconds: 86400,
        }),
      ],
    });

    expect(barOn("2026-10-21")).toHaveAttribute(
      "aria-label",
      "Oct 21, 2026: not monitored",
    );

    const tooltip: HTMLElement = await hover(barOn("2026-10-21"));

    expect(tooltip).toHaveTextContent("Not monitored on this day");
  });

  test("hands the dialog how long monitoring was off", () => {
    const { onBarClick } = renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 0,
          monitoringOffSeconds: 86400,
        }),
      ],
    });

    const summary: UptimeBarDaySummary = summaryOf(
      onBarClick,
      barOn("2026-10-21"),
    );

    expect(summary.hasEvents).toBe(false);
    expect(summary.monitoringOffSeconds).toBe(86400);
  });

  test("today, off since midnight, is a monitoring-off day too", () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-26",
          coveredSeconds: 0,
          monitoringOffSeconds: 15.5 * HOUR,
        }),
      ],
    });

    expect(barOn("2026-10-26")).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(barOn("2026-10-26")).toHaveAttribute(
      "aria-label",
      "Oct 26, 2026: monitoring off",
    );
  });
});

describe("a day monitoring was off for in part", () => {
  test("keeps the colour and the uptime of the time that was checked", () => {
    const { onBarClick } = renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 18 * HOUR,
          statusDurations: [operational(16 * HOUR), offline(2 * HOUR)],
          monitoringOffSeconds: 6 * HOUR,
        }),
      ],
    });

    const bar: HTMLElement = barOn("2026-10-21");

    expect(bar).not.toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(bar).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(bar).toHaveAttribute("data-monitoring-off", "false");
    expect(bar).toHaveStyle({ backgroundColor: Red.toString() });

    const summary: UptimeBarDaySummary = summaryOf(onBarClick, bar);

    // 16 of the 18 checked hours: the six hours off are no time at all.
    expect(summary.uptimePercent).toBeCloseTo((16 / 18) * 100, 9);
    expect(summary.monitoringOffSeconds).toBe(6 * HOUR);
    expect(bar.getAttribute("aria-label")).toContain("88.89% uptime");
  });

  test("its tooltip says for how long monitoring was off, after how the day went", async () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 18 * HOUR,
          statusDurations: [operational(18 * HOUR)],
          monitoringOffSeconds: 6 * HOUR,
        }),
      ],
    });

    const tooltip: HTMLElement = await hover(barOn("2026-10-21"));

    expect(tooltip).toHaveTextContent("Uptime");
    // The number held to its unit (#8669), as every duration the summary writes.
    expect(
      screen.getByTestId("uptime-day-monitoring-off-for").textContent,
    ).toBe("Monitoring was off for 6\u00A0hours");
    expect(screen.queryByTestId("uptime-day-monitoring-off")).toBeNull();
  });

  test("with the recommended rules, the day is graded on its checked time alone", () => {
    renderStrip({
      barColorRules: RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
        (rule: HistoryChartBarColorRuleValues) => {
          return {
            uptimePercentGreaterThanOrEqualTo:
              rule.uptimePercentGreaterThanOrEqualTo,
            barColor: rule.barColor,
          };
        },
      ),
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 6 * HOUR,
          statusDurations: [operational(6 * HOUR)],
          monitoringOffSeconds: 18 * HOUR,
        }),
      ],
    });

    // Up for every hour it was checked: 100%, the top rule's colour.
    expect(barOn("2026-10-21")).toHaveStyle({
      backgroundColor:
        RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES[0]!.barColor.toString(),
    });
  });
});

describe("a day nothing was recorded on", () => {
  test("stays a day with no data, and says so", async () => {
    renderStrip({
      dayReadings: [reading({ date: "2026-10-21", coveredSeconds: 0 })],
    });

    const bar: HTMLElement = barOn("2026-10-21");

    expect(bar).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(bar).not.toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(bar).toHaveStyle({ backgroundColor: NO_DATA_BAR_COLOR.toString() });
    expect(bar).toHaveAttribute("data-monitoring-off", "false");
    expect(bar).toHaveAttribute("aria-label", "Oct 21, 2026: no data");

    const tooltip: HTMLElement = await hover(bar);

    expect(tooltip).toHaveTextContent("No monitoring data for this day");
    expect(tooltip).not.toHaveTextContent("Monitoring was off");
  });

  test("less than a second with monitoring off is no time worth saying", () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 0,
          monitoringOffSeconds: 0.4,
        }),
      ],
    });

    expect(barOn("2026-10-21")).toHaveClass(NO_DATA_BAR_CLASS_NAME);
  });
});

describe("painted from timeline rows", () => {
  const MONITOR_A: ObjectID = new ObjectID(
    "e7100000-0000-4000-8000-000000000001",
  );
  const UP_STATUS: ObjectID = new ObjectID(
    "e7200000-0000-4000-8000-000000000001",
  );

  function upEvent(startsAt: string, endsAt: string): Event {
    return {
      startDate: new Date(startsAt),
      endDate: new Date(endsAt),
      label: "Operational",
      priority: 1,
      color: Green,
      eventStatusId: UP_STATUS,
      monitorId: MONITOR_A,
    } as unknown as Event;
  }

  test("a day the rows' spans with monitoring off cover, and nothing checked, is a monitoring-off day", () => {
    const { onBarClick } = renderStrip({
      events: [upEvent("2026-10-17T00:00:00.000Z", "2026-10-20T00:00:00.000Z")],
      monitoringOffSpans: [
        {
          startDate: new Date("2026-10-20T00:00:00.000Z"),
          endDate: new Date("2026-10-23T12:00:00.000Z"),
        },
      ],
    });

    expect(barOn("2026-10-19")).not.toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(barOn("2026-10-21")).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(barOn("2026-10-21")).toHaveAttribute(
      "aria-label",
      "Oct 21, 2026: monitoring off",
    );
    expect(
      summaryOf(onBarClick, barOn("2026-10-23")).monitoringOffSeconds,
    ).toBe(12 * HOUR);
    // After the span, nothing at all: no data.
    expect(barOn("2026-10-25")).toHaveClass(NO_DATA_BAR_CLASS_NAME);
  });

  test("a group's day counts only the time no monitor was checked", () => {
    const { onBarClick } = renderStrip({
      // Another monitor of the group was checked until 18:00.
      events: [upEvent("2026-10-21T00:00:00.000Z", "2026-10-21T18:00:00.000Z")],
      monitoringOffSpans: [
        {
          startDate: new Date("2026-10-21T00:00:00.000Z"),
          endDate: new Date("2026-10-22T00:00:00.000Z"),
        },
      ],
    });

    const summary: UptimeBarDaySummary = summaryOf(
      onBarClick,
      barOn("2026-10-21"),
    );

    expect(summary.hasEvents).toBe(true);
    expect(summary.monitoringOffSeconds).toBe(6 * HOUR);
    expect(barOn("2026-10-21")).not.toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
  });

  test("a day's reading wins over the rows: it says how long monitoring was off", () => {
    const { onBarClick } = renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-21",
          coveredSeconds: 86400,
          statusDurations: [operational(86400)],
        }),
      ],
      monitoringOffSpans: [
        {
          startDate: new Date("2026-10-21T00:00:00.000Z"),
          endDate: new Date("2026-10-22T00:00:00.000Z"),
        },
      ],
    });

    expect(
      summaryOf(onBarClick, barOn("2026-10-21")).monitoringOffSeconds,
    ).toBe(0);
  });
});

describe("the day dialog says what the tooltip says", () => {
  test("a day monitoring was off", () => {
    render(
      <UptimeBarDayModal
        date={new Date("2026-10-21T12:00:00.000Z")}
        timezone="UTC"
        incidents={[]}
        onClose={() => {}}
        uptimePercent={0}
        hasEvents={false}
        statusDurations={[]}
        monitoringOffSeconds={86400}
        labels={STATUS_PAGE_LABELS}
      />,
    );

    expect(screen.getByTestId("uptime-day-monitoring-off")).toHaveTextContent(
      "Not monitored on this day",
    );
    expect(screen.queryByTestId("uptime-day-no-data")).toBeNull();
  });

  test("a day off in part", () => {
    render(
      <UptimeBarDayModal
        date={new Date("2026-10-21T12:00:00.000Z")}
        timezone="UTC"
        incidents={[]}
        onClose={() => {}}
        uptimePercent={100}
        hasEvents={true}
        statusDurations={[operational(18 * HOUR)]}
        monitoringOffSeconds={6 * HOUR}
      />,
    );

    expect(
      screen.getByTestId("uptime-day-monitoring-off-for").textContent,
    ).toBe("Monitoring was off for 6\u00A0hours");
  });

  test("a dialog opened without the time off reads as it always did", () => {
    render(
      <UptimeBarDayModal
        date={new Date("2026-10-21T12:00:00.000Z")}
        timezone="UTC"
        incidents={[]}
        onClose={() => {}}
        uptimePercent={0}
        hasEvents={false}
        statusDurations={[]}
      />,
    );

    expect(screen.getByTestId("uptime-day-no-data")).toHaveTextContent(
      "No monitoring data for this day",
    );
    expect(screen.queryByTestId("uptime-day-monitoring-off")).toBeNull();
  });
});

describe("the look of a day monitoring was off", () => {
  const CSS: string = fs
    .readFileSync(
      path.resolve(
        __dirname,
        "../../../../UI/Components/Graphs/DayUptimeGraph.css",
      ),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ");

  test("is the Status Timeline's thin dark stripes over the bar's own grey", () => {
    expect(CSS).toContain(
      `.${MONITORING_OFF_BAR_CLASS_NAME} { background-image: repeating-linear-gradient( 135deg, rgba(75, 85, 99, 0.45) 0, rgba(75, 85, 99, 0.45) 1px, transparent 1px, transparent 4px ); }`,
    );

    for (const rule of CSS.split("}").filter((candidate: string) => {
      return candidate.includes(`.${MONITORING_OFF_BAR_CLASS_NAME}`);
    })) {
      expect(rule).not.toContain("background-color");
    }
  });

  test("its grey is neither the no-data grey nor a colour a rule or a status paints", () => {
    const grey: string = MONITORING_OFF_BAR_COLOR.toString().toLowerCase();

    expect(grey).not.toBe(NO_DATA_BAR_COLOR.toString().toLowerCase());
    expect(
      RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
        (rule: HistoryChartBarColorRuleValues): string => {
          return rule.barColor.toString().toLowerCase();
        },
      ),
    ).not.toContain(grey);
    expect(
      [Green, Red].map((color: Color): string => {
        return color.toString().toLowerCase();
      }),
    ).not.toContain(grey);
  });
});
