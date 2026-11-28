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
  within,
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
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import UptimeDaySummary, {
  StatusDuration,
} from "../../../../UI/Components/Graphs/UptimeDaySummary";
import UptimeBarDayModal from "../../../../UI/Components/MonitorGraphs/UptimeBarDayModal";
import { Green } from "../../../../Types/BrandColors";
import MonitorPausedBy from "../../../../Types/Monitor/MonitorPausedBy";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";

/*
 * Contract under test - the uptime strip says "paused", and why, on a day a
 * pause left out of uptime, and keeps "monitoring off" for a monitor turned
 * off (issue #11433).
 *
 *   - A day nothing was checked on because an incident declared by hand or
 *     scheduled maintenance paused the monitor with no status set is drawn
 *     as the day it is left out of uptime - the monitoring-off grey with its
 *     stripes - but named, summed up and opened as paused: by an incident,
 *     for scheduled maintenance, or by both.
 *   - A day paused in part keeps the colour and uptime of the time that was
 *     checked, and its tooltip and dialog say for how long it was paused, and
 *     why - beside how long monitoring was off, when it was that too.
 *   - A day both paused and with monitoring off is named for the one that
 *     left out more of it, and says how long each lasted.
 *   - Painted from timeline rows, the same: the rows' paused spans, less
 *     what was checked.
 *
 * A UTC strip of ten days ending at a pinned "now", so bar indexes mean
 * days: bar 0 is Oct 17, bar 9 is today, Oct 26.
 */

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const START: Date = new Date("2026-10-17T15:30:00.000Z");
const HOUR: number = 3600;
const DAY: number = 24 * HOUR;

function bars(): Array<HTMLElement> {
  return screen.getAllByTestId("uptime-bar");
}

function barOn(date: string): HTMLElement {
  const index: number = Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() -
      new Date("2026-10-17T00:00:00.000Z").getTime()) /
      (DAY * 1000),
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

