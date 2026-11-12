/*
 * The resolver renders titles through MonitorTemplateUtil, which pulls the
 * native isolated-vm addon in through VMAPI. Nothing here runs the sandbox,
 * and the prebuilt binary cannot always load in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import ServiceOwnerUser from "../../../Models/DatabaseModels/ServiceOwnerUser";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertOwnerRuleService from "../../../Server/Services/AlertOwnerRuleService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentOwnerRuleService from "../../../Server/Services/IncidentOwnerRuleService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import NetworkDeviceOwnerUserService, {
  NetworkDeviceOwners,
} from "../../../Server/Services/NetworkDeviceOwnerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  ReadinessStatus,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import OnCallTestPageService from "../../../Server/Services/OnCallTestPageService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import ServiceOwnerTeamService from "../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../Server/Services/ServiceOwnerUserService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import WhoIsToldService, {
  canServerSendBy,
  getMonitorCriteria,
  getMonitorCriteriaInstances,
  pickSeverity,
} from "../../../Server/Services/WhoIsToldService";
import MonitorResourceContextUtil from "../../../Server/Utils/Monitor/MonitorResourceContext";
import { SeriesResolvedResourceIds } from "../../../Server/Utils/Monitor/SeriesResourceLinker";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  WhoIsToldBreak,
  WhoIsToldBreakKind,
  WhoIsToldEvent,
  WhoIsToldOwnersSource,
  WhoIsToldPersonProblem,
  WhoIsToldResult,
  WhoIsToldServerChannel,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageNotPaged,
  OnCallTestPageNotPagedCode,
  OnCallTestPagePreviewPerson,
  OnCallTestPageReachedThrough,
  OnCallTestPageReachedThroughCode,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE RESOLVER (WhoIsToldService, #6810): from a monitor's criteria to the
 * people they reach, read without sending or changing anything, and handed
 * to each caller as they may see it.
 *
 * Every read is stubbed with the project's records: the criteria, the
 * severities and statuses, the rules the engines' matching returns, each
 * policy's first level (as a test of the policy reads it), each person's
 * rules and verified methods, the project's channels and the server's. The
 * owner rules are the project's own rows, run through the owner rule
 * engines' real plan (#7076), and the status pages are found by the real
 * IncidentStatusPageScope over the project's status page resources and
 * monitor groups (#7077).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "68101111-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: string = "68101111-0000-4000-8000-000000000009";
const MONITOR_ID: ObjectID = new ObjectID(
  "68101111-0000-4000-8000-000000000002",
);
const STEP_ID: string = "68101111-0000-4000-8000-000000000003";
const CRITICAL: string = "68101111-0000-4000-8000-0000000000b1";
const MINOR: string = "68101111-0000-4000-8000-0000000000b2";
const ARCHIVED_SEVERITY: string = "68101111-0000-4000-8000-0000000000b0";
const ALERT_WARNING: string = "68101111-0000-4000-8000-0000000000e1";
const OFFLINE: string = "68101111-0000-4000-8000-0000000000f1";
const ONLINE: string = "68101111-0000-4000-8000-0000000000f2";
const PRIMARY: string = "68101111-0000-4000-8000-0000000000a1";
const SECONDARY: string = "68101111-0000-4000-8000-0000000000a2";
const ELSEWHERE_POLICY: string = "68101111-0000-4000-8000-0000000000a9";
const RULE: string = "68101111-0000-4000-8000-0000000000c1";
const ANA: string = "68101111-0000-4000-8000-0000000000d1";
const BEN: string = "68101111-0000-4000-8000-0000000000d2";
const CARA: string = "68101111-0000-4000-8000-0000000000d3";
const DAN: string = "68101111-0000-4000-8000-0000000000d4";
const PLATFORM_TEAM: string = "68101111-0000-4000-8000-000000000071";
const SRE_TEAM: string = "68101111-0000-4000-8000-000000000072";
const ELSEWHERE_TEAM: string = "68101111-0000-4000-8000-000000000079";
const OWNER_RULE: string = "68101111-0000-4000-8000-000000000061";
const OTHER_OWNER_RULE: string = "68101111-0000-4000-8000-000000000062";
const ALERT_OWNER_RULE: string = "68101111-0000-4000-8000-000000000063";
const STATUS_PAGE: string = "68101111-0000-4000-8000-000000000051";
const GROUP_PAGE: string = "68101111-0000-4000-8000-000000000052";
const SCOPED_ONLY_PAGE: string = "68101111-0000-4000-8000-000000000053";
const NO_INCIDENTS_PAGE: string = "68101111-0000-4000-8000-000000000054";
const ELSEWHERE_PAGE: string = "68101111-0000-4000-8000-000000000055";
const ARCHIVED_PAGE: string = "68101111-0000-4000-8000-000000000056";
const MONITOR_GROUP: string = "68101111-0000-4000-8000-000000000081";
const SERVICE: string = "68101111-0000-4000-8000-000000000091";
const MONITOR_LABEL: string = "68101111-0000-4000-8000-000000000041";
const INCIDENT_LABEL: string = "68101111-0000-4000-8000-000000000042";

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("68101111-0000-4000-8000-0000000000ff"),
};

// The project's people and teams, by id.
const PEOPLE: Record<string, string> = {
  [ANA]: "Ana Lopez",
  [BEN]: "Ben Ito",
  [CARA]: "Cara Diaz",
  [DAN]: "Dan Okafor",
};
const TEAMS: Record<string, string> = {
  [PLATFORM_TEAM]: "Platform",
  [SRE_TEAM]: "Checkout SRE",
};
// A team of another project.
const ELSEWHERE_TEAMS: Record<string, string> = {
  [ELSEWHERE_TEAM]: "Another company",
};

function withId<T extends { _id?: string | undefined }>(
  item: T,
  id: string,
): T {
  item._id = id;
  return item;
}

function criteriaInstance(
  data: Record<string, unknown>,
): MonitorCriteriaInstance {
  return {
    data: {
      filterCondition: "All",
      filters: [],
      incidents: [],
      alerts: [],
      description: "",
      ...data,
    },
  } as unknown as MonitorCriteriaInstance;
}

/*
 * A monitor's steps, each with its criteria. The first step carries STEP_ID,
 * as a step of a saved monitor carries its own.
 */
function stepsOf(
  ...steps: Array<Array<MonitorCriteriaInstance>>
): MonitorSteps {
  return {
    data: {
      monitorStepsInstanceArray: steps.map(
        (instances: Array<MonitorCriteriaInstance>, index: number): unknown => {
          const stepId: string =
            index === 0
              ? STEP_ID
              : `68101111-0000-4000-8000-00000000030${index}`;

          return {
            id: new ObjectID(stepId),
            data: {
              id: stepId,
              monitorCriteria: {
                data: { monitorCriteriaInstanceArray: instances },
              },
            },
          };
        },
      ),
    },
  } as unknown as MonitorSteps;
}

const ONLINE_CRITERIA: MonitorCriteriaInstance = criteriaInstance({
  id: "online",
  name: "Online",
  monitorStatusId: new ObjectID(ONLINE),
  changeMonitorStatus: true,
});

function incidentTemplate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "incident-template",
    title: "Checkout API is down",
    description: "",
    incidentSeverityId: new ObjectID(CRITICAL),
    ...overrides,
  };
}

function alertTemplate(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "alert-template",
    title: "Checkout API is down",
    description: "",
    alertSeverityId: new ObjectID(ALERT_WARNING),
    ...overrides,
  };
}

function offlineCriteria(
  overrides: Record<string, unknown> = {},
): MonitorCriteriaInstance {
  return criteriaInstance({
    id: "offline",
    name: "Offline",
    monitorStatusId: new ObjectID(OFFLINE),
    changeMonitorStatus: true,
    createIncidents: true,
    incidents: [incidentTemplate()],
    ...overrides,
  });
}

// A criteria that opens these incidents and nothing else.
function opensIncidents(
  ...templates: Array<Record<string, unknown>>
): MonitorSteps {
  return stepsOf([offlineCriteria({ incidents: templates })]);
}

function opensAlerts(
  ...templates: Array<Record<string, unknown>>
): MonitorSteps {
  return stepsOf([
    criteriaInstance({
      id: "offline",
      name: "Offline",
      createAlerts: true,
      alerts: templates,
    }),
  ]);
}

function user(name: string, email: string): User {
  const item: User = new User();
  item.name = name as never;
  item.email = email as never;
  return item;
}

function ids(values: Array<string>): Array<ObjectID> {
  return values.map((value: string): ObjectID => {
    return new ObjectID(value);
  });
}

function preview(
  overrides: Partial<OnCallTestPagePreviewPerson>,
): OnCallTestPagePreviewPerson {
  return {
    userId: ANA,
    userName: "Ana Lopez",
    methods: [],
    hasNoRule: false,
    isOptedOut: false,
    warnings: [],
    ...overrides,
  };
}

function readiness(userId: string, verified: Array<string>): UserReadiness {
  return {
    userId: new ObjectID(userId),
    userName: "",
    userEmail: "",
    status: ReadinessStatus.Ready,
    methods: verified.map((methodType: string) => {
      return {
        methodId: ObjectID.generate(),
        methodType: methodType,
        maskedIdentifier: "•••",
        isVerified: true,
      };
    }),
    coverage: [],
    reasons: [],
    reachedVia: [],
    teams: [],
  };
}

// What an owner rule asks for, as the rule form saves it.
interface OwnerRuleFacts {
  id: string;
  name: string;
  userIds?: Array<string>;
  teamIds?: Array<string>;
  notifyOwners?: boolean;
  titlePattern?: string;
  monitorNamePattern?: string;
  monitorLabelIds?: Array<string>;
  labelIds?: Array<string>;
  inheritOwnersFromMonitors?: boolean;
  inheritOwnersFromServices?: boolean;
}

function incidentOwnerRule(facts: OwnerRuleFacts): IncidentOwnerRule {
  const rule: IncidentOwnerRule = withId(new IncidentOwnerRule(), facts.id);
  rule.name = facts.name;
  rule.projectId = PROJECT_ID;
  rule.isEnabled = true;
  rule.notifyOwners = facts.notifyOwners ?? true;
  rule.monitors = [];
  rule.incidentSeverities = [];
  rule.incidentLabels = (facts.labelIds || []).map((id: string): Label => {
    return withId(new Label(), id);
  });
  rule.monitorLabels = (facts.monitorLabelIds || []).map(
    (id: string): Label => {
      return withId(new Label(), id);
    },
  );
  rule.ownerUsers = (facts.userIds || []).map((id: string): User => {
    return withId(new User(), id);
  });
  rule.ownerTeams = (facts.teamIds || []).map((id: string): Team => {
    return withId(new Team(), id);
  });

  if (facts.titlePattern) {
    rule.incidentTitlePattern = facts.titlePattern;
  }

  if (facts.monitorNamePattern) {
    rule.monitorNamePattern = facts.monitorNamePattern;
  }

  rule.inheritOwnersFromMonitors = Boolean(facts.inheritOwnersFromMonitors);
  rule.inheritOwnersFromServices = Boolean(facts.inheritOwnersFromServices);
  return rule;
}

