import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import CriteriaInEffect from "Common/Server/Utils/Monitor/CriteriaInEffect";
import {
  RecordedDrill,
  RecordedReading,
  RecordedScene,
  SCENE_CLOUD,
  SCENE_REGION,
  StoredMetricRow,
  foldIntoInventory,
  getClusterSceneNames,
  holdScene,
  readCloudDrill,
  readClusterScene,
  rowsOfReading,
} from "Common/Tests/Types/Monitor/Utils/OpenStackControlPlaneScenes";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { OPENSTACK_REGION_ATTRIBUTE } from "Common/Types/Monitor/MonitorStepOpenStackMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import { getAllOpenStackControlPlaneAlertTemplates } from "Common/Types/Monitor/OpenStackControlPlaneAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import { OPENSTACK_EXPORTER_HOST_LABEL } from "Common/Types/OpenStack/OpenStackControlPlane";
import ProbeApiIngestResponse, {
  MatchedCriteriaResult,
  PerSeriesCriteriaMatch,
} from "Common/Types/Probe/ProbeApiIngestResponse";

/*
 * EVERY SCENE, THROUGH EVERY TEMPLATE, THROUGH THE REAL READ AND THE REAL EVALUATOR.
 *
 * Noise is a bug, so this is a table with no gaps: for each template, the scenes it fires on and
 * which part it names. It must stay quiet on every other scene, and read as recovered on the scene
 * its trouble ended on.
 *
 * A scene is what real clusters said (OpenStackControlPlaneScenes), held for a template's whole
 * window, because a recording of a moment cannot say how long it lasted. It goes through
 * monitorOpenStack, the worker's own read, with ClickHouse stood in for by SqlGroupedFold, and
 * MonitorCriteriaEvaluator. What happens after that, incidents and their dependencies, is
 * OpenStackControlPlaneOneIncident.test.ts.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/OpenStackCloudService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});
jest.mock("Common/Server/Services/OpenStackResourceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import OpenStackResourceService from "Common/Server/Services/OpenStackResourceService";
import { monitorOpenStack } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { FoldedReadArgs, foldRowsAsSqlRead } from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const cloudFindOneBy: jest.Mock =
  OpenStackCloudService.findOneBy as unknown as jest.Mock;
const inventoryFindBy: jest.Mock =
  OpenStackResourceService.findBy as unknown as jest.Mock;

const END_MS: number = Date.UTC(2026, 10, 4, 12, 0, 0);
const HELD_MINUTES: number = 16;

const TEMPLATES: Array<OpenStackAlertTemplate> =
  getAllOpenStackControlPlaneAlertTemplates();

interface MetricReadQuery {
  query: {
    name: string;
    attributes?: JSONObject;
    time?: { startValue: Date; endValue: Date };
  };
}

function isRowInQuery(row: StoredMetricRow, args: MetricReadQuery): boolean {
  if (row.name !== args.query.name) {
    return false;
  }

  const window: { startValue: Date; endValue: Date } | undefined =
    args.query.time;

  if (
    window &&
    (row.time.getTime() < new Date(window.startValue).getTime() ||
      row.time.getTime() > new Date(window.endValue).getTime())
  ) {
    return false;
  }

  for (const [key, value] of Object.entries(args.query.attributes || {})) {
    if (row.attributes[key] !== value) {
      return false;
    }
  }

  return true;
}

function serveRows(rows: Array<StoredMetricRow>): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    return foldRowsAsSqlRead(
      rows.filter((row: StoredMetricRow): boolean => {
        return isRowInQuery(row, args as MetricReadQuery);
      }),
      args as FoldedReadArgs,
    );
  });
  metricFindBy.mockImplementation(async (args: unknown) => {
    return rows.filter((row: StoredMetricRow): boolean => {
      return isRowInQuery(row, args as MetricReadQuery);
    });
  });
  // What the scan made of the same rows, as the cloud's inventory holds it.
  inventoryFindBy.mockImplementation(async () => {
    return foldIntoInventory(rows);
  });
}

function stepOf(template: OpenStackAlertTemplate): MonitorStep {
  return template.getMonitorStep({
    cloudIdentifier: SCENE_CLOUD,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Recording",
  });
}

const WHOLE_MONITOR: string = "the whole monitor";

interface Verdict {
  // What the firing criteria names, one word for each series.
  firing: Array<string>;
  recovered: boolean;
}

// The part a series is about, in as few words as a table can hold.
function partOf(labels: JSONObject): string {
  const words: Array<string> = [];

  for (const key of [
    OPENSTACK_EXPORTER_HOST_LABEL,
    "queue",
    "proxy",
    "database",
    "service",
  ]) {
    const value: unknown = labels[key];

    if (typeof value === "string" && value) {
      words.push(value);
    }
  }

  return words.length > 0
    ? words.join("/")
    : String(labels[OPENSTACK_REGION_ATTRIBUTE]);
}

async function evaluate(data: {
  template: OpenStackAlertTemplate;
  rows: Array<StoredMetricRow>;
}): Promise<Verdict> {
  const step: MonitorStep = stepOf(data.template);

  serveRows(data.rows);

  const monitorId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();

  const read: MetricMonitorResponse = await monitorOpenStack({
    monitorStep: step,
    monitorId,
    projectId,
    evaluateUntil: new Date(END_MS),
  });

  const monitor: Monitor = new Monitor();
  monitor.id = monitorId;
  monitor.projectId = projectId;
  monitor.monitorType = MonitorType.OpenStack;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: read,
      monitorStep: step,
      monitor,
      probeApiIngestResponse: { monitorId, rootCause: null },
      evaluationSummary: {
        evaluatedAt: new Date(END_MS),
        criteriaResults: [],
        events: [],
      } as MonitorEvaluationSummary,
      criteriaInEffect: {
        isInEffect: (): Promise<boolean> => {
          return Promise.resolve(false);
        },
      } as unknown as CriteriaInEffect,
    });

  const [firing, recovery] = step.data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray as [
    MonitorCriteriaInstance,
    MonitorCriteriaInstance,
  ];

  const firingParts: Array<string> = (response.matchedCriteria || [])
    .filter((matched: MatchedCriteriaResult): boolean => {
      return matched.criteriaId === firing.data!.id?.toString();
    })
    .flatMap(
      (matched: MatchedCriteriaResult): Array<PerSeriesCriteriaMatch> => {
        return matched.perSeriesMatches;
      },
    )
    .map((match: PerSeriesCriteriaMatch): string => {
      return partOf(match.labels);
    })
    .sort();

  return {
    // One with no series fires for the whole monitor, as Cloud Stopped Reporting does.
    firing:
      firingParts.length === 0 &&
      response.criteriaMetId?.toString() === firing.data!.id?.toString()
        ? [WHOLE_MONITOR]
        : firingParts,
    recovered:
      response.criteriaMetId?.toString() === recovery.data!.id?.toString(),
  };
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] } as never);
  metricFindBy.mockReset().mockResolvedValue([] as never);
  (MetricTypeService.findBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue([] as never);
  cloudFindOneBy
    .mockReset()
    .mockResolvedValue({ id: ObjectID.generate() } as never);
  inventoryFindBy.mockReset().mockResolvedValue([] as never);
});

// A drill as a timeline: what came before, each minute it lasted, and what came after.
function rowsOfDrill(data: {
  drill: RecordedDrill;
  endOfOutageMs: number;
  heldMinutes: number;
  minutesAfter: number;
}): Array<StoredMetricRow> {
  const { drill } = data;
  const readings: Array<{ minute: number; reading: RecordedReading }> = [];
  const outage: number = Math.max(drill.minutes.length, data.heldMinutes);

  for (let minute: number = -HELD_MINUTES; minute < 0; minute++) {
    readings.push({ minute, reading: drill.before });
  }
  for (let minute: number = 0; minute < outage; minute++) {
    readings.push({
      minute,
      reading: drill.minutes[Math.min(minute, drill.minutes.length - 1)]!,
    });
  }
  for (let minute: number = 0; minute < data.minutesAfter; minute++) {
    readings.push({ minute: outage + minute, reading: drill.recovered });
  }

  return readings.flatMap(
    (
      one: { minute: number; reading: RecordedReading },
      index: number,
    ): Array<StoredMetricRow> => {
      return rowsOfReading({
        scene: {
          name: drill.name,
          readings: [readings[Math.max(index - 1, 0)]!.reading, one.reading],
        },
        reading: one.reading,
        time: new Date(
          data.endOfOutageMs + (one.minute - outage) * 60000 + 30000,
        ),
      });
    },
  );
}

/*
 * Where each template fires, and on what: everything not here must stay quiet. A template that
 * reads gone series as trouble goes through the drills further down, because only they have a
 * machine that had what went.
 */
