import fs from "fs";
import path from "path";
import OpenStackResource from "../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../Types/JSON";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_FIXTURES_FOLDER,
  RecordedSeries,
  readRecordedSeries,
  scanRecordedSeries,
} from "./OpenStackRecordedRows";

/*
 * ONE SCENE OF A SERVICE A CLOUD MAY NOT RUN, AS ONEUPTIME WOULD HOLD IT.
 *
 * Tests/Ops/openstack-e2e/services-<group>.sh drove each service on a real stable/2026.1 DevStack
 * into its states, and recorded what the agent's exporter answered in each. This reads a scene through
 * the real snapshot scan, the code ingest runs. Not a test file itself.
 */

export const RECORDED_AT_MS: number = 1793841200000;
export const RECORDED_AT: Date = new Date(RECORDED_AT_MS);

export function toOpenStackRow(
  entry: OpenStackResourceBufferEntry,
): OpenStackResource {
  return Object.assign(new OpenStackResource(), {
    kind: entry.kind,
    externalId: entry.externalId,
    name: entry.name || undefined,
    regionName: entry.regionName || undefined,
    availabilityZone: entry.availabilityZone || undefined,
    hypervisorName: entry.hypervisorName || undefined,
    openStackProjectId: entry.openStackProjectId || undefined,
    status: entry.status || undefined,
    adminState: entry.adminState || undefined,
    disabledReason: entry.disabledReason || undefined,
    diskCapacityBytes: entry.diskCapacityBytes ?? undefined,
    diskAllocatedBytes: entry.diskAllocatedBytes ?? undefined,
    facts: entry.facts,
    lastSeenAt: entry.observedAt,
    stateChangedAt: entry.observedAt,
  });
}

export class RecordedServiceScene {
  public readonly series: Array<RecordedSeries>;
  public readonly entries: Array<OpenStackResourceBufferEntry>;
  public readonly rows: Array<OpenStackResource>;
  private readonly folder: string;

  public constructor(data: {
    group: string;
    scene: string;
    // What a limited credential got is one folder further down.
    exporterFolder?: string | undefined;
  }) {
    this.folder = path.join(OPENSTACK_FIXTURES_FOLDER, data.group, data.scene);
    const exporter: string = path.join(
      this.folder,
      data.exporterFolder || "exporter",
    );
    this.series = fs.existsSync(exporter) ? readRecordedSeries(exporter) : [];
    this.entries = scanRecordedSeries(this.series, RECORDED_AT_MS);
    this.rows = this.entries.map(toOpenStackRow);
  }

  public ofKind(kind: OpenStackResourceKind): Array<OpenStackResource> {
    return this.rows.filter((row: OpenStackResource): boolean => {
      return row.kind === kind;
    });
  }

  public named(kind: OpenStackResourceKind, name: string): OpenStackResource {
    const found: OpenStackResource | undefined = this.ofKind(kind).find(
      (row: OpenStackResource): boolean => {
        return row.name === name;
      },
    );
    if (!found) {
      throw new Error(`No ${kind} called ${name}`);
    }
    return found;
  }

  public api(service: OpenStackServiceType): OpenStackResource | undefined {
    return this.ofKind(OpenStackResourceKind.Api).find(
      (row: OpenStackResource): boolean => {
        return row.name === service;
      },
    );
  }

  // What one API call answered in this scene, as it was recorded.
  public readApi(call: string): JSONObject {
    return JSON.parse(
      fs.readFileSync(path.join(this.folder, "api", `${call}.json`), "utf8"),
    ) as JSONObject;
  }

  // What the rig's own call was answered with, from its api-status.txt.
  public readApiStatus(call: string): number {
    const line: string | undefined = fs
      .readFileSync(path.join(this.folder, "api-status.txt"), "utf8")
      .split("\n")
      .find((one: string): boolean => {
        return one.endsWith(` ${call}`);
      });
    return Number(line?.split(" ")[0]);
  }

  public seriesNamed(name: string): Array<RecordedSeries> {
    return this.series.filter((series: RecordedSeries): boolean => {
      return series.name === name;
    });
  }
}

export function factsOfRow(row: OpenStackResource): JSONObject {
  return row.facts as JSONObject;
}

export function namesOfRows(
  rows: ReadonlyArray<OpenStackResource>,
): Array<string | undefined> {
  return rows
    .map((row: OpenStackResource): string | undefined => {
      return row.name;
    })
    .sort();
}

/*
 * The recording's own OTLP: what the agent's real collector made of the same answers, through ingest's
 * own filter. Holds the fullest export of each of this group's services, and one of a service the
 * cloud doesn't run, whose `up` reads 1 with no samples.
 */
export function scanRecordedOtlp(group: string): {
  entries: Array<OpenStackResourceBufferEntry>;
  // The service of every export the collector sent, with what its `up` and sample count read.
  scrapes: Array<{ service: string; up: number; samples: number }>;
} {
  const otlp: JSONObject = JSON.parse(
    fs.readFileSync(
      path.join(OPENSTACK_FIXTURES_FOLDER, group, "otlp.json"),
      "utf8",
    ),
  ) as JSONObject;
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();
  const scrapes: Array<{ service: string; up: number; samples: number }> = [];

  for (const resource of otlp["resourceMetrics"] as JSONArray) {
    const scrape: { service: string; up: number; samples: number } = {
      service: "",
      up: -1,
      samples: -1,
    };
    for (const scope of (resource as JSONObject)["scopeMetrics"] as JSONArray) {
      for (const metric of (scope as JSONObject)["metrics"] as JSONArray) {
        const name: string = (metric as JSONObject)["name"] as string;
        const data: JSONObject = ((metric as JSONObject)["gauge"] ||
          (metric as JSONObject)["sum"]) as JSONObject;
        for (const datapoint of data["dataPoints"] as JSONArray) {
          const point: JSONObject = datapoint as JSONObject;
          const value: number = Number(point["asDouble"] ?? point["asInt"]);
          if (name === "up") {
            scrape.up = value;
            for (const attribute of (point["attributes"] as JSONArray) || []) {
              if ((attribute as JSONObject)["key"] === "openstack_service") {
                scrape.service = (
                  (attribute as JSONObject)["value"] as JSONObject
                )["stringValue"] as string;
              }
            }
          }
          if (name === "scrape_samples_scraped") {
            scrape.samples = value;
          }
          if (
            isOpenStackSnapshotDatapoint({ metricName: name, datapoint: point })
          ) {
            bufferOpenStackSnapshotMetric({
              metricName: name,
              datapoint: point,
              buffer,
            });
          }
        }
      }
    }
    scrapes.push(scrape);
  }

  return { entries: finishOpenStackBatch(buffer.values()), scrapes };
}