function alertOwnerRule(facts: OwnerRuleFacts): AlertOwnerRule {
  const rule: AlertOwnerRule = withId(new AlertOwnerRule(), facts.id);
  rule.name = facts.name;
  rule.projectId = PROJECT_ID;
  rule.isEnabled = true;
  rule.notifyOwners = facts.notifyOwners ?? true;
  rule.monitors = [];
  rule.alertSeverities = [];
  rule.alertLabels = (facts.labelIds || []).map((id: string): Label => {
    return withId(new Label(), id);
  });
  rule.monitorLabels = [];
  rule.ownerUsers = (facts.userIds || []).map((id: string): User => {
    return withId(new User(), id);
  });
  rule.ownerTeams = (facts.teamIds || []).map((id: string): Team => {
    return withId(new Team(), id);
  });

  if (facts.titlePattern) {
    rule.alertTitlePattern = facts.titlePattern;
  }

  rule.inheritOwnersFromMonitors = Boolean(facts.inheritOwnersFromMonitors);
  rule.inheritOwnersFromServices = Boolean(facts.inheritOwnersFromServices);
  return rule;
}

// A status page resource: the page lists the monitor, or a group it is in.
interface StatusPageLink {
  resourceId: string;
  statusPageId: string;
  monitorGroupId?: string;
}

// A status page as the subscriber read loads it (never an archived one).
interface StatusPageFacts {
  id: string;
  name: string;
  projectId?: string;
  showIncidentsOnStatusPage?: boolean;
  onlyShowScopedIncidents?: boolean;
}

interface World {
  monitorSteps: MonitorSteps;
  monitorName: string;
  monitorLabelIds: Array<string>;
  project: Partial<Project>;
  incidentRules: Array<IncidentOnCallRule>;
  alertRules: Array<AlertOnCallRule>;
  incidentRuleCount: number;
  alertRuleCount: number;
  incidentOwnerRules: Array<IncidentOwnerRule>;
  alertOwnerRules: Array<AlertOwnerRule>;
  // The owners of the network device the monitor watches.
  deviceOwners: NetworkDeviceOwners;
  // The monitor's own owners, and the owners of each service, by id.
  monitorOwnerUserIds: Array<string>;
  serviceOwnerUserIds: Record<string, Array<string>>;
  // What the monitor is linked to by hand.
  linkedResources: SeriesResolvedResourceIds;
  statusPageLinks: Array<StatusPageLink>;
  // The monitor groups the monitor is in.
  monitorGroupIds: Array<string>;
  // Every status page that is not archived.
  statusPages: Array<StatusPageFacts>;
  levels: Record<
    string,
    {
      targets: Array<{
        userId: ObjectID;
        reachedThrough?: string;
        reachedThroughCode?: OnCallTestPageReachedThrough;
      }>;
      notPaged: Array<string>;
      // As readFirstLevel reads them (#7261): none when left out.
      notPagedCodes?: Array<OnCallTestPageNotPaged>;
      levelCount: number;
    }
  >;
  /*
   * Who is a member of the project (an accepted invitation to one of its
   * teams), and the member rows of each of its teams, pending invitations
   * too: who an owner's Created email reaches (#7211).
   */
  projectMemberIds: Array<string>;
  teamMemberIds: Record<string, Array<string>>;
  previews: Record<string, OnCallTestPagePreviewPerson>;
  verified: Record<string, Array<string>>;
  serverStatuses: Array<ServerChannelStatus>;
  // What the caller may read.
  callerReadsMonitor: boolean;
  callerPolicies: Array<string> | "refused";
  callerIncidentRules: Array<string> | "refused";
  callerIncidentOwnerRules: Array<string> | "refused";
  callerAlertOwnerRules: Array<string> | "refused";
  callerStatusPages: Array<string> | "refused";
}

function serverStatus(
  channel: ServerSendingChannel,
  state: ServerSendingState,
): ServerChannelStatus {
  return {
    channel: channel,
    state: state,
    hasWorked: state === ServerSendingState.Working,
    lastWorkedAt: null,
    failingSince: null,
    lastFailure: null,
    setUpProblem: null,
  };
}

function rule(
  id: string,
  name: string,
  policyIds: Array<string>,
): IncidentOnCallRule {
  const item: IncidentOnCallRule = withId(new IncidentOnCallRule(), id);
  item.name = name;
  item.onCallDutyPolicies = policyIds.map(
    (policyId: string): OnCallDutyPolicy => {
      return withId(new OnCallDutyPolicy(), policyId);
    },
  );
  return item;
}

function defaultWorld(): World {
  return {
    monitorSteps: stepsOf([ONLINE_CRITERIA, offlineCriteria()]),
    monitorName: "Checkout API",
    monitorLabelIds: [],
    project: {
      enableSmsNotifications: true,
      enableCallNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
      disableOnCallNotificationFallback: false,
      smsOrCallCurrentBalanceInUSDCents: 1000,
      enableAutoRechargeSmsOrCallBalance: false,
    },
    incidentRules: [rule(RULE, "Every incident", [PRIMARY])],
    alertRules: [],
    incidentRuleCount: 1,
    alertRuleCount: 0,
    incidentOwnerRules: [],
    alertOwnerRules: [],
    deviceOwners: { ownerUserIds: [], ownerTeamIds: [] },
    monitorOwnerUserIds: [],
    serviceOwnerUserIds: {},
    linkedResources: MonitorResourceContextUtil.emptyContext(),
    // Two of the page's resources show the monitor.
    statusPageLinks: [
      {
        resourceId: "68101111-0000-4000-8000-000000000501",
        statusPageId: STATUS_PAGE,
      },
      {
        resourceId: "68101111-0000-4000-8000-000000000502",
        statusPageId: STATUS_PAGE,
      },
    ],
    monitorGroupIds: [],
    statusPages: [{ id: STATUS_PAGE, name: "Public status" }],
    projectMemberIds: [ANA, BEN, CARA, DAN],
    teamMemberIds: {
      [PLATFORM_TEAM]: [ANA, BEN],
      [SRE_TEAM]: [CARA],
      // Its rows are another project's: a read of this project's finds none.
      [ELSEWHERE_TEAM]: [DAN],
    },
    levels: {
      [PRIMARY]: {
        targets: [
          { userId: new ObjectID(ANA) },
          {
            userId: new ObjectID(BEN),
            reachedThrough: "Schedule Primary",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.Schedule,
              name: "Primary",
            },
          },
        ],
        notPaged: [],
        notPagedCodes: [],
        levelCount: 2,
      },
      [SECONDARY]: { targets: [], notPaged: [], levelCount: 0 },
    },
    previews: {
      [ANA]: preview({
        methods: [
          {
            channel: OnCallPageChannel.SMS,
            notifyAfterMinutes: 0,
            isVerified: true,
            canAcknowledge: true,
          },
          {
            channel: OnCallPageChannel.Email,
            notifyAfterMinutes: 5,
            isVerified: true,
            canAcknowledge: true,
          },
        ],
      }),
      [BEN]: preview({ userId: BEN, userName: "Ben Ito", hasNoRule: true }),
    },
    verified: { [ANA]: ["SMS", "Email"], [BEN]: ["Push"] },
    serverStatuses: [
      serverStatus(ServerSendingChannel.Email, ServerSendingState.Working),
      serverStatus(ServerSendingChannel.SMS, ServerSendingState.Working),
      serverStatus(ServerSendingChannel.Call, ServerSendingState.Working),
    ],
    callerReadsMonitor: true,
    callerPolicies: [PRIMARY, SECONDARY],
    callerIncidentRules: [RULE],
    callerIncidentOwnerRules: [OWNER_RULE, OTHER_OWNER_RULE],
    callerAlertOwnerRules: [ALERT_OWNER_RULE],
    callerStatusPages: [
      STATUS_PAGE,
      GROUP_PAGE,
      SCOPED_ONLY_PAGE,
      NO_INCIDENTS_PAGE,
    ],
  };
}

let world: World;

// The titles the on-call rule engines were asked about.
let onCallTitles: Array<string>;

function count(value: number): PositiveNumber {
  return new PositiveNumber(value);
}

