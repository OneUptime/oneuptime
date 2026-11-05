import * as fs from "fs";
import * as path from "path";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import {
  OpenStackControlPlaneEntry,
  foldOpenStackControlPlaneDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackControlPlaneScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE,
  OPENSTACK_REGION_ATTRIBUTE,
} from "../../../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OPENSTACK_DEPENDENCY_LABEL,
  OPENSTACK_EXPORTER_HOST_LABEL,
  OPENSTACK_RABBITMQ_QUEUE_DEPENDENCY_LABEL_VALUE,
  OpenStackDependency,
} from "../../../../Types/OpenStack/OpenStackControlPlane";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";

/*
 * WHAT REAL CLUSTERS SAID WHEN THEY BROKE, AS THE AGENT'S COLLECTOR WOULD HAVE SENT IT.
 *
 * Tests/Ops/openstack-e2e/control-plane-clusters.sh breaks RabbitMQ, Galera, Memcached, HAProxy
 * and OVN, one thing at a time, and records every exporter's whole answer twice, some seconds
 * apart. Tests/Ops/openstack-e2e/import-control-plane-recording.py keeps what the agent keeps,
 * in Tests/Fixtures/OpenStack/control-plane. This turns those answers back into what reaches
 * OneUptime, the way otel-collector-config.yaml does it, reading that file:
 *
 *  - every series gets its dependency, its machine, its region and its cloud;
 *  - an endpoint's `up` is how it answered, which an exposition cannot say of itself;
 *  - each counter in filter/control-plane-increases also goes out as how much it grew in a
 *    minute, worked out from the two readings.
 *
 * A scene is a moment, and a template's window is minutes. So a scene is held: its two readings
 * by turns, one a minute, for as long as it is asked to last. That is the one thing here nobody
 * recorded. Run 41922778894's collector, which ran through all of it, is what says the labels
 * and the increases above are right (OpenStackControlPlaneScenes.test.ts).
 *
 * Tests/Ops/openstack-e2e/control-plane-cloud.sh does the same beside a real DevStack, stopping
 * one thing for some minutes and reading it each minute, so a drill has a timeline of its own
 * and what the services above did meanwhile (the exporter in single-cloud mode, whose series
 * carry no dependency). Those minutes are shorter than a template's window, so the last of them
 * is held to reach it: readCloudDrill's callers say how long.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");

const FIXTURES: string = path.join(
  REPO_ROOT,
  "packages",
  "Common",
  "Tests",
  "Fixtures",
  "OpenStack",
  "control-plane",
);

const COLLECTOR_CONFIG: string = fs.readFileSync(
  path.join(
    REPO_ROOT,
    "agents",
    "OpenStackAgent",
    "otel-collector-config.yaml",
  ),
  "utf8",
);

export const SCENE_REGION: string = "RegionOne";
export const SCENE_CLOUD: string = "recording";

export interface RecordedSeries {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export interface RecordedEndpoint {
  name: string;
  // How it answered, as curl said: 200, 000 for not at all.
  status: string;
  host: string;
  series: Array<RecordedSeries>;
}

export interface RecordedReading {
  at: number;
  endpoints: Array<RecordedEndpoint>;
}

export interface RecordedScene {
  name: string;
  readings: Array<RecordedReading>;
}

export interface StoredMetricRow {
  name: string;
  time: Date;
  value: number;
  attributes: JSONObject;
}

const SERIES_LINE: RegExp = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)/;
const LABEL: RegExp = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

export function parseExposition(text: string): Array<RecordedSeries> {
  const series: Array<RecordedSeries> = [];

  for (const line of text.split("\n")) {
    const match: RegExpMatchArray | null = line.match(SERIES_LINE);

    if (!match) {
      continue;
    }

    const labels: Record<string, string> = {};

    for (const label of (match[2] || "").matchAll(LABEL)) {
      labels[label[1]!] = label[2]!;
    }

    series.push({ name: match[1]!, labels, value: Number(match[3]) });
  }

  return series;
}

function readReading(folder: string): RecordedReading {
  const endpoints: Array<RecordedEndpoint> = [];
  const statusFile: string = path.join(folder, "status.txt");

  for (const line of fs.existsSync(statusFile)
    ? fs.readFileSync(statusFile, "utf8").split("\n")
    : []) {
    const [status, name, url] = line.split(" ");

    if (!status || !name) {
      continue;
    }

    const file: string = path.join(folder, `${name}.prom`);

    endpoints.push({
      name,
      status,
      host: new URL(url || "http://127.0.0.1").hostname,
      series: fs.existsSync(file)
        ? parseExposition(fs.readFileSync(file, "utf8"))
        : [],
    });
  }

  const at: string = path.join(folder, "at.txt");

  return {
    at: fs.existsSync(at) ? Number(fs.readFileSync(at, "utf8").trim()) : 0,
    endpoints,
  };
}

export function getClusterSceneNames(): Array<string> {
  return fs.readdirSync(path.join(FIXTURES, "clusters")).sort();
}

export function readClusterScene(name: string): RecordedScene {
  const folder: string = path.join(FIXTURES, "clusters", name);

  return {
    name,
    readings: ["first", "second"].map((reading: string): RecordedReading => {
      return readReading(path.join(folder, reading));
    }),
  };
}

export interface RecordedDrill {
  name: string;
  before: RecordedReading;
  // One a minute, while it was stopped.
  minutes: Array<RecordedReading>;
  // As soon as every worker read as up again.
  recovered: RecordedReading;
}

export function getCloudDrillNames(release: string): Array<string> {
  return fs
    .readdirSync(path.join(FIXTURES, `cloud-${release}`))
    .filter((name: string): boolean => {
      return name !== "healthy";
    })
    .sort();
}

export function readCloudDrill(release: string, name: string): RecordedDrill {
  const folder: string = path.join(FIXTURES, `cloud-${release}`, name);

  return {
    name,
    before: readReading(path.join(folder, "before")),
    minutes: fs
      .readdirSync(folder)
      .filter((reading: string): boolean => {
        return reading.startsWith("minute-");
      })
      .sort()
      .map((reading: string): RecordedReading => {
        return readReading(path.join(folder, reading));
      }),
    recovered: readReading(path.join(folder, "recovered")),
  };
}

const EXPORTER_ENDPOINT: string = "single-cloud";

// The word the agent's job stamps on each endpoint's series.
export function getDependencyOfEndpoint(endpoint: string): string {
  if (endpoint.endsWith("-detailed")) {
    return OPENSTACK_RABBITMQ_QUEUE_DEPENDENCY_LABEL_VALUE;
  }
  if (endpoint.startsWith("rabbitmq")) {
    return OpenStackDependency.RabbitMq;
  }
  if (endpoint.startsWith("mysqld")) {
    return OpenStackDependency.MariaDb;
  }
  if (endpoint.startsWith("memcached")) {
    return OpenStackDependency.Memcached;
  }
  if (endpoint.startsWith("haproxy")) {
    return OpenStackDependency.HaProxy;
  }
  if (endpoint.startsWith("ovn") || endpoint === "network") {
    return OpenStackDependency.Network;
  }
  if (endpoint === "libvirt") {
    return OpenStackDependency.Libvirt;
  }
  throw new Error(`No job reads an endpoint called ${endpoint}`);
}

// The counters the collector also sends as how much each grew: its own statements.
export function getCollectorIncreases(): Map<string, string> {
  const increases: Map<string, string> = new Map();

  for (const match of COLLECTOR_CONFIG.matchAll(
    /set\(name, "(\w+_increase)"\) where name == "(\w+)"/g,
  )) {
    increases.set(match[2]!, match[1]!);
  }

  return increases;
}

function attributesOf(
  endpoint: RecordedEndpoint,
  labels: Record<string, string>,
  region: string,
): JSONObject {
  return {
    ...labels,
    // openstack-exporter's own series are about the cloud, and no job stamps them.
    ...(endpoint.name === EXPORTER_ENDPOINT
      ? {}
      : {
          [OPENSTACK_DEPENDENCY_LABEL]: getDependencyOfEndpoint(endpoint.name),
          [OPENSTACK_EXPORTER_HOST_LABEL]: endpoint.host,
        }),
    [OPENSTACK_REGION_ATTRIBUTE]: region,
    [OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE]: SCENE_CLOUD,
  };
}

function seriesKey(endpoint: string, series: RecordedSeries): string {
  return `${endpoint}|${series.name}|${JSON.stringify(series.labels)}`;
}

/*
 * How much each counter grew in a minute, from a scene's two readings, by the key of the series
 * in its first. A counter that went backwards was reset, and says nothing: the collector's
 * cumulative_to_delta drops it too.
 */
