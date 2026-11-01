import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A query with a fallback (MetricQueryConfigData.fallback) says so in its
 * settings: a Chart widget's query from the Kubernetes template reads the
 * restarts per interval, and its chart draws the running count instead
 * while the agent sends none. Nothing in a widget's settings would show
 * that otherwise, so the query names the metric its chart falls back to.
 *
 * A fallback stands in for the metric it was written for: picking another
 * metric drops it, so a chart a user repurposes never falls back to the
 * restarts of the chart it used to be. Changing anything else about the
 * query - its aggregation, its filters - keeps it.
 */

const metricQueryRenderMock: MockFunction = getJestMockFunction();

/*
 * The metric picker under the query is not what this is about: it hands
 * its changes up through onDataChanged, which the test calls as it would.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQuery",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        metricQueryRenderMock(props);
        return React.createElement(
          "div",
          { "data-testid": "metric-query" },
          "metric picker",
        );
      },
    };
  },
);

import MetricQueryConfig from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../Types/Metrics/MetricQueryData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

const NOTE: string =
  "When this query has no data in the time range, the chart shows k8s.container.restarts instead.";

// The restarts chart's query, as a dashboard made from the template stores it.
function storedRestartsQuery(): MetricQueryConfigData {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Kubernetes,
  );
  const chart: DashboardBaseComponent | undefined = config?.components.find(
    (component: DashboardBaseComponent): boolean => {
      return (
        component.componentType === DashboardComponentType.Chart &&
        (component.arguments as Record<string, unknown>)["chartTitle"] ===
          "Container Restarts Over Time"
      );
    },
  );

  if (!chart) {
    throw new Error("The Kubernetes template has no restarts chart");
  }

  return JSON.parse(
    JSON.stringify(
      (chart.arguments as Record<string, unknown>)["metricQueryConfig"],
    ),
  ) as MetricQueryConfigData;
}

function plainQuery(): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: undefined,
      description: undefined,
      legend: "CPU Cores",
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.usage",
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  } as MetricQueryConfigData;
}

function metricType(name: string): MetricType {
  const type: MetricType = new MetricType();
  type.name = name;
  type.description = `${name} description`;
  type.unit = "cores";
  return type;
}

function renderQuery(
  data: MetricQueryConfigData,
  onChange: MockFunction,
  metricTypes: Array<MetricType> = [],
): void {
  render(
    <MetricQueryConfig
      data={data}
      onChange={onChange as unknown as (data: MetricQueryConfigData) => void}
      metricTypes={metricTypes}
      telemetryAttributes={[]}
      hideCard={true}
    />,
  );
}

// What the metric picker hands up when the reader changes it.
function pick(filterData: Record<string, unknown>): void {
  const calls: Array<Array<unknown>> = metricQueryRenderMock.mock.calls;
  const props: {
    data: MetricQueryData;
    onDataChanged: (data: MetricQueryData) => void;
  } = calls[calls.length - 1]?.[0] as {
    data: MetricQueryData;
    onDataChanged: (data: MetricQueryData) => void;
  };

  act(() => {
    props.onDataChanged({
      ...props.data,
      filterData: {
        ...props.data.filterData,
        ...filterData,
      } as MetricQueryData["filterData"],
    });
  });
}

function lastChange(onChange: MockFunction): MetricQueryConfigData {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as MetricQueryConfigData;
}

beforeEach(() => {
  metricQueryRenderMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a query with a fallback, in its settings", () => {
  test("names the metric its chart draws instead", () => {
    renderQuery(storedRestartsQuery(), getJestMockFunction());

    expect(screen.getByTestId("metric-query-fallback-note")).toHaveTextContent(
      NOTE,
    );
  });

  test("a query without one says nothing of it", () => {
    renderQuery(plainQuery(), getJestMockFunction());

    expect(screen.queryByTestId("metric-query-fallback-note")).toBeNull();
  });

  test("another metric drops the fallback, alias and all", () => {
    const onChange: MockFunction = getJestMockFunction();
    renderQuery(storedRestartsQuery(), onChange, [
      metricType("k8s.pod.cpu.usage"),
    ]);

    pick({ metricName: "k8s.pod.cpu.usage" });

    const changed: MetricQueryConfigData = lastChange(onChange);
    expect(changed.metricQueryData.filterData.metricName).toBe(
      "k8s.pod.cpu.usage",
    );
    expect(changed).not.toHaveProperty("fallback");
    // The alias is the new metric's, as it always was.
    expect(changed.metricAliasData?.legend).toBe("k8s.pod.cpu.usage");
    expect(changed.metricAliasData?.metricVariable).toBe("a");
  });

  test("another metric the project has no type for drops it too", () => {
    const onChange: MockFunction = getJestMockFunction();
    renderQuery(storedRestartsQuery(), onChange, []);

    pick({ metricName: "custom.restarts" });

    const changed: MetricQueryConfigData = lastChange(onChange);
    expect(changed.metricQueryData.filterData.metricName).toBe(
      "custom.restarts",
    );
    expect(changed).not.toHaveProperty("fallback");
    expect(changed.metricAliasData?.legend).toBe("Restarts per interval");
  });

  test("another aggregation of the same metric keeps it", () => {
    const onChange: MockFunction = getJestMockFunction();
    const stored: MetricQueryConfigData = storedRestartsQuery();
    renderQuery(stored, onChange, [
      metricType("k8s.container.restarts.increase"),
    ]);

    pick({ aggegationType: MetricsAggregationType.Max });

    const changed: MetricQueryConfigData = lastChange(onChange);
    expect(changed.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Max,
    );
    expect(changed.fallback).toEqual(stored.fallback);
  });

  test("the stored query is left as it was", () => {
    const stored: MetricQueryConfigData = storedRestartsQuery();
    const before: string = JSON.stringify(stored);
    renderQuery(stored, getJestMockFunction(), [
      metricType("k8s.pod.cpu.usage"),
    ]);

    pick({ metricName: "k8s.pod.cpu.usage" });

    expect(JSON.stringify(stored)).toBe(before);
  });
});