const FIRES_ON: Readonly<
  Record<string, Readonly<Record<string, Array<string>>>>
> = {
  "openstack-rabbitmq-down": { "rabbitmq-cluster-down": ["RegionOne"] },
  "openstack-rabbitmq-node-down": {
    // Waits for RabbitMQ Down, which says so first: OpenStackControlPlaneOneIncident.
    "rabbitmq-cluster-down": ["127.0.1.1", "127.0.1.2", "127.0.1.3"],
    "rabbitmq-node-down": ["127.0.1.3"],
  },
  "openstack-rabbitmq-partition-detected": {
    "rabbitmq-partition": ["RegionOne"],
  },
  "openstack-rabbitmq-memory-alarm": {
    "rabbitmq-memory-alarm": ["127.0.1.2"],
  },
  "openstack-rabbitmq-disk-alarm": { "rabbitmq-disk-alarm": ["127.0.1.3"] },
  "openstack-rabbitmq-file-descriptors-high": {
    "rabbitmq-file-descriptors-high": ["127.0.1.1"],
  },
  "openstack-rabbitmq-messages-unacknowledged": {
    "rabbitmq-messages-unacknowledged": ["127.0.1.1"],
  },
  "openstack-rabbitmq-queue-without-consumers": {
    "rabbitmq-queue-without-consumers": ["ou-unconsumed"],
  },
  "openstack-mariadb-cluster-down": {
    "mariadb-cluster-down": ["RegionOne"],
    "mariadb-quorum-lost": ["RegionOne"],
    "mariadb-without-galera-down": ["RegionOne"],
  },
  "openstack-galera-cluster-size-dropped": {
    "mariadb-node-down": ["RegionOne"],
  },
  "openstack-galera-node-not-ready": {
    "mariadb-node-cut-off": ["127.0.1.3"],
    // Waits for MariaDB Cluster Down.
    "mariadb-quorum-lost": ["127.0.1.1"],
  },
  // On purpose (mariadb-node-desynced), it stays quiet: a backup is planned work.
  "openstack-galera-node-out-of-sync": {
    "mariadb-node-out-of-sync": ["127.0.1.1"],
  },
  "openstack-mariadb-too-many-connections": {
    "mariadb-too-many-connections": ["127.0.1.1"],
  },
  "openstack-mariadb-slow-queries": {
    "mariadb-slow-queries": ["127.0.1.2"],
  },
  "openstack-memcached-cluster-down": {
    "memcached-cluster-down": ["RegionOne"],
  },
  "openstack-memcached-no-connections": {
    "memcached-no-clients": ["RegionOne"],
  },
  "openstack-memcached-evictions-high": {
    "memcached-evictions-high": ["127.0.1.2"],
  },
  "openstack-haproxy-down": { "haproxy-down": ["RegionOne"] },
  "openstack-haproxy-backend-down": {
    "haproxy-backend-down": ["nova_api_back"],
  },
  "openstack-haproxy-server-down": {
    "haproxy-server-down": ["nova_api_back"],
  },
  "openstack-haproxy-api-5xx-rate-high": {
    "haproxy-api-5xx": ["nova_api_back"],
  },
  "openstack-haproxy-api-4xx-rate-high": {
    "haproxy-api-401": ["nova_api_back"],
  },
  "openstack-ovn-database-without-leader": {
    "ovn-no-leader": ["OVN_Southbound"],
  },
  "openstack-ovn-northd-not-active": {
    "ovn-every-member-down": ["RegionOne"],
    // Waits for the database without a leader.
    "ovn-no-leader": ["RegionOne"],
  },
};

