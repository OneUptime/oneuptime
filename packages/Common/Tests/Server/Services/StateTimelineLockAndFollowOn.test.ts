import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeFeedService from "../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertMeasurementValueService from "../../../Server/Services/AlertMeasurementValueService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentEpisodeFeedService from "../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService, {
  MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
} from "../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import UserService from "../../../Server/Services/UserService";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  ALERT_STATE_IDS,
  INCIDENT_STATE_IDS,
  makeAlertStates,
  makeIncidentStates,
  mockProjectStates,
} from "../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A STATE CHANGE THAT FAILS GIVES ITS LOCK BACK, AND A SAVED STATE CHANGE
 * ALWAYS UPDATES ITS EVENT.
 *
 * Moving an incident, an alert, an alert or incident episode, a scheduled
 * maintenance event or a monitor to another state is the creation of a row
 * in its state timeline. The timeline service takes the event's lock in
 * onBeforeCreate - so that two changes to one event are read and written one
 * after the other - and gives it back in onCreateSuccess, once the row is
 * saved and the event's current state written.
 *
 * Two things went wrong between those two hooks:
 *
 *   - A change refused after onBeforeCreate - by a check DatabaseService.create
 *     runs after the hook, or by the INSERT itself - never reached
 *     onCreateSuccess, and onCreateError was handed nothing to give the lock
 *     back from. redis-semaphore kept refreshing the lock for as long as the
 *     process lived, so every later change to that event waited out the
 *     acquire timeout and then went ahead unlocked. DatabaseService.create
 *     now runs every step in one try, and hands onCreateError what
 *     onBeforeCreate handed back (as #4537 did for onUpdateError and
 *     onDeleteError): each of these services gives the lock back there.
 *
 *   - The event's current state - and what follows from it: an episode's
 *     resolvedAt, a maintenance event's next reminder - was written with the
 *     caller's props, after the timeline row was saved. A custom role that
 *     may create the state change but not edit the event saved the row and
 *     was then refused the event's own write: the event kept its old state
 *     (and, until the first fix, its lock). Those writes are derived from the
 *     timeline, which is the source of truth, so once the caller's create has
 *     passed its checks they are OneUptime's: the permission to create the
 *     timeline row is the permission to change the event's state.
 *
 * These run the real create pipeline - DatabaseService's checks, the hooks,
 * the save, the success hooks - over in-memory tables for the timeline and
 * for the event, with an in-memory lock. The event's update runs through the
 * real permission checks too; only its service's own update hooks are left
 * out, as they are about other writes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5f000000-0000-4000-8000-000000000002");
const EVENT_ID: ObjectID = new ObjectID("5f000000-0000-4000-8000-000000000003");
const PREVIOUS_ROW_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000004",
);

// Scheduled maintenance states, as its state reads answer them.
const SM_SCHEDULED_STATE_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-0000000000c1",
);
const SM_ONGOING_STATE_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-0000000000c2",
);
const SM_ENDED_STATE_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-0000000000c3",
);
const SM_COMPLETED_STATE_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-0000000000c4",
);

// Monitor statuses.
const OPERATIONAL_STATUS_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-0000000000d1",
);
const OFFLINE_STATUS_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-0000000000d2",
);

// The event was in its first state from 08:00, and moves on at 09:00.
const FIRST_STATE_AT: Date = new Date("2026-10-08T08:00:00.000Z");
const CHANGED_AT: Date = new Date("2026-10-08T09:00:00.000Z");
// When a maintenance event's next "before the event" reminder was due.
const NEXT_REMINDER_AT: Date = new Date("2026-10-09T08:00:00.000Z");

interface TimelineCase {
  // The event, as the tests name it.
  event: string;
  timelineService: DatabaseService<BaseModel>;
  eventService: DatabaseService<BaseModel>;
  // The namespace the change locks its event under.
  lockNamespace: string;
  // The event's column that holds its current state.
  currentStateColumn: string;
  // The state the event is in, and the one the change moves it to.
  fromStateId: ObjectID;
  toStateId: ObjectID;
  buildStateChange: () => BaseModel;
  // The event's first state, as its timeline holds it.
  previousRow: StoredRow;
  // The event, as its table holds it.
  eventRow: StoredRow;
  // Reads the event and creates its state changes, edits nothing.
  createOnlyRole: Array<Permission>;
  // Reads the event, and nothing else.
  readOnlyRole: Array<Permission>;
  // A lock that cannot be taken refuses the change (the monitor's).
  failsClosed: boolean;
  // What the success hooks read and write besides the two tables.
  stubSideEffects: () => void;
  // What else the event's own write sets, from the change, as stored.
  expectFollowOnColumns: (eventRow: StoredRow) => void;
}

