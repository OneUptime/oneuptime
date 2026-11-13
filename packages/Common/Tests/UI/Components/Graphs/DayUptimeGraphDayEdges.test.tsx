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
import type { Mock } from "jest-mock";
import DayUptimeGraph, {
  UptimeBarDaySummary,
} from "../../../../UI/Components/Graphs/DayUptimeGraph";
import { StatusDuration } from "../../../../UI/Components/Graphs/UptimeDaySummary";
import MonitorUptimeGraph from "../../../../UI/Components/MonitorGraphs/Uptime";
import { Green, Red } from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import ObjectID from "../../../../Types/ObjectID";
import UptimeBarTooltipIncident from "../../../../Types/Monitor/UptimeBarTooltipIncident";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import UptimeEvent from "../../../../Utils/Uptime/Event";

/*
 * Where a day of the uptime strip begins and ends, painted from events
 * (the Dashboard's monitor group page, and a status page row the server
 * sent no day readings for).
 *
 * Issue #6697: a monitor group's day added up to more than a day, or less.
 * Its merged timeline (WorstStatusTimeline) now turns at any instant, so
 * the strip has to count an event that starts on the stroke of midnight -
 * the test it used was strict at both ends and left such an event out of
 * every day - and measure a day to the next day's start, so a day covered
 * all through is 24 hours rather than 23:59:59.999.
 */

const NOW: Date = new Date("2026-11-11T12:00:00.000Z");
const DAY_MS: number = 24 * 60 * 60 * 1000;

const OPERATIONAL_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000003",
);

function event(
  status: "Operational" | "Offline",
  start: string,
  end: string,
): UptimeEvent {
  const isOffline: boolean = status === "Offline";

  return {
    startDate: new Date(start),
    endDate: new Date(end),
    label: status,
    priority: isOffline ? 3 : 1,
    color: isOffline ? Red : Green,
    eventStatusId: isOffline ? OFFLINE_ID : OPERATIONAL_ID,
  };
}

type OnBarClick = (
  date: Date,
  incidents: Array<UptimeBarTooltipIncident>,
  summary: UptimeBarDaySummary,
) => void;

function summaryOf(data: {
  events: Array<UptimeEvent>;
  incidents?: Array<UptimeBarTooltipIncident> | undefined;
  dayLabel: string;
}): UptimeBarDaySummary {
  const onBarClick: Mock<OnBarClick> = jest.fn<OnBarClick>();

  render(
    <DayUptimeGraph
      startDate={new Date("2026-11-05T12:00:00.000Z")}
      endDate={NOW}
      timezone="UTC"
      events={data.events}
      incidents={data.incidents}
      downtimeEventStatusIds={[OFFLINE_ID]}
      defaultBarColor={Green}
      onBarClick={onBarClick}
    />,
  );

  const bar: HTMLElement = screen
    .getAllByTestId("uptime-bar")
    .find((element: HTMLElement) => {
      return (element.getAttribute("aria-label") || "").startsWith(
        data.dayLabel,
      );
    })!;

  act(() => {
    fireEvent.click(bar);
  });

  return onBarClick.mock.calls[0]![2];
}

function secondsByLabel(summary: UptimeBarDaySummary): Record<string, number> {
  const seconds: Record<string, number> = {};

  for (const duration of summary.statusDurations) {
    seconds[duration.label] = duration.seconds;
  }

  return seconds;
}

describe("DayUptimeGraph: where a day begins and ends", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  test("an event that starts on the stroke of midnight and runs past the day is that day's", () => {
    const summary: UptimeBarDaySummary = summaryOf({
      events: [
        event(
          "Offline",
          "2026-11-08T00:00:00.000Z",
          "2026-11-10T06:00:00.000Z",
        ),
      ],
      dayLabel: "Nov 08, 2026",
    });

    expect(summary.hasEvents).toBe(true);
    expect(secondsByLabel(summary)).toEqual({ Offline: 86400 });
    expect(summary.uptimePercent).toBe(0);
  });

  test("a day covered all through is 24 hours, not 23:59:59.999", () => {
    const summary: UptimeBarDaySummary = summaryOf({
      events: [
        event(
          "Operational",
          "2026-11-01T00:00:00.000Z",
          "2026-11-11T12:00:00.000Z",
        ),
      ],
      dayLabel: "Nov 08, 2026",
    });

    expect(secondsByLabel(summary)).toEqual({ Operational: 86400 });
  });

  test("an event that ends on the stroke of midnight is not the next day's", () => {
    const summary: UptimeBarDaySummary = summaryOf({
      events: [
        event(
          "Offline",
          "2026-11-07T18:00:00.000Z",
          "2026-11-08T00:00:00.000Z",
        ),
        event(
          "Operational",
          "2026-11-08T00:00:00.000Z",
          "2026-11-11T12:00:00.000Z",
        ),
      ],
      dayLabel: "Nov 08, 2026",
    });

    expect(secondsByLabel(summary)).toEqual({ Operational: 86400 });
  });

  test("today reaches only as far as now, and an event still to come is no part of it", () => {
    const summary: UptimeBarDaySummary = summaryOf({
      events: [
        event(
          "Operational",
          "2026-11-11T00:00:00.000Z",
          "2026-11-11T12:00:00.000Z",
        ),
        // a closed row that runs into the future (clock skew) counts until now.
        event(
          "Offline",
          "2026-11-11T11:00:00.000Z",
          "2026-11-11T18:00:00.000Z",
        ),
        // and one wholly in the future counts for nothing.
        event(
          "Offline",
          "2026-11-11T15:00:00.000Z",
          "2026-11-11T16:00:00.000Z",
        ),
      ],
      dayLabel: "Nov 11, 2026",
    });

    expect(secondsByLabel(summary)).toEqual({
      Operational: 12 * 3600,
      Offline: 3600,
    });
  });

  test("an incident declared on the stroke of midnight is listed on the day it opens", () => {
    const incident: UptimeBarTooltipIncident = {
      id: "50000000-0000-4000-8000-000000000001",
      title: "Midnight outage",
      declaredAt: new Date("2026-11-08T00:00:00.000Z"),
      monitorIds: [],
    } as unknown as UptimeBarTooltipIncident;

    const summary: UptimeBarDaySummary = summaryOf({
      events: [
        event(
          "Operational",
          "2026-11-01T00:00:00.000Z",
          "2026-11-11T12:00:00.000Z",
        ),
      ],
      incidents: [incident],
      dayLabel: "Nov 08, 2026",
    });

    expect(summary.incidents).toHaveLength(1);
    expect(summary.incidents[0]!.title).toBe("Midnight outage");

    cleanup();

    const dayBefore: UptimeBarDaySummary = summaryOf({
      events: [
        event(
          "Operational",
          "2026-11-01T00:00:00.000Z",
          "2026-11-11T12:00:00.000Z",
        ),
      ],
      incidents: [incident],
      dayLabel: "Nov 07, 2026",
    });

    expect(dayBefore.incidents).toHaveLength(0);
  });
});

