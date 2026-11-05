import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import {
  OpenStackInstanceMetricSample,
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

/*
 * ---------------------------------------------------------------------------
 * The long drill (Tests/Ops/openstack-e2e/instance-metrics-drill.sh)
 * ---------------------------------------------------------------------------
 *
 * Not a scrape at a time as this helper's other half is, but what the agent's real collector
 * really sent, envelope by envelope, at its real pace, with Ceilometer polling at its default of
 * five minutes. Its timeline says when each thing happened.
 */
export interface InstanceMetricsDrill {
  release: string;
  envelopes: Array<JSONObject>;
  // When each thing in the drill happened, by its name there.
  timeline: Record<string, number>;
  instances: Array<RecordedDrillInstance>;
}

export interface RecordedDrillInstance {
  id: string;
  name: string;
  projectId: string;
  vcpus: number;
}

export function getDrilledInstanceMetricsReleases(): Array<string> {
  return fs
    .readdirSync(FIXTURES)
    .filter((entry: string): boolean => {
      return fs.existsSync(
        path.join(FIXTURES, entry, "instance-metrics-drill", "otlp.jsonl.gz"),
      );
    })
    .sort();
}

export function labelOf(point: JSONObject, key: string): string | undefined {
  const found: JSONObject | undefined = (
    (point["attributes"] as Array<JSONObject> | undefined) || []
  ).find((attribute: JSONObject): boolean => {
    return attribute["key"] === key;
  });
  return (found?.["value"] as JSONObject | undefined)?.["stringValue"] as
    | string
    | undefined;
}

export function dataPointsOf(
  envelope: JSONObject,
  metricName: string,
): Array<JSONObject> {
  const points: Array<JSONObject> = [];
  for (const scope of envelope["scopeMetrics"] as Array<JSONObject>) {
    for (const metric of scope["metrics"] as Array<JSONObject>) {
      if (metric["name"] === metricName) {
        const holder: JSONObject = (metric["gauge"] ||
          metric["sum"]) as JSONObject;
        points.push(...(holder["dataPoints"] as Array<JSONObject>));
      }
    }
  }
  return points;
}

export function readInstanceMetricsDrill(
  release: string,
): InstanceMetricsDrill {
  const folder: string = path.join(FIXTURES, release, "instance-metrics-drill");
  const envelopes: Array<JSONObject> = zlib
    .gunzipSync(fs.readFileSync(path.join(folder, "otlp.jsonl.gz")))
    .toString("utf8")
    .split("\n")
    .filter((line: string): boolean => {
      return Boolean(line);
    })
    .map((line: string): JSONObject => {
      return JSON.parse(line) as JSONObject;
    });

  const timeline: Record<string, number> = {};
  for (const line of fs
    .readFileSync(path.join(folder, "timeline.txt"), "utf8")
    .split("\n")) {
    const [at, what]: Array<string> = line.trim().split(" ");
    if (at && what) {
      timeline[what] = Number(at) * 1000;
    }
  }

  // Who each instance is, as libvirt's exporter says, and how many vCPUs each has.
  const instances: Map<string, RecordedDrillInstance> = new Map();
  const domains: Map<string, string> = new Map();
  for (const envelope of envelopes) {
    for (const point of dataPointsOf(
      envelope,
      "libvirt_domain_openstack_info",
    )) {
      const id: string = labelOf(point, "instance_id")!;
      domains.set(labelOf(point, "domain")!, id);
      instances.set(id, {
        id,
        name: labelOf(point, "instance_name")!,
        projectId: labelOf(point, "project_id")!,
        vcpus: instances.get(id)?.vcpus || 0,
      });
    }
    for (const point of dataPointsOf(
      envelope,
      "libvirt_domain_info_virtual_cpus",
    )) {
      const id: string | undefined = domains.get(labelOf(point, "domain")!);
      const instance: RecordedDrillInstance | undefined = id
        ? instances.get(id)
        : undefined;
      if (instance) {
        instance.vcpus = Number(point["asDouble"] ?? point["asInt"]);
      }
    }
  }

  return {
    release,
    envelopes,
    timeline,
    instances: Array.from(instances.values()),
  };
}

export function drillInstanceNamed(
  drill: InstanceMetricsDrill,
  name: string,
): RecordedDrillInstance {
  const instance: RecordedDrillInstance | undefined = drill.instances.find(
    (one: RecordedDrillInstance): boolean => {
      return one.name === name;
    },
  );
  if (!instance) {
    throw new Error(`${drill.release}'s drill recorded no ${name}`);
  }
  return instance;
}

// The inventory of a cloud that ran the drill, with what its one hypervisor has.
export function drillPlacements(
  drill: InstanceMetricsDrill,
  capacity?: OpenStackHypervisorCapacity,
): Map<string, OpenStackInstancePlacement> {
  return new Map(
    drill.instances.map(
      (
        instance: RecordedDrillInstance,
      ): [string, OpenStackInstancePlacement] => {
        return [
          instance.id,
          {
            hypervisorName: RECORDED_HYPERVISOR,
            regionName: RECORDED_REGION,
            projectId: instance.projectId,
            aggregates: [],
            hypervisorCapacity: capacity,
            vcpus: instance.vcpus,
          },
        ];
      },
    ),
  );
}

// Everything one source sent through the path a batch takes, in the order the collector sent it.
export function replayDrillSource(data: {
  drill: InstanceMetricsDrill;
  source: OpenStackInstanceMetricSource;
  capacity?: OpenStackHypervisorCapacity | undefined;
}): Array<ReplayedPoint> {
  const states: Map<string, OpenStackInstanceMetricsHostState> = new Map();
  const placements: Map<string, OpenStackInstancePlacement> = drillPlacements(
    data.drill,
    data.capacity,
  );
  const points: Array<ReplayedPoint> = [];
  for (const envelope of data.drill.envelopes) {
    const samples: Array<OpenStackInstanceMetricSample> =
      readOpenStackInstanceMetricSamples(envelope).filter(
        (sample: OpenStackInstanceMetricSample): boolean => {
          return sample.source === data.source;
        },
      );
    if (samples.length > 0) {
      points.push(
        ...replayedPointsOf(
          applyOpenStackInstanceMetricSamples({
            samples,
            states,
            placements,
            isInstanceKept: (): boolean => {
              return true;
            },
          }),
        ),
      );
    }
  }
  return points;
}

// What every alert template's window reads beside what it compares.
export function drillAnchorSamples(
  drill: InstanceMetricsDrill,
): Array<{ timeMs: number; value: number }> {
  const samples: Array<{ timeMs: number; value: number }> = [];
  for (const envelope of drill.envelopes) {
    for (const point of dataPointsOf(envelope, "openstack_nova_up")) {
      samples.push({
        timeMs: Math.floor(Number(point["timeUnixNano"]) / 1e6),
        value: Number(point["asDouble"] ?? point["asInt"]),
      });
    }
  }
  return samples;
}
