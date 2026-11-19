import Alert from "Common/Models/DatabaseModels/Alert";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationFeedStatus,
  OwnerNotificationKind,
} from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import {
  InMemoryOwnerNotificationDeliveries,
  useInMemoryOwnerNotificationDeliveries,
  usersNamedBy,
} from "Common/Tests/Helpers/InMemoryOwnerNotificationDeliveries";
import {
  InMemoryOnCallPages,
  PageNotification,
  useInMemoryOnCallPages,
} from "Common/Tests/Helpers/InMemoryOnCallPages";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EVERY OWNER NOTIFICATION JOB TELLS EACH OWNER ONCE, WHEREVER ITS WORKER
 * STOPS, AND WRITES THE FEED ITEM NAMING WHOM IT REACHED (issues #8199,
 * #8509, #8510).
 *
 * The ten jobs of incidents and alerts - Created, state changed, note
 * posted, owner added and still-open reminder - and the 23 of episodes,
 * monitors, scheduled maintenance events, status pages, SLOs and network
 * devices, and the owner-added jobs of probes, AI agents, Data
 * Observability's tables, pipelines and data stores (#9681), and the 23
 * records whose owner rules told nobody until #9700 - services, hosts,
 * clusters, dashboards, on-call policies and the rest - each take
 * (mark) the record
 * they tell of before they tell its owners. Every one reads what it has to
 * tell a page at a time and takes each record by one hook-free
 * compare-and-set (OwnerNotificationBacklog, #7974, #8862) - a reminder job
 * moves the reminder on with it (OwnerReminderBacklog, #9019): its services
 * answer that read and that take here. A worker stopped hard in between
 * (an out-of-memory kill, a node lost) used to leave every owner not reached
 * yet untold for good. Now each writes whom it is about to tell before the
 * take, tells each owner through a claim only one run can win, and starts
 * every run with the owners a stopped run left (OwnerNotificationDeliveries).
 *
 * Here each real job runs, tick by tick, with the services it reads and
 * writes standing in for the database - the record is due until the job
 * takes it, as the job's own read would answer - and the delivery table held
 * in memory as Postgres answers its statements
 * (InMemoryOwnerNotificationDeliveries; OwnerNotificationDeliveryPostgres
 * and App's OwnerNotificationJobsPostgres run them on Postgres). A worker is
 * stopped where a test says, as a kill would stop it: the statement or the
 * send there never answers, so nothing after it in that run happens. The
 * worker is then started again - the next run, minutes later - on the same
 * rows. Every case runs for every job:
 *
 *   - before an owner's send, during it, after it and before it was
 *     recorded, after it was recorded, after the last owner;
 *   - before the take, while the owners are written down;
 *   - two workers at once, and a worker that lost its lock going on beside
 *     the next run;
 *   - a worker stopped every time it sets out, a send that fails, a record
 *     gone before the next run.
 */

type CronHandler = (deadline?: JobDeadline) => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// A pre-existing TS5.9 diagnostic in PasswordHash fails any suite that loads it.
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findCreatedNotificationsDue: jest.fn(),
      takeCreatedNotification: jest.fn(),
      findOwners: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
      getIncidentIdentifiedDate: jest.fn(),
      updateOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      onTriggerWorkflow: jest.fn(),
      isIncidentResolved: jest.fn(),
      isIncidentAcknowledged: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findCreatedNotificationsDue: jest.fn(),
      takeCreatedNotification: jest.fn(),
      findOwners: jest.fn(),
      getAlertLinkInDashboard: jest.fn(),
      getAlertIdentifiedDate: jest.fn(),
      countBy: jest.fn(),
      updateOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      onTriggerWorkflow: jest.fn(),
      isAlertResolved: jest.fn(),
      isAlertAcknowledged: jest.fn(),
    },
  };
});

function mockRecordService(): unknown {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
}

// A service with every read and write the owner jobs of the other resources make.
function mockAnyService(): unknown {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      findBy: jest.fn(),
      findOneById: jest.fn(),
      findOneBy: jest.fn(),
      updateOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      onTriggerWorkflow: jest.fn(),
      findOwners: jest.fn(),
      getEpisodeLinkInDashboard: jest.fn(),
      getMonitorLinkInDashboard: jest.fn(),
      getMonitorDestinationInfo: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
      getStatusPageLinkInDashboard: jest.fn(),
      getSloLinkInDashboard: jest.fn(),
      getLinkInDashboard: jest.fn(),
      getDataAssetLinkInDashboard: jest.fn(),
      getDataPipelineLinkInDashboard: jest.fn(),
      getDataStoreLinkInDashboard: jest.fn(),
      getDataObservabilityDatabaseLinkInDashboard: jest.fn(),
      getServiceLinkInDashboard: jest.fn(),
      getDatabaseServerLinkInDashboard: jest.fn(),
      getMessageQueueLinkInDashboard: jest.fn(),
      getHostLinkInDashboard: jest.fn(),
      getKubernetesClusterLinkInDashboard: jest.fn(),
      getDockerHostLinkInDashboard: jest.fn(),
      getDockerSwarmClusterLinkInDashboard: jest.fn(),
      getPodmanHostLinkInDashboard: jest.fn(),
      getProxmoxClusterLinkInDashboard: jest.fn(),
      getOpenStackCloudLinkInDashboard: jest.fn(),
      getVMwareVCenterLinkInDashboard: jest.fn(),
      getCephClusterLinkInDashboard: jest.fn(),
      getStorageArrayLinkInDashboard: jest.fn(),
      getOnCallDutyPolicyLinkInDashboard: jest.fn(),
      isScheduledMaintenanceCompleted: jest.fn(),
      isScheduledMaintenanceOngoing: jest.fn(),
      findMatchingRule: jest.fn(),
      createIncidentEpisodeFeedItem: jest.fn(),
      createAlertEpisodeFeedItem: jest.fn(),
      createScheduledMaintenanceFeedItem: jest.fn(),
    },
  };
}

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeStateTimelineService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeInternalNoteService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeMemberService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentEpisodeFeedService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeStateTimelineService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeInternalNoteService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeMemberService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AlertEpisodeFeedService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorStatusTimelineService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MonitorOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceStateTimelineService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/ScheduledMaintenanceStateService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenancePublicNoteService",
  () => {
    return mockAnyService();
  },
);
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceInternalNoteService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerUserService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceReminderRuleService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/ScheduledMaintenanceFeedService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageAnnouncementService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StatusPageOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ServiceLevelObjectiveService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService",
  () => {
    return mockAnyService();
  },
);
jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveOwnerUserService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/NetworkDeviceOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/NetworkDeviceOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ProbeService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ProbeOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ProbeOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AIAgentService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AIAgentOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/AIAgentOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataAssetService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataAssetOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataAssetOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataPipelineService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataPipelineOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataPipelineOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataStoreService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataStoreOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DataStoreOwnerUserService", () => {
  return mockAnyService();
});
// The records whose owner rules told nobody until #9700.
jest.mock("Common/Server/Services/ServiceService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ServiceOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ServiceOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DatabaseServerService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DatabaseServerOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DatabaseServerOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MessageQueueService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MessageQueueOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/MessageQueueOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/RumApplicationService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/RumApplicationOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/RumApplicationOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/HostService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/HostOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/HostOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/KubernetesClusterService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/KubernetesClusterOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/KubernetesClusterOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DockerHostService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DockerHostOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DockerHostOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DockerSwarmClusterService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DockerSwarmClusterOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DockerSwarmClusterOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/PodmanHostService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/PodmanHostOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/PodmanHostOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ProxmoxClusterService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ProxmoxClusterOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ProxmoxClusterOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/OpenStackCloudService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/OpenStackCloudOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/OpenStackCloudOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/VMwareVCenterService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/VMwareVCenterOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/VMwareVCenterOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/CephClusterService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/CephClusterOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/CephClusterOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StorageArrayService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StorageArrayOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/StorageArrayOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IoTFleetService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IoTFleetOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IoTFleetOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/CloudResourceService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/CloudResourceOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/CloudResourceOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ServerlessFunctionService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ServerlessFunctionOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/ServerlessFunctionOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DashboardService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DashboardOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/DashboardOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/WorkflowService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/WorkflowOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/WorkflowOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/RunbookService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/RunbookOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/RunbookOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/OnCallDutyPolicyService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/OnCallDutyPolicyOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/OnCallDutyPolicyOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/OnCallDutyPolicyScheduleService", () => {
  return mockAnyService();
});
jest.mock(
  "Common/Server/Services/OnCallDutyPolicyScheduleOwnerTeamService",
  () => {
    return mockAnyService();
  },
);
jest.mock(
  "Common/Server/Services/OnCallDutyPolicyScheduleOwnerUserService",
  () => {
    return mockAnyService();
  },
);
jest.mock("Common/Server/Services/IncomingCallPolicyService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncomingCallPolicyOwnerTeamService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncomingCallPolicyOwnerUserService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentMemberService", () => {
  return mockAnyService();
});
jest.mock("Common/Server/Services/IncidentRoleService", () => {
  return mockAnyService();
});

// The network device job links to the dashboard it reads from the database.
jest.mock("Common/Server/DatabaseConfig", () => {
  const url: typeof import("Common/Types/API/URL").default = (
    jest.requireActual("Common/Types/API/URL") as {
      default: typeof import("Common/Types/API/URL").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      getDashboardUrl: jest.fn(async () => {
        return url.fromString("https://oneuptime.test");
      }),
    },
  };
});

jest.mock("Common/Server/Services/IncidentStateTimelineService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertStateTimelineService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentStateService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertStateService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentPublicNoteService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentInternalNoteService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertInternalNoteService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentOwnerTeamService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/IncidentOwnerUserService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertOwnerTeamService", () => {
  return mockRecordService();
});
jest.mock("Common/Server/Services/AlertOwnerUserService", () => {
  return mockRecordService();
});

