import AlertFeedService from "../../Services/AlertFeedService";
import AlertService from "../../Services/AlertService";
import AlertSeverityService from "../../Services/AlertSeverityService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import DashboardService from "../../Services/DashboardService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentPostmortemStatusService from "../../Services/IncidentPostmortemStatusService";
import IncidentPublicNoteService from "../../Services/IncidentPublicNoteService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import MetricTypeService from "../../Services/MetricTypeService";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleUserService from "../../Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleLayerService from "../../Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import OpenTelemetryIngestService, {
  TelemetryServiceMetadata,
} from "../../Services/OpenTelemetryIngestService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import AcknowledgedStateUtil from "../../../Utils/AcknowledgedState";
import ResolvedStateUtil from "../../../Utils/ResolvedState";
import ScheduledMaintenanceStartUtil from "../../../Utils/ScheduledMaintenanceStart";
import { StateListType } from "../../../Utils/StateOrder";
import ScheduledMaintenanceStateTimelineService from "../../Services/ScheduledMaintenanceStateTimelineService";
import ServiceLevelObjectiveService from "../../Services/ServiceLevelObjectiveService";
import ServiceService from "../../Services/ServiceService";
import StatusPageGroupService from "../../Services/StatusPageGroupService";
import StatusPageResourceService from "../../Services/StatusPageResourceService";
import StatusPageService from "../../Services/StatusPageService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import UserService from "../../Services/UserService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SampleProjectTelemetry, {
  SAMPLE_SERVICE_METRICS,
  SampleTelemetryMonitor,
  SampleTelemetryRows,
} from "./SampleProjectTelemetry";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../Models/DatabaseModels/AlertFeed";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import { Blue500, Gray500, Green500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { DashboardTemplateType } from "../../../Types/Dashboard/DashboardTemplates";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Port from "../../../Types/Port";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  SAMPLE_PEOPLE,
  SamplePerson,
  getSamplePersonEmail,
} from "../../../Types/SampleProject/SampleProject";
import {
  SAMPLE_ALERTS,
  SAMPLE_DASHBOARD,
  SAMPLE_INCIDENTS,
  SAMPLE_MAINTENANCE,
  SAMPLE_MONITOR_HISTORY_DAYS,
  SAMPLE_MONITORS,
  SAMPLE_ON_CALL,
  SAMPLE_SERVICE,
  SAMPLE_SLO,
  SAMPLE_STATUS_PAGE,
  SAMPLE_STATUS_PAGE_GROUPS,
  MINUTES_IN_A_DAY,
  SampleAlert,
  SampleAlertSeverity,
  SampleAlertState,
  SampleIncident,
  SampleIncidentSeverity,
  SampleIncidentState,
  SampleMonitor,
  SampleMonitorOutage,
  SampleMonitorStatus,
  SampleNote,
} from "../../../Types/SampleProject/SampleProjectContent";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import NumberPrefixUtil from "../../../Utils/Project/NumberPrefix";

/*
 * FILLS A SAMPLE PROJECT (issue #6808) with the story of
 * Types/SampleProject/SampleProjectContent: its people, monitors and their
 * thirty days, incidents, alerts, the on-call policy and the run it made,
 * the status page, a maintenance window, the service with its telemetry,
 * an SLO and a dashboard.
 *
 * Every record is written as OneUptime (root) WITHOUT HOOKS, on purpose: a
 * hook would do what a real record does - page the on-call policy, email
 * the owners, post to a workspace, count a milestone, ask the payment
 * provider - and a sample must do none of it. What the hooks would have
 * worked out (numbers, states, the feed) is written here instead - a
 * number taken from its record's own service, the one place each kind
 * is numbered - and every "notified" flag says done, so no job picks a
 * sample record up later.
 * (The flag's readers refuse it anyway: this is the first of two.)
 *
 * Every moment is minutes before `now`, the moment the sample is made.
 */

const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
  ignoreHooks: true,
};

// What the sample's web monitors usually answer in, in milliseconds.
const BASE_RESPONSE_TIME_IN_MS: Record<string, number> = {
  storefront: 240,
  checkout: 320,
  "product-images": 90,
  "payments-api": 180,
  "search-api": 140,
};

export interface SampleProjectSeedResult {
  personIds: Array<ObjectID>;
  monitorIds: Record<string, ObjectID>;
  incidentIds: Record<string, ObjectID>;
  alertIds: Record<string, ObjectID>;
  onCallPolicyId: ObjectID;
  onCallScheduleId: ObjectID;
  statusPageId: ObjectID;
  scheduledMaintenanceId: ObjectID;
  serviceId: ObjectID;
  sloId: ObjectID;
  dashboardId: ObjectID;
  telemetryRowCount: number;
}

interface SampleProjectDefaults {
  monitorStatusIds: Record<SampleMonitorStatus, ObjectID>;
  incidentStateIds: Record<SampleIncidentState, ObjectID>;
  incidentStateColors: Record<SampleIncidentState, Color | undefined>;
  incidentSeverityIds: Record<SampleIncidentSeverity, ObjectID>;
  alertStateIds: Record<SampleAlertState, ObjectID>;
  alertSeverityIds: Record<SampleAlertSeverity, ObjectID>;
  scheduledMaintenanceStateId: ObjectID;
  postmortemNotStartedStatusId: ObjectID | null;
  postmortemCompletedStatusId: ObjectID | null;
  membersTeamId: ObjectID;
}

const minutesAgo: (now: Date, minutes: number) => Date = (
  now: Date,
  minutes: number,
): Date => {
  return new Date(now.getTime() - minutes * 60 * 1000);
};

const required: <T>(value: T | null | undefined, what: string) => T = <T>(
  value: T | null | undefined,
  what: string,
): T => {
  if (value === null || value === undefined) {
    throw new BadDataException(
      `The sample project could not be filled: its ${what} is missing. Delete the sample and try again.`,
    );
  }

  return value;
};