// An incident: from Created to Acknowledged.
const INCIDENT_CASE: TimelineCase = {
  event: "an incident",
  timelineService:
    IncidentStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventService: IncidentService as unknown as DatabaseService<BaseModel>,
  lockNamespace: "IncidentStateTimeline.create",
  currentStateColumn: "currentIncidentStateId",
  fromStateId: INCIDENT_STATE_IDS.created,
  toStateId: INCIDENT_STATE_IDS.acknowledged,
  buildStateChange: (): BaseModel => {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.incidentId = EVENT_ID;
    timeline.incidentStateId = INCIDENT_STATE_IDS.acknowledged;
    timeline.startsAt = CHANGED_AT;
    return timeline;
  },
  previousRow: {
    _id: PREVIOUS_ROW_ID.toString(),
    projectId: PROJECT_ID.toString(),
    incidentId: EVENT_ID.toString(),
    incidentStateId: INCIDENT_STATE_IDS.created.toString(),
    startsAt: FIRST_STATE_AT,
  },
  eventRow: {
    _id: EVENT_ID.toString(),
    projectId: PROJECT_ID.toString(),
    title: "Checkout is down",
    currentIncidentStateId: INCIDENT_STATE_IDS.created.toString(),
  },
  createOnlyRole: [
    Permission.ReadProjectIncident,
    Permission.CreateIncidentStateTimeline,
  ],
  readOnlyRole: [Permission.ReadProjectIncident],
  failsClosed: false,
  stubSideEffects: (): void => {
    const states: Array<IncidentState> = makeIncidentStates();

    getJestSpyOn(IncidentStateService, "findOneBy").mockImplementation(
      async (findOneBy: unknown): Promise<IncidentState | null> => {
        const id: string = String(
          (findOneBy as { query: Dictionary<unknown> }).query["_id"],
        );

        return (
          states.find((state: IncidentState): boolean => {
            return state._id === id;
          }) || null
        );
      },
    );
    getJestSpyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
      number: 42,
      numberWithPrefix: "INC-42",
    });
    getJestSpyOn(
      IncidentService,
      "getIncidentLinkInDashboard",
    ).mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/incidents/42"),
    );
    getJestSpyOn(IncidentService, "refreshIncidentMetrics").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      IncidentMeasurementValueService,
      "recomputeForIncident",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentFeedService,
      "createIncidentFeedItem",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentAlertService,
      "cascadeIncidentStateToLinkedAlerts",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentStateTimelineService as never,
      "autoAssignIncidentCommander",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      IncidentStateTimelineService as never,
      "trackSlaStateChange",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      IncidentStateTimelineService as never,
      "isLastIncidentState",
    ).mockResolvedValue(false as never);
  },
  expectFollowOnColumns: (): void => {
    // The incident's current state is all its own write sets.
  },
};

// An alert: from Created to Acknowledged.
const ALERT_CASE: TimelineCase = {
  event: "an alert",
  timelineService:
    AlertStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventService: AlertService as unknown as DatabaseService<BaseModel>,
  lockNamespace: "AlertStateTimeline.create",
  currentStateColumn: "currentAlertStateId",
  fromStateId: ALERT_STATE_IDS.created,
  toStateId: ALERT_STATE_IDS.acknowledged,
  buildStateChange: (): BaseModel => {
    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.alertId = EVENT_ID;
    timeline.alertStateId = ALERT_STATE_IDS.acknowledged;
    timeline.startsAt = CHANGED_AT;
    return timeline;
  },
  previousRow: {
    _id: PREVIOUS_ROW_ID.toString(),
    projectId: PROJECT_ID.toString(),
    alertId: EVENT_ID.toString(),
    alertStateId: ALERT_STATE_IDS.created.toString(),
    startsAt: FIRST_STATE_AT,
  },
  eventRow: {
    _id: EVENT_ID.toString(),
    projectId: PROJECT_ID.toString(),
    title: "High CPU",
    currentAlertStateId: ALERT_STATE_IDS.created.toString(),
  },
  createOnlyRole: [Permission.ReadAlert, Permission.CreateAlertStateTimeline],
  readOnlyRole: [Permission.ReadAlert],
  failsClosed: false,
  stubSideEffects: (): void => {
    stubAlertStateReads();
    getJestSpyOn(AlertService, "getAlertNumber").mockResolvedValue({
      number: 7,
      numberWithPrefix: "ALT-7",
    });
    getJestSpyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/alerts/7"),
    );
    getJestSpyOn(AlertService, "refreshAlertMetrics").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      AlertMeasurementValueService,
      "recomputeForAlert",
    ).mockResolvedValue(undefined);
    getJestSpyOn(AlertFeedService, "createAlertFeedItem").mockResolvedValue(
      undefined,
    );
    getJestSpyOn(
      AlertStateTimelineService as never,
      "isLastAlertState",
    ).mockResolvedValue(false as never);
  },
  expectFollowOnColumns: (): void => {
    // The alert's current state is all its own write sets.
  },
};

