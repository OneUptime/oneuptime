import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "Common/Models/DatabaseModels/Alert";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import ProjectService from "Common/Server/Services/ProjectService";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "Common/Server/Utils/Logger";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorMaintenanceSuppression from "Common/Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorMetricUtil from "Common/Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorResourceContextUtil from "Common/Server/Utils/Monitor/MonitorResourceContext";
import MonitorSummaryCapture from "Common/Server/Utils/Monitor/MonitorSummaryCapture";
import OpenStackAlertContext from "Common/Server/Utils/OpenStack/OpenStackAlertContext";
import SeriesResourceLinker from "Common/Server/Utils/Monitor/SeriesResourceLinker";
import { mockProjectStates } from "Common/Tests/Server/TestingUtils/Services/ProjectStatesHelper";
import {
  RecordedDrill,
  RecordedEndpoint,
  RecordedReading,
  SCENE_CLOUD,
  StoredMetricRow,
  foldIntoInventory,
  readCloudDrill,
  rowsOfReading,
} from "Common/Tests/Types/Monitor/Utils/OpenStackControlPlaneScenes";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  OpenStackAlertTemplate,
  getAllOpenStackAlertTemplates,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import { getOpenStackTemplateParents } from "Common/Types/Monitor/OpenStackControlPlaneAlertTemplates";
import ObjectID from "Common/Types/ObjectID";

