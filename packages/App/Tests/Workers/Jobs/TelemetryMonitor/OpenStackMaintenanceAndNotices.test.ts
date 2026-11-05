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
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackProjectNotice from "Common/Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import OpenStackCloudLabelRuleService from "Common/Server/Services/OpenStackCloudLabelRuleService";
import OpenStackCloudOwnerRuleService from "Common/Server/Services/OpenStackCloudOwnerRuleService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import OpenStackProjectNoticeDeliveryService, {
  OpenStackProjectNoticeDeliveryToRecord,
} from "Common/Server/Services/OpenStackProjectNoticeDeliveryService";
import OpenStackProjectNoticeService from "Common/Server/Services/OpenStackProjectNoticeService";
import OpenStackResourceService from "Common/Server/Services/OpenStackResourceService";
import ProjectService from "Common/Server/Services/ProjectService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "Common/Server/Utils/Logger";
import MonitorDependencySuppression from "Common/Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorMetricUtil from "Common/Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorResourceContextUtil from "Common/Server/Utils/Monitor/MonitorResourceContext";
import MonitorSummaryCapture from "Common/Server/Utils/Monitor/MonitorSummaryCapture";
import OpenStackAlertContext from "Common/Server/Utils/OpenStack/OpenStackAlertContext";
import {
  OPENSTACK_RECORDING_NOW,
  OpenStackRecordedSeries,
  getOpenStackDrilledReleases,
  readOpenStackScene,
} from "Common/Tests/Helpers/OpenStackRecordings";
import { mockProjectStates } from "Common/Tests/Server/TestingUtils/Services/ProjectStatesHelper";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { getOpenStackAlertTemplateById } from "Common/Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import { buildOpenStackBlastRadius } from "Common/Types/OpenStack/OpenStackBlastRadius";
import { OpenStackMaintenancePartKind } from "Common/Types/OpenStack/OpenStackMaintenancePart";
import { OpenStackProjectNoticeEvent } from "Common/Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";

