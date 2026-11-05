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
import OpenStackCloudOwnerRule from "Common/Models/DatabaseModels/OpenStackCloudOwnerRule";
import Team from "Common/Models/DatabaseModels/Team";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import OpenStackCloudLabelRuleService from "Common/Server/Services/OpenStackCloudLabelRuleService";
import OpenStackCloudOwnerRuleService from "Common/Server/Services/OpenStackCloudOwnerRuleService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import TeamService from "Common/Server/Services/TeamService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "Common/Server/Utils/Logger";
import MonitorDependencySuppression from "Common/Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorLogUtil from "Common/Server/Utils/Monitor/MonitorLogUtil";
import MonitorMaintenanceSuppression from "Common/Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorMetricUtil from "Common/Server/Utils/Monitor/MonitorMetricUtil";
import MonitorResourceContextUtil from "Common/Server/Utils/Monitor/MonitorResourceContext";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorSummaryCapture from "Common/Server/Utils/Monitor/MonitorSummaryCapture";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import OpenStackAlertContext from "Common/Server/Utils/OpenStack/OpenStackAlertContext";
import {
  OPENSTACK_RECORDING_NOW,
  OpenStackRecordedSeries,
  getOpenStackDrilledReleases,
  readOpenStackScene,
} from "Common/Tests/Helpers/OpenStackRecordings";
import { mockProjectStates } from "Common/Tests/Server/TestingUtils/Services/ProjectStatesHelper";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  OpenStackAlertTemplate,
  getOpenStackAlertTemplateById,
} from "Common/Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";