/*
 * ONE FAILURE, ONE INCIDENT, THROUGH THE REAL THING AS FAR AS A TEST CAN GO.
 *
 * Every OpenStack template is a monitor, linked to its parents as OpenStackMonitorDependencies
 * links them. Each drill is what a real DevStack said while one thing was stopped on it, read
 * minute by minute (control-plane-cloud.sh). Each minute every monitor goes through the worker's
 * own read (monitorOpenStack), MonitorResourceUtil.monitorResource, the real criteria evaluator,
 * the real dependency suppression and the real incident creators and resolve pass. What is stood
 * in for is storage: ClickHouse by the folded rows, Postgres by the records below.
 *
 * WHERE THE PROOF STOPS. Storage is stood in for here. Tests/Ops/openstack-e2e/live-oneuptime.py
 * sends the same drills to a running OneUptime and reads the same answer back from its API (run
 * 41990785805). Neither has a cloud beside it. The drills lasted 3 to 5 minutes and a template's
 * window is 5 to 10, so a drill's last minute is held until 14 minutes in, which nobody recorded.
 * So is its one reading after recovery, and the exporter's series behind it (below) are held back
 * for LAG_MINUTES, because the agent collects those every 2 to 5 minutes while the recording read
 * them as they were. The series are what the exporters really said, and the single node of a
 * DevStack is one machine of everything.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});
// The criteria evaluator's sandbox reaches the native isolated-vm addon. Nothing here runs one.
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
// It fails to compile under ts-jest, and nothing about a password is under test.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return { __esModule: true, default: {} };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import OpenStackResourceService from "Common/Server/Services/OpenStackResourceService";
import { monitorOpenStack } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { FoldedReadArgs, foldRowsAsSqlRead } from "./SqlGroupedFold";

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const OUTAGE_START_MS: number = Date.UTC(2026, 10, 4, 12, 0, 0);
const MINUTES_BEFORE: number = 12;
const OUTAGE_MINUTES: number = 14;
const MINUTES_AFTER: number = 14;

// The agent reads compute and network every 2 minutes, and identity and image every 5.
const LAG_MINUTES: number = 5;
const EXPORTER_ENDPOINT: string = "single-cloud";

interface WorldMonitor {
  template: OpenStackAlertTemplate;
  step: MonitorStep;
  monitor: Monitor;
}

interface WorldRecord {
  model: Incident | Alert;
  monitor: WorldMonitor;
  title: string;
  description: string;
  labels: JSONObject;
  openedAtMinute: number;
  resolvedAtMinute: number | null;
  id: string;
}

interface EndedStatus {
  monitor: WorldMonitor;
  endsAt: Date;
}

let world: Array<WorldMonitor> = [];
let evaluating: WorldMonitor | null = null;
let incidents: Array<WorldRecord> = [];
let alerts: Array<WorldRecord> = [];
let endedOfflineStatuses: Array<EndedStatus> = [];
let timelineRows: Array<StoredMetricRow> = [];
let inventory: Array<OpenStackResource> = [];
let minuteNow: number = 0;

function monitorById(id: unknown): WorldMonitor | undefined {
  return world.find((one: WorldMonitor): boolean => {
    return one.monitor.id!.toString() === String(id);
  });
}

function isOffline(one: WorldMonitor): boolean {
  return one.monitor.currentMonitorStatusId!.toString() === OFFLINE.toString();
}

function parentsOf(one: WorldMonitor): Array<WorldMonitor> {
  return getOpenStackTemplateParents(one.template.id)
    .map((id: string): WorldMonitor | undefined => {
      return world.find((candidate: WorldMonitor): boolean => {
        return candidate.template.id === id;
      });
    })
    .filter((parent: WorldMonitor | undefined): parent is WorldMonitor => {
      return Boolean(parent);
    });
}

// Every OpenStack template as a monitor of one cloud, with nothing wrong yet.
function buildWorld(): void {
  world = getAllOpenStackAlertTemplates().map(
    (template: OpenStackAlertTemplate): WorldMonitor => {
      const monitor: Monitor = new Monitor();
      monitor.id = ObjectID.generate();
      monitor.projectId = PROJECT_ID;
      monitor.name = template.name;
      monitor.monitorType = MonitorType.OpenStack;
      monitor.currentMonitorStatusId = ONLINE;

      const step: MonitorStep = template.getMonitorStep({
        cloudIdentifier: SCENE_CLOUD,
        onlineMonitorStatusId: ONLINE,
        offlineMonitorStatusId: OFFLINE,
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: template.name,
      });

      const monitorSteps: MonitorSteps = new MonitorSteps();
      monitorSteps.data = {
        monitorStepsInstanceArray: [step],
        defaultMonitorStatusId: ONLINE,
      };
      monitor.monitorSteps = monitorSteps;

      return { template, step, monitor };
    },
  );

  for (const one of world) {
    one.monitor.dependsOnMonitors = parentsOf(one).map(
      (parent: WorldMonitor): Monitor => {
        return parent.monitor;
      },
    );
  }

  // Whatever waits for something goes first, so a good result is the windows' doing and no luck.
  world.sort((a: WorldMonitor, b: WorldMonitor): number => {
    return parentsOf(b).length - parentsOf(a).length;
  });
}

function isRowInQuery(row: StoredMetricRow, args: unknown): boolean {
  const query: {
    name: string;
    attributes?: JSONObject;
    time?: { startValue: Date; endValue: Date };
  } = (args as { query: never }).query;

  if (row.name !== query.name) {
    return false;
  }

  if (
    query.time &&
    (row.time.getTime() < new Date(query.time.startValue).getTime() ||
      row.time.getTime() > new Date(query.time.endValue).getTime())
  ) {
    return false;
  }

  for (const [key, value] of Object.entries(query.attributes || {})) {
    if (row.attributes[key] !== value) {
      return false;
    }
  }

  return true;
}

// One endpoint of a reading, with the exporter's taken from another: what lags, lags.
function withExporterOf(
  reading: RecordedReading,
  exporterFrom: RecordedReading,
): RecordedReading {
  const exporter: RecordedEndpoint | undefined = exporterFrom.endpoints.find(
    (endpoint: RecordedEndpoint): boolean => {
      return endpoint.name === EXPORTER_ENDPOINT;
    },
  );

  return {
    at: reading.at,
    endpoints: [
      ...reading.endpoints.filter((endpoint: RecordedEndpoint): boolean => {
        return endpoint.name !== EXPORTER_ENDPOINT;
      }),
      ...(exporter ? [exporter] : []),
    ],
  };
}

function readingAt(drill: RecordedDrill, minute: number): RecordedReading {
  if (minute < 0) {
    return drill.before;
  }

  const lastOfOutage: RecordedReading =
    drill.minutes[drill.minutes.length - 1]!;

  if (minute < OUTAGE_MINUTES) {
    return drill.minutes[minute] || lastOfOutage;
  }

  return minute < OUTAGE_MINUTES + LAG_MINUTES
    ? withExporterOf(drill.recovered, lastOfOutage)
    : drill.recovered;
}

function rowsOfTimeline(drill: RecordedDrill): Array<StoredMetricRow> {
  const rows: Array<StoredMetricRow> = [];

  for (
    let minute: number = -MINUTES_BEFORE;
    minute < OUTAGE_MINUTES + MINUTES_AFTER;
    minute++
  ) {
    const reading: RecordedReading = readingAt(drill, minute);

    rows.push(
      ...rowsOfReading({
        scene: {
          name: drill.name,
          readings: [readingAt(drill, minute - 1), reading],
        },
        reading,
        time: new Date(OUTAGE_START_MS + minute * 60000 + 30000),
      }),
    );
  }

  return rows;
}

function recordOf(data: {
  model: Incident | Alert;
  title: string | undefined;
  description: string | undefined;
}): WorldRecord {
  const record: WorldRecord = {
    model: data.model,
    monitor: evaluating!,
    title: data.title || "",
    description: data.description || "",
    labels: (data.model.seriesLabels as JSONObject | undefined) || {},
    openedAtMinute: minuteNow,
    resolvedAtMinute: null,
    id: ObjectID.generate().toString(),
  };

  data.model._id = record.id;

  return record;
}

// What a check reads as open for its monitor: what it opened, as it was opened.
function openRecords(
  records: Array<WorldRecord>,
  args: unknown,
): Promise<never> {
  // An incident has monitors, and an alert one monitor.
  const query: { monitors?: Array<unknown>; monitor?: unknown } = (
    args as { query: { monitors?: Array<unknown>; monitor?: unknown } }
  ).query;
  const ids: Array<string> = (query.monitors || [query.monitor]).map(String);

  return Promise.resolve(
    records
      .filter((record: WorldRecord): boolean => {
        return (
          record.resolvedAtMinute === null &&
          ids.includes(record.monitor.monitor.id!.toString())
        );
      })
      .map((record: WorldRecord): Incident | Alert => {
        return record.model;
      }),
  ) as never;
}

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true, doNotFake: ["performance"] });
  mockProjectStates();

  incidents = [];
  alerts = [];
  endedOfflineStatuses = [];

  (MetricService.aggregateBy as unknown as jest.Mock).mockImplementation(
    async (args: unknown) => {
      return foldRowsAsSqlRead(
        timelineRows.filter((row: StoredMetricRow): boolean => {
          return isRowInQuery(row, args);
        }),
        args as FoldedReadArgs,
      );
    },
  );
  (MetricService.findBy as unknown as jest.Mock).mockImplementation(
    async (args: unknown) => {
      return timelineRows.filter((row: StoredMetricRow): boolean => {
        return isRowInQuery(row, args);
      });
    },
  );
  (MetricTypeService.findBy as unknown as jest.Mock).mockResolvedValue(
    [] as never,
  );
  (OpenStackCloudService.findOneBy as unknown as jest.Mock).mockResolvedValue({
    id: ObjectID.generate(),
  } as never);
  (OpenStackResourceService.findBy as unknown as jest.Mock).mockImplementation(
    async () => {
      return inventory;
    },
  );

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true);
  jest
    .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
    .mockImplementation(async (input: unknown) => {
      return {
        usable: (input as { ids?: Array<ObjectID> }).ids || [],
        unusable: [],
      } as never;
    });
  jest
    .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
  jest
    .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
    .mockResolvedValue({
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    } as never);
  jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });

  // The world's monitors, and their parents as MonitorDependencySuppression reads them.
  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation((args: unknown) => {
      return Promise.resolve(
        monitorById((args as { id: ObjectID }).id)?.monitor || null,
      ) as never;
    });
  jest.spyOn(MonitorService, "findBy").mockImplementation(() => {
    return Promise.resolve(
      parentsOf(evaluating!).map((parent: WorldMonitor): Monitor => {
        const read: Monitor = new Monitor();
        read.id = parent.monitor.id!;
        read.name = parent.monitor.name!;
        read.currentMonitorStatus = {
          _id: parent.monitor.currentMonitorStatusId!.toString(),
          name: isOffline(parent) ? "Offline" : "Operational",
          isOfflineState: isOffline(parent),
        } as never;
        read.dependsOnMonitors = [];
        return read;
      }),
    ) as never;
  });

  // Status, as its timeline keeps it.
  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation(() => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorStatusId = evaluating!.monitor.currentMonitorStatusId!;
      return Promise.resolve(timeline) as never;
    });
  jest
    .spyOn(MonitorStatusTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const data: { monitorStatusId: ObjectID } = (
        createBy as { data: { monitorStatusId: ObjectID } }
      ).data;

      if (isOffline(evaluating!)) {
        endedOfflineStatuses.push({
          monitor: evaluating!,
          endsAt: new Date(),
        });
      }

      evaluating!.monitor.currentMonitorStatusId = data.monitorStatusId;
      return Promise.resolve(new MonitorStatusTimeline()) as never;
    });
  // What OpenStackDependencySuppression reads to hold a child while its parent settles.
  jest.spyOn(MonitorStatusTimelineService, "findBy").mockImplementation(() => {
    const parents: Array<WorldMonitor> = parentsOf(evaluating!);

    return Promise.resolve(
      endedOfflineStatuses
        .filter((ended: EndedStatus): boolean => {
          return (
            parents.includes(ended.monitor) &&
            Date.now() - ended.endsAt.getTime() <= 10 * 60000
          );
        })
        .map((ended: EndedStatus): MonitorStatusTimeline => {
          const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
          timeline.monitorId = ended.monitor.monitor.id!;
          timeline.monitor = ended.monitor.monitor;
          timeline.monitorStatus = {
            name: "Offline",
            isOfflineState: true,
          } as never;
          return timeline;
        }),
    ) as never;
  });

  // Records: what earlier checks opened, and closing takes one off the open ones.
  jest.spyOn(IncidentService, "findBy").mockImplementation((args: unknown) => {
    return openRecords(incidents, args);
  });
  jest.spyOn(AlertService, "findBy").mockImplementation((args: unknown) => {
    return openRecords(alerts, args);
  });
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Incident> => {
      const incident: Incident = (createBy as { data: Incident }).data;
      incidents.push(
        recordOf({
          model: incident,
          title: incident.title,
          description: incident.description,
        }),
      );
      return incident;
    });
  jest
    .spyOn(AlertService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Alert> => {
      const alert: Alert = (createBy as { data: Alert }).data;
      alerts.push(
        recordOf({
          model: alert,
          title: alert.title,
          description: alert.description,
        }),
      );
      return alert;
    });
  jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
  jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(RESOLVED_STATE_ID);
  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(RESOLVED_STATE_ID);
  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const id: string = String(
        (createBy as { data: { incidentId: ObjectID } }).data.incidentId,
      );
      for (const record of incidents) {
        if (record.id === id) {
          record.resolvedAtMinute = minuteNow;
        }
      }
      return Promise.resolve(undefined) as never;
    });
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const id: string = String(
        (createBy as { data: { alertId: ObjectID } }).data.alertId,
      );
      for (const record of alerts) {
        if (record.id === id) {
          record.resolvedAtMinute = minuteNow;
        }
      }
      return Promise.resolve(undefined) as never;
    });

  // What the incident's links would be, and what the alert context adds: their own tests.
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
  jest
    .spyOn(SeriesResourceLinker, "linkSeriesResourcesToModel")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OpenStackAlertContext, "addToDescription")
    .mockImplementation(async (input: unknown) => {
      return (input as { description?: string }).description as never;
    });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function runDrill(
  release: string,
  name: string,
  untilMinute: number = OUTAGE_MINUTES + MINUTES_AFTER,
  options: { linked: boolean } = { linked: true },
): Promise<void> {
  const drill: RecordedDrill = readCloudDrill(release, name);

  buildWorld();
  timelineRows = rowsOfTimeline(drill);

  if (!options.linked) {
    for (const one of world) {
      one.monitor.dependsOnMonitors = [];
    }
  }

  for (minuteNow = 0; minuteNow <= untilMinute; minuteNow++) {
    const now: Date = new Date(OUTAGE_START_MS + minuteNow * 60000 + 5000);

    jest.setSystemTime(now);

    inventory = foldIntoInventory(
      timelineRows.filter((row: StoredMetricRow): boolean => {
        return row.time.getTime() <= now.getTime();
      }),
    );

    for (const one of world) {
      evaluating = one;

      const read: MetricMonitorResponse = await monitorOpenStack({
        monitorStep: one.step,
        monitorId: one.monitor.id!,
        projectId: PROJECT_ID,
        evaluateUntil: now,
      });

      await MonitorResourceUtil.monitorResource(read);
    }
  }
}

// What opened, in the order it opened, and when it closed, in the fewest words.
function summaryOf(records: Array<WorldRecord>): Array<string> {
  return records.map((record: WorldRecord): string => {
    return `${record.monitor.template.id} opened ${record.openedAtMinute}, ${
      record.resolvedAtMinute === null
        ? "still open"
        : `resolved ${record.resolvedAtMinute}`
    }`;
  });
}

function incidentOf(templateId: string): WorldRecord {
  return incidents.find((record: WorldRecord): boolean => {
    return record.monitor.template.id === templateId;
  })!;
}

function monitorOf(templateId: string): WorldMonitor {
  return world.find((one: WorldMonitor): boolean => {
    return one.template.id === templateId;
  })!;
}

/*
 * The outage ends at OUTAGE_MINUTES (14). Everything fires at minute 5, because that is what its
 * window reads, and resolves at the first good collection.
 */