/*
 * ------------------------------------------------------------------
 * #5750's done-when, as near as a test can get to it, on what real clouds' exporters said:
 *
 *   a stopped compute host opens one incident, which tells only the project turned on; a maintenance
 *   event on the host keeps it quiet; and `compute service set --disable` during a window on that host
 *   reads as expected, and outside one pages.
 * ------------------------------------------------------------------
 *
 * The recordings are the rig's drills on real DevStacks (healthy, compute-down, compute-disabled,
 * recovered: Common/Tests/Fixtures/OpenStack), played at the agent's two-minute cadence and checked once
 * a minute as the worker checks.
 *
 * REAL, production code unmodified:
 *   - the templates, the worker's monitorOpenStack and its grouped reads;
 *   - MonitorResourceUtil.monitorResource: the verdict, the per-series fan-out, the status timeline's
 *     decisions and MonitorIncident's own dedupe;
 *   - MonitorMaintenanceSuppression, from the event in progress to the series it quiets;
 *   - OpenStackProjectNotices: who is told, from a radius with several projects on and off.
 *
 * STOOD IN FOR, so this is not a live stack:
 *   - ClickHouse, answered from the recording by foldRowsAsSqlRead;
 *   - Postgres: the events in progress, the notices and the inventory are in lists here, and the blast
 *     radius is handed over (OpenStackProjectNoticePostgres reads a real one). So no incident row exists;
 *   - the queue, Redis and time, as OpenStackComputeDownIncident.test.ts says of itself.
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

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import { monitorOpenStack } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { FoldedReadArgs, foldRowsAsSqlRead } from "./SqlGroupedFold";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const CLOUD: string = "devstack";
const CLOUD_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const PAYMENTS: string = "aaaa0000000000000000000000000001";
const RESEARCH: string = "aaaa0000000000000000000000000002";

const MINUTE_MS: number = 60_000;
const COLLECTION_MINUTES: number = 2;

interface Row {
  time: Date;
  value: number;
  attributes: JSONObject;
}

interface Replay {
  startMs: number;
  monitor: Monitor;
  step: MonitorStep;
  rowsByName: Map<string, Array<Row>>;
  opened: Array<Incident>;
  openIncidents: Array<Incident>;
  openedAlerts: Array<Alert>;
  openAlerts: Array<Alert>;
  resolved: Array<string>;
  statusChanges: Array<string>;
}

// Each scene from a minute of the replay on, until the next one starts.
function buildReplay(data: {
  release: string;
  templateId: string;
  scenes: Array<{ scene: string; fromMinute: number }>;
  endMinute: number;
}): Replay {
  const startMs: number = OPENSTACK_RECORDING_NOW.getTime();
  const rowsByName: Map<string, Array<Row>> = new Map();
  const scenes: Array<{
    fromMinute: number;
    series: Array<OpenStackRecordedSeries>;
  }> = data.scenes.map((one: { scene: string; fromMinute: number }) => {
    return {
      fromMinute: one.fromMinute,
      series: readOpenStackScene(data.release, one.scene),
    };
  });

  for (
    let minute: number = -30;
    minute <= data.endMinute;
    minute += COLLECTION_MINUTES
  ) {
    const scene: Array<OpenStackRecordedSeries> = scenes.reduce(
      (
        current: Array<OpenStackRecordedSeries>,
        one: { fromMinute: number; series: Array<OpenStackRecordedSeries> },
      ) => {
        return minute >= one.fromMinute ? one.series : current;
      },
      scenes[0]!.series,
    );

    for (const series of scene) {
      const rows: Array<Row> = rowsByName.get(series.name) || [];
      rows.push({
        time: new Date(startMs + minute * MINUTE_MS),
        value: series.value,
        attributes: {
          ...series.labels,
          "openstack.region.name": "RegionOne",
          "resource.openstack.cloud.name": CLOUD,
        },
      });
      rowsByName.set(series.name, rows);
    }
  }

  const step: MonitorStep = getOpenStackAlertTemplateById(
    data.templateId,
  )!.getMonitorStep({
    cloudIdentifier: CLOUD,
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "The monitor",
  });

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "The monitor";
  monitor.monitorType = MonitorType.OpenStack;
  monitor.currentMonitorStatusId = ONLINE;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;

  return {
    startMs,
    monitor,
    step,
    rowsByName,
    opened: [],
    openIncidents: [],
    openedAlerts: [],
    openAlerts: [],
    resolved: [],
    statusChanges: [],
  };
}

function rowsOfQuery(replay: Replay, query: JSONObject): Array<Row> {
  const window: InBetween<Date> = query["time"] as unknown as InBetween<Date>;
  const wanted: JSONObject = (query["attributes"] as JSONObject) || {};
  const from: number = new Date(window.startValue).getTime();
  const to: number = new Date(window.endValue).getTime();

  return (replay.rowsByName.get(query["name"] as string) || []).filter(
    (row: Row): boolean => {
      const atMs: number = row.time.getTime();

      return (
        atMs >= from &&
        atMs <= to &&
        Object.keys(wanted).every((key: string): boolean => {
          return row.attributes[key] === wanted[key];
        })
      );
    },
  );
}

function useReplay(replay: Replay): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const read: FoldedReadArgs & { query: JSONObject } =
      args as FoldedReadArgs & { query: JSONObject };
    return foldRowsAsSqlRead(rowsOfQuery(replay, read.query), read);
  });
  metricFindBy.mockImplementation(async (args: unknown) => {
    return rowsOfQuery(replay, (args as { query: JSONObject }).query);
  });
  metricTypeFindBy.mockResolvedValue([] as never);

  jest.spyOn(MonitorService, "findOneById").mockImplementation(() => {
    return Promise.resolve(replay.monitor) as never;
  });
  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation(() => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorStatusId = replay.monitor.currentMonitorStatusId!;
      return Promise.resolve(timeline) as never;
    });
  jest
    .spyOn(MonitorStatusTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const data: { monitorStatusId: ObjectID } = (
        createBy as { data: { monitorStatusId: ObjectID } }
      ).data;
      replay.monitor.currentMonitorStatusId = data.monitorStatusId;
      replay.statusChanges.push(data.monitorStatusId.toString());
      return Promise.resolve(new MonitorStatusTimeline()) as never;
    });
  jest.spyOn(IncidentService, "findBy").mockImplementation(() => {
    return Promise.resolve([...replay.openIncidents]) as never;
  });
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation((createBy: unknown) => {
      const incident: Incident = (createBy as { data: Incident }).data;
      incident.id = ObjectID.generate();
      replay.opened.push(incident);
      replay.openIncidents.push(incident);
      return Promise.resolve(incident) as never;
    });
  jest.spyOn(AlertService, "findBy").mockImplementation(() => {
    return Promise.resolve([...replay.openAlerts]) as never;
  });
  jest.spyOn(AlertService, "create").mockImplementation((createBy: unknown) => {
    const alert: Alert = (createBy as { data: Alert }).data;
    alert.id = ObjectID.generate();
    replay.openedAlerts.push(alert);
    replay.openAlerts.push(alert);
    return Promise.resolve(alert) as never;
  });
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const data: { alertId: ObjectID } = (
        createBy as { data: { alertId: ObjectID } }
      ).data;
      replay.openAlerts = replay.openAlerts.filter((alert: Alert) => {
        return alert.id!.toString() !== data.alertId.toString();
      });
      return Promise.resolve(undefined) as never;
    });
  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation((createBy: unknown) => {
      const data: { incidentId: ObjectID } = (
        createBy as { data: { incidentId: ObjectID } }
      ).data;
      replay.resolved.push(data.incidentId.toString());
      replay.openIncidents = replay.openIncidents.filter(
        (incident: Incident) => {
          return incident.id!.toString() !== data.incidentId.toString();
        },
      );
      return Promise.resolve(undefined) as never;
    });
}

async function checkFrom(
  replay: Replay,
  fromMinute: number,
  toMinute: number,
): Promise<void> {
  for (let minute: number = fromMinute; minute < toMinute; minute++) {
    jest.setSystemTime(new Date(replay.startMs + minute * MINUTE_MS));

    const response: MetricMonitorResponse = await monitorOpenStack({
      monitorStep: replay.step,
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });
    await MonitorResourceUtil.monitorResource(response);
  }
}

/*
 * The host a scene is about, from the recording itself, so a recording of another shape can't quietly
 * pass: the one enabled nova-compute reading 0, or the one disabled.
 */