// An alert episode: from Created to Resolved, which stamps its resolvedAt.
const ALERT_EPISODE_CASE: TimelineCase = {
  event: "an alert episode",
  timelineService:
    AlertEpisodeStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventService: AlertEpisodeService as unknown as DatabaseService<BaseModel>,
  lockNamespace: "AlertEpisodeStateTimeline.create",
  currentStateColumn: "currentAlertStateId",
  fromStateId: ALERT_STATE_IDS.created,
  toStateId: ALERT_STATE_IDS.resolved,
  buildStateChange: (): BaseModel => {
    const timeline: AlertEpisodeStateTimeline = new AlertEpisodeStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.alertEpisodeId = EVENT_ID;
    timeline.alertStateId = ALERT_STATE_IDS.resolved;
    timeline.startsAt = CHANGED_AT;
    return timeline;
  },
  previousRow: {
    _id: PREVIOUS_ROW_ID.toString(),
    projectId: PROJECT_ID.toString(),
    alertEpisodeId: EVENT_ID.toString(),
    alertStateId: ALERT_STATE_IDS.created.toString(),
    startsAt: FIRST_STATE_AT,
  },
  eventRow: {
    _id: EVENT_ID.toString(),
    projectId: PROJECT_ID.toString(),
    title: "Checkout alerts",
    episodeNumber: 3,
    episodeNumberWithPrefix: "AE-3",
    currentAlertStateId: ALERT_STATE_IDS.created.toString(),
  },
  createOnlyRole: [
    Permission.ReadAlertEpisode,
    Permission.CreateAlertEpisodeStateTimeline,
  ],
  readOnlyRole: [Permission.ReadAlertEpisode],
  failsClosed: false,
  stubSideEffects: (): void => {
    stubAlertStateReads();
    getJestSpyOn(
      AlertEpisodeService,
      "cascadeStateToMemberAlerts",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      AlertEpisodeFeedService,
      "createAlertEpisodeFeedItem",
    ).mockResolvedValue(undefined);
  },
  expectFollowOnColumns: (eventRow: StoredRow): void => {
    // Resolved now: its resolvedAt is stamped, by the same write.
    expect(eventRow["resolvedAt"]).toBeInstanceOf(Date);
  },
};

// An incident episode: from Created to Resolved, which stamps its resolvedAt.
const INCIDENT_EPISODE_CASE: TimelineCase = {
  event: "an incident episode",
  timelineService:
    IncidentEpisodeStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventService: IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
  lockNamespace: "IncidentEpisodeStateTimeline.create",
  currentStateColumn: "currentIncidentStateId",
  fromStateId: INCIDENT_STATE_IDS.created,
  toStateId: INCIDENT_STATE_IDS.resolved,
  buildStateChange: (): BaseModel => {
    const timeline: IncidentEpisodeStateTimeline =
      new IncidentEpisodeStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.incidentEpisodeId = EVENT_ID;
    timeline.incidentStateId = INCIDENT_STATE_IDS.resolved;
    timeline.startsAt = CHANGED_AT;
    return timeline;
  },
  previousRow: {
    _id: PREVIOUS_ROW_ID.toString(),
    projectId: PROJECT_ID.toString(),
    incidentEpisodeId: EVENT_ID.toString(),
    incidentStateId: INCIDENT_STATE_IDS.created.toString(),
    startsAt: FIRST_STATE_AT,
  },
  eventRow: {
    _id: EVENT_ID.toString(),
    projectId: PROJECT_ID.toString(),
    title: "Checkout incidents",
    episodeNumber: 5,
    episodeNumberWithPrefix: "IE-5",
    currentIncidentStateId: INCIDENT_STATE_IDS.created.toString(),
  },
  createOnlyRole: [
    Permission.ReadIncidentEpisode,
    Permission.CreateIncidentEpisodeStateTimeline,
  ],
  readOnlyRole: [Permission.ReadIncidentEpisode],
  failsClosed: false,
  stubSideEffects: (): void => {
    stubIncidentStateReads();
    getJestSpyOn(
      IncidentEpisodeService,
      "cascadeStateToMemberIncidents",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      IncidentEpisodeFeedService,
      "createIncidentEpisodeFeedItem",
    ).mockResolvedValue(undefined);
  },
  expectFollowOnColumns: (eventRow: StoredRow): void => {
    expect(eventRow["resolvedAt"]).toBeInstanceOf(Date);
  },
};

