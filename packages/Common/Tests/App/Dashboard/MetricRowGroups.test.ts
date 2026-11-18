import { describe, expect, test } from "@jest/globals";
import {
  GetMetricRowGroup,
  MetricRowGroup,
  OTHER_METRICS_GROUP_TITLE,
  getMetricRowGroupHeading,
  orderMetricNamesByGroup,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricRowScope";

/*
 * A metric list in sections (MetricsViewer's getRowGroup): a cloud
 * resource's key metrics read under Availability, Traffic, Errors, Latency
 * and the rest, most telling first, its other metrics after them under
 * "Other". These pin the order the list pages through and where each
 * heading goes.
 */

const SECTIONS: Record<string, MetricRowGroup> = {
  azure_requests_total: {
    key: "traffic",
    title: "Traffic",
    order: 1,
    rank: 0,
  },
  azure_bytessent_total: {
    key: "network",
    title: "Network",
    order: 7,
    rank: 14,
  },
  azure_http5xx_total: {
    key: "errors",
    title: "Errors",
    order: 2,
    rank: 1,
  },
  azure_http4xx_total: {
    key: "errors",
    title: "Errors",
    order: 2,
    rank: 2,
  },
  azure_httpresponsetime_average: {
    key: "latency",
    title: "Latency",
    order: 3,
    rank: 3,
  },
};

const sectionOf: GetMetricRowGroup = (
  name: string,
): MetricRowGroup | undefined => {
  return SECTIONS[name];
};

describe("the order a list in sections pages through", () => {
  test("by section, then each metric's place in it, then the metrics in none by name", () => {
    expect(
      orderMetricNamesByGroup(
        [
          "process.cpu.time",
          "azure_bytessent_total",
          "azure_http4xx_total",
          "app.requests",
          "azure_httpresponsetime_average",
          "azure_http5xx_total",
          "azure_requests_total",
        ],
        sectionOf,
      ),
    ).toEqual([
      "azure_requests_total",
      "azure_http5xx_total",
      "azure_http4xx_total",
      "azure_httpresponsetime_average",
      "azure_bytessent_total",
      "app.requests",
      "process.cpu.time",
    ]);
  });

  test("each name once, and with no sections, name order alone", () => {
    expect(
      orderMetricNamesByGroup(["b", "a", "b", "c"], (): undefined => {
        return undefined;
      }),
    ).toEqual(["a", "b", "c"]);
    expect(orderMetricNamesByGroup([], sectionOf)).toEqual([]);
  });

  test("two metrics of one place in one section are in name order", () => {
    const tie: GetMetricRowGroup = (): MetricRowGroup => {
      return { key: "compute", title: "Compute", order: 4, rank: 0 };
    };

    expect(orderMetricNamesByGroup(["z", "m", "a"], tie)).toEqual([
      "a",
      "m",
      "z",
    ]);
  });
});

describe("where a section's heading goes", () => {
  const page: Array<string> = orderMetricNamesByGroup(
    [
      "azure_requests_total",
      "azure_http5xx_total",
      "azure_http4xx_total",
      "azure_httpresponsetime_average",
      "process.cpu.time",
      "app.requests",
    ],
    sectionOf,
  );

  function headingAt(index: number): string | null {
    return getMetricRowGroupHeading({
      names: page,
      index,
      getRowGroup: sectionOf,
    });
  }

  test("above the first row of each section, in English, and of the rows in none", () => {
    expect(
      page.map((_name: string, index: number): string | null => {
        return headingAt(index);
      }),
    ).toEqual([
      "Traffic",
      "Errors",
      null,
      "Latency",
      OTHER_METRICS_GROUP_TITLE,
      null,
    ]);
    expect(OTHER_METRICS_GROUP_TITLE).toBe("Other");
  });

  test("a page that starts inside a section heads it again", () => {
    expect(
      getMetricRowGroupHeading({
        names: ["azure_http4xx_total", "azure_httpresponsetime_average"],
        index: 0,
        getRowGroup: sectionOf,
      }),
    ).toBe("Errors");
  });

  test("a page none of whose rows is in a section has no heading at all", () => {
    for (let index: number = 0; index < 2; index++) {
      expect(
        getMetricRowGroupHeading({
          names: ["app.requests", "process.cpu.time"],
          index,
          getRowGroup: sectionOf,
        }),
      ).toBeNull();
    }
  });

  test("no heading past the page's end", () => {
    expect(
      getMetricRowGroupHeading({
        names: page,
        index: page.length,
        getRowGroup: sectionOf,
      }),
    ).toBeNull();
  });
});
