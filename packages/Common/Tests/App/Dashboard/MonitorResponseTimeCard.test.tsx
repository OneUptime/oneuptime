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
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import Permission from "../../../Types/Permission";

/*
 * The overview's response-time card. The chart itself is EmbeddedMetricCard
 * (stubbed here to record its props); what is pinned is the query it is
 * handed - the same probe-grouped config the Metrics tab builds, over the
 * last day - and the permission fallback for roles that cannot read
 * telemetry, which must still say something useful.
 */

let mockPermissions: Array<Permission> = [Permission.ProjectOwner];
const mockMetricCardProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        mockMetricCardProps.push(props);
        const ReactModule: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactModule.createElement(
          "div",
          { "data-testid": "embedded-metric-card" },
          props["rightElement"] as ReactElement,
        );
      },
    };
  },
);

import MonitorResponseTimeCard, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorResponseTimeCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Probe from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import MetricQueryConfigData, {
  ChartSeries,
} from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LONDON_ID: string = "33333333-3333-4333-8333-333333333333";
const OHIO_ID: string = "44444444-4444-4444-8444-444444444444";

const probe: (id: string, name: string) => Probe = (
  id: string,
  name: string,
): Probe => {
  const model: Probe = new Probe();
  model._id = id;
  model.name = name;
  return model;
};

const PROBES: Array<Probe> = [
  probe(LONDON_ID, "London"),
  probe(OHIO_ID, "Ohio"),
];

const renderCard: (overrides?: Partial<ComponentProps>) => RenderResult = (
  overrides?: Partial<ComponentProps>,
): RenderResult => {
  const props: ComponentProps = {
    monitorId: MONITOR_ID,
    monitorType: MonitorType.API,
    metric: MonitorMetricType.ResponseTime,
    probes: PROBES,
    responseTime: {
      medianMs: 120,
      minMs: 95,
      maxMs: 180,
      respondedCount: 2,
      totalCount: 2,
    },
    ...overrides,
  };

  return render(
    <MemoryRouter>
      <MonitorResponseTimeCard {...props} />
    </MemoryRouter>,
  );
};

const lastCardProps: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const props: Record<string, unknown> | undefined =
    mockMetricCardProps[mockMetricCardProps.length - 1];

  if (!props) {
    throw new Error("EmbeddedMetricCard was never rendered");
  }

  return props;
};

beforeEach(() => {
  mockPermissions = [Permission.ProjectOwner];
});

afterEach(() => {
  cleanup();
  mockMetricCardProps.length = 0;
});