// A scheduled maintenance event: from Scheduled to Ongoing.
const SCHEDULED_MAINTENANCE_CASE: TimelineCase = {
  event: "a scheduled maintenance event",
  timelineService:
    ScheduledMaintenanceStateTimelineService as unknown as DatabaseService<BaseModel>,
  eventService:
    ScheduledMaintenanceService as unknown as DatabaseService<BaseModel>,
  lockNamespace: "ScheduledMaintenanceStateTimeline.create",
  currentStateColumn: "currentScheduledMaintenanceStateId",
  fromStateId: SM_SCHEDULED_STATE_ID,
  toStateId: SM_ONGOING_STATE_ID,
  buildStateChange: (): BaseModel => {
    const timeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.scheduledMaintenanceId = EVENT_ID;
    timeline.scheduledMaintenanceStateId = SM_ONGOING_STATE_ID;
    timeline.startsAt = CHANGED_AT;
    // Says nothing to subscribers, so no message goes with it.
    timeline.shouldStatusPageSubscribersBeNotified = false;
    return timeline;
  },
  previousRow: {
    _id: PREVIOUS_ROW_ID.toString(),
    projectId: PROJECT_ID.toString(),
    scheduledMaintenanceId: EVENT_ID.toString(),
    scheduledMaintenanceStateId: SM_SCHEDULED_STATE_ID.toString(),
    startsAt: FIRST_STATE_AT,
  },
  eventRow: {
    _id: EVENT_ID.toString(),
    projectId: PROJECT_ID.toString(),
    title: "Database upgrade",
    currentScheduledMaintenanceStateId: SM_SCHEDULED_STATE_ID.toString(),
    nextSubscriberNotificationBeforeTheEventAt: NEXT_REMINDER_AT,
  },
  createOnlyRole: [
    Permission.ReadProjectScheduledMaintenance,
    Permission.CreateScheduledMaintenanceStateTimeline,
  ],
  readOnlyRole: [Permission.ReadProjectScheduledMaintenance],
  failsClosed: false,
  stubSideEffects: (): void => {
    const states: Array<ScheduledMaintenanceState> = [
      maintenanceState(SM_SCHEDULED_STATE_ID, "Scheduled", 1),
      maintenanceState(SM_ONGOING_STATE_ID, "Ongoing", 2),
      maintenanceState(SM_ENDED_STATE_ID, "Ended", 3),
      maintenanceState(SM_COMPLETED_STATE_ID, "Completed", 4),
    ];

    /*
     * A state as its reads answer it: by id, and asked again with a flag
     * ({ isOngoingState: true }) to tell which kind it is.
     */
    getJestSpyOn(
      ScheduledMaintenanceStateService,
      "findOneBy",
    ).mockImplementation(
      async (findOneBy: unknown): Promise<ScheduledMaintenanceState | null> => {
        const query: Dictionary<unknown> = (
          findOneBy as { query: Dictionary<unknown> }
        ).query;

        const found: ScheduledMaintenanceState | undefined = states.find(
          (state: ScheduledMaintenanceState): boolean => {
            return state._id === String(query["_id"]);
          },
        );

        if (!found) {
          return null;
        }

        for (const flag of [
          "isScheduledState",
          "isOngoingState",
          "isEndedState",
          "isResolvedState",
        ]) {
          if (
            query[flag] !== undefined &&
            Boolean((found as unknown as Dictionary<unknown>)[flag]) !==
              query[flag]
          ) {
            return null;
          }
        }

        return found;
      },
    );
    getJestSpyOn(ScheduledMaintenanceStateService, "findBy").mockResolvedValue(
      states,
    );

    // The event, with nothing attached that its start would hold or release.
    getJestSpyOn(ScheduledMaintenanceService, "findOneBy").mockImplementation(
      async (): Promise<ScheduledMaintenance> => {
        const event: ScheduledMaintenance = new ScheduledMaintenance();
        event._id = EVENT_ID.toString();
        event.projectId = PROJECT_ID;
        event.monitors = [];
        event.networkSites = [];
        event.nextSubscriberNotificationBeforeTheEventAt = NEXT_REMINDER_AT;
        return event;
      },
    );
    getJestSpyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceNumber",
    ).mockResolvedValue({ number: 9, numberWithPrefix: "SM-9" });
    getJestSpyOn(
      ScheduledMaintenanceService,
      "getScheduledMaintenanceLinkInDashboard",
    ).mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/scheduled-events/9"),
    );
    getJestSpyOn(
      ScheduledMaintenanceFeedService,
      "createScheduledMaintenanceFeedItem",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      ScheduledMaintenanceMeasurementValueService,
      "recomputeForScheduledMaintenance",
    ).mockResolvedValue(undefined);
    getJestSpyOn(
      ScheduledMaintenanceStateTimelineService,
      "recomputeNetworkSiteRollups",
    ).mockResolvedValue(undefined);
  },
  expectFollowOnColumns: (eventRow: StoredRow): void => {
    // Under way now: no reminder "before the event" is due any more.
    expect(eventRow["nextSubscriberNotificationBeforeTheEventAt"]).toBeNull();
  },
};