// The ids a QueryHelper.any read asks for in one column: its Raw IN's parameters.
function idsAt(query: unknown, column: string): Array<string> {
  const value: unknown = (query as Record<string, unknown> | undefined)?.[
    column
  ];
  const parameters: Record<string, unknown> =
    ((value as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters as Record<string, unknown>) || {};
  const values: unknown = Object.values(parameters)[0];

  return (Array.isArray(values) ? values : []).map((item: unknown): string => {
    return String(item).toLowerCase();
  });
}

function idsIn(query: unknown): Array<string> {
  return idsAt(query, "_id");
}

// A caller's read of some of the chain: the rows of the ids they may read.
function readable<T extends { _id?: string | undefined }>(
  query: unknown,
  allowed: Array<string> | "refused",
  make: () => T,
  what: string,
): Array<T> {
  if (allowed === "refused") {
    throw new NotAuthorizedException(`You may not read ${what}.`);
  }

  return idsIn(query)
    .filter((id: string): boolean => {
      return allowed.includes(id);
    })
    .map((id: string): T => {
      return withId(make(), id);
    });
}

function monitorModel(): Monitor {
  const monitor: Monitor = withId(new Monitor(), MONITOR_ID.toString());
  monitor.name = world.monitorName;
  monitor.description = "Takes the payments";
  monitor.monitorType = MonitorType.Website;
  monitor.projectId = PROJECT_ID;
  monitor.monitorSteps = world.monitorSteps;
  monitor.labels = world.monitorLabelIds.map((id: string): Label => {
    return withId(new Label(), id);
  });
  return monitor;
}

function stubWorld(): void {
  onCallTitles = [];

  jest.spyOn(MonitorService, "findOneBy").mockImplementation((async (args: {
    props: DatabaseCommonInteractionProps;
  }) => {
    if (!args.props.isRoot && !world.callerReadsMonitor) {
      return null;
    }

    return monitorModel();
  }) as never);

  // How the owner rule engines read the monitor a rule's monitor filters ask about.
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
    return monitorModel();
  }) as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return Object.assign(new Project(), world.project);
  }) as never);

  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((async () => {
      const archived: IncidentSeverity = withId(
        new IncidentSeverity(),
        ARCHIVED_SEVERITY,
      );
      archived.name = "Retired";
      archived.isArchived = true;
      const critical: IncidentSeverity = withId(
        new IncidentSeverity(),
        CRITICAL,
      );
      critical.name = "Critical";
      const minor: IncidentSeverity = withId(new IncidentSeverity(), MINOR);
      minor.name = "Minor";
      return [archived, critical, minor];
    }) as never);

  jest.spyOn(AlertSeverityService, "findBy").mockImplementation((async () => {
    const warning: AlertSeverity = withId(new AlertSeverity(), ALERT_WARNING);
    warning.name = "Warning";
    return [warning];
  }) as never);

  jest.spyOn(MonitorStatusService, "findBy").mockImplementation((async () => {
    const offline: MonitorStatus = withId(new MonitorStatus(), OFFLINE);
    offline.name = "Offline";
    const online: MonitorStatus = withId(new MonitorStatus(), ONLINE);
    online.name = "Operational";
    return [offline, online];
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockImplementation((async (args: {
      query: unknown;
      props: DatabaseCommonInteractionProps;
    }) => {
      if (args.props.isRoot) {
        return [
          [PRIMARY, "Primary"],
          [SECONDARY, "Secondary"],
        ].map(([id, name]: Array<string>): OnCallDutyPolicy => {
          const item: OnCallDutyPolicy = withId(new OnCallDutyPolicy(), id!);
          item.name = name!;
          return item;
        });
      }

      return readable(
        args.query,
        world.callerPolicies,
        (): OnCallDutyPolicy => {
          return new OnCallDutyPolicy();
        },
        "on-call policies",
      );
    }) as never);

  jest
    .spyOn(IncidentOnCallRuleService, "findBy")
    .mockImplementation((async (args: { query: unknown }) => {
      return readable(
        args.query,
        world.callerIncidentRules,
        (): IncidentOnCallRule => {
          return new IncidentOnCallRule();
        },
        "on-call rules",
      );
    }) as never);

  jest.spyOn(AlertOnCallRuleService, "findBy").mockResolvedValue([] as never);

  jest
    .spyOn(IncidentOnCallRuleService, "countBy")
    .mockImplementation((async () => {
      return count(world.incidentRuleCount);
    }) as never);
  jest
    .spyOn(AlertOnCallRuleService, "countBy")
    .mockImplementation((async () => {
      return count(world.alertRuleCount);
    }) as never);

  /*
   * The project's owner rules: what the engines read as OneUptime
   * (getEnabledRules), and what a caller may read of them.
   */
  jest
    .spyOn(IncidentOwnerRuleService, "findBy")
    .mockImplementation((async (args: {
      query: unknown;
      props: DatabaseCommonInteractionProps;
    }) => {
      if (args.props.isRoot) {
        return world.incidentOwnerRules;
      }

      return readable(
        args.query,
        world.callerIncidentOwnerRules,
        (): IncidentOwnerRule => {
          return new IncidentOwnerRule();
        },
        "incident owner rules",
      );
    }) as never);
  jest.spyOn(AlertOwnerRuleService, "findBy").mockImplementation((async (args: {
    query: unknown;
    props: DatabaseCommonInteractionProps;
  }) => {
    if (args.props.isRoot) {
      return world.alertOwnerRules;
    }

    return readable(
      args.query,
      world.callerAlertOwnerRules,
      (): AlertOwnerRule => {
        return new AlertOwnerRule();
      },
      "alert owner rules",
    );
  }) as never);

  jest
    .spyOn(IncidentOnCallRuleEngineService, "getMatchingRules")
    .mockImplementation((async (incident: Incident) => {
      onCallTitles.push(incident.title || "");
      return world.incidentRules;
    }) as never);
  jest
    .spyOn(AlertOnCallRuleEngineService, "getMatchingRules")
    .mockImplementation((async () => {
      return world.alertRules;
    }) as never);

  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockImplementation((async () => {
      return world.deviceOwners;
    }) as never);

  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockImplementation((async () => {
      return MonitorResourceContextUtil.emptyContext();
    }) as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockImplementation((async () => {
      return world.linkedResources;
    }) as never);

  // Who owns the monitor and the services, for rules that inherit from them.
  jest
    .spyOn(MonitorOwnerUserService, "findBy")
    .mockImplementation((async () => {
      return world.monitorOwnerUserIds.map((id: string): MonitorOwnerUser => {
        const row: MonitorOwnerUser = new MonitorOwnerUser();
        row.userId = new ObjectID(id);
        return row;
      });
    }) as never);
  jest.spyOn(MonitorOwnerTeamService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(ServiceOwnerUserService, "findBy")
    .mockImplementation((async (args: { query: unknown }) => {
      return idsAt(args.query, "serviceId").flatMap(
        (serviceId: string): Array<ServiceOwnerUser> => {
          return (world.serviceOwnerUserIds[serviceId] || []).map(
            (id: string): ServiceOwnerUser => {
              const row: ServiceOwnerUser = new ServiceOwnerUser();
              row.userId = new ObjectID(id);
              return row;
            },
          );
        },
      );
    }) as never);
  jest.spyOn(ServiceOwnerTeamService, "findBy").mockResolvedValue([] as never);

  /*
   * The status pages: each resource that lists the monitor or a group it is
   * in, the groups, and the pages the subscriber read loads.
   */
  jest
    .spyOn(StatusPageResourceService, "findAllBy")
    .mockImplementation((async (args: { query: Record<string, unknown> }) => {
      const toResource: (link: StatusPageLink) => StatusPageResource = (
        link: StatusPageLink,
      ): StatusPageResource => {
        const resource: StatusPageResource = withId(
          new StatusPageResource(),
          link.resourceId,
        );
        resource.statusPageId = new ObjectID(link.statusPageId);
        return resource;
      };

      if (args.query["monitorId"]) {
        if (!idsAt(args.query, "monitorId").includes(MONITOR_ID.toString())) {
          return [];
        }

        return world.statusPageLinks
          .filter((link: StatusPageLink): boolean => {
            return !link.monitorGroupId;
          })
          .map(toResource);
      }

      const groupIds: Array<string> = idsAt(args.query, "monitorGroupId");

      return world.statusPageLinks
        .filter((link: StatusPageLink): boolean => {
          return Boolean(
            link.monitorGroupId && groupIds.includes(link.monitorGroupId),
          );
        })
        .map(toResource);
    }) as never);
  jest
    .spyOn(MonitorGroupResourceService, "findAllBy")
    .mockImplementation((async () => {
      return world.monitorGroupIds.map((id: string): MonitorGroupResource => {
        const resource: MonitorGroupResource = new MonitorGroupResource();
        resource.monitorGroupId = new ObjectID(id);
        return resource;
      });
    }) as never);
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation((async (statusPageIds: Array<ObjectID>) => {
      const wanted: Array<string> = statusPageIds.map(
        (id: ObjectID): string => {
          return id.toString().toLowerCase();
        },
      );

      return world.statusPages
        .filter((page: StatusPageFacts): boolean => {
          return wanted.includes(page.id);
        })
        .map((page: StatusPageFacts): StatusPage => {
          const item: StatusPage = withId(new StatusPage(), page.id);
          item.name = page.name;
          item.projectId = new ObjectID(
            page.projectId || PROJECT_ID.toString(),
          );
          item.showIncidentsOnStatusPage =
            page.showIncidentsOnStatusPage ?? true;
          item.onlyShowScopedIncidents = page.onlyShowScopedIncidents ?? false;
          return item;
        });
    }) as never);
  jest.spyOn(StatusPageService, "findBy").mockImplementation((async (args: {
    query: unknown;
  }) => {
    return readable(
      args.query,
      world.callerStatusPages,
      (): StatusPage => {
        return new StatusPage();
      },
      "status pages",
    );
  }) as never);

  jest
    .spyOn(ProjectService, "getOwners")
    .mockResolvedValue([user("Owner One", "owner@example.com")] as never);
  jest.spyOn(MonitorService, "findOwners").mockResolvedValue([] as never);

  // People and teams by id; a team is read only as the project's own.
  jest.spyOn(UserService, "findBy").mockImplementation((async (args: {
    query: unknown;
  }) => {
    return idsIn(args.query)
      .filter((id: string): boolean => {
        return Boolean(PEOPLE[id]);
      })
      .map((id: string): User => {
        return withId(
          user(PEOPLE[id]!, `${PEOPLE[id]!.split(" ")[0]}@example.com`),
          id,
        );
      });
  }) as never);
  jest.spyOn(TeamService, "findBy").mockImplementation((async (args: {
    query: { projectId?: ObjectID };
  }) => {
    const projectId: string | undefined = args.query.projectId?.toString();
    // A read that names no project finds every project's teams.
    const teams: Record<string, string> = !projectId
      ? { ...TEAMS, ...ELSEWHERE_TEAMS }
      : projectId === PROJECT_ID.toString()
        ? TEAMS
        : ELSEWHERE_TEAMS;

    return idsIn(args.query)
      .filter((id: string): boolean => {
        return Boolean(teams[id]);
      })
      .map((id: string): Team => {
        const team: Team = withId(new Team(), id);
        team.name = teams[id]!;
        return team;
      });
  }) as never);

  jest
    .spyOn(OnCallTestPageService, "readFirstLevel")
    .mockImplementation((async (args: { policyId: ObjectID }) => {
      const level: World["levels"][string] =
        world.levels[args.policyId.toString()]!;

      return { ...level, notPagedCodes: level.notPagedCodes || [] };
    }) as never);

  // Who of these is a member of the project: one read for all of them.
  jest
    .spyOn(TeamMemberService, "getProjectMemberUserIds")
    .mockImplementation((async (args: {
      projectId: ObjectID;
      userIds: Array<ObjectID | string>;
    }) => {
      return args.userIds
        .filter((id: ObjectID | string): boolean => {
          return (
            args.projectId.toString() === PROJECT_ID.toString() &&
            world.projectMemberIds.includes(id.toString().toLowerCase())
          );
        })
        .map((id: ObjectID | string): ObjectID => {
          return new ObjectID(id.toString());
        });
    }) as never);

  // The member rows of teams, read as one project's: another's has none here.
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    query: { projectId?: ObjectID };
  }) => {
    if (args.query.projectId?.toString() !== PROJECT_ID.toString()) {
      return [];
    }

    return idsAt(args.query, "teamId")
      .filter((teamId: string): boolean => {
        return Boolean(TEAMS[teamId]);
      })
      .flatMap((teamId: string): Array<TeamMember> => {
        return (world.teamMemberIds[teamId] || []).map(
          (userId: string): TeamMember => {
            const row: TeamMember = new TeamMember();
            row.teamId = new ObjectID(teamId);
            row.userId = new ObjectID(userId);
            return row;
          },
        );
      });
  }) as never);

  jest
    .spyOn(OnCallTestPageService, "getPersonPreview")
    .mockImplementation((async (args: { userId: ObjectID }) => {
      return world.previews[args.userId.toString()]!;
    }) as never);

  jest
    .spyOn(OnCallReadinessService, "getReadinessForUsers")
    .mockImplementation((async (userIds: Array<ObjectID>) => {
      return userIds.map((userId: ObjectID): UserReadiness => {
        return readiness(
          userId.toString(),
          world.verified[userId.toString()] || [],
        );
      });
    }) as never);

  jest
    .spyOn(ServerSendingStatus, "getStatuses")
    .mockImplementation((async () => {
      return world.serverStatuses;
    }) as never);
}

async function resolve(): Promise<WhoIsToldResult> {
  return await WhoIsToldService.resolve({
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    refresh: true,
  });
}

function events(result: WhoIsToldResult): Array<WhoIsToldEvent> {
  return result.criteria.flatMap(
    (item: WhoIsToldResult["criteria"][number]): Array<WhoIsToldEvent> => {
      return item.events;
    },
  );
}

function firstEvent(result: WhoIsToldResult): WhoIsToldEvent {
  return events(result)[0]!;
}

function kinds(result: WhoIsToldResult): Array<WhoIsToldBreakKind> {
  return result.breaks.map((brk: WhoIsToldBreak): WhoIsToldBreakKind => {
    return brk.kind;
  });
}

