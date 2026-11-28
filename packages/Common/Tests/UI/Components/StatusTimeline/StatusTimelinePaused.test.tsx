/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import MonitoringOffIndicator, {
  getMonitoringOffIndicatorText,
  MONITORING_OFF_TEXT,
  PAUSED_BY_TEXTS,
  PAUSED_TEXT,
} from "../../../../UI/Components/StateTimeline/MonitoringOffIndicator";
import StatusTimeline, {
  StatusTimelineDisplayEntry,
} from "../../../../UI/Components/StatusTimeline/StatusTimeline";
import StatusTimelineLegend from "../../../../UI/Components/StatusTimeline/StatusTimelineLegend";
import {
  ResolvedStatusTimelineEntry,
  StatusTimelineSummary,
  StatusTimelineWindow,
  resolveStatusTimelineEntries,
  summarizeStatusTimeline,
} from "../../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import MonitorPausedBy from "../../../../Types/Monitor/MonitorPausedBy";

/*
 * A MONITOR'S STATUS TIMELINE, WHERE A PAUSE LEFT ITS TIME OUT (issue
 * #11433).
 *
 * A status event whose time is left out of uptime was marked Monitoring Off
 * whatever left it out. One a pause left out - an incident declared by hand
 * or scheduled maintenance that paused the checks with no status set - is
 * marked as paused now, and by what: its pill says "Paused for
 * Maintenance", the band's accessible name says "paused", and the legend
 * names that time Paused, apart from the time monitoring was turned off.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
const NOW: Date = new Date("2026-10-14T08:36:00.000Z");

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

const WINDOW: StatusTimelineWindow = { start: at(-7 * DAY), end: NOW };

const ENTRIES: Array<StatusTimelineDisplayEntry> = [
  {
    id: "paused-now",
    statusKey: "operational",
    name: "Operational",
    color: "#10b981",
    startsAt: at(-1 * DAY),
    endsAt: null,
    rank: 1,
    isMonitoringOff: true,
    pausedBy: MonitorPausedBy.ScheduledMaintenance,
  },
  {
    id: "off",
    statusKey: "operational",
    name: "Operational",
    color: "#10b981",
    startsAt: at(-3 * DAY),
    endsAt: at(-1 * DAY),
    rank: 1,
    isMonitoringOff: true,
  },
  {
    id: "paused-by-incident",
    statusKey: "offline",
    name: "Offline",
    color: "#ef4444",
    startsAt: at(-4 * DAY),
    endsAt: at(-3 * DAY),
    rank: 3,
    isMonitoringOff: true,
    pausedBy: MonitorPausedBy.Incident,
  },
  {
    id: "up",
    statusKey: "operational",
    name: "Operational",
    color: "#10b981",
    startsAt: at(-7 * DAY),
    endsAt: at(-4 * DAY),
    rank: 1,
  },
];

afterEach(() => {
  cleanup();
});

describe("the pill", () => {
  test("names what paused the monitor, and keeps Monitoring Off for monitoring turned off", () => {
    expect(getMonitoringOffIndicatorText(undefined)).toBe(MONITORING_OFF_TEXT);
    expect(getMonitoringOffIndicatorText(null)).toBe("Monitoring Off");
    expect(getMonitoringOffIndicatorText(MonitorPausedBy.Incident)).toBe(
      "Paused by Incident",
    );
    expect(
      getMonitoringOffIndicatorText(MonitorPausedBy.ScheduledMaintenance),
    ).toBe("Paused for Maintenance");
    expect(
      getMonitoringOffIndicatorText(
        MonitorPausedBy.IncidentAndScheduledMaintenance,
      ),
    ).toBe("Paused by Incident and Maintenance");
    // A value no release writes is no pause.
    expect(getMonitoringOffIndicatorText("Holiday")).toBe(MONITORING_OFF_TEXT);

    // Every reason has words, and none says "off".
    for (const text of Object.values(PAUSED_BY_TEXTS)) {
      expect(text.toLowerCase()).toContain("paused");
      expect(text.toLowerCase()).not.toContain("off");
    }
    expect(PAUSED_TEXT).toBe("Paused");
  });

  test("drawn with what paused it, for a reader and for a test", () => {
    render(
      <>
        <MonitoringOffIndicator
          pausedBy={MonitorPausedBy.ScheduledMaintenance}
        />
        <MonitoringOffIndicator />
      </>,
    );

    const [paused, off] = screen.getAllByTestId("monitoring-off-indicator");

    expect(paused).toHaveTextContent("Paused for Maintenance");
    expect(paused).toHaveAttribute(
      "data-paused-by",
      MonitorPausedBy.ScheduledMaintenance,
    );
    expect(off).toHaveTextContent("Monitoring Off");
    expect(off).not.toHaveAttribute("data-paused-by");
  });
});

describe("the legend", () => {
  function summaryOf(
    entries: Array<StatusTimelineDisplayEntry>,
  ): StatusTimelineSummary {
    const resolved: Array<ResolvedStatusTimelineEntry> =
      resolveStatusTimelineEntries(entries, NOW);

    return summarizeStatusTimeline({
      entries: resolved,
      window: WINDOW,
      now: NOW,
    });
  }

  test("the summary counts paused time apart, inside the time off", () => {
    const summary: StatusTimelineSummary = summaryOf(ENTRIES);

    expect(summary.monitoringOffMs).toBe(4 * DAY);
    expect(summary.monitoringOffCount).toBe(3);
    expect(summary.pausedMs).toBe(2 * DAY);
    expect(summary.pausedCount).toBe(2);
    expect(summary.measuredMs).toBe(3 * DAY);
  });

  test("Paused and Monitoring Off each as long as they lasted, when both were there", () => {
    render(
      <StatusTimelineLegend summary={summaryOf(ENTRIES)} showShare={true} />,
    );

    expect(
      screen.getByTestId("status-timeline-legend-paused"),
    ).toHaveTextContent(/^Paused\s*2 days?/);
    expect(
      screen.getByTestId("status-timeline-legend-monitoring-off"),
    ).toHaveTextContent(/^Monitoring Off\s*2 days?/);
  });

  test("only paused time: Paused alone, no Monitoring Off", () => {
    render(
      <StatusTimelineLegend
        summary={summaryOf(
          ENTRIES.filter((entry: StatusTimelineDisplayEntry): boolean => {
            return entry.id !== "off";
          }),
        )}
        showShare={true}
      />,
    );

    expect(
      screen.getByTestId("status-timeline-legend-paused"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("status-timeline-legend-monitoring-off"),
    ).toBeNull();
  });

  test("only monitoring turned off: Monitoring Off alone, as before", () => {
    render(
      <StatusTimelineLegend
        summary={summaryOf(
          ENTRIES.filter((entry: StatusTimelineDisplayEntry): boolean => {
            return !entry.pausedBy;
          }),
        )}
        showShare={true}
      />,
    );

    expect(
      screen.getByTestId("status-timeline-legend-monitoring-off"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("status-timeline-legend-paused")).toBeNull();
  });
});

describe("the list and the band", () => {
  function renderTimeline(): void {
    render(
      <StatusTimeline
        entries={ENTRIES}
        window={WINDOW}
        emptyMessage="No status recorded yet."
        ariaLabel="Status timeline of this monitor"
        now={NOW}
        isWindowed={true}
        showShare={true}
        onZoom={() => {}}
      />,
    );
  }

  test("each entry's pill says what it was: paused, and by what, or monitoring off", () => {
    renderTimeline();

    const pills: Array<string> = screen
      .getAllByTestId("monitoring-off-indicator")
      .map((pill: HTMLElement): string => {
        return pill.textContent || "";
      });

    expect(pills).toContain("Paused for Maintenance");
    expect(pills).toContain("Paused by Incident");
    expect(pills).toContain("Monitoring Off");
  });

  test("the band's marks are named paused, never monitoring off, for a pause", () => {
    renderTimeline();

    const names: Array<string> = Array.from(
      document.querySelectorAll("[aria-label]"),
    ).map((element: Element): string => {
      return element.getAttribute("aria-label") || "";
    });

    const paused: Array<string> = names.filter((name: string): boolean => {
      return name.includes(", paused,");
    });
    const off: Array<string> = names.filter((name: string): boolean => {
      return name.includes(", monitoring off,");
    });

    expect(paused.length).toBeGreaterThanOrEqual(2);
    expect(off.length).toBeGreaterThanOrEqual(1);
    // The pause in effect now runs on.
    expect(
      paused.some((name: string): boolean => {
        return (
          name.startsWith("Operational, paused, since") &&
          name.endsWith("Currently Active.")
        );
      }),
    ).toBe(true);
    // The incident's pause, over.
    expect(
      paused.some((name: string): boolean => {
        return name.startsWith("Offline, paused,");
      }),
    ).toBe(true);
  });

  test("the legend under the band names both", () => {
    renderTimeline();

    const legend: HTMLElement = screen
      .getByTestId("status-timeline-legend-paused")
      .closest("ul") as HTMLElement;

    expect(
      within(legend).getByTestId("status-timeline-legend-paused"),
    ).toHaveTextContent("Paused");
    expect(
      within(legend).getByTestId("status-timeline-legend-monitoring-off"),
    ).toHaveTextContent("Monitoring Off");
  });
});
