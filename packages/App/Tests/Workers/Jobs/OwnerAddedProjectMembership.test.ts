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
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
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

// The resources the notifications are about.
jest.mock("Common/Server/Services/AIAgentService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getEpisodeLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
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
    default: { findOneById: jest.fn(), getEpisodeLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
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
    default: { findOneById: jest.fn(), getLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ServiceLevelObjectiveService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getSloLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      getStatusPageLinkInDashboard: jest.fn(),
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

interface RowServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
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
];

// One owner team row and one owner user row per user, all on the resource.
function arrange(
  ownerAdded: OwnerAddedCase,
  data: { teamMembers: Array<User>; directOwners: Array<User> },
): void {
  ownerAdded.teamService.findAllBy.mockResolvedValue([
    {
      id: new ObjectID("owner-team-row"),
      [ownerAdded.resourceIdColumn]: RESOURCE_ID,
      teamId: TEAM_ID,
    },
  ]);
  ownerAdded.userService.findAllBy.mockResolvedValue(
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
      expect(ownerAdded.teamService.updateOneById).toHaveBeenCalledTimes(1);
      expect(ownerAdded.userService.updateOneById).toHaveBeenCalledTimes(2);
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