describe("one failure opens one incident", () => {
  test.each([
    ["gazpacho-ovn", "OVN"],
    ["gazpacho-ovs", "ML2/OVS"],
  ])(
    "a stopped RabbitMQ on %s (%s) opens one incident, names what it takes down, and resolves on its own",
    async (release: string) => {
      await runDrill(release, "rabbitmq-down");

      expect(summaryOf(incidents)).toEqual([
        "openstack-rabbitmq-down opened 5, resolved 15",
      ]);
      expect(summaryOf(alerts)).toEqual([
        "openstack-rabbitmq-down opened 5, resolved 15",
      ]);

      const { title, description, labels } = incidentOf(
        "openstack-rabbitmq-down",
      );

      expect(title).toContain("[OpenStack] RabbitMQ Down");
      expect(description).toContain("nova-compute stops reporting");
      expect(description).toContain("Instances that are already running");
      expect(description).toContain("resolves on its own");
      expect(labels["openstack.region.name"]).toBe("RegionOne");
    },
    120000,
  );

  test("the workers it took down read as down on their own pages, and open nothing", async () => {
    await runDrill("gazpacho-ovs", "rabbitmq-down", OUTAGE_MINUTES - 1);

    for (const templateId of [
      "openstack-rabbitmq-down",
      "openstack-compute-service-down",
      "openstack-network-agent-down",
      "openstack-rabbitmq-node-down",
    ]) {
      expect({
        templateId,
        isOffline: isOffline(monitorOf(templateId)),
      }).toEqual({ templateId, isOffline: true });
    }

    expect(summaryOf(incidents)).toEqual([
      "openstack-rabbitmq-down opened 5, still open",
    ]);
  }, 120000);

  test("a stopped MariaDB opens one incident, names what it takes down, and resolves on its own", async () => {
    await runDrill("gazpacho-ovn", "mariadb-down");

    expect(summaryOf(incidents)).toEqual([
      "openstack-mariadb-cluster-down opened 5, resolved 15",
    ]);

    const { title, description } = incidentOf("openstack-mariadb-cluster-down");

    expect(title).toContain("[OpenStack] MariaDB Cluster Down");
    expect(description).toContain("Every API keeps its state in MariaDB");
    expect(description).toContain("resolves on its own");
  }, 120000);

  test("a stopped ovn-controller opens one incident, names what it takes down, and resolves on its own", async () => {
    await runDrill("gazpacho-ovn", "ovn-controller-down");

    expect(summaryOf(incidents)).toEqual([
      "openstack-ovn-controller-not-running opened 5, resolved 15",
    ]);

    const { title, description, labels } = incidentOf(
      "openstack-ovn-controller-not-running",
    );

    expect(title).toContain("[OpenStack] OVN Controller Not Running");
    expect(description).toContain("new ports do not come up");
    expect(description).toContain("neutron-ovn-agent");
    expect(description).toContain("resolves on its own");
    expect(labels["openstack_exporter_host"]).toBe("127.0.0.1");
  }, 120000);

  test.each(["gazpacho-ovn", "gazpacho-ovs"])(
    "a stopped Open vSwitch on %s is one incident, and then says the exporter needs restarting",
    async (release: string) => {
      await runDrill(release, "ovs-down");

      expect(summaryOf(incidents)).toEqual([
        "openstack-ovs-service-down opened 5, resolved 15",
        // Ten minutes of Open vSwitch answering and its database unread, and it is still so.
        "openstack-ovs-database-not-read opened 23, still open",
      ]);
    },
    120000,
  );

  test("a stopped Memcached is one incident", async () => {
    await runDrill("gazpacho-ovn", "memcached-down");

    expect(summaryOf(incidents)).toEqual([
      "openstack-memcached-cluster-down opened 5, resolved 15",
    ]);
  }, 120000);

  /*
   * This recording's libvirt_up stayed 0 after the restart, because the rig mounted libvirt's
   * socket file and a restart makes a new one. It mounts the folder now, as Kolla-Ansible does, so
   * the next recording should resolve. No recording has proved that yet.
   */
  test("a stopped libvirt is one incident: nova-compute disables itself, so nothing else fires", async () => {
    await runDrill("gazpacho-ovn", "libvirt-down");

    expect(summaryOf(incidents)).toEqual([
      "openstack-libvirt-service-down opened 5, still open",
    ]);
  }, 120000);

  test("with nothing linked, a stopped RabbitMQ opens what each thing reads, which is what the links are for", async () => {
    await runDrill(
      "gazpacho-ovs",
      "rabbitmq-down",
      OUTAGE_MINUTES + MINUTES_AFTER,
      {
        linked: false,
      },
    );

    expect(summaryOf(incidents).sort()).toEqual([
      // Each worker goes on reading down until the agent next reads it: LAG_MINUTES.
      "openstack-compute-service-down opened 10, resolved 20",
      "openstack-network-agent-down opened 10, resolved 20",
      "openstack-network-agent-down opened 10, resolved 20",
      "openstack-network-agent-down opened 10, resolved 20",
      // neutron-openvswitch-agent read as down a minute after the others did.
      "openstack-network-agent-down opened 11, resolved 20",
      "openstack-rabbitmq-down opened 5, resolved 15",
      "openstack-rabbitmq-node-down opened 10, resolved 15",
    ]);
  }, 120000);
});
