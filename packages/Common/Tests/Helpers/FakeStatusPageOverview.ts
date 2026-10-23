import Incident from "../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Color from "../../Types/Color";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import StatusPageSummaryUtil from "../../Types/StatusPage/StatusPageSummary";
import ScheduledMaintenanceStartUtil from "../../Utils/ScheduledMaintenanceStart";
import StatusPageSummaryBuilder from "../../Utils/StatusPage/StatusPageSummaryBuilder";

/*
 * A OneUptime status page, as its overview answers it - for the suites that
 * read a page the way a visitor's browser, the summary endpoint and another
 * OneUptime's External Status Page monitor read it.
 *
 * A page is described in a few lines (FakeStatusPage) and turned into the
 * overview JSON StatusPageAPI.buildOverviewResponse sends: real models,
 * serialized the way the server serializes them (BaseModel.toJSONArray,
 * JSONFunctions.serialize), holding what the server's reads would hold -
 * scheduled maintenance in progress or to come, by the project's own list of
 * states (ScheduledMaintenanceStartUtil), and nothing over; no incident when
 * the page does not show incidents; no maintenance when it does not show
 * maintenance; the overall status as StatusPageService.getOverallMonitorStatus
 * works it out. fakeSummaryJSON is the summary the server would send for it.
 *
 * The project's maintenance states, top first, with states of its own on
 * every side of the built-in ones:
 *
 *   Scheduled (built-in)  Confirmed (own)  - waiting to start
 *   Ongoing (built-in)    Verifying (own)  - in progress
 *   Ended (built-in)      Reviewing (own)  Completed (built-in)  Archived (own) - over
 */

export type FakeStateKey =
  | "scheduled"
  | "confirmed"
  | "ongoing"
  | "verifying"
  | "ended"
  | "reviewing"
  | "completed"
  | "archived";

interface FakeStateSpec {
  key: FakeStateKey;
  id: string;
  name: string;
  order: number;
  isScheduledState?: boolean;
  isOngoingState?: boolean;
  isEndedState?: boolean;
  isResolvedState?: boolean;
}

export const FAKE_MAINTENANCE_STATES: ReadonlyArray<FakeStateSpec> = [
  {
    key: "scheduled",
    id: "5f000000-0000-4000-8000-0000000000a1",
    name: "Scheduled",
    order: 1,
    isScheduledState: true,
  },
  {
    key: "confirmed",
    id: "5f000000-0000-4000-8000-0000000000a2",
    name: "Confirmed",
    order: 2,
  },
  {
    key: "ongoing",
    id: "5f000000-0000-4000-8000-0000000000a3",
    name: "Ongoing",
    order: 3,
    isOngoingState: true,
  },
  {
    key: "verifying",
    id: "5f000000-0000-4000-8000-0000000000a4",
    name: "Verifying",
    order: 4,
  },
  {
    key: "ended",
    id: "5f000000-0000-4000-8000-0000000000a5",
    name: "Ended",
    order: 5,
    isEndedState: true,
  },
  {
    key: "reviewing",
    id: "5f000000-0000-4000-8000-0000000000a6",
    name: "Reviewing",
    order: 6,
  },
  {
    key: "completed",
    id: "5f000000-0000-4000-8000-0000000000a7",
    name: "Completed",
    order: 7,
    isResolvedState: true,
  },
  {
    key: "archived",
    id: "5f000000-0000-4000-8000-0000000000a8",
    name: "Archived",
    order: 8,
  },
];

export interface FakeMonitorStatus {
  id: string;
  name: string;
  color: string;
  priority: number;
  isOperational?: boolean | undefined;
}

// A project's monitor statuses: its three defaults, and a Maintenance of its own.
export const FAKE_STATUSES: {
  operational: FakeMonitorStatus;
  degraded: FakeMonitorStatus;
  offline: FakeMonitorStatus;
  maintenance: FakeMonitorStatus;
} = {
  operational: {
    id: "5f000000-0000-4000-8000-0000000000b1",
    name: "Operational",
    color: "#2ab57d",
    priority: 1,
    isOperational: true,
  },
  degraded: {
    id: "5f000000-0000-4000-8000-0000000000b2",
    name: "Degraded",
    color: "#f59e0b",
    priority: 2,
  },
  offline: {
    id: "5f000000-0000-4000-8000-0000000000b3",
    name: "Offline",
    color: "#ef4444",
    priority: 3,
  },
  maintenance: {
    id: "5f000000-0000-4000-8000-0000000000b4",
    name: "Maintenance",
    color: "#6366f1",
    priority: 4,
  },
};

export interface FakePageGroup {
  id: string;
  name: string;
  parentId?: string | undefined;
}

export interface FakePageResource {
  id: string;
  name: string;
  groupId?: string | undefined;
  // A monitor on the page, and its current status (none: null).
  monitorId?: string | undefined;
  statusId?: string | null | undefined;
  // Or a monitor group on the page.
  monitorGroupId?: string | undefined;
  // On unless set to false.
  showCurrentStatus?: boolean | undefined;
}