describe("WhoIsToldService", () => {
  beforeEach(() => {
    world = defaultWorld();
    WhoIsToldService.clearCache();
    stubWorld();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    WhoIsToldService.clearCache();
  });

  test("reads the whole chain of a monitor that goes Offline and opens a Critical incident", async () => {
    const result: WhoIsToldResult = await resolve();

    expect(result.monitorId).toBe(MONITOR_ID.toString());
    expect(result.monitorName).toBe("Checkout API");
    expect(
      result.criteria.map((item: WhoIsToldResult["criteria"][number]) => {
        return [item.name, item.statusName, item.events.length];
      }),
    ).toEqual([
      ["Online", "Operational", 0],
      ["Offline", "Offline", 1],
    ]);

    const event: WhoIsToldEvent = firstEvent(result);

    expect(event.kind).toBe(OnCallTestPageRecordKind.Incident);
    expect(event.title).toBe("Checkout API is down");
    expect(event.severityName).toBe("Critical");
    expect(event.owners).toEqual({
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: ["Owner One"],
      teamNames: [],
    });
    expect(event.ownerRules).toEqual([]);
    expect(event.rules).toEqual([{ id: RULE, name: "Every incident" }]);
    expect(event.policies).toHaveLength(1);
    expect(event.policies[0]).toMatchObject({
      id: PRIMARY,
      name: "Primary",
      isHidden: false,
      isNamedByCriteria: false,
      ruleIds: [RULE],
      levelCount: 2,
    });
    expect(event.policies[0]!.people).toEqual([
      {
        userId: ANA,
        name: "Ana Lopez",
        channels: [OnCallPageChannel.SMS, OnCallPageChannel.Email],
        isFallback: false,
        isReachable: true,
      },
      {
        userId: BEN,
        name: "Ben Ito",
        reachedThrough: "Schedule Primary",
        reachedThroughCode: {
          code: OnCallTestPageReachedThroughCode.Schedule,
          name: "Primary",
        },
        channels: [OnCallPageChannel.Push],
        isFallback: true,
        isReachable: true,
      },
    ]);
    expect(event.policies[0]!.notPaged).toEqual([]);
    expect(event.policies[0]!.notPagedCodes).toEqual([]);
    // The status page is listed once, though two of its resources show the monitor.
    expect(event.statusPages).toEqual([
      { id: STATUS_PAGE, name: "Public status" },
    ]);
    expect(result.breaks).toEqual([]);
  });

  test("a status change emails the monitor's owners, or the project's when it has none", async () => {
    let result: WhoIsToldResult = await resolve();

    expect(result.criteria[0]!.statusOwners).toEqual({
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: ["Owner One"],
      teamNames: [],
    });

    jest
      .spyOn(MonitorService, "findOwners")
      .mockResolvedValue([user("", "watcher@example.com")] as never);

    result = await resolve();

    expect(result.criteria[0]!.statusOwners).toMatchObject({
      source: WhoIsToldOwnersSource.MonitorOwners,
      userNames: ["watcher@example.com"],
    });
  });

  test("owners the criteria names are emailed instead of the project's, in the order it names them", async () => {
    world.monitorSteps = opensIncidents(
      incidentTemplate({
        ownerUserIds: ids([BEN, ANA]),
        ownerTeamIds: ids([PLATFORM_TEAM]),
      }),
    );

    const event: WhoIsToldEvent = firstEvent(await resolve());

    expect(event.owners).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ben Ito", "Ana Lopez"],
      teamNames: ["Platform"],
    });
  });

  test("a team of another project, or somebody who is gone, is never named", async () => {
    world.monitorSteps = opensIncidents(
      incidentTemplate({
        ownerUserIds: ids([ObjectID.generate().toString(), ANA]),
        ownerTeamIds: ids([ELSEWHERE_TEAM]),
      }),
    );

    expect(firstEvent(await resolve()).owners).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ana Lopez"],
      teamNames: [],
    });
  });

  /*
   * ONLY WHO THE CREATED EMAIL REACHES IS NAMED (#7211): a real incident
   * gets no owner row for somebody who left the project
   * (OwnerRuleAssignment.createOwner), and its findOwners keeps only the
   * project's members - a team's too, into whom it expands the team. So a
   * person who left, and a team with nobody in it who is a member, are
   * never named; with nobody left, the email - and the card - go to the
   * project's owners.
   */
  describe("owners who left the project, and teams with nobody in them", () => {
    test("a named owner who left the project is not named; the others still are, in order", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ ownerUserIds: ids([BEN, ANA, CARA]) }),
      );
      world.projectMemberIds = [ANA, CARA, DAN];

      expect(firstEvent(await resolve()).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Ana Lopez", "Cara Diaz"],
        teamNames: [],
      });
    });

    test("when every owner it names has left, it emails the project's owners, as the email does", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ ownerUserIds: ids([BEN]) }),
      );
      world.deviceOwners = { ownerUserIds: ids([DAN]), ownerTeamIds: [] };
      world.projectMemberIds = [ANA, CARA];

      expect(firstEvent(await resolve()).owners).toEqual({
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: ["Owner One"],
        teamNames: [],
      });
    });

    test("a team with no members is not named, and a team with one member still is", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ ownerTeamIds: ids([PLATFORM_TEAM, SRE_TEAM]) }),
      );
      world.teamMemberIds = { [PLATFORM_TEAM]: [], [SRE_TEAM]: [CARA] };

      expect(firstEvent(await resolve()).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: [],
        teamNames: ["Checkout SRE"],
      });
    });

    test("a team whose members have all left the project reaches nobody, and is not named", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ ownerTeamIds: ids([PLATFORM_TEAM]) }),
      );
      world.teamMemberIds = { [PLATFORM_TEAM]: [BEN, DAN] };
      world.projectMemberIds = [ANA, CARA];

      expect(firstEvent(await resolve()).owners).toEqual({
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: ["Owner One"],
        teamNames: [],
      });
    });

    test("a team is named when one of its rows is somebody in the project - an invitation to it still pending, as the email counts it", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ ownerTeamIds: ids([PLATFORM_TEAM]) }),
      );
      // Dan's invitation to Platform is pending; he is a member through another team.
      world.teamMemberIds = { [PLATFORM_TEAM]: [DAN] };
      world.projectMemberIds = [DAN];

      expect(firstEvent(await resolve()).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: [],
        teamNames: ["Platform"],
      });
    });

    test("named owners who all left leave the owner rules' owners: they are who is emailed", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({
          ownerUserIds: ids([BEN]),
          ownerTeamIds: ids([PLATFORM_TEAM]),
        }),
      );
      world.projectMemberIds = [ANA, CARA];
      world.teamMemberIds = { [PLATFORM_TEAM]: [], [SRE_TEAM]: [CARA] };
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "SRE owns checkout",
          userIds: [ANA],
          teamIds: [SRE_TEAM],
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Ana Lopez"],
        teamNames: ["Checkout SRE"],
      });
      expect(event.ownerRules).toEqual([
        { id: OWNER_RULE, name: "SRE owns checkout" },
      ]);
    });

    test("an owner rule that adds only people and teams the email does not reach is not said, and adds nobody", async () => {
      world.projectMemberIds = [ANA, CARA];
      world.teamMemberIds = { [PLATFORM_TEAM]: [], [SRE_TEAM]: [CARA] };
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Gone and empty",
          userIds: [BEN],
          teamIds: [PLATFORM_TEAM],
        }),
        incidentOwnerRule({
          id: OTHER_OWNER_RULE,
          name: "SRE owns checkout",
          teamIds: [SRE_TEAM],
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: [],
        teamNames: ["Checkout SRE"],
      });
      expect(event.ownerRules).toEqual([
        { id: OTHER_OWNER_RULE, name: "SRE owns checkout" },
      ]);

      // With only the first, the email - and the card - go to the project's owners.
      world.incidentOwnerRules = [world.incidentOwnerRules[0]!];

      const alone: WhoIsToldEvent = firstEvent(await resolve());

      expect(alone.owners.source).toBe(WhoIsToldOwnersSource.ProjectOwners);
      expect(alone.ownerRules).toEqual([]);
    });

    test("an alert's owners are read the same way", async () => {
      world.monitorSteps = opensAlerts(
        alertTemplate({
          ownerUserIds: ids([BEN, ANA]),
          ownerTeamIds: ids([PLATFORM_TEAM, SRE_TEAM]),
        }),
      );
      world.projectMemberIds = [ANA, CARA];
      world.teamMemberIds = { [PLATFORM_TEAM]: [BEN], [SRE_TEAM]: [CARA] };

      expect(firstEvent(await resolve()).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Ana Lopez"],
        teamNames: ["Checkout SRE"],
      });

      world.projectMemberIds = [];
      WhoIsToldService.clearCache();

      expect(firstEvent(await resolve()).owners.source).toBe(
        WhoIsToldOwnersSource.ProjectOwners,
      );
    });

    test("who is a member, and who is in each team, is read once for every owner of the answer", async () => {
      world.monitorSteps = stepsOf([
        ONLINE_CRITERIA,
        criteriaInstance({
          id: "offline",
          name: "Offline",
          monitorStatusId: new ObjectID(OFFLINE),
          changeMonitorStatus: true,
          createIncidents: true,
          incidents: [
            incidentTemplate({
              ownerUserIds: ids([ANA, BEN]),
              ownerTeamIds: ids([PLATFORM_TEAM]),
            }),
          ],
        }),
        criteriaInstance({
          id: "slow",
          name: "Slow",
          createAlerts: true,
          alerts: [
            alertTemplate({
              ownerUserIds: ids([BEN]),
              ownerTeamIds: ids([PLATFORM_TEAM]),
            }),
          ],
        }),
      ]);
      world.projectMemberIds = [ANA];

      const result: WhoIsToldResult = await resolve();

      expect(
        events(result).map((event: WhoIsToldEvent): unknown => {
          return event.owners;
        }),
      ).toEqual([
        {
          source: WhoIsToldOwnersSource.Named,
          userNames: ["Ana Lopez"],
          teamNames: ["Platform"],
        },
        {
          source: WhoIsToldOwnersSource.Named,
          userNames: [],
          teamNames: ["Platform"],
        },
      ]);
      expect(TeamMemberService.findBy).toHaveBeenCalledTimes(1);
      expect(TeamMemberService.getProjectMemberUserIds).toHaveBeenCalledTimes(
        1,
      );
      expect(
        (
          TeamMemberService.getProjectMemberUserIds as unknown as {
            mock: { calls: Array<[{ userIds: Array<string> }]> };
          }
        ).mock.calls[0]![0].userIds.map((id: string): string => {
          return id.toString().toLowerCase();
        }),
      ).toEqual([ANA, BEN]);
    });
  });

  test("the owners of the network device the monitor watches are emailed with the criteria's, each once", async () => {
    world.monitorSteps = opensIncidents(
      incidentTemplate({ ownerUserIds: ids([ANA]) }),
    );
    world.deviceOwners = {
      ownerUserIds: ids([ANA, CARA]),
      ownerTeamIds: ids([SRE_TEAM]),
    };

    const event: WhoIsToldEvent = firstEvent(await resolve());

    expect(event.owners).toEqual({
      source: WhoIsToldOwnersSource.Named,
      userNames: ["Ana Lopez", "Cara Diaz"],
      teamNames: ["Checkout SRE"],
    });
    // The device of the step the criteria is checked in (MonitorIncident's).
    expect(
      NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor,
    ).toHaveBeenCalledWith(expect.objectContaining({ monitorStepId: STEP_ID }));
  });

  test("no on-call rule matches and the criteria names no policy: nobody is paged", async () => {
    world.incidentRules = [];

    const result: WhoIsToldResult = await resolve();

    expect(firstEvent(result).policies).toEqual([]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
  });

  test("a policy the criteria names is run, and one of another project, or gone, is dropped", async () => {
    world.incidentRules = [];
    world.monitorSteps = opensIncidents(
      incidentTemplate({
        onCallPolicyIds: ids([ELSEWHERE_POLICY, PRIMARY]),
      }),
    );

    const event: WhoIsToldEvent = firstEvent(await resolve());

    expect(
      event.policies.map((policy: WhoIsToldEvent["policies"][number]) => {
        return [policy.id, policy.isNamedByCriteria, policy.ruleIds];
      }),
    ).toEqual([[PRIMARY, true, []]]);
  });

  test("a policy both the criteria and a rule run is shown once, with the rule", async () => {
    world.monitorSteps = opensIncidents(
      incidentTemplate({ onCallPolicyIds: ids([PRIMARY]) }),
    );

    const event: WhoIsToldEvent = firstEvent(await resolve());

    expect(event.policies).toHaveLength(1);
    expect(event.policies[0]).toMatchObject({
      id: PRIMARY,
      isNamedByCriteria: true,
      ruleIds: [RULE],
    });
  });

  test("a monitor that opens an alert while only incidents have on-call rules says so", async () => {
    world.monitorSteps = opensAlerts(alertTemplate());

    const result: WhoIsToldResult = await resolve();
    const event: WhoIsToldEvent = firstEvent(result);

    expect(event.kind).toBe(OnCallTestPageRecordKind.Alert);
    expect(event.severityName).toBe("Warning");
    // An alert is never public.
    expect(event.statusPages).toEqual([]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.OnlyIncidentsHaveRules]);
  });

  test("a policy with no escalation rules is the policy's break, and nobody of it is read", async () => {
    world.incidentRules = [rule(RULE, "Every incident", [SECONDARY])];

    const result: WhoIsToldResult = await resolve();

    expect(firstEvent(result).policies[0]).toMatchObject({
      id: SECONDARY,
      levelCount: 0,
      people: [],
    });
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
    expect(OnCallTestPageService.getPersonPreview).not.toHaveBeenCalled();
  });

  test("a schedule with nobody on call: the first level reaches nobody, and says why", async () => {
    world.levels[PRIMARY] = {
      targets: [],
      notPaged: ["Nobody is on call in schedule Primary now."],
      levelCount: 1,
    };

    const result: WhoIsToldResult = await resolve();

    expect(firstEvent(result).policies[0]!.notPaged).toEqual([
      "Nobody is on call in schedule Primary now.",
    ]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.PolicyReachesNobody]);
  });

  /*
   * IN THE READER'S LANGUAGE (#7261): why a policy pages each person, and
   * why a target of its first level reaches nobody, come as the codes the
   * test page's reader hands back (OnCallTestPageService.readFirstLevel),
   * next to its English - which a Dashboard without them still shows.
   */
  describe("why somebody is paged, and why nobody is, as codes", () => {
    const AWAY_UNTIL: string = "2026-11-14T09:00:00.000Z";
    const NOT_PAGED: Array<OnCallTestPageNotPaged> = [
      {
        code: OnCallTestPageNotPagedCode.TeamHasNoMembers,
        teamName: "Platform",
        message: "Team Platform has no members.",
      },
      {
        code: OnCallTestPageNotPagedCode.NobodyNextInRotation,
        scheduleName: "Weekly",
        message: "Nobody is next in the rotation of schedule Weekly.",
      },
      {
        code: OnCallTestPageNotPagedCode.AwayWithNobodyCovering,
        userName: "Lee Park",
        awayUntil: AWAY_UNTIL,
        message: `Lee Park is away until ${AWAY_UNTIL}, with nobody covering.`,
      },
      {
        code: OnCallTestPageNotPagedCode.NotProjectMember,
        userName: "Dan Okafor",
        message: "Dan Okafor is not a member of this project.",
      },
    ];

    test("each person carries how the policy reaches them, and the policy who it can't reach, with the English unchanged", async () => {
      world.levels[PRIMARY] = {
        targets: [
          {
            userId: new ObjectID(ANA),
            reachedThrough: "Team Platform",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.Team,
              name: "Platform",
            },
          },
          {
            userId: new ObjectID(BEN),
            reachedThrough: "Schedule Primary (next in rotation)",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.ScheduleNextInRotation,
              name: "Primary",
            },
          },
          {
            userId: new ObjectID(CARA),
            reachedThrough: "Covering for Lee Park",
            reachedThroughCode: {
              code: OnCallTestPageReachedThroughCode.CoveringFor,
              name: "Lee Park",
            },
          },
        ],
        notPaged: NOT_PAGED.map((item: OnCallTestPageNotPaged): string => {
          return item.message;
        }),
        notPagedCodes: NOT_PAGED,
        levelCount: 2,
      };
      world.previews[CARA] = preview({ userId: CARA, userName: "Cara Diaz" });

      const policy: WhoIsToldEvent["policies"][number] = firstEvent(
        await resolve(),
      ).policies[0]!;

      expect(
        policy.people.map(
          (
            person: WhoIsToldEvent["policies"][number]["people"][number],
          ): unknown => {
            return [
              person.userId,
              person.reachedThrough,
              person.reachedThroughCode,
            ];
          },
        ),
      ).toEqual([
        [
          ANA,
          "Team Platform",
          { code: OnCallTestPageReachedThroughCode.Team, name: "Platform" },
        ],
        [
          BEN,
          "Schedule Primary (next in rotation)",
          {
            code: OnCallTestPageReachedThroughCode.ScheduleNextInRotation,
            name: "Primary",
          },
        ],
        [
          CARA,
          "Covering for Lee Park",
          {
            code: OnCallTestPageReachedThroughCode.CoveringFor,
            name: "Lee Park",
          },
        ],
      ]);
      // The English as it was, and the codes in its order, the away date as a date.
      expect(policy.notPaged).toEqual([
        "Team Platform has no members.",
        "Nobody is next in the rotation of schedule Weekly.",
        `Lee Park is away until ${AWAY_UNTIL}, with nobody covering.`,
        "Dan Okafor is not a member of this project.",
      ]);
      expect(policy.notPagedCodes).toEqual(NOT_PAGED);
    });

    test("somebody the level names directly carries no code: there is no why", async () => {
      const people: WhoIsToldEvent["policies"][number]["people"] = firstEvent(
        await resolve(),
      ).policies[0]!.people;

      expect(people[0]!.userId).toBe(ANA);
      expect(people[0]).not.toHaveProperty("reachedThrough");
      expect(people[0]).not.toHaveProperty("reachedThroughCode");
    });

    test("a policy with no escalation rules says nobody and carries no codes: the break says it", async () => {
      world.levels[PRIMARY] = {
        targets: [],
        notPaged: ["This policy has no escalation rules yet."],
        notPagedCodes: [
          {
            code: OnCallTestPageNotPagedCode.PolicyHasNoLevels,
            message: "This policy has no escalation rules yet.",
          },
        ],
        levelCount: 0,
      };

      const result: WhoIsToldResult = await resolve();

      expect(firstEvent(result).policies[0]).toMatchObject({
        levelCount: 0,
        notPaged: [],
        notPagedCodes: [],
      });
      expect(kinds(result)).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
    });

    test("a caller who may not read the policy is handed none of it: no names, no codes", async () => {
      world.levels[PRIMARY] = {
        ...world.levels[PRIMARY]!,
        notPaged: [NOT_PAGED[0]!.message],
        notPagedCodes: [NOT_PAGED[0]!],
      };
      world.callerPolicies = [];

      const policy: WhoIsToldEvent["policies"][number] = firstEvent(
        await WhoIsToldService.getForMonitor({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          props: CALLER,
        }),
      ).policies[0]!;

      expect(policy).toEqual({
        id: PRIMARY,
        name: "",
        isHidden: true,
        isNamedByCriteria: false,
        ruleIds: [RULE],
        levelCount: 0,
        people: [],
        notPaged: [],
        notPagedCodes: [],
      });
    });
  });

  test("a person with no rule for the severity, in a project that doesn't fall back, can't be paged", async () => {
    world.project.disableOnCallNotificationFallback = true;

    const result: WhoIsToldResult = await resolve();
    const ben: WhoIsToldEvent["policies"][number]["people"][number] =
      firstEvent(result).policies[0]!.people[1]!;

    expect(ben).toMatchObject({
      userId: BEN,
      isReachable: false,
      problem: WhoIsToldPersonProblem.NoRuleNoFallback,
    });
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.PersonUnreachable]);
    expect(result.breaks[0]!.userName).toBe("Ben Ito");
  });

  test("SMS switched off for the project, for somebody reached only by SMS, is the switch's break", async () => {
    world.project.enableSmsNotifications = false;
    world.previews[ANA] = preview({
      methods: [
        {
          channel: OnCallPageChannel.SMS,
          notifyAfterMinutes: 0,
          isVerified: true,
          canAcknowledge: true,
        },
      ],
    });

    const result: WhoIsToldResult = await resolve();

    expect(result.channels.isSmsOn).toBe(false);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.ChannelOff]);
  });

  test("a criteria severity the project does not have falls back to its first that is not archived", async () => {
    world.monitorSteps = opensIncidents(
      incidentTemplate({ incidentSeverityId: ObjectID.generate() }),
    );

    expect(firstEvent(await resolve()).severityName).toBe("Critical");
  });

  test("a switched-off criteria, and one that does nothing, tell nobody and are left out", async () => {
    world.monitorSteps = stepsOf([
      criteriaInstance({ id: "idle", name: "Idle" }),
      offlineCriteria({ isEnabled: false }),
    ]);

    const result: WhoIsToldResult = await resolve();

    expect(result.criteria).toEqual([]);
    expect(kinds(result)).toEqual([WhoIsToldBreakKind.NothingHappens]);
  });

  test("the project's channels, and on a self-hosted server what it can send", async () => {
    world.serverStatuses = [
      serverStatus(ServerSendingChannel.Email, ServerSendingState.NotSetUp),
      serverStatus(ServerSendingChannel.SMS, ServerSendingState.Failing),
      serverStatus(ServerSendingChannel.Call, ServerSendingState.Untested),
    ];

    const result: WhoIsToldResult = await resolve();

    expect(result.channels.isBillingEnabled).toBe(IsBillingEnabled);

    if (IsBillingEnabled) {
      // OneUptime Cloud: the balance, and the server is not asked.
      expect(result.channels.balanceInUSDCents).toBe(1000);
      expect(result.channels.serverCanSendEmail).toBeNull();
      expect(kinds(result)).toEqual([]);
      return;
    }

    expect(result.channels.serverCanSendEmail).toBe(false);
    expect(result.channels.serverCanSendSms).toBe(false);
    expect(result.channels.serverCanCall).toBe(true);
    expect(result.breaks).toHaveLength(2);
    expect(
      result.breaks.map((brk: WhoIsToldBreak): unknown => {
        return [brk.kind, brk.channel];
      }),
    ).toEqual([
      [WhoIsToldBreakKind.ServerCannotSend, WhoIsToldServerChannel.Email],
      [WhoIsToldBreakKind.ServerCannotSend, WhoIsToldServerChannel.SMS],
    ]);
  });

  test("a person met through two policies is read once", async () => {
    world.incidentRules = [
      rule(RULE, "Every incident", [PRIMARY]),
      rule(ObjectID.generate().toString(), "Again", [PRIMARY]),
    ];

    await resolve();

    expect(OnCallTestPageService.readFirstLevel).toHaveBeenCalledTimes(1);
    expect(OnCallTestPageService.getPersonPreview).toHaveBeenCalledTimes(2);
    expect(OnCallReadinessService.getReadinessForUsers).toHaveBeenCalledTimes(
      1,
    );
  });

  test("an answer is kept a minute, and a refresh works it out again", async () => {
    const reads: jest.SpiedFunction<typeof MonitorService.findOneBy> =
      MonitorService.findOneBy as unknown as jest.SpiedFunction<
        typeof MonitorService.findOneBy
      >;

    await WhoIsToldService.resolve({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });
    await WhoIsToldService.resolve({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });

    expect(reads).toHaveBeenCalledTimes(1);

    await WhoIsToldService.resolve({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      refresh: true,
    });

    expect(reads).toHaveBeenCalledTimes(2);
  });

  test("reads only: nothing is created, updated or deleted - no owner, feed item or policy", async () => {
    world.incidentOwnerRules = [
      incidentOwnerRule({
        id: OWNER_RULE,
        name: "Checkout monitors",
        userIds: [BEN],
        inheritOwnersFromServices: true,
      }),
    ];
    world.alertOwnerRules = [
      alertOwnerRule({
        id: ALERT_OWNER_RULE,
        name: "Every alert",
        userIds: [CARA],
      }),
    ];
    world.monitorSteps = stepsOf([
      offlineCriteria({ createAlerts: true, alerts: [alertTemplate()] }),
    ]);

    const writes: Array<
      jest.SpiedFunction<(...args: Array<never>) => unknown>
    > = [
      jest.spyOn(MonitorService, "updateOneById"),
      jest.spyOn(OnCallDutyPolicyService, "create"),
      jest.spyOn(ProjectService, "updateOneById"),
      jest.spyOn(IncidentService, "addOwners"),
      jest.spyOn(IncidentService, "create"),
      jest.spyOn(AlertService, "addOwners"),
      jest.spyOn(AlertService, "create"),
      jest.spyOn(IncidentOwnerUserService, "create"),
      jest.spyOn(IncidentFeedService, "createIncidentFeedItem"),
    ] as unknown as Array<
      jest.SpiedFunction<(...args: Array<never>) => unknown>
    >;

    const result: WhoIsToldResult = await resolve();

    expect(events(result)).toHaveLength(2);

    for (const write of writes) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  describe("for the whole project at once (Setup health, #6812)", () => {
    function projectMonitor(id: string, name: string): Monitor {
      const monitor: Monitor = withId(new Monitor(), id);
      monitor.name = name;
      monitor.monitorType = MonitorType.Website;
      monitor.projectId = PROJECT_ID;
      monitor.monitorSteps = world.monitorSteps;
      monitor.labels = [];
      return monitor;
    }

    function stubRuleReads(): {
      incident: SpyInstance<
        typeof IncidentOnCallRuleEngineService.readEnabledRules
      >;
      alert: SpyInstance<typeof AlertOnCallRuleEngineService.readEnabledRules>;
    } {
      return {
        incident: jest
          .spyOn(IncidentOnCallRuleEngineService, "readEnabledRules")
          .mockImplementation((async () => {
            return world.incidentRules;
          }) as never),
        alert: jest
          .spyOn(AlertOnCallRuleEngineService, "readEnabledRules")
          .mockImplementation((async () => {
            return world.alertRules;
          }) as never),
      };
    }

    test("each monitor's breaks are the ones resolve finds for it alone", async () => {
      stubRuleReads();

      const alone: WhoIsToldResult = await resolve();
      const together: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [
            projectMonitor(MONITOR_ID.toString(), "Checkout API"),
            projectMonitor(
              "68101111-0000-4000-8000-000000000003",
              "Billing API",
            ),
          ],
        });

      expect(together).toHaveLength(2);
      expect(together[0]!.monitorId).toBe(MONITOR_ID.toString());
      expect(together[0]!.breaks).toEqual(alone.breaks);
      expect(together[1]!.monitorName).toBe("Billing API");
      expect(firstEvent(together[0]!).policies).toEqual(
        firstEvent(alone).policies,
      );
    });

    test("a break resolve finds, the whole project finds too", async () => {
      stubRuleReads();
      world.incidentRules = [];

      const alone: WhoIsToldResult = await resolve();
      const together: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [projectMonitor(MONITOR_ID.toString(), "Checkout API")],
        });

      expect(kinds(alone)).toContain(WhoIsToldBreakKind.NobodyPaged);
      expect(kinds(together[0]!)).toEqual(kinds(alone));
    });

    test("the rules are read once, and matched for every monitor without reading again", async () => {
      const ruleReads: ReturnType<typeof stubRuleReads> = stubRuleReads();

      const monitors: Array<Monitor> = [];

      for (let index: number = 0; index < 50; index++) {
        monitors.push(
          projectMonitor(
            `68101111-0000-4000-8000-${(1000 + index)
              .toString()
              .padStart(12, "0")}`,
            `Monitor ${index}`,
          ),
        );
      }

      await WhoIsToldService.resolveProject({
        projectId: PROJECT_ID,
        monitors: monitors,
      });

      expect(ruleReads.incident).toHaveBeenCalledTimes(1);
      expect(ruleReads.alert).toHaveBeenCalledTimes(1);
      // Every monitor's incident is matched against the rules read once.
      expect(
        IncidentOnCallRuleEngineService.getMatchingRules,
      ).toHaveBeenCalledTimes(50);
      for (const call of (
        IncidentOnCallRuleEngineService.getMatchingRules as unknown as {
          mock: { calls: Array<Array<unknown>> };
        }
      ).mock.calls) {
        expect(call[1]).toMatchObject({ rules: world.incidentRules });
      }
      // The project, its policies and each person are read once.
      expect(ProjectService.findOneById).toHaveBeenCalledTimes(1);
      expect(OnCallDutyPolicyService.findBy).toHaveBeenCalledTimes(1);
      expect(OnCallTestPageService.readFirstLevel).toHaveBeenCalledTimes(1);
      expect(OnCallTestPageService.getPersonPreview).toHaveBeenCalledTimes(2);
      // No monitor is read again, and nothing a break does not need.
      expect(MonitorService.findOneBy).not.toHaveBeenCalled();
      expect(MonitorService.findOwners).not.toHaveBeenCalled();
      expect(ProjectService.getOwners).not.toHaveBeenCalled();
      expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
    });

    test("a rule on a monitor's name is matched from the monitors handed in: no monitor is read again", async () => {
      stubRuleReads();

      const byName: IncidentOnCallRule = rule(RULE, "Checkout pages", [
        PRIMARY,
      ]);
      byName.monitorNamePattern = "^Checkout";
      world.incidentRules = [byName];

      // The engine's own matching, from the rules and monitors handed to it.
      jest
        .mocked(IncidentOnCallRuleEngineService.getMatchingRules)
        .mockRestore();

      const read: SpyInstance<typeof MonitorService.findOneById> = jest
        .spyOn(MonitorService, "findOneById")
        .mockResolvedValue(null as never);
      read.mockClear();

      const results: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [
            projectMonitor(MONITOR_ID.toString(), "Checkout API"),
            projectMonitor(
              "68101111-0000-4000-8000-000000000003",
              "Billing API",
            ),
          ],
        });

      expect(read).not.toHaveBeenCalled();
      expect(kinds(results[0]!)).not.toContain(WhoIsToldBreakKind.NobodyPaged);
      expect(kinds(results[1]!)).toContain(WhoIsToldBreakKind.NobodyPaged);
    });

    test("only the breaks' worth is read: owners go unnamed and no status page is listed", async () => {
      stubRuleReads();

      const [result]: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [projectMonitor(MONITOR_ID.toString(), "Checkout API")],
        });

      expect(firstEvent(result!).owners).toEqual({
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: [],
        teamNames: [],
      });
      expect(firstEvent(result!).ownerRules).toEqual([]);
      /*
       * No owner rule, network device, project membership or status page is
       * read for breaks only.
       */
      expect(IncidentOwnerRuleService.findBy).not.toHaveBeenCalled();
      expect(AlertOwnerRuleService.findBy).not.toHaveBeenCalled();
      expect(TeamMemberService.findBy).not.toHaveBeenCalled();
      expect(TeamMemberService.getProjectMemberUserIds).not.toHaveBeenCalled();
      expect(
        NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor,
      ).not.toHaveBeenCalled();
      expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
      expect(firstEvent(result!).statusPages).toEqual([]);
      expect(
        result!.criteria.find(
          (item: WhoIsToldResult["criteria"][number]): boolean => {
            return item.name === "Online";
          },
        )!.statusOwners,
      ).toBeUndefined();
    });

    test("owners the criteria names are said to be named, without reading them", async () => {
      stubRuleReads();
      world.monitorSteps = stepsOf([
        offlineCriteria({
          incidents: [
            {
              id: "incident-template",
              title: "Down",
              description: "",
              incidentSeverityId: new ObjectID(CRITICAL),
              ownerTeamIds: [ObjectID.generate()],
            },
          ],
        }),
      ]);

      const [result]: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [projectMonitor(MONITOR_ID.toString(), "Checkout API")],
        });

      expect(firstEvent(result!).owners.source).toBe(
        WhoIsToldOwnersSource.Named,
      );
      expect(TeamService.findBy).not.toHaveBeenCalled();
      // Nor whether the team has anybody in the project (#7211).
      expect(TeamMemberService.findBy).not.toHaveBeenCalled();
      expect(TeamMemberService.getProjectMemberUserIds).not.toHaveBeenCalled();
    });

    test("the project's Readiness gives every responder's verified methods up front", async () => {
      stubRuleReads();

      const [result]: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [projectMonitor(MONITOR_ID.toString(), "Checkout API")],
          readiness: [
            readiness(ANA, ["SMS", "Email"]),
            readiness(BEN, ["Push"]),
          ],
        });

      expect(
        OnCallReadinessService.getReadinessForUsers,
      ).not.toHaveBeenCalled();
      // Ben has no rule for the severity: the fallback pages his verified push.
      expect(
        firstEvent(result!).policies[0]!.people.find(
          (person: { userId: string }): boolean => {
            return person.userId === BEN;
          },
        ),
      ).toMatchObject({ channels: [OnCallPageChannel.Push], isFallback: true });
    });

    test("no monitor: nothing is read", async () => {
      const ruleReads: ReturnType<typeof stubRuleReads> = stubRuleReads();

      expect(
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [],
        }),
      ).toEqual([]);
      expect(ruleReads.incident).not.toHaveBeenCalled();
      expect(ProjectService.findOneById).not.toHaveBeenCalled();
    });
  });

  describe("owner rules (#7076)", () => {
    test("the owners an owner rule adds are emailed, and the rule is said", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Checkout monitors",
          userIds: [BEN],
          teamIds: [SRE_TEAM],
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Ben Ito"],
        teamNames: ["Checkout SRE"],
      });
      expect(event.ownerRules).toEqual([
        { id: OWNER_RULE, name: "Checkout monitors" },
      ]);
    });

    test("a rule matches the title the incident gets, not its template as written", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ title: "{{monitorName}} is offline" }),
      );
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Checkout monitors",
          userIds: [BEN],
          titlePattern: "^Checkout API is offline$",
        }),
        incidentOwnerRule({
          id: OTHER_OWNER_RULE,
          name: "Templates as written",
          userIds: [CARA],
          titlePattern: "monitorName",
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.title).toBe("Checkout API is offline");
      expect(event.owners.userNames).toEqual(["Ben Ito"]);
      expect(event.ownerRules).toEqual([
        { id: OWNER_RULE, name: "Checkout monitors" },
      ]);
      // The on-call rules are asked about the same title.
      expect(onCallTitles).toEqual(["Checkout API is offline"]);
    });

    test("a value only a check reports is left as written in the title", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({
          title: "{{monitorName}} answered {{responseStatusCode}}",
        }),
      );

      expect(firstEvent(await resolve()).title).toBe(
        "Checkout API answered {{responseStatusCode}}",
      );
    });

    test("a rule that does not match adds nobody, and the project's owners are emailed", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Search monitors",
          userIds: [BEN],
          monitorNamePattern: "^Search",
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.owners).toEqual({
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: ["Owner One"],
        teamNames: [],
      });
      expect(event.ownerRules).toEqual([]);
    });

    test("a rule matches on the monitor's name and labels, as the engine reads them", async () => {
      world.monitorLabelIds = [MONITOR_LABEL];
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Checkout monitors",
          userIds: [BEN],
          monitorNamePattern: "^Checkout",
          monitorLabelIds: [MONITOR_LABEL],
        }),
      ];

      expect(firstEvent(await resolve()).owners.userNames).toEqual(["Ben Ito"]);

      world.monitorLabelIds = [];

      expect(firstEvent(await resolve()).owners.source).toBe(
        WhoIsToldOwnersSource.ProjectOwners,
      );
    });

    test("a rule matches on the labels the criteria gives the incident", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Payments label",
          userIds: [BEN],
          labelIds: [INCIDENT_LABEL],
        }),
      ];
      world.monitorSteps = opensIncidents(
        incidentTemplate({ id: "plain" }),
        incidentTemplate({ id: "labelled", labelIds: ids([INCIDENT_LABEL]) }),
      );

      const result: WhoIsToldResult = await resolve();

      expect(
        events(result).map((event: WhoIsToldEvent): string => {
          return event.owners.source;
        }),
      ).toEqual([
        WhoIsToldOwnersSource.ProjectOwners,
        WhoIsToldOwnersSource.OwnerRules,
      ]);
    });

    test("owners the criteria names and owners a rule adds are both emailed, each once, the named first", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ ownerUserIds: ids([ANA]) }),
      );
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Checkout monitors",
          userIds: [BEN, ANA],
          teamIds: [SRE_TEAM],
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Ana Lopez", "Ben Ito"],
        teamNames: ["Checkout SRE"],
      });
      expect(event.ownerRules).toEqual([
        { id: OWNER_RULE, name: "Checkout monitors" },
      ]);
    });

    /*
     * Notify Owners off only keeps the rule's "owner added" message from
     * them: the incident's "created" email goes to every owner it has
     * (IncidentService.findOwners), however they were added.
     */
    test("a rule that adds owners quietly still makes them owners the created email reaches", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Quiet",
          userIds: [BEN],
          notifyOwners: false,
        }),
      ];

      expect(firstEvent(await resolve()).owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Ben Ito"],
        teamNames: [],
      });
    });

    test("every rule that adds somebody is said, in the order the rules are evaluated", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OTHER_OWNER_RULE,
          name: "First",
          userIds: [CARA],
        }),
        incidentOwnerRule({ id: OWNER_RULE, name: "Second", userIds: [BEN] }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.ownerRules).toEqual([
        { id: OTHER_OWNER_RULE, name: "First" },
        { id: OWNER_RULE, name: "Second" },
      ]);
      expect(event.owners.userNames).toEqual(["Cara Diaz", "Ben Ito"]);
    });

    test("a rule that inherits the monitor's owners adds them, and reads no other resource", async () => {
      world.monitorOwnerUserIds = [DAN];
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Monitor owners",
          inheritOwnersFromMonitors: true,
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Dan Okafor"],
        teamNames: [],
      });
      expect(
        MonitorResourceContextUtil.resolveLinkedResourcesForMonitor,
      ).not.toHaveBeenCalled();
      expect(
        MonitorResourceContextUtil.resolveResourceContextForMonitor,
      ).not.toHaveBeenCalled();
    });

    test("a rule that inherits from the services the monitor is linked to: their owners, read once for every incident and alert", async () => {
      world.linkedResources = {
        ...MonitorResourceContextUtil.emptyContext(),
        serviceIds: [SERVICE],
      };
      world.serviceOwnerUserIds = { [SERVICE]: [CARA] };
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Service owners",
          inheritOwnersFromServices: true,
        }),
      ];
      world.alertOwnerRules = [
        alertOwnerRule({
          id: ALERT_OWNER_RULE,
          name: "Service owners of alerts",
          inheritOwnersFromServices: true,
        }),
      ];
      world.monitorSteps = stepsOf([
        offlineCriteria({
          incidents: [
            incidentTemplate({ id: "a" }),
            incidentTemplate({ id: "b" }),
          ],
          createAlerts: true,
          alerts: [alertTemplate()],
        }),
      ]);

      const result: WhoIsToldResult = await resolve();

      expect(
        events(result).map((event: WhoIsToldEvent): Array<string> => {
          return event.owners.userNames;
        }),
      ).toEqual([["Cara Diaz"], ["Cara Diaz"], ["Cara Diaz"]]);
      expect(
        MonitorResourceContextUtil.resolveLinkedResourcesForMonitor,
      ).toHaveBeenCalledTimes(1);
      expect(
        MonitorResourceContextUtil.resolveResourceContextForMonitor,
      ).toHaveBeenCalledTimes(1);
    });

    test("a rule that matches but adds nobody - what it inherits from is owned by nobody - is not said", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Service owners",
          inheritOwnersFromServices: true,
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.ownerRules).toEqual([]);
      expect(event.owners.source).toBe(WhoIsToldOwnersSource.ProjectOwners);
    });

    test("alert owner rules add owners to alerts, and incident owner rules to incidents only", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Incidents",
          userIds: [BEN],
        }),
      ];
      world.alertOwnerRules = [
        alertOwnerRule({
          id: ALERT_OWNER_RULE,
          name: "Alerts",
          userIds: [CARA],
          titlePattern: "^Checkout API",
        }),
      ];
      world.monitorSteps = stepsOf([
        offlineCriteria({
          createAlerts: true,
          alerts: [alertTemplate({ title: "{{monitorName}} is slow" })],
        }),
      ]);

      const [incident, alert]: Array<WhoIsToldEvent> = events(await resolve());

      expect(incident!.owners.userNames).toEqual(["Ben Ito"]);
      expect(incident!.ownerRules).toEqual([
        { id: OWNER_RULE, name: "Incidents" },
      ]);
      expect(alert!.kind).toBe(OnCallTestPageRecordKind.Alert);
      expect(alert!.title).toBe("Checkout API is slow");
      expect(alert!.owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Cara Diaz"],
        teamNames: [],
      });
      expect(alert!.ownerRules).toEqual([
        { id: ALERT_OWNER_RULE, name: "Alerts" },
      ]);
    });

    test("the project's rules, the people and the teams are read once for the whole answer", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({ id: OWNER_RULE, name: "Everyone", userIds: [BEN] }),
      ];
      world.monitorSteps = stepsOf(
        [offlineCriteria({ incidents: [incidentTemplate({ id: "a" })] })],
        [
          offlineCriteria({
            id: "second",
            incidents: [incidentTemplate({ id: "b" })],
          }),
        ],
      );

      const result: WhoIsToldResult = await resolve();

      expect(events(result)).toHaveLength(2);

      const rootRuleReads: number = (
        IncidentOwnerRuleService.findBy as unknown as jest.SpiedFunction<
          (args: { props: DatabaseCommonInteractionProps }) => unknown
        >
      ).mock.calls.filter(
        (call: Array<{ props: DatabaseCommonInteractionProps }>): boolean => {
          return Boolean(call[0]?.props.isRoot);
        },
      ).length;

      expect(rootRuleReads).toBe(1);
      expect(UserService.findBy).toHaveBeenCalledTimes(1);
    });
  });

  describe("status pages (#7077)", () => {
    test("a page that shows the monitor through a monitor group is listed", async () => {
      world.statusPageLinks = [
        {
          resourceId: "68101111-0000-4000-8000-000000000511",
          statusPageId: GROUP_PAGE,
          monitorGroupId: MONITOR_GROUP,
        },
      ];
      world.monitorGroupIds = [MONITOR_GROUP];
      world.statusPages = [{ id: GROUP_PAGE, name: "Payments status" }];

      expect(firstEvent(await resolve()).statusPages).toEqual([
        { id: GROUP_PAGE, name: "Payments status" },
      ]);
    });

    test("a page that lists the monitor and a group it is in is listed once, with the others in name order", async () => {
      world.statusPageLinks = [
        {
          resourceId: "68101111-0000-4000-8000-000000000521",
          statusPageId: STATUS_PAGE,
        },
        {
          resourceId: "68101111-0000-4000-8000-000000000522",
          statusPageId: STATUS_PAGE,
          monitorGroupId: MONITOR_GROUP,
        },
        {
          resourceId: "68101111-0000-4000-8000-000000000523",
          statusPageId: GROUP_PAGE,
          monitorGroupId: MONITOR_GROUP,
        },
      ];
      world.monitorGroupIds = [MONITOR_GROUP];
      world.statusPages = [
        { id: STATUS_PAGE, name: "Public status" },
        { id: GROUP_PAGE, name: "Payments status" },
      ];

      expect(firstEvent(await resolve()).statusPages).toEqual([
        { id: GROUP_PAGE, name: "Payments status" },
        { id: STATUS_PAGE, name: "Public status" },
      ]);
    });

    test("a page that shows only incidents limited to it, hides incidents, is archived or is another project's is not listed", async () => {
      world.statusPageLinks = [
        STATUS_PAGE,
        SCOPED_ONLY_PAGE,
        NO_INCIDENTS_PAGE,
        ELSEWHERE_PAGE,
        ARCHIVED_PAGE,
      ].map((statusPageId: string, index: number): StatusPageLink => {
        return {
          resourceId: `68101111-0000-4000-8000-00000000053${index}`,
          statusPageId: statusPageId,
        };
      });
      world.statusPages = [
        { id: STATUS_PAGE, name: "Public status" },
        { id: SCOPED_ONLY_PAGE, name: "Scoped", onlyShowScopedIncidents: true },
        {
          id: NO_INCIDENTS_PAGE,
          name: "Maintenance only",
          showIncidentsOnStatusPage: false,
        },
        { id: ELSEWHERE_PAGE, name: "Elsewhere", projectId: OTHER_PROJECT_ID },
        // The archived page is never loaded (getStatusPagesToSendNotification).
      ];

      expect(firstEvent(await resolve()).statusPages).toEqual([
        { id: STATUS_PAGE, name: "Public status" },
      ]);
    });

    test("an incident kept off status pages, or made private, shows on none", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ id: "hidden", showIncidentOnStatusPage: false }),
        incidentTemplate({ id: "private", isPrivate: true }),
        incidentTemplate({ id: "public" }),
      );

      expect(
        events(await resolve()).map((event: WhoIsToldEvent): Array<string> => {
          return event.statusPages.map(
            (page: WhoIsToldEvent["statusPages"][number]): string => {
              return page.id;
            },
          );
        }),
      ).toEqual([[], [], [STATUS_PAGE]]);
    });

    test("a monitor no page shows is on no status page, and no page is loaded", async () => {
      world.statusPageLinks = [];

      expect(firstEvent(await resolve()).statusPages).toEqual([]);
      expect(
        StatusPageSubscriberService.getStatusPagesToSendNotification,
      ).not.toHaveBeenCalled();
    });
  });

  describe("for one caller", () => {
    async function forCaller(): Promise<WhoIsToldResult> {
      return await WhoIsToldService.getForMonitor({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        props: CALLER,
      });
    }

    function withOwnerRuleAndPages(): void {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Checkout monitors",
          userIds: [BEN],
        }),
      ];
      world.statusPageLinks = [
        {
          resourceId: "68101111-0000-4000-8000-000000000541",
          statusPageId: STATUS_PAGE,
        },
        {
          resourceId: "68101111-0000-4000-8000-000000000542",
          statusPageId: GROUP_PAGE,
          monitorGroupId: MONITOR_GROUP,
        },
      ];
      world.monitorGroupIds = [MONITOR_GROUP];
      world.statusPages = [
        { id: STATUS_PAGE, name: "Public status" },
        { id: GROUP_PAGE, name: "Payments status" },
      ];
    }

    test("somebody who may read the monitor and its policies is told the whole chain", async () => {
      withOwnerRuleAndPages();

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).policies[0]!.name).toBe("Primary");
      expect(firstEvent(result).policies[0]!.people).toHaveLength(2);
      expect(firstEvent(result).rules[0]!.name).toBe("Every incident");
      expect(firstEvent(result).ownerRules).toEqual([
        { id: OWNER_RULE, name: "Checkout monitors" },
      ]);
      expect(firstEvent(result).statusPages).toEqual([
        { id: GROUP_PAGE, name: "Payments status" },
        { id: STATUS_PAGE, name: "Public status" },
      ]);
    });

    test("somebody who may not read the monitor is told it is not found", async () => {
      world.callerReadsMonitor = false;

      await expect(forCaller()).rejects.toThrow("Monitor not found.");
    });

    test("somebody who may read the monitor but no policy learns paging is set up, and nothing of who", async () => {
      world.callerPolicies = "refused";
      world.callerIncidentRules = "refused";

      const result: WhoIsToldResult = await forCaller();
      const policy: WhoIsToldEvent["policies"][number] =
        firstEvent(result).policies[0]!;

      expect(policy.isHidden).toBe(true);
      expect(policy.name).toBe("");
      expect(policy.people).toEqual([]);
      expect(firstEvent(result).rules).toEqual([{ id: RULE, name: "" }]);
      expect(JSON.stringify(result)).not.toContain("Ana Lopez");
      expect(JSON.stringify(result)).not.toContain("Every incident");
    });

    test("only the policies the caller may not read are hidden", async () => {
      world.incidentRules = [
        rule(RULE, "Every incident", [PRIMARY, SECONDARY]),
      ];
      world.callerPolicies = [SECONDARY];

      const result: WhoIsToldResult = await forCaller();

      expect(
        firstEvent(result).policies.map(
          (policy: WhoIsToldEvent["policies"][number]) => {
            return [policy.id, policy.isHidden];
          },
        ),
      ).toEqual([
        [PRIMARY, true],
        [SECONDARY, false],
      ]);
      // Secondary's own break is still told: the caller may read it.
      expect(kinds(result)).toEqual([WhoIsToldBreakKind.PolicyHasNoLevels]);
      expect(result.breaks[0]!.policyName).toBe("Secondary");
    });

    test("an owner rule the caller may not read is not named, and who it emails still is", async () => {
      withOwnerRuleAndPages();
      world.callerIncidentOwnerRules = "refused";

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).ownerRules).toEqual([
        { id: OWNER_RULE, name: "" },
      ]);
      expect(JSON.stringify(result)).not.toContain("Checkout monitors");
      expect(firstEvent(result).owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Ben Ito"],
        teamNames: [],
      });
    });

    test("a status page the caller may not read is not named, and only that one", async () => {
      withOwnerRuleAndPages();
      world.callerStatusPages = [STATUS_PAGE];

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).statusPages).toEqual([
        { id: GROUP_PAGE, name: "" },
        { id: STATUS_PAGE, name: "Public status" },
      ]);
      expect(JSON.stringify(result)).not.toContain("Payments status");
    });

    test("a caller who may read no status page is told how many an incident shows on, and none by name", async () => {
      withOwnerRuleAndPages();
      world.callerStatusPages = "refused";

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).statusPages).toEqual([
        { id: GROUP_PAGE, name: "" },
        { id: STATUS_PAGE, name: "" },
      ]);
    });

    test("what the caller may read is asked as they would ask it, and only of what the answer holds", async () => {
      withOwnerRuleAndPages();

      await forCaller();

      const ownerRuleReads: Array<
        Array<{ query: unknown; props: DatabaseCommonInteractionProps }>
      > = (
        IncidentOwnerRuleService.findBy as unknown as jest.SpiedFunction<
          (args: {
            query: unknown;
            props: DatabaseCommonInteractionProps;
          }) => unknown
        >
      ).mock.calls.filter(
        (call: Array<{ props: DatabaseCommonInteractionProps }>): boolean => {
          return !call[0]?.props.isRoot;
        },
      ) as Array<
        Array<{ query: unknown; props: DatabaseCommonInteractionProps }>
      >;

      expect(ownerRuleReads).toHaveLength(1);
      expect(ownerRuleReads[0]![0]!.props).toBe(CALLER);
      expect(idsIn(ownerRuleReads[0]![0]!.query)).toEqual([OWNER_RULE]);

      const pageReads: Array<
        Array<{ query: unknown; props: DatabaseCommonInteractionProps }>
      > = (
        StatusPageService.findBy as unknown as jest.SpiedFunction<
          (args: {
            query: unknown;
            props: DatabaseCommonInteractionProps;
          }) => unknown
        >
      ).mock.calls as Array<
        Array<{ query: unknown; props: DatabaseCommonInteractionProps }>
      >;

      expect(pageReads).toHaveLength(1);
      expect(pageReads[0]![0]!.props).toBe(CALLER);
      expect(idsIn(pageReads[0]![0]!.query).sort()).toEqual(
        [STATUS_PAGE, GROUP_PAGE].sort(),
      );
      // Nothing to ask of alert owner rules: no alert opens.
      expect(AlertOwnerRuleService.findBy).toHaveBeenCalledTimes(1);
    });

    test("the cached answer is the same for every caller, and each is handed their own view of it", async () => {
      withOwnerRuleAndPages();
      await forCaller();
      world.callerPolicies = "refused";
      world.callerIncidentOwnerRules = "refused";
      world.callerStatusPages = "refused";

      const hidden: WhoIsToldResult = await forCaller();

      expect(firstEvent(hidden).policies[0]!.isHidden).toBe(true);
      expect(firstEvent(hidden).ownerRules[0]!.name).toBe("");
      expect(firstEvent(hidden).statusPages[0]!.name).toBe("");

      world.callerPolicies = [PRIMARY];
      world.callerIncidentOwnerRules = [OWNER_RULE];
      world.callerStatusPages = [GROUP_PAGE, STATUS_PAGE];

      const shown: WhoIsToldResult = await forCaller();

      expect(firstEvent(shown).policies[0]!.isHidden).toBe(false);
      expect(firstEvent(shown).ownerRules[0]!.name).toBe("Checkout monitors");
      expect(firstEvent(shown).statusPages[0]!.name).toBe("Payments status");
      // Worked out once: every caller after the first is handed the kept answer.
      expect(MonitorService.findOneBy).toHaveBeenCalledTimes(4);
    });
  });
});