function minuteIncreases(scene: RecordedScene): Map<string, number> {
  const [first, second] = scene.readings;
  const increases: Map<string, number> = new Map();
  const counters: Map<string, string> = getCollectorIncreases();
  const seconds: number = (second?.at || 0) - (first?.at || 0);

  if (!first || !second || seconds <= 0) {
    return increases;
  }

  for (const endpoint of first.endpoints) {
    const later: RecordedEndpoint | undefined = second.endpoints.find(
      (candidate: RecordedEndpoint): boolean => {
        return candidate.name === endpoint.name;
      },
    );

    for (const series of endpoint.series) {
      if (!counters.has(series.name)) {
        continue;
      }

      const laterSeries: RecordedSeries | undefined = later?.series.find(
        (candidate: RecordedSeries): boolean => {
          return (
            seriesKey(endpoint.name, candidate) ===
            seriesKey(endpoint.name, series)
          );
        },
      );

      if (laterSeries && laterSeries.value >= series.value) {
        increases.set(
          seriesKey(endpoint.name, series),
          ((laterSeries.value - series.value) / seconds) * 60,
        );
      }
    }
  }

  return increases;
}

// One collection of one reading: what the collector sends for it, stamped with its time.
export function rowsOfReading(data: {
  scene: RecordedScene;
  reading: RecordedReading;
  time: Date;
  region?: string | undefined;
}): Array<StoredMetricRow> {
  const region: string = data.region || SCENE_REGION;
  const rows: Array<StoredMetricRow> = [];
  const counters: Map<string, string> = getCollectorIncreases();
  const increases: Map<string, number> = minuteIncreases(data.scene);

  for (const endpoint of data.reading.endpoints) {
    rows.push({
      name: "up",
      time: data.time,
      value: endpoint.status === "200" ? 1 : 0,
      attributes: attributesOf(endpoint, {}, region),
    });

    for (const series of endpoint.series) {
      rows.push({
        name: series.name,
        time: data.time,
        value: series.value,
        attributes: attributesOf(endpoint, series.labels, region),
      });

      const increase: number | undefined = increases.get(
        seriesKey(endpoint.name, series),
      );

      if (increase !== undefined) {
        rows.push({
          name: counters.get(series.name)!,
          time: data.time,
          value: increase,
          attributes: attributesOf(endpoint, series.labels, region),
        });
      }
    }
  }

  return rows;
}

