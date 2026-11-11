/*
 * A project made a minute ago, as ProjectService and TeamMemberService leave
 * it: the three teams, the monitor statuses, the incident and alert states
 * and severities, the scheduled maintenance states, OneUptime's global
 * probes, and each member's verified sign-in email with the notification
 * settings and on-call rules a new member gets. Its owner, Ada Lovelace,
 * made it; Grace Hopper accepted an invitation to it, so there is a teammate
 * to escalate to. Nothing else: no monitor, no incident, no on-call policy,
 * no status page, no telemetry.
 *
 * `seeds` adds what an earlier journey left behind, so a later one starts
 * where a newcomer would:
 *   - monitor   the website monitor the first journey creates
 *
 * Also here: the API routes the journeys' pages call beyond ModelAPI, and
 * what the server does after a create that a journey's next page shows.
 */
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Probe, { ProbeConnectionStatus } from "Common/Models/DatabaseModels/Probe";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import MonitorType from "Common/Types/Monitor/MonitorType";
import URL from "Common/Types/API/URL";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { ok } from "./Store";

export const PROJECT_ID = "10000000-0000-4000-8000-000000006831";
export const ADA_ID = "40000000-0000-4000-8000-000000000001";
export const GRACE_ID = "40000000-0000-4000-8000-000000000002";
export const MONITOR_ID = "50000000-0000-4000-8000-000000000001";

const OWNERS_TEAM_ID = "30000000-0000-4000-8000-000000000001";
const ADMINS_TEAM_ID = "30000000-0000-4000-8000-000000000002";
const MEMBERS_TEAM_ID = "30000000-0000-4000-8000-000000000003";

export function seedNewProject(options) {
  const store = options.createStore({
    projectId: new ObjectID(PROJECT_ID),
    log: options.log,
  });
  const projectId = new ObjectID(PROJECT_ID);

  store.insert(Project, {
    _id: PROJECT_ID,
    name: "Acme Commerce",
    projectId: undefined,
  });

  const ada = store.insert(User, {
    _id: ADA_ID,
    name: new Name("Ada Lovelace"),
    email: new Email("ada@acme-commerce.example"),
    isEmailVerified: true,
  });
  const grace = store.insert(User, {
    _id: GRACE_ID,
    name: new Name("Grace Hopper"),
    email: new Email("grace@acme-commerce.example"),
    isEmailVerified: true,
  });

  const teams = [
    [OWNERS_TEAM_ID, "Owners", "Owners of this project.", false],
    [ADMINS_TEAM_ID, "Admins", "Admins of this project.", true],
    [MEMBERS_TEAM_ID, "Members", "Members of this project.", true],
  ].map(([id, name, description, editable]) => {
    return store.insert(Team, {
      _id: id,
      name,
      description,
      isPermissionsEditable: editable,
      isTeamDeleteable: editable,
      isTeamEditable: editable,
      shouldHaveAtLeastOneMember: !editable,
    });
  });

  store.insert(TeamMember, {
    teamId: new ObjectID(OWNERS_TEAM_ID),
    team: teams[0],
    userId: new ObjectID(ADA_ID),
    user: ada,
    hasAcceptedInvitation: true,
  });
  store.insert(TeamMember, {
    teamId: new ObjectID(MEMBERS_TEAM_ID),
    team: teams[2],
    userId: new ObjectID(GRACE_ID),
    user: grace,
    hasAcceptedInvitation: true,
  });

  // Each member's sign-in email, verified: how OneUptime reaches them first.
  for (const [userId, email] of [
    [ADA_ID, "ada@acme-commerce.example"],
    [GRACE_ID, "grace@acme-commerce.example"],
  ]) {
    store.insert(UserEmail, {
      userId: new ObjectID(userId),
      email: new Email(email),
      isVerified: true,
    });
  }

  const statuses = [
    ["Operational", "#10b981", 1, { isOperationalState: true }],
    ["Degraded", "#f59e0b", 2, {}],
    ["Offline", "#ef4444", 3, { isOfflineState: true }],
  ].map(([name, color, priority, flags], index) => {
    return store.insert(MonitorStatus, {
      _id: `60000000-0000-4000-8000-00000000000${index + 1}`,
      name,
      color: new Color(color),
      priority,
      isOperationalState: false,
      isOfflineState: false,
      ...flags,
    });
  });

  [
    ["Identified", "#ef4444", 1, { isCreatedState: true }],
    ["Acknowledged", "#f59e0b", 2, { isAcknowledgedState: true }],
    ["Resolved", "#10b981", 3, { isResolvedState: true }],
  ].forEach(([name, color, order, flags]) => {
    store.insert(IncidentState, {
      name,
      color: new Color(color),
      order,
      ...flags,
    });
    store.insert(AlertState, { name, color: new Color(color), order, ...flags });
  });

  [
    ["Critical Incident", "#800000", 1],
    ["Major Incident", "#ef4444", 2],
    ["Minor Incident", "#f59e0b", 3],
  ].forEach(([name, color, order]) => {
    store.insert(IncidentSeverity, { name, color: new Color(color), order });
  });
  [
    ["High", "#800000", 1],
    ["Low", "#f59e0b", 2],
  ].forEach(([name, color, order]) => {
    store.insert(AlertSeverity, { name, color: new Color(color), order });
  });

  [
    ["Scheduled", "#6b7280", 1, { isScheduledState: true }],
    ["Ongoing", "#f59e0b", 2, { isOngoingState: true }],
    ["Ended", "#10b981", 3, { isEndedState: true }],
    ["Completed", "#10b981", 4, { isResolvedState: true }],
  ].forEach(([name, color, order, flags]) => {
    store.insert(ScheduledMaintenanceState, {
      name,
      color: new Color(color),
      order,
      ...flags,
    });
  });

  // OneUptime's global probes, every one on for a new monitor.
  [
    ["Probe US", "us"],
    ["Probe EU", "eu"],
  ].forEach(([name, slug], index) => {
    store.insert(Probe, {
      _id: `70000000-0000-4000-8000-00000000000${index + 1}`,
      name,
      slug,
      key: `probe-key-${slug}`,
      isGlobalProbe: true,
      shouldAutoEnableProbeOnNewMonitors: true,
      connectionStatus: ProbeConnectionStatus.Connected,
      lastAlive: store.NOW,
      projectId: undefined,
    });
  });

  if (options.seeds.includes("monitor")) {
    store.insert(Monitor, {
      _id: MONITOR_ID,
      name: "Acme website",
      monitorType: MonitorType.Website,
      currentMonitorStatusId: new ObjectID(statuses[0]._id),
      currentMonitorStatus: statuses[0],
      monitorSteps: undefined,
      isAllProbesDisconnectedFromThisMonitor: false,
      isNoProbeEnabledOnThisMonitor: false,
      disableActiveMonitoring: false,
      labels: [],
    });
  }

  return { store, projectId, statuses, ada, grace };
}

