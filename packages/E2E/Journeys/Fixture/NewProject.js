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
 *   - phones    SMS and calls on, with money in the balance: what the
 *               owner did in the paging journey
 *   - ingestion-keys   four ingestion keys, a Server key and three
 *               Browser keys in use, switched off and never used: the
 *               Ingestion Keys list the telemetry docs show (#7579)
 *   - teammate-monitor   Ada's monitor of https://acme-commerce.example,
 *               which the website guided setup finds before it makes one
 *               for a teammate (#7254)
 *   - status-page   a status page, "Acme status", that shows nothing yet:
 *               the website guided setup's step 4 offers it (#7053)
 *   - on-call-policy   an on-call policy, "Website on-call", with one
 *               level that pages Ada: the docs' shot of a second level's
 *               "Paged after (in minutes)" (#9419)
 *   - busy      a project in use (#7143): a hundred monitors carrying
 *               labels, three monitor groups, two status pages - the
 *               older showing two monitors - and five services reporting
 *               telemetry; what the status page and telemetry guided
 *               setups are looked at as a busy project
 *   - status-page-grid   a status page whose Resources are two grids,
 *               Service by Region, of three regions and of six, with long
 *               monitor names and two resources off the grid: what its
 *               Resources screen is measured at (#7239, #7430)
 *
 * Also here: the API routes the journeys' pages call beyond ModelAPI, and
 * what the server does after a create that a journey's next page shows.
 */
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorGroup from "Common/Models/DatabaseModels/MonitorGroup";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import Label from "Common/Models/DatabaseModels/Label";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import BillingPaymentMethod from "Common/Models/DatabaseModels/BillingPaymentMethod";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import Service from "Common/Models/DatabaseModels/Service";
import ProjectMilestone from "Common/Models/DatabaseModels/ProjectMilestone";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import {
  GUIDED_SETUP_MONITORING_INTERVAL,
  buildWebsiteMonitor,
  parseWebsiteAddress,
} from "Common/Utils/GuidedSetup/WebsiteMonitorRecords";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import Color from "Common/Types/Color";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import MonitorType from "Common/Types/Monitor/MonitorType";
import URL from "Common/Types/API/URL";
import {
  WelcomeAudience,
  buildWelcomeChecklist,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import UserUtil from "Common/UI/Utils/User";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { fail, ok, readWorld, worldJournal, writeWorld } from "./Store";
import {
  applyGuidedSetupRunChange,
  parseGuidedSetupRunChange,
} from "Common/Types/GuidedSetup/GuidedSetupRun";

export const PROJECT_ID = "10000000-0000-4000-8000-000000006831";
export const ADA_ID = "40000000-0000-4000-8000-000000000001";
export const GRACE_ID = "40000000-0000-4000-8000-000000000002";
export const MONITOR_ID = "50000000-0000-4000-8000-000000000001";
export const SERVICE_ID = "50000000-0000-4000-8000-000000000002";
export const TEAMMATE_MONITOR_ID = "50000000-0000-4000-8000-000000000003";
export const STATUS_PAGE_ID = "50000000-0000-4000-8000-000000000004";
// ?seed=on-call-policy's policy and its one level.
export const ON_CALL_POLICY_ID = "50000000-0000-4000-8000-000000000005";
export const ON_CALL_POLICY_RULE_ID = "50000000-0000-4000-8000-000000000006";
// The address ?seed=teammate-monitor's monitor checks.
export const TEAMMATE_MONITOR_ADDRESS = "https://acme-commerce.example";
// The test page a guided setup sends (#6804): its run, acknowledged at once.
export const TEST_PAGE_LOG_ID = "80000000-0000-4000-8000-000000006804";

/*
 * The ingestion keys of ?seed=ingestion-keys, newest first: in the order the
 * list shows them, which sorts by when each was made.
 */
const INGESTION_KEYS = [
  {
    _id: "60000000-0000-4000-8000-000000007579",
    name: "Production collectors",
    keyType: TelemetryIngestionKeyType.Server,
    isEnabled: true,
    allowedOrigins: [],
    lastUsedAt: "2026-11-11T09:58:00.000Z",
    createdAt: "2026-10-01T09:00:00.000Z",
    description:
      "OpenTelemetry collectors in prod-us-east-1 and prod-eu-west-1.",
  },
  {
    _id: "60000000-0000-4000-8000-000000007580",
    name: "Storefront web",
    keyType: TelemetryIngestionKeyType.Browser,
    isEnabled: true,
    allowedOrigins: ["https://shop.acme-commerce.example"],
    lastUsedAt: "2026-11-11T09:59:00.000Z",
    createdAt: "2026-09-24T09:00:00.000Z",
    description:
      "Browser traces and session replay for the public storefront. This key ships in the page.",
  },
  {
    _id: "60000000-0000-4000-8000-000000007581",
    name: "Checkout beta",
    keyType: TelemetryIngestionKeyType.Browser,
    isEnabled: false,
    allowedOrigins: ["https://beta.acme-commerce.example"],
    lastUsedAt: "2026-10-28T16:40:00.000Z",
    createdAt: "2026-09-17T09:00:00.000Z",
    description:
      "Turned off after the beta ended. Kept so the key can be turned back on if the rollout resumes.",
  },
  {
    _id: "60000000-0000-4000-8000-000000007582",
    name: "Marketing site",
    keyType: TelemetryIngestionKeyType.Browser,
    isEnabled: true,
    allowedOrigins: [],
    lastUsedAt: null,
    createdAt: "2026-09-10T09:00:00.000Z",
    description:
      "Made for the marketing site rollout. No origins listed yet, so nothing is accepted.",
  },
];

/*
 * ?seed=busy (#7143): a project in use. A hundred monitors, a component in
 * each of four regions, the production ones and the staging ones labelled
 * so; three monitor groups; two status pages, the older showing two of
 * the monitors; five services that report.
 */
const BUSY_COMPONENTS = [
  "Accounts",
  "Admin",
  "Auth",
  "Billing",
  "Cart",
  "Catalog",
  "Checkout",
  "Docs",
  "Gateway",
  "Inventory",
  "Media",
  "Mobile API",
  "Notifications",
  "Orders",
  "Partner API",
  "Payments",
  "Pricing",
  "Recommendations",
  "Reports",
  "Reviews",
  "Search",
  "Shipping",
  "Status",
  "Storefront",
  "Webhooks",
];
const BUSY_REGIONS = ["us-east", "us-west", "eu-west", "ap-south"];
export const BUSY_LABELS = [
  ["61000000-0000-4000-8000-000000000001", "production", "#dc2626"],
  ["61000000-0000-4000-8000-000000000002", "staging", "#d97706"],
  ["61000000-0000-4000-8000-000000000003", "team-payments", "#7c3aed"],
];
export const BUSY_GROUPS = [
  ["62000000-0000-4000-8000-000000000001", "Checkout"],
  ["62000000-0000-4000-8000-000000000002", "Payments"],
  ["62000000-0000-4000-8000-000000000003", "Storefront"],
];
// The older status page, made by Ada a month ago, and the newer, by Grace.
export const BUSY_STATUS_PAGES = [
  [
    "63000000-0000-4000-8000-000000000001",
    "Acme Commerce Status",
    ADA_ID,
    "2026-10-12T09:00:00.000Z",
  ],
  [
    "63000000-0000-4000-8000-000000000002",
    "Acme Partner Status",
    GRACE_ID,
    "2026-11-02T09:00:00.000Z",
  ],
];
export const BUSY_SERVICES = [
  "cart-api",
  "search-api",
  "payments-api",
  "inventory-worker",
  "storefront-web",
];

/*
 * ?seed=status-page-grid (#7239, #7430): a status page whose resources are
 * laid out in grids, as its Resources screen edits them. "Regions" is a
 * Service by Region grid of three columns (US, EU, Asia Pacific), its cells
 * holding monitors with long English names, with nothing in the Dashboard's
 * EU cell, and two resources whose axis values are off the grid. "Regions
 * worldwide" is the same by six regions, a grid no laptop's box fits.
 */
export const GRID_STATUS_PAGE_ID = "66000000-0000-4000-8000-000000007239";
export const GRID_GROUPS = [
  {
    _id: "66000000-0000-4000-8000-000000000001",
    name: "Regions",
    columns: ["US", "EU", "Asia Pacific"],
  },
  {
    _id: "66000000-0000-4000-8000-000000000002",
    name: "Regions worldwide",
    columns: [
      "US East",
      "US West",
      "EU",
      "Asia Pacific",
      "South America",
      "Africa",
    ],
  },
];
export const GRID_ROWS = ["API", "Dashboard"];

// The id of the grid page's monitor at `index`.
export function gridMonitorId(index) {
  return `67000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function seedStatusPageGrid(store, statuses) {
  store.insert(StatusPage, {
    _id: GRID_STATUS_PAGE_ID,
    name: "Acme Regions Status",
    isArchived: false,
    createdByUserId: new ObjectID(ADA_ID),
    createdAt: new Date("2026-10-20T09:00:00.000Z"),
  });

  let monitorIndex = 0;
  let order = 0;

  const addResource = (group, name, row, column) => {
    const monitorId = gridMonitorId(monitorIndex);
    monitorIndex += 1;
    order += 1;
    store.insert(Monitor, {
      _id: monitorId,
      name,
      monitorType: MonitorType.Website,
      currentMonitorStatusId: new ObjectID(statuses[0]._id),
      currentMonitorStatus: statuses[0],
      createdByUserId: new ObjectID(ADA_ID),
      isAllProbesDisconnectedFromThisMonitor: false,
      isNoProbeEnabledOnThisMonitor: false,
      disableActiveMonitoring: false,
      labels: [],
    });
    store.insert(StatusPageResource, {
      statusPageId: new ObjectID(GRID_STATUS_PAGE_ID),
      statusPageGroupId: new ObjectID(group._id),
      monitorId: new ObjectID(monitorId),
      displayName: name,
      order,
      rowAxisValue: row,
      columnAxisValue: column,
      showCurrentStatus: true,
      showUptimePercent: true,
      showStatusHistoryChart: true,
    });
  };

  GRID_GROUPS.forEach((group, groupIndex) => {
    store.insert(StatusPageGroup, {
      _id: group._id,
      name: group.name,
      statusPageId: new ObjectID(GRID_STATUS_PAGE_ID),
      order: groupIndex + 1,
      isExpandedByDefault: true,
      viewMode: StatusPageGroupViewMode.Grid,
      rowAxisLabel: "Service",
      rowAxisValues: GRID_ROWS.join(", "),
      columnAxisLabel: "Region",
      columnAxisValues: group.columns.join(", "),
    });

    for (const row of GRID_ROWS) {
      for (const column of group.columns) {
        // Nothing in the Dashboard's EU cell.
        if (row === "Dashboard" && column === "EU") {
          continue;
        }
        addResource(
          group,
          row === "API"
            ? `Public REST API health check in ${column}`
            : `Customer dashboard sign-in in ${column}`,
          row,
          column,
        );
      }
    }
  });

  // Off the grid: a service and a region the group does not define.
  addResource(
    GRID_GROUPS[0],
    "Search indexer in Asia Pacific",
    "Search",
    "Asia Pacific",
  );
  addResource(GRID_GROUPS[0], "Billing API on Mars", "API", "Mars");
}

// The id of the busy project's monitor at `index` (0 to 99).
export function busyMonitorId(index) {
  return `64000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function seedBusyProject(store, statuses) {
  const labels = BUSY_LABELS.map(([_id, name, color]) => {
    return store.insert(Label, { _id, name, color: new Color(color) });
  });
  const [production, staging, paymentsTeam] = labels;
  const monitors = [];

  BUSY_COMPONENTS.forEach((component, componentIndex) => {
    BUSY_REGIONS.forEach((region, regionIndex) => {
      const index = componentIndex * BUSY_REGIONS.length + regionIndex;
      // A few not operational, as a project in use has.
      const status =
        index === 13
          ? statuses[2]
          : index % 37 === 5
            ? statuses[1]
            : statuses[0];
      const carried = [region === "ap-south" ? staging : production];

      if (["Billing", "Checkout", "Payments"].includes(component)) {
        carried.push(paymentsTeam);
      }

      monitors.push(
        store.insert(Monitor, {
          _id: busyMonitorId(index),
          name: `${component} ${region}`,
          monitorType: MonitorType.Website,
          currentMonitorStatusId: new ObjectID(status._id),
          currentMonitorStatus: status,
          createdByUserId: new ObjectID(ADA_ID),
          isAllProbesDisconnectedFromThisMonitor: false,
          isNoProbeEnabledOnThisMonitor: false,
          disableActiveMonitoring: false,
          labels: carried.map((label) => {
            return { _id: label._id };
          }),
        }),
      );
    });
  });

  for (const [_id, name] of BUSY_GROUPS) {
    store.insert(MonitorGroup, {
      _id,
      name,
      labels: [{ _id: production._id }],
    });
    for (const monitor of monitors) {
      if (monitor.name.startsWith(`${name} `)) {
        store.insert(MonitorGroupResource, {
          monitorGroupId: new ObjectID(_id),
          monitorId: new ObjectID(monitor._id),
        });
      }
    }
  }

  for (const [_id, name, createdBy, createdAt] of BUSY_STATUS_PAGES) {
    store.insert(StatusPage, {
      _id,
      name,
      isArchived: false,
      createdByUserId: new ObjectID(createdBy),
      createdAt: new Date(createdAt),
    });
  }

  // The older page shows the two us-east monitors of Checkout and Payments.
  [
    monitors.find((monitor) => monitor.name === "Checkout us-east"),
    monitors.find((monitor) => monitor.name === "Payments us-east"),
  ].forEach((monitor, order) => {
    store.insert(StatusPageResource, {
      statusPageId: new ObjectID(BUSY_STATUS_PAGES[0][0]),
      monitorId: new ObjectID(monitor._id),
      displayName: monitor.name,
      order: order + 1,
      showCurrentStatus: true,
      showUptimePercent: true,
      showStatusHistoryChart: true,
    });
  });

  BUSY_SERVICES.forEach((name, index) => {
    store.insert(Service, {
      _id: `65000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name,
      lastSeenAt: store.NOW,
      serviceColor: new Color(
        ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899"][index],
      ),
    });
  });
}

const OWNERS_TEAM_ID = "30000000-0000-4000-8000-000000000001";
const ADMINS_TEAM_ID = "30000000-0000-4000-8000-000000000002";
const MEMBERS_TEAM_ID = "30000000-0000-4000-8000-000000000003";

export function seedNewProject(options) {
  const store = options.createStore({
    projectId: new ObjectID(PROJECT_ID),
    log: options.log,
    journalKey: "__journeyFixtureJournal",
    // ?world=: every device of the world reads the same writes (server.js).
    journalStore: options.world ? worldJournal(options.world) : undefined,
  });
  const projectId = new ObjectID(PROJECT_ID);

  store.insert(Project, {
    _id: PROJECT_ID,
    name: "Acme Commerce",
    projectId: undefined,
    // SMS and calls start off, with nothing in the balance that pays for them.
    enableSmsNotifications: options.seeds.includes("phones"),
    enableCallNotifications: options.seeds.includes("phones"),
    smsOrCallCurrentBalanceInUSDCents: options.seeds.includes("phones")
      ? 2000
      : 0,
  });

  /*
   * On OneUptime Cloud (?billing=on), a card on file: a project that pays,
   * so recharging the balance is a step and not a payment form.
   */
  if (options.billing) {
    store.insert(BillingPaymentMethod, {
      type: "card",
      brand: "visa",
      last4Digits: "4242",
      isDefault: true,
    });
  }

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

  /*
   * Each team's permission, as ProjectService gives a new project's teams:
   * an invitation starts on the Members team, the one holding Project
   * Member for the whole project (DefaultInviteTeamRule). Their ids are
   * their own, so every id the journeys and the docs' screenshots show
   * stays the one it was.
   */
  for (const [id, teamId, permission] of [
    [
      "30000000-0000-4000-8000-000000000011",
      OWNERS_TEAM_ID,
      Permission.ProjectOwner,
    ],
    [
      "30000000-0000-4000-8000-000000000012",
      ADMINS_TEAM_ID,
      Permission.ProjectAdmin,
    ],
    [
      "30000000-0000-4000-8000-000000000013",
      MEMBERS_TEAM_ID,
      Permission.ProjectMember,
    ],
  ]) {
    store.insert(TeamPermission, {
      _id: id,
      teamId: new ObjectID(teamId),
      permission,
      isBlockPermission: false,
      scope: PermissionScope.All,
    });
  }

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
    store.insert(AlertState, {
      name,
      color: new Color(color),
      order,
      ...flags,
    });
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

  /*
   * A monitor Ada made for the shop's address, as Create Monitor or the
   * website guided setup makes it: what a teammate who opens the setup for
   * the same address is told about before anything is made (#7254).
   */
  if (options.seeds.includes("teammate-monitor")) {
    const built = buildWebsiteMonitor({
      address: parseWebsiteAddress(TEAMMATE_MONITOR_ADDRESS),
      isApi: false,
      seeds: {
        operationalStatusId: new ObjectID(statuses[0]._id),
        offlineStatusId: new ObjectID(statuses[2]._id),
        incidentSeverityId: new ObjectID(store.table(IncidentSeverity)[0]._id),
        alertSeverityId: new ObjectID(store.table(AlertSeverity)[0]._id),
      },
      monitoringInterval: GUIDED_SETUP_MONITORING_INTERVAL,
    });
    store.insert(Monitor, {
      _id: TEAMMATE_MONITOR_ID,
      name: "Acme storefront",
      monitorType: MonitorType.Website,
      monitorSteps: built.monitorSteps,
      currentMonitorStatusId: new ObjectID(statuses[0]._id),
      currentMonitorStatus: statuses[0],
      createdByUserId: new ObjectID(ADA_ID),
      isAllProbesDisconnectedFromThisMonitor: false,
      isNoProbeEnabledOnThisMonitor: false,
      disableActiveMonitoring: false,
      labels: [],
    });
  }

  // A status page made earlier, showing nothing yet.
  if (options.seeds.includes("status-page")) {
    store.insert(StatusPage, {
      _id: STATUS_PAGE_ID,
      name: "Acme status",
      isArchived: false,
      createdByUserId: new ObjectID(ADA_ID),
    });
  }

  /*
   * A policy made earlier, with its first level: Ada, paged at once, the
   * next level after 30 minutes - what Create On-Call Policy leaves.
   */
  if (options.seeds.includes("on-call-policy")) {
    store.insert(OnCallDutyPolicy, {
      _id: ON_CALL_POLICY_ID,
      name: "Website on-call",
      isArchived: false,
      createdByUserId: new ObjectID(ADA_ID),
    });
    store.insert(OnCallDutyPolicyEscalationRule, {
      _id: ON_CALL_POLICY_RULE_ID,
      name: "Level 1",
      order: 1,
      escalateAfterInMinutes: 30,
      onCallDutyPolicyId: new ObjectID(ON_CALL_POLICY_ID),
    });
    store.insert(OnCallDutyPolicyEscalationRuleUser, {
      onCallDutyPolicyId: new ObjectID(ON_CALL_POLICY_ID),
      onCallDutyPolicyEscalationRuleId: new ObjectID(ON_CALL_POLICY_RULE_ID),
      userId: new ObjectID(ADA_ID),
    });
  }

  if (options.seeds.includes("busy")) {
    seedBusyProject(store, statuses);
  }

  if (options.seeds.includes("status-page-grid")) {
    seedStatusPageGrid(store, statuses);
  }

  if (options.seeds.includes("ingestion-keys")) {
    for (const key of INGESTION_KEYS) {
      store.insert(TelemetryIngestionKey, {
        ...key,
        lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : undefined,
        createdAt: new Date(key.createdAt),
        updatedAt: new Date(key.createdAt),
      });
    }
  }

  // What this tab wrote before it last reloaded (Store.js).
  store.restore();

  return {
    store,
    projectId,
    statuses,
    ada,
    grace,
    // ?email=off: the server cannot send email yet.
    canSendEmail: options.canSendEmail !== false,
    // ?test=unanswered: a test page keeps paging, acknowledged by nobody.
    isTestPageAnswered: options.isTestPageAnswered !== false,
    // ?billing=on: OneUptime Cloud, which can always send.
    isBillingEnabled: Boolean(options.billing),
    // ?world=: the server state this tab shares with other devices, or null.
    world: options.world || null,
  };
}

/*
 * Who is signed in: Ada, who made the project (a Project Owner), or Grace,
 * a member invited a minute ago (a Project Member). The permissions are the
 * snapshot the API would hand the Dashboard. `admin` is Ada as the
 * self-hosted server's master admin too, on a server with no Twilio
 * (dashboardRoutes' /global-config/sending-status). `viewer` is Grace as a
 * Project Viewer, who reads everything and may create nothing (#7143).
 */
export function signIn(project, who) {
  const isViewer = who === "viewer";
  const isMember = who === "member" || isViewer;
  const isMasterAdmin = who === "admin";
  const user = isMember ? project.grace : project.ada;
  // Who Home's Welcome card is for (dashboardRoutes' /welcome-checklist).
  project.signedInAs = isMember ? "member" : "owner";
  project.isMasterAdmin = isMasterAdmin;
  const held = isViewer
    ? [Permission.Viewer]
    : isMember
      ? [Permission.ProjectMember]
      : [Permission.ProjectOwner];

  UserUtil.setUserId(new ObjectID(user._id));
  UserUtil.setEmail(user.email);
  UserUtil.setName(user.name);
  UserUtil.setIsMasterAdmin(isMasterAdmin);
  UserUtil.isMasterAdmin = () => isMasterAdmin;
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
  // What the API hands over: the project's permissions and the global ones.
  PermissionUtil.getAllPermissions = () => [
    ...held,
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
  ];
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
  const store = project.store;

  return {
    Monitor: async (record) => {
      // A new monitor starts Operational (MonitorService.onCreateSuccess).
      if (!record.currentMonitorStatusId) {
        store.update(Monitor, record._id, {
          currentMonitorStatusId: new ObjectID(project.statuses[0]._id),
        });
      }

      /*
       * Made by who is signed in (DatabaseService stamps createdByUserId): the
       * guided setup looks for this person's own monitor for an address
       * before it makes one (#7059).
       */
      if (!record.createdByUserId) {
        store.update(Monitor, record._id, {
          createdByUserId: new ObjectID(
            project.signedInAs === "member" ? GRACE_ID : ADA_ID,
          ),
        });
      }

      /*
       * Its creator owns it (DatabaseService's auto-owner), and the probes a
       * new monitor starts with check it - each answering at once, as a
       * reachable website does (MonitorProbe's lastMonitoringLog), for the
       * guided setup's first check (#6804).
       */
      store.create(MonitorOwnerUser, {
        monitorId: new ObjectID(record._id),
        userId: new ObjectID(
          project.signedInAs === "member" ? GRACE_ID : ADA_ID,
        ),
      });
      for (const probe of store.table(Probe)) {
        store.create(MonitorProbe, {
          monitorId: new ObjectID(record._id),
          probeId: new ObjectID(probe._id),
          isEnabled: true,
          lastPingAt: store.NOW,
          lastMonitoringLog: {
            step: {
              isOnline: true,
              responseCode: 200,
              responseTimeInMs: 312,
              failureCause: "",
            },
          },
        });
      }
    },

    /*
     * Made by who is signed in (DatabaseService stamps createdByUserId): the
     * status page guided setup looks for this person's own page with the
     * name typed before it makes one (#7252).
     */
    StatusPage: async (record) => {
      if (!record.createdByUserId) {
        store.update(StatusPage, record._id, {
          createdByUserId: new ObjectID(
            project.signedInAs === "member" ? GRACE_ID : ADA_ID,
          ),
        });
      }
    },

    /*
     * OnCallDutyPolicyService: the first responders become the first
     * escalation rule ("Level 1", after 30 minutes), and "Page this policy
     * for every new incident and alert" adds an incident and an alert
     * on-call rule naming the policy.
     */
    OnCallDutyPolicy: async (policy, misc) => {
      const users = (misc.users || []).map(String);
      if (users.length) {
        const rule = store.create(OnCallDutyPolicyEscalationRule, {
          name: "Level 1",
          order: 1,
          escalateAfterInMinutes: 30,
          onCallDutyPolicyId: new ObjectID(policy._id),
        });
        for (const userId of users) {
          store.create(OnCallDutyPolicyEscalationRuleUser, {
            onCallDutyPolicyId: new ObjectID(policy._id),
            onCallDutyPolicyEscalationRuleId: new ObjectID(rule._id),
            userId: new ObjectID(userId),
          });
        }
      }
      if (misc.pageForEveryNewIncidentAndAlert) {
        for (const [RuleType, kind] of [
          [IncidentOnCallRule, "incident"],
          [AlertOnCallRule, "alert"],
        ]) {
          store.create(RuleType, {
            name: `${policy.name}: every new ${kind}`,
            isEnabled: true,
            onCallDutyPolicies: [{ _id: policy._id }],
          });
        }
      }
    },

    /*
     * Outside the product, the person puts the key in their app and starts
     * it: its first telemetry arrives at once, and the service it names
     * reports (lastSeenAt) - what the setup guide's last step waits for.
     * The app sends traces, metrics and logs, as the guide sets it up, and
     * the server keeps the project's first data of each kind once it is
     * stored (TelemetryMilestones): what the telemetry pages and the
     * guided setup's Get alerted read.
     */
    TelemetryIngestionKey: async (key) => {
      // The secret the server makes for every new key.
      store.update(TelemetryIngestionKey, key._id, {
        secretKey: new ObjectID("a0000000-0000-4000-8000-000000006831"),
      });
      store.create(Service, {
        _id: SERVICE_ID,
        name: "checkout-api",
        lastSeenAt: store.NOW,
        serviceColor: new Color("#6366f1"),
      });
      for (const milestone of [
        "first_traces_received",
        "first_metrics_received",
        "first_logs_received",
      ]) {
        if (
          !store.table(ProjectMilestone).some((mark) => {
            return mark.milestone === milestone;
          })
        ) {
          store.create(ProjectMilestone, {
            milestone: milestone,
            reachedAt: store.NOW,
            wasBackfilled: false,
          });
        }
      }
    },

    /*
     * UserCallService: a number already verified for SMS by this person is
     * verified for calls with no second code (the on-call guided setup's
     * "one number, one code", #6805).
     */
    UserCall: async (record) => {
      const provenBySms = store.table(UserSMS).some((sms) => {
        return (
          sms.isVerified &&
          String(sms.userId) === String(record.userId) &&
          String(sms.phone) === String(record.phone)
        );
      });
      if (provenBySms) {
        store.update(UserCall, record._id, { isVerified: true });
      }
    },

    /*
     * TeamMemberService: an invitation by address (Users' Invite User, and
     * the on-call guided setup's "Invite by email", #7150) finds the user
     * with that email or makes one, who has not accepted yet. Nothing is
     * said about which it was.
     */
    TeamMember: async (record, misc) => {
      const email = String(misc.email || "");
      if (!email || record.userId) {
        return;
      }
      let user = store.table(User).find((candidate) => {
        return String(candidate.email) === email;
      });
      if (!user) {
        user = store.create(User, { email: new Email(email) });
      }
      store.update(TeamMember, record._id, {
        userId: new ObjectID(user._id),
        hasAcceptedInvitation: false,
      });
    },

    /*
     * OnCallDutyPolicyEscalationRuleService: a rule sent with no order is
     * the policy's next level (one past its rules before it), and its
     * responders become join rows.
     */
    OnCallDutyPolicyEscalationRule: async (rule, misc) => {
      if (!rule.order) {
        const before = store
          .table(OnCallDutyPolicyEscalationRule)
          .filter((other) => {
            return (
              String(other.onCallDutyPolicyId) ===
                String(rule.onCallDutyPolicyId) &&
              String(other._id) !== String(rule._id)
            );
          }).length;
        store.update(OnCallDutyPolicyEscalationRule, rule._id, {
          order: before + 1,
        });
      }
      for (const userId of (misc.users || []).map(String)) {
        store.create(OnCallDutyPolicyEscalationRuleUser, {
          onCallDutyPolicyId: rule.onCallDutyPolicyId,
          onCallDutyPolicyEscalationRuleId: new ObjectID(rule._id),
          userId: new ObjectID(userId),
        });
      }
    },
  };
}

/*
 * A code typed into a Verify dialog: the fixture's server sends none, so
 * the code is the one the journeys type.
 */
export const VERIFICATION_CODE = "123456";

const VERIFIED_BY_ROUTE = {
  "user-call": UserCall,
  "user-sms": UserSMS,
};

/*
 * On-Call Readiness for one person (OnCallReadinessService): their
 * notification methods, each verified or not, and reachable while one is.
 */
function readinessOf(store, userId) {
  const user = store.find(User, userId);
  const methods = [];
  for (const [ModelType, methodType, column] of [
    [UserEmail, "Email", "email"],
    [UserSMS, "SMS", "phone"],
    [UserCall, "Call", "phone"],
  ]) {
    for (const row of store.table(ModelType)) {
      if (String(row.userId) !== String(userId)) {
        continue;
      }
      const value = String(row[column] || "");
      methods.push({
        methodId: String(row._id),
        methodType,
        maskedIdentifier: `•••${value.slice(-4)}`,
        isVerified: Boolean(row.isVerified),
      });
    }
  }
  const isReachable = methods.some((method) => {
    return method.isVerified;
  });
  return {
    userId: String(userId),
    // As the server names someone invited by address: by it, until they sign up.
    userName: user ? String(user.name || user.email || "") : "",
    userEmail: user ? String(user.email) : "",
    status: isReachable ? "Ready" : "NotReachable",
    methods,
    coverage: [],
    reasons: [],
    reachedVia: ["Direct"],
    teams: [],
  };
}

/*
 * A policy's test page preview (OnCallTestPageService.preview): the people
 * its first escalation rule pages, each by every method they verified, at
 * once - what a verified method's default notification rules say. Nothing
 * a test of the first level sends here is paid for.
 */
function policyPreviewOf(store, policyId) {
  const rules = store
    .table(OnCallDutyPolicyEscalationRule)
    .filter((rule) => {
      return String(rule.onCallDutyPolicyId) === policyId;
    })
    .sort((a, b) => {
      return Number(a.order || 0) - Number(b.order || 0);
    });
  const first = rules[0];
  const userIds = [];
  for (const row of store.table(OnCallDutyPolicyEscalationRuleUser)) {
    const userId = String(row.userId);
    if (
      first &&
      String(row.onCallDutyPolicyEscalationRuleId) === String(first._id) &&
      !userIds.includes(userId)
    ) {
      userIds.push(userId);
    }
  }
  return {
    kind: "Policy",
    levelCount: rules.length,
    people: userIds.map((userId) => {
      const readiness = readinessOf(store, userId);
      return {
        userId,
        userName: readiness.userName,
        methods: readiness.methods
          .filter((method) => {
            return method.isVerified;
          })
          .map((method) => {
            return {
              channel: method.methodType,
              notifyAfterMinutes: 0,
              isVerified: true,
              canAcknowledge: true,
            };
          }),
        hasNoRule: false,
        isOptedOut: false,
        warnings: [],
      };
    }),
    notPaged: [],
    cost: {
      isPaid: false,
      smsCount: 0,
      callCount: 0,
      whatsAppCount: 0,
      telegramCount: 0,
    },
  };
}

// The API's own routes the journeys' pages call, answered for a new project.
export function dashboardRoutes(project) {
  const store = project.store;
  // What the owner said they came to do (Home's question); null until then.
  let goals = null;

  const welcomeAnswer = () => {
    if (project.signedInAs === "member") {
      return {
        audience: WelcomeAudience.InvitedMember,
        goals: null,
        steps: [],
      };
    }

    const checklist = buildWelcomeChecklist({
      goals,
      facts: {
        reached: [],
        hasPolicyThatPagesSomeone: false,
        hasFinishedImport: false,
      },
      plan: { isFreePlan: false },
    });

    return {
      audience: WelcomeAudience.SetUp,
      goals,
      shouldAskForGoals: goals === null,
      canChooseGoals: true,
      isHiddenForMe: false,
      isFinished: false,
      canSendEmail: project.canSendEmail,
      steps: checklist.steps,
      doneCount: checklist.doneCount,
      totalCount: checklist.totalCount,
    };
  };

  /*
   * EACH GUIDED SETUP'S RUN, AS THE SERVER KEEPS IT (#7253: GuidedSetupRunAPI),
   * merged by the real rules (Common/Types/GuidedSetup/GuidedSetupRun): in the
   * world when the tab names one (?world=, server.js), so a second browser
   * context is a second device of the same person; in the tab's
   * sessionStorage otherwise, so a reload reads it as a server would. The
   * spec forgets them (window.__journeyFixture.guidedSetupRuns.forget()) to
   * play a run the server never had - an older Dashboard's, kept in one
   * browser.
   */
  const RUNS_KEY = "__journeyFixtureGuidedSetupRuns";
  const readRuns = () => {
    if (project.world) {
      return readWorld(project.world, "guided-setup-runs") || {};
    }
    try {
      return JSON.parse(window.sessionStorage.getItem(RUNS_KEY) || "{}");
    } catch {
      return {};
    }
  };
  const writeRuns = (runs) => {
    if (project.world) {
      writeWorld(project.world, "guided-setup-runs", runs);
      return;
    }
    try {
      window.sessionStorage.setItem(RUNS_KEY, JSON.stringify(runs));
    } catch {
      // A tab without storage keeps nothing: every page opens afresh.
    }
  };
  const setupOf = (url) => {
    return url.pathname.split("/guided-setup-run/")[1].split("/")[0];
  };

  if (window.__journeyFixture) {
    window.__journeyFixture.guidedSetupRuns = {
      read: readRuns,
      forget: () => {
        writeRuns({});
      },
    };
  }

  return [
    [
      "GET",
      /\/guided-setup-run\/[a-z_]+$/,
      ({ url }) => {
        const setup = setupOf(url);
        return ok({ setup, run: readRuns()[setup] || null });
      },
    ],
    [
      "POST",
      /\/guided-setup-run\/[a-z_]+\/forget$/,
      ({ url }) => {
        const setup = setupOf(url);
        const runs = readRuns();
        delete runs[setup];
        writeRuns(runs);
        return ok({ setup, run: null });
      },
    ],
    [
      "POST",
      /\/guided-setup-run\/[a-z_]+$/,
      ({ url, body }) => {
        const setup = setupOf(url);
        let change = null;
        try {
          change = parseGuidedSetupRunChange(body);
        } catch (error) {
          return fail(400, error.message);
        }
        const runs = readRuns();
        const current = runs[setup] || null;
        const merged = applyGuidedSetupRunChange({
          values: current ? current.values : {},
          resources: current ? current.resources : {},
          change,
          now: store.NOW,
        });
        if (
          Object.keys(merged.values).length === 0 &&
          Object.keys(merged.resources).length === 0
        ) {
          delete runs[setup];
        } else {
          runs[setup] = {
            ...merged,
            revision: (current ? current.revision : 0) + 1,
            updatedAt: store.NOW.toISOString(),
          };
        }
        writeRuns(runs);
        return ok({ setup, run: runs[setup] || null });
      },
    ],
    [
      /*
       * Home's Welcome card (issue #6803), built with the real rules: a
       * project made a minute ago whose owner has not said yet what they
       * came to do sees the question; an invited member sees nothing (their
       * own first hour is #6807). Most journeys go by the products menu, as a
       * newcomer who skips the card does; the on-call guided setup's answers
       * it (#6805), and the checklist then follows the goals picked.
       */
      "GET",
      "/welcome-checklist",
      () => {
        return ok(welcomeAnswer());
      },
    ],
    [
      /*
       * Adding a number sends it a code (UserCallService, UserSmsService):
       * the Verify dialog finds one waiting, ten minutes to use it.
       */
      "POST",
      /\/(user-call|user-sms)\/verification-status$/,
      ({ url, body }) => {
        const route = url.pathname.split("/").slice(-2)[0];
        const record = store.find(VERIFIED_BY_ROUTE[route], body.itemId);
        return ok({
          isVerified: Boolean(record && record.isVerified),
          codeState: "active",
          codeSentAt: store.NOW.toISOString(),
          codeExpiresAt: new Date(
            store.NOW.getTime() + 10 * 60 * 1000,
          ).toISOString(),
          resendAvailableInSeconds: 0,
          cannotSendReason: null,
        });
      },
    ],
    [
      "POST",
      /\/(user-call|user-sms)\/resend-verification-code$/,
      () => {
        return ok({});
      },
    ],
    [
      "POST",
      /\/(user-call|user-sms)\/verify$/,
      ({ url, body }) => {
        const route = url.pathname.split("/").slice(-2)[0];
        const ModelType = VERIFIED_BY_ROUTE[route];
        if (String(body.code) !== VERIFICATION_CODE) {
          return fail(400, "Invalid verification code.");
        }
        const record = store.table(ModelType).find((candidate) => {
          return String(candidate._id) === String(body.itemId);
        });
        if (record) {
          store.update(
            ModelType,
            record._id,
            { isVerified: true },
            {
              kind: "update",
              table: store.tableName(ModelType),
            },
          );
        }
        return ok({});
      },
    ],
    [
      // Home's question answered: the checklist follows the goals picked.
      "POST",
      "/welcome-checklist/goals",
      ({ body }) => {
        goals = Array.isArray(body.goals) ? body.goals.map(String) : [];
        return ok(welcomeAnswer());
      },
    ],
    [
      // Whether a page reaches me (OnCallReadinessAPI), for the guided setup.
      "GET",
      /\/on-call-readiness\/user\/[0-9a-f-]+$/,
      ({ url }) => {
        return ok(readinessOf(store, url.pathname.split("/").pop()));
      },
    ],
    [
      // Whether a page reaches each person a policy pages.
      "GET",
      /\/on-call-readiness\/policy\/[0-9a-f-]+$/,
      ({ url }) => {
        const policyId = url.pathname.split("/").pop();
        const userIds = [];
        for (const row of store.table(OnCallDutyPolicyEscalationRuleUser)) {
          const userId = String(row.userId);
          if (
            String(row.onCallDutyPolicyId) === policyId &&
            !userIds.includes(userId)
          ) {
            userIds.push(userId);
          }
        }
        const users = userIds.map((userId) => {
          return readinessOf(store, userId);
        });
        return ok({
          projectId: PROJECT_ID,
          onCallDutyPolicyId: policyId,
          readyCount: users.filter((user) => {
            return user.status === "Ready";
          }).length,
          partiallyReadyCount: 0,
          notReachableCount: users.filter((user) => {
            return user.status === "NotReachable";
          }).length,
          isFallbackEnabled: true,
          isTruncated: false,
          users,
          hasMore: false,
          totalCount: users.length,
        });
      },
    ],
    [
      "POST",
      "/notification/recharge",
      ({ body }) => {
        store.update(
          Project,
          PROJECT_ID,
          {
            smsOrCallCurrentBalanceInUSDCents: Number(body.amount || 0) * 100,
          },
          { kind: "update", table: "Project" },
        );
        return ok({});
      },
    ],
    [
      // No budget set and nothing ingested: no banner over the explorers.
      "GET",
      "/telemetry-ingestion-budget/project",
      () => {
        return ok({
          dayStartsAt: store.NOW.toISOString(),
          resetsAt: new Date(
            store.NOW.getTime() + 14 * 60 * 60 * 1000,
          ).toISOString(),
          resetTime: "00:00",
          timezone: "UTC",
          warningPercent: 80,
          countersAvailable: true,
          project: { scope: "project", signals: [] },
          ingestionKeys: [],
        });
      },
    ],
    [
      // The attribute keys a Logs or Traces monitor's filters offer.
      "POST",
      /\/telemetry\/(logs|traces)\/get-attributes$/,
      () => {
        return ok({ attributes: [] });
      },
    ],
    [
      /*
       * What a telemetry rule would have caught in the window before now
       * (TelemetryAPI's monitor-preview): the first logs, just in.
       */
      "POST",
      /\/telemetry\/(logs|traces|exceptions)\/monitor-preview$/,
      () => {
        return ok({
          buckets: [],
          windowInSeconds: 60,
          startTime: new Date(
            store.NOW.getTime() - 60 * 60 * 1000,
          ).toISOString(),
          endTime: store.NOW.toISOString(),
        });
      },
    ],
    [
      "GET",
      "/notification/auto-recharge-state",
      () => {
        return ok({});
      },
    ],
    [
      "POST",
      "/custom-notification-channel/available",
      () => {
        return ok({ channels: [] });
      },
    ],
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
          // ?email=off: a server whose admin has not set email up yet.
          ...(project.canSendEmail ? {} : { canSendEmail: false }),
        });
      },
    ],
    /*
     * Whether the server can send email, SMS and calls (GET
     * /project-can-send, #7151), which any member of the project may ask
     * before they set up a way to be reached: OneUptime Cloud always can;
     * this self-hosted server sends SMS and calls, but for Ada's server as
     * its master admin, which has no Twilio (?as=admin), and email unless
     * its admin has not set it up (?email=off). Never why: that stays the
     * master admins' (/global-config/sending-status, below).
     */
    [
      "GET",
      "/project-can-send",
      () => {
        if (project.isBillingEnabled) {
          return ok({ email: true, sms: true, call: true });
        }

        return ok({
          email: project.canSendEmail,
          sms: !project.isMasterAdmin,
          call: !project.isMasterAdmin,
        });
      },
    ],
    /*
     * What the server can send (ServerSendingStatusLoader), asked by a
     * master admin only: a self-hosted server with no Twilio, so no SMS
     * and no calls (?as=admin).
     */
    [
      "GET",
      "/global-config/sending-status",
      () => {
        return ok({
          channels: [
            { channel: "email", state: "working", hasWorked: true },
            { channel: "sms", state: "not-set-up", hasWorked: false },
            { channel: "call", state: "not-set-up", hasWorked: false },
            { channel: "push", state: "working", hasWorked: true },
          ],
          globalProbes: null,
        });
      },
    ],
    /*
     * A test page to the person themselves (OnCallTestPageAPI, #6811): what
     * it will send - Ada's verified email - then the run, acknowledged from
     * the email at once. A policy's test (the guided setup's summary reads
     * it for the order a page reaches each person, #7154) pages its first
     * level: each person by every method they verified, at once, as a new
     * method's default rules do (UserNotificationRuleService).
     */
    [
      "POST",
      "/on-call-test-page/preview",
      ({ body }) => {
        if (body.policyId) {
          return ok(policyPreviewOf(store, String(body.policyId)));
        }
        return ok({
          kind: "Self",
          people: [
            {
              userId: ADA_ID,
              userName: "Ada Lovelace",
              methods: [
                {
                  channel: "Email",
                  address: "ada@example.com",
                  notifyAfterMinutes: 0,
                  isVerified: true,
                  canAcknowledge: true,
                },
              ],
              hasNoRule: false,
              isOptedOut: false,
              warnings: [],
            },
          ],
          notPaged: [],
          cost: {
            isPaid: false,
            smsCount: 0,
            callCount: 0,
            whatsAppCount: 0,
            telegramCount: 0,
          },
        });
      },
    ],
    [
      // A test of a policy (the on-call guided setup's last step, #6805).
      "POST",
      "/on-call-test-page/page-policy",
      () => {
        return ok({ executionLogId: TEST_PAGE_LOG_ID });
      },
    ],
    [
      "POST",
      "/on-call-test-page/page-person",
      () => {
        return ok({ executionLogId: TEST_PAGE_LOG_ID });
      },
    ],
    [
      "GET",
      /\/on-call-test-page\/result\/[0-9a-f-]+$/,
      () => {
        /*
         * ?test=unanswered: the email went out and nobody acknowledged it,
         * so the test is still paging (the setup's "I did not get it").
         */
        if (!project.isTestPageAnswered) {
          return ok({
            executionLogId: TEST_PAGE_LOG_ID,
            kind: "Self",
            recordKind: "Incident",
            severityName: "Critical",
            walksEscalation: false,
            status: "Paging",
            statusMessage: "Paging Ada Lovelace.",
            startedAt: store.NOW.toISOString(),
            endsAt: new Date(
              store.NOW.getTime() + 30 * 60 * 1000,
            ).toISOString(),
            steps: [
              {
                id: "81000000-0000-4000-8000-000000006804",
                userId: ADA_ID,
                userName: "Ada Lovelace",
                status: "Paged",
                statusMessage: "Paged.",
                deliveries: [
                  {
                    id: "82000000-0000-4000-8000-000000006804",
                    channel: "Email",
                    address: "ada@acme-commerce.example",
                    status: "Sent",
                    statusMessage: "Email sent.",
                    canAcknowledge: true,
                    sentAt: store.NOW.toISOString(),
                  },
                ],
              },
            ],
          });
        }
        return ok({
          executionLogId: TEST_PAGE_LOG_ID,
          kind: "Self",
          recordKind: "Incident",
          severityName: "Critical",
          walksEscalation: false,
          status: "Acknowledged",
          statusMessage: "Test page acknowledged.",
          startedAt: store.NOW.toISOString(),
          endsAt: new Date(store.NOW.getTime() + 30 * 60 * 1000).toISOString(),
          acknowledgedByName: "Ada Lovelace",
          acknowledgedChannel: "Email",
          acknowledgedAfterSeconds: 14,
          steps: [],
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
