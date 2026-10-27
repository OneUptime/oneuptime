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
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import { Green } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeBarTooltipMaintenance from "../../../../Types/Monitor/UptimeBarTooltipMaintenance";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../../Types/Monitor/UptimeHistoryLabels";
import { MAINTENANCE_BAR_CLASS_NAME } from "../../../../Utils/StatusPage/HistoryChartBarColors";
import { ScheduledMaintenancePhaseOfState } from "../../../../Utils/ScheduledMaintenanceStart";

/*
 * Contract under test - the uptime strip tells a day of planned work from
 * an outage (issue #5236).
 *
 *   - Every day an event's planned window touches is marked with the
 *     maintenance band, and only those days; an event still in progress
 *     marks every day up to today.
 *   - The day's tooltip, and the summary handed to the day dialog, list the
 *     day's events; a screen reader hears them in the bar's name.
 *   - The day's colour and uptime are its statuses', untouched.
 *
 * A UTC strip of ten days ending at a pinned "now", so bar indexes mean
 * days: bar 0 is Oct 17, bar 9 is today, Oct 26.
 */

const NOW: Date = new Date("2026-10-26T15:30:00.000Z");
const START: Date = new Date("2026-10-17T15:30:00.000Z");

function bars(): Array<HTMLElement> {
  return screen.getAllByTestId("uptime-bar");
}

function barOn(date: string): HTMLElement {
  const index: number = Math.round(
    (new Date(`${date}T00:00:00.000Z`).getTime() -
      new Date("2026-10-17T00:00:00.000Z").getTime()) /
      (24 * 60 * 60 * 1000),
  );

  return bars()[index] as HTMLElement;
}

function maintenance(data: {
  id?: string;
  title?: string;
  startsAt: string;
  endsAt: string;
  phase?: ScheduledMaintenancePhaseOfState;
}): UptimeBarTooltipMaintenance {
  return {
    id: data.id || "e6000000-0000-4000-8000-000000000001",
    title: data.title || "Database upgrade",
    startsAt: new Date(data.startsAt),
    endsAt: new Date(data.endsAt),
    currentState: { name: "Completed", color: new Color("#16a34a") },
    phase: data.phase || ScheduledMaintenancePhaseOfState.Over,
    monitorIds: [new ObjectID("e6100000-0000-4000-8000-000000000001")],
  };
}

