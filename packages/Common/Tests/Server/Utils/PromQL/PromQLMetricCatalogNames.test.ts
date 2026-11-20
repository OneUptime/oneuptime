import MetricType from "../../../../Models/DatabaseModels/MetricType";
import MetricService from "../../../../Server/Services/MetricService";
import MetricTypeService from "../../../../Server/Services/MetricTypeService";
import { listPromQLMetricNames } from "../../../../Server/Utils/PromQL/PromQLMetricCatalog";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The metric names /api/v1/label/__name__/values and the PromQL tab's
 * metric picker list (issue #7715): each series once, under the name
 * Prometheus 3 and the OpenTelemetry Collector's exporters give it, with
 * its unit - what dashboards written against those systems use. The name
 * without the unit still finds the series (PromQLMetricUnitNames), and is
 * not listed beside it.
 */

const metricType: (data: {
  name: string;
  unit?: string;
  isMonotonic?: boolean;
}) => MetricType = (data: {
  name: string;
  unit?: string;
  isMonotonic?: boolean;
}): MetricType => {
  const type: MetricType = new MetricType();
  type.name = data.name;
  type.unit = data.unit;
  type.isMonotonic = data.isMonotonic ?? false;
  return type;
};

describe("listPromQLMetricNames", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("lists every series under its Prometheus name, with its unit", async () => {
    jest.spyOn(MetricTypeService, "findBy").mockResolvedValue([
      metricType({ name: "http.server.request.duration", unit: "s" }),
      metricType({ name: "system.memory.usage", unit: "By" }),
      metricType({ name: "system.cpu.utilization", unit: "1" }),
      metricType({
        name: "system.network.io",
        unit: "By",
        isMonotonic: true,
      }),
      metricType({ name: "rpc.latency", unit: "ms" }),
      // Sent by remote write under its Prometheus name: kept as it is.
      metricType({
        name: "http_request_duration_seconds_bucket",
        unit: "seconds",
        isMonotonic: true,
      }),
      metricType({ name: "node_cpu_seconds_total", isMonotonic: true }),
    ] as never);
    jest.spyOn(MetricService, "executeQuery").mockResolvedValue({
      json: async (): Promise<{ data: Array<unknown> }> => {
        return {
          data: [
            { name: "http.server.request.duration", pointType: "Histogram" },
            { name: "rpc.latency", pointType: "Summary" },
          ],
        };
      },
    } as never);

    expect(
      await listPromQLMetricNames({
        projectId: ObjectID.generate(),
        props: { isRoot: true },
      }),
    ).toEqual([
      "http_request_duration_seconds_bucket",
      "http_server_request_duration_seconds_bucket",
      "http_server_request_duration_seconds_count",
      "http_server_request_duration_seconds_sum",
      "node_cpu_seconds_total",
      "rpc_latency_milliseconds",
      "rpc_latency_milliseconds_count",
      "rpc_latency_milliseconds_sum",
      "system_cpu_utilization_ratio",
      "system_memory_usage_bytes",
      "system_network_io_bytes_total",
    ]);
  });

  test("a metric with no unit is listed as before", async () => {
    jest
      .spyOn(MetricTypeService, "findBy")
      .mockResolvedValue([
        metricType({ name: "queue.depth" }),
        metricType({ name: "jobs.done", unit: "{job}", isMonotonic: true }),
      ] as never);
    jest.spyOn(MetricService, "executeQuery").mockResolvedValue({
      json: async (): Promise<{ data: Array<unknown> }> => {
        return { data: [] };
      },
    } as never);

    expect(
      await listPromQLMetricNames({
        projectId: ObjectID.generate(),
        props: { isRoot: true },
      }),
    ).toEqual(["jobs_done_total", "queue_depth"]);
  });
});