jest.mock("Common/Server/Services/IncidentReminderRuleService", () => {
  return {
    __esModule: true,
    default: { findMatchingRule: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertReminderRuleService", () => {
  return {
    __esModule: true,
    default: { findMatchingRule: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      getUsersInTeams: jest.fn(),
      filterUsersToProjectMembers: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getOwners: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      getUserMarkdownString: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      sendUserNotification: jest.fn(),
      ensureSettingExistsForUser: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return {
    __esModule: true,
    default: { createIncidentFeedItem: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertFeedService", () => {
  return {
    __esModule: true,
    default: { createAlertFeedItem: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Utils/AffectedResources/LinkedAffectedResources",
  () => {
    return {
      __esModule: true,
      default: {
        readForIncident: jest.fn(async () => {
          return [];
        }),
        readForAlert: jest.fn(async () => {
          return [];
        }),
        readForScheduledMaintenance: jest.fn(async () => {
          return [];
        }),
        getText: jest.fn((data: { fallback: string }) => {
          return data.fallback;
        }),
        getNames: jest.fn(() => {
          return [];
        }),
      },
    };
  },
);

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: {
      createIncidentCreatedNotification: jest.fn(() => {
        return {};
      }),
      createAlertCreatedNotification: jest.fn(() => {
        return {};
      }),
      createIncidentStateChangedNotification: jest.fn(() => {
        return {};
      }),
      createIncidentNotePostedNotification: jest.fn(() => {
        return {};
      }),
      createGenericNotification: jest.fn(() => {
        return {};
      }),
      createMonitorCreatedNotification: jest.fn(() => {
        return {};
      }),
      createMonitorStatusChangedNotification: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/WhatsAppTemplateUtil", () => {
  return {
    __esModule: true,
    createWhatsAppMessageFromTemplate: jest.fn(() => {
      return { templateVariables: {} };
    }),
  };
});

/*
 * The notifications on-call pages sent, which the Created jobs read to leave
 * out an owner the record's page reached already (#7987): held in memory
 * (InMemoryOnCallPages).
 */
jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

import AlertFeedService from "Common/Server/Services/AlertFeedService";
import AlertInternalNoteService from "Common/Server/Services/AlertInternalNoteService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertReminderRuleService from "Common/Server/Services/AlertReminderRuleService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateTimelineService from "Common/Server/Services/AlertStateTimelineService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "Common/Server/Services/IncidentInternalNoteService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentReminderRuleService from "Common/Server/Services/IncidentReminderRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import IncidentEpisodeInternalNoteService from "Common/Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeOwnerTeamService from "Common/Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "Common/Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "Common/Server/Services/AlertEpisodeStateTimelineService";
import AlertEpisodeInternalNoteService from "Common/Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertEpisodeOwnerTeamService from "Common/Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "Common/Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusTimelineService from "Common/Server/Services/MonitorStatusTimelineService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import MonitorOwnerTeamService from "Common/Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "Common/Server/Services/MonitorOwnerUserService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceStateService from "Common/Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceInternalNoteService from "Common/Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceReminderRuleService from "Common/Server/Services/ScheduledMaintenanceReminderRuleService";
import ScheduledMaintenanceFeedService from "Common/Server/Services/ScheduledMaintenanceFeedService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageAnnouncementService from "Common/Server/Services/StatusPageAnnouncementService";
import StatusPageOwnerTeamService from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "Common/Server/Services/StatusPageOwnerUserService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveOwnerTeamService from "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "Common/Server/Services/ServiceLevelObjectiveOwnerUserService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceOwnerTeamService from "Common/Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import ProbeService from "Common/Server/Services/ProbeService";
import ProbeOwnerTeamService from "Common/Server/Services/ProbeOwnerTeamService";
import ProbeOwnerUserService from "Common/Server/Services/ProbeOwnerUserService";
import AIAgentService from "Common/Server/Services/AIAgentService";
import AIAgentOwnerTeamService from "Common/Server/Services/AIAgentOwnerTeamService";
import AIAgentOwnerUserService from "Common/Server/Services/AIAgentOwnerUserService";
import DataAssetService from "Common/Server/Services/DataAssetService";
import DataAssetOwnerTeamService from "Common/Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "Common/Server/Services/DataAssetOwnerUserService";
import DataPipelineService from "Common/Server/Services/DataPipelineService";
import DataPipelineOwnerTeamService from "Common/Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "Common/Server/Services/DataPipelineOwnerUserService";
import DataStoreService from "Common/Server/Services/DataStoreService";
import DataStoreOwnerTeamService from "Common/Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "Common/Server/Services/DataStoreOwnerUserService";
import ServiceService from "Common/Server/Services/ServiceService";
import ServiceOwnerTeamService from "Common/Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "Common/Server/Services/ServiceOwnerUserService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import DatabaseServerOwnerTeamService from "Common/Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "Common/Server/Services/DatabaseServerOwnerUserService";
import MessageQueueService from "Common/Server/Services/MessageQueueService";
import MessageQueueOwnerTeamService from "Common/Server/Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "Common/Server/Services/MessageQueueOwnerUserService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import RumApplicationOwnerTeamService from "Common/Server/Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "Common/Server/Services/RumApplicationOwnerUserService";
import HostService from "Common/Server/Services/HostService";
import HostOwnerTeamService from "Common/Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "Common/Server/Services/HostOwnerUserService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesClusterOwnerTeamService from "Common/Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "Common/Server/Services/KubernetesClusterOwnerUserService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerHostOwnerTeamService from "Common/Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "Common/Server/Services/DockerHostOwnerUserService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import DockerSwarmClusterOwnerTeamService from "Common/Server/Services/DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterOwnerUserService from "Common/Server/Services/DockerSwarmClusterOwnerUserService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import PodmanHostOwnerTeamService from "Common/Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "Common/Server/Services/PodmanHostOwnerUserService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import ProxmoxClusterOwnerTeamService from "Common/Server/Services/ProxmoxClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "Common/Server/Services/ProxmoxClusterOwnerUserService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import OpenStackCloudOwnerTeamService from "Common/Server/Services/OpenStackCloudOwnerTeamService";
import OpenStackCloudOwnerUserService from "Common/Server/Services/OpenStackCloudOwnerUserService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import VMwareVCenterOwnerTeamService from "Common/Server/Services/VMwareVCenterOwnerTeamService";
import VMwareVCenterOwnerUserService from "Common/Server/Services/VMwareVCenterOwnerUserService";
import CephClusterService from "Common/Server/Services/CephClusterService";
import CephClusterOwnerTeamService from "Common/Server/Services/CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "Common/Server/Services/CephClusterOwnerUserService";
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import StorageArrayOwnerTeamService from "Common/Server/Services/StorageArrayOwnerTeamService";
import StorageArrayOwnerUserService from "Common/Server/Services/StorageArrayOwnerUserService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import IoTFleetOwnerTeamService from "Common/Server/Services/IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "Common/Server/Services/IoTFleetOwnerUserService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import CloudResourceOwnerTeamService from "Common/Server/Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "Common/Server/Services/CloudResourceOwnerUserService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ServerlessFunctionOwnerTeamService from "Common/Server/Services/ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "Common/Server/Services/ServerlessFunctionOwnerUserService";
import DashboardService from "Common/Server/Services/DashboardService";
import DashboardOwnerTeamService from "Common/Server/Services/DashboardOwnerTeamService";
import DashboardOwnerUserService from "Common/Server/Services/DashboardOwnerUserService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowOwnerTeamService from "Common/Server/Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "Common/Server/Services/WorkflowOwnerUserService";
import RunbookService from "Common/Server/Services/RunbookService";
import RunbookOwnerTeamService from "Common/Server/Services/RunbookOwnerTeamService";
import RunbookOwnerUserService from "Common/Server/Services/RunbookOwnerUserService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "Common/Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleOwnerUserService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerUserService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import IncomingCallPolicyOwnerTeamService from "Common/Server/Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "Common/Server/Services/IncomingCallPolicyOwnerUserService";
import IncidentMemberService from "Common/Server/Services/IncidentMemberService";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendIncidentAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendAlertAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendStatusChangeNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendStateChangeNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendNotePostedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendUnresolvedReminderNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendCreatedResourceNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendAnnouncementCreatedNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/SloOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/NetworkDeviceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/Probe/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AIAgent/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DataAssetOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DataPipelineOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DataStoreOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ServiceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DatabaseServerOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/MessageQueueOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/RumApplicationOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/HostOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/KubernetesClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DockerHostOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DockerSwarmClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/PodmanHostOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ProxmoxClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/OpenStackCloudOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/VMwareVCenterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/CephClusterOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/StorageArrayOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IoTFleetOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/CloudResourceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ServerlessFunctionOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/DashboardOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/WorkflowOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/RunbookOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyScheduleOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncomingCallPolicyOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentMembers/SendMemberAddedNotification";

type AnyMock = jest.Mock;

function asMock(fn: unknown): AnyMock {
  return fn as AnyMock;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000a1",
);
const ALERT_ID: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000b1");
// The record whose notification it is, for the kinds that have one of their own.
const EVENT_ID: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000e1");

const START: Date = new Date("2026-11-15T10:00:00.000Z");

function makeOwner(n: number): User {
  const user: User = new User(
    new ObjectID(`11111111-0000-4000-8000-00000000000${n}`),
  );
  user.name = new Name(`Owner ${n}`);
  user.email = new Email(`owner${n}@acme.test`);
  return user;
}

const OWNER_1: User = makeOwner(1);
const OWNER_2: User = makeOwner(2);
const OWNER_3: User = makeOwner(3);
const OWNERS: Array<User> = [OWNER_1, OWNER_2, OWNER_3];

function idOf(user: User): string {
  return user.id!.toString();
}

// Whether a feed item's details name the owner: by their markdown, or name and address.
function namesOwner(markdown: string, user: User): boolean {
  return (
    markdown.includes(idOf(user)) || markdown.includes(user.email!.toString())
  );
}

const NEVER: Promise<never> = new Promise<never>(() => {
  // a stopped worker hears nothing back
});

/*
 * What the services stand in for: the record a job tells of, whether it is
 * still due (not taken), and what was sent.
 */
interface World {
  owners: Array<User>;
  // The record (and its incident or alert) is there.
  exists: boolean;
  // The job took it: marked it notified, or moved its reminder on.
  isTaken: boolean;
  takes: number;
  isResolved: boolean;
  // Whether a public note is published: owners are told only of a published one.
  isPublished: boolean;
  // The next take never answers: the worker stops there.
  takeStops: boolean;
  // That owner's next send starts and never returns, or returns when `sendGate` does.
  sendStopsFor: string | null;
  sendGate: Promise<void> | null;
  sendFailsFor: string | null;
  // Every send, in order: whom it was to.
  sent: Array<string>;
  // Where a worker stopped.
  stoppedAt: Array<string>;
}

let world: World;

// One job, the record it tells of, and how the services answer for it.
interface JobCase {
  title: string;
  jobName: string;
  kind: OwnerNotificationKind;
  resourceId: ObjectID;
  eventId: ObjectID;
  occurrence: number;
  arrange: () => void;
  // The feed items written for the record.
  feedItems: () => Array<{ moreInformationInMarkdown: string }>;
  // Whether its feed item names whom it reached.
  namesWhomItReached: boolean;
  // The feed's create, for the jobs that write a feed item.
  feedService?: unknown;
}

function incident(): Incident {
  const record: Incident = new Incident(INCIDENT_ID);
  record.projectId = PROJECT_ID;
  record.title = "Checkout is down";
  record.description = "Checkout returns 500s";
  record.incidentNumber = 12;
  record.createdAt = START;
  record.declaredAt = START;
  record.enableReminders = true;
  record.reminderNotificationSentCount = 0;

  const project: Project = new Project();
  project.name = "Acme";
  record.project = project;

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  record.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  record.incidentSeverity = severity;

  return record;
}

function alert(): Alert {
  const record: Alert = new Alert(ALERT_ID);
  record.projectId = PROJECT_ID;
  record.title = "CPU is high";
  record.description = "CPU above 90%";
  record.alertNumber = 7;
  record.createdAt = START;
  record.enableReminders = true;
  record.reminderNotificationSentCount = 0;

  const project: Project = new Project();
  project.name = "Acme";
  record.project = project;

  const state: AlertState = new AlertState();
  state.name = "Identified";
  record.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  record.alertSeverity = severity;

  return record;
}

// The record's due read: there while it is not taken.
function dueWhileNotTaken<T>(record: () => T): () => Promise<Array<T>> {
  return async (): Promise<Array<T>> => {
    return world.exists && !world.isTaken ? [record()] : [];
  };
}

// The record a state change is of, read with its page while it is there.
function readWhileThere<T>(record: () => T): () => Promise<Array<T>> {
  return async (): Promise<Array<T>> => {
    return world.exists ? [record()] : [];
  };
}

/*
 * A reminder job's move (OwnerReminderBacklog, #9019): sending the reminder -
 * the next one later, counted - is the take, one compare-and-set only one
 * run wins; taking the reminders away is not.
 */
async function reminderMove(data: { data: JSONObject }): Promise<boolean> {
  if (data.data["nextReminderNotificationAt"] === null) {
    return true;
  }

  return await compareAndSetTake();
}

// A take that matches only the record as it was read, as the Created jobs' does.
async function compareAndSetTake(): Promise<boolean> {
  if (world.takeStops) {
    world.takeStops = false;
    world.stoppedAt.push("take");
    return await NEVER;
  }

  if (world.isTaken || !world.exists) {
    return false;
  }

  world.isTaken = true;
  world.takes++;
  return true;
}

function feedOf(
  mock: unknown,
  key: string,
  id: ObjectID,
): () => Array<{ moreInformationInMarkdown: string }> {
  return (): Array<{ moreInformationInMarkdown: string }> => {
    return asMock(mock)
      .mock.calls.map((call: Array<unknown>) => {
        return call[0] as Record<string, unknown>;
      })
      .filter((item: Record<string, unknown>): boolean => {
        return String(item[key]) === id.toString();
      })
      .map((item: Record<string, unknown>) => {
        return {
          moreInformationInMarkdown: String(item["moreInformationInMarkdown"]),
        };
      });
  };
}

const incidentFeed: () => Array<{ moreInformationInMarkdown: string }> = feedOf(
  IncidentFeedService.createIncidentFeedItem,
  "incidentId",
  INCIDENT_ID,
);
const alertFeed: () => Array<{ moreInformationInMarkdown: string }> = feedOf(
  AlertFeedService.createAlertFeedItem,
  "alertId",
  ALERT_ID,
);

function arrangeIncident(): void {
  asMock(IncidentService.findOneById).mockImplementation(async () => {
    return world.exists ? incident() : null;
  });
  asMock(IncidentService.findOwners).mockImplementation(async () => {
    return world.owners;
  });
}

function arrangeAlert(): void {
  asMock(AlertService.findOneById).mockImplementation(async () => {
    return world.exists ? alert() : null;
  });
  asMock(AlertService.findOwners).mockImplementation(async () => {
    return world.owners;
  });
}

const CASES: Array<JobCase> = [
  {
    title: "an incident's Created notification",
    jobName: "IncidentOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.IncidentCreated,
    resourceId: INCIDENT_ID,
    eventId: INCIDENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();
      asMock(IncidentService.findCreatedNotificationsDue).mockImplementation(
        dueWhileNotTaken(incident),
      );
      asMock(IncidentService.takeCreatedNotification).mockImplementation(
        compareAndSetTake,
      );
    },
  },
  {
    title: "an alert's Created notification",
    jobName: "AlertOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.AlertCreated,
    resourceId: ALERT_ID,
    eventId: ALERT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();
      asMock(AlertService.findCreatedNotificationsDue).mockImplementation(
        dueWhileNotTaken(alert),
      );
      asMock(AlertService.takeCreatedNotification).mockImplementation(
        compareAndSetTake,
      );
    },
  },
  {
    title: "an incident's state change",
    jobName: "IncidentOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.IncidentStateChanged,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();

      const timeline: () => IncidentStateTimeline =
        (): IncidentStateTimeline => {
          const record: IncidentStateTimeline = new IncidentStateTimeline(
            EVENT_ID,
          );
          record.projectId = PROJECT_ID;
          record.incidentId = INCIDENT_ID;
          record.createdAt = START;
          const project: Project = new Project();
          project.name = "Acme";
          record.project = project;
          const state: IncidentState = new IncidentState();
          state.name = "Resolved";
          record.incidentState = state;
          return record;
        };

      // Read a page at a time, and taken by one compare-and-set (#7974).
      asMock(IncidentStateTimelineService.findBy).mockImplementation(
        dueWhileNotTaken(timeline),
      );
      asMock(IncidentService.findBy).mockImplementation(
        readWhileThere(incident),
      );
      asMock(IncidentStateTimelineService.findOneById).mockImplementation(
        async () => {
          return world.exists ? timeline() : null;
        },
      );
      asMock(IncidentStateTimelineService.findOneBy).mockResolvedValue(null);
      asMock(
        IncidentStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "an alert's state change",
    jobName: "AlertOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.AlertStateChanged,
    resourceId: ALERT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();

      const timeline: () => AlertStateTimeline = (): AlertStateTimeline => {
        const record: AlertStateTimeline = new AlertStateTimeline(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.alertId = ALERT_ID;
        record.createdAt = START;
        const project: Project = new Project();
        project.name = "Acme";
        record.project = project;
        const state: AlertState = new AlertState();
        state.name = "Resolved";
        record.alertState = state;
        return record;
      };

      // Read a page at a time, and taken by one compare-and-set (#7974).
      asMock(AlertStateTimelineService.findBy).mockImplementation(
        dueWhileNotTaken(timeline),
      );
      asMock(AlertService.findBy).mockImplementation(readWhileThere(alert));
      asMock(AlertStateTimelineService.findOneById).mockImplementation(
        async () => {
          return world.exists ? timeline() : null;
        },
      );
      asMock(AlertStateTimelineService.findOneBy).mockResolvedValue(null);
      asMock(
        AlertStateTimelineService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a public note posted on an incident",
    jobName: "IncidentOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.IncidentPublicNotePosted,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();

      const note: () => IncidentPublicNote = (): IncidentPublicNote => {
        const record: IncidentPublicNote = new IncidentPublicNote(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.incidentId = INCIDENT_ID;
        record.note = "We are on it";
        return record;
      };

      // Read a page at a time, and taken by one compare-and-set (#8862).
      asMock(IncidentPublicNoteService.findBy).mockImplementation(
        dueWhileNotTaken(note),
      );
      // The page's incidents, read with it.
      asMock(IncidentService.findBy).mockImplementation(
        readWhileThere(incident),
      );
      // Read again only while it is published, as the job asks.
      asMock(IncidentPublicNoteService.findOneBy).mockImplementation(
        async (data: { query: JSONObject }) => {
          return world.exists &&
            world.isPublished &&
            data.query["isPublished"] === true
            ? note()
            : null;
        },
      );
      asMock(
        IncidentPublicNoteService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a private note posted on an incident",
    jobName: "IncidentOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.IncidentInternalNotePosted,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();

      const note: () => IncidentInternalNote = (): IncidentInternalNote => {
        const record: IncidentInternalNote = new IncidentInternalNote(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.incidentId = INCIDENT_ID;
        record.note = "Rolling back";
        return record;
      };

      asMock(IncidentInternalNoteService.findBy).mockImplementation(
        dueWhileNotTaken(note),
      );
      asMock(IncidentService.findBy).mockImplementation(
        readWhileThere(incident),
      );
      asMock(IncidentInternalNoteService.findOneById).mockImplementation(
        async () => {
          return world.exists ? note() : null;
        },
      );
      asMock(
        IncidentInternalNoteService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a note posted on an alert",
    jobName: "AlertOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.AlertInternalNotePosted,
    resourceId: ALERT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();

      const note: () => AlertInternalNote = (): AlertInternalNote => {
        const record: AlertInternalNote = new AlertInternalNote(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.alertId = ALERT_ID;
        record.note = "Scaling out";
        return record;
      };

      asMock(AlertInternalNoteService.findBy).mockImplementation(
        dueWhileNotTaken(note),
      );
      asMock(AlertService.findBy).mockImplementation(readWhileThere(alert));
      asMock(AlertInternalNoteService.findOneById).mockImplementation(
        async () => {
          return world.exists ? note() : null;
        },
      );
      asMock(
        AlertInternalNoteService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a team added as the owner of an incident",
    jobName: "IncidentOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.IncidentOwnerAdded,
    resourceId: INCIDENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: incidentFeed,
    arrange: (): void => {
      arrangeIncident();

      const ownerRow: () => IncidentOwnerTeam = (): IncidentOwnerTeam => {
        const record: IncidentOwnerTeam = new IncidentOwnerTeam(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.incidentId = INCIDENT_ID;
        record.teamId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");
        return record;
      };

      // Read a page at a time with the incident's other rows (#8862).
      asMock(IncidentOwnerTeamService.findBy).mockImplementation(
        dueWhileNotTaken(ownerRow),
      );
      asMock(IncidentOwnerUserService.findBy).mockResolvedValue([]);
      asMock(IncidentService.findBy).mockImplementation(
        readWhileThere(incident),
      );
      asMock(
        IncidentOwnerTeamService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a team added as the owner of an alert",
    jobName: "AlertOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.AlertOwnerAdded,
    resourceId: ALERT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: alertFeed,
    arrange: (): void => {
      arrangeAlert();

      const ownerRow: () => AlertOwnerTeam = (): AlertOwnerTeam => {
        const record: AlertOwnerTeam = new AlertOwnerTeam(EVENT_ID);
        record.projectId = PROJECT_ID;
        record.alertId = ALERT_ID;
        record.teamId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");
        return record;
      };

      asMock(AlertOwnerTeamService.findBy).mockImplementation(
        dueWhileNotTaken(ownerRow),
      );
      asMock(AlertOwnerUserService.findBy).mockResolvedValue([]);
      asMock(AlertService.findBy).mockImplementation(readWhileThere(alert));
      asMock(
        AlertOwnerTeamService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a reminder that an incident is still open",
    jobName: "IncidentOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.IncidentReminder,
    resourceId: INCIDENT_ID,
    eventId: INCIDENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: incidentFeed,
    feedService: IncidentFeedService.createIncidentFeedItem,
    arrange: (): void => {
      arrangeIncident();
      // Due a page at a time until a run moves it on (#9019).
      asMock(IncidentService.findBy).mockImplementation(
        dueWhileNotTaken(incident),
      );
      // Its affected resources, read while it is there.
      asMock(IncidentService.findAllBy).mockImplementation(
        readWhileThere(incident),
      );
      asMock(
        IncidentService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(reminderMove);
      asMock(IncidentReminderRuleService.findMatchingRule).mockResolvedValue({
        reminderIntervalInMinutes: 30,
      });
    },
  },
  {
    title: "a reminder that an alert is still open",
    jobName: "AlertOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.AlertReminder,
    resourceId: ALERT_ID,
    eventId: ALERT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: alertFeed,
    feedService: AlertFeedService.createAlertFeedItem,
    arrange: (): void => {
      arrangeAlert();
      asMock(AlertService.findBy).mockImplementation(dueWhileNotTaken(alert));
      asMock(AlertService.findAllBy).mockImplementation(readWhileThere(alert));
      asMock(
        AlertService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(reminderMove);
      asMock(AlertReminderRuleService.findMatchingRule).mockResolvedValue({
        reminderIntervalInMinutes: 30,
      });
    },
  },
];

/*
 * THE OTHER RESOURCES' JOBS (#8509): episodes, monitors, scheduled
 * maintenance events, status pages, SLOs and network devices. Their records
 * stand in as plain objects - each job reads only the fields it is given -
 * and every service answers from the world as the incident and alert ones
 * do.
 */
const EVERY_RESOURCE_SERVICES: Array<unknown> = [
  IncidentEpisodeService,
  IncidentEpisodeStateTimelineService,
  IncidentEpisodeInternalNoteService,
  IncidentEpisodeMemberService,
  IncidentEpisodeOwnerTeamService,
  IncidentEpisodeOwnerUserService,
  IncidentEpisodeFeedService,
  AlertEpisodeService,
  AlertEpisodeStateTimelineService,
  AlertEpisodeInternalNoteService,
  AlertEpisodeMemberService,
  AlertEpisodeOwnerTeamService,
  AlertEpisodeOwnerUserService,
  AlertEpisodeFeedService,
  MonitorService,
  MonitorStatusTimelineService,
  MonitorStatusService,
  MonitorOwnerTeamService,
  MonitorOwnerUserService,
  ScheduledMaintenanceService,
  ScheduledMaintenanceStateTimelineService,
  ScheduledMaintenanceStateService,
  ScheduledMaintenancePublicNoteService,
  ScheduledMaintenanceInternalNoteService,
  ScheduledMaintenanceOwnerTeamService,
  ScheduledMaintenanceOwnerUserService,
  ScheduledMaintenanceReminderRuleService,
  ScheduledMaintenanceFeedService,
  StatusPageService,
  StatusPageAnnouncementService,
  StatusPageOwnerTeamService,
  StatusPageOwnerUserService,
  ServiceLevelObjectiveService,
  ServiceLevelObjectiveOwnerTeamService,
  ServiceLevelObjectiveOwnerUserService,
  NetworkDeviceService,
  NetworkDeviceOwnerTeamService,
  NetworkDeviceOwnerUserService,
  ProbeService,
  ProbeOwnerTeamService,
  ProbeOwnerUserService,
  AIAgentService,
  AIAgentOwnerTeamService,
  AIAgentOwnerUserService,
  DataAssetService,
  DataAssetOwnerTeamService,
  DataAssetOwnerUserService,
  DataPipelineService,
  DataPipelineOwnerTeamService,
  DataPipelineOwnerUserService,
  DataStoreService,
  DataStoreOwnerTeamService,
  DataStoreOwnerUserService,
  ServiceService,
  ServiceOwnerTeamService,
  ServiceOwnerUserService,
  DatabaseServerService,
  DatabaseServerOwnerTeamService,
  DatabaseServerOwnerUserService,
  MessageQueueService,
  MessageQueueOwnerTeamService,
  MessageQueueOwnerUserService,
  RumApplicationService,
  RumApplicationOwnerTeamService,
  RumApplicationOwnerUserService,
  HostService,
  HostOwnerTeamService,
  HostOwnerUserService,
  KubernetesClusterService,
  KubernetesClusterOwnerTeamService,
  KubernetesClusterOwnerUserService,
  DockerHostService,
  DockerHostOwnerTeamService,
  DockerHostOwnerUserService,
  DockerSwarmClusterService,
  DockerSwarmClusterOwnerTeamService,
  DockerSwarmClusterOwnerUserService,
  PodmanHostService,
  PodmanHostOwnerTeamService,
  PodmanHostOwnerUserService,
  ProxmoxClusterService,
  ProxmoxClusterOwnerTeamService,
  ProxmoxClusterOwnerUserService,
  OpenStackCloudService,
  OpenStackCloudOwnerTeamService,
  OpenStackCloudOwnerUserService,
  VMwareVCenterService,
  VMwareVCenterOwnerTeamService,
  VMwareVCenterOwnerUserService,
  CephClusterService,
  CephClusterOwnerTeamService,
  CephClusterOwnerUserService,
  StorageArrayService,
  StorageArrayOwnerTeamService,
  StorageArrayOwnerUserService,
  IoTFleetService,
  IoTFleetOwnerTeamService,
  IoTFleetOwnerUserService,
  CloudResourceService,
  CloudResourceOwnerTeamService,
  CloudResourceOwnerUserService,
  ServerlessFunctionService,
  ServerlessFunctionOwnerTeamService,
  ServerlessFunctionOwnerUserService,
  DashboardService,
  DashboardOwnerTeamService,
  DashboardOwnerUserService,
  WorkflowService,
  WorkflowOwnerTeamService,
  WorkflowOwnerUserService,
  RunbookService,
  RunbookOwnerTeamService,
  RunbookOwnerUserService,
  OnCallDutyPolicyService,
  OnCallDutyPolicyOwnerTeamService,
  OnCallDutyPolicyOwnerUserService,
  OnCallDutyPolicyScheduleService,
  OnCallDutyPolicyScheduleOwnerTeamService,
  OnCallDutyPolicyScheduleOwnerUserService,
  IncomingCallPolicyService,
  IncomingCallPolicyOwnerTeamService,
  IncomingCallPolicyOwnerUserService,
];

// The record the owners of the other resources are told of.
const RESOURCE_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000d1",
);
const TEAM_ID: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");

type PlainRecord = Record<string, unknown>;

function plain(fields: PlainRecord): PlainRecord {
  const id: ObjectID | undefined = fields["id"] as ObjectID | undefined;
  return { ...(id ? { _id: id.toString() } : {}), ...fields };
}

const OF_THE_PROJECT: PlainRecord = {
  projectId: PROJECT_ID,
  project: { name: "Acme" },
};

function incidentEpisode(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    title: "Checkout is flapping",
    description: "Three incidents in an hour",
    episodeNumber: 3,
    createdAt: START,
    currentIncidentState: { name: "Active" },
    incidentSeverity: { name: "Major" },
  });
}

function alertEpisode(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    title: "CPU is spiking",
    description: "Three alerts in an hour",
    episodeNumber: 5,
    createdAt: START,
    currentAlertState: { name: "Active" },
    alertSeverity: { name: "High" },
  });
}

function monitor(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "Checkout API",
    description: "The checkout endpoint",
    currentMonitorStatus: { name: "Operational" },
  });
}

function scheduledMaintenance(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    title: "Database upgrade",
    description: "Postgres 16",
    scheduledMaintenanceNumber: 4,
    currentScheduledMaintenanceState: { name: "Ongoing" },
    createdAt: START,
    startsAt: START,
    enableReminders: true,
    reminderNotificationSentCount: 0,
    labels: [],
  });
}

function statusPage(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "Acme Status",
    description: "How Acme is doing",
  });
}

function serviceLevelObjective(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "Checkout availability",
    targetPercentage: 99.9,
    windowDays: 30,
  });
}

function networkDevice(): PlainRecord {
  return plain({ id: RESOURCE_ID, ...OF_THE_PROJECT, name: "core-sw-1" });
}

function probe(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "eu-west probe",
    description: "Frankfurt",
  });
}

function aiAgent(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "Fixer",
    description: "Opens pull requests",
  });
}

function dataAsset(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "orders",
    schemaName: "analytics",
    dataStoreName: "warehouse",
    description: "One row per order",
  });
}

function dataPipeline(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    jobName: "load_orders",
    jobNamespace: "airflow",
    description: "Loads the orders every hour",
  });
}

function dataStore(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "orders-db",
    description: "The orders database",
  });
}

