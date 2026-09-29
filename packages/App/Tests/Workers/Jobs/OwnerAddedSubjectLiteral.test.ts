import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import User from "Common/Models/DatabaseModels/User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import ObjectID from "Common/Types/ObjectID";

/*
 * The "you have been added" jobs put the resource's title - or, for an AI
 * agent, its name - straight into the email subject, and those are typed by
 * users. The mailer used to compile every subject through Handlebars against
 * the email's variables, so a title quoting "{{ .Values.image.tag }}" came out
 * with that text missing, and one with a lone "{{" failed to parse and the
 * owner got no email at all.
 *
 * Each job now marks its subject as already rendered. These tests run each
 * job's real cron handler with its services mocked and read the envelope it
 * hands UserNotificationSettingService: the flag is set, and the title reaches
 * the subject exactly as its author wrote it. What the mailer does with such an
 * envelope is pinned end to end in
 * Tests/Notification/OwnerEmailSubjectLiteral.test.ts.
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

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return { __esModule: true, default: { sendUserNotification: jest.fn() } };
});

// Every owner here is a project member; membership has its own suite.
jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      getUsersInTeams: jest.fn(),
      filterUsersToProjectMembers: jest.fn(
        async (data: { users: Array<unknown> }): Promise<Array<unknown>> => {
          return data.users;
        },
      ),
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

// The owner, member and role tables: rows to notify, marked notified after.
jest.mock("Common/Server/Services/IncidentOwnerTeamService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentOwnerUserService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertOwnerTeamService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertOwnerUserService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerTeamService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceOwnerUserService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeOwnerTeamService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeOwnerUserService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeOwnerTeamService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeOwnerUserService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AIAgentOwnerTeamService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AIAgentOwnerUserService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentMemberService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentRoleService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});

// The resources the emails are about.
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

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      getScheduledMaintenanceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getEpisodeLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getEpisodeLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AIAgentService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), getLinkInDashboard: jest.fn() },
  };
});

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
import IncidentMemberService from "Common/Server/Services/IncidentMemberService";
import IncidentOwnerTeamService from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "Common/Server/Services/IncidentOwnerUserService";
import IncidentRoleService from "Common/Server/Services/IncidentRoleService";
import IncidentService from "Common/Server/Services/IncidentService";
import ScheduledMaintenanceOwnerTeamService from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../FeatureSet/Workers/Jobs/AIAgent/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/AlertOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentMembers/SendMemberAddedNotification";
import "../../../FeatureSet/Workers/Jobs/IncidentOwners/SendOwnerAddedNotification";
import "../../../FeatureSet/Workers/Jobs/ScheduledMaintenanceOwners/SendOwnerAddedNotification";

interface RowServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
}

interface ResourceServiceMock {
  findOneById: jest.Mock;
}

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const RESOURCE_ID: ObjectID = new ObjectID("resource-1");
const RESOURCE_LINK: URL = URL.fromString(
  "https://oneuptime.test/dashboard/resource-1",
);

// Titles and names as their authors typed them.
const TITLE: string = "Rollout of {{ .Values.image.tag }} stalled";
const AI_AGENT_NAME: string = "{{ .Release.Name }} remediation agent";
const ROLE_NAME: string = "Comms {{ lead }}";

function project(): Project {
  const acme: Project = new Project();
  acme.name = "Acme";
  return acme;
}

function incident(): Incident {
  const model: Incident = new Incident(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.description = "";
  model.incidentNumber = 12;
  model.monitors = [];

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  model.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  model.incidentSeverity = severity;

  return model;
}

function alert(): Alert {
  const model: Alert = new Alert(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.description = "";
  model.alertNumber = 12;

  const state: AlertState = new AlertState();
  state.name = "Firing";
  model.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;

  return model;
}

function scheduledMaintenance(): ScheduledMaintenance {
  const model: ScheduledMaintenance = new ScheduledMaintenance(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.description = "";
  model.scheduledMaintenanceNumber = 12;

  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state.name = "Scheduled";
  model.currentScheduledMaintenanceState = state;

  return model;
}

function alertEpisode(): AlertEpisode {
  const model: AlertEpisode = new AlertEpisode(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.description = "";
  model.episodeNumber = 12;

  const state: AlertState = new AlertState();
  state.name = "Firing";
  model.currentAlertState = state;

  return model;
}

function incidentEpisode(): IncidentEpisode {
  const model: IncidentEpisode = new IncidentEpisode(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = TITLE;
  model.description = "";
  model.episodeNumber = 12;

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  model.currentIncidentState = state;

  return model;
}

function aiAgent(): AIAgent {
  const model: AIAgent = new AIAgent(RESOURCE_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.name = AI_AGENT_NAME;
  return model;
}

function owner(): User {
  const user: User = new User(new ObjectID("user-1"));
  user.email = new Email("owner@acme.test");
  return user;
}

/*
 * One pending owner row pointing at the resource. The column that names the
 * resource differs per table (incidentId, alertEpisodeId, ...).
 */
function ownerRow(resourceIdColumn: string): unknown {
  return {
    id: new ObjectID("owner-row-1"),
    [resourceIdColumn]: RESOURCE_ID,
    user: owner(),
  };
}

function sentEnvelope(): EmailEnvelope {
  const sendUserNotification: jest.Mock =
    UserNotificationSettingService.sendUserNotification as jest.Mock;

  expect(sendUserNotification).toHaveBeenCalledTimes(1);

  return sendUserNotification.mock.calls[0][0].emailEnvelope as EmailEnvelope;
}

