import User from "Common/Models/DatabaseModels/User";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";

/*
 * The "you have been added as an owner" jobs expand each owner team through
 * TeamMemberService.getUsersInTeams, which returns every member row of the
 * team - pending invitations included. A pending invitee has no notification
 * settings until they accept, so the notification was dropped without a word
 * (and the SLO job, which seeds a missing setting first, actually reached
 * someone who never joined the project). A direct owner row can point at a
 * pending invitee too.
 *
 * Each job now hands the resource's project and everyone it collected to
 * TeamMemberService.filterUsersToProjectMembers - the helper findOwners uses -
 * and notifies only who comes back. These tests run every job's real cron
 * handler with its services mocked; the helper itself is covered in
 * Common/Tests/Server/Services/TeamMemberProjectMembership.test.ts.
 */

type CronHandler = () => Promise<void>;

// Declared before the hoisted jest.mock below, which may only close over "mock" names.
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

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, so it is replaced with a factory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: { hash: jest.fn(), verify: jest.fn() },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return { __esModule: true, default: { getDashboardUrl: jest.fn() } };
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

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      getUsersInTeams: jest.fn(),
      filterUsersToProjectMembers: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: { createGenericNotification: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/WhatsAppTemplateUtil", () => {
  return { createWhatsAppMessageFromTemplate: jest.fn() };
});

// The owner tables: rows to notify, marked notified after.
function mockOwnerRowService(): unknown {
  return {
    __esModule: true,
    default: {
      // Read a page at a time, with each record's rows (#8862).
      findBy: jest.fn(async () => {
        return [];
      }),
      // Each row taken by one hook-free compare-and-set.
      compareAndSetColumnsByIdWithoutHooks: jest.fn(async () => {
        return true;
      }),
    },
  };
}

jest.mock("Common/Server/Services/AIAgentOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/AIAgentOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/AlertEpisodeOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/AlertEpisodeOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/AlertOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/AlertOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/IncidentEpisodeOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/IncidentEpisodeOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/IncidentOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/IncidentOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/MonitorOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/MonitorOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/NetworkDeviceOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/NetworkDeviceOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ProbeOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ProbeOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService",
  () => {
    return mockOwnerRowService();
  },
);
jest.mock(
  "Common/Server/Services/ServiceLevelObjectiveOwnerUserService",
  () => {
    return mockOwnerRowService();
  },
);
jest.mock("Common/Server/Services/StatusPageOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/StatusPageOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DataAssetOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DataAssetOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DataPipelineOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DataPipelineOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DataStoreOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DataStoreOwnerUserService", () => {
  return mockOwnerRowService();
});
// The records whose owner rules told nobody until #9700.
jest.mock("Common/Server/Services/ServiceOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ServiceOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DatabaseServerOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DatabaseServerOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/MessageQueueOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/MessageQueueOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/RumApplicationOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/RumApplicationOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/HostOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/HostOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/KubernetesClusterOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/KubernetesClusterOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DockerHostOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DockerHostOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DockerSwarmClusterOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DockerSwarmClusterOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/PodmanHostOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/PodmanHostOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ProxmoxClusterOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ProxmoxClusterOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/OpenStackCloudOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/OpenStackCloudOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/VMwareVCenterOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/VMwareVCenterOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/CephClusterOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/CephClusterOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/StorageArrayOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/StorageArrayOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/IoTFleetOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/IoTFleetOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/CloudResourceOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/CloudResourceOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ServerlessFunctionOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/ServerlessFunctionOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DashboardOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/DashboardOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/WorkflowOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/WorkflowOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/RunbookOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/RunbookOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/OnCallDutyPolicyOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/OnCallDutyPolicyOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock(
  "Common/Server/Services/OnCallDutyPolicyScheduleOwnerTeamService",
  () => {
    return mockOwnerRowService();
  },
);
jest.mock(
  "Common/Server/Services/OnCallDutyPolicyScheduleOwnerUserService",
  () => {
    return mockOwnerRowService();
  },
);
jest.mock("Common/Server/Services/IncomingCallPolicyOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/IncomingCallPolicyOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/MonitorGroupOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/MonitorGroupOwnerUserService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/RunnerOwnerTeamService", () => {
  return mockOwnerRowService();
});
jest.mock("Common/Server/Services/RunnerOwnerUserService", () => {
  return mockOwnerRowService();
});

