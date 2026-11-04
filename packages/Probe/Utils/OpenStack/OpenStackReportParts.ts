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

function kindOf(metric: JSONObject): "gauge" | "sum" | null {
  return metric["gauge"] ? "gauge" : metric["sum"] ? "sum" : null;
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
      for (const metric of (scope["metrics"] || []) as Array<JSONObject>) {
        const bytes: number = sizeOf(metric);

        if (bytes <= maxBytes) {
          if (current().bytes + bytes > maxBytes) {
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

        let piece: Array<JSONObject> = [];
        let pieceBytes: number = 0;

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

          current().add(resource, scope, cut, pieceBytes);
          piece = [];
          pieceBytes = 0;
        };

        for (const point of (metric[kind] as JSONObject)[
          "dataPoints"
        ] as Array<JSONObject>) {
          const pointBytes: number = sizeOf(point);

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

  if (!resourceMetrics || sizeOf(resourceMetrics) <= maxBytes) {
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