function reading(data: {
  date: string;
  coveredSeconds: number;
  monitoringOffSeconds?: number | undefined;
  pausedSeconds?: number | undefined;
  pausedBy?: MonitorPausedBy | undefined;
}): DayReading {
  return {
    dayStart: new Date(`${data.date}T00:00:00.000Z`),
    daySeconds: DAY,
    coveredSeconds: data.coveredSeconds,
    statusDurations:
      data.coveredSeconds > 0 ? [operational(data.coveredSeconds)] : [],
    monitoringOffSeconds: data.monitoringOffSeconds,
    pausedSeconds: data.pausedSeconds,
    pausedBy: data.pausedBy,
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

const REASONS: Array<[MonitorPausedBy, string, string, string]> = [
  [
    MonitorPausedBy.ScheduledMaintenance,
    "paused for scheduled maintenance",
    "Monitoring was paused for scheduled maintenance on this day",
    "Paused for scheduled maintenance for",
  ],
  [
    MonitorPausedBy.Incident,
    "paused by an incident",
    "Monitoring was paused by an incident on this day",
    "Paused by an incident for",
  ],
  [
    MonitorPausedBy.IncidentAndScheduledMaintenance,
    "paused by an incident and scheduled maintenance",
    "Monitoring was paused by an incident and scheduled maintenance on this day",
    "Paused by an incident and scheduled maintenance for",
  ],
];

describe("a day a pause left out of uptime", () => {
  test.each(REASONS)(
    "%s: drawn as a day left out, named and summed up as paused, never monitoring off",
    async (
      pausedBy: MonitorPausedBy,
      name: string,
      onThisDay: string,
    ): Promise<void> => {
      const { onBarClick } = renderStrip({
        dayReadings: [
          reading({
            date: "2026-10-22",
            coveredSeconds: 0,
            monitoringOffSeconds: DAY,
            pausedSeconds: DAY,
            pausedBy: pausedBy,
          }),
        ],
      });

      const bar: HTMLElement = barOn("2026-10-22");

      // Left out of uptime: the monitoring-off grey, with its stripes.
      expect(bar).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
      expect(bar).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
      expect(bar).toHaveStyle({
        backgroundColor: MONITORING_OFF_BAR_COLOR.toString(),
      });
      expect(bar).toHaveAttribute("data-monitoring-off", "true");
      expect(bar).toHaveAttribute("data-paused-by", pausedBy);

      // Named as paused, and why.
      expect(bar).toHaveAttribute("aria-label", `Oct 22, 2026: ${name}`);
      expect(bar.getAttribute("aria-label")).not.toContain("monitoring off");

      // Its tooltip says so in place of "no monitoring data".
      const tooltip: HTMLElement = await hover(bar);
      expect(
        within(tooltip).getByTestId("uptime-day-paused"),
      ).toHaveTextContent(onThisDay);
      expect(tooltip).not.toHaveTextContent("Monitoring was off");
      expect(within(tooltip).queryByTestId("uptime-day-no-data")).toBeNull();

      // And the dialog is handed the same reading.
      const summary: UptimeBarDaySummary = summaryOf(onBarClick, bar);
      expect(summary.pausedSeconds).toBe(DAY);
      expect(summary.pausedBy).toBe(pausedBy);
      expect(summary.monitoringOffSeconds).toBe(DAY);
    },
  );

  test("with incidents that day, its name counts them", () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-22",
          coveredSeconds: 0,
          monitoringOffSeconds: DAY,
          pausedSeconds: DAY,
          pausedBy: MonitorPausedBy.Incident,
        }),
      ],
      incidents: [
        {
          id: "e7000000-0000-4000-8000-000000000001",
          title: "Checkout is failing",
          declaredAt: new Date("2026-10-22T09:00:00.000Z"),
          incidentSeverity: { name: "Major", color: Green },
        } as unknown as UptimeBarTooltipIncident,
      ],
    });

    expect(barOn("2026-10-22")).toHaveAttribute(
      "aria-label",
      "Oct 22, 2026: paused by an incident, 1 incidents",
    );
  });

  test.each(REASONS)(
    "%s for part of a day: its uptime of the checked time, and for how long it was paused, and why",
    async (
      pausedBy: MonitorPausedBy,
      _name: string,
      _onThisDay: string,
      forPrefix: string,
    ) => {
      renderStrip({
        dayReadings: [
          reading({
            date: "2026-10-22",
            coveredSeconds: 18 * HOUR,
            monitoringOffSeconds: 6 * HOUR,
            pausedSeconds: 6 * HOUR,
            pausedBy: pausedBy,
          }),
        ],
      });

      const bar: HTMLElement = barOn("2026-10-22");

      expect(bar).not.toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
      expect(bar).toHaveAttribute("aria-label", "Oct 22, 2026: 100% uptime");
      expect(bar).not.toHaveAttribute("data-paused-by");

      const tooltip: HTMLElement = await hover(bar);
      expect(
        within(tooltip).getByTestId("uptime-day-paused-for"),
      ).toHaveTextContent(`${forPrefix} 6 hours`);
      expect(
        within(tooltip).queryByTestId("uptime-day-monitoring-off-for"),
      ).toBeNull();
    },
  );

  test("monitoring turned off keeps its words: the reading says no pause", async () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-22",
          coveredSeconds: 0,
          monitoringOffSeconds: DAY,
        }),
      ],
    });

    const bar: HTMLElement = barOn("2026-10-22");

    expect(bar).toHaveAttribute("aria-label", "Oct 22, 2026: monitoring off");
    expect(bar).not.toHaveAttribute("data-paused-by");

    const tooltip: HTMLElement = await hover(bar);
    expect(
      within(tooltip).getByTestId("uptime-day-monitoring-off"),
    ).toHaveTextContent("Monitoring was off on this day");
    expect(within(tooltip).queryByTestId("uptime-day-paused")).toBeNull();
  });

  test("a day both paused and with monitoring off: named for the larger, and each part says how long", async () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-22",
          coveredSeconds: 0,
          monitoringOffSeconds: DAY,
          pausedSeconds: 16 * HOUR,
          pausedBy: MonitorPausedBy.ScheduledMaintenance,
        }),
        reading({
          date: "2026-10-23",
          coveredSeconds: 0,
          monitoringOffSeconds: DAY,
          pausedSeconds: 4 * HOUR,
          pausedBy: MonitorPausedBy.ScheduledMaintenance,
        }),
      ],
    });

    expect(barOn("2026-10-22")).toHaveAttribute(
      "aria-label",
      "Oct 22, 2026: paused for scheduled maintenance",
    );
    expect(barOn("2026-10-23")).toHaveAttribute(
      "aria-label",
      "Oct 23, 2026: monitoring off",
    );

    const tooltip: HTMLElement = await hover(barOn("2026-10-22"));
    const block: HTMLElement = within(tooltip).getByTestId("uptime-day-paused");

    expect(block).toHaveTextContent(
      "Monitoring was paused for scheduled maintenance on this day",
    );
    expect(
      within(block).getByTestId("uptime-day-paused-for"),
    ).toHaveTextContent("Paused for scheduled maintenance for 16 hours");
    expect(
      within(block).getByTestId("uptime-day-monitoring-off-for"),
    ).toHaveTextContent("Monitoring was off for 8 hours");
  });

  test("a day checked for part of it, then paused, then turned off: both lines under its uptime", async () => {
    renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-22",
          coveredSeconds: 12 * HOUR,
          monitoringOffSeconds: 12 * HOUR,
          pausedSeconds: 9 * HOUR,
          pausedBy: MonitorPausedBy.Incident,
        }),
      ],
    });

    const tooltip: HTMLElement = await hover(barOn("2026-10-22"));

    expect(
      within(tooltip).getByTestId("uptime-day-paused-for"),
    ).toHaveTextContent("Paused by an incident for 9 hours");
    expect(
      within(tooltip).getByTestId("uptime-day-monitoring-off-for"),
    ).toHaveTextContent("Monitoring was off for 3 hours");
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

  test("a day a paused span covers, and nothing checked, is a paused day, named for what paused it", () => {
    const { onBarClick } = renderStrip({
      events: [upEvent("2026-10-17T00:00:00.000Z", "2026-10-20T00:00:00.000Z")],
      monitoringOffSpans: [
        {
          startDate: new Date("2026-10-20T00:00:00.000Z"),
          endDate: new Date("2026-10-23T12:00:00.000Z"),
          pausedBy: MonitorPausedBy.ScheduledMaintenance,
        },
      ],
    });

    expect(barOn("2026-10-21")).toHaveClass(MONITORING_OFF_BAR_CLASS_NAME);
    expect(barOn("2026-10-21")).toHaveAttribute(
      "aria-label",
      "Oct 21, 2026: paused for scheduled maintenance",
    );

    const summary: UptimeBarDaySummary = summaryOf(
      onBarClick,
      barOn("2026-10-23"),
    );
    expect(summary.monitoringOffSeconds).toBe(12 * HOUR);
    expect(summary.pausedSeconds).toBe(12 * HOUR);
    expect(summary.pausedBy).toBe(MonitorPausedBy.ScheduledMaintenance);
  });

  test("an incident's pause and a span with monitoring off on one day: each counted as what it was", () => {
    const { onBarClick } = renderStrip({
      monitoringOffSpans: [
        {
          startDate: new Date("2026-10-22T00:00:00.000Z"),
          endDate: new Date("2026-10-22T20:00:00.000Z"),
          pausedBy: MonitorPausedBy.Incident,
        },
        {
          startDate: new Date("2026-10-22T20:00:00.000Z"),
          endDate: new Date("2026-10-23T00:00:00.000Z"),
          pausedBy: null,
        },
      ],
    });

    expect(barOn("2026-10-22")).toHaveAttribute(
      "aria-label",
      "Oct 22, 2026: paused by an incident",
    );

    const summary: UptimeBarDaySummary = summaryOf(
      onBarClick,
      barOn("2026-10-22"),
    );
    expect(summary.monitoringOffSeconds).toBe(DAY);
    expect(summary.pausedSeconds).toBe(20 * HOUR);
    expect(summary.pausedBy).toBe(MonitorPausedBy.Incident);
  });

  test("a day's reading wins over the rows", () => {
    const { onBarClick } = renderStrip({
      dayReadings: [
        reading({
          date: "2026-10-22",
          coveredSeconds: 0,
          monitoringOffSeconds: DAY,
        }),
      ],
      monitoringOffSpans: [
        {
          startDate: new Date("2026-10-22T00:00:00.000Z"),
          endDate: new Date("2026-10-23T00:00:00.000Z"),
          pausedBy: MonitorPausedBy.Incident,
        },
      ],
    });

    const summary: UptimeBarDaySummary = summaryOf(
      onBarClick,
      barOn("2026-10-22"),
    );
    expect(summary.pausedSeconds).toBe(0);
    expect(summary.pausedBy).toBeNull();
    expect(barOn("2026-10-22")).toHaveAttribute(
      "aria-label",
      "Oct 22, 2026: monitoring off",
    );
  });
});

