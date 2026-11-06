import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
  OpenStackCollectionReport,
} from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * A collection larger than one upload, as several, each under the ceiling the server's request
 * body limit sets (GzipRequestBody: 50 MiB inflated).
 *
 * Each part is an ordinary report: same cloud, same status, same error, so a server that has never
 * heard of parts reads each one as it reads any report. Only the first says what was found (its
 * summary), because that is what the card shows and a later part has nothing new to add. Every
 * part goes through the same ingest as one job.
 *
 * Whole metrics stay together while they fit, and the first of them stay in the first part. So the
 * series a hypervisor is folded from arrive with its nova-compute's, as they do on a cloud small
 * enough for one upload. Only a metric too large for any part is cut, datapoint by datapoint, and
 * the only ones that size hold a datapoint per instance or per volume, which stands on its own.
 */

function sizeOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/*
 * A datapoint is about a kilobyte of JSON. Measured this many at a time, because a string this
 * process can hold ends at 512 MiB, and a whole metric can hold more than that.
 */
const DATAPOINTS_MEASURED_AT_ONCE: number = 50_000;

function sizeOfMetric(metric: JSONObject): number {
  const kind: "gauge" | "sum" | null = kindOf(metric);
  const points: JSONArray | undefined = kind
    ? ((metric[kind] as JSONObject)["dataPoints"] as JSONArray)
    : undefined;

  if (!kind || !points || points.length <= DATAPOINTS_MEASURED_AT_ONCE) {
    return sizeOf(metric);
  }

  let size: number = sizeOf({
    ...metric,
    [kind]: { ...(metric[kind] as JSONObject), dataPoints: [] },
  });

  for (
    let start: number = 0;
    start < points.length;
    start += DATAPOINTS_MEASURED_AT_ONCE
  ) {
    size += sizeOf(points.slice(start, start + DATAPOINTS_MEASURED_AT_ONCE));
  }

  return size;
}

// How large the JSON of these metrics is, however large: nothing here holds it as one string.
export function getOpenStackMetricsSizeInBytes(
  resourceMetrics: JSONArray,
): number {
  let size: number = 0;

  for (const resource of resourceMetrics as Array<JSONObject>) {
    size += sizeOf(resource["resource"] ?? null);

    for (const scope of (resource["scopeMetrics"] || []) as Array<JSONObject>) {
      size += sizeOf(scope["scope"] ?? null);

      for (const metric of (scope["metrics"] || []) as Array<JSONObject>) {
        size += sizeOfMetric(metric);
      }
    }
  }

  return size;
}

function kindOf(metric: JSONObject): "gauge" | "sum" | null {
  return metric["gauge"] ? "gauge" : metric["sum"] ? "sum" : null;
}

// What a resource's own lines come to around its metrics, beyond what it names.
const RESOURCE_WRAPPING_BYTES: number = 64;

function sizeOfWrapping(resource: JSONObject, scope: JSONObject): number {
  return (
    sizeOf(resource["resource"] ?? null) +
    sizeOf(scope["scope"] ?? null) +
    RESOURCE_WRAPPING_BYTES
  );
}

class ReportPart {
  public readonly resources: Array<JSONObject> = [];
  public bytes: number = 0;

  public add(
    resource: JSONObject,
    scope: JSONObject,
    metric: JSONObject,
    bytes: number,
  ): void {
    let entry: JSONObject | undefined = this.resources.find(
      (candidate: JSONObject): boolean => {
        return candidate["resource"] === resource["resource"];
      },
    );

    if (!entry) {
      entry = {
        resource: resource["resource"],
        scopeMetrics: [{ scope: scope["scope"], metrics: [] }],
      };
      this.resources.push(entry);
      this.bytes += sizeOfWrapping(resource, scope);
    }

    (
      (entry["scopeMetrics"] as Array<JSONObject>)[0]![
        "metrics"
      ] as Array<JSONObject>
    ).push(metric);

    this.bytes += bytes;
  }
}

export function splitOpenStackResourceMetrics(
  resourceMetrics: JSONArray,
  maxBytes: number,
): Array<JSONArray> {
  const parts: Array<ReportPart> = [new ReportPart()];
  const current: () => ReportPart = (): ReportPart => {
    return parts[parts.length - 1] as ReportPart;
  };

  for (const resource of resourceMetrics as Array<JSONObject>) {
    for (const scope of (resource["scopeMetrics"] || []) as Array<JSONObject>) {
      const wrapping: number = sizeOfWrapping(resource, scope);

      for (const metric of (scope["metrics"] || []) as Array<JSONObject>) {
        // And the comma between it and the next.
        const bytes: number = sizeOfMetric(metric) + 1;

        if (bytes + wrapping <= maxBytes) {
          if (current().bytes + bytes + wrapping > maxBytes) {
            parts.push(new ReportPart());
          }

          current().add(resource, scope, metric, bytes);
          continue;
        }

        const kind: "gauge" | "sum" | null = kindOf(metric);

        if (!kind) {
          // Nothing a collector writes, so nothing to cut: it goes whole, and may be refused.
          parts.push(new ReportPart());
          current().add(resource, scope, metric, bytes);
          continue;
        }

        // The metric's own words go with each piece of it.
        const shellBytes: number =
          sizeOf({
            ...metric,
            [kind]: { ...(metric[kind] as JSONObject), dataPoints: [] },
          }) + wrapping;

        let piece: Array<JSONObject> = [];
        let pieceBytes: number = shellBytes;

        const flush: () => void = (): void => {
          if (piece.length === 0) {
            return;
          }

          const cut: JSONObject = {
            ...metric,
            [kind]: { ...(metric[kind] as JSONObject), dataPoints: piece },
          };

          if (current().bytes + pieceBytes > maxBytes) {
            parts.push(new ReportPart());
          }

          current().add(resource, scope, cut, pieceBytes - wrapping);
          piece = [];
          pieceBytes = shellBytes;
        };

        for (const point of (metric[kind] as JSONObject)[
          "dataPoints"
        ] as Array<JSONObject>) {
          const pointBytes: number = sizeOf(point) + 1;

          if (pieceBytes + pointBytes > maxBytes) {
            flush();
          }

          piece.push(point);
          pieceBytes += pointBytes;
        }

        flush();
      }
    }
  }

  return parts.map((part: ReportPart): JSONArray => {
    return part.resources;
  });
}

export function splitOpenStackReport(
  report: OpenStackCollectionReport,
  maxBytes: number = OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
): Array<OpenStackCollectionReport> {
  const resourceMetrics: JSONArray | undefined = report.resourceMetrics;

  if (
    !resourceMetrics ||
    getOpenStackMetricsSizeInBytes(resourceMetrics) <= maxBytes
  ) {
    return [report];
  }

  return splitOpenStackResourceMetrics(resourceMetrics, maxBytes).map(
    (part: JSONArray, index: number): OpenStackCollectionReport => {
      return index === 0
        ? { ...report, resourceMetrics: part }
        : {
            ...report,
            summary: undefined,
            resourceLogs: undefined,
            resourceMetrics: part,
          };
    },
  );
}
