import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #6266: a query's service filter is shown among its filters in the
 * query editor (Filters & grouping), each service by its name and
 * removable; taking the last one away reads every service again. A query
 * without one shows nothing new.
 *
 * The editor is the production component; the lookup of service names is
 * stood in for.
 */

const API: string = "11111111-1111-4111-8111-111111111111";
const CHECKOUT: string = "22222222-2222-4222-8222-222222222222";

let serviceNames: Record<string, string> = {};
const namesAskedFor: Array<Array<string>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: (ids: Array<{ toString: () => string }> | undefined) => {
        namesAskedFor.push(
          (ids || []).map((id: { toString: () => string }): string => {
            return id.toString();
          }),
        );
        return serviceNames;
      },
    };
  },
);

import MetricQuery from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQuery";
import MetricQueryData from "../../../Types/Metrics/MetricQueryData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

const dataOf: (serviceIds?: Array<string>) => MetricQueryData = (
  serviceIds?: Array<string>,
): MetricQueryData => {
  return {
    filterData: {
      metricName: "http.server.duration",
      aggegationType: MetricsAggregationType.Avg,
      attributes: { "http.route": "/pay" },
      ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
    } as never,
  };
};

function renderEditor(
  data: MetricQueryData,
  onDataChanged: MockFunction,
  isOpen: boolean = true,
): void {
  render(
    <MetricQuery
      data={data}
      onDataChanged={onDataChanged}
      metricTypes={[]}
      telemetryAttributes={[]}
      defaultShowAdvancedFilters={isOpen}
    />,
  );
}

function lastChange(onDataChanged: MockFunction): MetricQueryData {
  const calls: Array<Array<unknown>> = onDataChanged.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as MetricQueryData;
}

beforeEach(() => {
  serviceNames = { [API]: "api", [CHECKOUT]: "checkout" };
  namesAskedFor.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("a query read for some services, in the query editor", () => {
  test("shows each service by its name among the query's filters", () => {
    renderEditor(dataOf([API, CHECKOUT]), getJestMockFunction());

    const block: HTMLElement = screen.getByTestId(
      "metric-query-service-filter",
    );
    expect(block).toHaveTextContent("Services");
    expect(block).toHaveTextContent(
      "Only chart this metric from these services.",
    );
    expect(block).toHaveTextContent("api");
    expect(block).toHaveTextContent("checkout");
    expect(namesAskedFor[namesAskedFor.length - 1]).toEqual([API, CHECKOUT]);
  });

  test("a service whose name is not known yet shows its id", () => {
    serviceNames = {};

    renderEditor(dataOf([API]), getJestMockFunction());

    expect(screen.getByTestId("metric-query-service-filter")).toHaveTextContent(
      API,
    );
  });

  test("removing a service keeps the others and every other filter", () => {
    const onDataChanged: MockFunction = getJestMockFunction();

    renderEditor(dataOf([API, CHECKOUT]), onDataChanged);
    fireEvent.click(screen.getByRole("button", { name: "Remove api" }));

    expect(lastChange(onDataChanged).filterData).toEqual({
      metricName: "http.server.duration",
      aggegationType: MetricsAggregationType.Avg,
      attributes: { "http.route": "/pay" },
      telemetryServiceIds: [CHECKOUT],
    });
  });

  test("removing the last one takes the filter out: every service again", () => {
    const onDataChanged: MockFunction = getJestMockFunction();

    renderEditor(dataOf([API]), onDataChanged);
    fireEvent.click(screen.getByRole("button", { name: "Remove api" }));

    expect(Object.keys(lastChange(onDataChanged).filterData)).not.toContain(
      "telemetryServiceIds",
    );
  });

  test("folded away, the section's dot says there is a filter", () => {
    renderEditor(
      {
        filterData: {
          metricName: "http.server.duration",
          aggegationType: MetricsAggregationType.Avg,
          telemetryServiceIds: [API],
        } as never,
      },
      getJestMockFunction(),
      false,
    );

    const toggle: HTMLElement = screen.getByRole("button", {
      name: /Filters & grouping/,
    });
    expect(toggle.querySelector(".bg-indigo-400")).not.toBeNull();
    expect(
      screen.queryByTestId("metric-query-service-filter"),
    ).not.toBeInTheDocument();
  });
});

describe("a query read for every service", () => {
  test("shows no service filter, and no dot for one", () => {
    renderEditor(
      {
        filterData: {
          metricName: "http.server.duration",
          aggegationType: MetricsAggregationType.Avg,
        } as never,
      },
      getJestMockFunction(),
      true,
    );

    expect(
      screen.queryByTestId("metric-query-service-filter"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Filter by attributes")).toBeInTheDocument();
  });
});