// The scene each one's trouble ended on, where it must read as recovered and not merely quiet.
const RECOVERS_ON: Readonly<Record<string, string>> = {
  "openstack-rabbitmq-down": "rabbitmq-recovered-from-cluster-down",
  "openstack-rabbitmq-node-down": "rabbitmq-recovered",
  "openstack-rabbitmq-partition-detected": "rabbitmq-recovered",
  "openstack-rabbitmq-memory-alarm": "rabbitmq-recovered-from-alarms",
  "openstack-rabbitmq-disk-alarm": "rabbitmq-recovered-from-alarms",
  "openstack-rabbitmq-file-descriptors-high":
    "rabbitmq-recovered-from-file-descriptors",
  "openstack-rabbitmq-messages-unacknowledged":
    "rabbitmq-recovered-from-file-descriptors",
  "openstack-rabbitmq-queue-without-consumers":
    "rabbitmq-recovered-from-queue-without-consumers",
  "openstack-mariadb-cluster-down": "mariadb-recovered-from-cluster-down",
  "openstack-galera-cluster-size-dropped": "mariadb-recovered",
  "openstack-galera-node-not-ready": "mariadb-recovered",
  "openstack-galera-node-out-of-sync": "mariadb-recovered",
  "openstack-mariadb-too-many-connections": "mariadb-recovered",
  "openstack-mariadb-slow-queries": "mariadb-recovered",
  "openstack-memcached-cluster-down": "memcached-recovered",
  "openstack-memcached-no-connections": "memcached-with-clients",
  "openstack-memcached-evictions-high": "memcached-recovered",
  "openstack-haproxy-down": "haproxy-recovered-from-down",
  "openstack-haproxy-backend-down": "haproxy-recovered",
  "openstack-haproxy-server-down": "haproxy-recovered",
  "openstack-haproxy-api-5xx-rate-high": "haproxy-recovered-from-errors",
  "openstack-haproxy-api-4xx-rate-high": "haproxy-recovered-from-errors",
  "openstack-ovn-database-without-leader": "ovn-recovered",
  "openstack-ovn-northd-not-active": "ovn-recovered-from-every-member-down",
};

