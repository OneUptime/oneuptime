import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
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

/*
 * Preserve registration before beforeEach clears mock call histories. The
 * handlers execute the real worker flow with only external services mocked.
 */
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
  // The email's list of added members.
  listKey: string;
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
    listKey: "alerts",
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
    listKey: "incidents",
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
              // The name, and the colour the email paints it in.
              [entry.severityKey]: { name: true, color: true },
              [entry.stateKey]: { name: true, color: true },
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

    /*
     * The episode title is user text. Compiled again by the mailer,
     * "{{ ... }}" in it rendered as nothing and a lone "{{" stopped the email
     * being sent.
     */
    test("an episode title quoting template syntax reaches the subject as written, marked literal", async () => {
      entry.episodeService.findOneById.mockResolvedValue({
        title: "Rollout of {{ .Values.image.tag }} stalled",
        project: { name: "Acme" },
        episodeNumber: 3,
        episodeNumberWithPrefix: "EPI-3",
        [entry.stateKey]: { name: "Investigating" },
      });

      await handlers.get(entry.jobName)!();

      const sendUserNotification: jest.Mock =
        UserNotificationSettingService.sendUserNotification as jest.Mock;

      expect(sendUserNotification).toHaveBeenCalledTimes(1);

      const envelope: EmailEnvelope = sendUserNotification.mock.calls[0][0]
        .emailEnvelope as EmailEnvelope;

      expect(envelope.isSubjectLiteral).toBe(true);
      expect(envelope.subject).toBe(
        `[Episode EPI-3] 1 new ${entry.name} added - Rollout of {{ .Values.image.tag }} stalled`,
      );
    });

    /*
     * The email lists every member it adds with that member's severity, and
     * leads with the episode's state: each one is painted in its own colour,
     * a dot and a readable shade for the name.
     */
    test("paints the episode state, its severity and each member's severity in their own colours", async () => {
      entry.findResources.mockResolvedValue([
        {
          id: RESOURCE_ID,
          title: "Member notification",
          [entry.severityKey]: {
            name: "Member warning",
            color: new Color("#facc15"),
          },
        },
      ]);
      entry.episodeService.findOneById.mockResolvedValue({
        title: "Database disruption",
        project: { name: "Acme" },
        episodeNumber: 3,
        episodeNumberWithPrefix: "EPI-3",
        [entry.severityKey]: { name: "SEV 1", color: new Color("#dc2626") },
        [entry.stateKey]: {
          name: "Investigating",
          color: new Color("#3b82f6"),
        },
      });

      await handlers.get(entry.jobName)!();

      expect(entry.findResources).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            [entry.severityKey]: { name: true, color: true },
          }),
        }),
      );

      const vars: JSONObject = (
        (UserNotificationSettingService.sendUserNotification as jest.Mock).mock
          .calls[0][0].emailEnvelope as EmailEnvelope
      ).vars as JSONObject;

      expect(vars).toMatchObject({
        currentState: "Investigating",
        ...EmailColorUtil.getTemplateVariables("currentState", "#3b82f6"),
        episodeSeverity: "SEV 1",
        ...EmailColorUtil.getTemplateVariables("episodeSeverity", "#dc2626"),
      });

      const members: Array<JSONObject> = vars[
        entry.listKey
      ] as unknown as Array<JSONObject>;

      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        [entry.severityKey]: "Member warning",
        [`${entry.severityKey}Color`]: "#facc15",
        [`${entry.severityKey}TextColor`]:
          EmailColorUtil.getColorPair("#facc15")!.textColor,
      });
    });

    test("a member or episode without a usable colour keeps its plain name", async () => {
      entry.episodeService.findOneById.mockResolvedValue({
        title: "Database disruption",
        project: { name: "Acme" },
        episodeNumber: 3,
        episodeNumberWithPrefix: "EPI-3",
        [entry.stateKey]: {
          name: "Investigating",
          color: new Color("#fff; position: fixed"),
        },
      });

      await handlers.get(entry.jobName)!();

      const vars: JSONObject = (
        (UserNotificationSettingService.sendUserNotification as jest.Mock).mock
          .calls[0][0].emailEnvelope as EmailEnvelope
      ).vars as JSONObject;
      const members: Array<JSONObject> = vars[
        entry.listKey
      ] as unknown as Array<JSONObject>;

      expect(vars["currentState"]).toBe("Investigating");
      expect(vars).not.toHaveProperty("currentStateColor");
      expect(vars["episodeSeverity"]).toBe("Not Set");
      expect(vars).not.toHaveProperty("episodeSeverityColor");
      // The beforeEach member has a severity name and no colour.
      expect(members[0]![entry.severityKey]).toBe("Member warning");
      expect(members[0]).not.toHaveProperty(`${entry.severityKey}Color`);
    });
  },
);
