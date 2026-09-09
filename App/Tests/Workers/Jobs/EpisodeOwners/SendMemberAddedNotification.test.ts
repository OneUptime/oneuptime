import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import "../../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendAlertAddedNotification";
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendIncidentAddedNotification";

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findOwners: jest.fn(),
      getEpisodeLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findOwners: jest.fn(),
      getEpisodeLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeMemberService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeMemberService", () => {
  return {
    __esModule: true,
    default: { findAllBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), getAlertLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), getIncidentLinkInDashboard: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return { __esModule: true, default: { getOwners: jest.fn() } };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return { __esModule: true, default: { sendUserNotification: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertEpisodeFeedService", () => {
  return {
    __esModule: true,
    default: { createAlertEpisodeFeedItem: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeFeedService", () => {
  return {
    __esModule: true,
    default: { createIncidentEpisodeFeedItem: jest.fn() },
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: { hash: jest.fn(), verify: jest.fn() },
  };
});

type CronHandler = () => Promise<void>;

// Preserve registration before beforeEach clears mock call histories. The
// handlers execute the real worker flow with only external services mocked.
const handlers: Map<string, CronHandler> = new Map(
  jest
    .mocked(RunCron)
    .mock.calls.map(
      (call: Parameters<typeof RunCron>): [string, CronHandler] => {
        return [call[0], call[2]];
      },
    ),
);

interface EpisodeServiceMock {
  findOneById: jest.Mock;
  findOwners: jest.Mock;
  getEpisodeLinkInDashboard: jest.Mock;
}

interface MemberServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
}

interface EpisodeCase {
  name: string;
  jobName: string;
  episodeService: EpisodeServiceMock;
  memberService: MemberServiceMock;
  findResources: jest.Mock;
  getResourceLink: jest.Mock;
  severityKey: string;
  stateKey: string;
  memberResourceKey: string;
  memberEpisodeKey: string;
}

const cases: Array<EpisodeCase> = [
  {
    name: "alert",
    jobName: "AlertEpisodeOwner:SendAlertAddedEmail",
    episodeService: AlertEpisodeService as unknown as EpisodeServiceMock,
    memberService: AlertEpisodeMemberService as unknown as MemberServiceMock,
    findResources: AlertService.findBy as jest.Mock,
    getResourceLink: AlertService.getAlertLinkInDashboard as jest.Mock,
    severityKey: "alertSeverity",
    stateKey: "currentAlertState",
    memberResourceKey: "alertId",
    memberEpisodeKey: "alertEpisodeId",
  },
  {
    name: "incident",
    jobName: "IncidentEpisodeOwner:SendIncidentAddedEmail",
    episodeService: IncidentEpisodeService as unknown as EpisodeServiceMock,
    memberService: IncidentEpisodeMemberService as unknown as MemberServiceMock,
    findResources: IncidentService.findBy as jest.Mock,
    getResourceLink: IncidentService.getIncidentLinkInDashboard as jest.Mock,
    severityKey: "incidentSeverity",
    stateKey: "currentIncidentState",
    memberResourceKey: "incidentId",
    memberEpisodeKey: "incidentEpisodeId",
  },
];

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const EPISODE_ID: ObjectID = new ObjectID("episode-1");
const RESOURCE_ID: ObjectID = new ObjectID("resource-1");

describe.each(cases)(
  "$name added-to-episode email details",
  (entry: EpisodeCase) => {
    beforeEach(() => {
      jest.clearAllMocks();
      entry.memberService.findAllBy.mockResolvedValue([
        {
          id: new ObjectID("member-1"),
          projectId: PROJECT_ID,
          [entry.memberEpisodeKey]: EPISODE_ID,
          [entry.memberResourceKey]: RESOURCE_ID,
          addedAt: new Date("2026-09-09T07:00:00.000Z"),
        },
      ]);
      entry.episodeService.findOwners.mockResolvedValue([
        {
          id: new ObjectID("owner-1"),
          name: "Owner",
          email: "owner@example.com",
        },
      ]);
      entry.episodeService.getEpisodeLinkInDashboard.mockResolvedValue(
        "https://oneuptime.example.com/dashboard/p1/episodes/e1",
      );
      entry.findResources.mockResolvedValue([
        {
          id: RESOURCE_ID,
          title: "Member notification",
          [entry.severityKey]: { name: "Member warning" },
        },
      ]);
      entry.getResourceLink.mockResolvedValue(
        "https://oneuptime.example.com/dashboard/p1/resources/r1",
      );
    });

    test.each(["SEV 1 — Critical", "Customer-impacting & urgent", undefined])(
      "selects the episode severity and sends its label (%s) with the current state",
      async (severity: string | undefined) => {
        entry.episodeService.findOneById.mockResolvedValue({
          title: "Database disruption",
          project: { name: "Acme" },
          episodeNumber: 3,
          episodeNumberWithPrefix: "EPI-3",
          [entry.severityKey]:
            severity === undefined ? undefined : { name: severity },
          [entry.stateKey]: { name: "Investigating" },
        });

        const handler: CronHandler | undefined = handlers.get(entry.jobName);

        expect(handler).toBeDefined();
        await handler!();

        expect(entry.episodeService.findOneById).toHaveBeenCalledWith(
          expect.objectContaining({
            select: expect.objectContaining({
              [entry.severityKey]: { name: true },
              [entry.stateKey]: { name: true },
            }),
          }),
        );
        expect(logger.error).not.toHaveBeenCalled();
        expect(
          UserNotificationSettingService.sendUserNotification,
        ).toHaveBeenCalledTimes(1);
        expect(
          UserNotificationSettingService.sendUserNotification,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            emailEnvelope: expect.objectContaining({
              vars: expect.objectContaining({
                episodeTitle: "Database disruption",
                episodeSeverity: severity ?? "Not Set",
                currentState: "Investigating",
              }),
            }),
          }),
        );
      },
    );
  },
);
