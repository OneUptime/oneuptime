/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorOverviewStatBar, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewStatBar";
import {
  MonitorOpenWork,
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
import {
  MonitorUptimeSummary,
  MonitorUptimeSummaryStatus,
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";

/*
 * The four numbers under the monitor hero. What they pin is honesty: a
 * window with nothing recorded says "No data" (never 100%), one that could
 * not be read says "—", a partly covered window says how much it measured,
 * and an open-work count that is unknown is never shown as 0.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBJECT: string = MONITOR_ID.toString();
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const OPERATIONAL_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const STATUSES: Array<MonitorUptimeSummaryStatus> = [
  {
    id: OPERATIONAL_ID,
    name: "Operational",
    color: "#10B981",
    isOperationalState: true,
    isOfflineState: false,
    priority: 1,
  },
  {
    id: OFFLINE_ID,
    name: "Offline",
    color: "#EF4444",
    isOperationalState: false,
    isOfflineState: true,
    priority: 3,
  },
];

const windowOf: (data: {
  key: MonitorUptimeWindowKey;
  windowSeconds: number;
  upSeconds: number;
  downSeconds: number;
}) => MonitorUptimeWindowTotal = (data: {
  key: MonitorUptimeWindowKey;
  windowSeconds: number;
  upSeconds: number;
  downSeconds: number;
}): MonitorUptimeWindowTotal => {
  return {
    key: data.key,
    startDate: new Date(NOW.getTime() - data.windowSeconds * 1000),
    endDate: NOW,
    windowSeconds: data.windowSeconds,
    coveredSeconds: data.upSeconds + data.downSeconds,
    statusDurations: [
      ...(data.upSeconds > 0
        ? [{ monitorStatusId: OPERATIONAL_ID, seconds: data.upSeconds }]
        : []),
      ...(data.downSeconds > 0
        ? [{ monitorStatusId: OFFLINE_ID, seconds: data.downSeconds }]
        : []),
    ],
  };
};

// 3 days 4 hours measured of a 7-day window, 43 seconds of it down.
const PARTIAL_COVERED: number = 3 * 86400 + 4 * 3600;

const summaryWith: (
  windows: Array<MonitorUptimeWindowTotal>,
) => MonitorUptimeSummary = (
  windows: Array<MonitorUptimeWindowTotal>,
): MonitorUptimeSummary => {
  return {
    monitorId: MONITOR_ID,
    timezone: "UTC",
    generatedAt: NOW,
    startDate: new Date("2026-06-24T00:00:00.000Z"),
    endDate: NOW,
    buckets: [],
    windows: windows,
    isComplete: true,
    completeFrom: null,
    statuses: STATUSES,
  };
};

const DEFAULT_SUMMARY: MonitorUptimeSummary = summaryWith([
  windowOf({
    key: MonitorUptimeWindowKey.Last24Hours,
    windowSeconds: 86400,
    upSeconds: 86400,
    downSeconds: 0,
  }),
  windowOf({
    key: MonitorUptimeWindowKey.Last7Days,
    windowSeconds: 604800,
    upSeconds: PARTIAL_COVERED - 43,
    downSeconds: 43,
  }),
  windowOf({
    key: MonitorUptimeWindowKey.Last30Days,
    windowSeconds: 2592000,
    upSeconds: 0,
    downSeconds: 0,
  }),
]);

const side: (count: number) => OverviewSection<MonitorOpenWorkSide> = (
  count: number,
): OverviewSection<MonitorOpenWorkSide> => {
  return resolveSection<MonitorOpenWorkSide>({
    value: { count: count, rows: [] },
    subjectId: SUBJECT,
  });
};

const FORBIDDEN_SIDE: OverviewSection<MonitorOpenWorkSide> =
  forbidSection<MonitorOpenWorkSide>({
    reason: "No access",
    subjectId: SUBJECT,
  });

const ERROR_SIDE: OverviewSection<MonitorOpenWorkSide> =
  failSection<MonitorOpenWorkSide>({
    previous: getLoadingSection<MonitorOpenWorkSide>(),
    message: "Server error",
    subjectId: SUBJECT,
  });

const openWork: (
  incidents: OverviewSection<MonitorOpenWorkSide>,
  alerts: OverviewSection<MonitorOpenWorkSide>,
) => MonitorOpenWork = (
  incidents: OverviewSection<MonitorOpenWorkSide>,
  alerts: OverviewSection<MonitorOpenWorkSide>,
): MonitorOpenWork => {
  return { incidents: incidents, alerts: alerts };
};

const renderBar: (overrides?: Partial<ComponentProps>) => void = (
  overrides?: Partial<ComponentProps>,
): void => {
  const props: ComponentProps = {
    monitorId: MONITOR_ID,
    summary: resolveSection<MonitorUptimeSummary>({
      value: DEFAULT_SUMMARY,
      subjectId: SUBJECT,
    }),
    caveat: null,
    openWork: openWork(side(1), side(2)),
    ...overrides,
  };

  render(
    <MemoryRouter>
      <MonitorOverviewStatBar {...props} />
    </MemoryRouter>,
  );
};

const tile: (id: string) => HTMLElement = (id: string): HTMLElement => {
  const element: HTMLElement | null = document.getElementById(id);

  if (!element) {
    throw new Error(`No tile ${id}`);
  }

  return element;
};

const routeFor: (pageMap: PageMap) => string = (pageMap: PageMap): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: MONITOR_ID,
  }).toString();
};

afterEach(() => {
  cleanup();
});

describe("MonitorOverviewStatBar", () => {
  test("four cells in the 'Uptime and open work' group, in order", () => {
    renderBar({});

    const group: HTMLElement = screen.getByRole("group", {
      name: "Uptime and open work",
    });

    expect(
      Array.from(group.children).map((child: Element) => {
        return child.id;
      }),
    ).toEqual([
      "monitor-uptime-24h",
      "monitor-uptime-7d",
      "monitor-uptime-30d",
      "monitor-open-now",
    ]);
    expect(group).toHaveTextContent("Uptime · 24 hours");
    expect(group).toHaveTextContent("Uptime · 7 days");
    expect(group).toHaveTextContent("Uptime · 30 days");
    expect(group).toHaveTextContent("Open now");
    // Two across, then four, never five tracks for four cells.
    expect(group).toHaveClass("sm:grid-cols-2", "lg:grid-cols-4");
  });

  test("a fully covered window with no downtime is 100% with no downtime", () => {
    renderBar({});

    const cell: HTMLElement = tile("monitor-uptime-24h");
    expect(within(cell).getByText("100%")).toHaveClass("text-gray-900");
    expect(cell).toHaveTextContent("No downtime");
  });

  test("a partial window floors its percentage and says what it measured", () => {
    renderBar({});

    const cell: HTMLElement = tile("monitor-uptime-7d");
    // 43 s down in 273,600 s measured is 99.98428...%, floored to 99.984%.
    expect(cell).toHaveTextContent("99.984%");
    expect(cell).toHaveTextContent("Down 43s · measured over 3d 4h");
  });

  test("a window with nothing recorded is 'No data', never 100%", () => {
    renderBar({});

    const cell: HTMLElement = tile("monitor-uptime-30d");
    expect(within(cell).getByText("No data")).toHaveClass("text-gray-400");
    expect(cell).toHaveTextContent("Nothing recorded in this window");
    expect(cell).not.toHaveTextContent("100%");
  });

  test("forbidden history reads '—' with the reason, never a number", () => {
    renderBar({
      summary: forbidSection<MonitorUptimeSummary>({
        reason: "No access",
        subjectId: SUBJECT,
      }),
    });

    for (const id of [
      "monitor-uptime-24h",
      "monitor-uptime-7d",
      "monitor-uptime-30d",
    ]) {
      const cell: HTMLElement = tile(id);
      expect(within(cell).getByText("—")).toHaveClass("text-gray-400");
      expect(cell).toHaveTextContent("No access to status history");
      expect(cell).not.toHaveTextContent("%");
      expect(cell).not.toHaveTextContent("No data");
    }
  });

  test("an uptime read that failed reads '—', not 'No data'", () => {
    renderBar({
      summary: failSection<MonitorUptimeSummary>({
        previous: getLoadingSection<MonitorUptimeSummary>(),
        message: "Boom",
        subjectId: SUBJECT,
      }),
    });

    const cell: HTMLElement = tile("monitor-uptime-24h");
    expect(cell).toHaveTextContent("—");
    expect(cell).toHaveTextContent("Uptime is unavailable");
    expect(cell).not.toHaveTextContent("No data");
  });

  test("a failed refresh keeps the numbers that loaded", () => {
    renderBar({
      summary: failSection<MonitorUptimeSummary>({
        previous: resolveSection<MonitorUptimeSummary>({
          value: DEFAULT_SUMMARY,
          subjectId: SUBJECT,
        }),
        message: "Boom",
        subjectId: SUBJECT,
      }),
    });

    expect(tile("monitor-uptime-24h")).toHaveTextContent("100%");
  });

  test("a paused monitor says its windows include paused time", () => {
    renderBar({ caveat: "paused" });

    expect(tile("monitor-uptime-24h")).toHaveTextContent(
      "No downtime · includes paused time",
    );
  });

  test("every caveat names the time nothing measured, on every window", () => {
    const cases: Array<{
      caveat: "not-checking" | "no-results";
      text: string;
    }> = [
      {
        caveat: "not-checking",
        text: "No downtime · includes time with no checks running",
      },
      {
        caveat: "no-results",
        text: "No downtime · no check has completed yet",
      },
    ];

    for (const testCase of cases) {
      renderBar({ caveat: testCase.caveat });

      expect({
        caveat: testCase.caveat,
        text: tile("monitor-uptime-24h").textContent,
      }).toEqual({
        caveat: testCase.caveat,
        text: expect.stringContaining(testCase.text),
      });
      expect(tile("monitor-uptime-7d")).toHaveTextContent(
        "Down 43s · measured over 3d 4h",
      );

      cleanup();
    }
  });

  test("no caveat adds nothing", () => {
    renderBar({ caveat: null });

    const cell: HTMLElement = tile("monitor-uptime-24h");
    expect(cell).toHaveTextContent("No downtime");
    expect(cell).not.toHaveTextContent("paused");
    expect(cell).not.toHaveTextContent("no checks running");
    expect(cell).not.toHaveTextContent("no check has completed");
  });

  test("skeletons while the summary and open work load", () => {
    renderBar({
      summary: getLoadingSection<MonitorUptimeSummary>(),
      openWork: openWork(
        getLoadingSection<MonitorOpenWorkSide>(),
        getLoadingSection<MonitorOpenWorkSide>(),
      ),
    });

    for (const id of [
      "monitor-uptime-24h",
      "monitor-uptime-7d",
      "monitor-uptime-30d",
      "monitor-open-now",
    ]) {
      expect(within(tile(id)).getByTestId("skeleton")).toBeInTheDocument();
      expect(tile(id)).not.toHaveTextContent("%");
      expect(tile(id)).not.toHaveTextContent("—");
    }
  });

  test("both sides known and zero is 'Nothing open' in emerald", () => {
    renderBar({ openWork: openWork(side(0), side(0)) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(within(cell).getByText("Nothing open")).toHaveClass(
      "text-emerald-700",
    );
    expect(cell).toHaveTextContent("No unresolved incidents or alerts");
  });

  test("counts link to this monitor's Incidents and Alerts pages, coloured when non-zero", () => {
    renderBar({ openWork: openWork(side(1), side(2)) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(cell).toHaveTextContent("1 incident · 2 alerts");

    const incidents: HTMLElement = within(cell).getByRole("link", {
      name: "1 incident",
    });
    expect(incidents).toHaveAttribute(
      "href",
      routeFor(PageMap.MONITOR_VIEW_INCIDENTS),
    );
    expect(incidents).toHaveClass("text-red-700");

    const alerts: HTMLElement = within(cell).getByRole("link", {
      name: "2 alerts",
    });
    expect(alerts).toHaveAttribute(
      "href",
      routeFor(PageMap.MONITOR_VIEW_ALERTS),
    );
    expect(alerts).toHaveClass("text-amber-700");
  });

  test("a zero side is plain, not coloured", () => {
    renderBar({ openWork: openWork(side(0), side(3)) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(within(cell).getByRole("link", { name: "0 incidents" })).toHaveClass(
      "text-gray-900",
    );
    expect(cell).not.toHaveTextContent("Nothing open");
  });

  test("a forbidden side shows '—' and never 0", () => {
    renderBar({ openWork: openWork(FORBIDDEN_SIDE, side(0)) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(cell).toHaveTextContent("— incidents · 0 alerts");
    expect(cell).toHaveTextContent("Incidents hidden: no access");
    expect(cell).not.toHaveTextContent("0 incidents");
    expect(cell).not.toHaveTextContent("Nothing open");
    expect(within(cell).queryByRole("link", { name: /incident/ })).toBeNull();
  });

  test("both sides forbidden say so once", () => {
    renderBar({ openWork: openWork(FORBIDDEN_SIDE, FORBIDDEN_SIDE) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(cell).toHaveTextContent("— incidents · — alerts");
    expect(cell).toHaveTextContent("Incidents and alerts hidden: no access");
    expect(within(cell).queryByRole("link")).toBeNull();
  });

  test("zero counts whose refresh failed are never the green 'Nothing open'", () => {
    const staleZero: OverviewSection<MonitorOpenWorkSide> =
      failSection<MonitorOpenWorkSide>({
        previous: side(0),
        message: "Server error",
        subjectId: SUBJECT,
      });

    renderBar({ openWork: openWork(staleZero, side(0)) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(cell).not.toHaveTextContent("Nothing open");
    expect(cell).not.toHaveTextContent("No unresolved incidents or alerts");
    expect(within(cell).queryByText("Nothing open")).toBeNull();
    // The counts it had are still shown, plainly, and said to be old.
    expect(cell).toHaveTextContent("0 incidents · 0 alerts");
    expect(within(cell).getByRole("link", { name: "0 incidents" })).toHaveClass(
      "text-gray-900",
    );
    expect(cell).toHaveTextContent(
      "Couldn't refresh incidents · showing the earlier count",
    );
  });

  test("a stale side keeps its count and says which side it is", () => {
    const staleAlerts: OverviewSection<MonitorOpenWorkSide> =
      failSection<MonitorOpenWorkSide>({
        previous: side(2),
        message: "Server error",
        subjectId: SUBJECT,
      });

    renderBar({ openWork: openWork(side(1), staleAlerts) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(cell).toHaveTextContent("1 incident · 2 alerts");
    expect(cell).toHaveTextContent(
      "Couldn't refresh alerts · showing the earlier count",
    );
    expect(cell).not.toHaveTextContent("Unresolved on this monitor");
  });

  test("both sides stale say so once", () => {
    const stale: (count: number) => OverviewSection<MonitorOpenWorkSide> = (
      count: number,
    ): OverviewSection<MonitorOpenWorkSide> => {
      return failSection<MonitorOpenWorkSide>({
        previous: side(count),
        message: "Server error",
        subjectId: SUBJECT,
      });
    };

    renderBar({ openWork: openWork(stale(0), stale(0)) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(cell).not.toHaveTextContent("Nothing open");
    expect(cell).toHaveTextContent("0 incidents · 0 alerts");
    expect(cell).toHaveTextContent("Couldn't refresh · showing earlier counts");
  });

  test("a side that failed to load says so and shows '—'", () => {
    renderBar({ openWork: openWork(side(2), ERROR_SIDE) });

    const cell: HTMLElement = tile("monitor-open-now");
    expect(cell).toHaveTextContent("2 incidents · — alerts");
    expect(cell).toHaveTextContent("Couldn't load open alerts");
    expect(cell).not.toHaveTextContent("0 alerts");
  });
});
