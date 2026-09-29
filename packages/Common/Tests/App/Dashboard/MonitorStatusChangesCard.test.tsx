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
import MonitorStatusChangesCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorStatusChangesCard";
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
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

/*
 * The last few status changes, in the side column. The newest open row is
 * "ongoing" with a live duration; closed rows say how long they lasted; and
 * an older row that was never closed is capped at the start of the row after
 * it, never shown as still running.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBJECT: string = MONITOR_ID.toString();
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");

const hoursAgo: (hours: number) => Date = (hours: number): Date => {
  return new Date(NOW.getTime() - hours * 3600 * 1000);
};

const row: (data: {
  id: string;
  name: string;
  color: string;
  startsAt: Date;
  endsAt?: Date | undefined;
}) => MonitorStatusTimeline = (data: {
  id: string;
  name: string;
  color: string;
  startsAt: Date;
  endsAt?: Date | undefined;
}): MonitorStatusTimeline => {
  const status: MonitorStatus = new MonitorStatus();
  status.name = data.name;
  status.color = new Color(data.color);

  const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
  timeline._id = data.id;
  timeline.startsAt = data.startsAt;

  if (data.endsAt) {
    timeline.endsAt = data.endsAt;
  }

  timeline.monitorStatus = status;
  return timeline;
};

// Newest first, as the overview reads them.
const ROWS: Array<MonitorStatusTimeline> = [
  row({
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "Operational",
    color: "#10B981",
    startsAt: hoursAgo(2),
  }),
  row({
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    name: "Offline",
    color: "#EF4444",
    startsAt: hoursAgo(5),
    endsAt: hoursAgo(2),
  }),
  // Never closed, but superseded: must read as 1 hour, not "ongoing".
  row({
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    name: "Degraded",
    color: "#F59E0B",
    startsAt: hoursAgo(6),
  }),
];

const renderCard: (
  statusRows: OverviewSection<Array<MonitorStatusTimeline>>,
) => void = (
  statusRows: OverviewSection<Array<MonitorStatusTimeline>>,
): void => {
  render(
    <MemoryRouter>
      <MonitorStatusChangesCard
        monitorId={MONITOR_ID}
        statusRows={statusRows}
      />
    </MemoryRouter>,
  );
};

const loaded: (
  rows: Array<MonitorStatusTimeline>,
) => OverviewSection<Array<MonitorStatusTimeline>> = (
  rows: Array<MonitorStatusTimeline>,
): OverviewSection<Array<MonitorStatusTimeline>> => {
  return resolveSection<Array<MonitorStatusTimeline>>({
    value: rows,
    subjectId: SUBJECT,
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("MonitorStatusChangesCard", () => {
  test("rows show a status dot, the name, and how long each lasted", () => {
    renderCard(loaded(ROWS));

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      "monitor-status-change-row",
    );
    expect(rows).toHaveLength(3);

    expect(rows[0]).toHaveTextContent("Operational");
    expect(rows[0]).toHaveTextContent("ongoing, 2 hours · started 2 hours ago");

    expect(rows[1]).toHaveTextContent("Offline");
    expect(rows[1]).toHaveTextContent("for 3 hours · started 5 hours ago");

    // The orphan is capped at its successor's start.
    expect(rows[2]).toHaveTextContent("Degraded");
    expect(rows[2]).toHaveTextContent("for 1 hour · started 6 hours ago");
    expect(rows[2]).not.toHaveTextContent("ongoing");

    const dot: HTMLElement = rows[1]!.querySelector(
      "[aria-hidden='true']",
    ) as HTMLElement;
    expect(dot.style.backgroundColor).toBe("rgb(239, 68, 68)");
    expect(dot.className).not.toMatch(/(^|\s)bg-/);

    expect(within(rows[0]!).getByText("Operational")).toHaveClass(
      "text-sm",
      "font-medium",
      "text-gray-900",
    );
    expect(rows[0]!.querySelector("time")).toHaveAttribute(
      "dateTime",
      hoursAgo(2).toISOString(),
    );
  });

  test("the footer links to the full status timeline", () => {
    renderCard(loaded(ROWS));

    expect(
      screen.getByRole("link", { name: "Full status timeline" }),
    ).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route,
        { modelId: MONITOR_ID },
      ).toString(),
    );
  });

  test("no rows says no status has been recorded", () => {
    renderCard(loaded([]));

    expect(screen.getByText("No status recorded yet.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("monitor-status-change-row")).toHaveLength(
      0,
    );
  });

  test("forbidden history says why, with no link to a page that would refuse too", () => {
    renderCard(
      forbidSection<Array<MonitorStatusTimeline>>({
        reason: "No access",
        subjectId: SUBJECT,
      }),
    );

    expect(
      screen.getByText(
        "Status history is hidden: you need permission to read the status timeline.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No status recorded yet.")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Full status timeline" }),
    ).toBeNull();
  });

  test("a failed read says what went wrong, not that nothing happened", () => {
    renderCard(
      failSection<Array<MonitorStatusTimeline>>({
        previous: getLoadingSection<Array<MonitorStatusTimeline>>(),
        message: "Server error.",
        subjectId: SUBJECT,
      }),
    );

    expect(
      screen.getByText("Couldn't load status history. Server error."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No status recorded yet.")).toBeNull();
  });

  test("while loading it shows placeholders, not 'No status recorded yet.'", () => {
    renderCard(getLoadingSection<Array<MonitorStatusTimeline>>());

    expect(
      screen.getByRole("status", { name: "Loading status changes" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No status recorded yet.")).toBeNull();
  });

  test("uses the stacked header with no right element", () => {
    renderCard(loaded(ROWS));

    expect(
      screen.getByRole("heading", { name: "Recent status changes" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
    expect(screen.queryByTestId("card-header-actions")).toBeNull();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "The last five times this monitor changed status.",
    );
  });
});