/*
 * ------------------------------------------------------------------
 * #5729's done-when, as near as a test can get to it: a stopped
 * nova-compute opens one incident naming the host, and starting it
 * resolves that incident on its own.
 * ------------------------------------------------------------------
 *
 * What the exporter said on a real DevStack, in the scenes the rig's drills recorded
 * (healthy, compute-down, recovered: Common/Tests/Fixtures/OpenStack), played at the agent's
 * two-minute cadence, and checked once a minute as the worker checks.
 *
 * REAL, production code unmodified:
 *   - the template: "Compute Service Down", its queries, its window and its two criteria;
 *   - the worker: monitorOpenStack, its grouped reads and its series breakdown;
 *   - the verdict and what follows from it: MonitorResourceUtil.monitorResource, with
 *     MonitorCriteriaEvaluator, the per-series fan-out, the status timeline's decisions,
 *     MonitorIncident's own one-per-series dedupe and its resolve pass;
 *   - what a rule on a project on that host adds: the rule's evaluation by the cloud rule
 *     engine, and OpenStackScopedRules (#5728), with what the host holds stood in for.
 *
 * STOOD IN FOR, so this is not a live stack:
 *   - ClickHouse: the worker's reads are answered from the recording by foldRowsAsSqlRead, which
 *     GroupedReadInSqlClickhouse holds to the real thing. Nothing went through OTLP ingest, and
 *     no recording here was scraped by a running collector at this cadence;
 *   - Postgres: IncidentService.create and the state timeline's create add to and take from a
 *     list here, so IncidentService's own onCreateSuccess (owners, on-call, notifications) never
 *     runs, and no incident row exists;
 *   - Redis and the queue: there is no worker process or schedule. A check is a call in a loop;
 *   - time: the scenes are minutes long here. A real drill's took as long as Nova took.
 *
 * What would prove the rest is a stack with a running worker, reading a DevStack whose
 * nova-compute someone stops. That has not been run.
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

// A create that throws is logged and goes on, so a replay also asks that none was.
let loggedErrors: Array<string> = [];

const MINUTE_MS: number = 60_000;
// The agent's compute job: agents/OpenStackAgent/otel-collector-config.yaml.
const COLLECTION_MINUTES: number = 2;

// When each scene starts, in minutes from the start of the replay.
const HEALTHY_FROM: number = 0;
const DOWN_FROM: number = 30;
const RECOVERED_FROM: number = 60;
const END: number = 90;

interface Row {
  time: Date;
  value: number;
  attributes: JSONObject;
}

function rowsOfScene(
  scene: Array<OpenStackRecordedSeries>,
  at: Date,
): Array<Row & { name: string }> {
  return scene.map((series: OpenStackRecordedSeries) => {
    return {
      name: series.name,
      time: at,
      value: series.value,
      attributes: {
        ...series.labels,
        // What the agent's collector stamps on every datapoint and resource.
        "openstack.region.name": "RegionOne",
        "resource.openstack.cloud.name": CLOUD,
      },
    };
  });
}

interface Replay {
  release: string;
  startMs: number;
  monitor: Monitor;
  step: MonitorStep;
  // Every collection of the whole replay, by metric name.
  rowsByName: Map<string, Array<Row>>;
  opened: Array<Incident>;
  openIncidents: Array<Incident>;
  openedAlerts: Array<Alert>;
  openAlerts: Array<Alert>;
  resolved: Array<{ incidentId: string; rootCause: string | undefined }>;
  statusChanges: Array<string>;
}

function buildReplay(release: string): Replay {
  const healthy: Array<OpenStackRecordedSeries> = readOpenStackScene(
    release,
    "healthy",
  );
  const down: Array<OpenStackRecordedSeries> = readOpenStackScene(
    release,
    "compute-down",
  );
  const recovered: Array<OpenStackRecordedSeries> = readOpenStackScene(
    release,
    "recovered",
  );
  const startMs: number = OPENSTACK_RECORDING_NOW.getTime();
  const rowsByName: Map<string, Array<Row>> = new Map();

  for (
    let minute: number = HEALTHY_FROM - 30;
    minute <= END;
    minute += COLLECTION_MINUTES
  ) {
    const scene: Array<OpenStackRecordedSeries> =
      minute < DOWN_FROM ? healthy : minute < RECOVERED_FROM ? down : recovered;

    for (const row of rowsOfScene(
      scene,
      new Date(startMs + minute * MINUTE_MS),
    )) {
      const rows: Array<Row> = rowsByName.get(row.name) || [];
      rows.push({
        time: row.time,
        value: row.value,
        attributes: row.attributes,
      });
      rowsByName.set(row.name, rows);
    }
  }

  const template: OpenStackAlertTemplate = getOpenStackAlertTemplateById(
    "openstack-compute-service-down",
  )!;
  const step: MonitorStep = template.getMonitorStep({
    cloudIdentifier: CLOUD,
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Compute Service Down",
  });

  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "Compute Service Down";
  monitor.monitorType = MonitorType.OpenStack;
  monitor.currentMonitorStatusId = ONLINE;

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;

  return {
    release,
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

// What a read of ClickHouse would find: the rows in its window, with its attributes.
function rowsOfQuery(replay: Replay, query: JSONObject): Array<Row> {
  const window: InBetween<Date> = query["time"] as unknown as InBetween<Date>;
  const wanted: JSONObject = (query["attributes"] as JSONObject) || {};
  const from: number = new Date(window.startValue).getTime();
  const to: number = new Date(window.endValue).getTime();

  return (replay.rowsByName.get(query["name"] as string) || []).filter(
    (row: Row): boolean => {
      const atMs: number = row.time.getTime();

      if (atMs < from || atMs > to) {
        return false;
      }

      return Object.keys(wanted).every((key: string): boolean => {
        return row.attributes[key] === wanted[key];
      });
    },
  );
}

function useReplay(replay: Replay): void {
  metricAggregateBy.mockImplementation(async (args: unknown) => {
    const read: FoldedReadArgs & { query: JSONObject } =
      args as FoldedReadArgs & {
        query: JSONObject;
      };
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
      const data: { incidentId: ObjectID; rootCause?: string } = (
        createBy as { data: { incidentId: ObjectID; rootCause?: string } }
      ).data;
      replay.resolved.push({
        incidentId: data.incidentId.toString(),
        rootCause: data.rootCause,
      });
      replay.openIncidents = replay.openIncidents.filter(
        (incident: Incident) => {
          return incident.id!.toString() !== data.incidentId.toString();
        },
      );
      return Promise.resolve(undefined) as never;
    });
}

// One check, at this minute of the replay, as the worker makes it.
async function checkAt(replay: Replay, minute: number): Promise<void> {
  jest.setSystemTime(new Date(replay.startMs + minute * MINUTE_MS));

  const response: MetricMonitorResponse = await monitorOpenStack({
    monitorStep: replay.step,
    monitorId: MONITOR_ID,
    projectId: PROJECT_ID,
  });
  const result: ProbeApiIngestResponse =
    await MonitorResourceUtil.monitorResource(response);

  expect(result.monitorId?.toString()).toBe(MONITOR_ID.toString());
}

/*
 * The host the scene stopped: the one enabled nova-compute that reads 0 in it, from the recording
 * itself, so a recording of another shape can't quietly pass.
 */
