import AlertEpisodeOnCallRule from "../../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
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
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
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
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPagePreviewPerson } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
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
  SetupHealthCheck,
  SetupHealthFinding,
  SetupHealthLevel,
  SetupHealthRecordKind,
  SetupHealthResponderReason,
  SetupHealthScheduleReason,
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
  dismissals: Array<RecommendationDismissal>;
  statusPagesFail: boolean;
  serverEmail: ServerSendingState;
}

let world: World;

function defaultWorld(): World {
  return {
    monitorCount: 10,
    callerMonitors: "all",
    callerPolicies: "all",
    dismissals: [],
    statusPagesFail: false,
    serverEmail: ServerSendingState.NotSetUp,
  };
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
  );

  return monitors;
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
      return count(0);
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
      return [];
    },
  );

  spy(
    "OnCallTestPageService.readFirstLevel",
    OnCallTestPageService,
    "readFirstLevel",
    async () => {
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
      return [];
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
      domain.isCnameVerified = false;
      domain.createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      return [domain];
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
    async (): Promise<Array<TeamMember>> => {
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
      return [
        {
          milestone: ActivationMilestone.FirstLogsReceived,
          reachedAt: new Date(),
          wasBackfilled: false,
        },
      ];
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
    expect(thousand["MonitorService.findOneById"]).toBe(0);
    // Every responder's verified methods come from the project's Readiness.
    expect(thousand["OnCallReadinessService.getReadinessForUsers"]).toBe(0);

    const total: number = Object.values(thousand).reduce(
      (sum: number, value: number): number => {
        return sum + value;
      },
      0,
    );

    expect(total).toBeLessThan(40);
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
