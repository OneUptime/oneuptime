import MetricType from "../../../../Models/DatabaseModels/MetricType";
import MetricService from "../../../../Server/Services/MetricService";
import MetricTypeService from "../../../../Server/Services/MetricTypeService";
import {
  PrometheusMetricMetadata,
  listPromQLMetricMetadata,
} from "../../../../Server/Utils/PromQL/PromQLMetricCatalog";
import {
  PrometheusMatrixEntry,
  PrometheusQueryData,
  PrometheusVectorEntry,
  formatPrometheusQueryResult,
} from "../../../../Server/Utils/PromQL/PrometheusHttpApi";
import {
  PromQLMetricRow,
  parsePromQLMetricRow,
  promQLSeriesFromRows,
} from "../../../../Server/Utils/PromQL/PromQLMetricRows";
import ObjectID from "../../../../Types/ObjectID";
import {
  PromQLResultType,
  PromQLSeries,
} from "../../../../Utils/PromQL/PromQLEngineTypes";
import { PromQLLabels } from "../../../../Utils/PromQL/PromQLLabels";
import { PromQLSeriesKind } from "../../../../Utils/PromQL/PromQLMetricNames";
import { readOwnValue } from "../../../../Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "../../../Helpers/InheritedNames";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What the Prometheus HTTP API hands Grafana for a label or a metric named
 * __proto__ (issue #8025): the answer's `metric` maps were copied with a
 * spread, and /api/v1/metadata's map written with an assignment, and both
 * drop a key so named. Every other name an object inherits was answered
 * already, and still is.
 */

// A label set as the engine holds it: own keys, __proto__ included.
const labelsOf: (record: Record<string, string>) => PromQLLabels = (
  record: Record<string, string>,
): PromQLLabels => {
  return JSON.parse(JSON.stringify(record)) as PromQLLabels;
};

describe("the query answer's metric maps", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "a vector's metric keeps a label named %s, through JSON",
    (name: string) => {
      const data: PrometheusQueryData = formatPrometheusQueryResult({
        resultType: PromQLResultType.Vector,
        samples: [
          {
            labels: labelsOf({ __name__: "up", [name]: "eu", job: "api" }),
            timestampMs: 600000,
            value: 1,
          },
        ],
      });

      const metric: Record<string, string> = (
        data.result as Array<PrometheusVectorEntry>
      )[0]!.metric;

      expect(Object.keys(metric)).toEqual(["__name__", name, "job"]);
      expect(readOwnValue(metric, name)).toBe("eu");
      expect(Object.getPrototypeOf(metric)).toBe(Object.prototype);

      // What the response's JSON says, and what Grafana reads back.
      const sent: string = JSON.stringify(data);

      expect(sent).toContain(`"${name}":"eu"`);
      expect(
        readOwnValue(
          (JSON.parse(sent) as { result: Array<PrometheusVectorEntry> })
            .result[0]!.metric,
          name,
        ),
      ).toBe("eu");
    },
  );

  test.each(INHERITED_PROPERTY_NAMES)(
    "a matrix's metric keeps a label named %s",
    (name: string) => {
      const data: PrometheusQueryData = formatPrometheusQueryResult({
        resultType: PromQLResultType.Matrix,
        series: [
          {
            labels: labelsOf({ [name]: "us" }),
            points: [{ timestampMs: 60000, value: 2 }],
          },
        ],
      });

      const metric: Record<string, string> = (
        data.result as Array<PrometheusMatrixEntry>
      )[0]!.metric;

      expect(readOwnValue(metric, name)).toBe("us");
      expect(JSON.stringify(data)).toContain(`"${name}":"us"`);
    },
  );

  test("the answer's metric is a copy: changing it leaves the engine's labels as they were", () => {
    const labels: PromQLLabels = labelsOf({ ["__proto__"]: "eu" });
    const data: PrometheusQueryData = formatPrometheusQueryResult({
      resultType: PromQLResultType.Vector,
      samples: [{ labels, timestampMs: 600000, value: 1 }],
    });
    const metric: Record<string, string> = (
      data.result as Array<PrometheusVectorEntry>
    )[0]!.metric;

    expect(metric).not.toBe(labels);
    delete metric["__proto__"];
    expect(readOwnValue(labels, "__proto__")).toBe("eu");
  });
});

describe("a metric row's attributes as PromQL labels", () => {
  test.each(INHERITED_PROPERTY_NAMES)(
    "an attribute named %s of a stored row is a label of its series, and of each histogram bucket's",
    (name: string) => {
      // A row as ClickHouse's JSON answer carries it: the map's own keys.
      const stored: (overrides: Record<string, unknown>) => PromQLMetricRow = (
        overrides: Record<string, unknown>,
      ): PromQLMetricRow => {
        return parsePromQLMetricRow(
          JSON.parse(
            JSON.stringify({
              name: "requests",
              metricPointType: "Gauge",
              attributes: { [name]: "eu", "resource.service.name": "api" },
              timestampMs: 590000,
              value: 3,
              ...overrides,
            }),
          ) as Record<string, unknown>,
        );
      };

      const gauges: Array<PromQLSeries> = promQLSeriesFromRows({
        rows: [stored({})],
        requests: [
          {
            storedName: "requests",
            kind: PromQLSeriesKind.Value,
            seriesName: "requests",
          },
        ],
        matchers: [],
        startTimeMs: 0,
        endTimeMs: 600000,
      });

      expect(gauges).toHaveLength(1);
      expect(readOwnValue(gauges[0]!.labels, name)).toBe("eu");
      expect(readOwnValue(gauges[0]!.labels, "job")).toBe("api");
      expect(readOwnValue(gauges[0]!.labels, "__name__")).toBe("requests");
      expect(Object.getPrototypeOf(gauges[0]!.labels)).toBe(Object.prototype);

      const buckets: Array<PromQLSeries> = promQLSeriesFromRows({
        rows: [
          stored({
            metricPointType: "Histogram",
            count: 3,
            sum: 1,
            bucketCounts: [1, 2],
            explicitBounds: [0.5],
          }),
        ],
        requests: [
          {
            storedName: "requests",
            kind: PromQLSeriesKind.Bucket,
            seriesName: "requests_bucket",
          },
        ],
        matchers: [],
        startTimeMs: 0,
        endTimeMs: 600000,
      });

      expect(
        buckets.map((series: PromQLSeries): [unknown, unknown] => {
          return [
            readOwnValue(series.labels, "le"),
            readOwnValue(series.labels, name),
          ];
        }),
      ).toEqual([
        ["0.5", "eu"],
        ["+Inf", "eu"],
      ]);
    },
  );
});