/*
 * A monitor group's strip, drawn from its monitors' rows, as the Dashboard's
 * monitor group page draws it: whatever the rows, a day adds up to the time
 * at least one monitor was recorded in it, at most the day.
 */
describe("MonitorUptimeGraph: a monitor group's day from its monitors' rows", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  function status(
    id: ObjectID,
    name: string,
    priority: number,
    color: Color,
  ): MonitorStatus {
    const monitorStatus: MonitorStatus = new MonitorStatus();
    monitorStatus.id = id;
    monitorStatus.name = name;
    monitorStatus.priority = priority;
    monitorStatus.color = color;
    return monitorStatus;
  }

  const OPERATIONAL: MonitorStatus = status(
    OPERATIONAL_ID,
    "Operational",
    1,
    Green,
  );
  const OFFLINE: MonitorStatus = status(OFFLINE_ID, "Offline", 3, Red);

  function row(data: {
    monitor: number;
    status: MonitorStatus;
    start: string;
    end?: string | undefined;
  }): MonitorStatusTimeline {
    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.monitorId = new ObjectID(
      `20000000-0000-4000-8000-${String(data.monitor).padStart(12, "0")}`,
    );
    timeline.monitorStatusId = data.status.id!;
    timeline.monitorStatus = data.status;
    timeline.startsAt = new Date(data.start);

    if (data.end) {
      timeline.endsAt = new Date(data.end);
    }

    return timeline;
  }

  test("eight monitors Offline all day and one Operational read one day of Offline", () => {
    const rows: Array<MonitorStatusTimeline> = [];

    for (let monitor: number = 1; monitor <= 8; monitor++) {
      rows.push(
        row({
          monitor,
          status: OPERATIONAL,
          start: "2026-11-01T00:00:00.000Z",
          end: new Date(
            Date.parse("2026-11-08T00:00:00.000Z") - monitor * 3600_000,
          ).toISOString(),
        }),
        row({
          monitor,
          status: OFFLINE,
          start: new Date(
            Date.parse("2026-11-08T00:00:00.000Z") - monitor * 3600_000,
          ).toISOString(),
          end: new Date(
            Date.parse("2026-11-09T00:00:00.000Z") + monitor * 3600_000,
          ).toISOString(),
        }),
        row({
          monitor,
          status: OPERATIONAL,
          start: new Date(
            Date.parse("2026-11-09T00:00:00.000Z") + monitor * 3600_000,
          ).toISOString(),
        }),
      );
    }

    rows.push(
      row({
        monitor: 9,
        status: OPERATIONAL,
        start: "2026-11-01T00:00:00.000Z",
      }),
    );

    const onBarClick: Mock<OnBarClick> = jest.fn<OnBarClick>();

    render(
      <MonitorUptimeGraph
        items={rows}
        startDate={new Date("2026-11-05T12:00:00.000Z")}
        endDate={NOW}
        uptimeTimezone="UTC"
        defaultBarColor={Green}
        downtimeMonitorStatuses={[OFFLINE]}
        onBarClick={onBarClick}
      />,
    );

    const totalsByDay: Record<string, number> = {};

    for (const bar of screen.getAllByTestId("uptime-bar")) {
      act(() => {
        fireEvent.click(bar);
      });

      const summary: UptimeBarDaySummary =
        onBarClick.mock.calls[onBarClick.mock.calls.length - 1]![2];
      const label: string = (bar.getAttribute("aria-label") || "").split(
        ":",
      )[0]!;

      totalsByDay[label] = summary.statusDurations.reduce(
        (sum: number, duration: StatusDuration) => {
          return sum + duration.seconds;
        },
        0,
      );

      if (label === "Nov 08, 2026") {
        expect(
          summary.statusDurations.map((duration: StatusDuration) => {
            return [duration.label, duration.seconds];
          }),
        ).toEqual([["Offline", 86400]]);
      }

      if (label === "Nov 07, 2026") {
        // eight hours of it Offline: monitor 8's outage started at 16:00.
        expect(summary.uptimePercent).toBeCloseTo((16 / 24) * 100, 6);
      }
    }

    for (const [label, total] of Object.entries(totalsByDay)) {
      expect([label, total <= 86400]).toEqual([label, true]);
    }

    // the window's last day reaches only as far as now: noon.
    expect(totalsByDay["Nov 11, 2026"]).toBe(12 * 3600);
    expect(DAY_MS).toBe(86400 * 1000);
  });
});