/*
 * A service, a piece of infrastructure, a dashboard, a workflow, a runbook
 * or an on-call record (#9700): each is read by its name and description.
 */
function ownedRecord(): PlainRecord {
  return plain({
    id: RESOURCE_ID,
    ...OF_THE_PROJECT,
    name: "checkout",
    description: "Takes the money",
  });
}

// A team row of the record, added as its owner: its members are the owners.
function ownerTeamRow(recordIdField: string): () => PlainRecord {
  return (): PlainRecord => {
    return plain({
      id: EVENT_ID,
      projectId: PROJECT_ID,
      [recordIdField]: RESOURCE_ID,
      teamId: TEAM_ID,
    });
  };
}

function serviceOf(service: unknown): Record<string, unknown> {
  return service as Record<string, unknown>;
}

// The record a job tells of, read by its id while it is there.
function arrangeRecord(service: unknown, record: () => PlainRecord): void {
  asMock(serviceOf(service)["findOneById"]).mockImplementation(async () => {
    return world.exists ? record() : null;
  });
}

/*
 * A record due until the job takes it (OwnerNotificationBacklog, #7974,
 * #8862): read a page at a time while it is there and not taken, read again
 * by its id, and taken by one compare-and-set that only one run wins.
 */
function arrangeBacklog(service: unknown, record: () => PlainRecord): void {
  asMock(serviceOf(service)["findBy"]).mockImplementation(
    dueWhileNotTaken(record),
  );
  arrangeRecord(service, record);
  asMock(
    serviceOf(service)["compareAndSetColumnsByIdWithoutHooks"],
  ).mockImplementation(compareAndSetTake);
}

