/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorSeriesCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorSeriesCard";
import { MonitorSeriesOpenRecord } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorSeriesOpenRecords";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary, {
  MonitorEvaluationSeriesRow,
  MonitorEvaluationSeriesValueKind,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE SERIES CARD ON A GROUPED MONITOR'S OVERVIEW (#10062): each series the
 * last check read - named as its incidents and alerts name it - its latest
 * value, the criteria it meets and its open incident or alert. Not drawn for
 * a monitor that does not group.
 *
 * What is open is read by useMonitorSeriesOpenRecords, stood in for here:
 * what it is asked for, and what it hands back.
 */

let mockOpenRecords: Map<string, Array<MonitorSeriesOpenRecord>> = new Map<
  string,
  Array<MonitorSeriesOpenRecord>
>();
const mockAskedFor: Array<Array<string>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorSeriesOpenRecords",
  () => {
    const hook: (options: {
      fingerprints: Array<string>;
    }) => Map<string, Array<MonitorSeriesOpenRecord>> = (options: {
      fingerprints: Array<string>;
    }): Map<string, Array<MonitorSeriesOpenRecord>> => {
      mockAskedFor.push(options.fingerprints);
      return mockOpenRecords;
    };

    return {
      __esModule: true,
      default: hook,
      useMonitorSeriesOpenRecords: hook,
    };
  },
);

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";

function row(
  data: Partial<MonitorEvaluationSeriesRow> & { fingerprint: string },
): MonitorEvaluationSeriesRow {
  return {
    labels: {},
    valueKind: MonitorEvaluationSeriesValueKind.Metric,
    metCriteriaIds: [],
    ...data,
  };
}

function summary(data: {
  rows?: Array<MonitorEvaluationSeriesRow>;
  count?: number;
  noSeries?: boolean;
}): MonitorEvaluationSummary {
  const rows: Array<MonitorEvaluationSeriesRow> = data.rows || [];

  return {
    evaluatedAt: new Date("2026-11-22T09:00:00.000Z"),
    criteriaResults: [
      {
        criteriaId: "offline",
        criteriaName: "High Filesystem - Usage > 90%",
        filterCondition: FilterCondition.Any,
        met: false,
        message: "",
        filters: [],
      },
      {
        criteriaId: "online",
        criteriaName: "Healthy",
        filterCondition: FilterCondition.Any,
        met: false,
        message: "",
        filters: [],
      },
    ],
    events: [],
    ...(data.noSeries
      ? {}
      : { series: { count: data.count ?? rows.length, rows: rows } }),
  };
}

const DISKS: Array<MonitorEvaluationSeriesRow> = [
  row({
    fingerprint: "data",
    labels: { mountpoint: "/data", device: "/dev/sdb1" },
    value: 89,
    unit: "%",
    isKeepingStatus: true,
  }),
  row({
    fingerprint: "root",
    labels: { mountpoint: "/", device: "/dev/sda1" },
    value: 70,
    unit: "%",
    metCriteriaIds: ["online"],
  }),
];

function renderCard(
  evaluationSummary: MonitorEvaluationSummary | undefined,
): void {
  render(
    <MemoryRouter>
      <MonitorSeriesCard
        monitorId={MONITOR_ID}
        evaluationSummary={evaluationSummary}
        refreshToken="1"
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mockOpenRecords = new Map<string, Array<MonitorSeriesOpenRecord>>();
  mockAskedFor.length = 0;
});

describe("MonitorSeriesCard", () => {
  test("is not drawn for a monitor whose checks read no series", () => {
    renderCard(summary({ noSeries: true }));
    expect(screen.queryByTestId("monitor-series-card")).toBeNull();
    cleanup();

    renderCard(undefined);
    expect(screen.queryByTestId("monitor-series-card")).toBeNull();
    cleanup();

    renderCard(summary({ rows: [] }));
    expect(screen.queryByTestId("monitor-series-card")).toBeNull();
  });

  test("lists each disk by its mount and device, with its latest value and the criteria it meets", () => {
    renderCard(summary({ rows: DISKS }));

    const card: HTMLElement = screen.getByTestId("monitor-series-card");

    expect(within(card).getAllByText("Series").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("/data").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("/dev/sdb1").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("89.00%").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("70.00%").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("Healthy").length).toBeGreaterThan(0);
  });

  test("the disk that keeps the monitor's status says so", () => {
    renderCard(summary({ rows: DISKS }));

    const card: HTMLElement = screen.getByTestId("monitor-series-card");
    expect(within(card).getAllByText("Keeps the status").length).toBe(1);
  });

  test("links each series' open incident, and asks for the open records of exactly the listed series", () => {
    mockOpenRecords = new Map<string, Array<MonitorSeriesOpenRecord>>([
      [
        "data",
        [
          {
            kind: "Incident",
            id: INCIDENT_ID,
            number: "INC-12",
          },
        ],
      ],
    ]);

    renderCard(summary({ rows: DISKS }));

    const links: Array<HTMLElement> = screen.getAllByRole("link", {
      name: "Incident INC-12",
    });
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_VIEW] as Route,
      { modelId: new ObjectID(INCIDENT_ID) },
    );

    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.getAttribute("href")).toBe(route.toString());
    expect(mockAskedFor[mockAskedFor.length - 1]).toEqual(["data", "root"]);
  });

  test("says when it lists a share of the series the check read", () => {
    renderCard(summary({ rows: DISKS, count: 2345 }));

    expect(screen.getByTestId("monitor-series-share")).toHaveTextContent(
      "Showing 2 of 2,345 series: those that keep the status or meet a criteria come first.",
    );
  });

  test("says nothing of a share when every series is listed", () => {
    renderCard(summary({ rows: DISKS }));

    expect(screen.queryByTestId("monitor-series-share")).toBeNull();
  });

  test("pages a long list ten series at a time", () => {
    const many: Array<MonitorEvaluationSeriesRow> = Array.from(
      { length: 23 },
      (_: unknown, index: number): MonitorEvaluationSeriesRow => {
        return row({
          fingerprint: `disk-${index}`,
          labels: { mountpoint: `/mnt/disk-${index}` },
          value: index,
          unit: "%",
        });
      },
    );

    renderCard(summary({ rows: many }));

    const card: HTMLElement = screen.getByTestId("monitor-series-card");

    expect(within(card).getAllByText("/mnt/disk-0").length).toBeGreaterThan(0);
    expect(within(card).getAllByText("/mnt/disk-9").length).toBeGreaterThan(0);
    expect(within(card).queryAllByText("/mnt/disk-10")).toHaveLength(0);
  });
});
