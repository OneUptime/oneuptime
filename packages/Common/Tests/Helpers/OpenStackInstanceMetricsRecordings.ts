import * as fs from "fs";
import * as path from "path";
import {
  OpenStackInstanceMetricsDecision,
  OpenStackInstanceMetricsHostState,
  OpenStackInstancePlacement,
  appendOpenStackInstanceMetrics,
  applyOpenStackInstanceMetricSamples,
  readOpenStackInstanceMetricSamples,
  removeOpenStackInstanceOriginals,
} from "../../Server/Utils/Telemetry/OpenStackInstanceMetricsScan";
import { JSONObject } from "../../Types/JSON";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OpenStackHypervisorCapacity,
  OpenStackInstanceMetricSource,
} from "../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  PrometheusSeries,
  parsePrometheusExposition,
  prometheusToEnvelope,
} from "./OpenStackInstanceMetricsFixtures";

/*
 * What real DevStacks said about instances doing known things (Tests/Ops/openstack-e2e/
 * instance-metrics.sh, kept by import-recording.py), and all of it put through the path a real
 * batch takes: the agent's collector's OTLP, the scan, and the state it would keep in Redis,
 * written and read back each time. Not a test file itself.
 */

const FIXTURES: string = path.join(__dirname, "../Fixtures/OpenStack");

export const RECORDED_HYPERVISOR: string = "compute-01.example.internal";
export const RECORDED_EXPORTER_HOST: string = "127.0.0.1";
export const RECORDED_REGION: string = "RegionOne";

export interface RecordedScrape {
  atMs: number;
  libvirt: string | null;
  ceilometer: string | null;
}

export interface RecordedServer {
  id: string;
  name: string;
  status: string;
  // Epoxy's client doesn't say. libvirt's own label always does.
  projectId: string | null;
  host: string | null;
  flavor: string;
}

export interface InstanceMetricsRecording {
  release: string;
  scrapes: Array<RecordedScrape>;
  servers: Array<RecordedServer>;
}

export function getRecordedInstanceMetricsReleases(): Array<string> {
  return fs
    .readdirSync(FIXTURES)
    .filter((entry: string): boolean => {
      return fs.existsSync(path.join(FIXTURES, entry, "instance-metrics"));
    })
    .sort();
}