function feedOfService(
  service: unknown,
  create: string,
  key: string,
): () => Array<{ moreInformationInMarkdown: string }> {
  return feedOf(serviceOf(service)[create], key, RESOURCE_ID);
}

interface OwnerAddedOf {
  title: string;
  jobName: string;
  kind: OwnerNotificationKind;
  recordService: unknown;
  teamService: unknown;
  recordIdField: string;
  record: () => PlainRecord;
}

function ownerAddedCase(of: OwnerAddedOf): JobCase {
  return {
    title: of.title,
    jobName: of.jobName,
    kind: of.kind,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeRecord(of.recordService, of.record);
      // The records of a page's rows, read with it.
      asMock(serviceOf(of.recordService)["findBy"]).mockImplementation(
        readWhileThere(of.record),
      );
      arrangeBacklog(of.teamService, ownerTeamRow(of.recordIdField));
    },
  };
}

interface EpisodeOf {
  noun: "incident" | "alert";
  jobPrefix: string;
  episodeService: unknown;
  timelineService: unknown;
  noteService: unknown;
  memberService: unknown;
  teamService: unknown;
  feedService: unknown;
  feedCreate: string;
  episodeIdField: string;
  memberIdField: string;
  episode: () => PlainRecord;
  kinds: {
    created: OwnerNotificationKind;
    stateChanged: OwnerNotificationKind;
    notePosted: OwnerNotificationKind;
    memberAdded: OwnerNotificationKind;
    ownerAdded: OwnerNotificationKind;
  };
  memberAddedJob: string;
  // The member row's mark: told of the alert or incident it added.
  memberMark: string;
}

function episodeCases(of: EpisodeOf): Array<JobCase> {
  const feedItems: () => Array<{ moreInformationInMarkdown: string }> =
    feedOfService(of.feedService, of.feedCreate, of.episodeIdField);
  const feedService: unknown = serviceOf(of.feedService)[of.feedCreate];

  return [
    {
      title: `an ${of.noun} episode's Created notification`,
      jobName: `${of.jobPrefix}:SendCreatedResourceEmail`,
      kind: of.kinds.created,
      resourceId: RESOURCE_ID,
      eventId: RESOURCE_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        arrangeBacklog(of.episodeService, of.episode);
      },
    },
    {
      title: `an ${of.noun} episode's state change`,
      jobName: `${of.jobPrefix}:SendStateChangeEmail`,
      kind: of.kinds.stateChanged,
      resourceId: RESOURCE_ID,
      eventId: EVENT_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        arrangeRecord(of.episodeService, of.episode);
        // The page's episodes, read with it.
        asMock(serviceOf(of.episodeService)["findBy"]).mockImplementation(
          readWhileThere(of.episode),
        );
        arrangeBacklog(of.timelineService, (): PlainRecord => {
          return plain({
            id: EVENT_ID,
            ...OF_THE_PROJECT,
            [of.episodeIdField]: RESOURCE_ID,
            [`${of.noun}State`]: { name: "Resolved" },
            createdAt: START,
          });
        });
      },
    },
    {
      title: `a note posted on an ${of.noun} episode`,
      jobName: `${of.jobPrefix}:SendsNotePostedEmail`,
      kind: of.kinds.notePosted,
      resourceId: RESOURCE_ID,
      eventId: EVENT_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        arrangeRecord(of.episodeService, of.episode);
        // The page's episodes, read with it.
        asMock(serviceOf(of.episodeService)["findBy"]).mockImplementation(
          readWhileThere(of.episode),
        );
        arrangeBacklog(of.noteService, (): PlainRecord => {
          return plain({
            id: EVENT_ID,
            projectId: PROJECT_ID,
            [of.episodeIdField]: RESOURCE_ID,
            note: "Rolled back the deploy",
          });
        });
      },
    },
    {
      title: `an ${of.noun} added to an ${of.noun} episode`,
      jobName: of.memberAddedJob,
      kind: of.kinds.memberAdded,
      resourceId: RESOURCE_ID,
      // The batch: its first member row, and how many it holds.
      eventId: EVENT_ID,
      occurrence: 1,
      namesWhomItReached: true,
      feedItems: feedItems,
      feedService: feedService,
      arrange: (): void => {
        const member: () => PlainRecord = (): PlainRecord => {
          return plain({
            id: EVENT_ID,
            projectId: PROJECT_ID,
            [of.episodeIdField]: RESOURCE_ID,
            [of.memberIdField]: of.noun === "incident" ? INCIDENT_ID : ALERT_ID,
            addedAt: START,
            createdAt: START,
          });
        };

        arrangeRecord(of.episodeService, of.episode);
        // The page's episodes, read with it.
        asMock(serviceOf(of.episodeService)["findBy"]).mockImplementation(
          readWhileThere(of.episode),
        );
        arrangeBacklog(of.memberService, member);
        /*
         * Read a page at a time with its episode's batch while not taken
         * (#8862) - and the batch read again by a later run: the members
         * notified since.
         */
        asMock(serviceOf(of.memberService)["findBy"]).mockImplementation(
          async (data: { query: JSONObject }) => {
            if (data.query[of.memberMark] === false) {
              return world.exists && !world.isTaken ? [member()] : [];
            }

            return world.exists ? [member()] : [];
          },
        );

        if (of.noun === "incident") {
          asMock(IncidentService.findBy).mockImplementation(async () => {
            return [incident()];
          });
        } else {
          asMock(AlertService.findBy).mockImplementation(async () => {
            return [alert()];
          });
        }
      },
    },
    ownerAddedCase({
      title: `a team added as the owner of an ${of.noun} episode`,
      jobName: `${of.jobPrefix}:SendOwnerAddedEmail`,
      kind: of.kinds.ownerAdded,
      recordService: of.episodeService,
      teamService: of.teamService,
      recordIdField: of.episodeIdField,
      record: of.episode,
    }),
  ];
}

const scheduledMaintenanceFeed: () => Array<{
  moreInformationInMarkdown: string;
}> = feedOfService(
  ScheduledMaintenanceFeedService,
  "createScheduledMaintenanceFeedItem",
  "scheduledMaintenanceId",
);

function scheduledMaintenanceNote(): PlainRecord {
  return plain({
    id: EVENT_ID,
    projectId: PROJECT_ID,
    scheduledMaintenanceId: RESOURCE_ID,
    note: "Halfway through",
  });
}