// A monitor: from Operational to Offline. Its lock fails closed.
const MONITOR_CASE: TimelineCase = {
  event: "a monitor",
  timelineService:
    MonitorStatusTimelineService as unknown as DatabaseService<BaseModel>,
  eventService: MonitorService as unknown as DatabaseService<BaseModel>,
  lockNamespace: "MonitorStatusTimeline.create",
  currentStateColumn: "currentMonitorStatusId",
  fromStateId: OPERATIONAL_STATUS_ID,
  toStateId: OFFLINE_STATUS_ID,
  buildStateChange: (): BaseModel => {
    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.projectId = PROJECT_ID;
    timeline.monitorId = EVENT_ID;
    timeline.monitorStatusId = OFFLINE_STATUS_ID;
    timeline.startsAt = CHANGED_AT;
    return timeline;
  },
  previousRow: {
    _id: PREVIOUS_ROW_ID.toString(),
    projectId: PROJECT_ID.toString(),
    monitorId: EVENT_ID.toString(),
    monitorStatusId: OPERATIONAL_STATUS_ID.toString(),
    startsAt: FIRST_STATE_AT,
  },
  eventRow: {
    _id: EVENT_ID.toString(),
    projectId: PROJECT_ID.toString(),
    name: "Checkout API",
    currentMonitorStatusId: OPERATIONAL_STATUS_ID.toString(),
  },
  createOnlyRole: [
    Permission.ReadProjectMonitor,
    Permission.CreateMonitorStatusTimeline,
  ],
  readOnlyRole: [Permission.ReadProjectMonitor],
  failsClosed: true,
  stubSideEffects: (): void => {
    // What follows the change once the lock is given back.
    getJestSpyOn(
      MonitorStatusTimelineService as never,
      "bridgeCurrentStatusToNetworkSites",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(
      MonitorStatusTimelineService as never,
      "createStatusChangeFeedItem",
    ).mockResolvedValue(undefined as never);
  },
  expectFollowOnColumns: (): void => {
    // The monitor's current status is all its own write sets.
  },
};

const TIMELINE_CASES: Array<[string, TimelineCase]> = [
  INCIDENT_CASE,
  ALERT_CASE,
  ALERT_EPISODE_CASE,
  INCIDENT_EPISODE_CASE,
  SCHEDULED_MAINTENANCE_CASE,
  MONITOR_CASE,
].map((timelineCase: TimelineCase): [string, TimelineCase] => {
  return [timelineCase.event, timelineCase];
});

function maintenanceState(
  id: ObjectID,
  name: string,
  order: number,
): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = id.toString();
  state.projectId = PROJECT_ID;
  state.name = name;
  state.order = order;
  state.isScheduledState = id.toString() === SM_SCHEDULED_STATE_ID.toString();
  state.isOngoingState = id.toString() === SM_ONGOING_STATE_ID.toString();
  state.isEndedState = id.toString() === SM_ENDED_STATE_ID.toString();
  state.isResolvedState = id.toString() === SM_COMPLETED_STATE_ID.toString();
  return state;
}

