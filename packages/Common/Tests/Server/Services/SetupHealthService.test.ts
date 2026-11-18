import AlertEpisodeOnCallRule from "../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AlertLabelRule from "../../../Models/DatabaseModels/AlertLabelRule";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertPrivacyRule from "../../../Models/DatabaseModels/AlertPrivacyRule";
import IncidentLabelRule from "../../../Models/DatabaseModels/IncidentLabelRule";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentPrivacyRule from "../../../Models/DatabaseModels/IncidentPrivacyRule";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import UserService from "../../../Server/Services/UserService";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import AlertIncidentRuleEngineService from "../../../Server/Services/AlertIncidentRuleEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentEpisodeOnCallRule from "../../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../Models/DatabaseModels/Project";
import RecommendationDismissal from "../../../Models/DatabaseModels/RecommendationDismissal";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import NetworkDeviceOwnerUserService, {
  NetworkDeviceOwners,
} from "../../../Server/Services/NetworkDeviceOwnerUserService";
import TeamService from "../../../Server/Services/TeamService";
import WhoIsToldService from "../../../Server/Services/WhoIsToldService";
import IncidentStatusPageScope from "../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import WorkspaceRecordOwners from "../../../Server/Utils/Workspace/WorkspaceRecordOwners";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  WhoIsToldEvent as CardEvent,
  WhoIsToldOwnerAddedBy,
  WhoIsToldOwnerNotReached,
  WhoIsToldOwnerProblem,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { IsBillingEnabled } from "../../../Server/EnvironmentConfig";
import AlertEpisodeOnCallRuleService from "../../../Server/Services/AlertEpisodeOnCallRuleService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertOwnerRuleService from "../../../Server/Services/AlertOwnerRuleService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentEpisodeOnCallRuleService from "../../../Server/Services/IncidentEpisodeOnCallRuleService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentOwnerRuleService from "../../../Server/Services/IncidentOwnerRuleService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyScheduleService, {
  ResolvedShiftSegments,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService, {
  INVITATION_NOT_ACCEPTED_READINESS_REASONS,
  NOT_A_PROJECT_MEMBER_READINESS_REASONS,
  ReadinessStatus,
  ReadinessSummary,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import OnCallTestPageService from "../../../Server/Services/OnCallTestPageService";
import UserNotificationRuleService, {
  FallbackRule,
} from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ProjectService from "../../../Server/Services/ProjectService";
import RecommendationDismissalService from "../../../Server/Services/RecommendationDismissalService";
import SetupHealthService, {
  SETUP_HEALTH_MONITOR_PAGE_SIZE,
  getScheduleReason,
  toResponderFact,
} from "../../../Server/Services/SetupHealthService";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import CertificateOrder, {
  CustomDomainCertificateState,
} from "../../../Server/Utils/Greenlock/CertificateOrder";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  OnCallTestPagePreviewPerson,
  OnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  OnCallShift,
  ScheduleCoverageStatus,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import PositiveNumber from "../../../Types/PositiveNumber";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import {
  SetupHealthAnswer,
  SetupHealthCertificateReason,
  SetupHealthCheck,
  SetupHealthFinding,
  SetupHealthLevel,
  SetupHealthRecordAnswer,
  SetupHealthRecordKind,
  SetupHealthResponderReason,
  SetupHealthScheduleReason,
  SetupHealthOwnerSubject,
  SetupHealthSummary,
} from "../../../Types/SetupHealth/SetupHealth";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
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
 * SETUP HEALTH'S FACTS (SetupHealthService, #6812): read once per project,
 * in batches, kept a minute, and handed to each person as they may see
 * them.
 *
 * Every read is stubbed with one project's records, and the monitors'
 * chains are the real resolver (WhoIsToldService.resolveProject) with the
 * rule engines' real matching over the rules read once: so the test counts
 * the reads a project of ten monitors costs against one of a thousand.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "68120000-1111-4000-8000-000000000001",
);
const PRIMARY: string = "68120000-1111-4000-8000-0000000000a1";
const SECONDARY: string = "68120000-1111-4000-8000-0000000000a2";
const ARCHIVED_POLICY: string = "68120000-1111-4000-8000-0000000000a3";
const RULE: string = "68120000-1111-4000-8000-0000000000b1";
const CRITICAL: string = "68120000-1111-4000-8000-0000000000c1";
const OFFLINE: string = "68120000-1111-4000-8000-0000000000c2";
const ANA: string = "68120000-1111-4000-8000-0000000000d1";
const BEN: string = "68120000-1111-4000-8000-0000000000d2";
const CARL: string = "68120000-1111-4000-8000-0000000000d3";
const SCHEDULE: string = "68120000-1111-4000-8000-0000000000e1";
const EMPTY_PAGE: string = "68120000-1111-4000-8000-0000000000f1";
const SHOWING_PAGE: string = "68120000-1111-4000-8000-0000000000f2";
const DOMAIN: string = "68120000-1111-4000-8000-0000000000f3";
const DISMISSAL: string = "68120000-1111-4000-8000-0000000000f9";
const MANUAL_MONITOR: string = "68120000-1111-4000-8000-000000000101";
const OFF_MONITOR: string = "68120000-1111-4000-8000-000000000102";
const UNCHECKED_MONITOR: string = "68120000-1111-4000-8000-000000000103";
const ARCHIVED_MONITOR: string = "68120000-1111-4000-8000-000000000104";

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("68120000-1111-4000-8000-0000000000ff"),
};

function withId<T extends { _id?: string | undefined }>(
  item: T,
  id: string,
): T {
  item._id = id;
  return item;
}

function monitorId(index: number): string {
  return `68120000-2222-4000-8000-${index.toString().padStart(12, "0")}`;
}