function hostStoppedIn(release: string): string {
  const stopped: Array<string> = readOpenStackScene(release, "compute-down")
    .filter((series: OpenStackRecordedSeries): boolean => {
      return (
        series.name === "openstack_nova_agent_state" &&
        series.labels["service"] === "nova-compute" &&
        series.labels["adminState"] === "enabled" &&
        series.value === 0
      );
    })
    .map((series: OpenStackRecordedSeries): string => {
      return series.labels["hostname"]!;
    });

  expect(stopped).toHaveLength(1);

  return stopped[0]!;
}

const PROJECT_ON_THE_HOST: string = "f3a1c0d2e4b64f7c8a9d0e1f2a3b4c5d";
const CLOUD_ID: ObjectID = ObjectID.generate();
const TEAM_OF_THE_PROJECT: Team = new Team();
TEAM_OF_THE_PROJECT._id = ObjectID.generate().toString();
TEAM_OF_THE_PROJECT.id = new ObjectID(TEAM_OF_THE_PROJECT._id);
TEAM_OF_THE_PROJECT.name = "Payments";

describe("a stopped nova-compute, replayed from what real clouds' exporters said", () => {
  let addIncidentOwners: ReturnType<typeof jest.spyOn>;
  let addAlertOwners: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    // The clock alone, which is what the worker's window reads.
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
      .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
      .mockResolvedValue({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
      } as never);
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
    /*
     * What the radius says is held by OpenStackProjectsAndTopologyPostgres, so here the
     * stopped host simply holds one project's instances, and that project has a rule.
     */
    jest
      .spyOn(OpenStackAlertContext, "describeSeries")
      .mockImplementation(async (data: { description: string | undefined }) => {
        return {
          description: data.description,
          reached: [{ projectId: PROJECT_ON_THE_HOST, domainId: "default" }],
          openStackCloudId: CLOUD_ID,
        };
      });
    const rule: OpenStackCloudOwnerRule = new OpenStackCloudOwnerRule();
    rule.name = "ou-payments owners";
    rule.openStackProjectId = PROJECT_ON_THE_HOST;
    rule.ownerTeams = [TEAM_OF_THE_PROJECT];
    rule.ownerUsers = [];
    jest
      .spyOn(OpenStackCloudOwnerRuleService, "findBy")
      .mockResolvedValue([rule]);
    jest.spyOn(OpenStackCloudLabelRuleService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(OpenStackCloudService, "findOneById")
      .mockResolvedValue(new OpenStackCloud());
    jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertOwnerUserService, "findBy").mockResolvedValue([]);
    jest.spyOn(AlertOwnerTeamService, "findBy").mockResolvedValue([]);
    jest.spyOn(TeamService, "findBy").mockResolvedValue([TEAM_OF_THE_PROJECT]);
    addIncidentOwners = jest
      .spyOn(IncidentService, "addOwners")
      .mockResolvedValue(undefined);
    addAlertOwners = jest
      .spyOn(AlertService, "addOwners")
      .mockResolvedValue(undefined);
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
    jest
      .spyOn(logger, "error")
      .mockImplementation((...args: Array<unknown>) => {
        loggedErrors.push(String(args[0]));
        return undefined as never;
      });
    loggedErrors = [];
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("the rig recorded it on the clouds that drill it", () => {
    expect(getOpenStackDrilledReleases().length).toBeGreaterThan(0);
  });

  test.each(getOpenStackDrilledReleases())(
    "%s: one incident opens, it names the host, and it resolves on its own",
    async (release: string) => {
      const replay: Replay = buildReplay(release);
      const host: string = hostStoppedIn(release);
      useReplay(replay);

      // A healthy cloud opens nothing, whichever minute it is read at.
      for (let minute: number = HEALTHY_FROM; minute < DOWN_FROM; minute++) {
        await checkAt(replay, minute);
      }
      expect(replay.opened).toHaveLength(0);
      expect(replay.monitor.currentMonitorStatusId!.toString()).toBe(
        ONLINE.toString(),
      );

      // Stopped: it waits for its window, then opens once however long it stays down.
      let openedAtMinute: number | null = null;
      for (let minute: number = DOWN_FROM; minute < RECOVERED_FROM; minute++) {
        await checkAt(replay, minute);
        if (openedAtMinute === null && replay.opened.length > 0) {
          openedAtMinute = minute;
        }
      }
      expect(openedAtMinute).not.toBeNull();
      expect(openedAtMinute! - DOWN_FROM).toBeGreaterThanOrEqual(4);
      expect(replay.opened).toHaveLength(1);
      expect(replay.resolved).toHaveLength(0);

      const incident: Incident = replay.opened[0]!;
      expect(incident.title).toContain("[OpenStack] Compute Service Down");
      expect(incident.title).toContain(`Host: ${host}`);
      expect(incident.seriesLabels).toMatchObject({
        hostname: host,
        service: "nova-compute",
        "openstack.region.name": "RegionOne",
      });
      expect(incident.seriesFingerprint).toBeTruthy();
      expect(replay.monitor.currentMonitorStatusId!.toString()).toBe(
        OFFLINE.toString(),
      );

      // The team of a project on that host is on it, by the rule on the project.
      expect(addIncidentOwners).toHaveBeenCalledTimes(1);
      const owners: Array<unknown> = addIncidentOwners.mock
        .calls[0] as Array<unknown>;
      expect(String(owners[1])).toBe(incident.id!.toString());
      expect((owners[3] as Array<ObjectID>).map(String)).toEqual([
        TEAM_OF_THE_PROJECT.id!.toString(),
      ]);
      expect(addAlertOwners).toHaveBeenCalledTimes(1);

      // Started again: it resolves without anyone doing anything, and stays resolved.
      let resolvedAtMinute: number | null = null;
      for (let minute: number = RECOVERED_FROM; minute < END; minute++) {
        await checkAt(replay, minute);
        if (resolvedAtMinute === null && replay.resolved.length > 0) {
          resolvedAtMinute = minute;
        }
      }
      expect(resolvedAtMinute).not.toBeNull();
      expect(replay.resolved).toEqual([
        {
          incidentId: incident.id!.toString(),
          rootCause: expect.any(String),
        },
      ]);
      expect(replay.opened).toHaveLength(1);
      expect(replay.openIncidents).toHaveLength(0);
      // Its alert follows the same path, once.
      expect(replay.openedAlerts).toHaveLength(1);
      expect(replay.openAlerts).toHaveLength(0);
      expect(replay.monitor.currentMonitorStatusId!.toString()).toBe(
        ONLINE.toString(),
      );
      // Offline once, and online once.
      expect(replay.statusChanges).toEqual([
        OFFLINE.toString(),
        ONLINE.toString(),
      ]);
      expect(loggedErrors).toEqual([]);
    },
    300000,
  );
});
