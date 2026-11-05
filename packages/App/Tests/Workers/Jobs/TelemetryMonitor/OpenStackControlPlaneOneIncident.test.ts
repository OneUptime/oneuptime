import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
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
 * WHERE THE PROOF STOPS. No OneUptime ran beside the cloud. The drills lasted 3 to 5 minutes and a
 * template's window is 5 to 10, so a drill's last minute is held until 14 minutes in, which nobody
 * recorded. So is its one reading after recovery, and the exporter's series behind it (below) are
 * held back for LAG_MINUTES, because the agent collects those every 2 to 5 minutes while the
 * recording read them as they were. The series are what the exporters really said, the agent's
 * collector having made them what it sends is OpenStackControlPlaneScenes' work, and the single
 * node of a DevStack is one machine of everything.
 */

// MonitorResource reaches the native isolated-vm addon through the criteria evaluator's sandbox.
jest.mock("isolated-vm", () => {
  return {};
});
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});
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

  const lastOfOutage: RecordedReading = drill.minutes[drill.minutes.length - 1]!;

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

function modelOfOpen<T extends Incident | Alert>(
  build: () => T,
  records: Array<WorldRecord>,
  args: unknown,
): Promise<Array<T>> {
  const ids: Array<string> = (
    ((args as { query: { monitors?: Array<unknown> } }).query.monitors ||
      []) as Array<unknown>
  ).map(String);

  return Promise.resolve(
    records
      .filter((record: WorldRecord): boolean => {
        return (
          record.resolvedAtMinute === null &&
          ids.includes(record.monitor.monitor.id!.toString())
        );
      })
      .map((record: WorldRecord): T => {
        const model: T = build();
        model._id = record.id;
        model.projectId = PROJECT_ID;
        model.title = record.title;
        model.seriesLabels = record.labels;
        model.seriesFingerprint = record.labels["fingerprint"] as string;
        return model;
      }),
  );
}

beforeEach(() => {
  jest.useFakeTimers({ advanceTimers: true });
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
  jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(null as never);
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
  jest.spyOn(MonitorService, "findOneById").mockImplementation((args: unknown) => {
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
    return modelOfOpen(
      (): Incident => {
        return new Incident();
      },
      incidents,
      args,
    ) as never;
  });
  jest.spyOn(AlertService, "findBy").mockImplementation((args: unknown) => {
    return modelOfOpen(
      (): Alert => {
        return new Alert();
      },
      alerts,
      args,
    ) as never;
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

async function runDrill(release: string, name: string): Promise<void> {
  const drill: RecordedDrill = readCloudDrill(release, name);

  buildWorld();
  timelineRows = rowsOfTimeline(drill);

  for (
    minuteNow = 0;
    minuteNow <= OUTAGE_MINUTES + MINUTES_AFTER;
    minuteNow++
  ) {
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

function describeRecords(records: Array<WorldRecord>): Array<string> {
  return records.map((record: WorldRecord): string => {
    return `${record.monitor.template.id} ${JSON.stringify(record.labels)} opened ${record.openedAtMinute} resolved ${record.resolvedAtMinute}`;
  });
}

describe("one failure opens one incident", () => {
  test.each([
    ["gazpacho-ovn", "rabbitmq-down"],
    ["gazpacho-ovs", "rabbitmq-down"],
    ["gazpacho-ovn", "mariadb-down"],
    ["gazpacho-ovn", "ovn-controller-down"],
    ["gazpacho-ovn", "ovs-down"],
    ["gazpacho-ovs", "ovs-down"],
    ["gazpacho-ovn", "libvirt-down"],
    ["gazpacho-ovn", "memcached-down"],
  ])(
    "%s %s",
    async (release: string, name: string) => {
      await runDrill(release, name);
      // eslint-disable-next-line no-console
      console.log(
        `${release} ${name}\n${describeRecords(incidents).join("\n")}\nalerts\n${describeRecords(alerts).join("\n")}`,
      );
      expect(incidents.length).toBeGreaterThan(0);
    },
    900000,
  );
});