export default class SampleProjectSeeder {
  public static async seed(data: {
    projectId: ObjectID;
    ownerUserId: ObjectID;
    now: Date;
  }): Promise<SampleProjectSeedResult> {
    const projectId: ObjectID = data.projectId;
    const now: Date = data.now;

    const defaults: SampleProjectDefaults =
      await SampleProjectSeeder.readDefaults(projectId);

    const people: Record<string, ObjectID> =
      await SampleProjectSeeder.createPeople({
        projectId: projectId,
        teamId: defaults.membersTeamId,
        now: now,
      });

    const personIdOf: (handle: string | null) => ObjectID = (
      handle: string | null,
    ): ObjectID => {
      return handle
        ? required(people[handle], `person ${handle}`)
        : data.ownerUserId;
    };

    const monitorIds: Record<string, ObjectID> =
      await SampleProjectSeeder.createMonitors({
        projectId: projectId,
        defaults: defaults,
        now: now,
      });

    const onCall: {
      policyId: ObjectID;
      scheduleId: ObjectID;
      firstLevelId: ObjectID;
    } = await SampleProjectSeeder.createOnCall({
      projectId: projectId,
      personIdOf: personIdOf,
      now: now,
    });

    const incidentIds: Record<string, ObjectID> = {};

    for (const incident of SAMPLE_INCIDENTS) {
      incidentIds[incident.key] = await SampleProjectSeeder.createIncident({
        projectId: projectId,
        incident: incident,
        defaults: defaults,
        monitorIds: monitorIds,
        personIdOf: personIdOf,
        onCall: onCall,
        now: now,
      });
    }

    const alertIds: Record<string, ObjectID> = {};

    for (const alert of SAMPLE_ALERTS) {
      alertIds[alert.key] = await SampleProjectSeeder.createAlert({
        projectId: projectId,
        alert: alert,
        defaults: defaults,
        monitorIds: monitorIds,
        now: now,
      });
    }

    const statusPageId: ObjectID = await SampleProjectSeeder.createStatusPage({
      projectId: projectId,
      monitorIds: monitorIds,
      now: now,
    });

    const scheduledMaintenanceId: ObjectID =
      await SampleProjectSeeder.createMaintenance({
        projectId: projectId,
        defaults: defaults,
        monitorIds: monitorIds,
        statusPageId: statusPageId,
        now: now,
      });

    const telemetry: {
      serviceId: ObjectID;
      rowCount: number;
    } = await SampleProjectSeeder.createServiceAndTelemetry({
      projectId: projectId,
      monitorIds: monitorIds,
      now: now,
    });

    const sloId: ObjectID = await SampleProjectSeeder.createSlo({
      projectId: projectId,
      defaults: defaults,
      monitorIds: monitorIds,
      now: now,
    });

    const dashboard: Dashboard = new Dashboard();
    dashboard.projectId = projectId;
    dashboard.name = SAMPLE_DASHBOARD.name;
    dashboard.description = SAMPLE_DASHBOARD.description;
    required(
      DashboardService.applyTemplate(dashboard, DashboardTemplateType.Metrics),
      "dashboard template",
    );

    const createdDashboard: Dashboard = await DashboardService.create({
      data: dashboard,
      props: ROOT,
    });

    return {
      personIds: Object.values(people),
      monitorIds: monitorIds,
      incidentIds: incidentIds,
      alertIds: alertIds,
      onCallPolicyId: onCall.policyId,
      onCallScheduleId: onCall.scheduleId,
      statusPageId: statusPageId,
      scheduledMaintenanceId: scheduledMaintenanceId,
      serviceId: telemetry.serviceId,
      sloId: sloId,
      dashboardId: required(createdDashboard.id, "dashboard"),
      telemetryRowCount: telemetry.rowCount,
    };
  }