describe("the day dialog says what the tooltip says", () => {
  test("a paused day, in place of no data, with for how long when it was also off", () => {
    render(
      <UptimeBarDayModal
        date={new Date("2026-10-22T00:00:00.000Z")}
        timezone="UTC"
        incidents={[]}
        uptimePercent={0}
        hasEvents={false}
        statusDurations={[]}
        monitoringOffSeconds={DAY}
        pausedSeconds={20 * HOUR}
        pausedBy={MonitorPausedBy.IncidentAndScheduledMaintenance}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("uptime-day-paused")).toHaveTextContent(
      "Monitoring was paused by an incident and scheduled maintenance on this day",
    );
    expect(screen.getByTestId("uptime-day-paused-for")).toHaveTextContent(
      "Paused by an incident and scheduled maintenance for 20 hours",
    );
    expect(
      screen.getByTestId("uptime-day-monitoring-off-for"),
    ).toHaveTextContent("Monitoring was off for 4 hours");
    expect(screen.queryByTestId("uptime-day-no-data")).toBeNull();
  });

  test("a dialog opened without what paused the day reads it as monitoring off, as before", () => {
    render(
      <UptimeBarDayModal
        date={new Date("2026-10-22T00:00:00.000Z")}
        timezone="UTC"
        incidents={[]}
        uptimePercent={0}
        hasEvents={false}
        statusDurations={[]}
        monitoringOffSeconds={DAY}
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("uptime-day-monitoring-off")).toHaveTextContent(
      "Monitoring was off on this day",
    );
  });
});

describe("UptimeDaySummary on its own", () => {
  test("no time left out: no paused block and no line", () => {
    render(
      <UptimeDaySummary
        uptimePercent={100}
        hasEvents={true}
        statusDurations={[operational(DAY)]}
      />,
    );

    expect(screen.queryByTestId("uptime-day-paused")).toBeNull();
    expect(screen.queryByTestId("uptime-day-paused-for")).toBeNull();
    expect(screen.queryByTestId("uptime-day-monitoring-off-for")).toBeNull();
  });

  test("a reason with no paused time, or paused time with no reason, says no pause", () => {
    render(
      <UptimeDaySummary
        uptimePercent={0}
        hasEvents={false}
        statusDurations={[]}
        monitoringOffSeconds={DAY}
        pausedSeconds={DAY}
        pausedBy={null}
      />,
    );

    expect(screen.getByTestId("uptime-day-monitoring-off")).toHaveTextContent(
      "Monitoring was off on this day",
    );
    expect(screen.queryByTestId("uptime-day-paused-for")).toBeNull();
  });
});
