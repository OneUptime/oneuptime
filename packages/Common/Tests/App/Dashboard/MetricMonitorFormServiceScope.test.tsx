import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #6266: a Metrics monitor's form charts its queries as the monitor
 * reads them - for the services it is limited to, which the step keeps
 * apart from its queries - while what the form saves stays the queries as
 * written. A monitor that reads every service charts every service.
 *
 * The form is real; its MetricView is a stand-in that records the queries
 * it is handed for its editor and its charts (MetricView is held to
 * fetching its chart queries in MetricViewChartQueries).
 */

interface ViewProps {
  data: MetricViewData;
  chartQueryConfigs?: Array<MetricQueryConfigData> | undefined;
  onChange: (data: MetricViewData) => void;
}

let lastView: ViewProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (props: ViewProps): React.ReactElement => {
        lastView = props;
        return React.createElement("div", { "data-testid": "metric-view" });
      },
    };
  },
);

import MetricMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import ObjectID from "../../../Types/ObjectID";
import MetricQueryServices from "../../../Utils/Metrics/MetricQueryServices";

const API: string = "44444444-4444-4444-8444-444444444444";
const CHECKOUT: string = "55555555-5555-4555-8555-555555555555";

const QUERY: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "",
    description: "",
    legend: "",
    legendUnit: "",
  },
  metricQueryData: {
    filterData: {
      metricName: "http.server.duration",
      aggegationType: MetricsAggregationType.Avg,
      attributes: { "http.route": "/pay" },
    } as never,
  },
};

const monitorOf: (
  serviceIds: Array<ObjectID> | undefined,
) => MonitorStepMetricMonitor = (
  serviceIds: Array<ObjectID> | undefined,
): MonitorStepMetricMonitor => {
  return {
    ...MonitorStepMetricMonitorUtil.getDefault(),
    ...(serviceIds ? { telemetryServiceIds: serviceIds } : {}),
    metricViewConfig: { queryConfigs: [QUERY], formulaConfigs: [] },
  };
};

function view(): ViewProps {
  expect(lastView).not.toBeNull();
  return lastView!;
}

afterEach(() => {
  cleanup();
  lastView = null;
});

describe("a Metrics monitor limited to some services, in its form", () => {
  test("its chart reads every query for those services; its editor edits them as written", () => {
    render(
      <MetricMonitorStepForm
        monitorStepMetricMonitor={monitorOf([
          new ObjectID(API),
          new ObjectID(CHECKOUT),
        ])}
        onChange={(): void => {}}
      />,
    );

    expect(
      view().chartQueryConfigs!.map((query: MetricQueryConfigData) => {
        return MetricQueryServices.getServiceIds(query);
      }),
    ).toEqual([[API, CHECKOUT]]);
    expect(view().chartQueryConfigs![0]!.metricQueryData.filterData.attributes).toEqual(
      { "http.route": "/pay" },
    );
    expect(view().data.queryConfigs).toEqual([QUERY]);
  });

  test("an edit is saved as written: the services stay on the step, not its queries", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <MetricMonitorStepForm
        monitorStepMetricMonitor={monitorOf([new ObjectID(API)])}
        onChange={onChange}
      />,
    );

    const edited: MetricQueryConfigData = {
      ...QUERY,
      metricQueryData: {
        ...QUERY.metricQueryData,
        filterData: {
          ...QUERY.metricQueryData.filterData,
          aggegationType: MetricsAggregationType.Max,
        },
      },
    };

    act(() => {
      view().onChange({ ...view().data, queryConfigs: [edited] });
    });

    const saved: MonitorStepMetricMonitor = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as MonitorStepMetricMonitor;
    expect(saved.metricViewConfig.queryConfigs).toEqual([edited]);
    expect(
      Object.keys(saved.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData),
    ).not.toContain("telemetryServiceIds");
    expect(saved.telemetryServiceIds).toEqual([new ObjectID(API)]);
  });
});

describe("a Metrics monitor read for every service, in its form", () => {
  test("its chart reads every service, as before", () => {
    render(
      <MetricMonitorStepForm
        monitorStepMetricMonitor={monitorOf(undefined)}
        onChange={(): void => {}}
      />,
    );

    for (const query of view().chartQueryConfigs || []) {
      expect(Object.keys(query.metricQueryData.filterData)).not.toContain(
        "telemetryServiceIds",
      );
      expect(query.metricQueryData.filterData.attributes).toEqual({
        "http.route": "/pay",
      });
    }
  });
});