/*
 * /api/v1/metadata: one entry a metric, keyed by its PromQL name. Nothing
 * tested this function before; the catalog and the point-type read are
 * stubbed here, as the database would answer them.
 */
describe("listPromQLMetricMetadata", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const metricType: (name: string, isMonotonic?: boolean) => MetricType = (
    name: string,
    isMonotonic: boolean = false,
  ): MetricType => {
    const type: MetricType = new MetricType();
    type.name = name;
    type.description = `about ${name}`;
    type.unit = "1";
    type.isMonotonic = isMonotonic;
    return type;
  };

  const metadataFor: (
    catalog: Array<MetricType>,
    options?: { metric?: string; limit?: number },
  ) => Promise<Record<string, Array<PrometheusMetricMetadata>>> = async (
    catalog: Array<MetricType>,
    options: { metric?: string; limit?: number } = {},
  ): Promise<Record<string, Array<PrometheusMetricMetadata>>> => {
    jest.spyOn(MetricTypeService, "findBy").mockResolvedValue(catalog as never);
    jest.spyOn(MetricService, "executeQuery").mockResolvedValue({
      json: async (): Promise<{ data: Array<unknown> }> => {
        return { data: [] };
      },
    } as never);

    return listPromQLMetricMetadata({
      projectId: ObjectID.generate(),
      props: { isRoot: true },
      metric: options.metric,
      limit: options.limit ?? 100,
    });
  };

  test("lists a metric named __proto__, as its own key, beside the others", async () => {
    const metadata: Record<
      string,
      Array<PrometheusMetricMetadata>
    > = await metadataFor([
      metricType("http.requests", true),
      metricType("__proto__", true),
      metricType("constructor"),
    ]);

    /*
     * Keyed by the names Prometheus gives them (issue #7715): an
     * OpenTelemetry counter with its _total, a name that is a Prometheus
     * name already as it is; `1` is no unit in Prometheus' words.
     */
    expect(Object.keys(metadata)).toEqual([
      "http_requests_total",
      "__proto__",
      "constructor",
    ]);
    expect(readOwnValue(metadata, "__proto__")).toEqual([
      { type: "counter", help: "about __proto__", unit: "" },
    ]);
    expect(readOwnValue(metadata, "constructor")).toEqual([
      { type: "unknown", help: "about constructor", unit: "" },
    ]);
    expect(Object.getPrototypeOf(metadata)).toBe(Object.prototype);
    expect(JSON.stringify(metadata)).toContain('"__proto__":[');
  });

  test("answers for a metric named __proto__ when asked for it alone", async () => {
    const metadata: Record<
      string,
      Array<PrometheusMetricMetadata>
    > = await metadataFor(
      [metricType("http.requests"), metricType("__proto__")],
      { metric: "__proto__" },
    );

    expect(Object.keys(metadata)).toEqual(["__proto__"]);
  });

  test("keys each metric by its Prometheus family name, in Prometheus' unit", async () => {
    const histogram: MetricType = metricType("http.server.request.duration");
    histogram.unit = "s";
    const memory: MetricType = metricType("system.memory.usage");
    memory.unit = "By";
    const network: MetricType = metricType("system.network.io", true);
    network.unit = "By";

    jest
      .spyOn(MetricTypeService, "findBy")
      .mockResolvedValue([histogram, memory, network] as never);
    jest.spyOn(MetricService, "executeQuery").mockResolvedValue({
      json: async (): Promise<{ data: Array<unknown> }> => {
        return {
          data: [
            { name: "http.server.request.duration", pointType: "Histogram" },
          ],
        };
      },
    } as never);

    const metadata: Record<
      string,
      Array<PrometheusMetricMetadata>
    > = await listPromQLMetricMetadata({
      projectId: ObjectID.generate(),
      props: { isRoot: true },
      metric: undefined,
      limit: 100,
    });

    expect(metadata).toEqual({
      http_server_request_duration_seconds: [
        {
          type: "histogram",
          help: "about http.server.request.duration",
          unit: "seconds",
        },
      ],
      system_memory_usage_bytes: [
        { type: "unknown", help: "about system.memory.usage", unit: "bytes" },
      ],
      system_network_io_bytes_total: [
        { type: "counter", help: "about system.network.io", unit: "bytes" },
      ],
    });
  });

  test("stops at the limit, a metric named __proto__ counting as one", async () => {
    const metadata: Record<
      string,
      Array<PrometheusMetricMetadata>
    > = await metadataFor(
      [metricType("__proto__"), metricType("a"), metricType("b")],
      { limit: 2 },
    );

    expect(Object.keys(metadata)).toEqual(["__proto__", "a"]);
  });
});
