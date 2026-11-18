/*
 * The resolver renders titles through MonitorTemplateUtil, which pulls the
 * native isolated-vm addon in through VMAPI. Nothing here runs the sandbox,
 * and the prebuilt binary cannot always load in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertPrivacyRule from "../../../Models/DatabaseModels/AlertPrivacyRule";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentPrivacyRule from "../../../Models/DatabaseModels/IncidentPrivacyRule";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import AlertIncidentRuleService from "../../../Server/Services/AlertIncidentRuleService";
import AlertLabelRuleService from "../../../Server/Services/AlertLabelRuleService";
import AlertPrivacyRuleService from "../../../Server/Services/AlertPrivacyRuleService";
import IncidentLabelRuleService from "../../../Server/Services/IncidentLabelRuleService";
import IncidentPrivacyRuleService from "../../../Server/Services/IncidentPrivacyRuleService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Alert from "../../../Models/DatabaseModels/Alert";
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
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallReadinessService, {
  ReadinessStatus,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import OnCallTestPageService, {
  getPreviewMethodsOfRule,
} from "../../../Server/Services/OnCallTestPageService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import ServiceOwnerTeamService from "../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../Server/Services/ServiceOwnerUserService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMattermostService from "../../../Server/Services/UserMattermostService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService, {
  ExecuteFallbackNotificationOptions,
  ExecuteNotificationRuleOptions,
  FallbackRule,
} from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import WhoIsToldService, {
  WhoIsToldDraft,
  canServerSendBy,
  getFallbackRuleChannels,
  getMonitorCriteria,
  getMonitorCriteriaInstances,
  pickSeverity,
} from "../../../Server/Services/WhoIsToldService";
import OwnedScopePermission from "../../../Server/Types/Database/Permissions/OwnedScopePermission";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import moment from "moment-timezone";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
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
  WhoIsToldFix,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerKind,
  WhoIsToldOwnerProblem,
  WhoIsToldOwnersSource,
  WhoIsToldPerson,
  WhoIsToldPersonProblem,
  WhoIsToldPolicy,
  WhoIsToldResult,
  WhoIsToldServerChannel,
  getWhoIsToldBreaksForReader,
} from "../../../Types/Monitor/WhoIsTold";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import AlertIncidentRuleEngineService from "../../../Server/Services/AlertIncidentRuleEngineService";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPageNotPaged,
  OnCallTestPageNotPagedCode,
  OnCallTestPagePreviewMethod,
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
const PAYMENTS_TEAM: string = "68101111-0000-4000-8000-000000000073";
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
const OTHER_MONITOR_GROUP: string = "68101111-0000-4000-8000-000000000082";

// The monitor groups' names, by id.
const MONITOR_GROUP_NAMES: Record<string, string> = {
  [MONITOR_GROUP]: "Checkout",
  [OTHER_MONITOR_GROUP]: "Payments",
};
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
  [PAYMENTS_TEAM]: "Payments",
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

// The verified methods a person has, as the fallback reads them.
interface FallbackMethods {
  push?: boolean;
  email?: boolean;
  slack?: boolean;
  teams?: boolean;
  mattermost?: boolean;
  sms?: boolean;
  call?: boolean;
  whatsApp?: boolean;
  telegram?: boolean;
  webhook?: boolean;
}

// The readiness method type of each, for the same person's Readiness.
const FALLBACK_METHOD_TYPES: Record<keyof FallbackMethods, string> = {
  push: "Push",
  email: "Email",
  slack: "Slack",
  teams: "Microsoft Teams",
  mattermost: "Mattermost",
  sms: "SMS",
  call: "Call",
  whatsApp: "WhatsApp",
  telegram: "Telegram",
  webhook: "Webhook",
};

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
  // The project's privacy, label and alert incident rules (#7212, #7213, #7216).
  incidentPrivacyRules: Array<IncidentPrivacyRule>;
  alertPrivacyRules: Array<AlertPrivacyRule>;
  incidentLabelRules: Array<IncidentLabelRule>;
  alertLabelRules: Array<AlertLabelRule>;
  alertIncidentRules: Array<AlertIncidentRule>;
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
  /*
   * Each person's verified methods as the fallback's own reader finds them
   * (UserNotificationRuleService.getFallbackRules), run for real (#7528).
   */
  fallbackMethods: Record<string, FallbackMethods>;
  // The project's on-call policies, by id and name, and those archived.
  projectPolicies: Array<[string, string]>;
  archivedPolicyIds: Array<string>;
  serverStatuses: Array<ServerChannelStatus>;
  // What the caller may read.
  callerReadsMonitor: boolean;
  callerPolicies: Array<string> | "refused";
  callerIncidentRules: Array<string> | "refused";
  callerIncidentOwnerRules: Array<string> | "refused";
  callerAlertOwnerRules: Array<string> | "refused";
  callerStatusPages: Array<string> | "refused";
  // Privacy, label and alert incident rules, of either kind, and monitor groups.
  callerPrivacyRules: Array<string> | "refused";
  callerLabelRules: Array<string> | "refused";
  callerAlertIncidentRules: Array<string> | "refused";
  callerMonitorGroups: Array<string> | "refused";
  /*
   * The caller's own team rows (#7213): the teams whose invitation they
   * accepted, and those they were invited to and have not.
   */
  callerAcceptedTeamIds: Array<string>;
  callerPendingTeamIds: Array<string>;
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
    incidentPrivacyRules: [],
    alertPrivacyRules: [],
    incidentLabelRules: [],
    alertLabelRules: [],
    alertIncidentRules: [],
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
    fallbackMethods: {
      [ANA]: { sms: true, email: true },
      [BEN]: { push: true },
    },
    projectPolicies: [
      [PRIMARY, "Primary"],
      [SECONDARY, "Secondary"],
    ],
    archivedPolicyIds: [],
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
    callerPrivacyRules: [],
    callerLabelRules: [],
    callerAlertIncidentRules: [],
    callerMonitorGroups: [],
    callerAcceptedTeamIds: [],
    callerPendingTeamIds: [],
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
        return world.projectPolicies.map(
          ([id, name]: [string, string]): OnCallDutyPolicy => {
            const item: OnCallDutyPolicy = withId(new OnCallDutyPolicy(), id);
            item.name = name;
            item.isArchived = world.archivedPolicyIds.includes(id);
            return item;
          },
        );
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

  /*
   * The project's privacy, label and alert incident rules, as the engines
   * read them as OneUptime (getEnabledRules), and what a caller may read.
   */
  const ruleReads: Array<{
    service: { findBy: unknown };
    rules: () => Array<{ _id?: string | undefined }>;
    caller: () => Array<string> | "refused";
    what: string;
  }> = [
    {
      service: IncidentPrivacyRuleService,
      rules: () => {
        return world.incidentPrivacyRules;
      },
      caller: () => {
        return world.callerPrivacyRules;
      },
      what: "incident privacy rules",
    },
    {
      service: AlertPrivacyRuleService,
      rules: () => {
        return world.alertPrivacyRules;
      },
      caller: () => {
        return world.callerPrivacyRules;
      },
      what: "alert privacy rules",
    },
    {
      service: IncidentLabelRuleService,
      rules: () => {
        return world.incidentLabelRules;
      },
      caller: () => {
        return world.callerLabelRules;
      },
      what: "incident label rules",
    },
    {
      service: AlertLabelRuleService,
      rules: () => {
        return world.alertLabelRules;
      },
      caller: () => {
        return world.callerLabelRules;
      },
      what: "alert label rules",
    },
    {
      service: AlertIncidentRuleService,
      rules: () => {
        return world.alertIncidentRules;
      },
      caller: () => {
        return world.callerAlertIncidentRules;
      },
      what: "alert incident rules",
    },
  ];

  for (const read of ruleReads) {
    jest
      .spyOn(read.service as { findBy: () => Promise<unknown> }, "findBy")
      .mockImplementation((async (args: {
        query: unknown;
        props: DatabaseCommonInteractionProps;
      }) => {
        if (args.props.isRoot) {
          return read.rules();
        }

        return readable(
          args.query,
          read.caller(),
          (): IncidentPrivacyRule => {
            return new IncidentPrivacyRule();
          },
          read.what,
        );
      }) as never);
  }

  // The monitor groups a caller may read (#7214).
  jest.spyOn(MonitorGroupService, "findBy").mockImplementation((async (args: {
    query: unknown;
  }) => {
    return readable(
      args.query,
      world.callerMonitorGroups,
      (): MonitorGroup => {
        return new MonitorGroup();
      },
      "monitor groups",
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
      // As a page lists it: the monitor itself, or a group it is in, by name (#7214).
      const toResource: (link: StatusPageLink) => StatusPageResource = (
        link: StatusPageLink,
      ): StatusPageResource => {
        const resource: StatusPageResource = withId(
          new StatusPageResource(),
          link.resourceId,
        );
        resource.statusPageId = new ObjectID(link.statusPageId);

        if (link.monitorGroupId) {
          resource.monitorGroupId = new ObjectID(link.monitorGroupId);
          resource.monitorGroup = withId(
            new MonitorGroup(),
            link.monitorGroupId,
          );
          resource.monitorGroup.name =
            MONITOR_GROUP_NAMES[link.monitorGroupId] || "";
        } else {
          resource.monitorId = MONITOR_ID;
        }

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
    query: {
      projectId?: ObjectID;
      userId?: ObjectID;
      hasAcceptedInvitation?: boolean;
    };
  }) => {
    /*
     * The caller's own rows, for who may read a private record (#7213):
     * only those they accepted, as the read asks.
     */
    if (args.query.userId) {
      const rows: Array<[string, boolean]> = [
        ...world.callerAcceptedTeamIds.map(
          (teamId: string): [string, boolean] => {
            return [teamId, true];
          },
        ),
        ...world.callerPendingTeamIds.map(
          (teamId: string): [string, boolean] => {
            return [teamId, false];
          },
        ),
      ];

      return rows
        .filter(([teamId, isAccepted]: [string, boolean]): boolean => {
          return (
            idsAt(args.query, "teamId").includes(teamId) &&
            (args.query.hasAcceptedInvitation !== true || isAccepted)
          );
        })
        .map(([teamId, isAccepted]: [string, boolean]): TeamMember => {
          const row: TeamMember = new TeamMember();
          row.teamId = new ObjectID(teamId);
          row.userId = args.query.userId!;
          row.hasAcceptedInvitation = isAccepted;
          return row;
        });
    }

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

  stubFallbackReads();
}

/*
 * THE FALLBACK'S OWN READER, run for real (#7528): only its reads of a
 * person's verified methods are stood in for, each from
 * world.fallbackMethods, and the project's switches are world.project's
 * (ProjectService.findOneById, above). So what the card says a person with
 * no rule is reached by is what UserNotificationRuleService picks.
 */
function fallbackRow(
  kind: keyof FallbackMethods,
  row: Record<string, unknown>,
): (args: { query: Record<string, unknown> }) => Promise<unknown> {
  return async (args: { query: Record<string, unknown> }): Promise<unknown> => {
    const userId: string = String(args.query["userId"]).toLowerCase();

    if (
      String(args.query["projectId"]) !== PROJECT_ID.toString() ||
      !world.fallbackMethods[userId]?.[kind]
    ) {
      return null;
    }

    return {
      id: new ObjectID(
        `68101111-0000-4000-8000-${userId.slice(-4)}000000${String(
          Object.keys(FALLBACK_METHOD_TYPES).indexOf(kind),
        ).padStart(2, "0")}`,
      ),
      isVerified: true,
      ...row,
    };
  };
}

function stubFallbackReads(): void {
  jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockResolvedValue(false as never);
  jest.spyOn(UserPushService, "findOneBy").mockImplementation(
    fallbackRow("push", {
      deviceName: "Pixel 8",
      deviceType: "android",
    }) as never,
  );
  jest
    .spyOn(UserEmailService, "findOneBy")
    .mockImplementation(
      fallbackRow("email", { email: new Email("ben@example.com") }) as never,
    );
  jest
    .spyOn(UserSlackService, "findOneBy")
    .mockImplementation(
      fallbackRow("slack", { slackUserName: "ben" }) as never,
    );
  jest
    .spyOn(UserMicrosoftTeamsService, "findOneBy")
    .mockImplementation(
      fallbackRow("teams", { microsoftTeamsUserName: "Ben Ito" }) as never,
    );
  jest
    .spyOn(UserMattermostService, "findOneBy")
    .mockImplementation(
      fallbackRow("mattermost", { mattermostUserName: "ben" }) as never,
    );
  jest
    .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
    .mockResolvedValue([] as never);
  jest
    .spyOn(UserSmsService, "findOneBy")
    .mockImplementation(
      fallbackRow("sms", { phone: new Phone("+15550300") }) as never,
    );
  jest
    .spyOn(UserCallService, "findOneBy")
    .mockImplementation(
      fallbackRow("call", { phone: new Phone("+15550301") }) as never,
    );
  jest
    .spyOn(UserWhatsAppService, "findOneBy")
    .mockImplementation(
      fallbackRow("whatsApp", { phone: new Phone("+15550302") }) as never,
    );
  jest
    .spyOn(UserTelegramService, "findOneBy")
    .mockImplementation(
      fallbackRow("telegram", { telegramUserHandle: "@ben" }) as never,
    );
  jest.spyOn(UserWebhookService, "findOneBy").mockImplementation(
    fallbackRow("webhook", {
      name: "Ben's pager bridge",
      webhookUrl: "https://hooks.example.com/ben",
    }) as never,
  );
  jest.spyOn(UserNotificationRuleService, "getFallbackRules");
}

// Ben, with no rule for the severity, has these methods and only these.
function benHas(methods: FallbackMethods): void {
  world.fallbackMethods[BEN] = methods;
  world.verified[BEN] = (Object.keys(methods) as Array<keyof FallbackMethods>)
    .filter((kind: keyof FallbackMethods): boolean => {
      return Boolean(methods[kind]);
    })
    .map((kind: keyof FallbackMethods): string => {
      return FALLBACK_METHOD_TYPES[kind];
    });
}

// Ben's line of the first policy the first incident runs.
function benOf(result: WhoIsToldResult): WhoIsToldPerson {
  const ben: WhoIsToldPerson | undefined = firstEvent(
    result,
  ).policies[0]!.people.find((person: WhoIsToldPerson): boolean => {
    return person.userId === BEN;
  });

  expect(ben).toBeDefined();

  return ben!;
}

/*
 * Who an event's Created email names, without the person-by-person list the
 * resolver keeps for its reader (WhoIsToldOwners.recipients, #8860), nor
 * the owners it never reaches (notReached, #7572: tested on their own).
 */
function withoutRecipients(
  owners: WhoIsToldEvent["owners"],
): WhoIsToldEvent["owners"] {
  const named: WhoIsToldEvent["owners"] = { ...owners };

  delete named.recipients;
  delete named.notReached;

  return named;
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
    expect(withoutRecipients(event.owners)).toEqual({
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
        // Her text goes out at once; her email waits five minutes (#8860).
        channelsAtOnce: [OnCallPageChannel.SMS],
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
        channelsAtOnce: [OnCallPageChannel.Push],
      },
    ]);
    expect(event.policies[0]!.notPaged).toEqual([]);
    expect(event.policies[0]!.notPagedCodes).toEqual([]);
    // The status page is listed once, though two of its resources show the monitor.
    expect(event.statusPages).toEqual([
      { id: STATUS_PAGE, name: "Public status", groups: [] },
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

    expect(withoutRecipients(event.owners)).toEqual({
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

    expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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

      expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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

      expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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

      expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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

      expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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

      expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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

      expect(withoutRecipients(event.owners)).toEqual({
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

      expect(withoutRecipients(event.owners)).toEqual({
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

      expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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
          return withoutRecipients(event.owners);
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

    expect(withoutRecipients(event.owners)).toEqual({
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

  /*
   * #7528: somebody with no rule for the severity was listed with every
   * method they verified - "Email, SMS and Phone call" - while a page of it
   * goes to what the project's fallback picks: every free verified method,
   * or else ONE paid one, or else a webhook. Ben has no rule for Critical.
   * The fallback's own reader runs here; only its reads are stood in for.
   */
  describe("a person with no rule for the severity: what the fallback picks (#7528)", () => {
    function fallbackCalls(): Array<{ userId: string; ruleType: string }> {
      return jest
        .mocked(UserNotificationRuleService.getFallbackRules)
        .mock.calls.map(
          (
            call: Parameters<
              typeof UserNotificationRuleService.getFallbackRules
            >,
          ): { userId: string; ruleType: string } => {
            return {
              userId: call[0].userId.toString(),
              ruleType: call[0].ruleType,
            };
          },
        );
    }

    test("a verified email, number and phone: Email only - never the text and the call a page does not send", async () => {
      benHas({ email: true, sms: true, call: true });

      const result: WhoIsToldResult = await resolve();

      expect(benOf(result)).toEqual({
        userId: BEN,
        name: "Ben Ito",
        reachedThrough: "Schedule Primary",
        reachedThroughCode: {
          code: OnCallTestPageReachedThroughCode.Schedule,
          name: "Primary",
        },
        channels: [OnCallPageChannel.Email],
        isFallback: true,
        isReachable: true,
        // What the fallback picks goes out as the page starts (#8860).
        channelsAtOnce: [OnCallPageChannel.Email],
      });
      expect(result.breaks).toEqual([]);
    });

    test("no free method: the one paid method it picks, a text, and not the call", async () => {
      benHas({ sms: true, call: true });

      expect(benOf(await resolve()).channels).toEqual([OnCallPageChannel.SMS]);
    });

    test("texts off in the project: the call it picks instead, and no switch is a break", async () => {
      world.project.enableSmsNotifications = false;
      benHas({ sms: true, call: true });

      const result: WhoIsToldResult = await resolve();

      expect(benOf(result)).toMatchObject({
        channels: [OnCallPageChannel.Call],
        isFallback: true,
        isReachable: true,
      });
      expect(kinds(result)).toEqual([]);
    });

    test("WhatsApp, with texts and calls off: WhatsApp", async () => {
      world.project.enableSmsNotifications = false;
      world.project.enableCallNotifications = false;
      benHas({ sms: true, call: true, whatsApp: true });

      expect(benOf(await resolve()).channels).toEqual([
        OnCallPageChannel.WhatsApp,
      ]);
    });

    test("only a webhook: the webhook", async () => {
      benHas({ webhook: true });

      expect(benOf(await resolve())).toMatchObject({
        channels: [OnCallPageChannel.Webhook],
        isReachable: true,
      });
    });

    test("every free method, in the order the fallback sends them, and none of the paid", async () => {
      benHas({
        push: true,
        email: true,
        slack: true,
        teams: true,
        mattermost: true,
        sms: true,
        call: true,
      });

      expect(benOf(await resolve()).channels).toEqual([
        OnCallPageChannel.Push,
        OnCallPageChannel.Email,
        OnCallPageChannel.Slack,
        OnCallPageChannel.MicrosoftTeams,
        OnCallPageChannel.Mattermost,
      ]);
    });

    test("nothing verified: can't be paged, with no verified method", async () => {
      benHas({});

      const result: WhoIsToldResult = await resolve();

      expect(benOf(result)).toMatchObject({
        channels: [],
        isFallback: true,
        isReachable: false,
        problem: WhoIsToldPersonProblem.NoVerifiedMethod,
      });
      expect(kinds(result)).toEqual([WhoIsToldBreakKind.PersonUnreachable]);
      expect(result.breaks[0]).toMatchObject({
        userName: "Ben Ito",
        problem: WhoIsToldPersonProblem.NoVerifiedMethod,
      });
    });

    test("their only method is a number, with texts off: the switch is the break, as for a rule", async () => {
      world.project.enableSmsNotifications = false;
      benHas({ sms: true });

      const result: WhoIsToldResult = await resolve();

      expect(benOf(result)).toMatchObject({
        channels: [OnCallPageChannel.SMS],
        isReachable: false,
        problem: WhoIsToldPersonProblem.ChannelsOff,
      });
      expect(
        result.breaks.map((brk: WhoIsToldBreak): Array<unknown> => {
          return [brk.kind, brk.channel];
        }),
      ).toEqual([[WhoIsToldBreakKind.ChannelOff, OnCallPageChannel.SMS]]);
    });

    test("the project's fallback off: unchanged, and the fallback is never asked", async () => {
      world.project.disableOnCallNotificationFallback = true;
      benHas({ email: true });

      expect(benOf(await resolve())).toMatchObject({
        isReachable: false,
        problem: WhoIsToldPersonProblem.NoRuleNoFallback,
      });
      expect(
        UserNotificationRuleService.getFallbackRules,
      ).not.toHaveBeenCalled();
    });

    test("opted out of the severity: unchanged, and the fallback is never asked", async () => {
      world.previews[BEN] = preview({
        userId: BEN,
        userName: "Ben Ito",
        hasNoRule: true,
        isOptedOut: true,
      });
      benHas({ email: true });

      expect(benOf(await resolve())).toMatchObject({
        isReachable: false,
        problem: WhoIsToldPersonProblem.OptedOut,
      });
      expect(
        UserNotificationRuleService.getFallbackRules,
      ).not.toHaveBeenCalled();
    });

    test("somebody with a rule is reached by it, and the fallback is never asked about them", async () => {
      benHas({ email: true });

      await resolve();

      expect(fallbackCalls()).toEqual([
        {
          userId: BEN,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        },
      ]);
    });

    test("read once a person and kind of page, however many severities and policies reach them", async () => {
      benHas({ email: true, sms: true });
      world.monitorSteps = opensIncidents(
        incidentTemplate(),
        incidentTemplate({
          id: "minor-template",
          incidentSeverityId: new ObjectID(MINOR),
        }),
      );
      world.incidentRules = [
        rule(RULE, "Every incident", [PRIMARY]),
        rule(ObjectID.generate().toString(), "Again", [PRIMARY]),
      ];

      const result: WhoIsToldResult = await resolve();

      // His rules are read for each severity; what the fallback picks, once.
      expect(
        jest
          .mocked(OnCallTestPageService.getPersonPreview)
          .mock.calls.filter((call: Array<unknown>): boolean => {
            return (call[0] as { userId: ObjectID }).userId.toString() === BEN;
          }),
      ).toHaveLength(2);
      expect(fallbackCalls()).toHaveLength(1);

      for (const event of events(result)) {
        expect(
          event.policies[0]!.people.find((person: WhoIsToldPerson) => {
            return person.userId === BEN;
          })!.channels,
        ).toEqual([OnCallPageChannel.Email]);
      }
    });

    test("an alert is read for alerts: a kind of page of its own", async () => {
      benHas({ email: true });
      world.monitorSteps = stepsOf([
        criteriaInstance({
          id: "offline",
          name: "Offline",
          createIncidents: true,
          incidents: [incidentTemplate()],
          createAlerts: true,
          alerts: [alertTemplate()],
        }),
      ]);
      world.alertRules = [
        rule(ObjectID.generate().toString(), "Every alert", [
          PRIMARY,
        ]) as unknown as AlertOnCallRule,
      ];

      await resolve();

      expect(
        fallbackCalls().map((call: { ruleType: string }): string => {
          return call.ruleType;
        }),
      ).toEqual([
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      ]);
    });

    test("self-hosted, the server can't send SMS: no SMS break for somebody the fallback emails", async () => {
      world.previews[ANA] = preview({
        methods: [
          {
            channel: OnCallPageChannel.Email,
            notifyAfterMinutes: 0,
            isVerified: true,
            canAcknowledge: true,
          },
        ],
      });
      benHas({ email: true, sms: true });
      world.serverStatuses = [
        serverStatus(ServerSendingChannel.Email, ServerSendingState.Working),
        serverStatus(ServerSendingChannel.SMS, ServerSendingState.NotSetUp),
        serverStatus(ServerSendingChannel.Call, ServerSendingState.NotSetUp),
      ];

      const result: WhoIsToldResult = await resolve();

      expect(benOf(result).channels).toEqual([OnCallPageChannel.Email]);
      // Nobody's page is a text or a call: what the server can't send stops nothing.
      expect(kinds(result)).toEqual([]);
    });

    test("the whole project at once reads what the fallback picks the same way, once a person", async () => {
      benHas({ email: true, sms: true, call: true });
      jest
        .spyOn(IncidentOnCallRuleEngineService, "readEnabledRules")
        .mockResolvedValue(world.incidentRules as never);
      jest
        .spyOn(AlertOnCallRuleEngineService, "readEnabledRules")
        .mockResolvedValue(world.alertRules as never);

      const monitor: (id: string, name: string) => Monitor = (
        id: string,
        name: string,
      ): Monitor => {
        const item: Monitor = withId(new Monitor(), id);
        item.name = name;
        item.monitorType = MonitorType.Website;
        item.projectId = PROJECT_ID;
        item.monitorSteps = world.monitorSteps;
        item.labels = [];
        return item;
      };

      const results: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [
            monitor(MONITOR_ID.toString(), "Checkout API"),
            monitor(ObjectID.generate().toString(), "Payments API"),
          ],
        });

      expect(results).toHaveLength(2);

      for (const each of results) {
        expect(benOf(each).channels).toEqual([OnCallPageChannel.Email]);
      }

      expect(fallbackCalls()).toHaveLength(1);
    });

    /*
     * THE CARD SAYS WHAT A PAGE SENDS: for the same person and project, the
     * channels Ben's line lists are the channels the real fallback
     * (executeFallbackNotification) hands a sender - its claim and the
     * membership check stood in for, each rule it would deliver recorded.
     */
    describe("what the card lists is what a page sends", () => {
      async function sentByTheFallback(): Promise<Array<OnCallPageChannel>> {
        const delivered: Array<UserNotificationRule> = [];

        jest
          .spyOn(UserOnCallLogService, "claimNotificationExecution")
          .mockResolvedValue(true as never);
        jest
          .spyOn(ProjectMembership, "isMember")
          .mockResolvedValue(true as never);
        jest
          .spyOn(
            UserNotificationRuleService as unknown as {
              deliverNotificationForRule: (
                rule: UserNotificationRule,
                options: ExecuteNotificationRuleOptions,
              ) => Promise<boolean>;
            },
            "deliverNotificationForRule",
          )
          .mockImplementation((async (sent: UserNotificationRule) => {
            delivered.push(sent);
            return true;
          }) as never);

        const options: ExecuteFallbackNotificationOptions = {
          userId: new ObjectID(BEN),
          projectId: PROJECT_ID,
          userOnCallLogId: ObjectID.generate(),
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          severityName: "Critical",
          userNotificationLogId: ObjectID.generate(),
          userNotificationEventType: UserNotificationEventType.IncidentCreated,
          onCallPolicyId: new ObjectID(PRIMARY),
        };

        await UserNotificationRuleService.executeFallbackNotification(options);

        return delivered.flatMap(
          (sent: UserNotificationRule): Array<OnCallPageChannel> => {
            return getPreviewMethodsOfRule({
              rule: sent,
              showAddresses: false,
            }).map((method: OnCallTestPagePreviewMethod): OnCallPageChannel => {
              return method.channel;
            });
          },
        );
      }

      const cases: Array<[string, FallbackMethods, Partial<Project>]> = [
        [
          "an email, a number and a phone",
          { email: true, sms: true, call: true },
          {},
        ],
        ["a number and a phone", { sms: true, call: true }, {}],
        [
          "a number and a phone, texts off",
          { sms: true, call: true },
          { enableSmsNotifications: false },
        ],
        [
          "WhatsApp and Telegram, WhatsApp off",
          { whatsApp: true, telegram: true },
          { enableWhatsAppNotifications: false },
        ],
        [
          "every free method and a phone",
          {
            push: true,
            email: true,
            slack: true,
            teams: true,
            mattermost: true,
            call: true,
          },
          {},
        ],
        ["an email and a webhook", { email: true, webhook: true }, {}],
        ["a webhook alone", { webhook: true }, {}],
        [
          "only methods on channels that are off",
          { sms: true, call: true },
          { enableSmsNotifications: false, enableCallNotifications: false },
        ],
        ["nothing at all", {}, {}],
      ];

      test.each(cases)(
        "%s: the card lists exactly the channels the fallback hands a sender",
        async (
          _name: string,
          methods: FallbackMethods,
          switches: Partial<Project>,
        ) => {
          benHas(methods);
          Object.assign(world.project, switches);

          const ben: WhoIsToldPerson = benOf(await resolve());
          const sent: Array<OnCallPageChannel> = await sentByTheFallback();

          expect(ben.isReachable ? ben.channels : []).toEqual(sent);
          expect(ben.isReachable).toBe(sent.length > 0);
        },
      );
    });
  });

  test("the channels of what the fallback picked, in its order, each once", () => {
    const picked: (fields: Partial<UserNotificationRule>) => FallbackRule = (
      fields: Partial<UserNotificationRule>,
    ): FallbackRule => {
      return {
        channelName: "",
        rule: Object.assign(new UserNotificationRule(), fields),
      };
    };

    expect(
      getFallbackRuleChannels([
        picked({ userPush: { isVerified: true } as never }),
        picked({ userEmail: { isVerified: true } as never }),
        picked({ userEmail: { isVerified: true } as never }),
        picked({ userWebhook: { name: "Pager" } as never }),
      ]),
    ).toEqual([
      OnCallPageChannel.Push,
      OnCallPageChannel.Email,
      OnCallPageChannel.Webhook,
    ]);
    expect(getFallbackRuleChannels([])).toEqual([]);
  });

  /*
   * #7369: a new project's first monitor, before any on-call policy, was
   * told to Set Up Paging in the incident on-call rules builder, whose
   * rules page policies it does not have. With no policy, the fix is the
   * on-call guided setup; with one, the rules.
   */
  describe("nobody paged, with no on-call policy yet (#7369)", () => {
    test("a project with no policy: the fix is the on-call guided setup", async () => {
      world.projectPolicies = [];
      world.incidentRules = [];

      const result: WhoIsToldResult = await resolve();

      expect(kinds(result)).toEqual([WhoIsToldBreakKind.NobodyPaged]);
      expect(result.breaks[0]).toMatchObject({
        fix: WhoIsToldFix.OnCallGuidedSetup,
        recordKind: OnCallTestPageRecordKind.Incident,
      });
      expect(result.breaks[0]!.message).toContain(
        "this project has no on-call policy yet",
      );
    });

    test("a project with a policy no rule runs for this monitor: the rules, as before", async () => {
      world.incidentRules = [];

      const result: WhoIsToldResult = await resolve();

      expect(result.breaks[0]).toMatchObject({
        kind: WhoIsToldBreakKind.NobodyPaged,
        fix: WhoIsToldFix.IncidentOnCallRules,
      });
    });

    test("one policy is enough, whatever it is called", async () => {
      world.projectPolicies = [[SECONDARY, ""]];
      world.incidentRules = [];

      expect((await resolve()).breaks[0]!.fix).toBe(
        WhoIsToldFix.IncidentOnCallRules,
      );
    });

    // An archived policy pages no one: a project with only those has none in service.
    test("only archived policies: the on-call guided setup, as with none", async () => {
      world.archivedPolicyIds = [PRIMARY, SECONDARY];
      world.incidentRules = [];

      expect((await resolve()).breaks[0]!.fix).toBe(
        WhoIsToldFix.OnCallGuidedSetup,
      );
    });

    test("one policy in service beside archived ones: the rules", async () => {
      world.archivedPolicyIds = [PRIMARY];
      world.incidentRules = [];

      expect((await resolve()).breaks[0]!.fix).toBe(
        WhoIsToldFix.IncidentOnCallRules,
      );
    });

    test("the project's policies are read once, and their names still kept for the chain", async () => {
      world.archivedPolicyIds = [SECONDARY];

      const result: WhoIsToldResult = await resolve();

      expect(
        jest
          .mocked(OnCallDutyPolicyService.findBy)
          .mock.calls.filter((call: Array<unknown>): boolean => {
            return Boolean(
              (call[0] as { props: DatabaseCommonInteractionProps }).props
                .isRoot,
            );
          }),
      ).toHaveLength(1);
      expect(firstEvent(result).policies[0]!.name).toBe("Primary");
    });

    test("the whole project at once says the same", async () => {
      world.projectPolicies = [];
      world.incidentRules = [];
      jest
        .spyOn(IncidentOnCallRuleEngineService, "readEnabledRules")
        .mockResolvedValue([] as never);
      jest
        .spyOn(AlertOnCallRuleEngineService, "readEnabledRules")
        .mockResolvedValue([] as never);

      const monitor: Monitor = withId(new Monitor(), MONITOR_ID.toString());
      monitor.name = "Checkout API";
      monitor.monitorType = MonitorType.Website;
      monitor.projectId = PROJECT_ID;
      monitor.monitorSteps = world.monitorSteps;
      monitor.labels = [];

      const [result]: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: [monitor],
        });

      expect(result!.breaks).toEqual([
        expect.objectContaining({
          kind: WhoIsToldBreakKind.NobodyPaged,
          fix: WhoIsToldFix.OnCallGuidedSetup,
        }),
      ]);
    });
  });

  test("an answer is kept a minute, and a refresh works it out again", async () => {
    const reads: SpyInstance<typeof MonitorService.findOneBy> =
      MonitorService.findOneBy as unknown as SpyInstance<
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

    const writes: Array<SpyInstance<(...args: Array<never>) => unknown>> = [
      jest.spyOn(MonitorService, "updateOneById"),
      jest.spyOn(OnCallDutyPolicyService, "create"),
      jest.spyOn(ProjectService, "updateOneById"),
      jest.spyOn(IncidentService, "addOwners"),
      jest.spyOn(IncidentService, "create"),
      jest.spyOn(AlertService, "addOwners"),
      jest.spyOn(AlertService, "create"),
      jest.spyOn(IncidentOwnerUserService, "create"),
      jest.spyOn(IncidentFeedService, "createIncidentFeedItem"),
    ] as unknown as Array<SpyInstance<(...args: Array<never>) => unknown>>;

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

    test("only what Setup health needs is read: owners as ids, unnamed, and no status page", async () => {
      stubRuleReads();
      jest.spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForDevices");

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
       * The owner rules are read once for the project (#9407, #9371); a
       * project whose monitors watch no device and name nobody reads no
       * device's owners and nobody's membership. No name, Project Owner or
       * status page is read for Setup health.
       */
      expect(IncidentOwnerRuleService.findBy).toHaveBeenCalledTimes(1);
      expect(AlertOwnerRuleService.findBy).toHaveBeenCalledTimes(1);
      expect(TeamMemberService.findBy).not.toHaveBeenCalled();
      expect(TeamMemberService.getProjectMemberUserIds).not.toHaveBeenCalled();
      expect(
        NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor,
      ).not.toHaveBeenCalled();
      expect(
        NetworkDeviceOwnerUserService.getDeviceOwnersForDevices,
      ).not.toHaveBeenCalled();
      expect(UserService.findBy).not.toHaveBeenCalled();
      expect(ProjectService.getOwners).not.toHaveBeenCalled();
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

    test("owners the criteria names are worked out for every monitor from one read of each kind, unnamed", async () => {
      stubRuleReads();
      world.monitorSteps = stepsOf([
        offlineCriteria({
          incidents: [
            {
              id: "incident-template",
              title: "Down",
              description: "",
              incidentSeverityId: new ObjectID(CRITICAL),
              ownerTeamIds: [new ObjectID(PLATFORM_TEAM)],
              ownerUserIds: [new ObjectID(CARA)],
            },
          ],
        }),
      ]);

      const monitors: Array<Monitor> = [];

      for (let index: number = 0; index < 20; index++) {
        monitors.push(
          projectMonitor(
            `68101111-0000-4000-8000-${(2000 + index)
              .toString()
              .padStart(12, "0")}`,
            `Monitor ${index}`,
          ),
        );
      }

      const results: Array<WhoIsToldResult> =
        await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: monitors,
        });

      for (const result of results) {
        expect(firstEvent(result).owners).toEqual({
          source: WhoIsToldOwnersSource.Named,
          userNames: [],
          teamNames: [],
        });
        expect(firstEvent(result).ownerIds).toEqual({
          userIds: [CARA],
          teamIds: [PLATFORM_TEAM],
        });
      }

      // Whether the team is the project's, has anybody in it, and who is a member: once each.
      expect(TeamService.findBy).toHaveBeenCalledTimes(1);
      expect(TeamMemberService.findBy).toHaveBeenCalledTimes(1);
      expect(TeamMemberService.getProjectMemberUserIds).toHaveBeenCalledTimes(
        1,
      );
      // Nobody's name is read: Setup health names nobody it reaches.
      expect(UserService.findBy).not.toHaveBeenCalled();
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

    /*
     * A PRIVATE RECORD, FOR THE WHOLE PROJECT AT ONCE (#9370): what makes it
     * private is read once, and its owners - who may read it - are worked
     * out as the card works them out, no other record's. So Setup health
     * tells each reader the breaks their own card tells them: none of a
     * private record that is not theirs to see. Primary has no escalation
     * rules here: a break of whatever pages it.
     */
    describe("a private record (#9370)", () => {
      const ME: string = CALLER.userId!.toString();

      function asAdmin(): DatabaseCommonInteractionProps {
        return {
          ...CALLER,
          userType: UserType.User,
          userTenantAccessPermission: {
            [PROJECT_ID.toString()]: {
              _type: "UserTenantAccessPermission",
              projectId: PROJECT_ID,
              permissions: [
                {
                  _type: "UserPermission",
                  permission: Permission.ProjectAdmin,
                  labelIds: [],
                  isBlockPermission: false,
                } as UserPermission,
              ],
            },
          } as never,
        };
      }

      async function projectChain(): Promise<WhoIsToldResult> {
        const [result]: Array<WhoIsToldResult> =
          await WhoIsToldService.resolveProject({
            projectId: PROJECT_ID,
            monitors: [projectMonitor(MONITOR_ID.toString(), "Checkout API")],
          });

        return result!;
      }

      // The breaks Setup health lists for this reader, from the project's chain.
      async function listedFor(
        props: DatabaseCommonInteractionProps,
      ): Promise<Array<WhoIsToldBreakKind>> {
        const chain: WhoIsToldResult = await projectChain();

        return getWhoIsToldBreaksForReader({
          result: chain,
          isHidden: await WhoIsToldService.readHiddenFromCaller({
            props: props,
            results: [chain],
          }),
        }).map((brk: WhoIsToldBreak): WhoIsToldBreakKind => {
          return brk.kind;
        });
      }

      // The breaks this reader's card says.
      async function onTheCardOf(
        props: DatabaseCommonInteractionProps,
      ): Promise<Array<WhoIsToldBreakKind>> {
        WhoIsToldService.clearCache();

        return kinds(
          await WhoIsToldService.getForMonitor({
            projectId: PROJECT_ID,
            monitorId: MONITOR_ID,
            props: props,
          }),
        );
      }

      beforeEach(() => {
        stubRuleReads();
        world.levels[PRIMARY] = { targets: [], notPaged: [], levelCount: 0 };
      });

      test("its owners are worked out, as the card works them out - and a public record's too (#9407)", async () => {
        world.projectMemberIds = [...world.projectMemberIds, ME];
        world.monitorSteps = opensIncidents(
          incidentTemplate({ isPrivate: true, ownerUserIds: ids([ME]) }),
        );

        const event: WhoIsToldEvent = firstEvent(await projectChain());

        expect(event.isPrivate).toBe(true);
        expect(event.ownerIds).toEqual({ userIds: [ME], teamIds: [] });

        world.monitorSteps = opensIncidents(
          incidentTemplate({ ownerUserIds: ids([ME]) }),
        );

        // An alert on-call rule may match on them, and Setup health lists who isn't emailed.
        expect(firstEvent(await projectChain()).ownerIds).toEqual({
          userIds: [ME],
          teamIds: [],
        });
      });

      test("a privacy rule makes it private for the whole project too: the rules are read once", async () => {
        const rule: IncidentPrivacyRule = withId(
          new IncidentPrivacyRule(),
          "68101111-0000-4000-8000-0000000000f7",
        );
        rule.name = "Checkout is private";
        rule.projectId = PROJECT_ID;
        rule.incidentTitlePattern = "Checkout";
        world.incidentPrivacyRules = [rule];

        const read: SpyInstance<typeof IncidentPrivacyRuleService.findBy> =
          jest.spyOn(IncidentPrivacyRuleService, "findBy");
        read.mockClear();

        const event: WhoIsToldEvent = firstEvent(await projectChain());

        expect(event.isPrivate).toBe(true);
        expect(event.privacyRules).toEqual([
          {
            id: "68101111-0000-4000-8000-0000000000f7",
            name: "Checkout is private",
          },
        ]);
        expect(read).toHaveBeenCalledTimes(1);
      });

      test("each reader's list says what their card says: nothing of a private record not theirs", async () => {
        world.monitorSteps = opensIncidents(
          incidentTemplate({ isPrivate: true }),
        );

        expect(await onTheCardOf(CALLER)).not.toContain(
          WhoIsToldBreakKind.PolicyHasNoLevels,
        );
        expect(await listedFor(CALLER)).toEqual(await onTheCardOf(CALLER));

        expect(await onTheCardOf(asAdmin())).toContain(
          WhoIsToldBreakKind.PolicyHasNoLevels,
        );
        expect(await listedFor(asAdmin())).toEqual(
          await onTheCardOf(asAdmin()),
        );
      });

      test("an owner an owner rule adds reads it, on the card and in the list: the owner rules are read for it", async () => {
        world.projectMemberIds = [...world.projectMemberIds, ME];
        world.monitorSteps = opensIncidents(
          incidentTemplate({ isPrivate: true }),
        );
        world.incidentOwnerRules = [
          incidentOwnerRule({
            id: OWNER_RULE,
            name: "Checkout monitors",
            userIds: [ME],
          }),
        ];

        expect(await onTheCardOf(CALLER)).toContain(
          WhoIsToldBreakKind.PolicyHasNoLevels,
        );
        expect(await listedFor(CALLER)).toEqual(await onTheCardOf(CALLER));
        expect(firstEvent(await projectChain()).ownerIds?.userIds).toContain(
          ME,
        );
      });

      test("a public record's breaks are every reader's, as on the card", async () => {
        expect(await listedFor(CALLER)).toContain(
          WhoIsToldBreakKind.PolicyHasNoLevels,
        );
        expect(await listedFor(CALLER)).toEqual(await onTheCardOf(CALLER));
        // The owner rules are read once for the project, private record or not.
        (IncidentOwnerRuleService.findBy as unknown as jest.Mock).mockClear();
        await projectChain();
        expect(IncidentOwnerRuleService.findBy).toHaveBeenCalledTimes(1);
      });
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

      expect(withoutRecipients(event.owners)).toEqual({
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

      expect(withoutRecipients(event.owners)).toEqual({
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

      expect(withoutRecipients(event.owners)).toEqual({
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

      expect(withoutRecipients(firstEvent(await resolve()).owners)).toEqual({
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

      expect(withoutRecipients(event.owners)).toEqual({
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
      expect(withoutRecipients(alert!.owners)).toEqual({
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
        IncidentOwnerRuleService.findBy as unknown as SpyInstance<
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

      // And names the group it shows the monitor through (#7214).
      expect(firstEvent(await resolve()).statusPages).toEqual([
        {
          id: GROUP_PAGE,
          name: "Payments status",
          groups: [{ id: MONITOR_GROUP, name: "Checkout" }],
        },
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

      /*
       * A page that lists the monitor itself names no group, though the
       * monitor is in one it lists too: the monitor is what people change.
       */
      expect(firstEvent(await resolve()).statusPages).toEqual([
        {
          id: GROUP_PAGE,
          name: "Payments status",
          groups: [{ id: MONITOR_GROUP, name: "Checkout" }],
        },
        { id: STATUS_PAGE, name: "Public status", groups: [] },
      ]);
    });

    test("a page that shows the monitor through two groups names both, each once (#7214)", async () => {
      world.statusPageLinks = [
        {
          resourceId: "68101111-0000-4000-8000-000000000524",
          statusPageId: GROUP_PAGE,
          monitorGroupId: MONITOR_GROUP,
        },
        {
          resourceId: "68101111-0000-4000-8000-000000000525",
          statusPageId: GROUP_PAGE,
          monitorGroupId: OTHER_MONITOR_GROUP,
        },
      ];
      world.monitorGroupIds = [MONITOR_GROUP, OTHER_MONITOR_GROUP];
      world.statusPages = [{ id: GROUP_PAGE, name: "Payments status" }];

      expect(firstEvent(await resolve()).statusPages).toEqual([
        {
          id: GROUP_PAGE,
          name: "Payments status",
          groups: [
            { id: MONITOR_GROUP, name: "Checkout" },
            { id: OTHER_MONITOR_GROUP, name: "Payments" },
          ],
        },
      ]);
      // How each page reaches the monitor is read with the pages, in one read.
      expect(
        (
          StatusPageResourceService.findAllBy as unknown as SpyInstance<
            (args: { select: Record<string, unknown> }) => Promise<unknown>
          >
        ).mock.calls.map(
          (call: [{ select: Record<string, unknown> }]): unknown => {
            return call[0].select;
          },
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            monitorId: true,
            monitorGroupId: true,
            monitorGroup: { _id: true, name: true },
          }),
        ]),
      );
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
        { id: STATUS_PAGE, name: "Public status", groups: [] },
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
      // A group the caller may read is named (#7214).
      world.callerMonitorGroups = [MONITOR_GROUP];
      expect(firstEvent(await forCaller()).statusPages).toEqual([
        {
          id: GROUP_PAGE,
          name: "Payments status",
          groups: [{ id: MONITOR_GROUP, name: "Checkout" }],
        },
        { id: STATUS_PAGE, name: "Public status", groups: [] },
      ]);
    });

    test("a monitor group the caller may not read keeps its place without its name (#7214)", async () => {
      withOwnerRuleAndPages();
      world.callerMonitorGroups = "refused";

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).statusPages).toEqual([
        {
          id: GROUP_PAGE,
          name: "Payments status",
          groups: [{ id: MONITOR_GROUP, name: "" }],
        },
        { id: STATUS_PAGE, name: "Public status", groups: [] },
      ]);
      expect(JSON.stringify(result)).not.toContain('Checkout"');
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
      /*
       * Ben, whom the rule adds, is on Primary's first level, reached at
       * once by what the fallback picks: the page tells him, and the
       * Created email leaves him out (#8860).
       */
      expect(firstEvent(result).owners).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: [],
        teamNames: [],
        pagedOwners: [{ userId: BEN, name: "Ben Ito" }],
      });
    });

    test("a status page the caller may not read is not named, and only that one", async () => {
      withOwnerRuleAndPages();
      world.callerStatusPages = [STATUS_PAGE];

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).statusPages).toEqual([
        { id: GROUP_PAGE, name: "", groups: [{ id: MONITOR_GROUP, name: "" }] },
        { id: STATUS_PAGE, name: "Public status", groups: [] },
      ]);
      expect(JSON.stringify(result)).not.toContain("Payments status");
    });

    test("a caller who may read no status page is told how many an incident shows on, and none by name", async () => {
      withOwnerRuleAndPages();
      world.callerStatusPages = "refused";

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).statusPages).toEqual([
        { id: GROUP_PAGE, name: "", groups: [{ id: MONITOR_GROUP, name: "" }] },
        { id: STATUS_PAGE, name: "", groups: [] },
      ]);
    });

    test("what the caller may read is asked as they would ask it, and only of what the answer holds", async () => {
      withOwnerRuleAndPages();

      await forCaller();

      const ownerRuleReads: Array<
        Array<{ query: unknown; props: DatabaseCommonInteractionProps }>
      > = (
        IncidentOwnerRuleService.findBy as unknown as SpyInstance<
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
        StatusPageService.findBy as unknown as SpyInstance<
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

  /*
   * AN OWNER THE PAGE REACHES FIRST IS NOT EMAILED AS AN OWNER TOO (#8860).
   *
   * The owners' Created email leaves out an owner the record's on-call page
   * reached already (OwnersReachedByAPage, #7987): one a policy's first
   * level pages at once, by a notification that goes out then. The resolver
   * keeps who the email is addressed to, person by person, and whether each
   * policy pages at once and each person's first notifications; each reader
   * is handed whom the email still tells, and whom the page tells first.
   *
   * Primary's first level pages Ana - a text at once, an email after five
   * minutes - and Ben, whose fallback push goes out at once.
   */
  describe("an owner the page reaches first (#8860)", () => {
    const LONDON: string = "Europe/London";

    async function forCaller(): Promise<WhoIsToldResult> {
      return await WhoIsToldService.getForMonitor({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        props: CALLER,
      });
    }

    function ownedBy(data: {
      userIds?: Array<string>;
      teamIds?: Array<string>;
      onCallPolicyIds?: Array<string>;
    }): void {
      world.monitorSteps = opensIncidents(
        incidentTemplate({
          ownerUserIds: ids(data.userIds || []),
          ownerTeamIds: ids(data.teamIds || []),
          ...(data.onCallPolicyIds
            ? { onCallPolicyIds: ids(data.onCallPolicyIds) }
            : {}),
        }),
      );
    }

    // A daily window, set on a winter day.
    function daily(from: string, to: string): RestrictionTimes {
      const hours: RestrictionTimes = new RestrictionTimes();
      hours.restictionType = RestrictionType.Daily;
      hours.dayRestrictionTimes = {
        startTime: moment
          .tz(`2026-01-15 ${from}`, "YYYY-MM-DD HH:mm", LONDON)
          .toDate(),
        endTime: moment
          .tz(`2026-01-15 ${to}`, "YYYY-MM-DD HH:mm", LONDON)
          .toDate(),
      };
      return hours;
    }

    // Primary's rule, set to page when it says - at night in London.
    function ruleThatPages(whenToPage: OnCallRuleWhenToPage): void {
      const held: IncidentOnCallRule = rule(RULE, "Every incident", [PRIMARY]);
      held.whenToPage = whenToPage;
      held.workingHours = daily("09:00", "17:00");
      held.workingHoursTimezone = Timezone.EuropeLondon;
      world.incidentRules = [held];

      jest
        .spyOn(OneUptimeDate, "getCurrentDate")
        .mockReturnValue(
          moment.tz("2026-11-16 02:00", "YYYY-MM-DD HH:mm", LONDON).toDate(),
        );
    }

    test("an owner the first level pages at once is left out of the Created email, and named as paged", async () => {
      ownedBy({ userIds: [ANA, CARA] });

      const owners: WhoIsToldEvent["owners"] = firstEvent(
        await forCaller(),
      ).owners;

      expect(owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Cara Diaz"],
        teamNames: [],
        pagedOwners: [{ userId: ANA, name: "Ana Lopez" }],
      });
    });

    test("the resolver keeps whom the email is addressed to, by id, and how the policy and its people page", async () => {
      ownedBy({ userIds: [ANA, CARA], teamIds: [SRE_TEAM] });

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.owners.recipients).toEqual([
        { userId: ANA, name: "Ana Lopez", isNamed: true, teamNames: [] },
        {
          userId: CARA,
          name: "Cara Diaz",
          isNamed: true,
          teamNames: ["Checkout SRE"],
        },
      ]);
      expect(event.policies[0]!.pagesAtOnce).toBe(true);
      expect(
        event.policies[0]!.people.map(
          (person: WhoIsToldPerson): [string, unknown] => {
            return [person.name, person.channelsAtOnce];
          },
        ),
      ).toEqual([
        ["Ana Lopez", [OnCallPageChannel.SMS]],
        ["Ben Ito", [OnCallPageChannel.Push]],
      ]);
    });

    test("the one-person project: its Project Owner, on call, is paged - and the email reaches nobody", async () => {
      jest
        .spyOn(ProjectService, "getOwners")
        .mockResolvedValue([
          withId(user("Ana Lopez", "ana@example.com"), ANA),
        ] as never);

      expect(firstEvent(await forCaller()).owners).toEqual({
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: [],
        teamNames: [],
        pagedOwners: [{ userId: ANA, name: "Ana Lopez" }],
      });
    });

    test("a rule that pages only during working hours, outside them, holds the page: she is still emailed", async () => {
      ownedBy({ userIds: [ANA, CARA] });
      ruleThatPages(OnCallRuleWhenToPage.WorkingHours);

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).policies[0]!.pagesAtOnce).toBe(false);
      expect(firstEvent(result).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Ana Lopez", "Cara Diaz"],
        teamNames: [],
      });
    });

    test("a rule set to After OneUptime AI may hold the page: she is still emailed", async () => {
      ownedBy({ userIds: [ANA] });
      ruleThatPages(OnCallRuleWhenToPage.AfterOneUptimeAI);

      const owners: WhoIsToldEvent["owners"] = firstEvent(
        await forCaller(),
      ).owners;

      expect(owners.userNames).toEqual(["Ana Lopez"]);
      expect(owners.pagedOwners).toBeUndefined();
    });

    test("a policy the criteria names pages at once, whatever a rule holds", async () => {
      ownedBy({ userIds: [ANA], onCallPolicyIds: [PRIMARY] });
      ruleThatPages(OnCallRuleWhenToPage.WorkingHours);

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).policies[0]!.pagesAtOnce).toBe(true);
      expect(firstEvent(result).owners.pagedOwners).toEqual([
        { userId: ANA, name: "Ana Lopez" },
      ]);
    });

    test.each<[string, Partial<OnCallTestPagePreviewPerson>]>([
      [
        "she opted out of pages of this severity",
        { hasNoRule: true, isOptedOut: true, methods: [] },
      ],
      [
        "her one rule's method is not verified",
        {
          methods: [
            {
              channel: OnCallPageChannel.SMS,
              notifyAfterMinutes: 0,
              isVerified: false,
              canAcknowledge: true,
            },
          ],
        },
      ],
      [
        "her first rule waits five minutes",
        {
          methods: [
            {
              channel: OnCallPageChannel.SMS,
              notifyAfterMinutes: 5,
              isVerified: true,
              canAcknowledge: true,
            },
          ],
        },
      ],
    ])(
      "%s: she is still emailed as an owner",
      async (
        _name: string,
        overrides: Partial<OnCallTestPagePreviewPerson>,
      ) => {
        ownedBy({ userIds: [ANA] });
        world.previews[ANA] = preview(overrides);

        const owners: WhoIsToldEvent["owners"] = firstEvent(
          await forCaller(),
        ).owners;

        expect(owners.userNames).toEqual(["Ana Lopez"]);
        expect(owners.pagedOwners).toBeUndefined();
      },
    );

    test("with no rule and the project's fallback off, nothing is sent: she is still emailed", async () => {
      ownedBy({ userIds: [ANA] });
      world.previews[ANA] = preview({ hasNoRule: true, methods: [] });
      world.project.disableOnCallNotificationFallback = true;

      expect(firstEvent(await forCaller()).owners.userNames).toEqual([
        "Ana Lopez",
      ]);
    });

    test("her first notification is a text, and the project has texts off: she is still emailed", async () => {
      ownedBy({ userIds: [ANA] });
      world.project.enableSmsNotifications = false;

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).policies[0]!.people[0]!.channelsAtOnce).toEqual(
        [],
      );
      expect(firstEvent(result).owners.pagedOwners).toBeUndefined();
    });

    test("an owner on a later level only - not on the first - is still emailed", async () => {
      ownedBy({ userIds: [DAN] });

      expect(firstEvent(await forCaller()).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Dan Okafor"],
        teamNames: [],
      });
    });

    test("owners through a team: each member the page reaches first is left out, and the team stays while the email reaches one of them", async () => {
      ownedBy({ teamIds: [PLATFORM_TEAM, SRE_TEAM] });

      expect(firstEvent(await forCaller()).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: [],
        // Ana and Ben, Platform's members, are paged; Cara is not.
        teamNames: ["Checkout SRE"],
        pagedOwners: [
          { userId: ANA, name: "Ana Lopez" },
          { userId: BEN, name: "Ben Ito" },
        ],
      });
    });

    test("a policy the caller may not read says nothing of whom it pages: she reads as emailed, as before", async () => {
      ownedBy({ userIds: [ANA, CARA] });
      world.callerPolicies = "refused";

      const result: WhoIsToldResult = await forCaller();

      expect(firstEvent(result).owners).toEqual({
        source: WhoIsToldOwnersSource.Named,
        userNames: ["Ana Lopez", "Cara Diaz"],
        teamNames: [],
      });
      expect(firstEvent(result).policies[0]!.pagesAtOnce).toBeUndefined();
    });

    test("whom the email is addressed to never leaves the server, whatever the caller reads", async () => {
      ownedBy({ userIds: [ANA, CARA], teamIds: [SRE_TEAM] });

      expect(JSON.stringify(await forCaller())).not.toContain("recipients");

      world.callerPolicies = "refused";

      expect(JSON.stringify(await forCaller())).not.toContain("recipients");
    });

    test("a status change's owners are told of it all the same: never left out", async () => {
      jest
        .spyOn(MonitorService, "findOwners")
        .mockResolvedValue([
          withId(user("Ana Lopez", "ana@example.com"), ANA),
        ] as never);

      const result: WhoIsToldResult = await forCaller();

      expect(result.criteria[1]!.statusOwners).toEqual({
        source: WhoIsToldOwnersSource.MonitorOwners,
        userNames: ["Ana Lopez"],
        teamNames: [],
      });
    });
  });

  /*
   * A POLICY WHOSE FIRST ESCALATION RULE IS NOT AT PLACE 1 (#9369): rules
   * written through the API or by Terraform keep the place they are given.
   * A run starts at the lowest place, and so does the card: it names who
   * that rule reaches, never "has no escalation rules".
   */
  describe("a policy whose only escalation rule is at place 2", () => {
    const RULE_AT_TWO: string = "68101111-0000-4000-8000-0000000000e9";

    beforeEach(() => {
      // Read as the test page reads a level, not stood in for.
      jest.spyOn(OnCallTestPageService, "readFirstLevel").mockRestore();

      jest
        .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
        .mockImplementation((async (args: {
          query: { onCallDutyPolicyId?: ObjectID };
        }) => {
          return args.query.onCallDutyPolicyId?.toString() === PRIMARY
            ? [
                {
                  id: new ObjectID(RULE_AT_TWO),
                  order: 2,
                  escalateAfterInMinutes: 30,
                },
              ]
            : [];
        }) as never);
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
        .mockResolvedValue([] as never);
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
        .mockResolvedValue([] as never);
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
        .mockImplementation((async (args: {
          query: { onCallDutyPolicyEscalationRuleId?: ObjectID };
        }) => {
          return args.query.onCallDutyPolicyEscalationRuleId?.toString() ===
            RULE_AT_TWO
            ? [{ userId: new ObjectID(ANA) }]
            : [];
        }) as never);
      jest
        .spyOn(OnCallDutyPolicyEscalationRuleService, "getAwayOverride")
        .mockResolvedValue(null as never);
      jest
        .spyOn(ProjectMembership, "getMemberUserIds")
        .mockResolvedValue(new Set<string>([ANA]) as never);
      jest
        .spyOn(ProjectMembership, "isMember")
        .mockResolvedValue(true as never);
      jest.spyOn(UserService, "findOneById").mockImplementation((async (args: {
        id: ObjectID;
      }) => {
        return withId(
          user(PEOPLE[args.id.toString()] || "", "ana@example.com"),
          args.id.toString(),
        );
      }) as never);
    });

    test("the card names who that rule reaches, and no break says the policy has none", async () => {
      const result: WhoIsToldResult = await resolve();
      const policy: WhoIsToldPolicy = firstEvent(result).policies[0]!;

      expect(policy.levelCount).toBe(1);
      expect(
        policy.people.map((person: WhoIsToldPerson): string => {
          return person.name;
        }),
      ).toEqual(["Ana Lopez"]);
      expect(kinds(result)).not.toContain(WhoIsToldBreakKind.PolicyHasNoLevels);
      expect(kinds(result)).not.toContain(
        WhoIsToldBreakKind.PolicyReachesNobody,
      );
    });
  });

  /*
   * A MONITOR NOT SAVED YET (#7055): Create Monitor's criteria, and a saved
   * monitor's criteria being edited, are worked out by the same resolver -
   * the same rules, the same engines - on the monitor held in memory.
   */
  describe("a monitor not saved yet (#7055)", () => {
    // Dan, a Project Member: he may create monitors.
    function creator(): DatabaseCommonInteractionProps {
      return {
        tenantId: PROJECT_ID,
        userId: new ObjectID(DAN),
        userType: UserType.User,
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: PROJECT_ID,
            permissions: [
              {
                _type: "UserPermission",
                permission: Permission.ProjectMember,
                labelIds: [],
                isBlockPermission: false,
              } as UserPermission,
            ],
          },
        } as never,
      };
    }

    function draftOf(overrides: Partial<WhoIsToldDraft> = {}): WhoIsToldDraft {
      return {
        name: "Payments API",
        description: "",
        monitorType: MonitorType.Website,
        monitorSteps: opensIncidents(
          incidentTemplate({ title: "{{monitorName}} is down" }),
        ),
        labelIds: [],
        ...overrides,
      };
    }

    async function forDraft(
      data: {
        props?: DatabaseCommonInteractionProps;
        draft?: WhoIsToldDraft;
      } = {},
    ): Promise<WhoIsToldResult> {
      return await WhoIsToldService.getForDraft({
        projectId: PROJECT_ID,
        props: data.props || creator(),
        draft: data.draft || draftOf(),
      });
    }

    /*
     * The monitor's own create check, asked without creating it
     * (checkCallerMayCreate): stood in for, as it reads the project's plan,
     * labels and grants - refusing, as the create would, whoever holds no
     * role at all in the project (CALLER), and passing a server admin.
     */
    let mayCreate: SpyInstance<typeof MonitorService.checkCallerMayCreate>;

    beforeEach(() => {
      mayCreate = jest
        .spyOn(MonitorService, "checkCallerMayCreate")
        .mockImplementation((async (args: {
          props: DatabaseCommonInteractionProps;
        }) => {
          if (
            !args.props.isRoot &&
            !args.props.isMasterAdmin &&
            !args.props.userTenantAccessPermission
          ) {
            throw new NotAuthorizedException(
              "You do not have permission to create Monitor.",
            );
          }
        }) as never);
    });

    test("a new monitor is worked out from the form, and names no saved monitor", async () => {
      const result: WhoIsToldResult = await forDraft();

      expect(result.monitorId).toBe("");
      expect(result.monitorName).toBe("Payments API");
      expect(firstEvent(result).title).toBe("Payments API is down");
      expect(firstEvent(result).policies[0]!.name).toBe("Primary");
      expect(firstEvent(result).rules).toEqual([
        { id: RULE, name: "Every incident" },
      ]);
      // Nothing saved was read for it.
      expect(MonitorService.findOneBy).not.toHaveBeenCalled();
    });

    test("a new monitor is on no status page yet", async () => {
      const result: WhoIsToldResult = await forDraft();

      expect(firstEvent(result).statusPages).toEqual([]);
      expect(StatusPageResourceService.findAllBy).not.toHaveBeenCalled();
    });

    test("whoever creates it owns it, so its status changes email them", async () => {
      const result: WhoIsToldResult = await forDraft();

      expect(result.criteria[0]!.statusOwners).toEqual({
        source: WhoIsToldOwnersSource.MonitorOwners,
        userNames: ["Dan Okafor"],
        teamNames: [],
      });
      expect(MonitorService.findOwners).not.toHaveBeenCalled();
    });

    test("an owner rule that inherits the monitor's owners adds its creator, as it will once they own it", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Monitor owners",
          inheritOwnersFromMonitors: true,
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(await forDraft());

      expect(withoutRecipients(event.owners)).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Dan Okafor"],
        teamNames: [],
      });
      expect(event.ownerRules).toEqual([
        { id: OWNER_RULE, name: "Monitor owners" },
      ]);
    });

    test("an alert's owner rule that inherits the monitor's owners adds its creator too", async () => {
      world.alertOwnerRules = [
        alertOwnerRule({
          id: ALERT_OWNER_RULE,
          name: "Alert monitor owners",
          inheritOwnersFromMonitors: true,
        }),
      ];

      const event: WhoIsToldEvent = firstEvent(
        await forDraft({
          draft: draftOf({ monitorSteps: opensAlerts(alertTemplate()) }),
        }),
      );

      expect(event.kind).toBe(OnCallTestPageRecordKind.Alert);
      expect(withoutRecipients(event.owners)).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Dan Okafor"],
        teamNames: [],
      });
    });

    test("an API key or a server admin owns nothing it creates: the project's owners are emailed", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Monitor owners",
          inheritOwnersFromMonitors: true,
        }),
      ];

      const apiKey: DatabaseCommonInteractionProps = {
        ...creator(),
        userId: undefined,
        userType: UserType.API,
      };
      const serverAdmin: DatabaseCommonInteractionProps = {
        ...creator(),
        userType: UserType.MasterAdmin,
        isMasterAdmin: true,
      };

      for (const props of [apiKey, serverAdmin]) {
        const result: WhoIsToldResult = await forDraft({ props: props });

        expect(result.criteria[0]!.statusOwners).toEqual({
          source: WhoIsToldOwnersSource.ProjectOwners,
          userNames: ["Owner One"],
          teamNames: [],
        });
        expect(withoutRecipients(firstEvent(result).owners)).toMatchObject({
          source: WhoIsToldOwnersSource.ProjectOwners,
        });
        expect(firstEvent(result).ownerRules).toEqual([]);
      }
    });

    test("a rule's monitor name and monitor label filters are matched against the form", async () => {
      world.incidentOwnerRules = [
        incidentOwnerRule({
          id: OWNER_RULE,
          name: "Payments monitors",
          userIds: [BEN],
          monitorNamePattern: "Payments",
        }),
        incidentOwnerRule({
          id: OTHER_OWNER_RULE,
          name: "Labelled monitors",
          userIds: [CARA],
          monitorLabelIds: [MONITOR_LABEL],
        }),
      ];

      // The saved monitor is "Checkout API", with no labels: the draft's own are read.
      let event: WhoIsToldEvent = firstEvent(await forDraft());

      expect(event.ownerRules).toEqual([
        { id: OWNER_RULE, name: "Payments monitors" },
      ]);

      event = firstEvent(
        await forDraft({
          draft: draftOf({
            name: "Checkout API",
            labelIds: [new ObjectID(MONITOR_LABEL)],
          }),
        }),
      );

      expect(event.ownerRules).toEqual([
        { id: OTHER_OWNER_RULE, name: "Labelled monitors" },
      ]);
      expect(withoutRecipients(event.owners)).toEqual({
        source: WhoIsToldOwnersSource.OwnerRules,
        userNames: ["Cara Diaz"],
        teamNames: [],
      });
    });

    test("seeing who a new monitor tells takes what creating it takes: its create's own check, of the monitor the form holds", async () => {
      await expect(forDraft({ props: CALLER })).rejects.toThrow(
        "You do not have permission to create Monitor.",
      );
      await expect(forDraft({ props: CALLER })).rejects.toBeInstanceOf(
        NotAuthorizedException,
      );

      await forDraft({
        draft: draftOf({ labelIds: [new ObjectID(MONITOR_LABEL)] }),
      });

      const asked: {
        data: Monitor;
        props: DatabaseCommonInteractionProps;
      } = mayCreate.mock.calls[mayCreate.mock.calls.length - 1]![0] as {
        data: Monitor;
        props: DatabaseCommonInteractionProps;
      };

      expect(asked.props.userId?.toString()).toBe(DAN);
      expect(asked.data.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(asked.data.name).toBe("Payments API");
      expect(asked.data.monitorType).toBe(MonitorType.Website);
      // With its labels: a grant limited to labels is weighed for these.
      expect(
        (asked.data.labels || []).map((label: Label): string => {
          return label._id || "";
        }),
      ).toEqual([MONITOR_LABEL]);
      // A copy of its own, with no id: the check stamps what it is handed.
      expect(asked.data._id).toBeUndefined();
    });

    test("a saved monitor's criteria being edited asks no create", async () => {
      await forDraft({
        props: CALLER,
        draft: draftOf({ monitorId: MONITOR_ID }),
      });

      expect(mayCreate).not.toHaveBeenCalled();
    });

    test("a saved monitor's criteria being edited: the steps being edited, with its own name and status pages", async () => {
      const result: WhoIsToldResult = await forDraft({
        props: CALLER,
        draft: draftOf({
          monitorId: MONITOR_ID,
          name: "Not this name",
          monitorSteps: opensIncidents(
            incidentTemplate({ title: "{{monitorName}} has stopped" }),
          ),
        }),
      });

      expect(result.monitorId).toBe(MONITOR_ID.toString());
      expect(result.monitorName).toBe("Checkout API");
      expect(firstEvent(result).title).toBe("Checkout API has stopped");
      expect(firstEvent(result).statusPages).toEqual([
        { id: STATUS_PAGE, name: "Public status", groups: [] },
      ]);
      // A saved monitor's owners are read, not its editor.
      expect(result.criteria[0]!.statusOwners).toEqual({
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: ["Owner One"],
        teamNames: [],
      });
    });

    test("somebody who may not read the saved monitor is told it is not found", async () => {
      world.callerReadsMonitor = false;

      await expect(
        forDraft({
          props: CALLER,
          draft: draftOf({ monitorId: MONITOR_ID }),
        }),
      ).rejects.toThrow("Monitor not found.");
    });

    test("a new monitor's creator owns it as DatabaseService makes them its owner", () => {
      // autoOwnerOnCreate makes an operational resource's creator its owner.
      expect(
        (new Monitor() as unknown as { isOperationalResource?: boolean })
          .isOperationalResource,
      ).toBe(true);
      expect(OwnedScopePermission.hasOwnerTables(Monitor)).toBe(true);

      // A person, and nobody else.
      expect(OwnedScopePermission.isCreatorMadeOwner(creator())).toBe(true);
      expect(
        OwnedScopePermission.isCreatorMadeOwner({ ...creator(), isRoot: true }),
      ).toBe(false);
      expect(
        OwnedScopePermission.isCreatorMadeOwner({
          ...creator(),
          isMasterAdmin: true,
        }),
      ).toBe(false);
      expect(
        OwnedScopePermission.isCreatorMadeOwner({
          ...creator(),
          userId: undefined,
          userType: UserType.API,
        }),
      ).toBe(false);
    });
  });
  /*
   * THE RULES A NEW RECORD'S CREATE RUNS, IN ITS ORDER (#7212, #7213,
   * #7216): privacy, owners, labels, on-call - and, for an alert, its
   * alert incident rules last. Each by the engine's own read-only plan.
   */
  describe("the rules a new record's create runs", () => {
    const CHECKOUT_LABEL: string = "68101111-0000-4000-8000-000000000043";
    const OTHER_LABEL: string = "68101111-0000-4000-8000-000000000044";
    const LABEL_RULE: string = "68101111-0000-4000-8000-000000000065";
    const OTHER_LABEL_RULE: string = "68101111-0000-4000-8000-000000000066";
    const PRIVACY_RULE: string = "68101111-0000-4000-8000-000000000067";
    const INCIDENT_RULE: string = "68101111-0000-4000-8000-000000000068";
    const BROAD_INCIDENT_RULE: string = "68101111-0000-4000-8000-000000000069";

    function labelRule(facts: {
      id: string;
      name: string;
      titlePattern?: string;
      incidentLabelIds?: Array<string>;
      labelIds?: Array<string>;
      inheritsFromMonitors?: boolean;
    }): IncidentLabelRule {
      const item: IncidentLabelRule = withId(new IncidentLabelRule(), facts.id);
      item.name = facts.name;
      item.projectId = PROJECT_ID;

      if (facts.titlePattern) {
        item.incidentTitlePattern = facts.titlePattern;
      }

      item.incidentLabels = (facts.incidentLabelIds || []).map(
        (id: string): Label => {
          return withId(new Label(), id);
        },
      );
      item.labelsToAdd = (facts.labelIds || []).map((id: string): Label => {
        return withId(new Label(), id);
      });
      item.inheritLabelsFromMonitors = facts.inheritsFromMonitors === true;
      return item;
    }

    function alertLabelRule(facts: {
      id: string;
      name: string;
      titlePattern?: string;
      labelIds: Array<string>;
    }): AlertLabelRule {
      const item: AlertLabelRule = withId(new AlertLabelRule(), facts.id);
      item.name = facts.name;
      item.projectId = PROJECT_ID;

      if (facts.titlePattern) {
        item.alertTitlePattern = facts.titlePattern;
      }

      item.labelsToAdd = facts.labelIds.map((id: string): Label => {
        return withId(new Label(), id);
      });
      return item;
    }

    function privacyRule(facts: {
      id: string;
      name: string;
      titlePattern: string;
    }): IncidentPrivacyRule {
      const item: IncidentPrivacyRule = withId(
        new IncidentPrivacyRule(),
        facts.id,
      );
      item.name = facts.name;
      item.projectId = PROJECT_ID;
      item.incidentTitlePattern = facts.titlePattern;
      return item;
    }

    function alertIncidentRule(facts: {
      id: string;
      name: string;
      titlePattern?: string;
      waitInMinutes?: number;
      showsOnStatusPages?: boolean;
    }): AlertIncidentRule {
      const item: AlertIncidentRule = withId(new AlertIncidentRule(), facts.id);
      item.name = facts.name;
      item.projectId = PROJECT_ID;
      item.incidentSeverityId = new ObjectID(CRITICAL);
      item.declareAfterInMinutes = facts.waitInMinutes || 0;

      if (facts.titlePattern) {
        item.alertTitlePattern = facts.titlePattern;
      }

      if (facts.showsOnStatusPages === false) {
        item.showIncidentOnStatusPage = false;
      }

      return item;
    }

    // The incident on-call rules match an incident with this label only.
    function rulesPageOnlyFor(labelId: string): void {
      jest
        .spyOn(IncidentOnCallRuleEngineService, "getMatchingRules")
        .mockImplementation((async (incident: Incident) => {
          onCallTitles.push(incident.title || "");

          return (incident.labels || []).some((label: Label): boolean => {
            return (label._id || label.id?.toString()) === labelId;
          })
            ? world.incidentRules
            : [];
        }) as never);
    }

    beforeEach(() => {
      // Every label the rules name is the project's.
      jest
        .spyOn(ProjectScopedReferenceValidator, "keepIdsInProject")
        .mockImplementation((async (data: { ids: Array<string> }) => {
          return data.ids;
        }) as never);
    });

    describe("label rules run before on-call rules (#7212)", () => {
      test("a label rule's label makes an on-call rule match: the card pages, and names the label rule", async () => {
        rulesPageOnlyFor(CHECKOUT_LABEL);
        world.incidentLabelRules = [
          labelRule({
            id: LABEL_RULE,
            name: "Checkout labels",
            titlePattern: "Checkout",
            labelIds: [CHECKOUT_LABEL],
          }),
        ];

        const result: WhoIsToldResult = await resolve();
        const event: WhoIsToldEvent = firstEvent(result);

        expect(event.rules).toEqual([{ id: RULE, name: "Every incident" }]);
        expect(
          event.policies.map((policy: WhoIsToldPolicy): string => {
            return policy.id;
          }),
        ).toEqual([PRIMARY]);
        expect(event.labelRules).toEqual([
          { id: LABEL_RULE, name: "Checkout labels" },
        ]);
        expect(kinds(result)).not.toContain(WhoIsToldBreakKind.NobodyPaged);
      });

      test("without the label rule, nobody is paged, as for a real incident", async () => {
        rulesPageOnlyFor(CHECKOUT_LABEL);

        const result: WhoIsToldResult = await resolve();

        expect(firstEvent(result).rules).toEqual([]);
        expect(firstEvent(result).labelRules).toBeUndefined();
        expect(kinds(result)).toContain(WhoIsToldBreakKind.NobodyPaged);
      });

      test("a label rule whose label changes nothing that pages is not named", async () => {
        world.incidentLabelRules = [
          labelRule({
            id: LABEL_RULE,
            name: "Checkout labels",
            labelIds: [OTHER_LABEL],
          }),
        ];

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.rules).toEqual([{ id: RULE, name: "Every incident" }]);
        expect(event.labelRules).toBeUndefined();
      });

      test("a label rule that matches only the template as written adds nothing", async () => {
        rulesPageOnlyFor(CHECKOUT_LABEL);
        world.monitorSteps = opensIncidents(
          incidentTemplate({ title: "{{monitorName}} is down" }),
        );
        world.incidentLabelRules = [
          labelRule({
            id: LABEL_RULE,
            name: "Template",
            titlePattern: "\\{\\{monitorName\\}\\}",
            labelIds: [CHECKOUT_LABEL],
          }),
        ];

        expect(firstEvent(await resolve()).rules).toEqual([]);
      });

      test("the labels a rule inherits from the monitor count too", async () => {
        rulesPageOnlyFor(MONITOR_LABEL);
        world.monitorLabelIds = [MONITOR_LABEL];
        world.incidentLabelRules = [
          labelRule({
            id: LABEL_RULE,
            name: "Monitor's labels",
            inheritsFromMonitors: true,
          }),
        ];

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.rules).toEqual([{ id: RULE, name: "Every incident" }]);
        expect(event.labelRules).toEqual([
          { id: LABEL_RULE, name: "Monitor's labels" },
        ]);
      });

      test("every label rule is matched on the incident as it opens: one rule's label never makes another match", async () => {
        rulesPageOnlyFor(OTHER_LABEL);
        world.incidentLabelRules = [
          labelRule({
            id: LABEL_RULE,
            name: "First",
            labelIds: [CHECKOUT_LABEL],
          }),
          labelRule({
            id: OTHER_LABEL_RULE,
            name: "Second",
            incidentLabelIds: [CHECKOUT_LABEL],
            labelIds: [OTHER_LABEL],
          }),
        ];

        expect(firstEvent(await resolve()).rules).toEqual([]);
      });

      test("a label of another project is never added", async () => {
        rulesPageOnlyFor(CHECKOUT_LABEL);
        jest
          .spyOn(ProjectScopedReferenceValidator, "keepIdsInProject")
          .mockResolvedValue([] as never);
        world.incidentLabelRules = [
          labelRule({
            id: LABEL_RULE,
            name: "Checkout labels",
            labelIds: [CHECKOUT_LABEL],
          }),
        ];

        expect(firstEvent(await resolve()).rules).toEqual([]);
      });

      test("an alert's label rules run before its on-call rules too", async () => {
        world.monitorSteps = opensAlerts(alertTemplate());
        world.alertRules = [rule(RULE, "Every alert", [PRIMARY])];
        world.alertRuleCount = 1;
        world.alertLabelRules = [
          alertLabelRule({
            id: LABEL_RULE,
            name: "Checkout labels",
            titlePattern: "Checkout",
            labelIds: [CHECKOUT_LABEL],
          }),
        ];
        jest
          .spyOn(AlertOnCallRuleEngineService, "getMatchingRules")
          .mockImplementation((async (alert: Alert) => {
            return (alert.labels || []).some((label: Label): boolean => {
              return (label._id || label.id?.toString()) === CHECKOUT_LABEL;
            })
              ? world.alertRules
              : [];
          }) as never);

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.kind).toBe(OnCallTestPageRecordKind.Alert);
        expect(event.rules).toEqual([{ id: RULE, name: "Every alert" }]);
        expect(event.labelRules).toEqual([
          { id: LABEL_RULE, name: "Checkout labels" },
        ]);
      });

      test("a label rule the caller may not read keeps its place without its name", async () => {
        rulesPageOnlyFor(CHECKOUT_LABEL);
        world.incidentLabelRules = [
          labelRule({
            id: LABEL_RULE,
            name: "Checkout labels",
            labelIds: [CHECKOUT_LABEL],
          }),
        ];
        world.callerLabelRules = "refused";

        const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          props: CALLER,
        });

        expect(firstEvent(result).labelRules).toEqual([
          { id: LABEL_RULE, name: "" },
        ]);
        expect(JSON.stringify(result)).not.toContain("Checkout labels");
      });
    });

    describe("privacy rules (#7213)", () => {
      test("a privacy rule that matches the title the incident gets makes it private: it shows on no status page, and the rule is named", async () => {
        world.incidentPrivacyRules = [
          privacyRule({
            id: PRIVACY_RULE,
            name: "Checkout is private",
            titlePattern: "Checkout",
          }),
        ];

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.isPrivate).toBe(true);
        expect(event.privacyRules).toEqual([
          { id: PRIVACY_RULE, name: "Checkout is private" },
        ]);
        expect(event.statusPages).toEqual([]);
        expect(event.isPrivateOffStatusPages).toBe(true);
        // A private incident still pages, and still emails its owners.
        expect(event.policies).toHaveLength(1);
        expect(event.owners.source).toBe(WhoIsToldOwnersSource.ProjectOwners);
      });

      test("a privacy rule that does not match leaves the incident public, on its pages", async () => {
        world.incidentPrivacyRules = [
          privacyRule({
            id: PRIVACY_RULE,
            name: "Billing is private",
            titlePattern: "^Billing",
          }),
        ];

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.isPrivate).toBeUndefined();
        expect(event.statusPages).toHaveLength(1);
      });

      test("a rule that matches only the template as written does not count", async () => {
        world.monitorSteps = opensIncidents(
          incidentTemplate({ title: "{{monitorName}} is down" }),
        );
        world.incidentPrivacyRules = [
          privacyRule({
            id: PRIVACY_RULE,
            name: "Template",
            titlePattern: "\\{\\{monitorName\\}\\}",
          }),
        ];

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.title).toBe("Checkout API is down");
        expect(event.isPrivate).toBeUndefined();
        expect(event.statusPages).toHaveLength(1);
      });

      test("a criteria that makes the incident private asks no privacy rule, as its create asks none", async () => {
        world.monitorSteps = opensIncidents(
          incidentTemplate({ isPrivate: true }),
        );
        world.incidentPrivacyRules = [
          privacyRule({
            id: PRIVACY_RULE,
            name: "Checkout is private",
            titlePattern: "Checkout",
          }),
        ];
        const plan: SpyInstance<
          typeof IncidentPrivacyRuleEngineService.planRules
        > = jest.spyOn(IncidentPrivacyRuleEngineService, "planRules");

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.isPrivate).toBe(true);
        expect(event.privacyRules).toEqual([]);
        expect(event.statusPages).toEqual([]);
        expect(plan).not.toHaveBeenCalled();
      });

      test("an alert privacy rule makes the alert private", async () => {
        world.monitorSteps = opensAlerts(alertTemplate());
        world.alertPrivacyRules = [
          withId(new AlertPrivacyRule(), PRIVACY_RULE),
        ];
        world.alertPrivacyRules[0]!.name = "Every alert is private";
        world.alertPrivacyRules[0]!.projectId = PROJECT_ID;

        const event: WhoIsToldEvent = firstEvent(await resolve());

        expect(event.isPrivate).toBe(true);
        expect(event.privacyRules).toEqual([
          { id: PRIVACY_RULE, name: "Every alert is private" },
        ]);
      });
    });

    /*
     * WHAT A READER IS TOLD OF A PRIVATE RECORD (#7213): only what they
     * could read once it exists, by the private-record rule.
     */
    describe("a private record, as one reader may see it", () => {
      const ME: string = CALLER.userId!.toString();

      function asAdmin(): DatabaseCommonInteractionProps {
        return {
          ...CALLER,
          userType: UserType.User,
          userTenantAccessPermission: {
            [PROJECT_ID.toString()]: {
              _type: "UserTenantAccessPermission",
              projectId: PROJECT_ID,
              permissions: [
                {
                  _type: "UserPermission",
                  permission: Permission.ProjectAdmin,
                  labelIds: [],
                  isBlockPermission: false,
                } as UserPermission,
              ],
            },
          } as never,
        };
      }

      async function as(
        props: DatabaseCommonInteractionProps,
      ): Promise<WhoIsToldResult> {
        return await WhoIsToldService.getForMonitor({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          props: props,
        });
      }

      beforeEach(() => {
        world.monitorSteps = opensIncidents(
          incidentTemplate({ isPrivate: true }),
        );
      });

      test("a reader who is none of its owners is told it opens, private, and nothing of whom it tells", async () => {
        world.incidentRules = [];
        world.incidentRuleCount = 0;

        const result: WhoIsToldResult = await as(CALLER);
        const event: WhoIsToldEvent = firstEvent(result);

        expect(event).toEqual({
          kind: OnCallTestPageRecordKind.Incident,
          title: "",
          severityName: "Critical",
          owners: {
            source: WhoIsToldOwnersSource.Named,
            userNames: [],
            teamNames: [],
          },
          ownerRules: [],
          rules: [],
          policies: [],
          statusPages: [],
          isPrivate: true,
          privacyRules: [],
          isHidden: true,
        });
        // What it would page, or not, is no break of theirs.
        expect(kinds(result)).not.toContain(WhoIsToldBreakKind.NobodyPaged);
        /*
         * Nothing of the incident: not its title, nor who it would page. The
         * status change is no part of it: its own owners are still said.
         */
        const json: string = JSON.stringify(result);
        expect(json).not.toContain("Checkout API is down");
        expect(json).not.toContain("Ana Lopez");
        expect(json).not.toContain("ownerIds");
        expect(json).not.toContain("facts");
        expect(result.criteria[0]!.statusOwners?.userNames).toEqual([
          "Owner One",
        ]);
      });

      test("its own policies and people stay out of a reader's answer, breaks and all", async () => {
        world.levels[PRIMARY] = {
          targets: [],
          notPaged: [],
          levelCount: 0,
        };

        const result: WhoIsToldResult = await as(CALLER);

        expect(firstEvent(result).policies).toEqual([]);
        expect(kinds(result)).not.toContain(
          WhoIsToldBreakKind.PolicyHasNoLevels,
        );
        expect(JSON.stringify(result)).not.toContain("Primary");
        // The resolver itself still sees the break: it is a reader's that goes.
        expect(kinds(await resolve())).toContain(
          WhoIsToldBreakKind.PolicyHasNoLevels,
        );
      });

      test("one of its owners reads it whole", async () => {
        world.projectMemberIds = [...world.projectMemberIds, ME];
        world.monitorSteps = opensIncidents(
          incidentTemplate({ isPrivate: true, ownerUserIds: ids([ME]) }),
        );

        const event: WhoIsToldEvent = firstEvent(await as(CALLER));

        expect(event.isHidden).toBeUndefined();
        expect(event.isPrivate).toBe(true);
        expect(event.title).toBe("Checkout API is down");
        expect(event.policies).toHaveLength(1);
        expect(JSON.stringify(event)).not.toContain("ownerIds");
      });

      test("an accepted member of a team of its owners reads it; one in another team does not", async () => {
        world.monitorSteps = opensIncidents(
          incidentTemplate({
            isPrivate: true,
            ownerTeamIds: ids([PLATFORM_TEAM]),
          }),
        );

        world.callerAcceptedTeamIds = [SRE_TEAM];
        expect(firstEvent(await as(CALLER)).isHidden).toBe(true);

        // An invitation to the owner team not accepted yet reads nothing either.
        world.callerPendingTeamIds = [PLATFORM_TEAM];
        WhoIsToldService.clearCache();
        expect(firstEvent(await as(CALLER)).isHidden).toBe(true);

        world.callerAcceptedTeamIds = [PLATFORM_TEAM];
        WhoIsToldService.clearCache();
        expect(firstEvent(await as(CALLER)).isHidden).toBeUndefined();
      });

      test("a Project Admin reads it whole", async () => {
        const event: WhoIsToldEvent = firstEvent(await as(asAdmin()));

        expect(event.isHidden).toBeUndefined();
        expect(event.policies).toHaveLength(1);
      });

      test("a public incident is everyone's to read, whoever owns it", async () => {
        world.monitorSteps = opensIncidents(incidentTemplate());

        expect(firstEvent(await as(CALLER)).isHidden).toBeUndefined();
      });

      test("a privacy rule the reader may not read keeps its place without its name", async () => {
        world.monitorSteps = opensIncidents(incidentTemplate());
        world.incidentPrivacyRules = [
          privacyRule({
            id: PRIVACY_RULE,
            name: "Checkout is private",
            titlePattern: "Checkout",
          }),
        ];
        world.callerPrivacyRules = "refused";

        const result: WhoIsToldResult = await as(CALLER);

        expect(firstEvent(result).isHidden).toBe(true);
        expect(firstEvent(result).privacyRules).toEqual([
          { id: PRIVACY_RULE, name: "" },
        ]);
        expect(JSON.stringify(result)).not.toContain("Checkout is private");

        world.callerPrivacyRules = [PRIVACY_RULE];
        WhoIsToldService.clearCache();

        expect(firstEvent(await as(CALLER)).privacyRules).toEqual([
          { id: PRIVACY_RULE, name: "Checkout is private" },
        ]);
      });
    });

    describe("alert incident rules (#7216)", () => {
      beforeEach(() => {
        world.monitorSteps = opensAlerts(alertTemplate());
        world.alertRules = [];
        world.alertRuleCount = 0;
      });

      function declared(result: WhoIsToldResult): WhoIsToldEvent {
        const declaration: WhoIsToldEvent["declares"] =
          firstEvent(result).declares;

        expect(declaration).toBeDefined();

        return declaration!.incident;
      }

      test("an alert a rule turns into an incident right away: the card follows the incident, and the alert's nobody-paged break goes", async () => {
        world.alertIncidentRules = [
          alertIncidentRule({ id: INCIDENT_RULE, name: "Database alerts" }),
        ];

        const result: WhoIsToldResult = await resolve();
        const alert: WhoIsToldEvent = firstEvent(result);

        expect(alert.kind).toBe(OnCallTestPageRecordKind.Alert);
        expect(alert.policies).toEqual([]);
        expect(alert.declares).toMatchObject({
          rule: { id: INCIDENT_RULE, name: "Database alerts" },
          waitInMinutes: 0,
        });

        const incident: WhoIsToldEvent = declared(result);

        expect(incident.kind).toBe(OnCallTestPageRecordKind.Incident);
        expect(incident.title).toBe("Checkout API is down");
        expect(incident.severityName).toBe("Critical");
        expect(incident.rules).toEqual([{ id: RULE, name: "Every incident" }]);
        expect(incident.policies).toHaveLength(1);
        // The incident shows on the monitor's status pages, as a new incident does.
        expect(incident.statusPages).toHaveLength(1);
        // Declaring copies no on-call policy of the alert's, and no owner but a private alert's.
        expect(incident.owners.source).toBe(
          WhoIsToldOwnersSource.ProjectOwners,
        );
        expect(kinds(result)).not.toContain(
          WhoIsToldBreakKind.OnlyIncidentsHaveRules,
        );
        expect(kinds(result)).not.toContain(WhoIsToldBreakKind.NobodyPaged);
      });

      test("a rule that waits says how long the alert must stay open", async () => {
        world.alertIncidentRules = [
          alertIncidentRule({
            id: INCIDENT_RULE,
            name: "Still open",
            waitInMinutes: 30,
          }),
        ];

        expect(firstEvent(await resolve()).declares?.waitInMinutes).toBe(30);
      });

      test("the first rule that matches decides", async () => {
        world.alertIncidentRules = [
          alertIncidentRule({
            id: INCIDENT_RULE,
            name: "Billing alerts",
            titlePattern: "^Billing",
          }),
          alertIncidentRule({
            id: BROAD_INCIDENT_RULE,
            name: "Every alert",
            waitInMinutes: 15,
          }),
        ];

        expect(firstEvent(await resolve()).declares).toMatchObject({
          rule: { id: BROAD_INCIDENT_RULE, name: "Every alert" },
          waitInMinutes: 15,
        });
      });

      test("no rule matches: the alert stays an alert, and only incidents having rules is still its break", async () => {
        world.alertIncidentRules = [
          alertIncidentRule({
            id: INCIDENT_RULE,
            name: "Billing alerts",
            titlePattern: "^Billing",
          }),
        ];

        const result: WhoIsToldResult = await resolve();

        expect(firstEvent(result).declares).toBeUndefined();
        expect(kinds(result)).toContain(
          WhoIsToldBreakKind.OnlyIncidentsHaveRules,
        );
      });

      test("an incident that pages nobody leaves the alert's break as it was", async () => {
        world.alertIncidentRules = [
          alertIncidentRule({ id: INCIDENT_RULE, name: "Database alerts" }),
        ];
        world.incidentRules = [];

        const result: WhoIsToldResult = await resolve();

        expect(declared(result).policies).toEqual([]);
        expect(kinds(result)).toEqual([
          WhoIsToldBreakKind.OnlyIncidentsHaveRules,
        ]);
      });

      test("a rule that keeps the incident off status pages: it shows on none", async () => {
        world.alertIncidentRules = [
          alertIncidentRule({
            id: INCIDENT_RULE,
            name: "Quiet",
            showsOnStatusPages: false,
          }),
        ];

        expect(declared(await resolve()).statusPages).toEqual([]);
      });

      test("a private alert's incident is private, and takes the alert's owners as its own", async () => {
        world.monitorSteps = opensAlerts(
          alertTemplate({ isPrivate: true, ownerUserIds: ids([ANA]) }),
        );
        world.alertIncidentRules = [
          alertIncidentRule({ id: INCIDENT_RULE, name: "Database alerts" }),
        ];

        const incident: WhoIsToldEvent = declared(await resolve());

        expect(incident.isPrivate).toBe(true);
        expect(incident.statusPages).toEqual([]);
        expect(withoutRecipients(incident.owners)).toEqual({
          source: WhoIsToldOwnersSource.Named,
          userNames: ["Ana Lopez"],
          teamNames: [],
        });
        // The alert's owners are said on the alert: not again on its incident.
        expect(incident.owners.notReached).toBeUndefined();
      });

      test("an alert incident rule the caller may not read keeps its place without its name", async () => {
        world.alertIncidentRules = [
          alertIncidentRule({ id: INCIDENT_RULE, name: "Database alerts" }),
        ];
        world.callerAlertIncidentRules = "refused";

        const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          props: CALLER,
        });

        expect(firstEvent(result).declares?.rule).toEqual({
          id: INCIDENT_RULE,
          name: "",
        });
        expect(JSON.stringify(result)).not.toContain("Database alerts");
      });

      test("a project with no alert incident rule reads none, and declares nothing", async () => {
        const plan: SpyInstance<
          typeof AlertIncidentRuleEngineService.planDeclaration
        > = jest.spyOn(AlertIncidentRuleEngineService, "planDeclaration");

        expect(firstEvent(await resolve()).declares).toBeUndefined();
        expect(plan).not.toHaveBeenCalled();
      });
    });

    describe("owners no Created email reaches (#7572)", () => {
      test("each is kept with why and what named it: a person who left, a team with nobody in it, another project's team, a device's owner, a rule's", async () => {
        world.projectMemberIds = [ANA, BEN];
        world.monitorSteps = opensIncidents(
          incidentTemplate({
            ownerUserIds: ids([ANA, CARA]),
            ownerTeamIds: ids([SRE_TEAM, ELSEWHERE_TEAM]),
          }),
        );
        world.deviceOwners = {
          ownerUserIds: ids([DAN]),
          ownerTeamIds: [],
        };
        world.incidentOwnerRules = [
          incidentOwnerRule({
            id: OWNER_RULE,
            name: "Checkout monitors",
            userIds: [CARA],
          }),
        ];

        const owners: WhoIsToldEvent["owners"] = firstEvent(
          await resolve(),
        ).owners;

        expect(owners.userNames).toEqual(["Ana Lopez"]);
        expect(owners.notReached).toEqual([
          {
            kind: WhoIsToldOwnerKind.User,
            id: CARA,
            name: "",
            problem: WhoIsToldOwnerProblem.NotInProject,
            addedBy: WhoIsToldOwnerAddedBy.Criteria,
          },
          {
            kind: WhoIsToldOwnerKind.Team,
            id: SRE_TEAM,
            name: "Checkout SRE",
            problem: WhoIsToldOwnerProblem.TeamHasNobodyInProject,
            addedBy: WhoIsToldOwnerAddedBy.Criteria,
          },
          {
            kind: WhoIsToldOwnerKind.Team,
            id: ELSEWHERE_TEAM,
            // Another project's team is never named.
            name: "",
            problem: WhoIsToldOwnerProblem.TeamOfAnotherProject,
            addedBy: WhoIsToldOwnerAddedBy.Criteria,
          },
          {
            kind: WhoIsToldOwnerKind.User,
            id: DAN,
            name: "",
            problem: WhoIsToldOwnerProblem.NotInProject,
            addedBy: WhoIsToldOwnerAddedBy.NetworkDevice,
          },
          {
            kind: WhoIsToldOwnerKind.User,
            id: CARA,
            name: "",
            problem: WhoIsToldOwnerProblem.NotInProject,
            addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
            rule: { id: OWNER_RULE, name: "Checkout monitors" },
          },
        ]);
        // A person who is not a member is never named, anywhere.
        expect(JSON.stringify(owners)).not.toContain("Cara Diaz");
        expect(JSON.stringify(owners)).not.toContain("Dan Okafor");
      });

      test("everyone it names reached: nothing is said", async () => {
        world.monitorSteps = opensIncidents(
          incidentTemplate({ ownerUserIds: ids([ANA]) }),
        );

        expect(firstEvent(await resolve()).owners.notReached).toBeUndefined();
      });

      test("nobody it names reached: the Project Owners are emailed, and who was left out is still said", async () => {
        world.projectMemberIds = [ANA];
        world.monitorSteps = opensIncidents(
          incidentTemplate({ ownerUserIds: ids([CARA]) }),
        );

        const owners: WhoIsToldEvent["owners"] = firstEvent(
          await resolve(),
        ).owners;

        expect(owners.source).toBe(WhoIsToldOwnersSource.ProjectOwners);
        expect(owners.notReached).toEqual([
          {
            kind: WhoIsToldOwnerKind.User,
            id: CARA,
            name: "",
            problem: WhoIsToldOwnerProblem.NotInProject,
            addedBy: WhoIsToldOwnerAddedBy.Criteria,
          },
        ]);
      });

      test("an owner rule the caller may not read keeps its place without its name", async () => {
        world.projectMemberIds = [ANA];
        world.incidentOwnerRules = [
          incidentOwnerRule({
            id: OWNER_RULE,
            name: "Checkout monitors",
            userIds: [CARA],
          }),
        ];
        world.callerIncidentOwnerRules = "refused";

        const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          props: CALLER,
        });

        expect(firstEvent(result).owners.notReached).toEqual([
          {
            kind: WhoIsToldOwnerKind.User,
            id: CARA,
            name: "",
            problem: WhoIsToldOwnerProblem.NotInProject,
            addedBy: WhoIsToldOwnerAddedBy.OwnerRule,
            rule: { id: OWNER_RULE, name: "" },
          },
        ]);
        expect(JSON.stringify(result)).not.toContain("Checkout monitors");
      });
    });
  });

  /*
   * AN ALERT ON-CALL RULE THAT MATCHES WHO OWNS THE ALERT (#9407).
   *
   * The engine's own matching (getMatchingRules) is run here, on the rules
   * the project's rows hold: "Alert Owner is any of Payments" and "is none
   * of Payments". The alert the criteria would open is held in memory, with
   * no owner rows; its real create gives it the owners its criteria names,
   * the network device's owners and whom its owner rules add before its
   * on-call rules run, so the card matches on those. Every test here failed
   * before #9407: the alert was matched as if nobody owned it.
   */
  describe("an Alert Owner rule matches who owns the alert (#9407)", () => {
    const PAYMENTS_RULE: string = "68101111-0000-4000-8000-0000000000c7";

    function ownerCondition(data: {
      operator: RuleCriteriaOperator;
      ownerIds: Array<string>;
      name?: string;
    }): AlertOnCallRule {
      const item: AlertOnCallRule = withId(
        new AlertOnCallRule(),
        PAYMENTS_RULE,
      );
      item.name =
        data.name ||
        (data.operator === RuleCriteriaOperator.HasNoneOf
          ? "Not Payments' alerts"
          : "Payments' alerts");
      item.projectId = PROJECT_ID;
      item.criteria = {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          {
            field: "alertOwners",
            operator: data.operator,
            value: data.ownerIds,
          },
        ],
      };
      item.onCallDutyPolicies = [withId(new OnCallDutyPolicy(), PRIMARY)];
      return item;
    }

    /*
     * The engine matches for real, on these rules: what the project's rows
     * hold, and what a caller may read of them.
     */
    function rulesAre(
      rules: Array<AlertOnCallRule>,
      callerReads: Array<string> = [PAYMENTS_RULE],
    ): void {
      if (jest.isMockFunction(AlertOnCallRuleEngineService.getMatchingRules)) {
        jest
          .mocked(AlertOnCallRuleEngineService.getMatchingRules)
          .mockRestore();
      }

      world.alertRuleCount = rules.length;
      world.incidentRuleCount = 0;
      world.incidentRules = [];

      jest
        .spyOn(AlertOnCallRuleService, "findBy")
        .mockImplementation((async (args: {
          query: unknown;
          props: DatabaseCommonInteractionProps;
        }) => {
          if (args.props.isRoot) {
            return rules;
          }

          return readable(
            args.query,
            callerReads,
            (): AlertOnCallRule => {
              return new AlertOnCallRule();
            },
            "alert on-call rules",
          );
        }) as never);
    }

    function opensAlertOwnedBy(
      owners: { userIds?: Array<string>; teamIds?: Array<string> },
      overrides: Record<string, unknown> = {},
    ): MonitorSteps {
      return opensAlerts(
        alertTemplate({
          ownerUserIds: ids(owners.userIds || []),
          ownerTeamIds: ids(owners.teamIds || []),
          ...overrides,
        }),
      );
    }

    function pagesPrimary(event: WhoIsToldEvent): boolean {
      return event.policies.some((policy: WhoIsToldPolicy): boolean => {
        return policy.id === PRIMARY;
      });
    }

    beforeEach(() => {
      world.teamMemberIds[PAYMENTS_TEAM] = [DAN];
    });

    test('a monitor whose criteria names Payments as the owner: "Alert Owner is any of Payments" pages Payments\' policy', async () => {
      world.monitorSteps = opensAlertOwnedBy({ teamIds: [PAYMENTS_TEAM] });
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      const result: WhoIsToldResult = await resolve();
      const event: WhoIsToldEvent = firstEvent(result);

      expect(event.rules).toEqual([
        { id: PAYMENTS_RULE, name: "Payments' alerts" },
      ]);
      expect(pagesPrimary(event)).toBe(true);
      expect(kinds(result)).not.toContain(WhoIsToldBreakKind.NobodyPaged);
      // Which owner made it match, as a label rule's label is said (#7212).
      expect(event.ownerMatches).toEqual([
        { ruleId: PAYMENTS_RULE, ownerNames: ["Payments"] },
      ]);
    });

    test('"Alert Owner is none of Payments" is said not to match, and nobody is paged', async () => {
      world.monitorSteps = opensAlertOwnedBy({ teamIds: [PAYMENTS_TEAM] });
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasNoneOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      const result: WhoIsToldResult = await resolve();
      const event: WhoIsToldEvent = firstEvent(result);

      expect(event.rules).toEqual([]);
      expect(event.policies).toEqual([]);
      expect(event.ownerMatches).toBeUndefined();
      expect(kinds(result)).toContain(WhoIsToldBreakKind.NobodyPaged);
    });

    test("an owner an alert owner rule adds makes the rule match, and is none of not", async () => {
      world.monitorSteps = opensAlertOwnedBy({});
      world.alertOwnerRules = [
        alertOwnerRule({
          id: ALERT_OWNER_RULE,
          name: "Payments routes",
          teamIds: [PAYMENTS_TEAM],
        }),
      ];
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      const anyOf: WhoIsToldEvent = firstEvent(await resolve());

      expect(
        anyOf.rules.map((rule: { id: string }) => {
          return rule.id;
        }),
      ).toEqual([PAYMENTS_RULE]);
      expect(anyOf.ownerRules).toEqual([
        { id: ALERT_OWNER_RULE, name: "Payments routes" },
      ]);
      expect(anyOf.ownerMatches).toEqual([
        { ruleId: PAYMENTS_RULE, ownerNames: ["Payments"] },
      ]);

      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasNoneOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      expect(firstEvent(await resolve()).rules).toEqual([]);
    });

    test("the network device's owners make the rule match, and is none of not", async () => {
      world.monitorSteps = opensAlertOwnedBy({});
      world.deviceOwners = {
        ownerUserIds: [],
        ownerTeamIds: ids([PAYMENTS_TEAM]),
      };
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      expect(pagesPrimary(firstEvent(await resolve()))).toBe(true);

      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasNoneOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      expect(pagesPrimary(firstEvent(await resolve()))).toBe(false);
    });

    test("a person the criteria names owns the alert, by name", async () => {
      world.monitorSteps = opensAlertOwnedBy({ userIds: [ANA] });
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [BEN, ANA],
        }),
      ]);

      expect(firstEvent(await resolve()).ownerMatches).toEqual([
        { ruleId: PAYMENTS_RULE, ownerNames: ["Ana Lopez"] },
      ]);
    });

    test("somebody named who isn't a member of the project owns nothing: is any of doesn't match, is none of does", async () => {
      world.projectMemberIds = [ANA, BEN];
      world.monitorSteps = opensAlertOwnedBy({ userIds: [CARA] });
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [CARA],
        }),
      ]);

      expect(firstEvent(await resolve()).rules).toEqual([]);

      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasNoneOf,
          ownerIds: [CARA],
        }),
      ]);

      expect(pagesPrimary(firstEvent(await resolve()))).toBe(true);
    });

    test("a team of another project owns nothing: no owner row is written for it", async () => {
      world.monitorSteps = opensAlertOwnedBy({ teamIds: [ELSEWHERE_TEAM] });
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [ELSEWHERE_TEAM],
        }),
      ]);

      expect(firstEvent(await resolve()).rules).toEqual([]);
    });

    test("a team of the project with nobody in it still owns the alert, though nobody is emailed through it", async () => {
      world.teamMemberIds[PAYMENTS_TEAM] = [];
      world.monitorSteps = opensAlertOwnedBy({ teamIds: [PAYMENTS_TEAM] });
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(pagesPrimary(event)).toBe(true);
      expect(event.ownerMatches).toEqual([
        { ruleId: PAYMENTS_RULE, ownerNames: ["Payments"] },
      ]);
      expect(event.owners.notReached).toEqual([
        {
          kind: WhoIsToldOwnerKind.Team,
          id: PAYMENTS_TEAM,
          name: "Payments",
          problem: WhoIsToldOwnerProblem.TeamHasNobodyInProject,
          addedBy: WhoIsToldOwnerAddedBy.Criteria,
        },
      ]);
    });

    test("an incident's on-call rules have no owner condition: nothing changes for them", async () => {
      world.monitorSteps = opensIncidents(
        incidentTemplate({ ownerTeamIds: ids([PAYMENTS_TEAM]) }),
      );

      const event: WhoIsToldEvent = firstEvent(await resolve());

      expect(event.kind).toBe(OnCallTestPageRecordKind.Incident);
      expect(event.ownerMatches).toBeUndefined();
    });

    test("a rule the reader may not read keeps its place without its name; which owner made it match is still said", async () => {
      world.monitorSteps = opensAlertOwnedBy({ teamIds: [PAYMENTS_TEAM] });
      rulesAre(
        [
          ownerCondition({
            operator: RuleCriteriaOperator.HasAnyOf,
            ownerIds: [PAYMENTS_TEAM],
          }),
        ],
        [],
      );

      const event: WhoIsToldEvent = firstEvent(
        await WhoIsToldService.getForMonitor({
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          props: CALLER,
        }),
      );

      expect(event.rules).toEqual([{ id: PAYMENTS_RULE, name: "" }]);
      expect(event.ownerMatches).toEqual([
        { ruleId: PAYMENTS_RULE, ownerNames: ["Payments"] },
      ]);
    });

    test("a private alert the reader can't see says nothing of its owners, nor which made a rule match", async () => {
      world.monitorSteps = opensAlertOwnedBy(
        { teamIds: [PAYMENTS_TEAM] },
        { isPrivate: true },
      );
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        props: CALLER,
      });
      const event: WhoIsToldEvent = firstEvent(result);

      expect(event.isHidden).toBe(true);
      expect(event.ownerMatches).toBeUndefined();
      expect(event.rules).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("Payments");
      expect(JSON.stringify(result)).not.toContain(PAYMENTS_TEAM);
    });

    test("a monitor being created is matched on the owners its form names", async () => {
      jest
        .spyOn(MonitorService, "checkCallerMayCreate")
        .mockResolvedValue(undefined as never);
      rulesAre([
        ownerCondition({
          operator: RuleCriteriaOperator.HasAnyOf,
          ownerIds: [PAYMENTS_TEAM],
        }),
      ]);

      const result: WhoIsToldResult = await WhoIsToldService.getForDraft({
        projectId: PROJECT_ID,
        props: { ...CALLER, isRoot: true },
        draft: {
          name: "Payments API",
          description: "",
          monitorType: MonitorType.Website,
          monitorSteps: opensAlertOwnedBy({ teamIds: [PAYMENTS_TEAM] }),
          labelIds: [],
        },
      });

      expect(pagesPrimary(firstEvent(result))).toBe(true);
    });

    /*
     * SETUP HEALTH (resolveProject) works the owners out for every monitor
     * from one read of each kind, and lists the breaks the cards do.
     */
    describe("for the whole project at once", () => {
      function projectMonitor(
        id: string,
        steps: MonitorSteps,
        name: string = "Checkout API",
      ): Monitor {
        const monitor: Monitor = withId(new Monitor(), id);
        monitor.name = name;
        monitor.monitorType = MonitorType.Website;
        monitor.projectId = PROJECT_ID;
        monitor.monitorSteps = steps;
        monitor.labels = [];
        return monitor;
      }

      function monitorIdOf(index: number): string {
        return `68101111-0000-4000-8000-${(3000 + index)
          .toString()
          .padStart(12, "0")}`;
      }

      async function resolveAll(
        monitors: Array<Monitor>,
        rules: Array<AlertOnCallRule>,
      ): Promise<Array<WhoIsToldResult>> {
        rulesAre(rules);
        jest
          .spyOn(AlertOnCallRuleEngineService, "readEnabledRules")
          .mockResolvedValue(rules as never);
        jest
          .spyOn(IncidentOnCallRuleEngineService, "readEnabledRules")
          .mockResolvedValue([] as never);

        return await WhoIsToldService.resolveProject({
          projectId: PROJECT_ID,
          monitors: monitors,
        });
      }

      test("owner-condition breaks are the cards': Payments' alerts page, the others page nobody", async () => {
        const results: Array<WhoIsToldResult> = await resolveAll(
          [
            projectMonitor(
              monitorIdOf(0),
              opensAlertOwnedBy({ teamIds: [PAYMENTS_TEAM] }),
            ),
            projectMonitor(monitorIdOf(1), opensAlertOwnedBy({})),
          ],
          [
            ownerCondition({
              operator: RuleCriteriaOperator.HasAnyOf,
              ownerIds: [PAYMENTS_TEAM],
            }),
          ],
        );

        expect(kinds(results[0]!)).not.toContain(
          WhoIsToldBreakKind.NobodyPaged,
        );
        expect(kinds(results[1]!)).toContain(WhoIsToldBreakKind.NobodyPaged);
        // Setup health names nobody it reaches.
        expect(firstEvent(results[0]!).ownerMatches).toBeUndefined();
      });

      test("is none of Payments: Payments' alerts page nobody, the others do", async () => {
        const results: Array<WhoIsToldResult> = await resolveAll(
          [
            projectMonitor(
              monitorIdOf(0),
              opensAlertOwnedBy({ teamIds: [PAYMENTS_TEAM] }),
            ),
            projectMonitor(monitorIdOf(1), opensAlertOwnedBy({})),
          ],
          [
            ownerCondition({
              operator: RuleCriteriaOperator.HasNoneOf,
              ownerIds: [PAYMENTS_TEAM],
            }),
          ],
        );

        expect(kinds(results[0]!)).toContain(WhoIsToldBreakKind.NobodyPaged);
        expect(kinds(results[1]!)).not.toContain(
          WhoIsToldBreakKind.NobodyPaged,
        );
      });

      test("whoever forty monitors name is read once for all of them, and no monitor reads its own", async () => {
        const monitors: Array<Monitor> = [];

        for (let index: number = 0; index < 40; index++) {
          monitors.push(
            projectMonitor(
              monitorIdOf(index),
              opensAlertOwnedBy({
                teamIds: [index % 2 === 0 ? PAYMENTS_TEAM : PLATFORM_TEAM],
                userIds: [ANA],
              }),
            ),
          );
        }

        world.alertOwnerRules = [
          alertOwnerRule({
            id: ALERT_OWNER_RULE,
            name: "Payments routes",
            userIds: [BEN],
          }),
        ];

        await resolveAll(monitors, [
          ownerCondition({
            operator: RuleCriteriaOperator.HasAnyOf,
            ownerIds: [PAYMENTS_TEAM],
          }),
        ]);

        expect(TeamService.findBy).toHaveBeenCalledTimes(1);
        expect(TeamMemberService.findBy).toHaveBeenCalledTimes(1);
        expect(TeamMemberService.getProjectMemberUserIds).toHaveBeenCalledTimes(
          1,
        );
        expect(AlertOwnerRuleService.findBy).toHaveBeenCalledTimes(1);
        expect(
          NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor,
        ).not.toHaveBeenCalled();
        expect(UserService.findBy).not.toHaveBeenCalled();
      });
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
