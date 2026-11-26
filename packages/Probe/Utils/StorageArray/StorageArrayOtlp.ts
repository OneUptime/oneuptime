import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * One OTLP/JSON resource of gauges, as a storage array poller writes it
 * (#11004): the resource attributes name the array, every datapoint carries
 * its object's labels as attributes - the shape the Storage Array Agent's
 * prometheus receiver hands OneUptime, so the ingest reads both alike.
 *
 * Datapoints of one metric name are kept together, in the order they were
 * written; a datapoint whose value is not a finite number is never written.
 */

export const STORAGE_ARRAY_OTLP_SCOPE_NAME: string =
  "oneuptime-probe/storage-array";

interface MetricBucket {
  name: string;
  dataPoints: JSONArray;
}

export default class StorageArrayOtlpResource {
  private readonly attributes: JSONArray;
  private readonly defaultTimeUnixNano: string;
  private readonly metrics: Map<string, MetricBucket> = new Map();
  private datapoints: number = 0;

  public constructor(data: {
    resourceAttributes: Record<string, string>;
    timeMs: number;
  }) {
    this.attributes = StorageArrayOtlpResource.toAttributes(
      data.resourceAttributes,
    );
    this.defaultTimeUnixNano = StorageArrayOtlpResource.toUnixNano(data.timeMs);
  }

  public static toUnixNano(timeMs: number): string {
    return `${Math.trunc(timeMs)}000000`;
  }

  public static toAttributes(labels: Record<string, string>): JSONArray {
    const attributes: JSONArray = [];
    for (const [key, value] of Object.entries(labels)) {
      if (typeof value === "string" && value.length > 0) {
        attributes.push({ key, value: { stringValue: value } });
      }
    }
    return attributes;
  }

  /*
   * One gauge datapoint. Labels with an empty value are left out, as a
   * Prometheus exporter leaves them out.
   */
  public gauge(
    name: string,
    value: number | null | undefined,
    labels: Record<string, string> = {},
    timeMs?: number | undefined,
  ): void {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return;
    }
    let bucket: MetricBucket | undefined = this.metrics.get(name);
    if (!bucket) {
      bucket = { name, dataPoints: [] };
      this.metrics.set(name, bucket);
    }
    bucket.dataPoints.push({
      asDouble: value,
      timeUnixNano:
        timeMs === undefined
          ? this.defaultTimeUnixNano
          : StorageArrayOtlpResource.toUnixNano(timeMs),
      attributes: StorageArrayOtlpResource.toAttributes(labels),
    });
    this.datapoints++;
  }

  public getDatapointCount(): number {
    return this.datapoints;
  }

  public hasMetric(name: string): boolean {
    return this.metrics.has(name);
  }

  // Drops every datapoint of the metrics whose name starts with a prefix.
  public dropMetrics(prefix: string): number {
    let dropped: number = 0;
    for (const [name, bucket] of Array.from(this.metrics.entries())) {
      if (name.startsWith(prefix)) {
        dropped += bucket.dataPoints.length;
        this.metrics.delete(name);
      }
    }
    this.datapoints -= dropped;
    return dropped;
  }

  /*
   * Drops the datapoints of one metric that carry a label's value - one
   * endpoint's "listed in full" mark, for a list the upload no longer
   * carries in full.
   */
  public dropDatapoints(name: string, label: string, value: string): number {
    const bucket: MetricBucket | undefined = this.metrics.get(name);
    if (!bucket) {
      return 0;
    }
    const kept: JSONArray = bucket.dataPoints.filter(
      (point: JSONArray[number]): boolean => {
        const attributes: JSONArray =
          ((point as JSONObject)["attributes"] as JSONArray | undefined) || [];
        return !attributes.some((attribute: JSONArray[number]): boolean => {
          const entry: JSONObject = attribute as JSONObject;
          return (
            entry["key"] === label &&
            (entry["value"] as JSONObject | undefined)?.["stringValue"] ===
              value
          );
        });
      },
    );
    const dropped: number = bucket.dataPoints.length - kept.length;
    if (kept.length === 0) {
      this.metrics.delete(name);
    } else {
      bucket.dataPoints = kept;
    }
    this.datapoints -= dropped;
    return dropped;
  }

  public build(scopeVersion: string): JSONObject {
    const metrics: JSONArray = Array.from(this.metrics.values()).map(
      (bucket: MetricBucket): JSONObject => {
        return {
          name: bucket.name,
          gauge: { dataPoints: bucket.dataPoints },
        };
      },
    );
    return {
      resource: { attributes: this.attributes },
      scopeMetrics: [
        {
          scope: { name: STORAGE_ARRAY_OTLP_SCOPE_NAME, version: scopeVersion },
          metrics: metrics,
        },
      ],
    };
  }
}