export interface FakeMonitorGroup {
  id: string;
  monitorIds: Array<string>;
  // The group's current status: the worst of its monitors' (none: unset).
  statusId?: string | undefined;
}

export interface FakeMaintenance {
  id: string;
  title: string;
  state: FakeStateKey;
  startsAt: Date;
  endsAt?: Date | undefined;
  monitorIds: Array<string>;
}

export interface FakeIncident {
  id: string;
  title: string;
  declaredAt: Date;
  state: string;
  severity: string;
  monitorIds: Array<string>;
}

export interface FakeStatusPage {
  statuses?: Array<FakeMonitorStatus> | undefined;
  groups?: Array<FakePageGroup> | undefined;
  resources: Array<FakePageResource>;
  monitorGroups?: Array<FakeMonitorGroup> | undefined;
  maintenance?: Array<FakeMaintenance> | undefined;
  incidents?: Array<FakeIncident> | undefined;
  // Whether the page shows scheduled maintenance / incidents: on unless false.
  showsMaintenance?: boolean | undefined;
  showsIncidents?: boolean | undefined;
}

function monitorOf(id: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  return monitor;
}

function stateOf(key: FakeStateKey): ScheduledMaintenanceState {
  const spec: FakeStateSpec = FAKE_MAINTENANCE_STATES.find(
    (candidate: FakeStateSpec): boolean => {
      return candidate.key === key;
    },
  )!;

  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = spec.id;
  state.name = spec.name;
  state.order = spec.order;
  state.color = Color.fromString("#6366f1");
  state.isScheduledState = Boolean(spec.isScheduledState);
  state.isOngoingState = Boolean(spec.isOngoingState);
  state.isEndedState = Boolean(spec.isEndedState);
  state.isResolvedState = Boolean(spec.isResolvedState);
  return state;
}

function statusModelOf(status: FakeMonitorStatus): MonitorStatus {
  const model: MonitorStatus = new MonitorStatus();
  model._id = status.id;
  model.name = status.name;
  model.color = Color.fromString(status.color);
  model.priority = status.priority;
  model.isOperationalState = Boolean(status.isOperational);
  return model;
}

export function fakeStatuses(): Array<FakeMonitorStatus> {
  return [
    FAKE_STATUSES.operational,
    FAKE_STATUSES.degraded,
    FAKE_STATUSES.offline,
    FAKE_STATUSES.maintenance,
  ];
}