describe("the resolver's pure helpers", () => {
  test("every step's criteria, each once, in the order they are checked", () => {
    const first: MonitorCriteriaInstance = criteriaInstance({
      id: "a",
      name: "A",
    });
    const second: MonitorCriteriaInstance = criteriaInstance({
      id: "b",
      name: "B",
    });

    expect(
      getMonitorCriteriaInstances(stepsOf([first, second], [first])).map(
        (instance: MonitorCriteriaInstance): string => {
          return instance.data!.id;
        },
      ),
    ).toEqual(["a", "b"]);
    expect(getMonitorCriteriaInstances(undefined)).toEqual([]);
    expect(getMonitorCriteriaInstances(stepsOf())).toEqual([]);
  });

  test("each criteria with the step it is checked in", () => {
    const first: MonitorCriteriaInstance = criteriaInstance({
      id: "a",
      name: "A",
    });
    const second: MonitorCriteriaInstance = criteriaInstance({
      id: "b",
      name: "B",
    });

    expect(
      getMonitorCriteria(stepsOf([first], [second, first])).map(
        (item: ReturnType<typeof getMonitorCriteria>[number]) => {
          return [item.instance.data!.id, item.monitorStepId];
        },
      ),
    ).toEqual([
      ["a", STEP_ID],
      ["b", "68101111-0000-4000-8000-000000000301"],
    ]);
  });

  test("the criteria's severity when the project has it, else the first not archived", () => {
    const archived: IncidentSeverity = withId(new IncidentSeverity(), "x");
    archived.isArchived = true;
    const critical: IncidentSeverity = withId(new IncidentSeverity(), CRITICAL);
    const minor: IncidentSeverity = withId(new IncidentSeverity(), MINOR);
    const all: Array<IncidentSeverity> = [archived, critical, minor];

    expect(pickSeverity(all, new ObjectID(MINOR))).toBe(minor);
    expect(pickSeverity(all, ObjectID.generate())).toBe(critical);
    expect(pickSeverity(all, undefined)).toBe(critical);
    expect(pickSeverity(all, new ObjectID(""))).toBe(critical);
    expect(pickSeverity([archived], undefined)).toBeNull();
  });

  test("the server can send by a channel unless it is not set up or failing", () => {
    const statuses: Array<ServerChannelStatus> = [
      serverStatus(ServerSendingChannel.Email, ServerSendingState.Working),
      serverStatus(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
      serverStatus(ServerSendingChannel.Call, ServerSendingState.Failing),
      serverStatus(ServerSendingChannel.Push, ServerSendingState.Untested),
    ];

    expect(canServerSendBy(statuses, ServerSendingChannel.Email)).toBe(true);
    expect(canServerSendBy(statuses, ServerSendingChannel.SMS)).toBe(false);
    expect(canServerSendBy(statuses, ServerSendingChannel.Call)).toBe(false);
    expect(canServerSendBy(statuses, ServerSendingChannel.Push)).toBe(true);
    expect(canServerSendBy([], ServerSendingChannel.Email)).toBeNull();
  });
});