/*
 * Who is signed in: Ada, who made the project (a Project Owner), or Grace,
 * a member invited a minute ago (a Project Member). The permissions are the
 * snapshot the API would hand the Dashboard.
 */
export function signIn(project, who) {
  const isMember = who === "member";
  const user = isMember ? project.grace : project.ada;
  const held = isMember ? [Permission.ProjectMember] : [Permission.ProjectOwner];

  UserUtil.setUserId(new ObjectID(user._id));
  UserUtil.setEmail(user.email);
  UserUtil.setName(user.name);
  UserUtil.setIsMasterAdmin(false);
  UserUtil.isMasterAdmin = () => false;
  UserUtil.getUserId = () => new ObjectID(user._id);

  const projectPermissions = {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: held.map((permission) => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
  PermissionUtil.getAllPermissions = () => held;
  PermissionUtil.getProjectPermissions = () => projectPermissions;
  PermissionUtil.getGlobalPermissions = () => ({
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [new ObjectID(PROJECT_ID)],
  });
  ProjectUtil.getCurrentPlan = () => null;
  ModelAPI.getCommonHeaders = () => ({ tenantid: PROJECT_ID });
}

/*
 * What the server does after a create that the next page of a journey
 * shows, by table.
 */
export function dashboardHooks(project) {
  return {
    Monitor: async (record) => {
      // A new monitor starts Operational (MonitorService.onCreateSuccess).
      if (!record.currentMonitorStatusId) {
        record.currentMonitorStatusId = new ObjectID(project.statuses[0]._id);
      }
    },
  };
}

// The API's own routes the journeys' pages call, answered for a new project.
export function dashboardRoutes() {
  return [
    [
      "GET",
      "/on-call-duty-policy/current-on-duty-escalation-policies",
      () => {
        return ok({
          escalationRulesByUser: [],
          escalationRulesByTeam: [],
          escalationRulesBySchedule: [],
        });
      },
    ],
    [
      "GET",
      "/global-config/vars",
      () => {
        return ok({
          disableUserProjectCreation: false,
          disablePushNotifications: false,
        });
      },
    ],
    [
      "GET",
      "/monitor/active-monitor-limit",
      () => {
        return ok({ limit: null, count: 0 });
      },
    ],
  ];
}

export { URL };
