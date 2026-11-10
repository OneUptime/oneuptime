import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";

/*
 * Issue #6460: a Metrics monitor's form hands its MetricView the intervals
 * the monitor reads its window in - a minute up to 3 hours, 5 minutes up to
 * 12, the whole window for a step that reads it whole - so a query moved
 * onto a Service Bus namespace's messages waiting takes the aggregation
 * the monitor will read them with, not the one of the preview's range
 * (MetricViewNamespaceAggregation holds the view to it).
 *
 * The form is real; its MetricView is a stand-in that records what it is
 * handed (as in MetricMonitorFormServiceScope).
 */

interface ViewProps {
  queryReadInterval?: AggregationInterval | undefined;
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
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import RollingTime from "../../../Types/RollingTime/RollingTime";

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
      metricName: "azure_activemessages_average",
      aggegationType: MetricsAggregationType.Sum,
      attributes: {
        "azuremonitor.resource_id":
          "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/shop",
      },
    } as never,
  },
};

function intervalHandedFor(
  settings: Partial<MonitorStepMetricMonitor>,
): AggregationInterval | undefined {
  render(
    <MetricMonitorStepForm
      monitorStepMetricMonitor={{
        ...MonitorStepMetricMonitorUtil.getDefault(),
        metricViewConfig: { queryConfigs: [QUERY], formulaConfigs: [] },
        ...settings,
      }}
      onChange={(): void => {}}
    />,
  );

  expect(lastView).not.toBeNull();
  const handed: AggregationInterval | undefined = lastView!.queryReadInterval;
  cleanup();
  lastView = null;

  return handed;
}

afterEach(() => {
  cleanup();
  lastView = null;
});

describe("a Metrics monitor's form hands its view the monitor's own intervals", () => {
  test("by the minute up to 3 hours, in longer intervals past them", () => {
    expect(intervalHandedFor({ rollingTime: RollingTime.Past1Minute })).toBe(
      AggregationInterval.Minute,
    );
    expect(intervalHandedFor({ rollingTime: RollingTime.Past15Minutes })).toBe(
      AggregationInterval.Minute,
    );
    expect(intervalHandedFor({ rollingTime: RollingTime.Past3Hours })).toBe(
      AggregationInterval.Minute,
    );
    expect(intervalHandedFor({ rollingTime: RollingTime.Past6Hours })).toBe(
      AggregationInterval.FiveMinutes,
    );
    // "Past 1 Day".
    expect(intervalHandedFor({ rollingTime: RollingTime.Past1Hours })).toBe(
      AggregationInterval.FifteenMinutes,
    );
  });

  test("a step that reads its window whole is read in one interval", () => {
    expect(
      intervalHandedFor({
        rollingTime: RollingTime.Past15Minutes,
        aggregatesWholeWindow: true,
      }),
    ).toBe(AggregationInterval.Total);
  });
});