function hostOf(release: string, scene: string): string {
  const hosts: Array<string> = readOpenStackScene(release, scene)
    .filter((series: OpenStackRecordedSeries): boolean => {
      if (
        series.name !== "openstack_nova_agent_state" ||
        series.labels["service"] !== "nova-compute"
      ) {
        return false;
      }
      return scene === "compute-disabled"
        ? series.labels["adminState"] === "disabled"
        : series.labels["adminState"] === "enabled" && series.value === 0;
    })
    .map((series: OpenStackRecordedSeries): string => {
      return series.labels["hostname"]!;
    });

  expect(hosts).toHaveLength(1);

  return hosts[0]!;
}

const DRILLED: Array<string> = getOpenStackDrilledReleases().filter(
  (release: string): boolean => {
    try {
      return readOpenStackScene(release, "compute-disabled").length > 0;
    } catch {
      return false;
    }
  },
);

describe("maintenance and project notices, replayed from what real clouds' exporters said", () => {
  let recorded: Array<OpenStackProjectNoticeDeliveryToRecord>;
  let eventsInProgress: Array<ScheduledMaintenance>;

  function noticeOn(projectId: string, email: string, isOn: boolean): OpenStackProjectNotice {
    const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
    notice._id = ObjectID.generate().toString();
    notice.openStackProjectId = projectId;
    notice.email = new Email(email);
    if (isOn) {
      notice.isEnabled = true;
      notice.previewSeenAt = new Date();
      notice.previewedRecipient = `email:${email}`;
    }
    return notice;
  }

  function maintenanceOn(host: string): void {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.openStackParts = [
      {
        openStackCloudId: CLOUD_ID.toString(),
        kind: OpenStackMaintenancePartKind.Hypervisor,
        name: host,
        regionName: "RegionOne",
      },
    ];
    eventsInProgress = [event];
  }

  beforeEach(() => {
    recorded = [];
    eventsInProgress = [];

    jest.useFakeTimers({
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
    mockProjectStates();

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
      .mockImplementation((async (data: { ids?: Array<unknown> }) => {
        return { usableIds: data.ids || [], droppedIds: [] };
      }) as never);
    jest
      .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
      .mockResolvedValue(undefined);
    jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
    jest
      .spyOn(MonitorDependencySuppression, "getDependencySuppression")
      .mockResolvedValue({ isSuppressed: false } as never);
    jest
      .spyOn(MonitorSummaryCapture, "capture")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext() as never);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext() as never);
    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] } as never);

    // The events in progress, as MonitorMaintenanceSuppression really reads them.
    jest
      .spyOn(
        ScheduledMaintenanceStateService,
        "getInProgressScheduledMaintenanceStateIds",
      )
      .mockImplementation((async () => {
        return eventsInProgress.length > 0 ? [ObjectID.generate()] : [];
      }) as never);
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((async () => {
        return eventsInProgress;
      }) as never);
    const cloud: OpenStackCloud = new OpenStackCloud();
    cloud._id = CLOUD_ID.toString();
    cloud.name = CLOUD;
    jest.spyOn(OpenStackCloudService, "findBy").mockResolvedValue([cloud]);

    /*
     * What the radius says is held by OpenStackProjectNoticePostgres on real rows, so here the stopped
     * host holds two projects' instances.
     */
    jest
      .spyOn(OpenStackAlertContext, "describeSeries")
      .mockImplementation(async (data: { description: string | undefined }) => {
        return {
          description: data.description,
          reached: [{ projectId: PAYMENTS }, { projectId: RESEARCH }],
          openStackCloudId: CLOUD_ID,
          context: {
            radius: buildOpenStackBlastRadius({
              counts: [
                {
                  count: "instanceCount",
                  byProject: [
                    { projectId: PAYMENTS, count: 3 },
                    { projectId: RESEARCH, count: 1 },
                    { projectId: null, count: 1 },
                  ],
                },
              ],
              projectNames: {
                [PAYMENTS]: "ou-payments",
                [RESEARCH]: "ou-research",
              },
              includeEveryProject: true,
            }),
            projectId: null,
            projectName: null,
            domainId: null,
            partKind: OpenStackResourceKind.Service,
            partExternalId: "RegionOne/compute/compute-01/nova-compute",
            partName: "nova-compute",
            partRegionName: "RegionOne",
          },
        };
      });
    jest.spyOn(OpenStackCloudOwnerRuleService, "findBy").mockResolvedValue([]);
    jest.spyOn(OpenStackCloudLabelRuleService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockResolvedValue(new OpenStackCloud());
    jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
    jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    // Two notices: one project turned on, one off, and what the inventory says of them.
    jest
      .spyOn(OpenStackProjectNoticeService, "findBy")
      .mockResolvedValue([
        noticeOn(PAYMENTS, "payments@example.com", true),
        noticeOn(RESEARCH, "research@example.com", false),
      ]);
    jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockImplementation((async (read: { query: { kind: string } }) => {
        if (read.query.kind !== OpenStackResourceKind.Project) {
          return [];
        }
        return [PAYMENTS, RESEARCH].map((id: string) => {
          const row: OpenStackResource = new OpenStackResource();
          row.externalId = id;
          return row;
        });
      }) as never);
    jest
      .spyOn(OpenStackProjectNoticeDeliveryService, "recordIfNew")
      .mockImplementation((async (
        rows: ReadonlyArray<OpenStackProjectNoticeDeliveryToRecord>,
      ) => {
        recorded.push(...rows);
        return rows.length;
      }) as never);

    jest.spyOn(logger, "error").mockImplementation(((): void => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("the rig recorded it on the clouds that drill it", () => {
    expect(DRILLED.length).toBeGreaterThan(0);
  });

  test.each(DRILLED)(
    "%s: a stopped host opens one incident, which tells only the project turned on, once",
    async (release: string) => {
      const replay: Replay = buildReplay({
        release,
        templateId: "openstack-compute-service-down",
        scenes: [
          { scene: "healthy", fromMinute: -30 },
          { scene: "compute-down", fromMinute: 0 },
        ],
        endMinute: 30,
      });
      useReplay(replay);

      await checkFrom(replay, 0, 30);

      expect(replay.opened).toHaveLength(1);
      expect(replay.monitor.currentMonitorStatusId!.toString()).toBe(
        OFFLINE.toString(),
      );

      expect(recorded).toHaveLength(1);
      expect(recorded[0]!.openStackProjectId).toBe(PAYMENTS);
      expect(recorded[0]!.event).toBe(
        OpenStackProjectNoticeEvent.IncidentOpened,
      );
      expect(recorded[0]!.incidentId?.toString()).toBe(
        replay.opened[0]!.id!.toString(),
      );
      expect((recorded[0]!.facts as JSONObject)["holdings"]).toEqual({
        instanceCount: 3,
      });
      expect(JSON.stringify(recorded[0]!.facts)).not.toContain("ou-research");
      expect(JSON.stringify(recorded[0]!.facts)).not.toContain(
        hostOf(release, "compute-down"),
      );
    },
    300000,
  );

  test.each(DRILLED)(
    "%s: a maintenance event on the host keeps it quiet: no incident, no notice, and no status change",
    async (release: string) => {
      const replay: Replay = buildReplay({
        release,
        templateId: "openstack-compute-service-down",
        scenes: [
          { scene: "healthy", fromMinute: -30 },
          { scene: "compute-down", fromMinute: 0 },
        ],
        endMinute: 60,
      });
      useReplay(replay);
      // By the name its hypervisor goes by, as an event made from its page has it.
      maintenanceOn(`${hostOf(release, "compute-down")}.example.internal`);

      await checkFrom(replay, 0, 30);

      expect(replay.opened).toHaveLength(0);
      expect(replay.openedAlerts).toHaveLength(0);
      expect(recorded).toEqual([]);
      expect(replay.statusChanges).toEqual([]);
      expect(replay.monitor.currentMonitorStatusId!.toString()).toBe(
        ONLINE.toString(),
      );

      // The work is over and the host is still down: now it is an outage.
      eventsInProgress = [];
      await checkFrom(replay, 30, 60);

      expect(replay.opened).toHaveLength(1);
      expect(replay.statusChanges).toEqual([OFFLINE.toString()]);
      expect(recorded).toHaveLength(1);
    },
    300000,
  );

  test.each(DRILLED)(
    "%s: an event on another host stops nothing",
    async (release: string) => {
      const replay: Replay = buildReplay({
        release,
        templateId: "openstack-compute-service-down",
        scenes: [
          { scene: "healthy", fromMinute: -30 },
          { scene: "compute-down", fromMinute: 0 },
        ],
        endMinute: 30,
      });
      useReplay(replay);
      maintenanceOn("some-other-host");

      await checkFrom(replay, 0, 30);

      expect(replay.opened).toHaveLength(1);
      expect(recorded).toHaveLength(1);
    },
    300000,
  );

  test.each(DRILLED)(
    "%s: `compute service set --disable` with no window on the host pages, once, and recovers",
    async (release: string) => {
      const replay: Replay = buildReplay({
        release,
        templateId: "openstack-compute-service-disabled",
        scenes: [
          { scene: "healthy", fromMinute: -30 },
          { scene: "compute-disabled", fromMinute: 0 },
          { scene: "recovered", fromMinute: 30 },
        ],
        endMinute: 60,
      });
      useReplay(replay);

      await checkFrom(replay, 0, 30);

      expect(replay.opened).toHaveLength(1);
      expect(replay.opened[0]!.title).toContain(
        "[OpenStack] Compute Service Disabled",
      );
      // What the project runs there carries on, so nothing here is true to tell it.
      expect(recorded).toEqual([]);
      expect(replay.opened[0]!.seriesLabels).toMatchObject({
        hostname: hostOf(release, "compute-disabled"),
        service: "nova-compute",
      });
      expect(replay.monitor.currentMonitorStatusId!.toString()).toBe(
        OFFLINE.toString(),
      );

      await checkFrom(replay, 30, 60);

      expect(replay.opened).toHaveLength(1);
      expect(replay.resolved).toHaveLength(1);
      expect(replay.monitor.currentMonitorStatusId!.toString()).toBe(
        ONLINE.toString(),
      );
    },
    300000,
  );

  test.each(DRILLED)(
    "%s: `compute service set --disable` during a window on that host reads as expected",
    async (release: string) => {
      const replay: Replay = buildReplay({
        release,
        templateId: "openstack-compute-service-disabled",
        scenes: [
          { scene: "healthy", fromMinute: -30 },
          { scene: "compute-disabled", fromMinute: 0 },
          { scene: "recovered", fromMinute: 30 },
        ],
        endMinute: 60,
      });
      useReplay(replay);
      maintenanceOn(hostOf(release, "compute-disabled"));

      await checkFrom(replay, 0, 60);

      expect(replay.opened).toHaveLength(0);
      expect(replay.openedAlerts).toHaveLength(0);
      expect(replay.statusChanges).toEqual([]);
      expect(recorded).toEqual([]);
    },
    300000,
  );

  test.each(DRILLED)(
    "%s: the same disable says nothing to the monitor of a stopped service, in or out of a window",
    async (release: string) => {
      const replay: Replay = buildReplay({
        release,
        templateId: "openstack-compute-service-down",
        scenes: [
          { scene: "healthy", fromMinute: -30 },
          { scene: "compute-disabled", fromMinute: 0 },
        ],
        endMinute: 30,
      });
      useReplay(replay);

      await checkFrom(replay, 0, 30);

      expect(replay.opened).toHaveLength(0);
    },
    300000,
  );
});