/*
 * What a real DevStack read while one thing was stopped on it, past the drill's last minute (the
 * top of this file says so), and after it came back: every template of the cloud's, the services'
 * own included. OpenStackControlPlaneOneIncident holds what those add up to.
 */
const DRILLS: ReadonlyArray<{
  release: string;
  drill: string;
  during: Record<string, Array<string>>;
  after: Record<string, Array<string>>;
}> = [
  {
    release: "gazpacho-ovn",
    drill: "rabbitmq-down",
    during: {
      "openstack-rabbitmq-down": ["RegionOne"],
      "openstack-rabbitmq-node-down": ["127.0.0.1"],
      "openstack-compute-service-down": ["nova-compute"],
    },
    after: {},
  },
  {
    release: "gazpacho-ovs",
    drill: "rabbitmq-down",
    during: {
      "openstack-rabbitmq-down": ["RegionOne"],
      "openstack-rabbitmq-node-down": ["127.0.0.1"],
      "openstack-compute-service-down": ["nova-compute"],
      "openstack-network-agent-down": [
        "neutron-dhcp-agent",
        "neutron-l3-agent",
        "neutron-metadata-agent",
        "neutron-openvswitch-agent",
      ],
    },
    after: {},
  },
  {
    release: "gazpacho-ovn",
    drill: "mariadb-down",
    during: {
      "openstack-mariadb-cluster-down": ["RegionOne"],
      // The exporter logs in to read anything: this waits for what is above it.
      "openstack-cloud-stopped-reporting": [WHOLE_MONITOR],
    },
    after: {},
  },
  {
    release: "gazpacho-ovs",
    drill: "mariadb-down",
    during: {
      "openstack-mariadb-cluster-down": ["RegionOne"],
      // The exporter logs in to read anything: this waits for what is above it.
      "openstack-cloud-stopped-reporting": [WHOLE_MONITOR],
    },
    after: {},
  },
  {
    release: "gazpacho-ovn",
    drill: "memcached-down",
    during: { "openstack-memcached-cluster-down": ["RegionOne"] },
    after: {},
  },
  {
    release: "gazpacho-ovn",
    drill: "ovn-controller-down",
    during: {
      "openstack-ovn-controller-not-running": ["127.0.0.1"],
      "openstack-network-agent-down": ["neutron-ovn-agent", "ovn-controller"],
    },
    after: {},
  },
  {
    release: "gazpacho-ovn",
    drill: "ovs-down",
    during: {
      "openstack-ovs-service-down": ["127.0.0.1"],
      "openstack-network-agent-down": ["neutron-ovn-agent", "ovn-controller"],
    },
    // The exporter does not reconnect to Open vSwitch's database, and this says so.
    after: { "openstack-ovs-database-not-read": ["127.0.0.1"] },
  },
  {
    release: "gazpacho-ovs",
    drill: "ovs-down",
    during: {
      "openstack-ovs-service-down": ["127.0.0.1"],
      "openstack-network-agent-down": ["neutron-openvswitch-agent"],
    },
    after: { "openstack-ovs-database-not-read": ["127.0.0.1"] },
  },
  {
    release: "gazpacho-ovn",
    drill: "libvirt-down",
    during: { "openstack-libvirt-service-down": ["127.0.0.1"] },
    /*
     * The rig then mounted libvirt's socket and not its folder, so the exporter went on reading
     * the one the restart replaced. It mounts the folder now, as Kolla-Ansible does, so the next
     * recording reads this as nothing at all: no recording has yet proved this one recovers.
     */
    after: { "openstack-libvirt-service-down": ["127.0.0.1"] },
  },
];