// The overview JSON the server sends for the page.
export function buildFakeOverview(page: FakeStatusPage): JSONObject {
  const statuses: Array<FakeMonitorStatus> = [
    ...(page.statuses || fakeStatuses()),
  ].sort((a: FakeMonitorStatus, b: FakeMonitorStatus): number => {
    return a.priority - b.priority;
  });

  const groups: Array<StatusPageGroup> = (page.groups || []).map(
    (spec: FakePageGroup, index: number): StatusPageGroup => {
      const group: StatusPageGroup = new StatusPageGroup();
      group._id = spec.id;
      group.name = spec.name;
      group.order = index + 1;
      group.showCurrentStatus = true;
      if (spec.parentId) {
        group.parentStatusPageGroupId = new ObjectID(spec.parentId);
      }
      return group;
    },
  );

  const resources: Array<StatusPageResource> = page.resources.map(
    (spec: FakePageResource, index: number): StatusPageResource => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = spec.id;
      resource.displayName = spec.name;
      resource.order = index + 1;
      resource.showCurrentStatus = spec.showCurrentStatus !== false;
      resource.showStatusHistoryChart = true;
      resource.showUptimePercent = false;

      if (spec.groupId) {
        resource.statusPageGroupId = new ObjectID(spec.groupId);
        const group: FakePageGroup | undefined = (page.groups || []).find(
          (candidate: FakePageGroup): boolean => {
            return candidate.id === spec.groupId;
          },
        );
        const groupModel: StatusPageGroup = new StatusPageGroup();
        groupModel.name = group?.name || "";
        resource.statusPageGroup = groupModel;
      }

      if (spec.monitorId) {
        resource.monitorId = new ObjectID(spec.monitorId);
        const monitor: Monitor = monitorOf(spec.monitorId);
        if (spec.statusId) {
          monitor.currentMonitorStatusId = new ObjectID(spec.statusId);
        }
        monitor.isArchived = false;
        resource.monitor = monitor;
      }

      if (spec.monitorGroupId) {
        resource.monitorGroupId = new ObjectID(spec.monitorGroupId);
      }

      return resource;
    },
  );

  const monitorGroupCurrentStatuses: Dictionary<ObjectID> = {};
  const monitorsInGroup: Dictionary<Array<ObjectID>> = {};

  for (const group of page.monitorGroups || []) {
    monitorsInGroup[group.id] = group.monitorIds.map(
      (id: string): ObjectID => {
        return new ObjectID(id);
      },
    );

    if (group.statusId) {
      monitorGroupCurrentStatuses[group.id] = new ObjectID(group.statusId);
    }
  }

  const stateModels: Array<ScheduledMaintenanceState> =
    FAKE_MAINTENANCE_STATES.map(
      (spec: FakeStateSpec): ScheduledMaintenanceState => {
        return stateOf(spec.key);
      },
    );

  // In progress or to come, as the server's two reads find them.
  const events: Array<ScheduledMaintenance> =
    page.showsMaintenance === false
      ? []
      : (page.maintenance || [])
          .filter((spec: FakeMaintenance): boolean => {
            const state: ScheduledMaintenanceState = stateOf(spec.state);

            return (
              ScheduledMaintenanceStartUtil.isInProgress({
                states: stateModels,
                state: state,
              }) ||
              ScheduledMaintenanceStartUtil.isWaitingToStart({
                states: stateModels,
                state: state,
              })
            );
          })
          .map((spec: FakeMaintenance): ScheduledMaintenance => {
            const event: ScheduledMaintenance = new ScheduledMaintenance();
            event._id = spec.id;
            event.title = spec.title;
            event.startsAt = spec.startsAt;
            if (spec.endsAt) {
              event.endsAt = spec.endsAt;
            }
            event.createdAt = new Date(spec.startsAt.getTime() - 86400000);
            event.currentScheduledMaintenanceState = stateOf(spec.state);
            event.monitors = spec.monitorIds.map(monitorOf);
            return event;
          });

  const incidents: Array<Incident> =
    page.showsIncidents === false
      ? []
      : (page.incidents || []).map((spec: FakeIncident): Incident => {
          const incident: Incident = new Incident();
          incident._id = spec.id;
          incident.title = spec.title;
          incident.declaredAt = spec.declaredAt;
          incident.createdAt = spec.declaredAt;
          const state: IncidentState = new IncidentState();
          state.name = spec.state;
          incident.currentIncidentState = state;
          const severity: IncidentSeverity = new IncidentSeverity();
          severity.name = spec.severity;
          incident.incidentSeverity = severity;
          incident.monitors = spec.monitorIds.map(monitorOf);
          return incident;
        });

  /*
   * The overall status, as StatusPageService.getOverallMonitorStatus works
   * it out: the highest-priority status any resource is in, or the
   * lowest-priority status of the project when none is.
   */
  const inUse: Set<string> = new Set<string>();

  for (const spec of page.resources) {
    if (spec.monitorId && spec.statusId) {
      inUse.add(spec.statusId);
    }
  }

  for (const statusId of Object.values(monitorGroupCurrentStatuses)) {
    inUse.add(statusId.toString());
  }

  let overall: FakeMonitorStatus | null = statuses[0] || null;

  for (const status of statuses) {
    if (inUse.has(status.id)) {
      overall = status;
    }
  }

  return {
    overallStatus: overall
      ? BaseModel.toJSON(statusModelOf(overall), MonitorStatus)
      : null,
    statusPageResources: BaseModel.toJSONArray(resources, StatusPageResource),
    resourceGroups: BaseModel.toJSONArray(groups, StatusPageGroup),
    monitorStatuses: BaseModel.toJSONArray(
      statuses.map(statusModelOf),
      MonitorStatus,
    ),
    monitorGroupCurrentStatuses: JSONFunctions.serialize(
      monitorGroupCurrentStatuses,
    ),
    monitorsInGroup: JSONFunctions.serialize(monitorsInGroup),
    activeIncidents: BaseModel.toJSONArray(incidents, Incident),
    scheduledMaintenanceEvents: BaseModel.toJSONArray(
      events,
      ScheduledMaintenance,
    ),
    scheduledMaintenanceStates: BaseModel.toJSONArray(
      page.showsMaintenance === false ? [] : stateModels,
      ScheduledMaintenanceState,
    ),
    // What the uptime bars and the rest of the overview hold: not read here.
    monitorStatusTimelines: [],
    timelineIncidents: [],
    activeAnnouncements: [],
    activeEpisodes: [],
    incidentPublicNotes: [],
    incidentStateTimelines: [],
    scheduledMaintenanceEventsPublicNotes: [],
    scheduledMaintenanceStateTimelines: [],
  };
}

// The summary the server sends for the page, as it goes on the wire.
export function fakeSummaryJSON(page: FakeStatusPage): JSONObject {
  return JSON.parse(
    JSON.stringify(
      StatusPageSummaryUtil.toJSON(
        StatusPageSummaryBuilder.fromOverview(
          JSON.parse(JSON.stringify(buildFakeOverview(page))) as JSONObject,
        ),
      ),
    ),
  ) as JSONObject;
}