const EVERY_RESOURCE_CASES: Array<JobCase> = [
  ...episodeCases({
    noun: "incident",
    jobPrefix: "IncidentEpisodeOwner",
    episodeService: IncidentEpisodeService,
    timelineService: IncidentEpisodeStateTimelineService,
    noteService: IncidentEpisodeInternalNoteService,
    memberService: IncidentEpisodeMemberService,
    teamService: IncidentEpisodeOwnerTeamService,
    feedService: IncidentEpisodeFeedService,
    feedCreate: "createIncidentEpisodeFeedItem",
    episodeIdField: "incidentEpisodeId",
    memberIdField: "incidentId",
    episode: incidentEpisode,
    kinds: {
      created: OwnerNotificationKind.IncidentEpisodeCreated,
      stateChanged: OwnerNotificationKind.IncidentEpisodeStateChanged,
      notePosted: OwnerNotificationKind.IncidentEpisodeInternalNotePosted,
      memberAdded: OwnerNotificationKind.IncidentEpisodeIncidentAdded,
      ownerAdded: OwnerNotificationKind.IncidentEpisodeOwnerAdded,
    },
    memberAddedJob: "IncidentEpisodeOwner:SendIncidentAddedEmail",
    memberMark: "isOwnerNotifiedOfIncidentAdded",
  }),
  ...episodeCases({
    noun: "alert",
    jobPrefix: "AlertEpisodeOwner",
    episodeService: AlertEpisodeService,
    timelineService: AlertEpisodeStateTimelineService,
    noteService: AlertEpisodeInternalNoteService,
    memberService: AlertEpisodeMemberService,
    teamService: AlertEpisodeOwnerTeamService,
    feedService: AlertEpisodeFeedService,
    feedCreate: "createAlertEpisodeFeedItem",
    episodeIdField: "alertEpisodeId",
    memberIdField: "alertId",
    episode: alertEpisode,
    kinds: {
      created: OwnerNotificationKind.AlertEpisodeCreated,
      stateChanged: OwnerNotificationKind.AlertEpisodeStateChanged,
      notePosted: OwnerNotificationKind.AlertEpisodeInternalNotePosted,
      memberAdded: OwnerNotificationKind.AlertEpisodeAlertAdded,
      ownerAdded: OwnerNotificationKind.AlertEpisodeOwnerAdded,
    },
    memberAddedJob: "AlertEpisodeOwner:SendAlertAddedEmail",
    memberMark: "isOwnerNotifiedOfAlertAdded",
  }),
  {
    title: "a monitor's Created notification",
    jobName: "MonitorOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.MonitorCreated,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeBacklog(MonitorService, monitor);
    },
  },
  {
    title: "a monitor's status change",
    jobName: "MonitorOwner:SendStatusChangeEmail",
    kind: OwnerNotificationKind.MonitorStatusChanged,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      // The page's monitors, read with it, or each on its own.
      arrangeRecord(MonitorService, monitor);
      asMock(MonitorService.findBy).mockImplementation(readWhileThere(monitor));
      arrangeBacklog(MonitorStatusTimelineService, (): PlainRecord => {
        return plain({
          id: EVENT_ID,
          ...OF_THE_PROJECT,
          monitorId: RESOURCE_ID,
          monitorStatus: { name: "Offline" },
          createdAt: START,
          rootCause: "Connection refused",
        });
      });
    },
  },
  ownerAddedCase({
    title: "a team added as the owner of a monitor",
    jobName: "MonitorOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.MonitorOwnerAdded,
    recordService: MonitorService,
    teamService: MonitorOwnerTeamService,
    recordIdField: "monitorId",
    record: monitor,
  }),
  {
    title: "a scheduled maintenance event's Created notification",
    jobName: "ScheduledMaintenanceOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceCreated,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeBacklog(ScheduledMaintenanceService, scheduledMaintenance);
    },
  },
  {
    title: "a scheduled maintenance event's state change",
    jobName: "ScheduledMaintenanceOwner:SendStateChangeEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceStateChanged,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeBacklog(
        ScheduledMaintenanceStateTimelineService,
        (): PlainRecord => {
          return plain({
            id: EVENT_ID,
            ...OF_THE_PROJECT,
            scheduledMaintenanceId: RESOURCE_ID,
            scheduledMaintenance: scheduledMaintenance(),
            scheduledMaintenanceState: { name: "Completed" },
            createdAt: START,
            startsAt: START,
          });
        },
      );
    },
  },
  {
    title: "a public note posted on a scheduled maintenance event",
    jobName: "ScheduledMaintenanceOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.ScheduledMaintenancePublicNotePosted,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeRecord(ScheduledMaintenanceService, scheduledMaintenance);
      // The page's events, read with it.
      asMock(ScheduledMaintenanceService.findBy).mockImplementation(
        readWhileThere(scheduledMaintenance),
      );
      // Read a page at a time, and taken by one compare-and-set (#8862).
      asMock(ScheduledMaintenancePublicNoteService.findBy).mockImplementation(
        dueWhileNotTaken(scheduledMaintenanceNote),
      );
      // Read again only while it is published, as the job asks.
      asMock(
        ScheduledMaintenancePublicNoteService.findOneBy,
      ).mockImplementation(async (data: { query: JSONObject }) => {
        return world.exists &&
          world.isPublished &&
          data.query["isPublished"] === true
          ? scheduledMaintenanceNote()
          : null;
      });
      asMock(
        ScheduledMaintenancePublicNoteService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(compareAndSetTake);
    },
  },
  {
    title: "a private note posted on a scheduled maintenance event",
    jobName: "ScheduledMaintenanceOwner:SendsNotePostedEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceInternalNotePosted,
    resourceId: RESOURCE_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      arrangeRecord(ScheduledMaintenanceService, scheduledMaintenance);
      asMock(ScheduledMaintenanceService.findBy).mockImplementation(
        readWhileThere(scheduledMaintenance),
      );
      arrangeBacklog(
        ScheduledMaintenanceInternalNoteService,
        scheduledMaintenanceNote,
      );
    },
  },
  ownerAddedCase({
    title: "a team added as the owner of a scheduled maintenance event",
    jobName: "ScheduledMaintenanceOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.ScheduledMaintenanceOwnerAdded,
    recordService: ScheduledMaintenanceService,
    teamService: ScheduledMaintenanceOwnerTeamService,
    recordIdField: "scheduledMaintenanceId",
    record: scheduledMaintenance,
  }),
  {
    title: "a reminder that a scheduled maintenance event is still open",
    jobName: "ScheduledMaintenanceOwner:SendUnresolvedReminderNotification",
    kind: OwnerNotificationKind.ScheduledMaintenanceReminder,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: true,
    feedItems: scheduledMaintenanceFeed,
    feedService:
      ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem,
    arrange: (): void => {
      asMock(ScheduledMaintenanceService.findBy).mockImplementation(
        dueWhileNotTaken(scheduledMaintenance),
      );
      asMock(ScheduledMaintenanceService.findAllBy).mockImplementation(
        readWhileThere(scheduledMaintenance),
      );
      arrangeRecord(ScheduledMaintenanceService, scheduledMaintenance);
      asMock(
        ScheduledMaintenanceService.compareAndSetColumnsByIdWithoutHooks,
      ).mockImplementation(reminderMove);
      asMock(
        ScheduledMaintenanceReminderRuleService.findMatchingRule,
      ).mockResolvedValue({
        reminderIntervalInMinutes: 30,
        remindWhileScheduled: true,
      });
    },
  },
  {
    title: "a status page's Created notification",
    jobName: "StatusPageOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.StatusPageCreated,
    resourceId: RESOURCE_ID,
    eventId: RESOURCE_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeBacklog(StatusPageService, statusPage);
    },
  },
  {
    title: "an announcement posted on a status page",
    jobName: "StatusPageOwner:SendAnnouncementCreatedEmail",
    kind: OwnerNotificationKind.StatusPageAnnouncementCreated,
    // One notification per announcement, whichever of its pages they own.
    resourceId: EVENT_ID,
    eventId: EVENT_ID,
    occurrence: 1,
    namesWhomItReached: false,
    feedItems: () => {
      return [];
    },
    arrange: (): void => {
      arrangeBacklog(StatusPageAnnouncementService, (): PlainRecord => {
        return plain({
          id: EVENT_ID,
          projectId: PROJECT_ID,
          title: "Planned work tonight",
          description: "From 22:00 UTC",
          statusPages: [statusPage()],
        });
      });
    },
  },
  ownerAddedCase({
    title: "a team added as the owner of a status page",
    jobName: "StatusPageOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.StatusPageOwnerAdded,
    recordService: StatusPageService,
    teamService: StatusPageOwnerTeamService,
    recordIdField: "statusPageId",
    record: statusPage,
  }),
  ownerAddedCase({
    title: "a team added as the owner of an SLO",
    jobName: "SloOwners:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ServiceLevelObjectiveOwnerAdded,
    recordService: ServiceLevelObjectiveService,
    teamService: ServiceLevelObjectiveOwnerTeamService,
    recordIdField: "serviceLevelObjectiveId",
    record: serviceLevelObjective,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a network device",
    jobName: "NetworkDeviceOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.NetworkDeviceOwnerAdded,
    recordService: NetworkDeviceService,
    teamService: NetworkDeviceOwnerTeamService,
    recordIdField: "networkDeviceId",
    record: networkDevice,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a probe",
    jobName: "ProbeOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.ProbeOwnerAdded,
    recordService: ProbeService,
    teamService: ProbeOwnerTeamService,
    recordIdField: "probeId",
    record: probe,
  }),
  ownerAddedCase({
    title: "a team added as the owner of an AI agent",
    jobName: "AIAgentOwner:SendOwnerAddedEmail",
    kind: OwnerNotificationKind.AIAgentOwnerAdded,
    recordService: AIAgentService,
    teamService: AIAgentOwnerTeamService,
    recordIdField: "aiAgentId",
    record: aiAgent,
  }),
  // Data Observability's tables, pipelines and data stores (#9681).
  ownerAddedCase({
    title: "a team added as the owner of a table",
    jobName: "DataAssetOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DataAssetOwnerAdded,
    recordService: DataAssetService,
    teamService: DataAssetOwnerTeamService,
    recordIdField: "dataAssetId",
    record: dataAsset,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a pipeline",
    jobName: "DataPipelineOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DataPipelineOwnerAdded,
    recordService: DataPipelineService,
    teamService: DataPipelineOwnerTeamService,
    recordIdField: "dataPipelineId",
    record: dataPipeline,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a data store",
    jobName: "DataStoreOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DataStoreOwnerAdded,
    recordService: DataStoreService,
    teamService: DataStoreOwnerTeamService,
    recordIdField: "dataStoreId",
    record: dataStore,
  }),
  // Services, infrastructure, dashboards, workflows, runbooks, on-call (#9700).
  ownerAddedCase({
    title: "a team added as the owner of a service",
    jobName: "ServiceOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ServiceOwnerAdded,
    recordService: ServiceService,
    teamService: ServiceOwnerTeamService,
    recordIdField: "serviceId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a database",
    jobName: "DatabaseServerOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DatabaseServerOwnerAdded,
    recordService: DatabaseServerService,
    teamService: DatabaseServerOwnerTeamService,
    recordIdField: "databaseServerId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a queue",
    jobName: "MessageQueueOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.MessageQueueOwnerAdded,
    recordService: MessageQueueService,
    teamService: MessageQueueOwnerTeamService,
    recordIdField: "messageQueueId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a RUM application",
    jobName: "RumApplicationOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.RumApplicationOwnerAdded,
    recordService: RumApplicationService,
    teamService: RumApplicationOwnerTeamService,
    recordIdField: "rumApplicationId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a host",
    jobName: "HostOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.HostOwnerAdded,
    recordService: HostService,
    teamService: HostOwnerTeamService,
    recordIdField: "hostId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a Kubernetes cluster",
    jobName: "KubernetesClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.KubernetesClusterOwnerAdded,
    recordService: KubernetesClusterService,
    teamService: KubernetesClusterOwnerTeamService,
    recordIdField: "kubernetesClusterId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a Docker host",
    jobName: "DockerHostOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DockerHostOwnerAdded,
    recordService: DockerHostService,
    teamService: DockerHostOwnerTeamService,
    recordIdField: "dockerHostId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a Docker Swarm cluster",
    jobName: "DockerSwarmClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DockerSwarmClusterOwnerAdded,
    recordService: DockerSwarmClusterService,
    teamService: DockerSwarmClusterOwnerTeamService,
    recordIdField: "dockerSwarmClusterId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a Podman host",
    jobName: "PodmanHostOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.PodmanHostOwnerAdded,
    recordService: PodmanHostService,
    teamService: PodmanHostOwnerTeamService,
    recordIdField: "podmanHostId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a Proxmox cluster",
    jobName: "ProxmoxClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ProxmoxClusterOwnerAdded,
    recordService: ProxmoxClusterService,
    teamService: ProxmoxClusterOwnerTeamService,
    recordIdField: "proxmoxClusterId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a OpenStack cloud",
    jobName: "OpenStackCloudOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.OpenStackCloudOwnerAdded,
    recordService: OpenStackCloudService,
    teamService: OpenStackCloudOwnerTeamService,
    recordIdField: "openStackCloudId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a VMware vCenter",
    jobName: "VMwareVCenterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.VMwareVCenterOwnerAdded,
    recordService: VMwareVCenterService,
    teamService: VMwareVCenterOwnerTeamService,
    recordIdField: "vmwareVCenterId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a Ceph cluster",
    jobName: "CephClusterOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.CephClusterOwnerAdded,
    recordService: CephClusterService,
    teamService: CephClusterOwnerTeamService,
    recordIdField: "cephClusterId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a storage array",
    jobName: "StorageArrayOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.StorageArrayOwnerAdded,
    recordService: StorageArrayService,
    teamService: StorageArrayOwnerTeamService,
    recordIdField: "storageArrayId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a IoT fleet",
    jobName: "IoTFleetOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.IoTFleetOwnerAdded,
    recordService: IoTFleetService,
    teamService: IoTFleetOwnerTeamService,
    recordIdField: "iotFleetId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a cloud environment",
    jobName: "CloudResourceOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.CloudResourceOwnerAdded,
    recordService: CloudResourceService,
    teamService: CloudResourceOwnerTeamService,
    recordIdField: "cloudResourceId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a serverless function",
    jobName: "ServerlessFunctionOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.ServerlessFunctionOwnerAdded,
    recordService: ServerlessFunctionService,
    teamService: ServerlessFunctionOwnerTeamService,
    recordIdField: "serverlessFunctionId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a dashboard",
    jobName: "DashboardOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.DashboardOwnerAdded,
    recordService: DashboardService,
    teamService: DashboardOwnerTeamService,
    recordIdField: "dashboardId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a workflow",
    jobName: "WorkflowOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.WorkflowOwnerAdded,
    recordService: WorkflowService,
    teamService: WorkflowOwnerTeamService,
    recordIdField: "workflowId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a runbook",
    jobName: "RunbookOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.RunbookOwnerAdded,
    recordService: RunbookService,
    teamService: RunbookOwnerTeamService,
    recordIdField: "runbookId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a on-call policy",
    jobName: "OnCallDutyPolicyOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.OnCallDutyPolicyOwnerAdded,
    recordService: OnCallDutyPolicyService,
    teamService: OnCallDutyPolicyOwnerTeamService,
    recordIdField: "onCallDutyPolicyId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a on-call schedule",
    jobName: "OnCallDutyPolicyScheduleOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.OnCallDutyPolicyScheduleOwnerAdded,
    recordService: OnCallDutyPolicyScheduleService,
    teamService: OnCallDutyPolicyScheduleOwnerTeamService,
    recordIdField: "onCallDutyPolicyScheduleId",
    record: ownedRecord,
  }),
  ownerAddedCase({
    title: "a team added as the owner of a incoming call policy",
    jobName: "IncomingCallPolicyOwner:SendOwnerAddedNotification",
    kind: OwnerNotificationKind.IncomingCallPolicyOwnerAdded,
    recordService: IncomingCallPolicyService,
    teamService: IncomingCallPolicyOwnerTeamService,
    recordIdField: "incomingCallPolicyId",
    record: ownedRecord,
  }),
];

/*
 * The on-call timeline column naming the record of each Created notification:
 * the notifications that leave out an owner the record's page reached
 * already (#7987). Every other notification - a state change, a note, a
 * reminder, an owner added - tells every owner, paged or not.
 */
const PAGE_COLUMN_OF_CREATED: Partial<
  Record<OwnerNotificationKind, keyof PageNotification>
> = {
  [OwnerNotificationKind.IncidentCreated]: "triggeredByIncidentId",
  [OwnerNotificationKind.AlertCreated]: "triggeredByAlertId",
  [OwnerNotificationKind.IncidentEpisodeCreated]:
    "triggeredByIncidentEpisodeId",
  [OwnerNotificationKind.AlertEpisodeCreated]: "triggeredByAlertEpisodeId",
};

const PAGE_COLUMNS: Array<keyof PageNotification> = [
  "triggeredByIncidentId",
  "triggeredByAlertId",
  "triggeredByIncidentEpisodeId",
  "triggeredByAlertEpisodeId",
];