describe("every scene of the recording, through every template", () => {
  const scenes: Array<RecordedScene> =
    getClusterSceneNames().map(readClusterScene);

  test("every template and every scene read as the table says", async () => {
    const differences: Array<string> = [];

    for (const template of TEMPLATES) {
      for (const scene of scenes) {
        const verdict: Verdict = await evaluate({
          template,
          rows: holdScene({
            scene,
            fromMs: END_MS - HELD_MINUTES * 60000,
            minutes: HELD_MINUTES,
          }),
        });
        const expected: Array<string> =
          FIRES_ON[template.id]?.[scene.name] || [];

        if (JSON.stringify(verdict.firing) !== JSON.stringify(expected)) {
          differences.push(
            `${template.id} on ${scene.name}: ${JSON.stringify(verdict.firing)} and not ${JSON.stringify(expected)}`,
          );
        }

        if (RECOVERS_ON[template.id] === scene.name && !verdict.recovered) {
          differences.push(
            `${template.id} does not read as recovered on ${scene.name}`,
          );
        }
      }
    }

    expect(differences).toEqual([]);
  }, 600000);

  test("every scene it fires on is one the recording has, and each has an ending", () => {
    const names: Array<string> = getClusterSceneNames();

    for (const [templateId, firesOn] of Object.entries(FIRES_ON)) {
      expect(names).toEqual(expect.arrayContaining(Object.keys(firesOn)));
      expect(names).toContain(RECOVERS_ON[templateId]);
    }
  });
});

describe("what a real cloud read with one thing stopped on it", () => {
  test.each(DRILLS)(
    "$release $drill",
    async (row: {
      release: string;
      drill: string;
      during: Record<string, Array<string>>;
      after: Record<string, Array<string>>;
    }) => {
      const drill: RecordedDrill = readCloudDrill(row.release, row.drill);
      const firing: (
        rows: Array<StoredMetricRow>,
      ) => Promise<Record<string, Array<string>>> = async (
        rows: Array<StoredMetricRow>,
      ) => {
        const fired: Record<string, Array<string>> = {};

        for (const template of getAllOpenStackAlertTemplates()) {
          const verdict: Verdict = await evaluate({ template, rows });

          if (verdict.firing.length > 0) {
            fired[template.id] = verdict.firing;
          }
        }

        return fired;
      };

      expect(
        await firing(
          rowsOfDrill({
            drill,
            endOfOutageMs: END_MS,
            heldMinutes: HELD_MINUTES,
            minutesAfter: 0,
          }),
        ),
      ).toEqual(row.during);

      expect(
        await firing(
          rowsOfDrill({
            drill,
            endOfOutageMs: END_MS - HELD_MINUTES * 60000,
            heldMinutes: HELD_MINUTES,
            minutesAfter: HELD_MINUTES,
          }),
        ),
      ).toEqual(row.after);
    },
    300000,
  );
});