// The resources the notifications are about.
jest.mock("Common/Server/Services/AIAgentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getEpisodeLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      // The affected-resource reads: nothing linked.
      findAllBy: jest.fn(async () => {
        return [];
      }),
      getAlertLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getEpisodeLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      // The affected-resource reads: nothing linked.
      findAllBy: jest.fn(async () => {
        return [];
      }),
      getIncidentLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getMonitorDestinationInfo: jest.fn(),
      getMonitorLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceLevelObjectiveService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getSloLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getStatusPageLinkInDashboard: jest.fn(),
    },
  };
});

// Data Observability's tables and pipelines, and the data stores (#9681).
jest.mock("Common/Server/Services/DataAssetService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getDataAssetLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DataPipelineService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getDataPipelineLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DataStoreService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getDataStoreLinkInDashboard: jest.fn(),
      getDataObservabilityDatabaseLinkInDashboard: jest.fn(),
    },
  };
});

// Services, infrastructure, dashboards, workflows, runbooks, on-call (#9700).
jest.mock("Common/Server/Services/ServiceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getServiceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DatabaseServerService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getDatabaseServerLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MessageQueueService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getMessageQueueLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RumApplicationService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getHostLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/KubernetesClusterService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getKubernetesClusterLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DockerHostService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getDockerHostLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DockerSwarmClusterService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getDockerSwarmClusterLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/PodmanHostService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getPodmanHostLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProxmoxClusterService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getProxmoxClusterLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OpenStackCloudService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getOpenStackCloudLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/VMwareVCenterService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getVMwareVCenterLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/CephClusterService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getCephClusterLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StorageArrayService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getStorageArrayLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IoTFleetService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/CloudResourceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/ServerlessFunctionService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/DashboardService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/WorkflowService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/RunbookService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
      getOnCallDutyPolicyLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyScheduleService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/IncomingCallPolicyService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorGroupService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

jest.mock("Common/Server/Services/RunnerService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

import DatabaseConfig from "Common/Server/DatabaseConfig";
import AIAgentOwnerTeamService from "Common/Server/Services/AIAgentOwnerTeamService";
import AIAgentOwnerUserService from "Common/Server/Services/AIAgentOwnerUserService";
import AIAgentService from "Common/Server/Services/AIAgentService";
import AlertEpisodeOwnerTeamService from "Common/Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "Common/Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertOwnerTeamService from "Common/Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "Common/Server/Services/AlertOwnerUserService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeOwnerTeamService from "Common/Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "Common/Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentService from "Common/Server/Services/IncidentService";
import MonitorOwnerTeamService from "Common/Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "Common/Server/Services/MonitorOwnerUserService";
import MonitorService from "Common/Server/Services/MonitorService";
import NetworkDeviceOwnerTeamService from "Common/Server/Services/NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "Common/Server/Services/NetworkDeviceOwnerUserService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProbeOwnerTeamService from "Common/Server/Services/ProbeOwnerTeamService";
import ProbeOwnerUserService from "Common/Server/Services/ProbeOwnerUserService";
import ProbeService from "Common/Server/Services/ProbeService";
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ServiceLevelObjectiveOwnerTeamService from "Common/Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "Common/Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "Common/Server/Services/ServiceLevelObjectiveService";
import StatusPageOwnerTeamService from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "Common/Server/Services/StatusPageOwnerUserService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import DataAssetOwnerTeamService from "Common/Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "Common/Server/Services/DataAssetOwnerUserService";
import DataAssetService from "Common/Server/Services/DataAssetService";
import DataPipelineOwnerTeamService from "Common/Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "Common/Server/Services/DataPipelineOwnerUserService";
import DataPipelineService from "Common/Server/Services/DataPipelineService";
import DataStoreOwnerTeamService from "Common/Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "Common/Server/Services/DataStoreOwnerUserService";
import DataStoreService from "Common/Server/Services/DataStoreService";
import ServiceOwnerTeamService from "Common/Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "Common/Server/Services/ServiceOwnerUserService";
import ServiceService from "Common/Server/Services/ServiceService";
import DatabaseServerOwnerTeamService from "Common/Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "Common/Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import MessageQueueOwnerTeamService from "Common/Server/Services/MessageQueueOwnerTeamService";
import MessageQueueOwnerUserService from "Common/Server/Services/MessageQueueOwnerUserService";
import MessageQueueService from "Common/Server/Services/MessageQueueService";
import RumApplicationOwnerTeamService from "Common/Server/Services/RumApplicationOwnerTeamService";
import RumApplicationOwnerUserService from "Common/Server/Services/RumApplicationOwnerUserService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import HostOwnerTeamService from "Common/Server/Services/HostOwnerTeamService";
import HostOwnerUserService from "Common/Server/Services/HostOwnerUserService";
import HostService from "Common/Server/Services/HostService";
import KubernetesClusterOwnerTeamService from "Common/Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "Common/Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import DockerHostOwnerTeamService from "Common/Server/Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "Common/Server/Services/DockerHostOwnerUserService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerSwarmClusterOwnerTeamService from "Common/Server/Services/DockerSwarmClusterOwnerTeamService";
import DockerSwarmClusterOwnerUserService from "Common/Server/Services/DockerSwarmClusterOwnerUserService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import PodmanHostOwnerTeamService from "Common/Server/Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "Common/Server/Services/PodmanHostOwnerUserService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import ProxmoxClusterOwnerTeamService from "Common/Server/Services/ProxmoxClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "Common/Server/Services/ProxmoxClusterOwnerUserService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import OpenStackCloudOwnerTeamService from "Common/Server/Services/OpenStackCloudOwnerTeamService";
import OpenStackCloudOwnerUserService from "Common/Server/Services/OpenStackCloudOwnerUserService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import VMwareVCenterOwnerTeamService from "Common/Server/Services/VMwareVCenterOwnerTeamService";
import VMwareVCenterOwnerUserService from "Common/Server/Services/VMwareVCenterOwnerUserService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import CephClusterOwnerTeamService from "Common/Server/Services/CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "Common/Server/Services/CephClusterOwnerUserService";
import CephClusterService from "Common/Server/Services/CephClusterService";
import StorageArrayOwnerTeamService from "Common/Server/Services/StorageArrayOwnerTeamService";
import StorageArrayOwnerUserService from "Common/Server/Services/StorageArrayOwnerUserService";
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import IoTFleetOwnerTeamService from "Common/Server/Services/IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "Common/Server/Services/IoTFleetOwnerUserService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import CloudResourceOwnerTeamService from "Common/Server/Services/CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "Common/Server/Services/CloudResourceOwnerUserService";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import ServerlessFunctionOwnerTeamService from "Common/Server/Services/ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "Common/Server/Services/ServerlessFunctionOwnerUserService";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import DashboardOwnerTeamService from "Common/Server/Services/DashboardOwnerTeamService";
import DashboardOwnerUserService from "Common/Server/Services/DashboardOwnerUserService";
import DashboardService from "Common/Server/Services/DashboardService";
import WorkflowOwnerTeamService from "Common/Server/Services/WorkflowOwnerTeamService";
import WorkflowOwnerUserService from "Common/Server/Services/WorkflowOwnerUserService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import RunbookOwnerTeamService from "Common/Server/Services/RunbookOwnerTeamService";
import RunbookOwnerUserService from "Common/Server/Services/RunbookOwnerUserService";
import RunbookService from "Common/Server/Services/RunbookService";
import OnCallDutyPolicyOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "Common/Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyScheduleOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleOwnerUserService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerUserService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import IncomingCallPolicyOwnerTeamService from "Common/Server/Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "Common/Server/Services/IncomingCallPolicyOwnerUserService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import MonitorGroupOwnerTeamService from "Common/Server/Services/MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService from "Common/Server/Services/MonitorGroupOwnerUserService";
import MonitorGroupService from "Common/Server/Services/MonitorGroupService";
import RunnerOwnerTeamService from "Common/Server/Services/RunnerOwnerTeamService";
import RunnerOwnerUserService from "Common/Server/Services/RunnerOwnerUserService";
import RunnerService from "Common/Server/Services/RunnerService";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/AIAgent/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/MonitorOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/NetworkDeviceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/Probe/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/SloOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/StatusPageOwners/SendOwnerAddedNotification";
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
import "../../../FeatureSet/Workers/Jobs/MonitorGroupOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/RunnerOwners/SendOwnerAddedNotification";

interface RowServiceMock {
  findBy: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
}

interface ResourceServiceMock {
  findOneById: jest.Mock;
}

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const RESOURCE_ID: ObjectID = new ObjectID("resource-1");
const TEAM_ID: ObjectID = new ObjectID("team-owners");
const RESOURCE_LINK: URL = URL.fromString(
  "https://oneuptime.test/dashboard/resource-1",
);

function person(id: string): User {
  const user: User = new User(new ObjectID(id));
  user.email = new Email(`${id}@acme.test`);
  return user;
}

// Accepted members of the project.
const TEAM_MEMBER: User = person("user-team-member");
const DIRECT_MEMBER: User = person("user-direct-member");
// Invited, never accepted.
const TEAM_PENDING: User = person("user-team-pending");
const DIRECT_PENDING: User = person("user-direct-pending");

const PROJECT_MEMBER_IDS: Set<string> = new Set<string>([
  TEAM_MEMBER.id!.toString(),
  DIRECT_MEMBER.id!.toString(),
]);

/*
 * One resource carrying every field any of the jobs reads. Each job selects
 * and reads its own subset.
 */
function resource(): unknown {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    project: { name: "Acme" },
    title: "Checkout latency",
    name: "Checkout",
    description: "",
    incidentNumber: 12,
    alertNumber: 12,
    episodeNumber: 12,
    scheduledMaintenanceNumber: 12,
    monitors: [],
    currentIncidentState: { name: "Identified" },
    currentAlertState: { name: "Firing" },
    currentScheduledMaintenanceState: { name: "Scheduled" },
    currentMonitorStatus: { name: "Operational" },
    incidentSeverity: { name: "Major" },
    alertSeverity: { name: "High" },
    targetPercentage: 99.9,
    windowDays: 30,
  };
}

interface OwnerAddedCase {
  job: string;
  teamService: RowServiceMock;
  userService: RowServiceMock;
  resourceIdColumn: string;
  resourceService: ResourceServiceMock;
}

const OWNER_ADDED_CASES: Array<OwnerAddedCase> = [
  {
    job: "IncidentOwner:SendOwnerAddedEmail",
    teamService: IncidentOwnerTeamService as unknown as RowServiceMock,
    userService: IncidentOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "incidentId",
    resourceService: IncidentService as unknown as ResourceServiceMock,
  },
  {
    job: "AlertOwner:SendOwnerAddedEmail",
    teamService: AlertOwnerTeamService as unknown as RowServiceMock,
    userService: AlertOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "alertId",
    resourceService: AlertService as unknown as ResourceServiceMock,
  },
  {
    job: "MonitorOwner:SendOwnerAddedEmail",
    teamService: MonitorOwnerTeamService as unknown as RowServiceMock,
    userService: MonitorOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "monitorId",
    resourceService: MonitorService as unknown as ResourceServiceMock,
  },
  {
    job: "StatusPageOwner:SendOwnerAddedEmail",
    teamService: StatusPageOwnerTeamService as unknown as RowServiceMock,
    userService: StatusPageOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "statusPageId",
    resourceService: StatusPageService as unknown as ResourceServiceMock,
  },
  {
    job: "ScheduledMaintenanceOwner:SendOwnerAddedEmail",
    teamService:
      ScheduledMaintenanceOwnerTeamService as unknown as RowServiceMock,
    userService:
      ScheduledMaintenanceOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "scheduledMaintenanceId",
    resourceService:
      ScheduledMaintenanceService as unknown as ResourceServiceMock,
  },
  {
    job: "AlertEpisodeOwner:SendOwnerAddedEmail",
    teamService: AlertEpisodeOwnerTeamService as unknown as RowServiceMock,
    userService: AlertEpisodeOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "alertEpisodeId",
    resourceService: AlertEpisodeService as unknown as ResourceServiceMock,
  },
  {
    job: "IncidentEpisodeOwner:SendOwnerAddedEmail",
    teamService: IncidentEpisodeOwnerTeamService as unknown as RowServiceMock,
    userService: IncidentEpisodeOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "incidentEpisodeId",
    resourceService: IncidentEpisodeService as unknown as ResourceServiceMock,
  },
  {
    job: "SloOwners:SendOwnerAddedNotification",
    teamService:
      ServiceLevelObjectiveOwnerTeamService as unknown as RowServiceMock,
    userService:
      ServiceLevelObjectiveOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "serviceLevelObjectiveId",
    resourceService:
      ServiceLevelObjectiveService as unknown as ResourceServiceMock,
  },
  {
    job: "ProbeOwner:SendOwnerAddedEmail",
    teamService: ProbeOwnerTeamService as unknown as RowServiceMock,
    userService: ProbeOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "probeId",
    resourceService: ProbeService as unknown as ResourceServiceMock,
  },
  {
    job: "NetworkDeviceOwner:SendOwnerAddedEmail",
    teamService: NetworkDeviceOwnerTeamService as unknown as RowServiceMock,
    userService: NetworkDeviceOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "networkDeviceId",
    resourceService: NetworkDeviceService as unknown as ResourceServiceMock,
  },
  {
    job: "AIAgentOwner:SendOwnerAddedEmail",
    teamService: AIAgentOwnerTeamService as unknown as RowServiceMock,
    userService: AIAgentOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "aiAgentId",
    resourceService: AIAgentService as unknown as ResourceServiceMock,
  },
  // Data Observability's tables and pipelines, and the data stores (#9681).
  {
    job: "DataAssetOwner:SendOwnerAddedNotification",
    teamService: DataAssetOwnerTeamService as unknown as RowServiceMock,
    userService: DataAssetOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "dataAssetId",
    resourceService: DataAssetService as unknown as ResourceServiceMock,
  },
  {
    job: "DataPipelineOwner:SendOwnerAddedNotification",
    teamService: DataPipelineOwnerTeamService as unknown as RowServiceMock,
    userService: DataPipelineOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "dataPipelineId",
    resourceService: DataPipelineService as unknown as ResourceServiceMock,
  },
  {
    job: "DataStoreOwner:SendOwnerAddedNotification",
    teamService: DataStoreOwnerTeamService as unknown as RowServiceMock,
    userService: DataStoreOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "dataStoreId",
    resourceService: DataStoreService as unknown as ResourceServiceMock,
  },
  // Services, infrastructure, dashboards, workflows, runbooks, on-call (#9700).
  {
    job: "ServiceOwner:SendOwnerAddedNotification",
    teamService: ServiceOwnerTeamService as unknown as RowServiceMock,
    userService: ServiceOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "serviceId",
    resourceService: ServiceService as unknown as ResourceServiceMock,
  },
  {
    job: "DatabaseServerOwner:SendOwnerAddedNotification",
    teamService: DatabaseServerOwnerTeamService as unknown as RowServiceMock,
    userService: DatabaseServerOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "databaseServerId",
    resourceService: DatabaseServerService as unknown as ResourceServiceMock,
  },
  {
    job: "MessageQueueOwner:SendOwnerAddedNotification",
    teamService: MessageQueueOwnerTeamService as unknown as RowServiceMock,
    userService: MessageQueueOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "messageQueueId",
    resourceService: MessageQueueService as unknown as ResourceServiceMock,
  },
  {
    job: "RumApplicationOwner:SendOwnerAddedNotification",
    teamService: RumApplicationOwnerTeamService as unknown as RowServiceMock,
    userService: RumApplicationOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "rumApplicationId",
    resourceService: RumApplicationService as unknown as ResourceServiceMock,
  },
  {
    job: "HostOwner:SendOwnerAddedNotification",
    teamService: HostOwnerTeamService as unknown as RowServiceMock,
    userService: HostOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "hostId",
    resourceService: HostService as unknown as ResourceServiceMock,
  },
  {
    job: "KubernetesClusterOwner:SendOwnerAddedNotification",
    teamService: KubernetesClusterOwnerTeamService as unknown as RowServiceMock,
    userService: KubernetesClusterOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "kubernetesClusterId",
    resourceService: KubernetesClusterService as unknown as ResourceServiceMock,
  },
  {
    job: "DockerHostOwner:SendOwnerAddedNotification",
    teamService: DockerHostOwnerTeamService as unknown as RowServiceMock,
    userService: DockerHostOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "dockerHostId",
    resourceService: DockerHostService as unknown as ResourceServiceMock,
  },
  {
    job: "DockerSwarmClusterOwner:SendOwnerAddedNotification",
    teamService:
      DockerSwarmClusterOwnerTeamService as unknown as RowServiceMock,
    userService:
      DockerSwarmClusterOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "dockerSwarmClusterId",
    resourceService:
      DockerSwarmClusterService as unknown as ResourceServiceMock,
  },
  {
    job: "PodmanHostOwner:SendOwnerAddedNotification",
    teamService: PodmanHostOwnerTeamService as unknown as RowServiceMock,
    userService: PodmanHostOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "podmanHostId",
    resourceService: PodmanHostService as unknown as ResourceServiceMock,
  },
  {
    job: "ProxmoxClusterOwner:SendOwnerAddedNotification",
    teamService: ProxmoxClusterOwnerTeamService as unknown as RowServiceMock,
    userService: ProxmoxClusterOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "proxmoxClusterId",
    resourceService: ProxmoxClusterService as unknown as ResourceServiceMock,
  },
  {
    job: "OpenStackCloudOwner:SendOwnerAddedNotification",
    teamService: OpenStackCloudOwnerTeamService as unknown as RowServiceMock,
    userService: OpenStackCloudOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "openStackCloudId",
    resourceService: OpenStackCloudService as unknown as ResourceServiceMock,
  },
  {
    job: "VMwareVCenterOwner:SendOwnerAddedNotification",
    teamService: VMwareVCenterOwnerTeamService as unknown as RowServiceMock,
    userService: VMwareVCenterOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "vmwareVCenterId",
    resourceService: VMwareVCenterService as unknown as ResourceServiceMock,
  },
  {
    job: "CephClusterOwner:SendOwnerAddedNotification",
    teamService: CephClusterOwnerTeamService as unknown as RowServiceMock,
    userService: CephClusterOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "cephClusterId",
    resourceService: CephClusterService as unknown as ResourceServiceMock,
  },
  {
    job: "StorageArrayOwner:SendOwnerAddedNotification",
    teamService: StorageArrayOwnerTeamService as unknown as RowServiceMock,
    userService: StorageArrayOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "storageArrayId",
    resourceService: StorageArrayService as unknown as ResourceServiceMock,
  },
  {
    job: "IoTFleetOwner:SendOwnerAddedNotification",
    teamService: IoTFleetOwnerTeamService as unknown as RowServiceMock,
    userService: IoTFleetOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "iotFleetId",
    resourceService: IoTFleetService as unknown as ResourceServiceMock,
  },
  {
    job: "CloudResourceOwner:SendOwnerAddedNotification",
    teamService: CloudResourceOwnerTeamService as unknown as RowServiceMock,
    userService: CloudResourceOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "cloudResourceId",
    resourceService: CloudResourceService as unknown as ResourceServiceMock,
  },
  {
    job: "ServerlessFunctionOwner:SendOwnerAddedNotification",
    teamService:
      ServerlessFunctionOwnerTeamService as unknown as RowServiceMock,
    userService:
      ServerlessFunctionOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "serverlessFunctionId",
    resourceService:
      ServerlessFunctionService as unknown as ResourceServiceMock,
  },
  {
    job: "DashboardOwner:SendOwnerAddedNotification",
    teamService: DashboardOwnerTeamService as unknown as RowServiceMock,
    userService: DashboardOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "dashboardId",
    resourceService: DashboardService as unknown as ResourceServiceMock,
  },
  {
    job: "WorkflowOwner:SendOwnerAddedNotification",
    teamService: WorkflowOwnerTeamService as unknown as RowServiceMock,
    userService: WorkflowOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "workflowId",
    resourceService: WorkflowService as unknown as ResourceServiceMock,
  },
  {
    job: "RunbookOwner:SendOwnerAddedNotification",
    teamService: RunbookOwnerTeamService as unknown as RowServiceMock,
    userService: RunbookOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "runbookId",
    resourceService: RunbookService as unknown as ResourceServiceMock,
  },
  {
    job: "OnCallDutyPolicyOwner:SendOwnerAddedNotification",
    teamService: OnCallDutyPolicyOwnerTeamService as unknown as RowServiceMock,
    userService: OnCallDutyPolicyOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "onCallDutyPolicyId",
    resourceService: OnCallDutyPolicyService as unknown as ResourceServiceMock,
  },
  {
    job: "OnCallDutyPolicyScheduleOwner:SendOwnerAddedNotification",
    teamService:
      OnCallDutyPolicyScheduleOwnerTeamService as unknown as RowServiceMock,
    userService:
      OnCallDutyPolicyScheduleOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "onCallDutyPolicyScheduleId",
    resourceService:
      OnCallDutyPolicyScheduleService as unknown as ResourceServiceMock,
  },
  {
    job: "IncomingCallPolicyOwner:SendOwnerAddedNotification",
    teamService:
      IncomingCallPolicyOwnerTeamService as unknown as RowServiceMock,
    userService:
      IncomingCallPolicyOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "incomingCallPolicyId",
    resourceService:
      IncomingCallPolicyService as unknown as ResourceServiceMock,
  },
  // #9758: a monitor group's and a Runner's, added on their Owners pages.
  {
    job: "MonitorGroupOwner:SendOwnerAddedNotification",
    teamService: MonitorGroupOwnerTeamService as unknown as RowServiceMock,
    userService: MonitorGroupOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "monitorGroupId",
    resourceService: MonitorGroupService as unknown as ResourceServiceMock,
  },
  {
    job: "RunnerOwner:SendOwnerAddedNotification",
    teamService: RunnerOwnerTeamService as unknown as RowServiceMock,
    userService: RunnerOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "runnerId",
    resourceService: RunnerService as unknown as ResourceServiceMock,
  },
];

// One owner team row and one owner user row per user, all on the resource.
function arrange(
  ownerAdded: OwnerAddedCase,
  data: { teamMembers: Array<User>; directOwners: Array<User> },
): void {
  ownerAdded.teamService.findBy.mockResolvedValue([
    {
      id: new ObjectID("owner-team-row"),
      [ownerAdded.resourceIdColumn]: RESOURCE_ID,
      teamId: TEAM_ID,
    },
  ]);
  ownerAdded.userService.findBy.mockResolvedValue(
    data.directOwners.map((user: User, index: number): unknown => {
      return {
        id: new ObjectID(`owner-user-row-${index}`),
        [ownerAdded.resourceIdColumn]: RESOURCE_ID,
        userId: user.id,
        user: user,
      };
    }),
  );
  (TeamMemberService.getUsersInTeams as jest.Mock).mockResolvedValue(
    data.teamMembers,
  );
  ownerAdded.resourceService.findOneById.mockResolvedValue(resource());
}

function notifiedUserIds(): Array<string> {
  return (
    UserNotificationSettingService.sendUserNotification as jest.Mock
  ).mock.calls.map((call: Array<{ userId: ObjectID }>): string => {
    return call[0]!.userId.toString();
  });
}

beforeEach(() => {
  jest.clearAllMocks();

  (
    TeamMemberService.filterUsersToProjectMembers as jest.Mock
  ).mockImplementation(
    async (data: { users: Array<User> }): Promise<Array<User>> => {
      return data.users.filter((user: User): boolean => {
        return PROJECT_MEMBER_IDS.has(user.id!.toString());
      });
    },
  );

  (DatabaseConfig.getDashboardUrl as jest.Mock).mockResolvedValue(
    URL.fromString("https://oneuptime.test/dashboard"),
  );
  (MonitorService.getMonitorDestinationInfo as jest.Mock).mockReturnValue({
    monitorDestination: "",
    requestType: "",
    monitorType: "",
  });

  for (const link of [
    IncidentService.getIncidentLinkInDashboard,
    AlertService.getAlertLinkInDashboard,
    MonitorService.getMonitorLinkInDashboard,
    StatusPageService.getStatusPageLinkInDashboard,
    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard,
    AlertEpisodeService.getEpisodeLinkInDashboard,
    IncidentEpisodeService.getEpisodeLinkInDashboard,
    ServiceLevelObjectiveService.getSloLinkInDashboard,
    ProbeService.getLinkInDashboard,
    AIAgentService.getLinkInDashboard,
    DataAssetService.getDataAssetLinkInDashboard,
    DataPipelineService.getDataPipelineLinkInDashboard,
    DataStoreService.getDataStoreLinkInDashboard,
    DataStoreService.getDataObservabilityDatabaseLinkInDashboard,
    ServiceService.getServiceLinkInDashboard,
    DatabaseServerService.getDatabaseServerLinkInDashboard,
    MessageQueueService.getMessageQueueLinkInDashboard,
    HostService.getHostLinkInDashboard,
    KubernetesClusterService.getKubernetesClusterLinkInDashboard,
    DockerHostService.getDockerHostLinkInDashboard,
    DockerSwarmClusterService.getDockerSwarmClusterLinkInDashboard,
    PodmanHostService.getPodmanHostLinkInDashboard,
    ProxmoxClusterService.getProxmoxClusterLinkInDashboard,
    OpenStackCloudService.getOpenStackCloudLinkInDashboard,
    VMwareVCenterService.getVMwareVCenterLinkInDashboard,
    CephClusterService.getCephClusterLinkInDashboard,
    StorageArrayService.getStorageArrayLinkInDashboard,
    OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard,
  ]) {
    (link as jest.Mock).mockResolvedValue(RESOURCE_LINK);
  }
});

describe("an owner-added notification", () => {
  test.each(OWNER_ADDED_CASES)(
    "$job reaches only the project's accepted members: not a pending invitee of the owner team, not a pending direct owner",
    async (ownerAdded: OwnerAddedCase) => {
      arrange(ownerAdded, {
        teamMembers: [TEAM_MEMBER, TEAM_PENDING],
        directOwners: [DIRECT_MEMBER, DIRECT_PENDING],
      });

      await mockCapturedJobs[ownerAdded.job]!();

      expect(notifiedUserIds()).toEqual([
        TEAM_MEMBER.id!.toString(),
        DIRECT_MEMBER.id!.toString(),
      ]);

      // Everyone collected for the resource, checked against its own project.
      const filter: jest.Mock =
        TeamMemberService.filterUsersToProjectMembers as jest.Mock;
      expect(filter).toHaveBeenCalledTimes(1);
      expect(filter.mock.calls[0]![0].projectId.toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(filter.mock.calls[0]![0].users).toEqual([
        TEAM_MEMBER,
        TEAM_PENDING,
        DIRECT_MEMBER,
        DIRECT_PENDING,
      ]);

      for (const call of (
        UserNotificationSettingService.sendUserNotification as jest.Mock
      ).mock.calls) {
        expect(call[0].projectId.toString()).toBe(PROJECT_ID.toString());
      }

      // Rows are still marked notified, so a pending row is not retried every minute.
      expect(
        ownerAdded.teamService.compareAndSetColumnsByIdWithoutHooks,
      ).toHaveBeenCalledTimes(1);
      expect(
        ownerAdded.userService.compareAndSetColumnsByIdWithoutHooks,
      ).toHaveBeenCalledTimes(2);
    },
  );

  test.each(OWNER_ADDED_CASES)(
    "$job sends nothing when every owner is a pending invitee",
    async (ownerAdded: OwnerAddedCase) => {
      arrange(ownerAdded, {
        teamMembers: [TEAM_PENDING],
        directOwners: [DIRECT_PENDING],
      });

      await mockCapturedJobs[ownerAdded.job]!();

      expect(
        UserNotificationSettingService.sendUserNotification,
      ).not.toHaveBeenCalled();
      expect(
        UserNotificationSettingService.ensureSettingExistsForUser,
      ).not.toHaveBeenCalled();
    },
  );
});

describe("SloOwners:SendOwnerAddedNotification", () => {
  /*
   * The SLO job seeds the event's notification setting before it sends, so
   * for this job a pending invitee was not just a dropped send: the seed made
   * it deliverable.
   */
  test("seeds a notification setting only for the accepted members", async () => {
    arrange(OWNER_ADDED_CASES[7]!, {
      teamMembers: [TEAM_MEMBER, TEAM_PENDING],
      directOwners: [DIRECT_PENDING],
    });

    await mockCapturedJobs["SloOwners:SendOwnerAddedNotification"]!();

    const seeded: Array<string> = (
      UserNotificationSettingService.ensureSettingExistsForUser as jest.Mock
    ).mock.calls.map((call: Array<{ userId: ObjectID }>): string => {
      return call[0]!.userId.toString();
    });

    expect(seeded).toEqual([TEAM_MEMBER.id!.toString()]);
  });
});