/*
 * A scene held for some minutes, one collection a minute, ending at `untilMs`. Half way through
 * each minute, so a minute's bucket holds exactly one, as a 60-second scrape's does.
 */
export function holdScene(data: {
  scene: RecordedScene;
  fromMs: number;
  minutes: number;
  region?: string | undefined;
}): Array<StoredMetricRow> {
  const rows: Array<StoredMetricRow> = [];

  for (let minute: number = 0; minute < data.minutes; minute++) {
    rows.push(
      ...rowsOfReading({
        scene: data.scene,
        reading: data.scene.readings[minute % data.scene.readings.length]!,
        time: new Date(data.fromMs + minute * 60000 + 30000),
        region: data.region,
      }),
    );
  }

  return rows;
}

function toAttributes(attributes: JSONObject): JSONArray {
  return Object.entries(attributes).map(
    ([key, value]: [string, unknown]): JSONObject => {
      return { key, value: { stringValue: String(value) } };
    },
  );
}

/*
 * What the cloud's inventory holds after reading these, through the real scan, in order. Each row
 * was last seen when its own series last arrived.
 */
export function foldIntoInventory(
  rows: Array<StoredMetricRow>,
): Array<OpenStackResource> {
  const entries: Map<string, OpenStackControlPlaneEntry> = new Map();
  const lastSeen: Map<string, Date> = new Map();

  for (const row of rows) {
    foldOpenStackControlPlaneDatapoint({
      metricName: row.name,
      attributes: toAttributes(row.attributes),
      value: row.value,
      observedAt: row.time,
      region: row.attributes[OPENSTACK_REGION_ATTRIBUTE] as string,
      entryFor: (externalId: string): OpenStackControlPlaneEntry => {
        let entry: OpenStackControlPlaneEntry | undefined =
          entries.get(externalId);

        if (!entry) {
          entry = {
            name: null,
            regionName: null,
            status: null,
            statusObservedAt: null,
            facts: {},
          };
          entries.set(externalId, entry);
        }

        lastSeen.set(externalId, row.time);

        return entry;
      },
    });
  }

  return Array.from(entries.entries()).map(
    ([externalId, entry]: [
      string,
      OpenStackControlPlaneEntry,
    ]): OpenStackResource => {
      const resource: OpenStackResource = new OpenStackResource();
      resource.kind = OpenStackResourceKind.ControlPlane;
      resource.externalId = externalId;
      resource.name = entry.name as string;
      resource.regionName = entry.regionName as string;
      resource.status = entry.status as string;
      resource.facts = entry.facts;
      resource.lastSeenAt = lastSeen.get(externalId) as Date;
      return resource;
    },
  );
}