// A monitor that goes Offline and opens a Critical incident.
function offlineSteps(): MonitorSteps {
  const offline: MonitorCriteriaInstance = {
    data: {
      id: "offline",
      name: "Offline",
      filterCondition: "All",
      filters: [],
      description: "",
      monitorStatusId: new ObjectID(OFFLINE),
      changeMonitorStatus: true,
      createIncidents: true,
      incidents: [
        {
          id: "incident",
          title: "Down",
          description: "",
          incidentSeverityId: new ObjectID(CRITICAL),
        },
      ],
      alerts: [],
    },
  } as unknown as MonitorCriteriaInstance;

  return {
    data: {
      monitorStepsInstanceArray: [
        {
          data: {
            monitorCriteria: {
              data: { monitorCriteriaInstanceArray: [offline] },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
}

function monitor(data: {
  id: string;
  name: string;
  monitorType?: MonitorType;
  isArchived?: boolean;
  disableActiveMonitoring?: boolean;
  updatedAt?: Date;
  isNoProbeEnabledOnThisMonitor?: boolean;
}): Monitor {
  const item: Monitor = withId(new Monitor(), data.id);
  item.name = data.name;
  item.projectId = PROJECT_ID;
  item.monitorType = data.monitorType || MonitorType.API;
  if (data.monitorType !== MonitorType.Manual) {
    item.monitorSteps = offlineSteps();
  }
  item.labels = [];
  item.isArchived = Boolean(data.isArchived);
  item.disableActiveMonitoring = Boolean(data.disableActiveMonitoring);
  item.updatedAt = data.updatedAt || new Date();
  item.isNoProbeEnabledOnThisMonitor = Boolean(
    data.isNoProbeEnabledOnThisMonitor,
  );
  item.isAllProbesDisconnectedFromThisMonitor = false;
  return item;
}

interface World {
  monitorCount: number;
  callerMonitors: Array<string> | "all";
  callerPolicies: "all" | "refused";
  callerStatusPages: "all" | "none";
  callerIngestionKeys: "all" | "none";
  dismissals: Array<RecommendationDismissal>;
  statusPagesFail: boolean;
  serverEmail: ServerSendingState;
  // The custom domain's CNAME record is verified.
  isDomainVerified: boolean;
  // What the certificate table and Redis say of each domain; null: the read fails.
  certificateStates: Map<string, CustomDomainCertificateState> | null;
  ingestionKeys: Array<TelemetryIngestionKey>;
  receivesTelemetry: boolean;
  // The project's privacy and owner rules for incidents (#9370): none here.
  incidentPrivacyRules: Array<IncidentPrivacyRule>;
  incidentOwnerRules: Array<IncidentOwnerRule>;
  // Who is a member of the project, of the people an owner rule names.
  projectMemberIds: Array<string>;
  // Primary's first level reaches nobody right now.
  primaryReachesNobody: boolean;
  /*
   * OWNERS (#9407, #9371): more monitors, which open alerts or name
   * owners; the alert on-call rules and owner rules; the project's teams
   * and who is in each; who owns each network device; and the teams and
   * owner rules a caller may read.
   */
  extraMonitors: Array<Monitor>;
  alertRules: Array<AlertOnCallRule>;
  alertOwnerRules: Array<AlertOwnerRule>;
  projectTeams: Record<string, string>;
  teamMemberIds: Record<string, Array<string>>;
  deviceOwnerUserIds: Record<string, Array<string>>;
  callerTeams: "all" | "none";
  callerOwnerRules: "all" | "none";
}

let world: World;

function defaultWorld(): World {
  return {
    monitorCount: 10,
    callerMonitors: "all",
    callerPolicies: "all",
    callerStatusPages: "all",
    callerIngestionKeys: "all",
    dismissals: [],
    statusPagesFail: false,
    serverEmail: ServerSendingState.NotSetUp,
    isDomainVerified: false,
    certificateStates: new Map<string, CustomDomainCertificateState>(),
    ingestionKeys: [],
    receivesTelemetry: true,
    incidentPrivacyRules: [],
    incidentOwnerRules: [],
    projectMemberIds: [],
    primaryReachesNobody: false,
    extraMonitors: [],
    alertRules: [],
    alertOwnerRules: [],
    projectTeams: {},
    teamMemberIds: {},
    deviceOwnerUserIds: {},
    callerTeams: "all",
    callerOwnerRules: "all",
  };
}

const KEY: string = "68120000-1111-4000-8000-0000000000f4";

function ingestionKey(data: {
  createdAt: Date;
  lastUsedAt?: Date | undefined;
  isEnabled?: boolean | undefined;
}): TelemetryIngestionKey {
  const item: TelemetryIngestionKey = withId(new TelemetryIngestionKey(), KEY);
  item.name = "Production collector";
  item.createdAt = data.createdAt;

  // What a case does not give stays unset, as on a key never used.
  if (data.lastUsedAt !== undefined) {
    item.lastUsedAt = data.lastUsedAt;
  }

  if (data.isEnabled !== undefined) {
    item.isEnabled = data.isEnabled;
  }

  return item;
}

// Every monitor of the project: the paging ones, and one of each kind the checks tell apart.
function projectMonitors(): Array<Monitor> {
  const monitors: Array<Monitor> = [];

  for (let index: number = 0; index < world.monitorCount; index++) {
    monitors.push(monitor({ id: monitorId(index), name: `Monitor ${index}` }));
  }

  monitors.push(
    monitor({
      id: MANUAL_MONITOR,
      name: "Manual",
      monitorType: MonitorType.Manual,
    }),
    monitor({
      id: OFF_MONITOR,
      name: "Old staging",
      disableActiveMonitoring: true,
      updatedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    }),
    monitor({
      id: UNCHECKED_MONITOR,
      name: "Monitor with no probe",
      isNoProbeEnabledOnThisMonitor: true,
    }),
    monitor({ id: ARCHIVED_MONITOR, name: "Archived", isArchived: true }),
    ...world.extraMonitors,
  );

  return monitors;
}

// The ids a QueryHelper.any read asks for in one column.
function idsAtColumn(query: unknown, column: string): Array<string> {
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

function readinessUser(
  userId: string,
  name: string,
  status: ReadinessStatus,
  methods: Array<string>,
  reasons: Array<string> = [],
): UserReadiness {
  return {
    userId: new ObjectID(userId),
    userName: name,
    userEmail: `${name.toLowerCase().replace(/ /g, ".")}@example.com`,
    status: status,
    methods: methods.map((methodType: string) => {
      return {
        methodId: ObjectID.generate(),
        methodType: methodType,
        maskedIdentifier: "•••",
        isVerified: true,
      };
    }),
    coverage: [],
    reasons: reasons,
    reachedVia: [],
    teams: [],
  };
}

function preview(
  userId: string,
  name: string,
  overrides: Partial<OnCallTestPagePreviewPerson>,
): OnCallTestPagePreviewPerson {
  return {
    userId: userId,
    userName: name,
    methods: [],
    hasNoRule: false,
    isOptedOut: false,
    warnings: [],
    ...overrides,
  };
}

function idsIn(query: unknown): Array<string> {
  const id: unknown = (query as { _id?: unknown })?._id;
  const parameters: Record<string, unknown> =
    ((id as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters as Record<string, unknown>) || {};
  const values: unknown = Object.values(parameters)[0];

  return (Array.isArray(values) ? values : []).map((value: unknown): string => {
    return String(value);
  });
}

function count(value: number): PositiveNumber {
  return new PositiveNumber(value);
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

// The reads, by name, so a test can count them.
const reads: Record<string, { mock: { calls: Array<unknown> } }> = {};

function spy<T>(
  name: string,
  target: T,
  method: keyof T,
  implementation: (...args: Array<any>) => unknown,
): void {
  reads[name] = jest
    .spyOn(target as any, method as any)
    .mockImplementation(implementation as any) as unknown as {
    mock: { calls: Array<unknown> };
  };
}

function stubWorld(): void {
  for (const key of Object.keys(reads)) {
    delete reads[key];
  }

  spy(
    "MonitorService.findBy",
    MonitorService,
    "findBy",
    async (args: {
      query: unknown;
      skip: number;
      limit: number;
      props: DatabaseCommonInteractionProps;
    }) => {
      if (args.props.isRoot) {
        return projectMonitors().slice(args.skip, args.skip + args.limit);
      }

      const asked: Array<string> = idsIn(args.query);

      return asked
        .filter((id: string): boolean => {
          return (
            world.callerMonitors === "all" || world.callerMonitors.includes(id)
          );
        })
        .map((id: string): Monitor => {
          return withId(new Monitor(), id);
        });
    },
  );

  spy("MonitorService.findOneById", MonitorService, "findOneById", async () => {
    throw new Error("A monitor is never read one at a time.");
  });

  spy(
    "OnCallDutyPolicyService.findBy",
    OnCallDutyPolicyService,
    "findBy",
    async (args: { query: unknown; props: DatabaseCommonInteractionProps }) => {
      const all: Array<OnCallDutyPolicy> = [
        [PRIMARY, "Primary", false],
        [SECONDARY, "Secondary", false],
        [ARCHIVED_POLICY, "Retired", true],
      ].map((row: Array<string | boolean>): OnCallDutyPolicy => {
        const item: OnCallDutyPolicy = withId(
          new OnCallDutyPolicy(),
          row[0] as string,
        );
        item.name = row[1] as string;
        item.isArchived = row[2] as boolean;
        return item;
      });

      if (args.props.isRoot) {
        return all;
      }

      if (world.callerPolicies === "refused") {
        throw new NotAuthorizedException("You may not read on-call policies.");
      }

      const asked: Array<string> = idsIn(args.query);

      return asked.length > 0
        ? all.filter((item: OnCallDutyPolicy): boolean => {
            return asked.includes(item.id!.toString());
          })
        : all.slice(0, 1);
    },
  );

  spy(
    "OnCallReadinessService.getReadinessForProject",
    OnCallReadinessService,
    "getReadinessForProject",
    async (): Promise<ReadinessSummary> => {
      return {
        projectId: PROJECT_ID,
        readyCount: 2,
        partiallyReadyCount: 0,
        notReachableCount: 1,
        isFallbackEnabled: true,
        isTruncated: false,
        users: [
          readinessUser(ANA, "Ana Lopez", ReadinessStatus.Ready, ["SMS"]),
          readinessUser(BEN, "Ben Ito", ReadinessStatus.Ready, ["Push"]),
          readinessUser(
            CARL,
            "Carl Diaz",
            ReadinessStatus.NotReachable,
            [],
            [...INVITATION_NOT_ACCEPTED_READINESS_REASONS],
          ),
        ],
      };
    },
  );

  spy(
    "OnCallReadinessService.getReadinessForUsers",
    OnCallReadinessService,
    "getReadinessForUsers",
    async () => {
      return [];
    },
  );

  // What every monitor's chain shares (WhoIsToldService.resolveProject).
  spy("ProjectService.findOneById", ProjectService, "findOneById", async () => {
    return Object.assign(new Project(), {
      enableSmsNotifications: true,
      enableCallNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
      disableOnCallNotificationFallback: false,
      smsOrCallCurrentBalanceInUSDCents: 300,
      enableAutoRechargeSmsOrCallBalance: false,
      autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
    });
  });
  spy(
    "ProjectCallSMSConfigService.getProjectDefaultTwilioConfig",
    ProjectCallSMSConfigService,
    "getProjectDefaultTwilioConfig",
    async () => {
      return undefined;
    },
  );
  spy(
    "IncidentSeverityService.findBy",
    IncidentSeverityService,
    "findBy",
    async () => {
      const critical: IncidentSeverity = withId(
        new IncidentSeverity(),
        CRITICAL,
      );
      critical.name = "Critical";
      return [critical];
    },
  );
  spy(
    "AlertSeverityService.findBy",
    AlertSeverityService,
    "findBy",
    async () => {
      return [
        withId(new AlertSeverity(), "68120000-1111-4000-8000-0000000000c9"),
      ];
    },
  );
  spy(
    "MonitorStatusService.findBy",
    MonitorStatusService,
    "findBy",
    async () => {
      const offline: MonitorStatus = withId(new MonitorStatus(), OFFLINE);
      offline.name = "Offline";
      return [offline];
    },
  );
  spy(
    "IncidentOwnerRuleService.countBy",
    IncidentOwnerRuleService,
    "countBy",
    async () => {
      return count(0);
    },
  );
  spy(
    "AlertOwnerRuleService.countBy",
    AlertOwnerRuleService,
    "countBy",
    async () => {
      return count(0);
    },
  );
  spy(
    "IncidentOnCallRuleService.countBy",
    IncidentOnCallRuleService,
    "countBy",
    async () => {
      return count(1);
    },
  );
  spy(
    "AlertOnCallRuleService.countBy",
    AlertOnCallRuleService,
    "countBy",
    async () => {
      return count(world.alertRules.length);
    },
  );

  // The rules: one incident rule that pages Primary for monitors named "Monitor ...".
  spy(
    "IncidentOnCallRuleEngineService.readEnabledRules",
    IncidentOnCallRuleEngineService,
    "readEnabledRules",
    async (): Promise<Array<IncidentOnCallRule>> => {
      const rule: IncidentOnCallRule = withId(new IncidentOnCallRule(), RULE);
      rule.name = "Production monitors";
      rule.monitorNamePattern = "^Monitor";
      rule.onCallDutyPolicies = [withId(new OnCallDutyPolicy(), PRIMARY)];
      return [rule];
    },
  );
  spy(
    "AlertOnCallRuleEngineService.readEnabledRules",
    AlertOnCallRuleEngineService,
    "readEnabledRules",
    async (): Promise<Array<AlertOnCallRule>> => {
      return world.alertRules;
    },
  );
  /*
   * The label rules (their labels change which on-call rules page) and the
   * alert incident rules (an alert that becomes an incident that pages is
   * no break): none here, read once for the project (#7212, #7216).
   */
  spy(
    "IncidentLabelRuleEngineService.getEnabledRules",
    IncidentLabelRuleEngineService,
    "getEnabledRules",
    async (): Promise<Array<IncidentLabelRule>> => {
      return [];
    },
  );
  spy(
    "AlertLabelRuleEngineService.getEnabledRules",
    AlertLabelRuleEngineService,
    "getEnabledRules",
    async (): Promise<Array<AlertLabelRule>> => {
      return [];
    },
  );
  spy(
    "AlertIncidentRuleEngineService.getEnabledRules",
    AlertIncidentRuleEngineService,
    "getEnabledRules",
    async (): Promise<Array<AlertIncidentRule>> => {
      return [];
    },
  );
  /*
   * The privacy rules, read once for the project; the owner rules only for
   * a private record's owners, who may read it (#9370).
   */
  spy(
    "IncidentPrivacyRuleEngineService.getEnabledRules",
    IncidentPrivacyRuleEngineService,
    "getEnabledRules",
    async (): Promise<Array<IncidentPrivacyRule>> => {
      return world.incidentPrivacyRules;
    },
  );
  spy(
    "AlertPrivacyRuleEngineService.getEnabledRules",
    AlertPrivacyRuleEngineService,
    "getEnabledRules",
    async (): Promise<Array<AlertPrivacyRule>> => {
      return [];
    },
  );
  spy(
    "IncidentOwnerRuleEngineService.getEnabledRules",
    IncidentOwnerRuleEngineService,
    "getEnabledRules",
    async (): Promise<Array<IncidentOwnerRule>> => {
      return world.incidentOwnerRules;
    },
  );
  spy(
    "AlertOwnerRuleEngineService.getEnabledRules",
    AlertOwnerRuleEngineService,
    "getEnabledRules",
    async (): Promise<Array<AlertOwnerRule>> => {
      return world.alertOwnerRules;
    },
  );
  // What a caller may read of the owner rules an owner finding is about (#9371).
  const readOwnerRules: (args: {
    query: unknown;
  }) => Promise<Array<IncidentOwnerRule>> = async (args: {
    query: unknown;
  }): Promise<Array<IncidentOwnerRule>> => {
    if (world.callerOwnerRules === "none") {
      throw new NotAuthorizedException("You may not read owner rules.");
    }

    return idsIn(args.query).map((id: string): IncidentOwnerRule => {
      return withId(new IncidentOwnerRule(), id);
    });
  };

  spy(
    "IncidentOwnerRuleService.findBy",
    IncidentOwnerRuleService,
    "findBy",
    readOwnerRules,
  );
  spy(
    "AlertOwnerRuleService.findBy",
    AlertOwnerRuleService,
    "findBy",
    readOwnerRules,
  );
  /*
   * The project's teams (readTeamNames, read as OneUptime with the project)
   * and what a caller may read of them (#9371).
   */
  spy(
    "TeamService.findBy",
    TeamService,
    "findBy",
    async (args: { query: unknown; props: DatabaseCommonInteractionProps }) => {
      const asked: Array<string> = idsIn(args.query).map((id: string) => {
        return id.toLowerCase();
      });

      if (!args.props.isRoot && world.callerTeams === "none") {
        return [];
      }

      return asked
        .filter((id: string): boolean => {
          return Boolean(world.projectTeams[id]);
        })
        .map((id: string): Team => {
          const team: Team = withId(new Team(), id);
          team.name = world.projectTeams[id]!;
          return team;
        });
    },
  );
  // Who owns each network device, every device at once (#9407).
  spy(
    "NetworkDeviceOwnerUserService.getDeviceOwnersForDevices",
    NetworkDeviceOwnerUserService,
    "getDeviceOwnersForDevices",
    async (args: {
      networkDeviceIds: Array<ObjectID>;
    }): Promise<Map<string, NetworkDeviceOwners>> => {
      const owners: Map<string, NetworkDeviceOwners> = new Map();

      for (const id of args.networkDeviceIds) {
        owners.set(id.toString().toLowerCase(), {
          ownerUserIds: (
            world.deviceOwnerUserIds[id.toString().toLowerCase()] || []
          ).map((userId: string): ObjectID => {
            return new ObjectID(userId);
          }),
          ownerTeamIds: [],
        });
      }

      return owners;
    },
  );
  spy(
    "NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor",
    NetworkDeviceOwnerUserService,
    "getDeviceOwnersForMonitor",
    async (args: { monitor: Monitor }): Promise<NetworkDeviceOwners> => {
      const deviceId: string =
        NetworkDeviceOwnerUserService.getDeviceIdForMonitor({
          monitor: args.monitor,
        })
          ?.toString()
          .toLowerCase() || "";

      return {
        ownerUserIds: (world.deviceOwnerUserIds[deviceId] || []).map(
          (userId: string): ObjectID => {
            return new ObjectID(userId);
          },
        ),
        ownerTeamIds: [],
      };
    },
  );
  spy(
    "TeamMemberService.getProjectMemberUserIds",
    TeamMemberService,
    "getProjectMemberUserIds",
    async (args: { userIds: Array<string> }): Promise<Array<ObjectID>> => {
      return args.userIds
        .filter((id: string): boolean => {
          return world.projectMemberIds.includes(id);
        })
        .map((id: string): ObjectID => {
          return new ObjectID(id);
        });
    },
  );
  spy("UserService.findBy", UserService, "findBy", async () => {
    return [];
  });

  spy(
    "OnCallTestPageService.readFirstLevel",
    OnCallTestPageService,
    "readFirstLevel",
    async () => {
      if (world.primaryReachesNobody) {
        return { targets: [], notPaged: [], levelCount: 1 };
      }

      return {
        targets: [
          { userId: new ObjectID(ANA) },
          { userId: new ObjectID(BEN), reachedThrough: "Schedule Primary" },
        ],
        notPaged: [],
        levelCount: 2,
      };
    },
  );
  spy(
    "OnCallTestPageService.getPersonPreview",
    OnCallTestPageService,
    "getPersonPreview",
    async (args: { userId: ObjectID }) => {
      return args.userId.toString() === ANA
        ? preview(ANA, "Ana Lopez", {
            methods: [
              {
                channel: OnCallPageChannel.SMS,
                notifyAfterMinutes: 0,
                isVerified: true,
                canAcknowledge: true,
              },
            ],
          })
        : preview(BEN, "Ben Ito", { hasNoRule: true });
    },
  );
  // Ben has no rule for the severity: what the fallback picks, his push (#7528).
  spy(
    "UserNotificationRuleService.getFallbackRules",
    UserNotificationRuleService,
    "getFallbackRules",
    async (): Promise<Array<FallbackRule>> => {
      const rule: UserNotificationRule = new UserNotificationRule();
      rule.userPush = { isVerified: true } as never;
      return [{ channelName: "Push", rule: rule }];
    },
  );
  spy(
    "ServerSendingStatus.getStatuses",
    ServerSendingStatus,
    "getStatuses",
    async () => {
      return [
        serverStatus(ServerSendingChannel.Email, world.serverEmail),
        serverStatus(ServerSendingChannel.SMS, ServerSendingState.Working),
        serverStatus(ServerSendingChannel.Call, ServerSendingState.Working),
      ];
    },
  );

  // The policies the rules of every kind run.
  spy(
    "IncidentOnCallRuleService.findBy",
    IncidentOnCallRuleService,
    "findBy",
    async (): Promise<Array<IncidentOnCallRule>> => {
      const rule: IncidentOnCallRule = withId(new IncidentOnCallRule(), RULE);
      rule.onCallDutyPolicies = [withId(new OnCallDutyPolicy(), PRIMARY)];
      return [rule];
    },
  );
  spy(
    "AlertOnCallRuleService.findBy",
    AlertOnCallRuleService,
    "findBy",
    async (): Promise<Array<AlertOnCallRule>> => {
      return world.alertRules;
    },
  );
  spy(
    "IncidentEpisodeOnCallRuleService.findBy",
    IncidentEpisodeOnCallRuleService,
    "findBy",
    async (): Promise<Array<IncidentEpisodeOnCallRule>> => {
      return [];
    },
  );
  spy(
    "AlertEpisodeOnCallRuleService.findBy",
    AlertEpisodeOnCallRuleService,
    "findBy",
    async (): Promise<Array<AlertEpisodeOnCallRule>> => {
      return [];
    },
  );

  // The schedules: Primary pages one with no rotations, and Retired one nobody reads.
  spy(
    "OnCallDutyPolicyEscalationRuleScheduleService.findBy",
    OnCallDutyPolicyEscalationRuleScheduleService,
    "findBy",
    async (): Promise<Array<OnCallDutyPolicyEscalationRuleSchedule>> => {
      const row: OnCallDutyPolicyEscalationRuleSchedule =
        new OnCallDutyPolicyEscalationRuleSchedule();
      row.onCallDutyPolicyId = new ObjectID(PRIMARY);
      row.onCallDutyPolicyScheduleId = new ObjectID(SCHEDULE);
      row.onCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      row.onCallDutyPolicySchedule.name = "Primary rota";

      const retired: OnCallDutyPolicyEscalationRuleSchedule =
        new OnCallDutyPolicyEscalationRuleSchedule();
      retired.onCallDutyPolicyId = new ObjectID(ARCHIVED_POLICY);
      retired.onCallDutyPolicyScheduleId = new ObjectID(
        "68120000-1111-4000-8000-0000000000e9",
      );

      return [row, retired];
    },
  );
  spy(
    "OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules",
    OnCallDutyPolicyScheduleService,
    "getResolvedShiftSegmentsForSchedules",
    async (args: {
      scheduleIds: Array<ObjectID>;
    }): Promise<Array<ResolvedShiftSegments>> => {
      return args.scheduleIds.map((id: ObjectID): ResolvedShiftSegments => {
        return {
          schedule: {
            id: id.toString(),
            name: "Primary rota",
            projectId: PROJECT_ID.toString(),
            shiftConfigVersion: 1,
          },
          segments: [],
          policyVariants: [],
          attachedPolicies: [],
          layerProps: [],
          scheduleUserIds: [],
          overrides: [],
          lastModifiedAt: new Date(),
          truncated: false,
        };
      });
    },
  );
  spy(
    "OnCallDutyPolicyScheduleService.findBy",
    OnCallDutyPolicyScheduleService,
    "findBy",
    async (args: { query: unknown }) => {
      return idsIn(args.query).map((id: string): OnCallDutyPolicySchedule => {
        return withId(new OnCallDutyPolicySchedule(), id);
      });
    },
  );

  // Two status pages, one showing nothing, and an unverified domain.
  spy(
    "StatusPageService.findBy",
    StatusPageService,
    "findBy",
    async (args: { query: unknown; props: DatabaseCommonInteractionProps }) => {
      // The project's read fails; the person's read of what they may see does not.
      if (world.statusPagesFail && args.props.isRoot) {
        throw new Error("The status pages could not be read.");
      }

      if (!args.props.isRoot) {
        if (world.callerStatusPages === "none") {
          return [];
        }

        return idsIn(args.query).map((id: string): StatusPage => {
          return withId(new StatusPage(), id);
        });
      }

      const empty: StatusPage = withId(new StatusPage(), EMPTY_PAGE);
      empty.name = "Acme Status";
      const showing: StatusPage = withId(new StatusPage(), SHOWING_PAGE);
      showing.name = "Internal";
      return [empty, showing];
    },
  );
  spy(
    "StatusPageResourceService.findBy",
    StatusPageResourceService,
    "findBy",
    async (): Promise<Array<StatusPageResource>> => {
      const resource: StatusPageResource = new StatusPageResource();
      resource.statusPageId = new ObjectID(SHOWING_PAGE);
      return [resource];
    },
  );
  spy(
    "StatusPageDomainService.findBy",
    StatusPageDomainService,
    "findBy",
    async (): Promise<Array<StatusPageDomain>> => {
      const domain: StatusPageDomain = withId(new StatusPageDomain(), DOMAIN);
      domain.fullDomain = "status.acme.com";
      domain.statusPageId = new ObjectID(EMPTY_PAGE);
      domain.statusPage = new StatusPage();
      domain.statusPage.name = "Acme Status";
      domain.isCnameVerified = world.isDomainVerified;
      domain.isCustomCertificate = false;
      domain.createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      return [domain];
    },
  );
  spy(
    "CertificateOrder.getCertificateStates",
    CertificateOrder,
    "getCertificateStates",
    async (): Promise<Map<string, CustomDomainCertificateState>> => {
      if (!world.certificateStates) {
        throw new Error("Redis could not be reached.");
      }

      return world.certificateStates;
    },
  );
  spy(
    "TelemetryIngestionKeyService.findBy",
    TelemetryIngestionKeyService,
    "findBy",
    async (args: { query: unknown; props: DatabaseCommonInteractionProps }) => {
      if (args.props.isRoot) {
        return world.ingestionKeys;
      }

      if (world.callerIngestionKeys === "none") {
        throw new NotAuthorizedException("You may not read ingestion keys.");
      }

      return idsIn(args.query).map((id: string): TelemetryIngestionKey => {
        return withId(new TelemetryIngestionKey(), id);
      });
    },
  );

  // One owner, two members who accepted (one twice), a Slack with no rule.
  spy("ProjectService.getOwners", ProjectService, "getOwners", async () => {
    const owner: User = withId(new User(), ANA);
    return [owner];
  });
  spy(
    "TeamMemberService.findBy",
    TeamMemberService,
    "findBy",
    async (args: { query: unknown }): Promise<Array<TeamMember>> => {
      const query: Record<string, unknown> = args.query as Record<
        string,
        unknown
      >;

      // A caller's own teams, for who may read a private record: none.
      if (query["userId"]) {
        return [];
      }

      // The members of the teams named as owners (#7211, #9371).
      if (query["teamId"]) {
        return idsAtColumn(query, "teamId").flatMap(
          (teamId: string): Array<TeamMember> => {
            return (world.teamMemberIds[teamId] || []).map(
              (userId: string): TeamMember => {
                const member: TeamMember = new TeamMember();
                member.teamId = new ObjectID(teamId);
                member.userId = new ObjectID(userId);
                return member;
              },
            );
          },
        );
      }

      return [ANA, BEN, BEN].map((userId: string): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.userId = new ObjectID(userId);
        return member;
      });
    },
  );
  spy(
    "WorkspaceProjectAuthTokenService.findBy",
    WorkspaceProjectAuthTokenService,
    "findBy",
    async (): Promise<Array<WorkspaceProjectAuthToken>> => {
      const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      token.workspaceType = WorkspaceType.Slack;
      return [token, token];
    },
  );
  spy(
    "WorkspaceNotificationRuleService.findBy",
    WorkspaceNotificationRuleService,
    "findBy",
    async (): Promise<Array<WorkspaceNotificationRule>> => {
      const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
      rule.workspaceType = WorkspaceType.MicrosoftTeams;
      return [rule];
    },
  );
  spy(
    "ProjectMilestoneService.getReachedMilestones",
    ProjectMilestoneService,
    "getReachedMilestones",
    async () => {
      return world.receivesTelemetry
        ? [
            {
              milestone: ActivationMilestone.FirstLogsReceived,
              reachedAt: new Date(),
              wasBackfilled: false,
            },
          ]
        : [];
    },
  );
  spy(
    "RecommendationDismissalService.findBy",
    RecommendationDismissalService,
    "findBy",
    async () => {
      return world.dismissals;
    },
  );
}

function checksOf(findings: Array<SetupHealthFinding>): Array<string> {
  return findings.map((finding: SetupHealthFinding): string => {
    return `${finding.check}${finding.reason ? `:${finding.reason}` : ""}`;
  });
}

// How many reads each part costs, but the monitors' own.
function readCounts(): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const [name, mock] of Object.entries(reads)) {
    if (name !== "MonitorService.findBy") {
      counts[name] = mock.mock.calls.length;
    }
  }

  return counts;
}

describe("SetupHealthService", () => {
  beforeEach(() => {
    world = defaultWorld();
    SetupHealthService.clearCache();
    stubWorld();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    SetupHealthService.clearCache();
  });

  test("reads the project once and finds what it breaks, each with its record", async () => {
    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    const expected: Array<string> = [
      ...(IsBillingEnabled ? [] : [SetupHealthCheck.ServerCannotSend]),
      `${SetupHealthCheck.ResponderCannotBePaged}:${SetupHealthResponderReason.InvitationNotAccepted}`,
      SetupHealthCheck.PolicyNotRun,
      `${SetupHealthCheck.ScheduleHasNobodyOnCall}:${SetupHealthScheduleReason.NoRotations}`,
      ...(IsBillingEnabled ? [SetupHealthCheck.LowBalance] : []),
      `${SetupHealthCheck.MonitorNotChecked}:no_probe`,
      SetupHealthCheck.StatusPageShowsNoMonitor,
      SetupHealthCheck.StatusPageDomainNotVerified,
      SetupHealthCheck.MonitorOffForLong,
      SetupHealthCheck.TelemetryNotWatched,
      SetupHealthCheck.WorkspaceNotUsed,
      SetupHealthCheck.OneOwner,
    ];

    expect(checksOf(answer.findings)).toEqual(expected);

    // The paging monitors' chains, and the one with no probe; not the manual, off or archived ones.
    expect(answer.monitorCount).toBe(world.monitorCount + 1);
    expect(answer.dismissed).toEqual([]);
    expect(typeof answer.checkedAt).toBe("string");

    const byCheck: (check: SetupHealthCheck) => SetupHealthFinding = (
      check: SetupHealthCheck,
    ): SetupHealthFinding => {
      return answer.findings.find((finding: SetupHealthFinding): boolean => {
        return finding.check === check;
      })!;
    };

    expect(byCheck(SetupHealthCheck.PolicyNotRun).record).toEqual({
      kind: SetupHealthRecordKind.OnCallDutyPolicy,
      id: SECONDARY,
      name: "Secondary",
    });
    expect(byCheck(SetupHealthCheck.ResponderCannotBePaged).record).toEqual({
      kind: SetupHealthRecordKind.User,
      id: CARL,
      name: "Carl Diaz",
    });
    expect(byCheck(SetupHealthCheck.ScheduleHasNobodyOnCall).record).toEqual({
      kind: SetupHealthRecordKind.OnCallDutyPolicySchedule,
      id: SCHEDULE,
      name: "Primary rota",
    });
    expect(byCheck(SetupHealthCheck.MonitorNotChecked).record.id).toBe(
      UNCHECKED_MONITOR,
    );
    expect(byCheck(SetupHealthCheck.MonitorOffForLong).record.id).toBe(
      OFF_MONITOR,
    );
    expect(byCheck(SetupHealthCheck.StatusPageShowsNoMonitor).record.id).toBe(
      EMPTY_PAGE,
    );
    expect(byCheck(SetupHealthCheck.WorkspaceNotUsed).subject).toBe(
      WorkspaceType.Slack,
    );

    if (IsBillingEnabled) {
      expect(byCheck(SetupHealthCheck.LowBalance).balanceInUSDCents).toBe(300);
    }

    expect(answer.counts.needsALook).toBe(
      answer.counts.pagesWillNotArrive + answer.counts.worthFixing,
    );
  });

  test("the monitors' chains are the real resolver's: the rule pages Primary, which reaches Ana by SMS", async () => {
    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    // Every paging monitor matches the rule and pages somebody: no monitor finding.
    expect(
      answer.findings.filter((finding: SetupHealthFinding): boolean => {
        return (
          finding.check === SetupHealthCheck.MonitorPagesNobody ||
          finding.check === SetupHealthCheck.MonitorTellsNobody
        );
      }),
    ).toEqual([]);
    expect(reads["MonitorService.findOneById"]!.mock.calls).toHaveLength(0);
  });

  test("a project of a thousand monitors costs the reads of a project of ten, but for its monitors", async () => {
    world.monitorCount = 10;
    await SetupHealthService.getProjectFindings({
      projectId: PROJECT_ID,
      refresh: true,
    });
    const ten: Record<string, number> = readCounts();
    const tenMonitorReads: number =
      reads["MonitorService.findBy"]!.mock.calls.length;

    jest.restoreAllMocks();
    SetupHealthService.clearCache();
    world.monitorCount = 1000;
    stubWorld();

    await SetupHealthService.getProjectFindings({
      projectId: PROJECT_ID,
      refresh: true,
    });
    const thousand: Record<string, number> = readCounts();
    const thousandMonitorReads: number =
      reads["MonitorService.findBy"]!.mock.calls.length;

    expect(thousand).toEqual(ten);
    // A read of the monitors per thousand.
    expect(tenMonitorReads).toBe(1);
    expect(thousandMonitorReads).toBe(
      Math.ceil((1000 + 4) / SETUP_HEALTH_MONITOR_PAGE_SIZE),
    );
    // Each policy's first level and each person's rules, once.
    expect(thousand["OnCallTestPageService.readFirstLevel"]).toBe(1);
    expect(thousand["OnCallTestPageService.getPersonPreview"]).toBe(2);
    // What the fallback picks for the one person with no rule, once (#7528).
    expect(thousand["UserNotificationRuleService.getFallbackRules"]).toBe(1);
    expect(thousand["MonitorService.findOneById"]).toBe(0);
    // Every responder's verified methods come from the project's Readiness.
    expect(thousand["OnCallReadinessService.getReadinessForUsers"]).toBe(0);
    /*
     * The privacy rules, once (#9370), and the owner rules, once (#9407,
     * #9371): every record's owners are worked out. Naming nobody, the
     * project reads nobody's membership.
     */
    expect(thousand["IncidentPrivacyRuleEngineService.getEnabledRules"]).toBe(
      1,
    );
    expect(thousand["AlertPrivacyRuleEngineService.getEnabledRules"]).toBe(1);
    expect(thousand["IncidentOwnerRuleEngineService.getEnabledRules"]).toBe(1);
    expect(thousand["AlertOwnerRuleEngineService.getEnabledRules"]).toBe(1);
    expect(thousand["TeamMemberService.getProjectMemberUserIds"]).toBe(0);

    const total: number = Object.values(thousand).reduce(
      (sum: number, value: number): number => {
        return sum + value;
      },
      0,
    );

    // The owner rules of incidents and alerts are two of them (#9407).
    expect(total).toBeLessThan(44);
  });

  test("a person sees only findings about records they may read", async () => {
    world.callerMonitors = [UNCHECKED_MONITOR];
    world.callerPolicies = "refused";

    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    const checks: Array<string> = checksOf(answer.findings);

    expect(checks).not.toContain(SetupHealthCheck.PolicyNotRun);
    expect(checks).not.toContain(
      `${SetupHealthCheck.ResponderCannotBePaged}:${SetupHealthResponderReason.InvitationNotAccepted}`,
    );
    expect(checks).not.toContain(SetupHealthCheck.MonitorOffForLong);
    expect(checks).toContain(`${SetupHealthCheck.MonitorNotChecked}:no_probe`);
    // The project's own findings are every member's.
    expect(checks).toContain(SetupHealthCheck.OneOwner);
  });

  test("a schedule is read as the person may read schedules", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockImplementation((async () => {
        throw new NotAuthorizedException("You may not read schedules.");
      }) as never);

    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(
      answer.findings.some((finding: SetupHealthFinding): boolean => {
        return finding.check === SetupHealthCheck.ScheduleHasNobodyOnCall;
      }),
    ).toBe(false);
  });

  test("a dismissed finding is set apart for everyone, with its reason and who dismissed it", async () => {
    const dismissal: RecommendationDismissal = withId(
      new RecommendationDismissal(),
      DISMISSAL,
    );
    dismissal.recommendationType = RecommendationType.SetupHealth;
    dismissal.recommendationId = SetupHealthCheck.PolicyNotRun;
    dismissal.resourceType = SetupHealthRecordKind.OnCallDutyPolicy;
    dismissal.resourceId = new ObjectID(SECONDARY);
    dismissal.dismissalReason = "We page Secondary by hand.";
    dismissal.createdAt = new Date("2026-11-10T09:00:00.000Z");
    dismissal.createdByUser = new User();
    dismissal.createdByUser.name = "Ana Lopez" as never;
    world.dismissals = [dismissal];

    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(checksOf(answer.findings)).not.toContain(
      SetupHealthCheck.PolicyNotRun,
    );
    expect(answer.dismissed).toHaveLength(1);
    expect(answer.dismissed[0]!.finding.record.id).toBe(SECONDARY);
    expect(answer.dismissed[0]!.dismissal).toEqual({
      id: DISMISSAL,
      recommendationId: SetupHealthCheck.PolicyNotRun,
      resourceType: SetupHealthRecordKind.OnCallDutyPolicy,
      resourceId: SECONDARY,
      reason: "We page Secondary by hand.",
      dismissedByName: "Ana Lopez",
      dismissedAt: "2026-11-10T09:00:00.000Z",
    });

    // The dismissals are read on every ask, so a Restore shows at once.
    world.dismissals = [];

    const restored: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(checksOf(restored.findings)).toContain(
      SetupHealthCheck.PolicyNotRun,
    );
    expect(restored.dismissed).toEqual([]);
  });

  test("the dismissals read are the project's setup health ones", async () => {
    await SetupHealthService.readDismissals(PROJECT_ID);

    expect(
      (
        reads["RecommendationDismissalService.findBy"]!.mock.calls[0] as [
          { query: Record<string, unknown> },
        ]
      )[0].query,
    ).toEqual({
      projectId: PROJECT_ID,
      recommendationType: RecommendationType.SetupHealth,
    });
  });

  test("the findings are kept a minute; a refresh works them out again; two asks at once share one", async () => {
    await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });
    await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(
      reads["OnCallReadinessService.getReadinessForProject"]!.mock.calls,
    ).toHaveLength(1);

    await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
      refresh: true,
    });

    expect(
      reads["OnCallReadinessService.getReadinessForProject"]!.mock.calls,
    ).toHaveLength(2);

    SetupHealthService.clearCache();

    await Promise.all([
      SetupHealthService.getForCaller({ projectId: PROJECT_ID, props: CALLER }),
      SetupHealthService.getSummaryForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      }),
    ]);

    expect(
      reads["OnCallReadinessService.getReadinessForProject"]!.mock.calls,
    ).toHaveLength(3);
  });

  test("Home's summary is the counts of the person's answer", async () => {
    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });
    const summary: SetupHealthSummary =
      await SetupHealthService.getSummaryForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

    expect(summary).toEqual({
      counts: answer.counts,
      checkedAt: answer.checkedAt,
    });
  });

  test("a read that fails takes its own checks away, never the whole list", async () => {
    world.statusPagesFail = true;

    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });
    const checks: Array<string> = checksOf(answer.findings);

    expect(checks).not.toContain(SetupHealthCheck.StatusPageShowsNoMonitor);
    expect(checks).toContain(SetupHealthCheck.PolicyNotRun);
    expect(checks).toContain(SetupHealthCheck.StatusPageDomainNotVerified);
  });

  test("when the rules can't be read, no policy is said to be run by nothing", async () => {
    jest
      .spyOn(IncidentEpisodeOnCallRuleService, "findBy")
      .mockImplementation((async () => {
        throw new Error("The episode rules could not be read.");
      }) as never);

    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(checksOf(answer.findings)).not.toContain(
      SetupHealthCheck.PolicyNotRun,
    );
  });

  test("a server that can send email has no server finding", async () => {
    world.serverEmail = ServerSendingState.Working;

    const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
    });

    expect(checksOf(answer.findings)).not.toContain(
      SetupHealthCheck.ServerCannotSend,
    );
  });

  test("the facts: the balance on OneUptime Cloud, the server's email on a self-hosted one", async () => {
    const facts: Awaited<ReturnType<typeof SetupHealthService.readFacts>> =
      await SetupHealthService.readFacts(PROJECT_ID);

    if (IsBillingEnabled) {
      expect(facts.balance).toEqual({
        balanceInUSDCents: 300,
        isAutoRechargeOn: false,
        lowBalanceInUSDCents: 1000,
      });
      expect(facts.serverCanSendEmail).toBeNull();
    } else {
      expect(facts.balance).toBeNull();
      expect(facts.serverCanSendEmail).toBe(false);
    }

    expect(facts.owners).toEqual({ ownerCount: 1, memberCount: 2 });
    expect(facts.workspaces).toEqual([
      { workspaceType: "Slack", workspaceName: "Slack", ruleCount: 0 },
    ]);
    expect(facts.policyIdsRunByRules).toEqual([PRIMARY]);
    expect(
      facts.policies
        .map((policy: { id: string }) => {
          return policy.id;
        })
        .sort(),
    ).toEqual([PRIMARY, SECONDARY].sort());
    expect(facts.statusPages).toEqual([
      { id: EMPTY_PAGE, name: "Acme Status", resourceCount: 0 },
      { id: SHOWING_PAGE, name: "Internal", resourceCount: 1 },
    ]);
    expect(facts.telemetry).toEqual({ receivesTelemetry: true });
    // Only the schedules a policy that is not archived pages.
    expect(
      facts.schedules.map((schedule: { id: string }) => {
        return schedule.id;
      }),
    ).toEqual([SCHEDULE]);
    // The archived monitor is gone; the others are all here.
    expect(facts.monitors).toHaveLength(world.monitorCount + 3);
  });

  /*
   * #7294: a verified custom domain's free certificate, as the Custom
   * Domains page's Status column reads it - only where the installation
   * issues free certificates, in one batch for every domain.
   */
  describe("a custom domain's certificate", () => {
    const LETS_ENCRYPT_ACCOUNT_KEY: string = "LETS_ENCRYPT_ACCOUNT_KEY";
    let keyBefore: string | undefined;

    beforeEach(() => {
      keyBefore = process.env[LETS_ENCRYPT_ACCOUNT_KEY];
      process.env[LETS_ENCRYPT_ACCOUNT_KEY] = "an account key";
      world.isDomainVerified = true;
    });

    afterEach(() => {
      if (keyBefore === undefined) {
        delete process.env[LETS_ENCRYPT_ACCOUNT_KEY];
      } else {
        process.env[LETS_ENCRYPT_ACCOUNT_KEY] = keyBefore;
      }
    });

    function certificateFinding(
      answer: SetupHealthAnswer,
    ): SetupHealthFinding | undefined {
      return answer.findings.find((finding: SetupHealthFinding): boolean => {
        return (
          finding.check === SetupHealthCheck.StatusPageDomainCertificateFailed
        );
      });
    }

    test("a verified domain whose certificate order keeps failing is worth fixing, read in one batch", async () => {
      world.certificateStates = new Map<string, CustomDomainCertificateState>([
        [
          "status.acme.com",
          {
            lastOrderError: "CAA record for acme.com prevents issuance.",
            lastOrderFailedAt: new Date(),
          },
        ],
      ]);

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(certificateFinding(answer)).toMatchObject({
        level: SetupHealthLevel.WorthFixing,
        reason: SetupHealthCertificateReason.NotIssued,
        record: {
          kind: SetupHealthRecordKind.StatusPageDomain,
          id: DOMAIN,
          name: "status.acme.com",
        },
      });
      // Verified: it is no longer said to be waiting for its CNAME record.
      expect(checksOf(answer.findings)).not.toContain(
        SetupHealthCheck.StatusPageDomainNotVerified,
      );
      expect(
        reads["CertificateOrder.getCertificateStates"]!.mock.calls,
      ).toEqual([[["status.acme.com"]]]);
    });

    test("an expired certificate is worth fixing", async () => {
      world.certificateStates = new Map<string, CustomDomainCertificateState>([
        [
          "status.acme.com",
          {
            certificateExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        ],
      ]);

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(certificateFinding(answer)?.reason).toBe(
        SetupHealthCertificateReason.Expired,
      );
    });

    test("a certificate in place, or still being issued, is no finding", async () => {
      for (const state of [
        { certificateExpiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000) },
        {},
      ]) {
        SetupHealthService.clearCache();
        world.certificateStates = new Map<string, CustomDomainCertificateState>(
          [["status.acme.com", state]],
        );

        expect(
          certificateFinding(
            await SetupHealthService.getForCaller({
              projectId: PROJECT_ID,
              props: CALLER,
            }),
          ),
        ).toBeUndefined();
      }
    });

    test("an installation that issues no free certificates is never asked about them", async () => {
      delete process.env[LETS_ENCRYPT_ACCOUNT_KEY];
      world.certificateStates = null;

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(certificateFinding(answer)).toBeUndefined();
      expect(
        reads["CertificateOrder.getCertificateStates"]!.mock.calls,
      ).toHaveLength(0);
    });

    test("a domain still waiting for its CNAME record is not asked about", async () => {
      world.isDomainVerified = false;

      await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(
        reads["CertificateOrder.getCertificateStates"]!.mock.calls,
      ).toHaveLength(0);
    });

    test("a certificate read that fails says nothing of certificates, and keeps every other finding", async () => {
      world.certificateStates = null;

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(certificateFinding(answer)).toBeUndefined();
      expect(checksOf(answer.findings)).toContain(
        SetupHealthCheck.StatusPageShowsNoMonitor,
      );
      expect(checksOf(answer.findings)).toContain(
        SetupHealthCheck.PolicyNotRun,
      );
    });
  });

  /*
   * #7295: an ingestion key no data has arrived with, from one read of the
   * project's keys.
   */
  describe("ingestion keys", () => {
    // Made after HTTP stamped, before gRPC and MQTT did.
    const OCTOBER: Date = new Date("2026-10-01T09:00:00.000Z");

    function keyFinding(
      answer: SetupHealthAnswer,
    ): SetupHealthFinding | undefined {
      return answer.findings.find((finding: SetupHealthFinding): boolean => {
        return finding.check === SetupHealthCheck.IngestionKeyNeverUsed;
      });
    }

    test("a key no data has arrived with, in a project nothing has ever been sent to, is a suggestion", async () => {
      world.receivesTelemetry = false;
      world.ingestionKeys = [ingestionKey({ createdAt: OCTOBER })];

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(keyFinding(answer)).toMatchObject({
        level: SetupHealthLevel.Suggestion,
        record: {
          kind: SetupHealthRecordKind.TelemetryIngestionKey,
          id: KEY,
          name: "Production collector",
        },
        fixRecordId: KEY,
      });
    });

    test("the same key where telemetry arrives, a key in use and a key switched off are no finding", async () => {
      for (const data of [
        { receivesTelemetry: true, key: ingestionKey({ createdAt: OCTOBER }) },
        {
          receivesTelemetry: false,
          key: ingestionKey({
            createdAt: OCTOBER,
            lastUsedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          }),
        },
        {
          receivesTelemetry: false,
          key: ingestionKey({ createdAt: OCTOBER, isEnabled: false }),
        },
      ]) {
        SetupHealthService.clearCache();
        world.receivesTelemetry = data.receivesTelemetry;
        world.ingestionKeys = [data.key];

        expect(
          keyFinding(
            await SetupHealthService.getForCaller({
              projectId: PROJECT_ID,
              props: CALLER,
            }),
          ),
        ).toBeUndefined();
      }
    });

    test("is shown only to someone who may read ingestion keys", async () => {
      world.receivesTelemetry = false;
      world.ingestionKeys = [ingestionKey({ createdAt: OCTOBER })];
      world.callerIngestionKeys = "none";

      expect(
        keyFinding(
          await SetupHealthService.getForCaller({
            projectId: PROJECT_ID,
            props: CALLER,
          }),
        ),
      ).toBeUndefined();
    });

    test("the keys are read once, by when they were made and last used, never with their secret", async () => {
      await SetupHealthService.readFacts(PROJECT_ID);

      const calls: Array<unknown> =
        reads["TelemetryIngestionKeyService.findBy"]!.mock.calls;

      expect(calls).toHaveLength(1);

      const args: { select: Record<string, unknown> } = (
        calls[0] as [{ select: Record<string, unknown> }]
      )[0];

      expect(Object.keys(args.select).sort()).toEqual(
        [
          "_id",
          "name",
          "createdAt",
          "lastUsedAt",
          "isEnabled",
          "expiresAt",
        ].sort(),
      );
      expect(args.select).not.toHaveProperty("secretKey");
    });

    test("a key read that fails takes only the keys' check away", async () => {
      jest
        .spyOn(TelemetryIngestionKeyService, "findBy")
        .mockImplementation((async () => {
          throw new Error("The ingestion keys could not be read.");
        }) as never);

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(keyFinding(answer)).toBeUndefined();
      expect(checksOf(answer.findings)).toContain(
        SetupHealthCheck.PolicyNotRun,
      );
    });
  });

  /*
   * #7297: the line at the top of a record's page - its open findings, as
   * the Setup Health page has them, for someone who may read it.
   */
  describe("one record's findings", () => {
    test("a policy's page is handed the findings about it, as the page says them", async () => {
      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });
      const forRecord: SetupHealthRecordAnswer =
        await SetupHealthService.getForRecord({
          projectId: PROJECT_ID,
          props: CALLER,
          record: {
            kind: SetupHealthRecordKind.OnCallDutyPolicy,
            id: SECONDARY,
          },
        });

      expect(checksOf(forRecord.findings)).toEqual([
        SetupHealthCheck.PolicyNotRun,
      ]);
      // The same finding, word for word, as the Setup Health page has it.
      expect(forRecord.findings[0]).toEqual(
        answer.findings.find((finding: SetupHealthFinding): boolean => {
          return finding.check === SetupHealthCheck.PolicyNotRun;
        }),
      );
      expect(forRecord.checkedAt).toBe(answer.checkedAt);
      // From the same minute-old findings: nothing was worked out again.
      expect(
        reads["OnCallReadinessService.getReadinessForProject"]!.mock.calls,
      ).toHaveLength(1);
    });

    test("a refresh works the project's findings out again, as the page's Recheck does", async () => {
      const record: { kind: SetupHealthRecordKind; id: string } = {
        kind: SetupHealthRecordKind.OnCallDutyPolicy,
        id: SECONDARY,
      };

      await SetupHealthService.getForRecord({
        projectId: PROJECT_ID,
        props: CALLER,
        record: record,
      });
      await SetupHealthService.getForRecord({
        projectId: PROJECT_ID,
        props: CALLER,
        record: record,
      });

      expect(
        reads["OnCallReadinessService.getReadinessForProject"]!.mock.calls,
      ).toHaveLength(1);

      await SetupHealthService.getForRecord({
        projectId: PROJECT_ID,
        props: CALLER,
        record: record,
        refresh: true,
      });

      expect(
        reads["OnCallReadinessService.getReadinessForProject"]!.mock.calls,
      ).toHaveLength(2);
    });

    test("a status page's page is handed its own findings and its custom domains'", async () => {
      const forRecord: SetupHealthRecordAnswer =
        await SetupHealthService.getForRecord({
          projectId: PROJECT_ID,
          props: CALLER,
          record: { kind: SetupHealthRecordKind.StatusPage, id: EMPTY_PAGE },
        });

      expect(checksOf(forRecord.findings)).toEqual([
        SetupHealthCheck.StatusPageShowsNoMonitor,
        SetupHealthCheck.StatusPageDomainNotVerified,
      ]);
    });

    test("a dismissed finding is not handed to the record's page", async () => {
      const dismissal: RecommendationDismissal = withId(
        new RecommendationDismissal(),
        DISMISSAL,
      );
      dismissal.recommendationType = RecommendationType.SetupHealth;
      dismissal.recommendationId = SetupHealthCheck.PolicyNotRun;
      dismissal.resourceType = SetupHealthRecordKind.OnCallDutyPolicy;
      dismissal.resourceId = new ObjectID(SECONDARY);
      world.dismissals = [dismissal];

      expect(
        (
          await SetupHealthService.getForRecord({
            projectId: PROJECT_ID,
            props: CALLER,
            record: {
              kind: SetupHealthRecordKind.OnCallDutyPolicy,
              id: SECONDARY,
            },
          })
        ).findings,
      ).toEqual([]);
    });

    test("someone who may not read the record is handed nothing about it", async () => {
      world.callerPolicies = "refused";
      world.callerStatusPages = "none";

      for (const record of [
        { kind: SetupHealthRecordKind.OnCallDutyPolicy, id: SECONDARY },
        { kind: SetupHealthRecordKind.StatusPage, id: EMPTY_PAGE },
      ]) {
        expect(
          (
            await SetupHealthService.getForRecord({
              projectId: PROJECT_ID,
              props: CALLER,
              record: record,
            })
          ).findings,
        ).toEqual([]);
      }
    });

    test("only what the record's findings name is read for the person, and a record with none reads nothing more", async () => {
      await SetupHealthService.getProjectFindings({ projectId: PROJECT_ID });

      const callerReads: (name: string) => number = (name: string): number => {
        return (
          reads[name]!.mock.calls as Array<
            [{ props: DatabaseCommonInteractionProps }]
          >
        ).filter((call: [{ props: DatabaseCommonInteractionProps }]) => {
          return !call[0].props.isRoot;
        }).length;
      };

      await SetupHealthService.getForRecord({
        projectId: PROJECT_ID,
        props: CALLER,
        record: { kind: SetupHealthRecordKind.OnCallDutyPolicy, id: SECONDARY },
      });

      expect(callerReads("OnCallDutyPolicyService.findBy")).toBe(1);
      expect(callerReads("MonitorService.findBy")).toBe(0);
      expect(callerReads("StatusPageService.findBy")).toBe(0);
      expect(callerReads("TelemetryIngestionKeyService.findBy")).toBe(0);

      const dismissalReads: number =
        reads["RecommendationDismissalService.findBy"]!.mock.calls.length;

      expect(
        (
          await SetupHealthService.getForRecord({
            projectId: PROJECT_ID,
            props: CALLER,
            record: {
              kind: SetupHealthRecordKind.OnCallDutyPolicy,
              id: PRIMARY,
            },
          })
        ).findings,
      ).toEqual([]);
      expect(
        reads["RecommendationDismissalService.findBy"]!.mock.calls.length,
      ).toBe(dismissalReads);
    });
  });

  /*
   * A PRIVATE RECORD A MONITOR WOULD OPEN (#9370). Its card tells a reader
   * who could not read it once it exists only that it opens, and that it is
   * private: nothing of whom it tells, and none of the breaks it would raise
   * (#7213). The list says none of them to that reader either, and names no
   * monitor of one as what a finding affects. Here Primary reaches nobody
   * right now, and every monitor's incident would page it.
   */
  describe("a private record a monitor would open (#9370)", () => {
    const ME: string = CALLER.userId!.toString();

    // Makes private the incidents of the monitors whose name matches; every incident without one.
    function privacyRule(monitorNamePattern?: string): IncidentPrivacyRule {
      const rule: IncidentPrivacyRule = withId(
        new IncidentPrivacyRule(),
        "68120000-1111-4000-8000-0000000000b7",
      );
      rule.name = "Sensitive monitors";
      rule.projectId = PROJECT_ID;

      if (monitorNamePattern) {
        rule.monitorNamePattern = monitorNamePattern;
      }

      return rule;
    }

    // An owner rule that adds this person as an owner of every incident.
    function ownerRule(userId: string): IncidentOwnerRule {
      const rule: IncidentOwnerRule = withId(
        new IncidentOwnerRule(),
        "68120000-1111-4000-8000-0000000000b8",
      );
      rule.name = "Payments team";
      rule.projectId = PROJECT_ID;
      rule.isEnabled = true;
      rule.notifyOwners = true;
      rule.monitors = [];
      rule.incidentSeverities = [];
      rule.incidentLabels = [];
      rule.monitorLabels = [];
      rule.ownerUsers = [withId(new User(), userId)];
      rule.ownerTeams = [];
      return rule;
    }

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

    async function reachesNobody(
      props: DatabaseCommonInteractionProps,
    ): Promise<SetupHealthFinding | undefined> {
      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: props,
      });

      return answer.findings.find((finding: SetupHealthFinding): boolean => {
        return finding.check === SetupHealthCheck.PolicyReachesNobody;
      });
    }

    // The monitors a finding says it affects.
    function affected(finding: SetupHealthFinding | undefined): Array<string> {
      return (finding?.related || [])
        .filter((record: { kind: SetupHealthRecordKind }): boolean => {
          return record.kind === SetupHealthRecordKind.Monitor;
        })
        .map((record: { id: string }): string => {
          return record.id;
        });
    }

    beforeEach(() => {
      world.primaryReachesNobody = true;
    });

    test("with no private record, every member is told Primary reaches nobody, for every monitor that pages it", async () => {
      const finding: SetupHealthFinding | undefined =
        await reachesNobody(CALLER);

      expect(finding?.record).toEqual({
        kind: SetupHealthRecordKind.OnCallDutyPolicy,
        id: PRIMARY,
        name: "Primary",
      });
      expect(affected(finding)).toHaveLength(world.monitorCount + 1);
      // The privacy rules and the owner rules are read once for the project.
      expect(
        reads["IncidentPrivacyRuleEngineService.getEnabledRules"]!.mock.calls,
      ).toHaveLength(1);
      expect(
        reads["IncidentOwnerRuleEngineService.getEnabledRules"]!.mock.calls,
      ).toHaveLength(1);
    });

    test("a reader who could not read the private incidents is told nothing they alone raise", async () => {
      world.incidentPrivacyRules = [privacyRule()];

      const answer: SetupHealthAnswer = await SetupHealthService.getForCaller({
        projectId: PROJECT_ID,
        props: CALLER,
      });

      expect(checksOf(answer.findings)).not.toContain(
        SetupHealthCheck.PolicyReachesNobody,
      );
      // What is wrong besides is still theirs, and every chain was looked at.
      expect(checksOf(answer.findings)).toContain(
        SetupHealthCheck.PolicyNotRun,
      );
      expect(checksOf(answer.findings)).toContain(SetupHealthCheck.OneOwner);
      expect(answer.monitorCount).toBe(world.monitorCount + 1);
    });

    test("a Project Admin, who reads every private record, is told it", async () => {
      world.incidentPrivacyRules = [privacyRule()];

      expect(affected(await reachesNobody(asAdmin()))).toHaveLength(
        world.monitorCount + 1,
      );
    });

    test("so is an owner of the private incidents, whom an owner rule adds; the owner rules are read once, for them", async () => {
      world.incidentPrivacyRules = [privacyRule()];
      world.incidentOwnerRules = [ownerRule(ME)];
      world.projectMemberIds = [ME];

      expect(affected(await reachesNobody(CALLER))).toHaveLength(
        world.monitorCount + 1,
      );
      expect(
        reads["IncidentOwnerRuleEngineService.getEnabledRules"]!.mock.calls,
      ).toHaveLength(1);
    });

    test("somebody an owner rule names who is not in the project owns nothing, and reads nothing", async () => {
      world.incidentPrivacyRules = [privacyRule()];
      world.incidentOwnerRules = [ownerRule(ME)];
      world.projectMemberIds = [];

      expect(await reachesNobody(CALLER)).toBeUndefined();
    });

    test("a break a public incident raises too stays, affecting that incident's monitors alone", async () => {
      world.incidentPrivacyRules = [privacyRule("^Monitor 3$")];

      const finding: SetupHealthFinding | undefined =
        await reachesNobody(CALLER);

      expect(affected(finding)).toHaveLength(world.monitorCount);
      expect(affected(finding)).toContain(monitorId(0));
      expect(affected(finding)).not.toContain(monitorId(3));

      // Who may read the private one is told it affects that monitor too.
      expect(affected(await reachesNobody(asAdmin()))).toContain(monitorId(3));
    });

    test("the policy's own page says the same to the same reader", async () => {
      world.incidentPrivacyRules = [privacyRule()];

      const forRecord: (
        props: DatabaseCommonInteractionProps,
      ) => Promise<SetupHealthRecordAnswer> = async (
        props: DatabaseCommonInteractionProps,
      ): Promise<SetupHealthRecordAnswer> => {
        return await SetupHealthService.getForRecord({
          projectId: PROJECT_ID,
          props: props,
          record: { kind: SetupHealthRecordKind.OnCallDutyPolicy, id: PRIMARY },
        });
      };

      expect((await forRecord(CALLER)).findings).toEqual([]);
      expect(checksOf((await forRecord(asAdmin())).findings)).toEqual([
        SetupHealthCheck.PolicyReachesNobody,
      ]);
    });

    test("the project is read once: each reader is handed theirs from the same facts", async () => {
      world.incidentPrivacyRules = [privacyRule()];

      await reachesNobody(CALLER);
      await reachesNobody(asAdmin());

      expect(
        reads["IncidentPrivacyRuleEngineService.getEnabledRules"]!.mock.calls,
      ).toHaveLength(1);
      expect(
        reads["OnCallTestPageService.readFirstLevel"]!.mock.calls,
      ).toHaveLength(1);
    });
  });

  /*
   * WHO OWNS WHAT THE MONITORS OPEN (#9407, #9371): an alert on-call rule
   * can match on the alert's owners, and the owners no Created email reaches
   * are worth fixing. Their monitors open alerts, or incidents, naming
   * owners; the project's own monitors name nobody.
   */
  describe("owners", () => {
    const ALERT_SEVERITY: string = "68120000-1111-4000-8000-0000000000c9";
    const PAYMENTS: string = "68120000-1111-4000-8000-0000000000e5";
    const EMPTY_TEAM: string = "68120000-1111-4000-8000-0000000000e6";
    const ELSEWHERE_TEAM: string = "68120000-1111-4000-8000-0000000000e7";
    const CARA: string = "68120000-1111-4000-8000-0000000000d4";
    const DAN: string = "68120000-1111-4000-8000-0000000000d5";
    const DEVICE: string = "68120000-1111-4000-8000-0000000000e8";
    const OWNER_CONDITION_RULE: string = "68120000-1111-4000-8000-0000000000b4";
    const OWNER_RULE: string = "68120000-1111-4000-8000-0000000000b5";

    function ownedMonitor(data: {
      id: string;
      name: string;
      opens: "incident" | "alert";
      ownerUserIds?: Array<string>;
      ownerTeamIds?: Array<string>;
      networkDeviceId?: string | undefined;
    }): Monitor {
      const item: Monitor = monitor({ id: data.id, name: data.name });
      const template: Record<string, unknown> = {
        id: `${data.opens}-template`,
        title: `${data.name} is down`,
        description: "",
        ownerUserIds: (data.ownerUserIds || []).map((id: string) => {
          return new ObjectID(id);
        }),
        ownerTeamIds: (data.ownerTeamIds || []).map((id: string) => {
          return new ObjectID(id);
        }),
      };
      const criteria: MonitorCriteriaInstance = {
        data: {
          id: "offline",
          name: "Offline",
          filterCondition: "All",
          filters: [],
          description: "",
          changeMonitorStatus: false,
          createIncidents: data.opens === "incident",
          createAlerts: data.opens === "alert",
          incidents:
            data.opens === "incident"
              ? [{ ...template, incidentSeverityId: new ObjectID(CRITICAL) }]
              : [],
          alerts:
            data.opens === "alert"
              ? [{ ...template, alertSeverityId: new ObjectID(ALERT_SEVERITY) }]
              : [],
        },
      } as unknown as MonitorCriteriaInstance;

      item.monitorSteps = {
        data: {
          monitorStepsInstanceArray: [
            {
              data: {
                ...(data.networkDeviceId
                  ? {
                      networkDeviceMonitor: {
                        networkDeviceId: data.networkDeviceId,
                      },
                    }
                  : {}),
                monitorCriteria: {
                  data: { monitorCriteriaInstanceArray: [criteria] },
                },
              },
            },
          ],
        },
      } as unknown as MonitorSteps;

      return item;
    }

    function extraId(index: number): string {
      return `68120000-3333-4000-8000-${index.toString().padStart(12, "0")}`;
    }

    // "Alert Owner is any of" (or "is none of") Payments: pages Secondary.
    function ownerConditionRule(
      operator: RuleCriteriaOperator,
    ): AlertOnCallRule {
      const rule: AlertOnCallRule = withId(
        new AlertOnCallRule(),
        OWNER_CONDITION_RULE,
      );
      rule.name = "Payments' alerts";
      rule.criteria = {
        schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
        filterCondition: FilterCondition.All,
        filters: [
          { field: "alertOwners", operator: operator, value: [PAYMENTS] },
        ],
      };
      rule.onCallDutyPolicies = [withId(new OnCallDutyPolicy(), SECONDARY)];
      return rule;
    }

    function pagesNobodyFor(
      findings: Array<SetupHealthFinding>,
    ): Array<string> {
      return findings
        .filter((finding: SetupHealthFinding): boolean => {
          return (
            finding.check === SetupHealthCheck.MonitorPagesNobody ||
            finding.check === SetupHealthCheck.MonitorAlertsPageNobody
          );
        })
        .map((finding: SetupHealthFinding): string => {
          return finding.record.name;
        })
        .sort();
    }

    beforeEach(() => {
      world.projectMemberIds = [ANA, BEN];
      world.projectTeams = {
        [PAYMENTS]: "Payments",
        [EMPTY_TEAM]: "Night shift",
      };
      world.teamMemberIds = { [PAYMENTS]: [ANA], [EMPTY_TEAM]: [] };
    });

    test("a project with no owner condition, whose monitors name nobody, reads nobody's owners", async () => {
      const ownerRows: SpyInstance<typeof WorkspaceRecordOwners.getOwnerIds> =
        jest.spyOn(WorkspaceRecordOwners, "getOwnerIds");

      const computed: Awaited<
        ReturnType<typeof SetupHealthService.getProjectFindings>
      > = await SetupHealthService.getProjectFindings({
        projectId: PROJECT_ID,
        refresh: true,
      });

      expect(
        reads["TeamMemberService.getProjectMemberUserIds"]!.mock.calls,
      ).toHaveLength(0);
      expect(reads["TeamService.findBy"]!.mock.calls).toHaveLength(0);
      expect(
        reads["NetworkDeviceOwnerUserService.getDeviceOwnersForDevices"]!.mock
          .calls,
      ).toHaveLength(0);
      expect(
        reads["NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor"]!.mock
          .calls,
      ).toHaveLength(0);
      expect(ownerRows).not.toHaveBeenCalled();
      expect(
        computed.findings.filter((finding: SetupHealthFinding): boolean => {
          return finding.check === SetupHealthCheck.OwnerNotEmailed;
        }),
      ).toEqual([]);
    });

    describe("an alert on-call rule with an Alert Owner condition (#9407)", () => {
      beforeEach(() => {
        world.extraMonitors = [
          ownedMonitor({
            id: extraId(1),
            name: "Payments API",
            opens: "alert",
            ownerTeamIds: [PAYMENTS],
          }),
          ownedMonitor({ id: extraId(2), name: "Search API", opens: "alert" }),
        ];
      });

      test("is any of Payments: Payments' alerts page, the others page nobody - as their cards say", async () => {
        world.alertRules = [ownerConditionRule(RuleCriteriaOperator.HasAnyOf)];

        const computed: Awaited<
          ReturnType<typeof SetupHealthService.getProjectFindings>
        > = await SetupHealthService.getProjectFindings({
          projectId: PROJECT_ID,
          refresh: true,
        });

        expect(pagesNobodyFor(computed.findings)).toEqual(["Search API"]);
      });

      test("is none of Payments: Payments' alerts page nobody, the others page", async () => {
        world.alertRules = [ownerConditionRule(RuleCriteriaOperator.HasNoneOf)];

        const computed: Awaited<
          ReturnType<typeof SetupHealthService.getProjectFindings>
        > = await SetupHealthService.getProjectFindings({
          projectId: PROJECT_ID,
          refresh: true,
        });

        expect(pagesNobodyFor(computed.findings)).toEqual(["Payments API"]);
      });

      test("the owners of two hundred monitors cost the reads of ten: one of each kind for the whole project", async () => {
        world.alertRules = [ownerConditionRule(RuleCriteriaOperator.HasAnyOf)];
        world.alertOwnerRules = [];

        const project: (count: number) => Array<Monitor> = (
          count: number,
        ): Array<Monitor> => {
          const monitors: Array<Monitor> = [];

          for (let index: number = 0; index < count; index++) {
            monitors.push(
              ownedMonitor({
                id: extraId(100 + index),
                name: `Owned ${index}`,
                opens: index % 2 === 0 ? "alert" : "incident",
                ownerTeamIds: [index % 3 === 0 ? PAYMENTS : EMPTY_TEAM],
                ownerUserIds: [index % 2 === 0 ? CARA : ANA],
                networkDeviceId: index % 5 === 0 ? DEVICE : undefined,
              }),
            );
          }

          return monitors;
        };

        world.deviceOwnerUserIds = { [DEVICE]: [DAN] };
        world.extraMonitors = project(10);
        await SetupHealthService.getProjectFindings({
          projectId: PROJECT_ID,
          refresh: true,
        });
        const ten: Record<string, number> = readCounts();

        jest.restoreAllMocks();
        SetupHealthService.clearCache();
        stubWorld();
        world.extraMonitors = project(200);
        await SetupHealthService.getProjectFindings({
          projectId: PROJECT_ID,
          refresh: true,
        });
        const twoHundred: Record<string, number> = readCounts();

        expect(twoHundred).toEqual(ten);
        expect(twoHundred["TeamService.findBy"]).toBe(1);
        expect(twoHundred["TeamMemberService.getProjectMemberUserIds"]).toBe(1);
        expect(
          twoHundred["NetworkDeviceOwnerUserService.getDeviceOwnersForDevices"],
        ).toBe(1);
        expect(
          twoHundred["NetworkDeviceOwnerUserService.getDeviceOwnersForMonitor"],
        ).toBe(0);
      });
    });

    /*
     * THE OWNERS NO CREATED EMAIL REACHES (#9371), as each monitor's card
     * says them (WhoIsToldOwners.notReached): Night shift, a team of the
     * project with nobody in it; Cara, who left; a team of another
     * project; Dan, who owns a network device and whom an owner rule adds.
     */
    describe("the owners no Created email reaches (#9371)", () => {
      function ownerRule(): IncidentOwnerRule {
        const rule: IncidentOwnerRule = withId(
          new IncidentOwnerRule(),
          OWNER_RULE,
        );
        rule.name = "Checkout routes";
        rule.projectId = PROJECT_ID;
        rule.isEnabled = true;
        rule.notifyOwners = true;
        rule.monitors = [];
        rule.incidentSeverities = [];
        rule.incidentLabels = [];
        rule.monitorLabels = [];
        rule.incidentTitlePattern = "^Checkout";
        rule.ownerUsers = [withId(new User(), DAN)];
        rule.ownerTeams = [];
        return rule;
      }

      beforeEach(() => {
        world.deviceOwnerUserIds = { [DEVICE]: [DAN] };
        world.incidentOwnerRules = [ownerRule()];
        world.extraMonitors = [
          ownedMonitor({
            id: extraId(1),
            name: "Checkout API",
            opens: "incident",
            ownerTeamIds: [EMPTY_TEAM, PAYMENTS],
            ownerUserIds: [CARA, ANA],
          }),
          ownedMonitor({
            id: extraId(2),
            name: "Checkout Web",
            opens: "alert",
            ownerTeamIds: [ELSEWHERE_TEAM, EMPTY_TEAM],
          }),
          ownedMonitor({
            id: extraId(3),
            name: "Core switch",
            opens: "incident",
            networkDeviceId: DEVICE,
          }),
        ];

        // The cards read the monitors one at a time, and show no status page.
        jest
          .spyOn(MonitorService, "findOneBy")
          .mockImplementation((async (args: { query: { _id?: string } }) => {
            return (
              projectMonitors().find((item: Monitor): boolean => {
                return item.id!.toString() === args.query._id;
              }) || null
            );
          }) as never);
        jest.spyOn(MonitorService, "findOwners").mockResolvedValue([]);
        jest
          .spyOn(IncidentStatusPageScope, "resolvePagesForDraftIncident")
          .mockResolvedValue({
            statusPages: [],
            statusPageToResources: {},
            isScoped: false,
            excludedStatusPages: [],
          });
        WhoIsToldService.clearCache();
      });

      afterEach(() => {
        WhoIsToldService.clearCache();
      });

      // An owner as the card says it, keyed as Setup health would list it.
      function keyOfCardOwner(data: {
        monitorId: string;
        event: CardEvent;
        owner: WhoIsToldOwnerNotReached;
      }): string {
        const { monitorId, owner } = data;
        const isPerson: boolean =
          owner.problem === WhoIsToldOwnerProblem.NotInProject;

        if (owner.problem === WhoIsToldOwnerProblem.TeamHasNobodyInProject) {
          return `${SetupHealthOwnerSubject.TeamHasNobody}|${owner.id}|${monitorId}`;
        }

        if (owner.addedBy === WhoIsToldOwnerAddedBy.OwnerRule) {
          const kind: string =
            data.event.kind === OnCallTestPageRecordKind.Alert
              ? SetupHealthRecordKind.AlertOwnerRule
              : SetupHealthRecordKind.IncidentOwnerRule;

          return `${
            isPerson
              ? SetupHealthOwnerSubject.OwnerRuleNotInProject
              : SetupHealthOwnerSubject.OwnerRuleTeamOfAnotherProject
          }|${kind}:${owner.rule?.id}|${monitorId}`;
        }

        if (owner.addedBy === WhoIsToldOwnerAddedBy.NetworkDevice) {
          return `${
            isPerson
              ? SetupHealthOwnerSubject.NetworkDeviceNotInProject
              : SetupHealthOwnerSubject.NetworkDeviceTeamOfAnotherProject
          }|${monitorId}|${monitorId}`;
        }

        return `${
          isPerson
            ? SetupHealthOwnerSubject.CriteriaNotInProject
            : SetupHealthOwnerSubject.CriteriaTeamOfAnotherProject
        }|${monitorId}|${monitorId}`;
      }

      // Each owner finding, once per monitor it concerns.
      function keysOfFindings(
        findings: Array<SetupHealthFinding>,
      ): Array<string> {
        const keys: Array<string> = [];

        for (const finding of findings) {
          if (finding.check !== SetupHealthCheck.OwnerNotEmailed) {
            continue;
          }

          if (finding.record.kind === SetupHealthRecordKind.Monitor) {
            keys.push(
              `${finding.subject}|${finding.record.id}|${finding.record.id}`,
            );
            continue;
          }

          const recordId: string =
            finding.record.kind === SetupHealthRecordKind.Team
              ? finding.record.id
              : `${finding.record.kind}:${finding.record.id}`;

          for (const related of finding.related) {
            keys.push(`${finding.subject}|${recordId}|${related.id}`);
          }
        }

        return Array.from(new Set(keys)).sort();
      }

      async function keysOfCards(): Promise<Array<string>> {
        const keys: Set<string> = new Set<string>();

        for (const item of projectMonitors()) {
          if (
            item.isArchived ||
            item.disableActiveMonitoring ||
            item.monitorType === MonitorType.Manual
          ) {
            continue;
          }

          const card: WhoIsToldResult = await WhoIsToldService.resolve({
            projectId: PROJECT_ID,
            monitorId: item.id!,
            refresh: true,
          });

          for (const criteria of card.criteria) {
            for (const event of criteria.events) {
              for (const owner of event.owners.notReached || []) {
                keys.add(
                  keyOfCardOwner({
                    monitorId: card.monitorId,
                    event: event,
                    owner: owner,
                  }),
                );
              }
            }
          }
        }

        return Array.from(keys).sort();
      }

      test("each is listed as the cards say it, and nothing the cards don't say", async () => {
        const computed: Awaited<
          ReturnType<typeof SetupHealthService.getProjectFindings>
        > = await SetupHealthService.getProjectFindings({
          projectId: PROJECT_ID,
          refresh: true,
        });

        const listed: Array<string> = keysOfFindings(computed.findings);

        expect(listed.length).toBeGreaterThan(4);
        expect(listed).toEqual(await keysOfCards());
      });

      test("each finding is worth fixing, about what puts it right", async () => {
        const findings: Array<SetupHealthFinding> = (
          await SetupHealthService.getProjectFindings({
            projectId: PROJECT_ID,
            refresh: true,
          })
        ).findings.filter((finding: SetupHealthFinding): boolean => {
          return finding.check === SetupHealthCheck.OwnerNotEmailed;
        });

        expect(
          findings
            .map((finding: SetupHealthFinding): string => {
              return `${finding.level} ${finding.subject} ${finding.record.kind} ${finding.fix}`;
            })
            .sort(),
        ).toEqual(
          [
            `${SetupHealthLevel.WorthFixing} ${SetupHealthOwnerSubject.TeamHasNobody} ${SetupHealthRecordKind.Team} TeamMembers`,
            `${SetupHealthLevel.WorthFixing} ${SetupHealthOwnerSubject.CriteriaNotInProject} ${SetupHealthRecordKind.Monitor} MonitorCriteria`,
            `${SetupHealthLevel.WorthFixing} ${SetupHealthOwnerSubject.CriteriaTeamOfAnotherProject} ${SetupHealthRecordKind.Monitor} MonitorCriteria`,
            `${SetupHealthLevel.WorthFixing} ${SetupHealthOwnerSubject.NetworkDeviceNotInProject} ${SetupHealthRecordKind.Monitor} NetworkDeviceOwners`,
            `${SetupHealthLevel.WorthFixing} ${SetupHealthOwnerSubject.OwnerRuleNotInProject} ${SetupHealthRecordKind.IncidentOwnerRule} IncidentOwnerRules`,
          ].sort(),
        );

        const team: SetupHealthFinding = findings.find(
          (finding: SetupHealthFinding): boolean => {
            return finding.record.kind === SetupHealthRecordKind.Team;
          },
        )!;

        // Night shift, named by two monitors' records, is one finding about the team.
        expect(team.record).toEqual({
          kind: SetupHealthRecordKind.Team,
          id: EMPTY_TEAM,
          name: "Night shift",
        });
        expect(
          team.related.map((record: { id: string }): string => {
            return record.id;
          }),
        ).toEqual([extraId(1), extraId(2)]);
        expect(team.fixRecordId).toBe(EMPTY_TEAM);
      });

      test("a reader of a private record they can't see is told nothing of its owners; one who may read it is", async () => {
        // Checkout API's incidents are private.
        const privacy: IncidentPrivacyRule = withId(
          new IncidentPrivacyRule(),
          "68120000-1111-4000-8000-0000000000b9",
        );
        privacy.name = "Checkout API is private";
        privacy.projectId = PROJECT_ID;
        privacy.monitorNamePattern = "^Checkout API$";
        world.incidentPrivacyRules = [privacy];

        const asSeenBy: (
          props: DatabaseCommonInteractionProps,
        ) => Promise<Array<SetupHealthFinding>> = async (
          props: DatabaseCommonInteractionProps,
        ): Promise<Array<SetupHealthFinding>> => {
          return (
            await SetupHealthService.getForCaller({
              projectId: PROJECT_ID,
              props: props,
            })
          ).findings.filter((finding: SetupHealthFinding): boolean => {
            return finding.check === SetupHealthCheck.OwnerNotEmailed;
          });
        };

        const caller: Array<SetupHealthFinding> = await asSeenBy(CALLER);

        // Cara and the incident's owner rule's Dan were said of Checkout API alone.
        expect(
          caller.map((finding: SetupHealthFinding): string => {
            return finding.subject;
          }),
        ).not.toContain(SetupHealthOwnerSubject.CriteriaNotInProject);
        // Night shift is still named by Checkout Web's alert, a public one.
        expect(
          caller
            .find((finding: SetupHealthFinding): boolean => {
              return finding.record.kind === SetupHealthRecordKind.Team;
            })
            ?.related.map((record: { id: string }): string => {
              return record.id;
            }),
        ).toEqual([extraId(2)]);
        expect(JSON.stringify(caller)).not.toContain(extraId(1));

        const admin: Array<SetupHealthFinding> = await asSeenBy({
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
        });

        expect(
          admin.map((finding: SetupHealthFinding): string => {
            return finding.subject;
          }),
        ).toContain(SetupHealthOwnerSubject.CriteriaNotInProject);
      });

      test("a team or an owner rule the reader may not read is not shown to them", async () => {
        world.callerTeams = "none";
        world.callerOwnerRules = "none";

        const findings: Array<SetupHealthFinding> = (
          await SetupHealthService.getForCaller({
            projectId: PROJECT_ID,
            props: CALLER,
          })
        ).findings.filter((finding: SetupHealthFinding): boolean => {
          return finding.check === SetupHealthCheck.OwnerNotEmailed;
        });

        expect(
          findings.map((finding: SetupHealthFinding): string => {
            return finding.record.kind;
          }),
        ).not.toContain(SetupHealthRecordKind.Team);
        expect(
          findings.map((finding: SetupHealthFinding): string => {
            return finding.record.kind;
          }),
        ).not.toContain(SetupHealthRecordKind.IncidentOwnerRule);
        // A monitor's own still is.
        expect(findings.length).toBeGreaterThan(0);
      });
    });
  });

  test("reads only: nothing is created, updated or deleted", async () => {
    const writes: Array<unknown> = [
      jest.spyOn(MonitorService, "updateOneById"),
      jest.spyOn(OnCallDutyPolicyService, "updateOneById"),
      jest.spyOn(RecommendationDismissalService, "create"),
      jest.spyOn(RecommendationDismissalService, "deleteBy"),
    ];

    await SetupHealthService.getForCaller({
      projectId: PROJECT_ID,
      props: CALLER,
      refresh: true,
    });

    for (const write of writes) {
      expect((write as { mock: { calls: Array<unknown> } }).mock.calls).toEqual(
        [],
      );
    }
  });
});

