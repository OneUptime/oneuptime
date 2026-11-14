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
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import UserEmail from "Common/Models/DatabaseModels/UserEmail";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import BillingPaymentMethod from "Common/Models/DatabaseModels/BillingPaymentMethod";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import IncidentOnCallRule from "Common/Models/DatabaseModels/IncidentOnCallRule";
import AlertOnCallRule from "Common/Models/DatabaseModels/AlertOnCallRule";
import UserCall from "Common/Models/DatabaseModels/UserCall";
import UserSMS from "Common/Models/DatabaseModels/UserSMS";
import Service from "Common/Models/DatabaseModels/Service";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
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
import { fail, ok } from "./Store";

export const PROJECT_ID = "10000000-0000-4000-8000-000000006831";
export const ADA_ID = "40000000-0000-4000-8000-000000000001";
export const GRACE_ID = "40000000-0000-4000-8000-000000000002";
export const MONITOR_ID = "50000000-0000-4000-8000-000000000001";
export const SERVICE_ID = "50000000-0000-4000-8000-000000000002";
// The test page a guided setup sends (#6804): its run, acknowledged at once.
export const TEST_PAGE_LOG_ID = "80000000-0000-4000-8000-000000006804";

const OWNERS_TEAM_ID = "30000000-0000-4000-8000-000000000001";
const ADMINS_TEAM_ID = "30000000-0000-4000-8000-000000000002";
const MEMBERS_TEAM_ID = "30000000-0000-4000-8000-000000000003";

export function seedNewProject(options) {
  const store = options.createStore({
    projectId: new ObjectID(PROJECT_ID),
    log: options.log,
    journalKey: "__journeyFixtureJournal",
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

  // What this tab wrote before it last reloaded (Store.js).
  store.restore();

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
  // Who Home's Welcome card is for (dashboardRoutes' /welcome-checklist).
  project.signedInAs = isMember ? "member" : "owner";
  const held = isMember
    ? [Permission.ProjectMember]
    : [Permission.ProjectOwner];

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

    // OnCallDutyPolicyEscalationRuleService: its responders become join rows.
    OnCallDutyPolicyEscalationRule: async (rule, misc) => {
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
    userName: user ? String(user.name) : "",
    userEmail: user ? String(user.email) : "",
    status: isReachable ? "Ready" : "NotReachable",
    methods,
    coverage: [],
    reasons: [],
    reachedVia: ["Direct"],
    teams: [],
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
        hasRuleThatPagesSomeone: false,
        hasFinishedImport: false,
        serverCanSendEmail: true,
      },
      plan: { isFreePlan: false },
      readerIsServerAdmin: false,
    });

    return {
      audience: WelcomeAudience.SetUp,
      goals,
      shouldAskForGoals: goals === null,
      canChooseGoals: true,
      isHiddenForMe: false,
      isFinished: false,
      canSendEmail: true,
      steps: checklist.steps,
      doneCount: checklist.doneCount,
      totalCount: checklist.totalCount,
    };
  };

  return [
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
        });
      },
    ],
    /*
     * A test page to the person themselves (OnCallTestPageAPI, #6811): what
     * it will send - Ada's verified email - then the run, acknowledged from
     * the email at once.
     */
    [
      "POST",
      "/on-call-test-page/preview",
      () => {
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