describe("what no recording has: hand-made rows, and they say so", () => {
  // The one reading of a machine with everything fine on it, and the rows a change makes of it.
  function healthyRows(): Array<StoredMetricRow> {
    const drill: RecordedDrill = readCloudDrill(
      "gazpacho-ovn",
      "memcached-down",
    );

    return rowsOfDrill({
      drill,
      endOfOutageMs: END_MS,
      heldMinutes: 0,
      minutesAfter: 0,
    });
  }

  /*
   * A single-node DevStack has nobody to open a tunnel to, so Geneve's errors are as the exporter's
   * source and a two-machine lab say: ovs_interface_tx_errors{interface,type="geneve",...}.
   */
  function tunnelErrorRows(perMinute: number): Array<StoredMetricRow> {
    const rows: Array<StoredMetricRow> = [];

    for (let minute: number = 1; minute <= HELD_MINUTES; minute++) {
      rows.push(
        {
          name: "up",
          time: new Date(END_MS - minute * 60000 + 30000),
          value: 1,
          attributes: {
            openstack_dependency: "network",
            openstack_exporter_host: "10.0.0.5",
            [OPENSTACK_REGION_ATTRIBUTE]: SCENE_REGION,
            "resource.openstack.cloud.name": SCENE_CLOUD,
          },
        },
        {
          name: "ovs_interface_tx_errors_increase",
          time: new Date(END_MS - minute * 60000 + 30000),
          value: perMinute,
          attributes: {
            interface: "ovn-a1b2c3-0",
            type: "geneve",
            openstack_dependency: "network",
            openstack_exporter_host: "10.0.0.5",
            [OPENSTACK_REGION_ATTRIBUTE]: SCENE_REGION,
            "resource.openstack.cloud.name": SCENE_CLOUD,
          },
        },
      );
    }

    return rows;
  }

  function template(id: string): OpenStackAlertTemplate {
    return getAllOpenStackAlertTemplates().find(
      (candidate: OpenStackAlertTemplate): boolean => {
        return candidate.id === id;
      },
    )!;
  }

  test("Geneve Transmit Errors fires per machine and recovers at 0", async () => {
    expect(
      (
        await evaluate({
          template: template("openstack-geneve-transmit-errors"),
          rows: tunnelErrorRows(3),
        })
      ).firing,
    ).toEqual(["10.0.0.5"]);

    const quiet: Verdict = await evaluate({
      template: template("openstack-geneve-transmit-errors"),
      rows: tunnelErrorRows(0),
    });

    expect(quiet.firing).toEqual([]);
    expect(quiet.recovered).toBe(true);
  });

  test.each([
    ["openstack-network-exporter-target-down", "network"],
    ["openstack-libvirt-exporter-target-down", "libvirt"],
  ])(
    "%s reads its own job's up of 0, as a dead RabbitMQ's job recorded it",
    async (templateId: string, endpoint: string) => {
      const dead: Array<StoredMetricRow> = healthyRows().filter(
        (row: StoredMetricRow): boolean => {
          return (
            row.attributes["openstack_dependency"] !== endpoint ||
            row.name === "up"
          );
        },
      );

      for (const row of dead) {
        if (row.attributes["openstack_dependency"] === endpoint) {
          row.value = 0;
        }
      }

      expect(
        (await evaluate({ template: template(templateId), rows: dead })).firing,
      ).toEqual(["127.0.0.1"]);
      expect(
        (
          await evaluate({
            template: template(templateId),
            rows: healthyRows(),
          })
        ).firing,
      ).toEqual([]);
    },
  );
});