function readIfThere(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

export function readInstanceMetricsRecording(
  release: string,
): InstanceMetricsRecording {
  const folder: string = path.join(FIXTURES, release, "instance-metrics");
  const scrapes: Array<RecordedScrape> = fs
    .readdirSync(folder)
    .filter((entry: string): boolean => {
      return entry.startsWith("scrape-");
    })
    .sort()
    .map((entry: string): RecordedScrape => {
      return {
        atMs:
          Number(
            fs.readFileSync(path.join(folder, entry, "at.txt"), "utf8").trim(),
          ) * 1000,
        libvirt: readIfThere(path.join(folder, entry, "libvirt.prom")),
        ceilometer: readIfThere(path.join(folder, entry, "ceilometer.prom")),
      };
    });
  const servers: Array<RecordedServer> = (
    JSON.parse(
      fs.readFileSync(path.join(folder, "servers.json"), "utf8"),
    ) as Array<Record<string, string | null>>
  ).map((server: Record<string, string | null>): RecordedServer => {
    return {
      id: server["ID"] as string,
      name: server["Name"] as string,
      status: server["Status"] as string,
      projectId: server["Project ID"] || null,
      host: server["Host"] || null,
      flavor: server["Flavor"] as string,
    };
  });
  return { release, scrapes, servers };
}

export function recordedServerNamed(
  recording: InstanceMetricsRecording,
  name: string,
): RecordedServer {
  const server: RecordedServer | undefined = recording.servers.find(
    (one: RecordedServer): boolean => {
      return one.name === name;
    },
  );
  if (!server) {
    throw new Error(`${recording.release} recorded no ${name}`);
  }
  return server;
}

// What each scrape said of one source, parsed.
export function recordedSeries(
  recording: InstanceMetricsRecording,
  source: OpenStackInstanceMetricSource,
): Array<{ atMs: number; series: Array<PrometheusSeries> }> {
  const out: Array<{ atMs: number; series: Array<PrometheusSeries> }> = [];
  for (const scrape of recording.scrapes) {
    const text: string | null =
      source === OpenStackInstanceMetricSource.Libvirt
        ? scrape.libvirt
        : scrape.ceilometer;
    if (text) {
      out.push({
        atMs: scrape.atMs,
        series: parsePrometheusExposition(text),
      });
    }
  }
  return out;
}

/*
 * Where each recorded instance runs, as the inventory would say, with its flavor's vCPUs: estate.sh
 * makes ou.tiny with one. An instance that was never placed has nothing to say.
 */
export function recordedPlacements(
  recording: InstanceMetricsRecording,
  capacity?: OpenStackHypervisorCapacity,
): Map<string, OpenStackInstancePlacement> {
  const placements: Map<string, OpenStackInstancePlacement> = new Map();
  for (const server of recording.servers) {
    if (server.host) {
      placements.set(server.id, {
        hypervisorName: server.host,
        regionName: RECORDED_REGION,
        projectId: server.projectId,
        aggregates: [],
        hypervisorCapacity: capacity,
        vcpus: server.flavor === "ou.tiny" ? 1 : null,
      });
    }
  }
  return placements;
}

export interface ReplayedPoint {
  atMs: number;
  name: string;
  value: number;
  unit: string;
  attributes: Record<string, string>;
}

export function replayedPointsOf(
  decision: OpenStackInstanceMetricsDecision,
): Array<ReplayedPoint> {
  const points: Array<ReplayedPoint> = [];
  for (const metric of decision.metrics) {
    const dataPoints: Array<JSONObject> = (metric["gauge"] as JSONObject)[
      "dataPoints"
    ] as Array<JSONObject>;
    for (const point of dataPoints) {
      const attributes: Record<string, string> = {};
      for (const attribute of point["attributes"] as Array<JSONObject>) {
        attributes[attribute["key"] as string] = (
          attribute["value"] as JSONObject
        )["stringValue"] as string;
      }
      points.push({
        atMs: Math.floor(Number(point["timeUnixNano"]) / 1e6),
        name: metric["name"] as string,
        value: point["asDouble"] as number,
        unit: metric["unit"] as string,
        attributes,
      });
    }
  }
  return points;
}

/*
 * Every scrape of one source through what a batch goes through, and each exporter's state written
 * out and read back between them, as Redis does. Answers with every point the scan wrote.
 */
export function replayRecordedSource(data: {
  recording: InstanceMetricsRecording;
  source: OpenStackInstanceMetricSource;
  placements?: ReadonlyMap<string, OpenStackInstancePlacement> | undefined;
  // How the collector's batches fell: every line of a scrape in one, unless this says otherwise.
  split?: ((text: string) => Array<string>) | undefined;
  // What a polling.yaml without some of them leaves out.
  leaveOut?: ((line: string) => boolean) | undefined;
}): Array<ReplayedPoint> {
  let states: Map<string, OpenStackInstanceMetricsHostState> = new Map();
  const placements: ReadonlyMap<string, OpenStackInstancePlacement> =
    data.placements || recordedPlacements(data.recording);
  const points: Array<ReplayedPoint> = [];

  for (const scrape of data.recording.scrapes) {
    const whole: string | null =
      data.source === OpenStackInstanceMetricSource.Libvirt
        ? scrape.libvirt
        : scrape.ceilometer;
    if (!whole) {
      continue;
    }
    const text: string = data.leaveOut
      ? whole
          .split("\n")
          .filter((line: string): boolean => {
            return !data.leaveOut!(line);
          })
          .join("\n")
      : whole;
    for (const batch of data.split ? data.split(text) : [text]) {
      const envelope: JSONObject = prometheusToEnvelope({
        series: parsePrometheusExposition(batch),
        timeMs: scrape.atMs,
        exporterHost: RECORDED_EXPORTER_HOST,
        cloudName: "devstack",
      });
      const decision: OpenStackInstanceMetricsDecision =
        applyOpenStackInstanceMetricSamples({
          samples: readOpenStackInstanceMetricSamples(envelope),
          states,
          placements,
          isInstanceKept: (): boolean => {
            return true;
          },
        });
      removeOpenStackInstanceOriginals({
        envelope,
        droppedDomains: decision.droppedDomains,
        droppedInstanceIds: decision.droppedInstanceIds,
      });
      appendOpenStackInstanceMetrics({ envelope, metrics: decision.metrics });
      points.push(...replayedPointsOf(decision));
      states = new Map(
        Array.from(states.entries()).map(
          ([key, state]: [string, OpenStackInstanceMetricsHostState]): [
            string,
            OpenStackInstanceMetricsHostState,
          ] => {
            return [
              key,
              JSON.parse(
                JSON.stringify(state),
              ) as OpenStackInstanceMetricsHostState,
            ];
          },
        ),
      );
    }
  }
  return points;
}

export function pointsOfInstance(
  points: ReadonlyArray<ReplayedPoint>,
  name: string,
  instanceId: string,
  device?: string,
): Array<ReplayedPoint> {
  return points.filter((point: ReplayedPoint): boolean => {
    return (
      point.name === name &&
      point.attributes[OPENSTACK_INSTANCE_ID_ATTRIBUTE] === instanceId &&
      (device === undefined ||
        point.attributes[OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE] === device)
    );
  });
}

export function pointsOfHypervisor(
  points: ReadonlyArray<ReplayedPoint>,
  name: string,
): Array<ReplayedPoint> {
  return points.filter((point: ReplayedPoint): boolean => {
    return (
      point.name === name &&
      Boolean(point.attributes[OPENSTACK_HYPERVISOR_ATTRIBUTE])
    );
  });
}

export function valuesOf(points: ReadonlyArray<ReplayedPoint>): Array<number> {
  return points.map((point: ReplayedPoint): number => {
    return point.value;
  });
}

export function meanOf(values: ReadonlyArray<number>): number {
  return (
    values.reduce((sum: number, value: number): number => {
      return sum + value;
    }, 0) / values.length
  );
}

export function sourceOf(point: ReplayedPoint): string | undefined {
  return point.attributes[OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE];
}