// An alert state, as its reads answer it by id.
function stubAlertStateReads(): void {
  const states: Array<AlertState> = makeAlertStates();

  getJestSpyOn(AlertStateService, "findOneBy").mockImplementation(
    async (findOneBy: unknown): Promise<AlertState | null> => {
      const id: string = String(
        (findOneBy as { query: Dictionary<unknown> }).query["_id"],
      );

      return (
        states.find((state: AlertState): boolean => {
          return state._id === id;
        }) || null
      );
    },
  );
}

// An incident state, as its reads answer it by id.
function stubIncidentStateReads(): void {
  const states: Array<IncidentState> = makeIncidentStates();

  getJestSpyOn(IncidentStateService, "findOneBy").mockImplementation(
    async (findOneBy: unknown): Promise<IncidentState | null> => {
      const id: string = String(
        (findOneBy as { query: Dictionary<unknown> }).query["_id"],
      );

      return (
        states.find((state: IncidentState): boolean => {
          return state._id === id;
        }) || null
      );
    },
  );
}

function userPermission(permission: Permission): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
  };
}

// A member of the project with these permissions, asking in it.
function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map(userPermission),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    ...ON_HIGHEST_PLAN,
  };
}

// Someone who may change every state of the project's events.
function projectMemberProps(): DatabaseCommonInteractionProps {
  return memberProps([Permission.ProjectMember]);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

/*
 * The event's lock, held in memory as Valkey holds it: one holder per key.
 * A key that is held already is waited out - redis-semaphore's acquire
 * timeout - and refused; the services log that and, all but the monitor's,
 * go ahead unlocked. Every such wait is recorded.
 */
interface InMemoryLock {
  name: string;
}

let held: Map<string, InMemoryLock>;
let waitedOut: Array<string>;
let lock: ReturnType<typeof getJestSpyOn>;
let release: ReturnType<typeof getJestSpyOn>;

function lockName(timelineCase: TimelineCase): string {
  return `${timelineCase.lockNamespace}-${EVENT_ID.toString()}`;
}

beforeEach(() => {
  held = new Map<string, InMemoryLock>();
  waitedOut = [];

  lock = getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }): Promise<InMemoryLock> => {
    const name: string = `${data.namespace}-${data.key}`;

    if (held.has(name)) {
      waitedOut.push(name);
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${name} timeout`);
    }

    const mutex: InMemoryLock = { name: name };
    held.set(name, mutex);
    return mutex;
  }) as never);

  release = getJestSpyOn(Semaphore, "release").mockImplementation((async (
    mutex: InMemoryLock,
  ): Promise<void> => {
    // As redis-semaphore does: only the holder's own lock, and once.
    if (held.get(mutex.name) === mutex) {
      held.delete(mutex.name);
    }
  }) as never);

  /*
   * The records a change names are the project's, and the event it is made
   * to is one the caller may read (CreatePermission.checkParentPermission).
   */
  stubProjectDirectory({});
  stubReadableParents();
  mockProjectStates();

  getJestSpyOn(UserService, "getUserMarkdownString").mockResolvedValue(
    FeedMarkdown.asMarkdown("[Ada Lovelace](mailto:ada@example.com)"),
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(TIMELINE_CASES)(
  "a state change to %s",
  (_event: string, timelineCase: TimelineCase) => {
    let timelines: InMemoryTable;
    let events: InMemoryTable;

    beforeEach(() => {
      timelines = useInMemoryTable(timelineCase.timelineService, [
        timelineCase.previousRow,
      ]);
      events = useInMemoryTable(timelineCase.eventService, [
        timelineCase.eventRow,
      ]);

      /*
       * The event's own update hooks are about other writes - an edit of
       * its title, its monitors, its custom fields - and are left out: the
       * update's permission checks, its read and its write all run.
       */
      getJestSpyOn(
        timelineCase.eventService as never,
        "onBeforeUpdate",
      ).mockImplementation((async (updateBy: unknown) => {
        return { updateBy: updateBy, carryForward: null };
      }) as never);
      getJestSpyOn(
        timelineCase.eventService as never,
        "onUpdateSuccess",
      ).mockImplementation((async (onUpdate: unknown) => {
        return onUpdate;
      }) as never);

      timelineCase.stubSideEffects();
    });

    async function changeState(
      props: DatabaseCommonInteractionProps,
    ): Promise<BaseModel> {
      return timelineCase.timelineService.create({
        data: timelineCase.buildStateChange(),
        props: props,
      });
    }

    function eventState(): string {
      return String(events.get(EVENT_ID)![timelineCase.currentStateColumn]);
    }

    describe("a change that fails gives the event's lock back", () => {
      /*
       * Each check DatabaseService.create runs after onBeforeCreate took the
       * lock, refusing: the change is not saved, the lock is given back, and
       * the next change to the event takes it at once.
       */
      const REFUSALS: Array<[string, () => void]> = [
        [
          "a clash check after the hook (onBeforeCreateUniqueCheck)",
          (): void => {
            getJestSpyOn(
              timelineCase.timelineService as never,
              "onBeforeCreateUniqueCheck",
            ).mockRejectedValueOnce(
              new BadDataException(
                "This state change clashes with another.",
              ) as never,
            );
          },
        ],
        [
          "the last hook before the write (onCreatePermitted)",
          (): void => {
            getJestSpyOn(
              timelineCase.timelineService as never,
              "onCreatePermitted",
            ).mockRejectedValueOnce(
              new BadDataException(
                "This state change clashes with another.",
              ) as never,
            );
          },
        ],
        [
          "the serializing of the row (sanitizeCreateOrUpdate)",
          (): void => {
            getJestSpyOn(
              timelineCase.timelineService as never,
              "sanitizeCreateOrUpdate",
            ).mockRejectedValueOnce(
              new BadDataException(
                "This state change clashes with another.",
              ) as never,
            );
          },
        ],
        [
          "the check that the write inserts (assertCreateWillInsert)",
          (): void => {
            getJestSpyOn(
              timelineCase.timelineService as never,
              "assertCreateWillInsert",
            ).mockImplementationOnce((() => {
              throw new BadDataException(
                "This state change clashes with another.",
              );
            }) as never);
          },
        ],
      ];

      test.each(REFUSALS)(
        "refused by %s: nothing is saved, and the next change takes the lock at once",
        async (_refusal: string, refuse: () => void) => {
          refuse();

          const error: unknown = await rejectionOf(
            changeState(projectMemberProps()),
          );

          expect((error as Error).message).toBe(
            "This state change clashes with another.",
          );
          expect(timelines.inserts).toEqual([]);
          expect(eventState()).toBe(timelineCase.fromStateId.toString());

          // Taken, and given back.
          expect(lock).toHaveBeenCalledTimes(1);
          expect(Array.from(held.keys())).toEqual([]);

          // The next change to the event is not kept waiting.
          await changeState(projectMemberProps());

          expect(waitedOut).toEqual([]);
          expect(timelines.inserts).toHaveLength(1);
          expect(eventState()).toBe(timelineCase.toStateId.toString());
          expect(Array.from(held.keys())).toEqual([]);
        },
      );

      test("its insert fails: the lock is given back, and the next change takes it at once", async () => {
        timelines.repository.save.mockRejectedValueOnce(
          new Error("The database went away."),
        );

        const error: unknown = await rejectionOf(
          changeState(projectMemberProps()),
        );

        expect((error as Error).message).toBe("The database went away.");
        expect(timelines.inserts).toEqual([]);
        expect(Array.from(held.keys())).toEqual([]);

        await changeState(projectMemberProps());

        expect(waitedOut).toEqual([]);
        expect(eventState()).toBe(timelineCase.toStateId.toString());
      });

      test("saved, but the event's own write fails: the lock is given back all the same", async () => {
        getJestSpyOn(
          timelineCase.eventService,
          "updateOneBy",
        ).mockRejectedValueOnce(new Error("The database went away.") as never);

        const error: unknown = await rejectionOf(
          changeState(projectMemberProps()),
        );

        expect((error as Error).message).toBe("The database went away.");
        expect(Array.from(held.keys())).toEqual([]);
        expect(waitedOut).toEqual([]);
      });

      test("refused in onBeforeCreate itself, once the lock is taken: given back too", async () => {
        // The event is in that state already.
        timelines.rows[0]![
          Object.keys(timelineCase.previousRow).find((column: string) => {
            return column.endsWith("StateId") || column.endsWith("StatusId");
          })!
        ] = timelineCase.toStateId.toString();

        const error: unknown = await rejectionOf(
          changeState(projectMemberProps()),
        );

        expect(error).toBeInstanceOf(BadDataException);
        expect(timelines.inserts).toEqual([]);
        expect(Array.from(held.keys())).toEqual([]);
      });
    });

    describe("a change that is saved", () => {
      test("gives the lock back once, after writing the event's current state", async () => {
        await changeState(projectMemberProps());

        expect(timelines.inserts).toHaveLength(1);
        expect(eventState()).toBe(timelineCase.toStateId.toString());
        expect(lock).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
        expect(Array.from(held.keys())).toEqual([]);
      });

      test("a second change to the same event takes the lock at once", async () => {
        await changeState(projectMemberProps());

        // The first change took the event's own lock, and gave it back.
        expect(lock).toHaveBeenCalledWith(
          expect.objectContaining({
            key: EVENT_ID.toString(),
            namespace: timelineCase.lockNamespace,
          }),
        );
        expect(held.has(lockName(timelineCase))).toBe(false);
        lock.mockClear();

        // Back to the first state, later on.
        const back: BaseModel = timelineCase.buildStateChange();
        (back as unknown as StoredRow)[
          Object.keys(timelineCase.previousRow).find((column: string) => {
            return column.endsWith("StateId") || column.endsWith("StatusId");
          })!
        ] = timelineCase.fromStateId;
        (back as unknown as StoredRow)["startsAt"] = new Date(
          "2026-10-08T10:00:00.000Z",
        );

        await timelineCase.timelineService.create({
          data: back,
          props: projectMemberProps(),
        });

        expect(waitedOut).toEqual([]);
        expect(lock).toHaveBeenCalledTimes(1);
      });
    });

    describe("the event's state follows its timeline", () => {
      test("a role that may create the state change but not edit the event changes its state: the event follows", async () => {
        await changeState(memberProps(timelineCase.createOnlyRole));

        expect(timelines.inserts).toHaveLength(1);
        expect(eventState()).toBe(timelineCase.toStateId.toString());
        timelineCase.expectFollowOnColumns(events.get(EVENT_ID)!);
        expect(Array.from(held.keys())).toEqual([]);
      });

      test("the event's own write is OneUptime's, named for the person who changed the state", async () => {
        const update: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
          timelineCase.eventService,
          "updateOneBy",
        );

        await changeState(memberProps(timelineCase.createOnlyRole));

        const props: DatabaseCommonInteractionProps = (
          update.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps }
        ).props;

        expect(props.isRoot).toBe(true);
        // For the audit trail: who changed it.
        expect(props.userId?.toString()).toBe(USER_ID.toString());
        expect(props.userType).toBe(UserType.User);
        // A write OneUptime makes itself, not one made in a project.
        expect(props.tenantId).toBeUndefined();
        // Nothing of the caller's permissions travels with it.
        expect(props.userTenantAccessPermission).toBeUndefined();
      });

      test("a role that may only read the event is refused before anything is saved or locked", async () => {
        const error: unknown = await rejectionOf(
          changeState(memberProps(timelineCase.readOnlyRole)),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(timelines.inserts).toEqual([]);
        expect(eventState()).toBe(timelineCase.fromStateId.toString());
        expect(lock).not.toHaveBeenCalled();
      });

      test("OneUptime's own change moves the event as before", async () => {
        await changeState({ isRoot: true });

        expect(eventState()).toBe(timelineCase.toStateId.toString());
        timelineCase.expectFollowOnColumns(events.get(EVENT_ID)!);
      });
    });

    if (timelineCase.failsClosed) {
      test("a lock that cannot be taken refuses the change, and nothing is saved", async () => {
        lock.mockRejectedValue(new Error("Valkey is unreachable.") as never);

        const error: unknown = await rejectionOf(
          changeState(projectMemberProps()),
        );

        expect(error).toBeInstanceOf(ServerException);
        expect((error as Error).message).toBe(
          MONITOR_STATUS_TIMELINE_LOCK_ERROR_MESSAGE,
        );
        expect(timelines.inserts).toEqual([]);
        expect(release).not.toHaveBeenCalled();
      });
    } else {
      test("a lock that cannot be taken lets the change go ahead, as before", async () => {
        lock.mockRejectedValue(new Error("Valkey is unreachable.") as never);

        await changeState(projectMemberProps());

        expect(timelines.inserts).toHaveLength(1);
        expect(eventState()).toBe(timelineCase.toStateId.toString());
        expect(release).not.toHaveBeenCalled();
      });
    }
  },
);