describe("MonitorResponseTimeCard", () => {
  test("charts ResponseTime for this monitor, one series per probe, over the last day", () => {
    renderCard({});

    const props: Record<string, unknown> = lastCardProps();
    /*
     * The overview's card carries the title and description; the chart sits
     * inside it with its controls on a row of their own, so they never
     * squeeze the title at tablet widths.
     */
    expect(
      screen.getByRole("heading", { level: 2, name: "Response time" }),
    ).toBeInTheDocument();
    /*
     * The probe records a time for every check that got an answer, a 503
     * included; only timeouts and connection errors have none. So the copy
     * must not claim failed checks are left out.
     */
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Average response time per probe. Error responses are included; timeouts and connection errors are not.",
    );
    expect(screen.getByTestId("card-description")).not.toHaveTextContent(
      "Failed checks are not included",
    );
    expect(props["hideCard"]).toBe(true);
    expect(props["title"]).toBeUndefined();
    expect(props["description"]).toBeUndefined();
    expect(props["defaultTimeRange"]).toEqual({
      range: TimeRange.PAST_ONE_DAY,
    });

    const configs: Array<MetricQueryConfigData> = props[
      "queryConfigs"
    ] as Array<MetricQueryConfigData>;
    expect(configs).toHaveLength(1);

    const config: MetricQueryConfigData = configs[0]!;
    expect(config.metricQueryData.filterData.metricName).toBe(
      MonitorMetricType.ResponseTime,
    );
    expect(
      (
        config.metricQueryData.filterData.attributes as unknown as Record<
          string,
          string
        >
      )["monitorId"],
    ).toBe(MONITOR_ID.toString());
    expect(config.metricQueryData.groupBy).toEqual({ attributes: true });

    /*
     * The card's description explains the chart, so the chart keeps its
     * title but drops the metric's long explanation, which left the plot a
     * few pixels tall in the two-thirds column.
     */
    expect(config.metricAliasData?.title).toBe("Response Time");
    expect(config.metricAliasData?.description).toBe("");
    expect(config.metricAliasData?.legendUnit).toBe("ms");

    // Each series is named after the probe that measured it.
    const series: ChartSeries = config.getSeries!({
      attributes: { probeId: OHIO_ID },
    } as unknown as AggregateModel);
    expect(series.title).toBe("Ohio");
  });

  test("links to the full Metrics tab", () => {
    renderCard({});

    expect(screen.getByRole("link", { name: "Open metrics" })).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_VIEW_METRICS] as Route,
        { modelId: MONITOR_ID },
      ).toString(),
    );
  });

  test("a scripted monitor charts run time", () => {
    renderCard({
      monitorType: MonitorType.SyntheticMonitor,
      metric: MonitorMetricType.ExecutionTime,
    });

    const props: Record<string, unknown> = lastCardProps();
    expect(
      screen.getByRole("heading", { level: 2, name: "Run time" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "How long each run took, per probe.",
    );
    expect(props["hideCard"]).toBe(true);
    expect(
      (props["queryConfigs"] as Array<MetricQueryConfigData>)[0]!
        .metricQueryData.filterData.metricName,
    ).toBe(MonitorMetricType.ExecutionTime);
  });

  test("the query is not rebuilt when the page re-renders with the same probes", () => {
    const view: RenderResult = renderCard({});
    const first: unknown = lastCardProps()["queryConfigs"];

    view.rerender(
      <MemoryRouter>
        <MonitorResponseTimeCard
          monitorId={new ObjectID(MONITOR_ID.toString())}
          monitorType={MonitorType.API}
          metric={MonitorMetricType.ResponseTime}
          probes={[probe(LONDON_ID, "London"), probe(OHIO_ID, "Ohio")]}
          responseTime={null}
        />
      </MemoryRouter>,
    );
    expect(lastCardProps()["queryConfigs"]).toBe(first);

    view.rerender(
      <MemoryRouter>
        <MonitorResponseTimeCard
          monitorId={MONITOR_ID}
          monitorType={MonitorType.API}
          metric={MonitorMetricType.ResponseTime}
          probes={[probe(LONDON_ID, "London")]}
          responseTime={null}
        />
      </MemoryRouter>,
    );
    expect(lastCardProps()["queryConfigs"]).not.toBe(first);
  });

  test("a definite Metric denial shows the latest numbers instead of the chart", () => {
    mockPermissions = [Permission.MonitorViewer];

    // The role really is refused, with a reason: this is not the unknown case.
    const gate: PermissionGateResult = PermissionGate.check(
      new Metric(),
      ModelAction.Read,
    );
    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBeTruthy();

    renderCard({});

    expect(screen.queryByTestId("embedded-metric-card")).toBeNull();
    const fallback: HTMLElement = screen.getByTestId(
      "monitor-response-time-fallback",
    );
    expect(fallback).toHaveTextContent(
      "Response-time history needs permission to read telemetry.",
    );
    expect(fallback).toHaveTextContent(
      "Latest: 120 ms median across 2 probes (95–180 ms)",
    );
    expect(
      screen.getByRole("heading", { name: "Response time" }),
    ).toBeInTheDocument();
  });

  test("the fallback says how many of the probes the numbers come from", () => {
    mockPermissions = [Permission.MonitorViewer];

    renderCard({
      responseTime: {
        medianMs: 120,
        minMs: 110,
        maxMs: 130,
        respondedCount: 2,
        totalCount: 3,
      },
    });

    expect(
      screen.getByTestId("monitor-response-time-fallback"),
    ).toHaveTextContent(
      "Latest: 120 ms median across 2 of 3 probes (110–130 ms)",
    );
    cleanup();

    renderCard({
      responseTime: {
        medianMs: 95,
        minMs: 95,
        maxMs: 95,
        respondedCount: 1,
        totalCount: 1,
      },
    });

    expect(
      screen.getByTestId("monitor-response-time-fallback"),
    ).toHaveTextContent("Latest: 95 ms median across 1 probe (95–95 ms)");
  });

  test("the fallback leaves out the numbers when no probe has reported a time", () => {
    mockPermissions = [Permission.MonitorViewer];

    renderCard({ responseTime: null });

    const fallback: HTMLElement = screen.getByTestId(
      "monitor-response-time-fallback",
    );
    expect(fallback).toHaveTextContent(
      "Response-time history needs permission to read telemetry.",
    );
    expect(fallback).not.toHaveTextContent("Latest:");
  });

  test("an unknown permission (empty snapshot) still renders the chart", () => {
    mockPermissions = [];

    renderCard({});

    expect(screen.getByTestId("embedded-metric-card")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-response-time-fallback")).toBeNull();
  });
});