  // The states, severities, statuses and team every project starts with.
  public static async readDefaults(
    projectId: ObjectID,
  ): Promise<SampleProjectDefaults> {
    const [
      monitorStatuses,
      incidentStates,
      incidentSeverities,
      alertStates,
      alertSeverities,
      maintenanceStates,
      postmortemStatuses,
      teams,
    ]: [
      Array<MonitorStatus>,
      Array<IncidentState>,
      Array<IncidentSeverity>,
      Array<AlertState>,
      Array<AlertSeverity>,
      Array<ScheduledMaintenanceState>,
      Array<IncidentPostmortemStatus>,
      Array<Team>,
    ] = await Promise.all([
      MonitorStatusService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          name: true,
          isOperationalState: true,
          isOfflineState: true,
        },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
      IncidentStateService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          name: true,
          color: true,
          isCreatedState: true,
          isAcknowledgedState: true,
          isResolvedState: true,
          order: true,
        },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
      IncidentSeverityService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
      AlertStateService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          name: true,
          isCreatedState: true,
          isAcknowledgedState: true,
          isResolvedState: true,
          order: true,
        },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
      AlertSeverityService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
      ScheduledMaintenanceStateService.findBy({
        query: { projectId: projectId },
        select: { _id: true, isScheduledState: true, order: true },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
      IncidentPostmortemStatusService.findBy({
        query: { projectId: projectId },
        select: {
          _id: true,
          isNotStartedStatus: true,
          isCompletedStatus: true,
        },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
      TeamService.findBy({
        query: { projectId: projectId },
        select: { _id: true, name: true },
        skip: 0,
        limit: 50,
        props: ROOT,
      }),
    ]);

    const byName: <
      T extends { name?: string | undefined; id: ObjectID | null },
    >(
      rows: Array<T>,
      name: string,
      what: string,
    ) => ObjectID = <
      T extends { name?: string | undefined; id: ObjectID | null },
    >(
      rows: Array<T>,
      name: string,
      what: string,
    ): ObjectID => {
      return required(
        rows.find((row: T): boolean => {
          return row.name === name;
        })?.id,
        what,
      );
    };

    const incidentState: (
      predicate: (state: IncidentState) => boolean,
      what: string,
    ) => IncidentState = (
      predicate: (state: IncidentState) => boolean,
      what: string,
    ): IncidentState => {
      return required(incidentStates.find(predicate), what);
    };

    const identified: IncidentState = incidentState((state: IncidentState) => {
      return Boolean(state.isCreatedState);
    }, "incident state Identified");
    /*
     * THE acknowledged and THE resolved state: the first from the top so
     * flagged, the ones Acknowledge and Resolve move a record into
     * (Common/Utils/AcknowledgedState, ResolvedState). Never a flag read
     * here: OneAcknowledgedRuleGuard and OneResolvedRuleGuard.
     */
    const acknowledged: IncidentState = required(
      AcknowledgedStateUtil.getAcknowledgedState({
        list: StateListType.IncidentState,
        states: incidentStates,
      }),
      "incident state Acknowledged",
    );
    const resolved: IncidentState = required(
      ResolvedStateUtil.getResolvedState({
        list: StateListType.IncidentState,
        states: incidentStates,
      }),
      "incident state Resolved",
    );

    const alertState: (
      predicate: (state: AlertState) => boolean,
      what: string,
    ) => ObjectID = (
      predicate: (state: AlertState) => boolean,
      what: string,
    ): ObjectID => {
      return required(alertStates.find(predicate)?.id, what);
    };

    return {
      monitorStatusIds: {
        [SampleMonitorStatus.Operational]: required(
          monitorStatuses.find((status: MonitorStatus): boolean => {
            return Boolean(status.isOperationalState);
          })?.id,
          "monitor status Operational",
        ),
        [SampleMonitorStatus.Degraded]: byName(
          monitorStatuses,
          SampleMonitorStatus.Degraded,
          "monitor status Degraded",
        ),
        [SampleMonitorStatus.Offline]: required(
          monitorStatuses.find((status: MonitorStatus): boolean => {
            return Boolean(status.isOfflineState);
          })?.id,
          "monitor status Offline",
        ),
      },
      incidentStateIds: {
        [SampleIncidentState.Identified]: required(
          identified.id,
          "incident state",
        ),
        [SampleIncidentState.Acknowledged]: required(
          acknowledged.id,
          "incident state",
        ),
        [SampleIncidentState.Resolved]: required(resolved.id, "incident state"),
      },
      incidentStateColors: {
        [SampleIncidentState.Identified]: identified.color,
        [SampleIncidentState.Acknowledged]: acknowledged.color,
        [SampleIncidentState.Resolved]: resolved.color,
      },
      incidentSeverityIds: {
        [SampleIncidentSeverity.Critical]: byName(
          incidentSeverities,
          SampleIncidentSeverity.Critical,
          "incident severity",
        ),
        [SampleIncidentSeverity.Major]: byName(
          incidentSeverities,
          SampleIncidentSeverity.Major,
          "incident severity",
        ),
        [SampleIncidentSeverity.Minor]: byName(
          incidentSeverities,
          SampleIncidentSeverity.Minor,
          "incident severity",
        ),
      },
      alertStateIds: {
        [SampleAlertState.Identified]: alertState((state: AlertState) => {
          return Boolean(state.isCreatedState);
        }, "alert state Identified"),
        [SampleAlertState.Acknowledged]: required(
          AcknowledgedStateUtil.getAcknowledgedState({
            list: StateListType.AlertState,
            states: alertStates,
          })?.id,
          "alert state Acknowledged",
        ),
        [SampleAlertState.Resolved]: required(
          ResolvedStateUtil.getResolvedState({
            list: StateListType.AlertState,
            states: alertStates,
          })?.id,
          "alert state Resolved",
        ),
      },
      alertSeverityIds: {
        [SampleAlertSeverity.High]: byName(
          alertSeverities,
          SampleAlertSeverity.High,
          "alert severity",
        ),
        [SampleAlertSeverity.Low]: byName(
          alertSeverities,
          SampleAlertSeverity.Low,
          "alert severity",
        ),
      },
      // THE scheduled state, the one a new event is created in.
      scheduledMaintenanceStateId: required(
        ScheduledMaintenanceStartUtil.getScheduledState({
          states: maintenanceStates,
        })?.id,
        "maintenance state Scheduled",
      ),
      postmortemNotStartedStatusId:
        postmortemStatuses.find((status: IncidentPostmortemStatus): boolean => {
          return Boolean(status.isNotStartedStatus);
        })?.id || null,
      postmortemCompletedStatusId:
        postmortemStatuses.find((status: IncidentPostmortemStatus): boolean => {
          return Boolean(status.isCompletedStatus);
        })?.id || null,
      membersTeamId: byName(teams, "Members", "Members team"),
    };
  }

  /*
   * THE SAMPLE PEOPLE (User.sampleProjectId): blocked, with no password, an
   * address on the reserved .invalid domain and no notification method or
   * rule, members of this sample alone - written without hooks, so no
   * invitation and no default rules are made for them.
   */
  public static async createPeople(data: {
    projectId: ObjectID;
    teamId: ObjectID;
    now: Date;
  }): Promise<Record<string, ObjectID>> {
    const people: Record<string, ObjectID> = {};

    for (const person of SAMPLE_PEOPLE) {
      const user: User = SampleProjectSeeder.buildPerson({
        person: person,
        projectId: data.projectId,
      });

      const createdUser: User = await UserService.create({
        data: user,
        props: ROOT,
      });

      const userId: ObjectID = required(createdUser.id, "person");

      const member: TeamMember = new TeamMember();
      member.projectId = data.projectId;
      member.teamId = data.teamId;
      member.userId = userId;
      member.hasAcceptedInvitation = true;
      member.invitationAcceptedAt = data.now;

      await TeamMemberService.create({ data: member, props: ROOT });

      people[person.handle] = userId;
    }

    return people;
  }

  // A sample person, as a User row that can never sign in or be reached.
  public static buildPerson(data: {
    person: SamplePerson;
    projectId: ObjectID;
  }): User {
    const user: User = new User();
    user.name = new Name(data.person.name);
    user.email = new Email(
      getSamplePersonEmail({
        handle: data.person.handle,
        projectId: data.projectId.toString(),
      }),
    );
    user.isBlocked = true;
    user.isEmailVerified = false;
    user.isMasterAdmin = false;
    user.sampleProjectId = data.projectId;

    return user;
  }

  private static async createMonitors(data: {
    projectId: ObjectID;
    defaults: SampleProjectDefaults;
    now: Date;
  }): Promise<Record<string, ObjectID>> {
    const monitorIds: Record<string, ObjectID> = {};
    const historyStartsAt: Date = minutesAgo(
      data.now,
      SAMPLE_MONITOR_HISTORY_DAYS * MINUTES_IN_A_DAY,
    );

    for (const sample of SAMPLE_MONITORS) {
      const currentOutage: SampleMonitorOutage | undefined =
        sample.outages.find((outage: SampleMonitorOutage): boolean => {
          return outage.endsMinutesAgo === null;
        });

      const monitor: Monitor = new Monitor();
      monitor.projectId = data.projectId;
      monitor.name = sample.name;
      monitor.description = sample.description;
      monitor.monitorType = sample.monitorType;
      monitor.currentMonitorStatusId =
        data.defaults.monitorStatusIds[
          currentOutage?.status || SampleMonitorStatus.Operational
        ];
      monitor.monitorSteps = SampleProjectSeeder.buildMonitorSteps({
        sample: sample,
        defaults: data.defaults,
      });
      monitor.isOwnerNotifiedOfResourceCreation = true;

      if (sample.monitorType === MonitorType.IncomingRequest) {
        monitor.incomingRequestSecretKey = ObjectID.generate();
      }

      const createdMonitor: Monitor = await MonitorService.create({
        data: monitor,
        props: ROOT,
      });

      const monitorId: ObjectID = required(createdMonitor.id, "monitor");

      await SampleProjectSeeder.backdate(
        MonitorService,
        monitorId,
        historyStartsAt,
      );

      // Its thirty days: Operational, but for its outages.
      for (const period of SampleProjectSeeder.getStatusPeriods({
        sample: sample,
        now: data.now,
      })) {
        const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
        timeline.projectId = data.projectId;
        timeline.monitorId = monitorId;
        timeline.monitorStatusId =
          data.defaults.monitorStatusIds[period.status];
        timeline.startsAt = period.startsAt;
        if (period.endsAt) {
          timeline.endsAt = period.endsAt;
        }
        timeline.isOwnerNotified = true;
        if (period.rootCause) {
          timeline.rootCause = period.rootCause;
        }

        const createdTimeline: MonitorStatusTimeline =
          await MonitorStatusTimelineService.create({
            data: timeline,
            props: ROOT,
          });

        await SampleProjectSeeder.backdate(
          MonitorStatusTimelineService,
          required(createdTimeline.id, "monitor status timeline"),
          period.startsAt,
        );
      }

      monitorIds[sample.key] = monitorId;
    }

    return monitorIds;
  }

  // A monitor's default criteria, with its address.
  public static buildMonitorSteps(data: {
    sample: SampleMonitor;
    defaults: SampleProjectDefaults;
  }): MonitorSteps {
    const operationalId: ObjectID =
      data.defaults.monitorStatusIds[SampleMonitorStatus.Operational];

    const monitorSteps: MonitorSteps = MonitorSteps.getDefaultMonitorSteps({
      defaultMonitorStatusId: operationalId,
      monitorType: data.sample.monitorType,
      monitorName: data.sample.name,
      onlineMonitorStatusId: operationalId,
      offlineMonitorStatusId:
        data.defaults.monitorStatusIds[SampleMonitorStatus.Offline],
      defaultIncidentSeverityId:
        data.defaults.incidentSeverityIds[SampleIncidentSeverity.Major],
      defaultAlertSeverityId:
        data.defaults.alertSeverityIds[SampleAlertSeverity.High],
    });

    const step: MonitorStep | undefined =
      monitorSteps.data?.monitorStepsInstanceArray[0];

    if (step && data.sample.destination) {
      if (data.sample.destination.startsWith("https://")) {
        step.setMonitorDestination(URL.fromString(data.sample.destination));
      } else {
        step.setMonitorDestination(new Hostname(data.sample.destination));
      }
    }

    if (step && data.sample.port) {
      step.setPort(new Port(data.sample.port));
    }

    return monitorSteps;
  }

  /*
   * A monitor's history as contiguous periods from thirty days ago to now:
   * Operational between its outages, each outage as it was.
   */
  public static getStatusPeriods(data: {
    sample: SampleMonitor;
    now: Date;
  }): Array<{
    status: SampleMonitorStatus;
    startsAt: Date;
    endsAt: Date | null;
    rootCause: string | null;
  }> {
    const periods: Array<{
      status: SampleMonitorStatus;
      startsAt: Date;
      endsAt: Date | null;
      rootCause: string | null;
    }> = [];

    const outages: Array<SampleMonitorOutage> = [...data.sample.outages].sort(
      (a: SampleMonitorOutage, b: SampleMonitorOutage): number => {
        return b.startsMinutesAgo - a.startsMinutesAgo;
      },
    );

    let cursor: Date = minutesAgo(
      data.now,
      SAMPLE_MONITOR_HISTORY_DAYS * MINUTES_IN_A_DAY,
    );

    for (const outage of outages) {
      const outageStartsAt: Date = minutesAgo(
        data.now,
        outage.startsMinutesAgo,
      );

      periods.push({
        status: SampleMonitorStatus.Operational,
        startsAt: cursor,
        endsAt: outageStartsAt,
        rootCause: periods.length === 0 ? null : "The monitor recovered.",
      });

      const outageEndsAt: Date | null =
        outage.endsMinutesAgo === null
          ? null
          : minutesAgo(data.now, outage.endsMinutesAgo);

      periods.push({
        status: outage.status,
        startsAt: outageStartsAt,
        endsAt: outageEndsAt,
        rootCause: outage.rootCause,
      });

      if (!outageEndsAt) {
        return periods;
      }

      cursor = outageEndsAt;
    }

    periods.push({
      status: SampleMonitorStatus.Operational,
      startsAt: cursor,
      endsAt: null,
      rootCause: periods.length === 0 ? null : "The monitor recovered.",
    });

    return periods;
  }

  /*
   * THE ON-CALL POLICY: a weekly rotation of three engineers, the first on
   * call this week, then the engineering manager after ten minutes.
   */
  private static async createOnCall(data: {
    projectId: ObjectID;
    personIdOf: (handle: string | null) => ObjectID;
    now: Date;
  }): Promise<{
    policyId: ObjectID;
    scheduleId: ObjectID;
    firstLevelId: ObjectID;
  }> {
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.projectId = data.projectId;
    schedule.name = SAMPLE_ON_CALL.scheduleName;
    schedule.description = SAMPLE_ON_CALL.scheduleDescription;

    const scheduleId: ObjectID = required(
      (
        await OnCallDutyPolicyScheduleService.create({
          data: schedule,
          props: ROOT,
        })
      ).id,
      "on-call schedule",
    );

    // This week's rotation began at the start of the day, 7 days ago at most.
    const rotationStartsAt: Date = OneUptimeDate.getStartOfDay(
      minutesAgo(data.now, 2 * MINUTES_IN_A_DAY),
    );

    const rotation: Recurring = Recurring.getDefault();
    rotation.intervalType = EventInterval.Week;
    rotation.intervalCount = new PositiveNumber(1);

    const layer: OnCallDutyPolicyScheduleLayer =
      new OnCallDutyPolicyScheduleLayer();
    layer.projectId = data.projectId;
    layer.onCallDutyPolicyScheduleId = scheduleId;
    layer.name = SAMPLE_ON_CALL.layerName;
    layer.order = 1;
    layer.startsAt = rotationStartsAt;
    layer.handOffTime = rotationStartsAt;
    layer.rotation = rotation;
    layer.restrictionTimes = RestrictionTimes.getDefault();

    const layerId: ObjectID = required(
      (
        await OnCallDutyPolicyScheduleLayerService.create({
          data: layer,
          props: ROOT,
        })
      ).id,
      "on-call layer",
    );

    let order: number = 1;

    for (const handle of SAMPLE_ON_CALL.rotationHandles) {
      const layerUser: OnCallDutyPolicyScheduleLayerUser =
        new OnCallDutyPolicyScheduleLayerUser();
      layerUser.projectId = data.projectId;
      layerUser.onCallDutyPolicyScheduleId = scheduleId;
      layerUser.onCallDutyPolicyScheduleLayerId = layerId;
      layerUser.userId = data.personIdOf(handle);
      layerUser.order = order++;

      await OnCallDutyPolicyScheduleLayerUserService.create({
        data: layerUser,
        props: ROOT,
      });
    }

    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.projectId = data.projectId;
    policy.name = SAMPLE_ON_CALL.policyName;
    policy.description = SAMPLE_ON_CALL.policyDescription;

    const policyId: ObjectID = required(
      (await OnCallDutyPolicyService.create({ data: policy, props: ROOT })).id,
      "on-call policy",
    );

    const firstLevel: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    firstLevel.projectId = data.projectId;
    firstLevel.onCallDutyPolicyId = policyId;
    firstLevel.name = SAMPLE_ON_CALL.firstLevelName;
    firstLevel.order = 1;
    firstLevel.escalateAfterInMinutes = SAMPLE_ON_CALL.escalateAfterInMinutes;

    const firstLevelId: ObjectID = required(
      (
        await OnCallDutyPolicyEscalationRuleService.create({
          data: firstLevel,
          props: ROOT,
        })
      ).id,
      "on-call level",
    );

    const firstLevelSchedule: OnCallDutyPolicyEscalationRuleSchedule =
      new OnCallDutyPolicyEscalationRuleSchedule();
    firstLevelSchedule.projectId = data.projectId;
    firstLevelSchedule.onCallDutyPolicyId = policyId;
    firstLevelSchedule.onCallDutyPolicyEscalationRuleId = firstLevelId;
    firstLevelSchedule.onCallDutyPolicyScheduleId = scheduleId;

    await OnCallDutyPolicyEscalationRuleScheduleService.create({
      data: firstLevelSchedule,
      props: ROOT,
    });

    const secondLevel: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    secondLevel.projectId = data.projectId;
    secondLevel.onCallDutyPolicyId = policyId;
    secondLevel.name = SAMPLE_ON_CALL.secondLevelName;
    secondLevel.order = 2;
    secondLevel.escalateAfterInMinutes = SAMPLE_ON_CALL.escalateAfterInMinutes;

    const secondLevelId: ObjectID = required(
      (
        await OnCallDutyPolicyEscalationRuleService.create({
          data: secondLevel,
          props: ROOT,
        })
      ).id,
      "on-call level",
    );

    const secondLevelUser: OnCallDutyPolicyEscalationRuleUser =
      new OnCallDutyPolicyEscalationRuleUser();
    secondLevelUser.projectId = data.projectId;
    secondLevelUser.onCallDutyPolicyId = policyId;
    secondLevelUser.onCallDutyPolicyEscalationRuleId = secondLevelId;
    secondLevelUser.userId = data.personIdOf(SAMPLE_ON_CALL.secondLevelHandle);

    await OnCallDutyPolicyEscalationRuleUserService.create({
      data: secondLevelUser,
      props: ROOT,
    });

    return {
      policyId: policyId,
      scheduleId: scheduleId,
      firstLevelId: firstLevelId,
    };
  }

  private static async createIncident(data: {
    projectId: ObjectID;
    incident: SampleIncident;
    defaults: SampleProjectDefaults;
    monitorIds: Record<string, ObjectID>;
    personIdOf: (handle: string | null) => ObjectID;
    onCall: {
      policyId: ObjectID;
      scheduleId: ObjectID;
      firstLevelId: ObjectID;
    };
    now: Date;
  }): Promise<ObjectID> {
    const sample: SampleIncident = data.incident;
    const lastState: SampleIncidentState = required(
      sample.states[sample.states.length - 1],
      "incident state",
    ).state;
    const declaredAt: Date = minutesAgo(data.now, sample.declaredMinutesAgo);

    const numbering: { counter: number; prefix: string | undefined } =
      await IncidentService.takeNextIncidentNumber(data.projectId);

    const incident: Incident = new Incident();
    incident.projectId = data.projectId;
    incident.title = sample.title;
    incident.description = sample.description;
    incident.declaredAt = declaredAt;
    incident.incidentSeverityId =
      data.defaults.incidentSeverityIds[sample.severity];
    incident.currentIncidentStateId = data.defaults.incidentStateIds[lastState];
    incident.incidentNumber = numbering.counter;
    incident.incidentNumberWithPrefix = NumberPrefixUtil.formatNumber(
      numbering.prefix,
      numbering.counter,
    );
    incident.monitors = sample.monitorKeys.map((key: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor.id = required(data.monitorIds[key], `monitor ${key}`);
      return monitor;
    });
    incident.isVisibleOnStatusPage = true;
    incident.isOwnerNotifiedOfResourceCreation = true;
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;
    incident.subscriberNotificationStatusOnIncidentCreated =
      StatusPageSubscriberNotificationStatus.Skipped;
    incident.notifySubscribersOnPostmortemPublished = false;
    incident.subscriberNotificationStatusOnPostmortemPublished =
      StatusPageSubscriberNotificationStatus.Skipped;

    if (sample.rootCause) {
      incident.rootCause = sample.rootCause;
    }

    if (sample.postmortemNote) {
      incident.postmortemNote = sample.postmortemNote;
      incident.showPostmortemOnStatusPage = true;
      incident.postmortemPostedAt = minutesAgo(
        data.now,
        sample.declaredMinutesAgo - 2 * MINUTES_IN_A_DAY,
      );

      if (data.defaults.postmortemCompletedStatusId) {
        incident.postmortemStatusId = data.defaults.postmortemCompletedStatusId;
      }
    } else if (data.defaults.postmortemNotStartedStatusId) {
      incident.postmortemStatusId = data.defaults.postmortemNotStartedStatusId;
    }

    if (sample.isPagedByOnCall) {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = data.onCall.policyId;
      incident.onCallDutyPolicies = [policy];
      incident.firstPagedAt = declaredAt;
    }

    const incidentId: ObjectID = required(
      (await IncidentService.create({ data: incident, props: ROOT })).id,
      "incident",
    );

    await SampleProjectSeeder.backdate(IncidentService, incidentId, declaredAt);

    const numberText: string = incident.incidentNumberWithPrefix;

    await SampleProjectSeeder.addIncidentFeed({
      projectId: data.projectId,
      incidentId: incidentId,
      eventType: IncidentFeedEventType.IncidentCreated,
      color: Red500,
      text: `Incident **${numberText}** declared: ${sample.title}`,
      at: declaredAt,
    });

    // Its states, each until the next.
    for (let index: number = 0; index < sample.states.length; index++) {
      const step: { state: SampleIncidentState; minutesAgo: number } =
        sample.states[index]!;
      const next:
        | { state: SampleIncidentState; minutesAgo: number }
        | undefined = sample.states[index + 1];
      const startsAt: Date = minutesAgo(data.now, step.minutesAgo);

      const timeline: IncidentStateTimeline = new IncidentStateTimeline();
      timeline.projectId = data.projectId;
      timeline.incidentId = incidentId;
      timeline.incidentStateId = data.defaults.incidentStateIds[step.state];
      timeline.startsAt = startsAt;
      if (next) {
        timeline.endsAt = minutesAgo(data.now, next.minutesAgo);
      }
      timeline.isOwnerNotified = true;
      timeline.shouldStatusPageSubscribersBeNotified = false;
      timeline.subscriberNotificationStatus =
        StatusPageSubscriberNotificationStatus.Skipped;

      const timelineId: ObjectID = required(
        (
          await IncidentStateTimelineService.create({
            data: timeline,
            props: ROOT,
          })
        ).id,
        "incident state timeline",
      );

      await SampleProjectSeeder.backdate(
        IncidentStateTimelineService,
        timelineId,
        startsAt,
      );

      if (index > 0) {
        await SampleProjectSeeder.addIncidentFeed({
          projectId: data.projectId,
          incidentId: incidentId,
          eventType: IncidentFeedEventType.IncidentStateChanged,
          color: data.defaults.incidentStateColors[step.state] || Gray500,
          text: `Changed **${numberText}** state to **${step.state}**`,
          at: startsAt,
        });
      }
    }

    for (const note of sample.internalNotes) {
      await SampleProjectSeeder.addNote({
        projectId: data.projectId,
        incidentId: incidentId,
        note: note,
        isPublic: false,
        personIdOf: data.personIdOf,
        now: data.now,
      });
    }

    for (const note of sample.publicNotes) {
      await SampleProjectSeeder.addNote({
        projectId: data.projectId,
        incidentId: incidentId,
        note: note,
        isPublic: true,
        personIdOf: data.personIdOf,
        now: data.now,
      });
    }

    if (sample.isPagedByOnCall) {
      await SampleProjectSeeder.createOnCallRun({
        projectId: data.projectId,
        incidentId: incidentId,
        incidentNumber: numberText,
        onCall: data.onCall,
        personIdOf: data.personIdOf,
        declaredAt: declaredAt,
      });
    }

    return incidentId;
  }

  private static async addNote(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    note: SampleNote;
    isPublic: boolean;
    personIdOf: (handle: string | null) => ObjectID;
    now: Date;
  }): Promise<void> {
    const postedAt: Date = minutesAgo(data.now, data.note.minutesAgo);
    const authorId: ObjectID = data.personIdOf(data.note.authorHandle);

    if (data.isPublic) {
      const note: IncidentPublicNote = new IncidentPublicNote();
      note.projectId = data.projectId;
      note.incidentId = data.incidentId;
      note.note = data.note.note;
      note.postedAt = postedAt;
      note.createdByUserId = authorId;
      note.isOwnerNotified = true;
      note.isPublished = true;
      note.shouldStatusPageSubscribersBeNotifiedOnNoteCreated = false;
      note.subscriberNotificationStatusOnNoteCreated =
        StatusPageSubscriberNotificationStatus.Skipped;

      const noteId: ObjectID = required(
        (await IncidentPublicNoteService.create({ data: note, props: ROOT }))
          .id,
        "public note",
      );

      await SampleProjectSeeder.backdate(
        IncidentPublicNoteService,
        noteId,
        postedAt,
      );
    } else {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.projectId = data.projectId;
      note.incidentId = data.incidentId;
      note.note = data.note.note;
      note.postedAt = postedAt;
      note.createdByUserId = authorId;
      note.isOwnerNotified = true;

      const noteId: ObjectID = required(
        (await IncidentInternalNoteService.create({ data: note, props: ROOT }))
          .id,
        "private note",
      );

      await SampleProjectSeeder.backdate(
        IncidentInternalNoteService,
        noteId,
        postedAt,
      );
    }

    await SampleProjectSeeder.addIncidentFeed({
      projectId: data.projectId,
      incidentId: data.incidentId,
      eventType: data.isPublic
        ? IncidentFeedEventType.PublicNote
        : IncidentFeedEventType.PrivateNote,
      color: Blue500,
      text: data.isPublic
        ? `Posted a public note:\n\n${data.note.note}`
        : `Added a private note:\n\n${data.note.note}`,
      at: postedAt,
      userId: authorId,
    });
  }