describe.each([...CASES, ...EVERY_RESOURCE_CASES])(
  "$title",
  (jobCase: JobCase) => {
    let table: InMemoryOwnerNotificationDeliveries;
    let pages: InMemoryOnCallPages;
    let now: Date;

    function runJob(deadline?: JobDeadline | undefined): Promise<void> {
      const handler: CronHandler | undefined =
        mockCapturedJobs[jobCase.jobName];

      if (!handler) {
        throw new Error(`${jobCase.jobName} registered no cron handler.`);
      }

      return handler(deadline);
    }

    // Waits until a run started without waiting for it has stopped `count` times.
    async function untilStopped(count: number = 1): Promise<void> {
      for (let turn: number = 0; turn < 2000; turn++) {
        if (table.stops() + world.stoppedAt.length >= count) {
          return;
        }

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      }

      throw new Error("The run never reached the point it was to stop at.");
    }

    // The worker is started again: the next run, some minutes on.
    async function restartedMinutesLater(minutes: number): Promise<void> {
      now = new Date(now.getTime() + minutes * 60 * 1000);
      await runJob();
    }

    function statuses(): Record<string, OwnerNotificationDeliveryStatus> {
      return table.statusesOf(jobCase.eventId, jobCase.occurrence);
    }

    // Each owner the job sent this record's notification to, and how often.
    function sendsByOwner(): Record<string, number> {
      const sends: Record<string, number> = {};

      for (const userId of world.sent) {
        sends[userId] = (sends[userId] || 0) + 1;
      }

      return sends;
    }

    function everyOwnerOnce(): Record<string, number> {
      return {
        [idOf(OWNER_1)]: 1,
        [idOf(OWNER_2)]: 1,
        [idOf(OWNER_3)]: 1,
      };
    }

    beforeEach(() => {
      jest.clearAllMocks();

      table = useInMemoryOwnerNotificationDeliveries();
      // Nobody was paged, unless a test says so (#7987).
      pages = useInMemoryOnCallPages();
      now = START;

      world = {
        owners: [...OWNERS],
        exists: true,
        isTaken: false,
        takes: 0,
        isResolved: false,
        isPublished: true,
        takeStops: false,
        sendStopsFor: null,
        sendGate: null,
        sendFailsFor: null,
        sent: [],
        stoppedAt: [],
      };

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date(now.getTime());
      });

      // Nothing else is due, for any job - nor in a state change's page.
      for (const service of [
        IncidentStateTimelineService,
        AlertStateTimelineService,
        IncidentPublicNoteService,
        IncidentInternalNoteService,
        AlertInternalNoteService,
        IncidentOwnerTeamService,
        IncidentOwnerUserService,
        AlertOwnerTeamService,
        AlertOwnerUserService,
        IncidentService,
        AlertService,
      ]) {
        asMock(service.findBy).mockResolvedValue([]);
      }

      for (const service of [
        IncidentStateTimelineService,
        AlertStateTimelineService,
        IncidentPublicNoteService,
        IncidentInternalNoteService,
        AlertInternalNoteService,
        IncidentOwnerTeamService,
        IncidentOwnerUserService,
        AlertOwnerTeamService,
        AlertOwnerUserService,
        IncidentService,
        AlertService,
      ]) {
        asMock(service.findAllBy).mockResolvedValue([]);
      }

      const theOwners: () => Promise<Array<User>> = async (): Promise<
        Array<User>
      > => {
        return world.owners;
      };
      const isResolved: () => Promise<boolean> = async (): Promise<boolean> => {
        return world.isResolved;
      };

      for (const service of EVERY_RESOURCE_SERVICES) {
        const each: Record<string, unknown> = service as unknown as Record<
          string,
          unknown
        >;

        asMock(each["findAllBy"]).mockResolvedValue([]);
        asMock(each["findBy"]).mockResolvedValue([]);
        asMock(each["findOneBy"]).mockResolvedValue(null);
        asMock(each["findOneById"]).mockResolvedValue(null);
        asMock(each["updateOneById"]).mockResolvedValue(undefined);
        asMock(each["findOwners"]).mockImplementation(theOwners);
        asMock(each["isScheduledMaintenanceCompleted"]).mockImplementation(
          isResolved,
        );
        asMock(each["isScheduledMaintenanceOngoing"]).mockResolvedValue(false);
        asMock(each["getMonitorDestinationInfo"]).mockReturnValue({
          monitorDestination: "",
          requestType: "",
          monitorType: "",
        });

        for (const link of [
          "getEpisodeLinkInDashboard",
          "getMonitorLinkInDashboard",
          "getScheduledMaintenanceLinkInDashboard",
          "getStatusPageLinkInDashboard",
          "getSloLinkInDashboard",
          "getLinkInDashboard",
          "getDataAssetLinkInDashboard",
          "getDataPipelineLinkInDashboard",
          "getDataStoreLinkInDashboard",
          "getDataObservabilityDatabaseLinkInDashboard",
          "getServiceLinkInDashboard",
          "getDatabaseServerLinkInDashboard",
          "getMessageQueueLinkInDashboard",
          "getHostLinkInDashboard",
          "getKubernetesClusterLinkInDashboard",
          "getDockerHostLinkInDashboard",
          "getDockerSwarmClusterLinkInDashboard",
          "getPodmanHostLinkInDashboard",
          "getProxmoxClusterLinkInDashboard",
          "getOpenStackCloudLinkInDashboard",
          "getVMwareVCenterLinkInDashboard",
          "getCephClusterLinkInDashboard",
          "getStorageArrayLinkInDashboard",
          "getOnCallDutyPolicyLinkInDashboard",
        ]) {
          asMock(each[link]).mockResolvedValue("https://oneuptime.test/record");
        }

        for (const feed of [
          "createIncidentEpisodeFeedItem",
          "createAlertEpisodeFeedItem",
          "createScheduledMaintenanceFeedItem",
        ]) {
          asMock(each[feed]).mockResolvedValue(undefined);
        }
      }

      asMock(IncidentService.findBy).mockResolvedValue([]);
      asMock(AlertService.findBy).mockResolvedValue([]);
      asMock(
        UserNotificationSettingService.ensureSettingExistsForUser,
      ).mockResolvedValue(undefined);

      asMock(IncidentService.findCreatedNotificationsDue).mockResolvedValue([]);
      asMock(AlertService.findCreatedNotificationsDue).mockResolvedValue([]);
      asMock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
        "https://oneuptime.test/incident",
      );
      asMock(AlertService.getAlertLinkInDashboard).mockResolvedValue(
        "https://oneuptime.test/alert",
      );
      asMock(IncidentService.getIncidentIdentifiedDate).mockResolvedValue(
        START,
      );
      asMock(AlertService.getAlertIdentifiedDate).mockResolvedValue(START);
      asMock(IncidentService.isIncidentResolved).mockImplementation(
        async () => {
          return world.isResolved;
        },
      );
      asMock(AlertService.isAlertResolved).mockImplementation(async () => {
        return world.isResolved;
      });
      asMock(IncidentService.isIncidentAcknowledged).mockResolvedValue(false);
      asMock(AlertService.isAlertAcknowledged).mockResolvedValue(false);

      asMock(ProjectService.getOwners).mockResolvedValue([]);
      asMock(TeamMemberService.getUsersInTeams).mockImplementation(async () => {
        return world.owners;
      });
      asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
        async (data: { users: Array<User> }) => {
          return data.users;
        },
      );

      asMock(UserService.findBy).mockImplementation(
        async (data: { query: JSONObject }) => {
          return usersNamedBy(OWNERS, data.query);
        },
      );
      asMock(UserService.getUserMarkdownString).mockImplementation(
        async (data: { userId: ObjectID }) => {
          return `Owner ${data.userId.toString()}`;
        },
      );

      asMock(
        UserNotificationSettingService.sendUserNotification,
      ).mockImplementation(async (data: { userId: ObjectID }) => {
        const userId: string = data.userId.toString();

        world.sent.push(userId);

        if (world.sendFailsFor === userId) {
          throw new Error("smtp connection reset");
        }

        if (world.sendStopsFor === userId) {
          world.sendStopsFor = null;
          world.stoppedAt.push(`send ${userId}`);
          await (world.sendGate || NEVER);
        }
      });

      asMock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
        undefined,
      );
      asMock(AlertFeedService.createAlertFeedItem).mockResolvedValue(undefined);

      jobCase.arrange();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("with no stop, tells each owner once, and the next run nobody", async () => {
      await runJob();

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(60);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);

      if (jobCase.namesWhomItReached) {
        expect(jobCase.feedItems()).toHaveLength(1);
      }
    });

    test("whom it is to tell is written down before the record is taken", async () => {
      world.takeStops = true;
      void runJob();
      await untilStopped();

      expect(world.stoppedAt).toEqual(["take"]);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Pending,
        OwnerNotificationDeliveryStatus.Pending,
        OwnerNotificationDeliveryStatus.Pending,
      ]);
      expect(world.sent).toEqual([]);
    });

    test("stopped before an owner's send: that owner and the ones after are told by the next run, each once", async () => {
      table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([idOf(OWNER_1)]);
      expect(world.isTaken).toBe(true);
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Pending,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
      });

      // Too soon: the run that stopped might still be going.
      await restartedMinutesLater(1);
      expect(world.sent).toEqual([idOf(OWNER_1)]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      if (jobCase.namesWhomItReached) {
        // One feed item, by the run that finished, naming everyone it reached.
        const items: Array<{ moreInformationInMarkdown: string }> =
          jobCase.feedItems();
        expect(items).toHaveLength(1);

        for (const owner of OWNERS) {
          expect([
            idOf(owner),
            namesOwner(items[0]!.moreInformationInMarkdown, owner),
          ]).toEqual([idOf(owner), true]);
        }
      }

      // And no run after it tells anyone again.
      await restartedMinutesLater(30);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped during an owner's send: that owner is never told again - nobody knows whether it went out - and the ones after are", async () => {
      world.sendStopsFor = idOf(OWNER_2);

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([idOf(OWNER_1), idOf(OWNER_2)]);
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Sending,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
      });

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Sending,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Sent,
      });
      expect(
        asMock(logger.warn).mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes(
            "1 owner(s) were being told as it stopped",
          );
        }),
      ).toBe(true);
    });

    test("stopped after an owner's send, before it was recorded: that owner is not told again, the ones after are", async () => {
      table.stopAt({ statement: "finishTelling", userId: idOf(OWNER_2) });

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([idOf(OWNER_1), idOf(OWNER_2)]);
      expect(statuses()[idOf(OWNER_2)]).toBe(
        OwnerNotificationDeliveryStatus.Sending,
      );

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped once an owner's send was recorded: the ones after are told by the next run", async () => {
      table.stopAt({
        statement: "finishTelling",
        userId: idOf(OWNER_2),
        when: "after",
      });

      void runJob();
      await untilStopped();

      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
      });

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped after the last owner was told: nobody is told again", async () => {
      table.stopAt({
        statement: "finishTelling",
        userId: idOf(OWNER_3),
        when: "after",
      });

      void runJob();
      await untilStopped();

      expect(sendsByOwner()).toEqual(everyOwnerOnce());

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(30);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);

      if (!jobCase.namesWhomItReached) {
        expect(jobCase.feedItems()).toEqual([]);
        return;
      }

      /*
       * The feed item the stopped run had still to write is written by the
       * next run, once, naming every owner the stopped run told (#8510).
       */
      expect(jobCase.feedItems()).toHaveLength(1);

      for (const owner of OWNERS) {
        expect([
          idOf(owner),
          namesOwner(jobCase.feedItems()[0]!.moreInformationInMarkdown, owner),
        ]).toEqual([idOf(owner), true]);
      }

      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.Written,
      );
    });

    test("stopped after the last owner was told, before the feed item: a later run writes it once, naming every owner told", async () => {
      if (!jobCase.namesWhomItReached) {
        return;
      }

      // The worker is killed as it writes the feed item.
      asMock(jobCase.feedService).mockImplementationOnce(async () => {
        world.stoppedAt.push("feed");
        await NEVER;
      });

      void runJob();
      await untilStopped();

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.Pending,
      );

      // A run a moment later leaves it: the stopped run may still be at it.
      await restartedMinutesLater(1);
      expect(jobCase.feedItems()).toHaveLength(1);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );
      await restartedMinutesLater(30);

      // The call the stopped run never finished, and the later run's.
      expect(jobCase.feedItems()).toHaveLength(2);
      for (const owner of OWNERS) {
        expect([
          idOf(owner),
          namesOwner(jobCase.feedItems()[1]!.moreInformationInMarkdown, owner),
        ]).toEqual([idOf(owner), true]);
      }
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.Written,
      );
    });

    test("a feed item that fails to write is written by a later run, and given up after three runs set out", async () => {
      if (!jobCase.namesWhomItReached) {
        return;
      }

      asMock(jobCase.feedService).mockRejectedValue(
        new Error("the feed refused it"),
      );

      await runJob();
      expect(sendsByOwner()).toEqual(everyOwnerOnce());

      for (let run: number = 0; run < 5; run++) {
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
      }

      // The run that told them, and the two more a notification is given.
      expect(asMock(jobCase.feedService).mock.calls).toHaveLength(
        OwnerNotificationDeliveries.ATTEMPTS_AT_MOST,
      );
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(table.feedStatusOf(jobCase.eventId, jobCase.occurrence)).toBe(
        OwnerNotificationFeedStatus.NotWritten,
      );
    });

    test("two workers taking up the feed item a stopped run left unwritten write it once between them", async () => {
      if (!jobCase.namesWhomItReached) {
        return;
      }

      asMock(jobCase.feedService).mockImplementationOnce(async () => {
        world.stoppedAt.push("feed");
        await NEVER;
      });

      void runJob();
      await untilStopped();

      now = new Date(
        now.getTime() +
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
      );
      table.interleave(true);
      await Promise.all([runJob(), runJob()]);
      table.interleave(false);

      // The stopped run's unfinished call, and one more.
      expect(jobCase.feedItems()).toHaveLength(2);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped before the take: the next run tells each owner once, and takes the record once", async () => {
      world.takeStops = true;

      void runJob();
      await untilStopped();

      expect(world.sent).toEqual([]);
      expect(world.isTaken).toBe(false);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);

      if (jobCase.namesWhomItReached) {
        expect(jobCase.feedItems()).toHaveLength(1);
      }

      await restartedMinutesLater(30);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("stopped while writing down whom it is to tell: the record is read again, and each owner told once", async () => {
      table.stopAt({ statement: "writeOwnersToTell" });

      void runJob();
      await untilStopped();

      expect(table.rows).toEqual([]);
      expect(world.isTaken).toBe(false);

      await restartedMinutesLater(1);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(world.takes).toBe(1);
    });

    test("two workers at once tell each owner once between them", async () => {
      table.interleave(true);

      await Promise.all([runJob(), runJob()]);

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);

      if (jobCase.namesWhomItReached) {
        expect(jobCase.feedItems().length).toBeGreaterThanOrEqual(1);
        expect(jobCase.feedItems().length).toBeLessThanOrEqual(2);
      }

      // Nor does a run after them.
      table.interleave(false);
      await restartedMinutesLater(30);
      expect(sendsByOwner()).toEqual(everyOwnerOnce());
    });

    test("a worker that lost its lock and goes on beside the next run: each owner told once", async () => {
      let release: () => void = (): void => {
        // set below
      };
      world.sendGate = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });
      world.sendStopsFor = idOf(OWNER_2);

      // The first worker stands still in the second owner's send.
      const first: Promise<void> = runJob();
      await untilStopped();

      // Minutes later the next run starts, while the first still holds the second owner.
      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());

      // The first goes on: the third owner is told already.
      release();
      await first;

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
        OwnerNotificationDeliveryStatus.Sent,
      ]);
    });

    test("a worker stopped every time it sets out gives up after three runs, and tells nobody twice", async () => {
      table.stopAt({ statement: "startTelling", userId: idOf(OWNER_1) });
      void runJob();
      await untilStopped(1);

      for (
        let attempt: number = 2;
        attempt <= OwnerNotificationDeliveries.ATTEMPTS_AT_MOST;
        attempt++
      ) {
        table.stopAt({ statement: "startTelling", userId: idOf(OWNER_1) });
        now = new Date(
          now.getTime() +
            OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
        );
        void runJob();
        await untilStopped(attempt);
      }

      expect(world.sent).toEqual([]);

      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(world.sent).toEqual([]);
      expect(Object.values(statuses())).toEqual([
        OwnerNotificationDeliveryStatus.Failed,
        OwnerNotificationDeliveryStatus.Failed,
        OwnerNotificationDeliveryStatus.Failed,
      ]);
      expect(
        asMock(logger.error).mock.calls.some(
          (call: Array<unknown>): boolean => {
            return String(call[0]).startsWith("Gave up telling 3 owner(s)");
          },
        ),
      ).toBe(true);
      expect(world.takes).toBe(1);
    });

    test("an owner whose send fails is not told again, and the others are told once", async () => {
      world.sendFailsFor = idOf(OWNER_2);

      await runJob();
      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(sendsByOwner()).toEqual(everyOwnerOnce());
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Failed,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Sent,
      });
    });

    test("a record gone before the next run takes its owners up: nobody else is told", async () => {
      table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
      void runJob();
      await untilStopped();

      world.exists = false;
      await restartedMinutesLater(
        OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
      );

      expect(world.sent).toEqual([idOf(OWNER_1)]);
      expect(statuses()).toEqual({
        [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
        [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Failed,
        [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Failed,
      });
    });

    /*
     * ONE NOTIFICATION FOR A NEW RECORD, NOT TWO (#7987). The second owner is
     * on call: the record's page reached them as it was created. A Created
     * job never writes them down to be told, so no run tells them - not the
     * one that stops, nor one that takes up what it left - and every other
     * owner is told once.
     */
    const pageColumn: keyof PageNotification | undefined =
      PAGE_COLUMN_OF_CREATED[jobCase.kind];

    if (pageColumn) {
      // A notification of the record's page to the second owner, in `status`.
      const pageTheSecondOwner: (status?: UserNotificationStatus) => void = (
        status: UserNotificationStatus = UserNotificationStatus.Sent,
      ): void => {
        pages.add({
          projectId: PROJECT_ID,
          userId: OWNER_2.id!,
          [pageColumn]: jobCase.resourceId,
          status: status,
        });
      };

      const everyOwnerButTheSecondOnce: () => Record<
        string,
        number
      > = (): Record<string, number> => {
        return { [idOf(OWNER_1)]: 1, [idOf(OWNER_3)]: 1 };
      };

      test("with no stop, the owner the page reached is never told, the others once - and the feed says which was left out", async () => {
        pageTheSecondOwner();

        await runJob();

        expect(sendsByOwner()).toEqual(everyOwnerButTheSecondOnce());
        expect(statuses()).toEqual({
          [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
          [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Sent,
        });
        expect(jobCase.feedItems()).toEqual([
          {
            moreInformationInMarkdown:
              "- Owner 1 (owner1@acme.test)\n- Owner 3 (owner3@acme.test)\n" +
              "\nNot notified again, as the on-call page reached them: Owner 2 (owner2@acme.test).\n",
          },
        ]);

        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
        await restartedMinutesLater(60);

        expect(sendsByOwner()).toEqual(everyOwnerButTheSecondOnce());
        expect(world.takes).toBe(1);
      });

      test("stopped before an owner's send: the next run tells the rest once, never the one the page reached, and its feed item never names them as told", async () => {
        pageTheSecondOwner();
        table.stopAt({ statement: "startTelling", userId: idOf(OWNER_3) });

        void runJob();
        await untilStopped();

        expect(world.sent).toEqual([idOf(OWNER_1)]);
        expect(statuses()).toEqual({
          [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
          [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
        });

        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
        await restartedMinutesLater(30);

        expect(sendsByOwner()).toEqual(everyOwnerButTheSecondOnce());

        const items: Array<{ moreInformationInMarkdown: string }> =
          jobCase.feedItems();

        expect(items).toHaveLength(1);
        expect(namesOwner(items[0]!.moreInformationInMarkdown, OWNER_1)).toBe(
          true,
        );
        expect(namesOwner(items[0]!.moreInformationInMarkdown, OWNER_3)).toBe(
          true,
        );
        expect(namesOwner(items[0]!.moreInformationInMarkdown, OWNER_2)).toBe(
          false,
        );
      });

      test("stopped after the last owner was told, before the feed item: the later run's item never names the one the page reached as told", async () => {
        pageTheSecondOwner();
        asMock(jobCase.feedService).mockImplementationOnce(async () => {
          world.stoppedAt.push("feed");
          await NEVER;
        });

        void runJob();
        await untilStopped();

        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
        await restartedMinutesLater(30);

        expect(sendsByOwner()).toEqual(everyOwnerButTheSecondOnce());

        // The call the stopped run never finished, and the later run's.
        const items: Array<{ moreInformationInMarkdown: string }> =
          jobCase.feedItems();

        expect(items).toHaveLength(2);
        expect(items[1]!.moreInformationInMarkdown).toBe(
          "- Owner 1 (owner1@acme.test)\n- Owner 3 (owner3@acme.test)\n",
        );
      });

      test("stopped before the take: the next run reads the page again, and leaves them out again", async () => {
        pageTheSecondOwner();
        world.takeStops = true;

        void runJob();
        await untilStopped();

        expect(statuses()).toEqual({
          [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Pending,
          [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Pending,
        });

        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
        await restartedMinutesLater(30);

        expect(sendsByOwner()).toEqual(everyOwnerButTheSecondOnce());
        expect(world.takes).toBe(1);
      });

      test("two workers at once tell the others once between them, and never the one the page reached", async () => {
        pageTheSecondOwner();
        table.interleave(true);

        await Promise.all([runJob(), runJob()]);

        table.interleave(false);
        await restartedMinutesLater(30);

        expect(sendsByOwner()).toEqual(everyOwnerButTheSecondOnce());
      });

      test("a page whose notification failed did not reach them: every owner is told once, as before", async () => {
        pageTheSecondOwner(UserNotificationStatus.Error);

        await runJob();

        expect(sendsByOwner()).toEqual(everyOwnerOnce());
      });

      test("the read of the page failing tells every owner once, as before", async () => {
        pageTheSecondOwner();
        pages.failWith(new Error("The database is away"));

        await runJob();
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );

        expect(sendsByOwner()).toEqual(everyOwnerOnce());
      });
    } else {
      test("a page about the record leaves nobody out: only a Created notification says what the page said", async () => {
        for (const column of PAGE_COLUMNS) {
          pages.add({
            projectId: PROJECT_ID,
            userId: OWNER_2.id!,
            [column]: jobCase.resourceId,
          });
        }

        await runJob();
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );

        expect(sendsByOwner()).toEqual(everyOwnerOnce());
        // Never asked.
        expect(pages.reads).toEqual([]);
      });
    }

    /*
     * THE RUN'S DEADLINE (#8862, #9019). Every job goes through
     * OwnerNotificationBacklog and stops at its run's deadline - its time
     * limit, or its lease lost: what it did not reach is left as it was, and
     * the next run tells each owner once. The reminder jobs too: a reminder
     * not reached is still due.
     */
    {
      test("a run whose deadline passed takes nothing and tells nobody; the next run tells each owner once", async () => {
        const deadline: JobDeadline = new JobDeadline();
        deadline.end();

        await runJob(deadline);

        expect(world.sent).toEqual([]);
        expect(world.takes).toBe(0);
        expect(world.isTaken).toBe(false);

        await restartedMinutesLater(1);

        expect(sendsByOwner()).toEqual(everyOwnerOnce());
        expect(world.takes).toBe(1);
      });

      test("a deadline that passes while the owners are told: they are all told, once, and nobody again", async () => {
        const deadline: JobDeadline = new JobDeadline();

        asMock(
          UserNotificationSettingService.sendUserNotification,
        ).mockImplementation(async (data: { userId: ObjectID }) => {
          world.sent.push(data.userId.toString());
          // The lease is lost as the first owner is told.
          deadline.end();
        });

        await runJob(deadline);

        // The record was taken before the deadline passed: its owners are told.
        expect(sendsByOwner()).toEqual(everyOwnerOnce());
        expect(world.takes).toBe(1);

        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );
        await restartedMinutesLater(30);

        expect(sendsByOwner()).toEqual(everyOwnerOnce());
        expect(world.takes).toBe(1);
      });
    }

    if (
      jobCase.kind === OwnerNotificationKind.IncidentPublicNotePosted ||
      jobCase.kind ===
        OwnerNotificationKind.ScheduledMaintenancePublicNotePosted
    ) {
      test("a public note is taken only while it is published: the take matches it, as the read does (#8862)", async () => {
        await runJob();

        const service: unknown =
          jobCase.kind === OwnerNotificationKind.IncidentPublicNotePosted
            ? IncidentPublicNoteService
            : ScheduledMaintenancePublicNoteService;
        const takesOf: Array<Array<unknown>> = asMock(
          serviceOf(service)["compareAndSetColumnsByIdWithoutHooks"],
        ).mock.calls;

        expect(takesOf).toHaveLength(1);
        expect(takesOf[0]![0]).toEqual(
          expect.objectContaining({
            data: { isOwnerNotified: true },
            expectedData: { isOwnerNotified: false, isPublished: true },
          }),
        );

        // Every page it read asked for published notes only.
        for (const call of asMock(serviceOf(service)["findBy"]).mock.calls) {
          expect((call[0] as { query: JSONObject }).query).toEqual(
            expect.objectContaining({
              isOwnerNotified: false,
              isPublished: true,
            }),
          );
        }
      });

      test("a public note no longer published when the next run takes its owners up: nobody else is told", async () => {
        table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
        void runJob();
        await untilStopped();

        world.isPublished = false;
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );

        expect(world.sent).toEqual([idOf(OWNER_1)]);
        expect(statuses()).toEqual({
          [idOf(OWNER_1)]: OwnerNotificationDeliveryStatus.Sent,
          [idOf(OWNER_2)]: OwnerNotificationDeliveryStatus.Failed,
          [idOf(OWNER_3)]: OwnerNotificationDeliveryStatus.Failed,
        });
      });
    }

    if (
      jobCase.kind === OwnerNotificationKind.IncidentReminder ||
      jobCase.kind === OwnerNotificationKind.AlertReminder ||
      jobCase.kind === OwnerNotificationKind.ScheduledMaintenanceReminder
    ) {
      test("a reminder taken up late, of a record resolved since, is not sent", async () => {
        table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
        void runJob();
        await untilStopped();

        world.isResolved = true;
        await restartedMinutesLater(
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
        );

        expect(world.sent).toEqual([idOf(OWNER_1)]);
        expect(statuses()[idOf(OWNER_3)]).toBe(
          OwnerNotificationDeliveryStatus.Failed,
        );
      });
    }

    if (
      jobCase.kind === OwnerNotificationKind.IncidentReminder ||
      jobCase.kind === OwnerNotificationKind.AlertReminder
    ) {
      test("the next reminder is another notification: told again, once", async () => {
        await runJob();

        // Half an hour on, the reminder is due again.
        world.isTaken = false;
        now = new Date(now.getTime() + 30 * 60 * 1000);

        const findBy: unknown =
          jobCase.kind === OwnerNotificationKind.IncidentReminder
            ? IncidentService.findBy
            : AlertService.findBy;

        asMock(findBy).mockImplementation(async () => {
          if (world.isTaken) {
            return [];
          }

          const record: Incident | Alert =
            jobCase.kind === OwnerNotificationKind.IncidentReminder
              ? incident()
              : alert();
          record.reminderNotificationSentCount = 1;
          return [record];
        });

        await runJob();

        expect(sendsByOwner()).toEqual({
          [idOf(OWNER_1)]: 2,
          [idOf(OWNER_2)]: 2,
          [idOf(OWNER_3)]: 2,
        });
        expect(Object.values(table.statusesOf(jobCase.eventId, 2))).toEqual([
          OwnerNotificationDeliveryStatus.Sent,
          OwnerNotificationDeliveryStatus.Sent,
          OwnerNotificationDeliveryStatus.Sent,
        ]);
      });
    }
  },
);

describe("the owners of an owner row", () => {
  /*
   * Regression (#8862): the owner rows of one incident - its team rows and
   * its user rows - are told of together, so a person both name is told once
   * even when the run's deadline passes before it reaches the user rows'
   * table. Told of a table at a time, the person was told again by the next
   * run, of the user row.
   */
  test("a person a team row and a user row both added is told once though the run stops at its deadline after the team rows", async () => {
    jest.clearAllMocks();
    useInMemoryOwnerNotificationDeliveries();

    const sent: Array<string> = [];
    const takenRows: Set<string> = new Set<string>();
    const deadline: JobDeadline = new JobDeadline();

    asMock(IncidentOwnerTeamService.findOneById).mockResolvedValue(null);
    asMock(IncidentService.findOneById).mockImplementation(async () => {
      return incident();
    });
    asMock(IncidentService.findBy).mockResolvedValue([incident()]);
    asMock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
      "https://oneuptime.test/incident",
    );

    const teamRow: IncidentOwnerTeam = new IncidentOwnerTeam(EVENT_ID);
    teamRow.incidentId = INCIDENT_ID;
    teamRow.teamId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");

    const userRow: { id: ObjectID; incidentId: ObjectID; user: User } = {
      id: new ObjectID("aaaaaaaa-0000-4000-8000-0000000000e2"),
      incidentId: INCIDENT_ID,
      user: OWNER_1,
    };

    // Each table answers its rows not taken yet, and takes each once.
    const stillToTell: (
      rows: Array<{ id: ObjectID | null }>,
    ) => () => Promise<Array<unknown>> = (
      rows: Array<{ id: ObjectID | null }>,
    ) => {
      return async (): Promise<Array<unknown>> => {
        return rows.filter((row: { id: ObjectID | null }): boolean => {
          return !takenRows.has(row.id!.toString());
        });
      };
    };
    const takeOnce: (data: {
      id: ObjectID;
    }) => Promise<boolean> = async (data: {
      id: ObjectID;
    }): Promise<boolean> => {
      if (takenRows.has(data.id.toString())) {
        return false;
      }

      takenRows.add(data.id.toString());
      return true;
    };

    asMock(IncidentOwnerTeamService.findBy).mockImplementation(
      stillToTell([teamRow]),
    );
    asMock(IncidentOwnerUserService.findBy).mockImplementation(
      stillToTell([userRow]),
    );
    asMock(
      IncidentOwnerTeamService.compareAndSetColumnsByIdWithoutHooks,
    ).mockImplementation(takeOnce);
    asMock(
      IncidentOwnerUserService.compareAndSetColumnsByIdWithoutHooks,
    ).mockImplementation(takeOnce);
    asMock(TeamMemberService.getUsersInTeams).mockResolvedValue([
      OWNER_1,
      OWNER_2,
    ]);
    asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
      async (data: { users: Array<User> }) => {
        return data.users;
      },
    );
    asMock(
      UserNotificationSettingService.sendUserNotification,
    ).mockImplementation(async (data: { userId: ObjectID }) => {
      sent.push(data.userId.toString());
      // The lease is lost while the team row's people are told.
      deadline.end();
    });

    await mockCapturedJobs["IncidentOwner:SendOwnerAddedEmail"]!(deadline);
    // The next run, on its own deadline.
    await mockCapturedJobs["IncidentOwner:SendOwnerAddedEmail"]!(
      new JobDeadline(),
    );

    expect(sent.sort()).toEqual([idOf(OWNER_1), idOf(OWNER_2)].sort());
    expect(takenRows).toEqual(
      new Set<string>([teamRow.id!.toString(), userRow.id.toString()]),
    );

    jest.restoreAllMocks();
  });

  test("a person a team row and a user row both added to an incident in the same run is told once", async () => {
    jest.clearAllMocks();
    useInMemoryOwnerNotificationDeliveries();

    const sent: Array<string> = [];

    asMock(IncidentService.findOneById).mockImplementation(async () => {
      return incident();
    });
    asMock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
      "https://oneuptime.test/incident",
    );

    const teamRow: IncidentOwnerTeam = new IncidentOwnerTeam(EVENT_ID);
    teamRow.incidentId = INCIDENT_ID;
    teamRow.teamId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c1");

    const userRow: { id: ObjectID; incidentId: ObjectID; user: User } = {
      id: new ObjectID("aaaaaaaa-0000-4000-8000-0000000000e2"),
      incidentId: INCIDENT_ID,
      user: OWNER_1,
    };

    // Read a page at a time, the incident's rows of both tables together (#8862).
    asMock(IncidentOwnerTeamService.findBy).mockResolvedValue([teamRow]);
    asMock(IncidentOwnerUserService.findBy).mockResolvedValue([userRow]);
    asMock(IncidentService.findBy).mockResolvedValue([incident()]);
    asMock(
      IncidentOwnerTeamService.compareAndSetColumnsByIdWithoutHooks,
    ).mockResolvedValue(true);
    asMock(
      IncidentOwnerUserService.compareAndSetColumnsByIdWithoutHooks,
    ).mockResolvedValue(true);
    asMock(TeamMemberService.getUsersInTeams).mockResolvedValue([
      OWNER_1,
      OWNER_2,
    ]);
    asMock(TeamMemberService.filterUsersToProjectMembers).mockImplementation(
      async (data: { users: Array<User> }) => {
        return data.users;
      },
    );
    asMock(
      UserNotificationSettingService.sendUserNotification,
    ).mockImplementation(async (data: { userId: ObjectID }) => {
      sent.push(data.userId.toString());
    });

    await mockCapturedJobs["IncidentOwner:SendOwnerAddedEmail"]!();

    expect(sent.sort()).toEqual([idOf(OWNER_1), idOf(OWNER_2)].sort());

    // Both rows are taken, once each, so neither is read again.
    expect(
      IncidentOwnerTeamService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);
    expect(
      IncidentOwnerUserService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
  });
});

/*
 * PEOPLE ASSIGNED TO AN INCIDENT WITH A ROLE (#8573). Each member row is a
 * notification of its own, to the one person it assigned, so its stops are
 * run here rather than through the cases above, which tell three owners of
 * one notification.
 */
describe("people assigned to an incident with a role", () => {
  const COMMANDER: ObjectID = new ObjectID(
    "aaaaaaaa-0000-4000-8000-0000000000f1",
  );
  const SCRIBE: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000f2");
  const ROLE_NAMES: Record<string, string> = {
    [COMMANDER.toString()]: "Incident Commander",
    [SCRIBE.toString()]: "Scribe",
  };

  let table: InMemoryOwnerNotificationDeliveries;
  let now: Date;
  let rows: Array<PlainRecord>;
  let marked: Set<string>;
  let sent: Array<{ userId: string; subject: string }>;
  let stoppedAt: Array<string>;
  let incidentExists: boolean;
  let sendStopsFor: string | null;
  let markStops: boolean;

  function memberRow(n: number, user: User, roleId: ObjectID): PlainRecord {
    return plain({
      id: new ObjectID(`aaaaaaaa-0000-4000-8000-00000000010${n}`),
      incidentId: INCIDENT_ID,
      userId: user.id,
      incidentRoleId: roleId,
      user: user,
    });
  }

  function rowIdOf(row: PlainRecord): string {
    return String(row["_id"]);
  }

  function run(): Promise<void> {
    return mockCapturedJobs["IncidentMember:SendMemberAddedEmail"]!();
  }

  async function untilStopped(): Promise<void> {
    for (let turn: number = 0; turn < 2000; turn++) {
      if (table.stops() + stoppedAt.length >= 1) {
        return;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }

    throw new Error("The run never reached the point it was to stop at.");
  }

  async function restartedMinutesLater(minutes: number): Promise<void> {
    now = new Date(now.getTime() + minutes * 60 * 1000);
    await run();
  }

  function sendsByPerson(): Record<string, number> {
    const sends: Record<string, number> = {};

    for (const send of sent) {
      sends[send.userId] = (sends[send.userId] || 0) + 1;
    }

    return sends;
  }

  function everyoneOnce(): Record<string, number> {
    return {
      [idOf(OWNER_1)]: 1,
      [idOf(OWNER_2)]: 1,
      [idOf(OWNER_3)]: 1,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    table = useInMemoryOwnerNotificationDeliveries();
    now = START;
    marked = new Set<string>();
    sent = [];
    stoppedAt = [];
    incidentExists = true;
    sendStopsFor = null;
    markStops = false;
    rows = [
      memberRow(1, OWNER_1, COMMANDER),
      memberRow(2, OWNER_2, SCRIBE),
      memberRow(3, OWNER_3, SCRIBE),
    ];

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(now.getTime());
    });

    // Read a page at a time, each row taken by one compare-and-set (#8862).
    asMock(IncidentMemberService.findBy).mockImplementation(async () => {
      return rows.filter((row: PlainRecord): boolean => {
        return !marked.has(rowIdOf(row));
      });
    });
    asMock(IncidentMemberService.findOneById).mockImplementation(
      async (data: { id: ObjectID }) => {
        return (
          rows.find((row: PlainRecord): boolean => {
            return rowIdOf(row) === data.id.toString();
          }) || null
        );
      },
    );
    asMock(
      IncidentMemberService.compareAndSetColumnsByIdWithoutHooks,
    ).mockImplementation(async (data: { id: ObjectID }) => {
      if (markStops) {
        markStops = false;
        stoppedAt.push("mark");
        await NEVER;
      }

      if (marked.has(data.id.toString())) {
        return false;
      }

      marked.add(data.id.toString());
      return true;
    });
    // The page's incidents, read with it.
    asMock(IncidentService.findBy).mockImplementation(async () => {
      return incidentExists ? [incident()] : [];
    });
    asMock(IncidentRoleService.findOneById).mockImplementation(
      async (data: { id: ObjectID }) => {
        return { name: ROLE_NAMES[data.id.toString()] };
      },
    );
    asMock(IncidentService.findOneById).mockImplementation(async () => {
      return incidentExists ? incident() : null;
    });
    asMock(IncidentService.getIncidentLinkInDashboard).mockResolvedValue(
      "https://oneuptime.test/incident",
    );
    asMock(UserService.findBy).mockImplementation(
      async (data: { query: JSONObject }) => {
        return usersNamedBy(OWNERS, data.query);
      },
    );
    asMock(
      UserNotificationSettingService.sendUserNotification,
    ).mockImplementation(
      async (data: {
        userId: ObjectID;
        emailEnvelope: { subject: string };
      }) => {
        const userId: string = data.userId.toString();

        sent.push({ userId: userId, subject: data.emailEnvelope.subject });

        if (sendStopsFor === userId) {
          sendStopsFor = null;
          stoppedAt.push(`send ${userId}`);
          await NEVER;
        }
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("tells each person assigned once, of the role their row gives, and the next run nobody", async () => {
    await run();

    expect(sendsByPerson()).toEqual(everyoneOnce());
    expect(
      sent.find((send: { userId: string }): boolean => {
        return send.userId === idOf(OWNER_1);
      })!.subject,
    ).toContain("You have been assigned as Incident Commander");
    expect(
      sent.find((send: { userId: string }): boolean => {
        return send.userId === idOf(OWNER_2);
      })!.subject,
    ).toContain("You have been assigned as Scribe");

    for (const row of rows) {
      expect(Object.values(table.statusesOf(rowIdOf(row)))).toEqual([
        OwnerNotificationDeliveryStatus.Sent,
      ]);
    }

    await restartedMinutesLater(
      OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
    );
    await restartedMinutesLater(60);

    expect(sendsByPerson()).toEqual(everyoneOnce());
  });

  test("whom a row is to tell is written down before the row is marked", async () => {
    markStops = true;
    void run();
    await untilStopped();

    expect(stoppedAt).toEqual(["mark"]);
    expect(sent).toEqual([]);

    // Each row is a notification of its own, planned and taken in turn (#8862).
    expect(Object.values(table.statusesOf(rowIdOf(rows[0]!)))).toEqual([
      OwnerNotificationDeliveryStatus.Pending,
    ]);
    expect(table.statusesOf(rowIdOf(rows[1]!))).toEqual({});
    expect(table.statusesOf(rowIdOf(rows[2]!))).toEqual({});

    // Started again: each person told once, whether the rows or the later run tells them.
    await restartedMinutesLater(
      OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
    );
    expect(sendsByPerson()).toEqual(everyoneOnce());
  });

  test("stopped before the second person's send: they and the third are told by a later run, each once", async () => {
    table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
    void run();
    await untilStopped();

    expect(sendsByPerson()).toEqual({ [idOf(OWNER_1)]: 1 });

    await restartedMinutesLater(
      OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
    );
    await restartedMinutesLater(30);

    expect(sendsByPerson()).toEqual(everyoneOnce());
    // Told of the role their row gives, by the later run too.
    expect(
      sent.find((send: { userId: string }): boolean => {
        return send.userId === idOf(OWNER_2);
      })!.subject,
    ).toContain("You have been assigned as Scribe");
  });

  test("stopped during the second person's send: they are never told again - nobody knows whether it went out - and the third is", async () => {
    sendStopsFor = idOf(OWNER_2);
    void run();
    await untilStopped();

    await restartedMinutesLater(
      OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
    );
    await restartedMinutesLater(30);

    // The second person's one send is the one the stopped run started.
    expect(sendsByPerson()).toEqual(everyoneOnce());
    expect(Object.values(table.statusesOf(rowIdOf(rows[1]!)))).toEqual([
      OwnerNotificationDeliveryStatus.Sending,
    ]);
  });

  test("two workers at once tell each person once between them", async () => {
    table.interleave(true);
    await Promise.all([run(), run()]);
    table.interleave(false);

    expect(sendsByPerson()).toEqual(everyoneOnce());
  });

  test("someone assigned twice, in two roles, is told of each, once", async () => {
    rows = [memberRow(1, OWNER_1, COMMANDER), memberRow(4, OWNER_1, SCRIBE)];

    await run();
    await restartedMinutesLater(30);

    expect(
      sent
        .map((send: { subject: string }): string => {
          return send.subject.includes("Commander") ? "Commander" : "Scribe";
        })
        .sort(),
    ).toEqual(["Commander", "Scribe"]);
    expect(sendsByPerson()).toEqual({ [idOf(OWNER_1)]: 2 });
  });

  test("an incident gone before a later run takes them up: nobody else is told", async () => {
    table.stopAt({ statement: "startTelling", userId: idOf(OWNER_2) });
    void run();
    await untilStopped();

    incidentExists = false;
    await restartedMinutesLater(
      OwnerNotificationDeliveries.RESUME_AFTER_MINUTES,
    );

    expect(sendsByPerson()).toEqual({ [idOf(OWNER_1)]: 1 });
    // The second person's row, set out on, is given up; the third tells nobody.
    expect(Object.values(table.statusesOf(rowIdOf(rows[1]!)))).toEqual([
      OwnerNotificationDeliveryStatus.Failed,
    ]);
    expect(table.statusesOf(rowIdOf(rows[2]!))).toEqual({});
    expect(marked.has(rowIdOf(rows[2]!))).toBe(true);
  });
});
