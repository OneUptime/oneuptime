/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorOpenWorkCard, {
  mergeOpenWorkRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOpenWorkCard";
import {
  MonitorOpenWork,
  MonitorOpenWorkRow,
  MonitorOpenWorkSide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTypes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  failSection,
  forbidSection,
  getLoadingSection,
  OverviewSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";

/*
 * "What is open on this monitor right now", in the side column. Counts that
 * could not be read are "—", never 0; "Nothing open" is only said when both
 * sides were read and both are empty; and the newest few records from both
 * sides are merged into one list, newest first.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBJECT: string = MONITOR_ID.toString();
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const OLD_INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const ALERT_ID: string = "bbbbbbbb-0000-4000-8000-000000000001";

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

const INCIDENT_ROW: MonitorOpenWorkRow = {
  key: `incident-${INCIDENT_ID}`,
  kind: "Incident",
  id: INCIDENT_ID,
  title: "Checkout API is down",
  startedAt: minutesAgo(10),
  severityName: "Critical",
  severityColor: "#DC2626",
  stateName: "Identified",
};

const OLD_INCIDENT_ROW: MonitorOpenWorkRow = {
  key: `incident-${OLD_INCIDENT_ID}`,
  kind: "Incident",
  id: OLD_INCIDENT_ID,
  title: "Slow responses",
  startedAt: minutesAgo(180),
  severityName: "Minor",
  severityColor: "#F59E0B",
  stateName: "Acknowledged",
};

const ALERT_ROW: MonitorOpenWorkRow = {
  key: `alert-${ALERT_ID}`,
  kind: "Alert",
  id: ALERT_ID,
  title: "Response time above 2s",
  startedAt: minutesAgo(60),
  severityName: "High",
  severityColor: "#EA580C",
  stateName: "Created",
};

const side: (
  count: number,
  rows?: Array<MonitorOpenWorkRow>,
) => OverviewSection<MonitorOpenWorkSide> = (
  count: number,
  rows?: Array<MonitorOpenWorkRow>,
): OverviewSection<MonitorOpenWorkSide> => {
  return resolveSection<MonitorOpenWorkSide>({
    value: { count: count, rows: rows || [] },
    subjectId: SUBJECT,
  });
};

const FORBIDDEN: OverviewSection<MonitorOpenWorkSide> =
  forbidSection<MonitorOpenWorkSide>({
    reason: "You do not have permission to read this Incident.",
    subjectId: SUBJECT,
  });

const renderCard: (openWork: MonitorOpenWork) => void = (
  openWork: MonitorOpenWork,
): void => {
  render(
    <MemoryRouter>
      <MonitorOpenWorkCard monitorId={MONITOR_ID} openWork={openWork} />
    </MemoryRouter>,
  );
};

const routeFor: (pageMap: PageMap, id: ObjectID) => string = (
  pageMap: PageMap,
  id: ObjectID,
): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: id,
  }).toString();
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("MonitorOpenWorkCard", () => {
  test("counts link to the full lists, and rows from both sides merge newest first", () => {
    renderCard({
      incidents: side(2, [INCIDENT_ROW, OLD_INCIDENT_ROW]),
      alerts: side(1, [ALERT_ROW]),
    });

    expect(
      screen.getByRole("heading", { name: "Open incidents & alerts" }),
    ).toBeInTheDocument();

    const incidentCount: HTMLElement = screen.getByTestId(
      "monitor-open-incident-count",
    );
    expect(incidentCount).toHaveTextContent("2");
    expect(incidentCount).toHaveClass("text-red-700");
    expect(incidentCount.closest("a")).toHaveAttribute(
      "href",
      routeFor(PageMap.MONITOR_VIEW_INCIDENTS, MONITOR_ID),
    );

    const alertCount: HTMLElement = screen.getByTestId(
      "monitor-open-alert-count",
    );
    expect(alertCount).toHaveTextContent("1");
    expect(alertCount).toHaveClass("text-amber-700");
    expect(alertCount.closest("a")).toHaveAttribute(
      "href",
      routeFor(PageMap.MONITOR_VIEW_ALERTS, MONITOR_ID),
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "monitor-open-work-row",
    );
    expect(
      rows.map((row: HTMLElement) => {
        return within(row).getByRole("link").textContent;
      }),
    ).toEqual([
      "Checkout API is down",
      "Response time above 2s",
      "Slow responses",
    ]);

    expect(
      within(rows[0]!).getByRole("link", { name: "Checkout API is down" }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.INCIDENT_VIEW, new ObjectID(INCIDENT_ID)),
    );
    expect(
      within(rows[1]!).getByRole("link", { name: "Response time above 2s" }),
    ).toHaveAttribute(
      "href",
      routeFor(PageMap.ALERT_VIEW, new ObjectID(ALERT_ID)),
    );

    expect(rows[0]).toHaveTextContent("Incident · Identified · 10 minutes ago");
    expect(rows[1]).toHaveTextContent("Alert · Created · an hour ago");

    // The severity colour is inline on a dot, never a class.
    const dot: HTMLElement = rows[0]!.querySelector(
      "[aria-hidden='true']",
    ) as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(220, 38, 38)");

    expect(screen.getByRole("link", { name: "All incidents" })).toHaveAttribute(
      "href",
      routeFor(PageMap.MONITOR_VIEW_INCIDENTS, MONITOR_ID),
    );
    expect(screen.getByRole("link", { name: "All alerts" })).toHaveAttribute(
      "href",
      routeFor(PageMap.MONITOR_VIEW_ALERTS, MONITOR_ID),
    );
  });

  test("the merged list stops at five", () => {
    const incidentRows: Array<MonitorOpenWorkRow> = [1, 2, 3, 4].map(
      (index: number): MonitorOpenWorkRow => {
        return {
          ...INCIDENT_ROW,
          key: `incident-${index}`,
          title: `Incident ${index}`,
          startedAt: minutesAgo(index),
        };
      },
    );
    const alertRows: Array<MonitorOpenWorkRow> = [5, 6, 7].map(
      (index: number): MonitorOpenWorkRow => {
        return {
          ...ALERT_ROW,
          key: `alert-${index}`,
          title: `Alert ${index}`,
          startedAt: minutesAgo(index),
        };
      },
    );

    const merged: Array<MonitorOpenWorkRow> = mergeOpenWorkRows({
      incidents: side(4, incidentRows),
      alerts: side(3, alertRows),
    });

    expect(
      merged.map((row: MonitorOpenWorkRow) => {
        return row.title;
      }),
    ).toEqual([
      "Incident 1",
      "Incident 2",
      "Incident 3",
      "Incident 4",
      "Alert 5",
    ]);
  });

  test("'Nothing open' only when both sides are known to be zero", () => {
    renderCard({ incidents: side(0), alerts: side(0) });

    expect(screen.getByTestId("monitor-open-work-empty")).toHaveTextContent(
      "Nothing open",
    );
    expect(screen.getByTestId("monitor-open-work-empty")).toHaveTextContent(
      "No unresolved incidents or alerts on this monitor.",
    );
    expect(screen.getByTestId("monitor-open-incident-count")).toHaveClass(
      "text-gray-900",
    );
    cleanup();

    renderCard({ incidents: side(0), alerts: FORBIDDEN });
    expect(screen.queryByTestId("monitor-open-work-empty")).toBeNull();
    expect(screen.queryByText("Nothing open")).toBeNull();
    cleanup();

    renderCard({
      incidents: side(0),
      alerts: getLoadingSection<MonitorOpenWorkSide>(),
    });
    expect(screen.queryByText("Nothing open")).toBeNull();
    expect(
      screen.getByRole("status", { name: "Loading open incidents and alerts" }),
    ).toBeInTheDocument();
  });

  test("one side forbidden shows '—' for it, never 0, and says why", () => {
    renderCard({ incidents: FORBIDDEN, alerts: side(1, [ALERT_ROW]) });

    const incidentCount: HTMLElement = screen.getByTestId(
      "monitor-open-incident-count",
    );
    expect(incidentCount).toHaveTextContent("—");
    expect(incidentCount).not.toHaveTextContent("0");
    expect(incidentCount).toHaveClass("text-gray-400");

    expect(screen.getByTestId("monitor-open-work-footer")).toHaveTextContent(
      "Incidents are hidden: you need permission to read incidents.",
    );
    expect(screen.getAllByTestId("monitor-open-work-row")).toHaveLength(1);
  });

  test("both sides forbidden is one 'No access' state", () => {
    renderCard({ incidents: FORBIDDEN, alerts: FORBIDDEN });

    const empty: HTMLElement = screen.getByTestId(
      "monitor-open-work-no-access",
    );
    expect(empty).toHaveTextContent("No access");
    expect(empty).toHaveTextContent(
      "You need incident or alert access to see what's open here.",
    );
    expect(screen.queryByTestId("monitor-open-incident-count")).toBeNull();
    expect(screen.queryByText("Nothing open")).toBeNull();
  });

  test("a side that failed to load shows '—' and its error in the footer", () => {
    renderCard({
      incidents: side(0),
      alerts: failSection<MonitorOpenWorkSide>({
        previous: getLoadingSection<MonitorOpenWorkSide>(),
        message: "Server error.",
        subjectId: SUBJECT,
      }),
    });

    expect(screen.getByTestId("monitor-open-alert-count")).toHaveTextContent(
      "—",
    );
    expect(screen.getByTestId("monitor-open-work-footer")).toHaveTextContent(
      "Couldn't load alerts. Server error.",
    );
    expect(screen.queryByText("Nothing open")).toBeNull();
  });

  test("a failed refresh keeps the counts and notes it", () => {
    renderCard({
      incidents: failSection<MonitorOpenWorkSide>({
        previous: side(2, [INCIDENT_ROW]),
        message: "Timeout.",
        subjectId: SUBJECT,
      }),
      alerts: side(0),
    });

    expect(screen.getByTestId("monitor-open-incident-count")).toHaveTextContent(
      "2",
    );
    expect(screen.getByTestId("monitor-open-work-footer")).toHaveTextContent(
      "Couldn't refresh incidents. Timeout.",
    );
  });

  test("uses the stacked header for the narrow side column", () => {
    renderCard({ incidents: side(0), alerts: side(0) });

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
  });
});