  /*
   * THE RUN THE POLICY MADE for the open incident: level one paged the
   * engineer on call by push and SMS, who acknowledged it. Written as a
   * finished run, so no job carries it on; nothing was ever sent.
   */
  private static async createOnCallRun(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    incidentNumber: string;
    onCall: {
      policyId: ObjectID;
      scheduleId: ObjectID;
      firstLevelId: ObjectID;
    };
    personIdOf: (handle: string | null) => ObjectID;
    declaredAt: Date;
  }): Promise<void> {
    const engineerId: ObjectID = data.personIdOf(
      required(SAMPLE_ON_CALL.rotationHandles[0], "engineer on call"),
    );
    const acknowledgedAt: Date = new Date(
      data.declaredAt.getTime() +
        SAMPLE_ON_CALL.acknowledgedAfterMinutes * 60 * 1000,
    );
    const eventType: UserNotificationEventType =
      UserNotificationEventType.IncidentCreated;

    const executionLog: OnCallDutyPolicyExecutionLog =
      new OnCallDutyPolicyExecutionLog();
    executionLog.projectId = data.projectId;
    executionLog.onCallDutyPolicyId = data.onCall.policyId;
    executionLog.triggeredByIncidentId = data.incidentId;
    executionLog.status = OnCallDutyPolicyStatus.Completed;
    executionLog.statusMessage = `Acknowledged by ${SAMPLE_PEOPLE[0]!.name}.`;
    executionLog.userNotificationEventType = eventType;
    executionLog.acknowledgedByUserId = engineerId;
    executionLog.acknowledgedAt = acknowledgedAt;
    executionLog.lastExecutedEscalationRuleOrder = 1;
    executionLog.lastExecutedEscalationRuleId = data.onCall.firstLevelId;
    executionLog.lastEscalationRuleExecutedAt = data.declaredAt;
    executionLog.executeNextEscalationRuleInMinutes = 0;
    executionLog.onCallPolicyExecutionRepeatCount = 1;
    executionLog.pagingStartsAt = data.declaredAt;

    const executionLogId: ObjectID = required(
      (
        await OnCallDutyPolicyExecutionLogService.create({
          data: executionLog,
          props: ROOT,
        })
      ).id,
      "on-call run",
    );

    await SampleProjectSeeder.backdate(
      OnCallDutyPolicyExecutionLogService,
      executionLogId,
      data.declaredAt,
    );

    const levelTimeline: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    levelTimeline.projectId = data.projectId;
    levelTimeline.onCallDutyPolicyId = data.onCall.policyId;
    levelTimeline.triggeredByIncidentId = data.incidentId;
    levelTimeline.onCallDutyPolicyExecutionLogId = executionLogId;
    levelTimeline.onCallDutyPolicyEscalationRuleId = data.onCall.firstLevelId;
    levelTimeline.onCallDutyScheduleId = data.onCall.scheduleId;
    levelTimeline.alertSentToUserId = engineerId;
    levelTimeline.userNotificationEventType = eventType;
    levelTimeline.status =
      OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged;
    levelTimeline.statusMessage = `${SAMPLE_PEOPLE[0]!.name} was on call, was paged, and acknowledged.`;
    levelTimeline.isAcknowledged = true;
    levelTimeline.acknowledgedAt = acknowledgedAt;

    const levelTimelineId: ObjectID = required(
      (
        await OnCallDutyPolicyExecutionLogTimelineService.create({
          data: levelTimeline,
          props: ROOT,
        })
      ).id,
      "on-call run step",
    );

    await SampleProjectSeeder.backdate(
      OnCallDutyPolicyExecutionLogTimelineService,
      levelTimelineId,
      data.declaredAt,
    );

    const userLog: UserOnCallLog = new UserOnCallLog();
    userLog.projectId = data.projectId;
    userLog.userId = engineerId;
    userLog.onCallDutyPolicyId = data.onCall.policyId;
    userLog.onCallDutyPolicyExecutionLogId = executionLogId;
    userLog.onCallDutyPolicyEscalationRuleId = data.onCall.firstLevelId;
    userLog.onCallDutyPolicyExecutionLogTimelineId = levelTimelineId;
    userLog.onCallDutyScheduleId = data.onCall.scheduleId;
    userLog.triggeredByIncidentId = data.incidentId;
    userLog.status = UserNotificationExecutionStatus.Completed;
    userLog.statusMessage = "Acknowledged.";
    userLog.userNotificationEventType = eventType;
    userLog.acknowledgedByUserId = engineerId;
    userLog.acknowledgedAt = acknowledgedAt;

    const userLogId: ObjectID = required(
      (await UserOnCallLogService.create({ data: userLog, props: ROOT })).id,
      "page",
    );

    await SampleProjectSeeder.backdate(
      UserOnCallLogService,
      userLogId,
      data.declaredAt,
    );

    const steps: Array<{
      afterSeconds: number;
      status: UserNotificationStatus;
      message: string;
    }> = [
      {
        afterSeconds: 2,
        status: UserNotificationStatus.Sent,
        message: "Push notification sent to the OneUptime app.",
      },
      {
        afterSeconds: 60,
        status: UserNotificationStatus.Sent,
        message: "SMS sent.",
      },
      {
        afterSeconds: SAMPLE_ON_CALL.acknowledgedAfterMinutes * 60,
        status: UserNotificationStatus.Acknowledged,
        message: "Acknowledged from the OneUptime app.",
      },
    ];

    for (const step of steps) {
      const at: Date = new Date(
        data.declaredAt.getTime() + step.afterSeconds * 1000,
      );

      const timeline: UserOnCallLogTimeline = new UserOnCallLogTimeline();
      timeline.projectId = data.projectId;
      timeline.userId = engineerId;
      timeline.userNotificationLogId = userLogId;
      timeline.onCallDutyPolicyId = data.onCall.policyId;
      timeline.onCallDutyPolicyExecutionLogId = executionLogId;
      timeline.onCallDutyPolicyExecutionLogTimelineId = levelTimelineId;
      timeline.onCallDutyPolicyEscalationRuleId = data.onCall.firstLevelId;
      timeline.triggeredByIncidentId = data.incidentId;
      timeline.userNotificationEventType = eventType;
      timeline.status = step.status;
      timeline.statusMessage = step.message;

      if (step.status === UserNotificationStatus.Acknowledged) {
        timeline.isAcknowledged = true;
        timeline.acknowledgedAt = at;
      }

      const timelineId: ObjectID = required(
        (
          await UserOnCallLogTimelineService.create({
            data: timeline,
            props: ROOT,
          })
        ).id,
        "page step",
      );

      await SampleProjectSeeder.backdate(
        UserOnCallLogTimelineService,
        timelineId,
        at,
      );
    }

    await SampleProjectSeeder.addIncidentFeed({
      projectId: data.projectId,
      incidentId: data.incidentId,
      eventType: IncidentFeedEventType.OnCallNotification,
      color: Blue500,
      text: `**${SAMPLE_ON_CALL.policyName}** paged ${SAMPLE_PEOPLE[0]!.name}, who was on call, by push and SMS.`,
      at: new Date(data.declaredAt.getTime() + 2000),
    });

    await SampleProjectSeeder.addIncidentFeed({
      projectId: data.projectId,
      incidentId: data.incidentId,
      eventType: IncidentFeedEventType.OnCallNotification,
      color: Green500,
      text: `${SAMPLE_PEOPLE[0]!.name} acknowledged **${data.incidentNumber}** from the OneUptime app.`,
      at: acknowledgedAt,
      userId: engineerId,
    });
  }

  private static async addIncidentFeed(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    eventType: IncidentFeedEventType;
    color: Color;
    text: string;
    at: Date;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const feed: IncidentFeed = new IncidentFeed();
    feed.projectId = data.projectId;
    feed.incidentId = data.incidentId;
    feed.incidentFeedEventType = data.eventType;
    feed.displayColor = data.color;
    feed.feedInfoInMarkdown = data.text;
    feed.postedAt = data.at;

    if (data.userId) {
      feed.userId = data.userId;
    }

    const feedId: ObjectID = required(
      (await IncidentFeedService.create({ data: feed, props: ROOT })).id,
      "incident feed",
    );

    await SampleProjectSeeder.backdate(IncidentFeedService, feedId, data.at);
  }

  private static async createAlert(data: {
    projectId: ObjectID;
    alert: SampleAlert;
    defaults: SampleProjectDefaults;
    monitorIds: Record<string, ObjectID>;
    now: Date;
  }): Promise<ObjectID> {
    const sample: SampleAlert = data.alert;
    const first: { state: SampleAlertState; minutesAgo: number } = required(
      sample.states[0],
      "alert state",
    );
    const last: { state: SampleAlertState; minutesAgo: number } = required(
      sample.states[sample.states.length - 1],
      "alert state",
    );
    const createdAt: Date = minutesAgo(data.now, first.minutesAgo);

    const numbering: { counter: number; prefix: string | undefined } =
      await AlertService.takeNextAlertNumber(data.projectId);

    const alert: Alert = new Alert();
    alert.projectId = data.projectId;
    alert.title = sample.title;
    alert.description = sample.description;
    alert.alertSeverityId = data.defaults.alertSeverityIds[sample.severity];
    alert.currentAlertStateId = data.defaults.alertStateIds[last.state];
    alert.alertNumber = numbering.counter;
    alert.alertNumberWithPrefix = NumberPrefixUtil.formatNumber(
      numbering.prefix,
      numbering.counter,
    );
    alert.isOwnerNotifiedOfAlertCreation = true;

    if (sample.monitorKey) {
      alert.monitorId = required(
        data.monitorIds[sample.monitorKey],
        `monitor ${sample.monitorKey}`,
      );
    }

    const alertId: ObjectID = required(
      (await AlertService.create({ data: alert, props: ROOT })).id,
      "alert",
    );

    await SampleProjectSeeder.backdate(AlertService, alertId, createdAt);

    for (let index: number = 0; index < sample.states.length; index++) {
      const step: { state: SampleAlertState; minutesAgo: number } =
        sample.states[index]!;
      const next: { state: SampleAlertState; minutesAgo: number } | undefined =
        sample.states[index + 1];
      const startsAt: Date = minutesAgo(data.now, step.minutesAgo);

      const timeline: AlertStateTimeline = new AlertStateTimeline();
      timeline.projectId = data.projectId;
      timeline.alertId = alertId;
      timeline.alertStateId = data.defaults.alertStateIds[step.state];
      timeline.startsAt = startsAt;
      if (next) {
        timeline.endsAt = minutesAgo(data.now, next.minutesAgo);
      }
      timeline.isOwnerNotified = true;

      const timelineId: ObjectID = required(
        (
          await AlertStateTimelineService.create({
            data: timeline,
            props: ROOT,
          })
        ).id,
        "alert state timeline",
      );

      await SampleProjectSeeder.backdate(
        AlertStateTimelineService,
        timelineId,
        startsAt,
      );

      const feed: AlertFeed = new AlertFeed();
      feed.projectId = data.projectId;
      feed.alertId = alertId;
      feed.alertFeedEventType =
        index === 0
          ? AlertFeedEventType.AlertCreated
          : AlertFeedEventType.AlertStateChanged;
      feed.displayColor = index === 0 ? Red500 : Gray500;
      feed.feedInfoInMarkdown =
        index === 0
          ? `Alert **${alert.alertNumberWithPrefix}** fired: ${sample.title}`
          : `Changed **${alert.alertNumberWithPrefix}** state to **${step.state}**`;
      feed.postedAt = startsAt;

      const feedId: ObjectID = required(
        (await AlertFeedService.create({ data: feed, props: ROOT })).id,
        "alert feed",
      );

      await SampleProjectSeeder.backdate(AlertFeedService, feedId, startsAt);
    }

    return alertId;
  }

  /*
   * THE STATUS PAGE: private, kept out of search results, and opened only
   * by the sample's members (SampleProjectStatusPages), with the web and
   * API monitors in two groups.
   */
  private static async createStatusPage(data: {
    projectId: ObjectID;
    monitorIds: Record<string, ObjectID>;
    now: Date;
  }): Promise<ObjectID> {
    const statusPage: StatusPage = new StatusPage();
    statusPage.projectId = data.projectId;
    statusPage.name = SAMPLE_STATUS_PAGE.name;
    statusPage.description = SAMPLE_STATUS_PAGE.description;
    statusPage.pageTitle = SAMPLE_STATUS_PAGE.pageTitle;
    statusPage.pageDescription = SAMPLE_STATUS_PAGE.pageDescription;
    statusPage.isPublicStatusPage = false;
    statusPage.enableSearchEngineIndexing = false;
    statusPage.isOwnerNotifiedOfResourceCreation = true;

    const statusPageId: ObjectID = required(
      (await StatusPageService.create({ data: statusPage, props: ROOT })).id,
      "status page",
    );

    const groupIds: Record<string, ObjectID> = {};
    let groupOrder: number = 1;

    for (const groupName of SAMPLE_STATUS_PAGE_GROUPS) {
      const group: StatusPageGroup = new StatusPageGroup();
      group.projectId = data.projectId;
      group.statusPageId = statusPageId;
      group.name = groupName;
      group.order = groupOrder++;

      groupIds[groupName] = required(
        (await StatusPageGroupService.create({ data: group, props: ROOT })).id,
        "status page group",
      );
    }

    let resourceOrder: number = 1;

    for (const sample of SAMPLE_MONITORS) {
      if (!sample.statusPageGroup) {
        continue;
      }

      const resource: StatusPageResource = new StatusPageResource();
      resource.projectId = data.projectId;
      resource.statusPageId = statusPageId;
      resource.statusPageGroupId = required(
        groupIds[sample.statusPageGroup],
        "status page group",
      );
      resource.monitorId = required(
        data.monitorIds[sample.key],
        `monitor ${sample.key}`,
      );
      resource.displayName = sample.name;
      resource.showCurrentStatus = true;
      resource.showUptimePercent = true;
      resource.showStatusHistoryChart = true;
      resource.order = resourceOrder++;

      await StatusPageResourceService.create({ data: resource, props: ROOT });
    }

    return statusPageId;
  }

  private static async createMaintenance(data: {
    projectId: ObjectID;
    defaults: SampleProjectDefaults;
    monitorIds: Record<string, ObjectID>;
    statusPageId: ObjectID;
    now: Date;
  }): Promise<ObjectID> {
    const startsAt: Date = OneUptimeDate.getStartOfDay(
      new Date(
        data.now.getTime() + SAMPLE_MAINTENANCE.startsInMinutes * 60 * 1000,
      ),
    );
    const endsAt: Date = new Date(
      startsAt.getTime() + SAMPLE_MAINTENANCE.durationInMinutes * 60 * 1000,
    );

    const numbering: { counter: number; prefix: string | undefined } =
      await ScheduledMaintenanceService.takeNextScheduledMaintenanceNumber(
        data.projectId,
      );

    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
    maintenance.projectId = data.projectId;
    maintenance.title = SAMPLE_MAINTENANCE.title;
    maintenance.description = SAMPLE_MAINTENANCE.description;
    maintenance.startsAt = startsAt;
    maintenance.endsAt = endsAt;
    maintenance.currentScheduledMaintenanceStateId =
      data.defaults.scheduledMaintenanceStateId;
    maintenance.scheduledMaintenanceNumber = numbering.counter;
    maintenance.scheduledMaintenanceNumberWithPrefix =
      NumberPrefixUtil.formatNumber(numbering.prefix, numbering.counter);
    maintenance.monitors = SAMPLE_MAINTENANCE.monitorKeys.map(
      (key: string): Monitor => {
        const monitor: Monitor = new Monitor();
        monitor.id = required(data.monitorIds[key], `monitor ${key}`);
        return monitor;
      },
    );
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = data.statusPageId;
    maintenance.statusPages = [statusPage];
    maintenance.isVisibleOnStatusPage = true;
    maintenance.isOwnerNotifiedOfResourceCreation = true;
    maintenance.shouldStatusPageSubscribersBeNotifiedOnEventCreated = false;
    maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing =
      false;
    maintenance.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded =
      false;
    maintenance.subscriberNotificationStatusOnEventScheduled =
      StatusPageSubscriberNotificationStatus.Skipped;

    const maintenanceId: ObjectID = required(
      (
        await ScheduledMaintenanceService.create({
          data: maintenance,
          props: ROOT,
        })
      ).id,
      "scheduled maintenance",
    );

    const timeline: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    timeline.projectId = data.projectId;
    timeline.scheduledMaintenanceId = maintenanceId;
    timeline.scheduledMaintenanceStateId =
      data.defaults.scheduledMaintenanceStateId;
    timeline.startsAt = data.now;
    timeline.isOwnerNotified = true;
    timeline.shouldStatusPageSubscribersBeNotified = false;
    timeline.subscriberNotificationStatus =
      StatusPageSubscriberNotificationStatus.Skipped;

    await ScheduledMaintenanceStateTimelineService.create({
      data: timeline,
      props: ROOT,
    });

    return maintenanceId;
  }

  /*
   * THE SERVICE AND ITS TELEMETRY: found or made the way ingest makes one
   * (OpenTelemetryIngestService.telemetryServiceFromName), its metrics named
   * for the Metrics pages and the dashboard, and the rows written once.
   */
  private static async createServiceAndTelemetry(data: {
    projectId: ObjectID;
    monitorIds: Record<string, ObjectID>;
    now: Date;
  }): Promise<{ serviceId: ObjectID; rowCount: number }> {
    const service: TelemetryServiceMetadata =
      await OpenTelemetryIngestService.telemetryServiceFromName({
        serviceName: SAMPLE_SERVICE.name,
        projectId: data.projectId,
      });

    const serviceRow: Service = new Service();
    serviceRow.id = service.primaryEntityId;

    await ServiceService.updateColumnsByIdWithoutHooks({
      id: service.primaryEntityId,
      data: { description: SAMPLE_SERVICE.description } as never,
    });

    for (const sampleMetric of SAMPLE_SERVICE_METRICS) {
      const metricType: MetricType = new MetricType();
      metricType.projectId = data.projectId;
      metricType.name = sampleMetric.name;
      metricType.description = sampleMetric.description;
      metricType.unit = sampleMetric.unit;
      metricType.services = [serviceRow];

      await MetricTypeService.create({ data: metricType, props: ROOT });
    }

    const monitors: Array<SampleTelemetryMonitor> = SAMPLE_MONITORS.filter(
      (sample: SampleMonitor): boolean => {
        return BASE_RESPONSE_TIME_IN_MS[sample.key] !== undefined;
      },
    ).map((sample: SampleMonitor): SampleTelemetryMonitor => {
      return {
        monitorId: required(
          data.monitorIds[sample.key],
          `monitor ${sample.key}`,
        ),
        name: sample.name,
        baseResponseTimeInMs: BASE_RESPONSE_TIME_IN_MS[sample.key]!,
        isSlowNow: sample.outages.some(
          (outage: SampleMonitorOutage): boolean => {
            return outage.endsMinutesAgo === null;
          },
        ),
      };
    });

    const rows: SampleTelemetryRows = SampleProjectTelemetry.buildRows({
      projectId: data.projectId,
      service: service,
      monitors: monitors,
      now: data.now,
    });

    await SampleProjectTelemetry.write(rows);

    return {
      serviceId: service.primaryEntityId,
      rowCount: rows.logs.length + rows.spans.length + rows.metrics.length,
    };
  }

  private static async createSlo(data: {
    projectId: ObjectID;
    defaults: SampleProjectDefaults;
    monitorIds: Record<string, ObjectID>;
    now: Date;
  }): Promise<ObjectID> {
    const monitor: Monitor = new Monitor();
    monitor.id = required(
      data.monitorIds[SAMPLE_SLO.monitorKey],
      `monitor ${SAMPLE_SLO.monitorKey}`,
    );

    const downStatus: MonitorStatus = new MonitorStatus();
    downStatus.id = data.defaults.monitorStatusIds[SampleMonitorStatus.Offline];

    // 40 minutes down three days ago, of 30 days: 99.907% of the window.
    const windowSeconds: number = SAMPLE_SLO.windowDays * MINUTES_IN_A_DAY * 60;
    const budgetSeconds: number =
      windowSeconds * (1 - SAMPLE_SLO.targetPercentage / 100);
    const downSeconds: number = 42 * 60;
    const sliPercentage: number =
      Math.round((1 - downSeconds / windowSeconds) * 100_000) / 1000;

    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.projectId = data.projectId;
    slo.name = SAMPLE_SLO.name;
    slo.description = SAMPLE_SLO.description;
    slo.sliType = SliType.MonitorUptime;
    slo.monitors = [monitor];
    slo.downtimeMonitorStatuses = [downStatus];
    slo.targetPercentage = SAMPLE_SLO.targetPercentage;
    slo.windowDays = SAMPLE_SLO.windowDays;
    slo.currentSliPercentage = sliPercentage;
    slo.errorBudgetTotalSeconds = Math.round(budgetSeconds);
    slo.errorBudgetRemainingSeconds = Math.max(
      0,
      Math.round(budgetSeconds - downSeconds),
    );
    slo.errorBudgetRemainingPercentage =
      Math.round(((budgetSeconds - downSeconds) / budgetSeconds) * 1000) / 10;
    slo.sloStatus = SloStatus.AtRisk;
    slo.lastEvaluatedAt = data.now;

    return required(
      (await ServiceLevelObjectiveService.create({ data: slo, props: ROOT }))
        .id,
      "SLO",
    );
  }

  // Sets when a record was made, so the sample's history reads as history.
  private static async backdate(
    service: {
      updateColumnsByIdWithoutHooks: (input: {
        id: ObjectID;
        data: never;
      }) => Promise<void>;
    },
    id: ObjectID,
    createdAt: Date,
  ): Promise<void> {
    await service.updateColumnsByIdWithoutHooks({
      id: id,
      data: { createdAt: createdAt } as never,
    });
  }
}