interface OwnerAddedCase {
  job: string;
  teamService: RowServiceMock;
  userService: RowServiceMock;
  resourceIdColumn: string;
  resourceService: ResourceServiceMock;
  resource: () => BaseModel;
  subject: string;
}

const OWNER_ADDED_CASES: Array<OwnerAddedCase> = [
  {
    job: "IncidentOwner:SendOwnerAddedEmail",
    teamService: IncidentOwnerTeamService as unknown as RowServiceMock,
    userService: IncidentOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "incidentId",
    resourceService: IncidentService as unknown as ResourceServiceMock,
    resource: incident,
    subject: `You have been added as the owner of Incident #12 - ${TITLE}`,
  },
  {
    job: "AlertOwner:SendOwnerAddedEmail",
    teamService: AlertOwnerTeamService as unknown as RowServiceMock,
    userService: AlertOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "alertId",
    resourceService: AlertService as unknown as ResourceServiceMock,
    resource: alert,
    subject: `You have been added as the owner of Alert #12 - ${TITLE}`,
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
    resource: scheduledMaintenance,
    subject: `You have been added as the owner of Scheduled Maintenance #12 - ${TITLE}`,
  },
  {
    job: "AlertEpisodeOwner:SendOwnerAddedEmail",
    teamService: AlertEpisodeOwnerTeamService as unknown as RowServiceMock,
    userService: AlertEpisodeOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "alertEpisodeId",
    resourceService: AlertEpisodeService as unknown as ResourceServiceMock,
    resource: alertEpisode,
    subject: `You have been added as the owner of Alert Episode #12 - ${TITLE}`,
  },
  {
    job: "IncidentEpisodeOwner:SendOwnerAddedEmail",
    teamService: IncidentEpisodeOwnerTeamService as unknown as RowServiceMock,
    userService: IncidentEpisodeOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "incidentEpisodeId",
    resourceService: IncidentEpisodeService as unknown as ResourceServiceMock,
    resource: incidentEpisode,
    subject: `You have been added as the owner of Incident Episode #12 - ${TITLE}`,
  },
  {
    job: "AIAgentOwner:SendOwnerAddedEmail",
    teamService: AIAgentOwnerTeamService as unknown as RowServiceMock,
    userService: AIAgentOwnerUserService as unknown as RowServiceMock,
    resourceIdColumn: "aiAgentId",
    resourceService: AIAgentService as unknown as ResourceServiceMock,
    resource: aiAgent,
    subject: `[AI Agent] Owner of ${AI_AGENT_NAME}`,
  },
];

beforeEach(() => {
  jest.clearAllMocks();

  (IncidentService.getIncidentLinkInDashboard as jest.Mock).mockResolvedValue(
    RESOURCE_LINK,
  );
  (AlertService.getAlertLinkInDashboard as jest.Mock).mockResolvedValue(
    RESOURCE_LINK,
  );
  (
    ScheduledMaintenanceService.getScheduledMaintenanceLinkInDashboard as jest.Mock
  ).mockResolvedValue(RESOURCE_LINK);
  (
    AlertEpisodeService.getEpisodeLinkInDashboard as jest.Mock
  ).mockResolvedValue(RESOURCE_LINK);
  (
    IncidentEpisodeService.getEpisodeLinkInDashboard as jest.Mock
  ).mockResolvedValue(RESOURCE_LINK);
  (AIAgentService.getLinkInDashboard as jest.Mock).mockResolvedValue(
    RESOURCE_LINK,
  );
});

describe("an owner-added email about a resource whose title quotes template syntax", () => {
  test.each(OWNER_ADDED_CASES)(
    "$job marks the subject literal and keeps the title as written",
    async (ownerAdded: OwnerAddedCase) => {
      ownerAdded.teamService.findAllBy.mockResolvedValue([]);
      ownerAdded.userService.findAllBy.mockResolvedValue([
        ownerRow(ownerAdded.resourceIdColumn),
      ]);
      ownerAdded.resourceService.findOneById.mockResolvedValue(
        ownerAdded.resource(),
      );

      await mockCapturedJobs[ownerAdded.job]!();

      const envelope: EmailEnvelope = sentEnvelope();
      expect(envelope.isSubjectLiteral).toBe(true);
      expect(envelope.subject).toBe(ownerAdded.subject);
    },
  );
});

describe("an incident member email", () => {
  test("marks the subject literal and keeps the role name and title as written", async () => {
    (IncidentMemberService.findAllBy as jest.Mock).mockResolvedValue([
      {
        id: new ObjectID("member-row-1"),
        incidentId: RESOURCE_ID,
        incidentRoleId: new ObjectID("role-1"),
        user: owner(),
      },
    ]);

    const role: IncidentRole = new IncidentRole();
    role.name = ROLE_NAME;
    (IncidentRoleService.findOneById as jest.Mock).mockResolvedValue(role);
    (IncidentService.findOneById as jest.Mock).mockResolvedValue(incident());

    await mockCapturedJobs["IncidentMember:SendMemberAddedEmail"]!();

    const envelope: EmailEnvelope = sentEnvelope();
    expect(envelope.isSubjectLiteral).toBe(true);
    expect(envelope.subject).toBe(
      `You have been assigned as ${ROLE_NAME} to Incident #12 - ${TITLE}`,
    );
  });
});
