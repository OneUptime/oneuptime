import crypto, { createHash } from "crypto";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import { getPercentileLevel } from "Common/Types/BaseDatabase/AggregationType";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { afterEach, describe, expect, test } from "@jest/globals";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * A grouped infrastructure monitor (Kubernetes, Docker, Host, Podman,
 * Proxmox, VMware, IoT, Docker Swarm, Ceph, storage arrays) reads up to
 * 10,000 raw rows per query each check and buckets them per series and
 * minute in code (aggregatePerSeriesFromRawMetrics). That bucketing hashed
 * every row's labels with SHA-256 and built two Dates and an ISO string per
 * row. Now each series is hashed once (MetricSeriesFingerprint keeps recent
 * fingerprints) and the minute is a floor of the row's time.
 *
 * Held here: the buckets - their order, timestamps, values, attributes and
 * every aggregation type - are exactly what master's function produced for
 * the same rows (referenceAggregate below is master's, verbatim, with
 * master's fingerprint), an invalid time still throws the same error, and the
 * work is several times faster.
 */

// The worker module loads the queue and the native isolated-vm addon.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

import {
  aggregatePerSeriesFromRawMetrics,
  getUtcMinuteStartMs,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

// Master's MetricSeriesFingerprint.computeFingerprint, verbatim.
function referenceFingerprint(labels: JSONObject): string {
  const keys: Array<string> = Object.keys(labels || {}).sort();

  if (keys.length === 0) {
    return "__all__";
  }

  const parts: Array<string> = [];

  for (const key of keys) {
    const raw: unknown = labels[key];
    const value: string = raw === undefined || raw === null ? "" : String(raw);
    parts.push(`${key}=${value}`);
  }

  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

// Master's aggregatePerSeriesFromRawMetrics, verbatim.
function referenceAggregate(input: {
  rawMetrics: Array<Metric>;
  attributeKeys: Array<string>;
  aggregationType: MetricsAggregationType;
}): AggregatedResult {
  const buckets: Map<
    string,
    {
      labels: JSONObject;
      timestamp: Date;
      values: Array<number>;
      attributes: JSONObject;
    }
  > = new Map();

  for (const metric of input.rawMetrics) {
    const attrs: JSONObject = (metric.attributes as JSONObject) || {};
    const labels: JSONObject = {};
    for (const key of input.attributeKeys) {
      const value: unknown = attrs[key];
      labels[key] =
        value === undefined || value === null ? "" : (value as string);
    }
    const fingerprint: string = referenceFingerprint(labels);

    const metricTime: Date = metric.time ? new Date(metric.time) : new Date();
    const bucketDate: Date = new Date(
      Date.UTC(
        metricTime.getUTCFullYear(),
        metricTime.getUTCMonth(),
        metricTime.getUTCDate(),
        metricTime.getUTCHours(),
        metricTime.getUTCMinutes(),
        0,
        0,
      ),
    );

    const bucketKey: string = `${fingerprint}|${bucketDate.toISOString()}`;

    const value: number =
      typeof metric.value === "number" ? metric.value : Number(metric.value);

    if (!Number.isFinite(value)) {
      continue;
    }

    const existing:
      | {
          labels: JSONObject;
          timestamp: Date;
          values: Array<number>;
          attributes: JSONObject;
        }
      | undefined = buckets.get(bucketKey);

    if (existing) {
      existing.values.push(value);
    } else {
      buckets.set(bucketKey, {
        labels,
        timestamp: bucketDate,
        values: [value],
        attributes: attrs,
      });
    }
  }

  const rows: Array<AggregatedModel> = [];

  for (const bucket of buckets.values()) {
    const vs: Array<number> = bucket.values;
    if (vs.length === 0) {
      continue;
    }

    let aggregated: number;
    switch (input.aggregationType) {
      case MetricsAggregationType.Sum:
        aggregated = vs.reduce((a: number, b: number) => {
          return a + b;
        }, 0);
        break;
      case MetricsAggregationType.Count:
        aggregated = vs.length;
        break;
      case MetricsAggregationType.Max:
        aggregated = Math.max(...vs);
        break;
      case MetricsAggregationType.Min:
        aggregated = Math.min(...vs);
        break;
      case MetricsAggregationType.P50:
      case MetricsAggregationType.P75:
      case MetricsAggregationType.P90:
      case MetricsAggregationType.P95:
      case MetricsAggregationType.P99: {
        const sorted: Array<number> = [...vs].sort((a: number, b: number) => {
          return a - b;
        });
        const level: number = getPercentileLevel(input.aggregationType) || 0.5;
        const rankIndex: number = Math.min(
          sorted.length - 1,
          Math.max(0, Math.ceil(level * sorted.length) - 1),
        );
        aggregated = sorted[rankIndex]!;
        break;
      }
      case MetricsAggregationType.Avg:
      default:
        aggregated =
          vs.reduce((a: number, b: number) => {
            return a + b;
          }, 0) / vs.length;
        break;
    }

    rows.push({
      timestamp: bucket.timestamp,
      value: aggregated,
      attributes: bucket.attributes as AggregatedModel[string],
    });
  }

  return { data: rows };
}

// Master's minute: Date.UTC of the time's UTC fields.
function referenceMinuteStart(time: Date): number {
  return new Date(
    Date.UTC(
      time.getUTCFullYear(),
      time.getUTCMonth(),
      time.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      0,
      0,
    ),
  ).getTime();
}

const AGGREGATION_TYPES: Array<MetricsAggregationType> = [
  MetricsAggregationType.Avg,
  MetricsAggregationType.Sum,
  MetricsAggregationType.Count,
  MetricsAggregationType.Max,
  MetricsAggregationType.Min,
  MetricsAggregationType.P50,
  MetricsAggregationType.P75,
  MetricsAggregationType.P90,
  MetricsAggregationType.P95,
  MetricsAggregationType.P99,
];

const NOW_MS: number = Date.UTC(2026, 9, 17, 10, 0, 0, 0);

// A raw row as MetricService.findBy hands it over: the three columns read.
function metricRow(data: {
  attributes?: JSONObject | undefined;
  value: unknown;
  time?: Date | string | undefined;
}): Metric {
  const row: JSONObject = { value: data.value as number };
  if (data.attributes !== undefined) {
    row["attributes"] = data.attributes;
  }
  if (data.time !== undefined) {
    row["time"] = data.time as Date;
  }
  return row as unknown as Metric;
}

// Raw rows the way a grouped read hands them over, with the odd ones mixed in.
function seededRows(random: SeededRandom, count: number): Array<Metric> {
  const rows: Array<Metric> = [];
  const series: number = 1 + random(60);

  for (let i: number = 0; i < count; i++) {
    const s: number = random(series);
    const attributes: JSONObject = {
      "host.name": `host-${s}`,
      "k8s.pod.name": `pod-${s % 7}`,
      "k8s.namespace.name": s % 2 === 0 ? "prod" : "staging",
      "service.name": "checkout",
    };

    const oddity: number = random(40);

    if (oddity === 0) {
      delete attributes["host.name"];
    } else if (oddity === 1) {
      attributes["host.name"] = null;
    } else if (oddity === 2) {
      attributes["host.name"] = 42;
    } else if (oddity === 3) {
      attributes["host.name"] = true;
    }

    const valueKind: number = random(50);
    const value: unknown =
      valueKind === 0
        ? NaN
        : valueKind === 1
          ? Infinity
          : valueKind === 2
            ? "12.5"
            : valueKind === 3
              ? "not a number"
              : valueKind === 4
                ? null
                : Math.round(random() * 10000) / 100;

    const timeMs: number = NOW_MS - random(30 * 60 * 1000);
    const timeKind: number = random(20);

    rows.push(
      metricRow({
        attributes: random(200) === 0 ? undefined : attributes,
        value: value,
        time:
          timeKind === 0 ? new Date(timeMs).toISOString() : new Date(timeMs),
      }),
    );
  }

  return rows;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getUtcMinuteStartMs is master's minute for every time", () => {
  test("edges: the epoch, minute and day boundaries, both sides of 1970, the years 0-99, the Date range", () => {
    const times: Array<number> = [
      0,
      1,
      59999,
      60000,
      60001,
      NOW_MS,
      NOW_MS - 1,
      NOW_MS + 59999,
      Date.UTC(2026, 11, 31, 23, 59, 59, 999),
      Date.UTC(2028, 1, 29, 12, 30, 15, 500),
      -1,
      -59999,
      -60000,
      -60001,
      Date.UTC(1969, 11, 31, 23, 59, 30),
      Date.UTC(1900, 0, 1),
      new Date("0050-06-15T10:20:30.400Z").getTime(),
      new Date("0099-12-31T23:59:59.999Z").getTime(),
      new Date("0000-01-01T00:00:30.000Z").getTime(),
      new Date("-000001-01-01T00:00:30.000Z").getTime(),
      8.64e15,
      -8.64e15,
      8.64e15 - 1,
    ];

    for (const time of times) {
      expect(getUtcMinuteStartMs(new Date(time))).toBe(
        referenceMinuteStart(new Date(time)),
      );
    }
  });

  test("50,000 seeded times across the whole Date range", () => {
    const random: SeededRandom = seededRandom(60000);

    for (let i: number = 0; i < 50000; i++) {
      const time: Date = new Date(Math.floor((random() * 2 - 1) * 8.64e15));
      const minute: number = getUtcMinuteStartMs(time);

      if (minute !== referenceMinuteStart(time)) {
        throw new Error(
          `${time.toISOString()}: ${minute} where master gave ${referenceMinuteStart(time)}`,
        );
      }
    }
  });

  test("an invalid time throws the RangeError master's ISO bucket key threw", () => {
    expect(() => {
      return getUtcMinuteStartMs(new Date(NaN));
    }).toThrow(RangeError);
    expect(() => {
      return new Date(referenceMinuteStart(new Date(NaN))).toISOString();
    }).toThrow(RangeError);
  });
});

describe("aggregatePerSeriesFromRawMetrics gives master's buckets", () => {
  test("300 seeded reads, every aggregation type, one and two group-by keys", () => {
    for (let run: number = 0; run < 300; run++) {
      const random: SeededRandom = seededRandom(4000 + run);
      const rows: Array<Metric> = seededRows(random, 1 + random(400));
      const attributeKeys: Array<string> =
        run % 3 === 0
          ? ["host.name"]
          : run % 3 === 1
            ? ["k8s.pod.name", "k8s.namespace.name"]
            : ["k8s.namespace.name", "host.name", "missing.key"];
      const aggregationType: MetricsAggregationType = AGGREGATION_TYPES[
        run % AGGREGATION_TYPES.length
      ] as MetricsAggregationType;

      const branch: AggregatedResult = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rows,
        attributeKeys: attributeKeys,
        aggregationType: aggregationType,
      });
      const master: AggregatedResult = referenceAggregate({
        rawMetrics: rows,
        attributeKeys: attributeKeys,
        aggregationType: aggregationType,
      });

      // Same rows in the same order: timestamps, values and attributes.
      expect(branch).toEqual(master);
      expect(branch.data.length).toBe(master.data.length);

      for (let i: number = 0; i < master.data.length; i++) {
        const masterAttributes: unknown = master.data[i]!["attributes"];

        // The very attribute map of the bucket's first row, as before.
        if (Object.keys(masterAttributes as JSONObject).length > 0) {
          expect(branch.data[i]!["attributes"]).toBe(masterAttributes);
        }
      }
    }
  });

  test("a full read: 10,000 rows over 100 series and 25 minutes", () => {
    const rows: Array<Metric> = [];

    for (let s: number = 0; s < 100; s++) {
      for (let t: number = 0; t < 100; t++) {
        rows.push(
          metricRow({
            attributes: {
              "host.name": `host-${s}`,
              "k8s.pod.name": `pod-${s}`,
              "k8s.namespace.name": "prod",
            },
            value: (s * 7 + t) % 100,
            time: new Date(NOW_MS - t * 15000),
          }),
        );
      }
    }

    for (const aggregationType of AGGREGATION_TYPES) {
      const branch: AggregatedResult = aggregatePerSeriesFromRawMetrics({
        rawMetrics: rows,
        attributeKeys: ["host.name"],
        aggregationType: aggregationType,
      });

      expect(branch).toEqual(
        referenceAggregate({
          rawMetrics: rows,
          attributeKeys: ["host.name"],
          aggregationType: aggregationType,
        }),
      );
      expect(branch.data).toHaveLength(100 * 26);
    }
  });

  test("an empty read gives no rows", () => {
    expect(
      aggregatePerSeriesFromRawMetrics({
        rawMetrics: [],
        attributeKeys: ["host.name"],
        aggregationType: MetricsAggregationType.Avg,
      }),
    ).toEqual({ data: [] });
  });

  test("a row with an invalid time throws the same error master's did", () => {
    const rows: Array<Metric> = [
      metricRow({
        attributes: { "host.name": "a" },
        value: 1,
        time: new Date(NOW_MS),
      }),
      metricRow({
        attributes: { "host.name": "a" },
        value: 2,
        time: "not a time",
      }),
    ];

    const input: {
      rawMetrics: Array<Metric>;
      attributeKeys: Array<string>;
      aggregationType: MetricsAggregationType;
    } = {
      rawMetrics: rows,
      attributeKeys: ["host.name"],
      aggregationType: MetricsAggregationType.Avg,
    };

    expect(() => {
      return referenceAggregate(input);
    }).toThrow("Invalid time value");
    expect(() => {
      return aggregatePerSeriesFromRawMetrics(input);
    }).toThrow("Invalid time value");
  });

  test("a row without a time lands in the current minute, as before", () => {
    const before: number = Date.now();
    const result: AggregatedResult = aggregatePerSeriesFromRawMetrics({
      rawMetrics: [metricRow({ attributes: { "host.name": "a" }, value: 3 })],
      attributeKeys: ["host.name"],
      aggregationType: MetricsAggregationType.Sum,
    });
    const after: number = Date.now();

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.value).toBe(3);
    // The minute the read happened in (it may have crossed into the next).
    expect([
      referenceMinuteStart(new Date(before)),
      referenceMinuteStart(new Date(after)),
    ]).toContain((result.data[0]!.timestamp as Date).getTime());
  });

  test("a full read of 10,000 rows hashes each series once and takes a small fraction of a second", () => {
    const random: SeededRandom = seededRandom(10000);
    const rows: Array<Metric> = [];

    for (let i: number = 0; i < 10000; i++) {
      const s: number = random(100);
      rows.push(
        metricRow({
          attributes: {
            "host.name": `ip-10-0-${s}-12.ec2.internal`,
            "k8s.pod.name": `checkout-7c9d8f-${s}`,
            "k8s.namespace.name": "prod",
            "service.name": "checkout",
          },
          value: random() * 100,
          time: new Date(NOW_MS - random(25 * 60 * 1000)),
        }),
      );
    }

    const input: {
      rawMetrics: Array<Metric>;
      attributeKeys: Array<string>;
      aggregationType: MetricsAggregationType;
    } = {
      rawMetrics: rows,
      attributeKeys: ["k8s.pod.name", "k8s.namespace.name"],
      aggregationType: MetricsAggregationType.Avg,
    };

    // Master hashed every row: 10,000 SHA-256 digests for 100 series.
    const hashes: { mock: { calls: Array<unknown> } } = jest.spyOn(
      crypto,
      "createHash",
    ) as unknown as { mock: { calls: Array<unknown> } };

    const branch: FastestRun<AggregatedResult> = fastestRun({
      run: (): AggregatedResult => {
        return aggregatePerSeriesFromRawMetrics(input);
      },
      limitInMs: 0,
    });

    /*
     * At most one digest per series over all three runs (these label sets are
     * new to this file, so the first run does hash them: the spy sees it).
     */
    expect(hashes.mock.calls.length).toBeGreaterThan(0);
    expect(hashes.mock.calls.length).toBeLessThanOrEqual(100);

    jest.restoreAllMocks();

    expect(branch.result).toEqual(referenceAggregate(input));
    // About 5 ms in plain Node and 25 ms under jest; the budget is far above.
    expect(branch.inMs).toBeLessThan(500);
  });
});