describe("the service's pure helpers", () => {
  test("a responder's reason, from Readiness's own sentences", () => {
    expect(
      toResponderFact(
        readinessUser(
          CARL,
          "Carl Diaz",
          ReadinessStatus.NotReachable,
          [],
          [...NOT_A_PROJECT_MEMBER_READINESS_REASONS],
        ),
      ),
    ).toEqual({
      userId: CARL,
      name: "Carl Diaz",
      isNotReachable: true,
      reason: SetupHealthResponderReason.NotAMember,
    });

    expect(
      toResponderFact(
        readinessUser(
          CARL,
          "Carl Diaz",
          ReadinessStatus.NotReachable,
          [],
          [...INVITATION_NOT_ACCEPTED_READINESS_REASONS],
        ),
      ).reason,
    ).toBe(SetupHealthResponderReason.InvitationNotAccepted);

    expect(
      toResponderFact(
        readinessUser(
          CARL,
          "",
          ReadinessStatus.NotReachable,
          [],
          ["No verified notification methods"],
        ),
      ),
    ).toEqual({
      // With no name, the login email they are known by.
      userId: CARL,
      name: "@example.com",
      isNotReachable: true,
      reason: SetupHealthResponderReason.NoVerifiedMethod,
    });

    expect(
      toResponderFact(
        readinessUser(ANA, "Ana", ReadinessStatus.PartiallyReady, ["SMS"]),
      ).isNotReachable,
    ).toBe(false);
  });

  test("a responder missing the phone method their project asks for, as Readiness answers it (#7449)", () => {
    const missing: UserReadiness = readinessUser(
      ANA,
      "Ana",
      ReadinessStatus.Ready,
      ["Email"],
    );
    missing.isMissingPhoneMethod = true;

    expect(toResponderFact(missing)).toEqual({
      userId: ANA,
      name: "Ana",
      isNotReachable: false,
      reason: SetupHealthResponderReason.NoVerifiedMethod,
      isMissingPhoneMethod: true,
    });

    // Readiness's answer is read, never worked out again: no flag, no finding.
    const asked: UserReadiness = readinessUser(
      ANA,
      "Ana",
      ReadinessStatus.Ready,
      ["Email"],
    );

    expect("isMissingPhoneMethod" in toResponderFact(asked)).toBe(false);
  });

  test("why nobody is on call in a schedule, from its coverage", () => {
    const shift: OnCallShift = {
      userId: ANA,
      start: new Date("2026-11-12T00:00:00.000Z"),
      end: new Date("2026-11-13T00:00:00.000Z"),
      coverageSeconds: 86400,
    };

    const coverage: (
      status: ScheduleCoverageStatus,
      gaps: Array<{ start: Date; end: Date }>,
    ) => Parameters<typeof getScheduleReason>[0]["coverage"] = (
      status: ScheduleCoverageStatus,
      gaps: Array<{ start: Date; end: Date }>,
    ): Parameters<typeof getScheduleReason>[0]["coverage"] => {
      return {
        status: status,
        current: shift,
        next: null,
        gaps: gaps,
        uncoveredSeconds: 0,
        coverageRatio: 1,
      };
    };

    expect(
      getScheduleReason({
        coverage: coverage(ScheduleCoverageStatus.NoLayers, []),
        isTruncated: false,
      }).reason,
    ).toBe(SetupHealthScheduleReason.NoRotations);
    expect(
      getScheduleReason({
        coverage: coverage(ScheduleCoverageStatus.NoUsers, []),
        isTruncated: false,
      }).reason,
    ).toBe(SetupHealthScheduleReason.NobodyInRotations);
    expect(
      getScheduleReason({
        coverage: coverage(ScheduleCoverageStatus.UncoveredNow, []),
        isTruncated: false,
      }).reason,
    ).toBe(SetupHealthScheduleReason.NobodyNow);
    expect(
      getScheduleReason({
        coverage: coverage(ScheduleCoverageStatus.Covered, []),
        isTruncated: false,
      }),
    ).toEqual({ reason: null, gapStartsAt: null });

    const gap: { start: Date; end: Date } = {
      start: new Date("2026-11-14T03:00:00.000Z"),
      end: new Date("2026-11-14T05:00:00.000Z"),
    };

    expect(
      getScheduleReason({
        coverage: coverage(ScheduleCoverageStatus.Covered, [gap]),
        isTruncated: false,
      }),
    ).toEqual({
      reason: SetupHealthScheduleReason.GapAhead,
      gapStartsAt: "2026-11-14T03:00:00.000Z",
    });
    // A truncated expansion would show gaps that are not there.
    expect(
      getScheduleReason({
        coverage: coverage(ScheduleCoverageStatus.Covered, [gap]),
        isTruncated: true,
      }).reason,
    ).toBeNull();
  });

  test("the levels the counts are made of", () => {
    expect(Object.values(SetupHealthLevel)).toHaveLength(3);
  });
});