function fullDay(date: string, seconds: Array<StatusDuration>): DayReading {
  return {
    dayStart: new Date(`${date}T00:00:00.000Z`),
    daySeconds: 86400,
    coveredSeconds: 86400,
    statusDurations: seconds,
  };
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

function degraded(seconds: number): StatusDuration {
  return {
    label: "Degraded",
    seconds: seconds,
    color: new Color("#eab308"),
    isDowntime: true,
    priority: 2,
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
  OneUptimeDate.setUserTimezone("Europe/Paris" as Timezone);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(null);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("DayUptimeGraph - the maintenance band", () => {
  test("the strip covers the ten days it is pinned to", () => {
    renderStrip();

    expect(bars()).toHaveLength(10);
  });

  test("marks every day an event's window touches, and no other", () => {
    renderStrip({
      maintenanceEvents: [
        // 18:00 CEST on Oct 21 into the afternoon of Oct 23.
        maintenance({
          startsAt: "2026-10-21T16:00:00.000Z",
          endsAt: "2026-10-23T14:29:00.000Z",
        }),
      ],
    });

    const marked: Array<number> = bars()
      .map((bar: HTMLElement, index: number): number => {
        return bar.classList.contains(MAINTENANCE_BAR_CLASS_NAME) ? index : -1;
      })
      .filter((index: number): boolean => {
        return index >= 0;
      });

    // Oct 21, 22 and 23.
    expect(marked).toEqual([4, 5, 6]);

    for (const bar of bars()) {
      expect(bar).toHaveAttribute(
        "data-has-maintenance",
        bar.classList.contains(MAINTENANCE_BAR_CLASS_NAME) ? "true" : "false",
      );
    }
  });

  test("marks every day up to today for an event still in progress past its planned end", () => {
    renderStrip({
      maintenanceEvents: [
        maintenance({
          startsAt: "2026-10-24T22:00:00.000Z",
          endsAt: "2026-10-25T02:00:00.000Z",
          phase: ScheduledMaintenancePhaseOfState.InProgress,
        }),
      ],
    });

    expect(barOn("2026-10-23")).not.toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
    expect(barOn("2026-10-24")).toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
    expect(barOn("2026-10-25")).toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
    expect(barOn("2026-10-26")).toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
  });

  test("marks nothing without maintenance - the strip it always drew", () => {
    renderStrip();

    for (const bar of bars()) {
      expect(bar).not.toHaveClass(MAINTENANCE_BAR_CLASS_NAME);
      expect(bar).toHaveAttribute("data-has-maintenance", "false");
    }
  });

  test("leaves the day's colour and uptime to its statuses", () => {
    const readings: Array<DayReading> = [
      fullDay("2026-10-21", [degraded(8 * 3600), operational(16 * 3600)]),
    ];

    const { onBarClick } = renderStrip({
      dayReadings: readings,
      downtimeEventStatusIds: [],
      maintenanceEvents: [
        maintenance({
          startsAt: "2026-10-21T16:00:00.000Z",
          endsAt: "2026-10-22T00:00:00.000Z",
        }),
      ],
    });

    const bar: HTMLElement = barOn("2026-10-21");

    // The day's worst status, Degraded, as it would be without the event.
    expect(bar.style.backgroundColor).toBe("rgb(234, 179, 8)");

    fireEvent.click(bar);

    const summary: UptimeBarDaySummary = onBarClick.mock
      .calls[0]?.[2] as UptimeBarDaySummary;

    // Eight hours Degraded, counted as down: maintenance excuses none of it.
    expect(summary.uptimePercent).toBeCloseTo((16 / 24) * 100, 6);
  });
});

describe("DayUptimeGraph - the day's maintenance, told", () => {
  test("a bar's name counts the day's maintenance after everything else", () => {
    renderStrip({
      maintenanceEvents: [
        maintenance({
          id: "e6000000-0000-4000-8000-00000000000a",
          startsAt: "2026-10-21T06:00:00.000Z",
          endsAt: "2026-10-21T07:00:00.000Z",
        }),
        maintenance({
          id: "e6000000-0000-4000-8000-00000000000b",
          startsAt: "2026-10-22T06:00:00.000Z",
          endsAt: "2026-10-22T07:00:00.000Z",
        }),
        maintenance({
          id: "e6000000-0000-4000-8000-00000000000c",
          startsAt: "2026-10-22T09:00:00.000Z",
          endsAt: "2026-10-22T10:00:00.000Z",
        }),
      ],
    });

    expect(barOn("2026-10-21").getAttribute("aria-label")).toBe(
      "Oct 21, 2026 (UTC): no data, 1 scheduled maintenance event",
    );
    expect(barOn("2026-10-22").getAttribute("aria-label")).toBe(
      "Oct 22, 2026 (UTC): no data, 2 scheduled maintenance events",
    );
    expect(barOn("2026-10-23").getAttribute("aria-label")).toBe(
      "Oct 23, 2026 (UTC): no data",
    );
  });

  test("and after the incidents and the uptime on a measured day", () => {
    renderStrip({
      dayReadings: [fullDay("2026-10-21", [operational(86400)])],
      incidents: [
        {
          id: "e6200000-0000-4000-8000-000000000001",
          title: "Checkout API is down",
          declaredAt: new Date("2026-10-21T09:00:00.000Z"),
          monitorIds: [],
        },
      ],
      maintenanceEvents: [
        maintenance({
          startsAt: "2026-10-21T06:00:00.000Z",
          endsAt: "2026-10-21T07:00:00.000Z",
        }),
      ],
    });

    expect(barOn("2026-10-21").getAttribute("aria-label")).toBe(
      "Oct 21, 2026 (UTC): 100% uptime, 1 incidents, 1 scheduled maintenance event",
    );
  });

  test("in the caller's language", () => {
    const labels: UptimeHistoryLabels = {
      ...DefaultUptimeHistoryLabels,
      dayLabelNoData: "{{date}} : aucune donnée",
      dayLabelWithMaintenance: "{{label}} ; {{maintenance}}",
      oneMaintenanceEvent: "1 maintenance planifiée",
    };

    renderStrip({
      labels: labels,
      maintenanceEvents: [
        maintenance({
          startsAt: "2026-10-21T06:00:00.000Z",
          endsAt: "2026-10-21T07:00:00.000Z",
        }),
      ],
    });

    expect(barOn("2026-10-21").getAttribute("aria-label")).toBe(
      "Oct 21, 2026 (UTC) : aucune donnée ; 1 maintenance planifiée",
    );
  });

  test("the day dialog is handed the day's events, earliest first", () => {
    const { onBarClick } = renderStrip({
      maintenanceEvents: [
        maintenance({
          id: "e6000000-0000-4000-8000-00000000000d",
          title: "Evening window",
          startsAt: "2026-10-22T18:00:00.000Z",
          endsAt: "2026-10-22T19:00:00.000Z",
        }),
        maintenance({
          id: "e6000000-0000-4000-8000-00000000000e",
          title: "Morning window",
          startsAt: "2026-10-22T06:00:00.000Z",
          endsAt: "2026-10-22T07:00:00.000Z",
        }),
        maintenance({
          id: "e6000000-0000-4000-8000-00000000000f",
          title: "Another day",
          startsAt: "2026-10-24T06:00:00.000Z",
          endsAt: "2026-10-24T07:00:00.000Z",
        }),
      ],
    });

    fireEvent.click(barOn("2026-10-22"));

    const summary: UptimeBarDaySummary = onBarClick.mock
      .calls[0]?.[2] as UptimeBarDaySummary;

    expect(
      summary.maintenanceEvents.map(
        (item: UptimeBarTooltipMaintenance): string => {
          return item.title;
        },
      ),
    ).toEqual(["Morning window", "Evening window"]);

    fireEvent.click(barOn("2026-10-23"));

    expect(
      (onBarClick.mock.calls[1]?.[2] as UptimeBarDaySummary).maintenanceEvents,
    ).toEqual([]);
  });

  test("the tooltip lists the day's events, and opens one", async () => {
    const onMaintenanceClick: ReturnType<typeof jest.fn<(id: string) => void>> =
      jest.fn<(id: string) => void>();

    renderStrip({
      onMaintenanceClick: onMaintenanceClick,
      maintenanceEvents: [
        maintenance({
          id: "e6000000-0000-4000-8000-000000000010",
          title: "PHP security patches",
          startsAt: "2026-10-21T16:00:00.000Z",
          endsAt: "2026-10-21T18:00:00.000Z",
        }),
      ],
    });

    fireEvent.mouseEnter(barOn("2026-10-21"));

    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    const tooltip: HTMLElement = screen.getByRole("tooltip");

    expect(tooltip).toHaveTextContent("Scheduled maintenance");
    expect(tooltip).toHaveTextContent("PHP security patches");
    expect(tooltip).toHaveTextContent("Oct 21, 18:00 – 20:00 CEST");
    expect(tooltip).toHaveTextContent("Completed");

    fireEvent.click(
      screen.getByRole("button", { name: /PHP security patches/ }),
    );

    expect(onMaintenanceClick).toHaveBeenCalledWith(
      "e6000000-0000-4000-8000-000000000010",
    );
  });

  test("a day without maintenance has none in its tooltip", async () => {
    renderStrip({
      maintenanceEvents: [
        maintenance({
          startsAt: "2026-10-21T16:00:00.000Z",
          endsAt: "2026-10-21T18:00:00.000Z",
        }),
      ],
    });

    fireEvent.mouseEnter(barOn("2026-10-20"));

    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByRole("tooltip")).not.toHaveTextContent(
      "Scheduled maintenance",
    );
  });
});
