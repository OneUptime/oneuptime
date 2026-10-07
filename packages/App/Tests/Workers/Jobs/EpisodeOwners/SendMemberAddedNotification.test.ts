import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import logger from "Common/Server/Utils/Logger";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
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
  // The member's prefixed number, as the job reads it.
  resourceNumberKey: string;
  createFeedItem: jest.Mock;
  // The email's list of added members, and the keys of each member in it.
  listKey: string;
  titleKey: string;
  numberKey: string;
  linkKey: string;
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
    resourceNumberKey: "alertNumberWithPrefix",
    createFeedItem:
      AlertEpisodeFeedService.createAlertEpisodeFeedItem as jest.Mock,
    listKey: "alerts",
    titleKey: "alertTitle",
    numberKey: "alertNumber",
    linkKey: "alertViewLink",
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
    resourceNumberKey: "incidentNumberWithPrefix",
    createFeedItem:
      IncidentEpisodeFeedService.createIncidentEpisodeFeedItem as jest.Mock,
    listKey: "incidents",
    titleKey: "incidentTitle",
    numberKey: "incidentNumber",
    linkKey: "incidentViewLink",
  },
];

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const EPISODE_ID: ObjectID = new ObjectID("episode-1");
const RESOURCE_ID: ObjectID = new ObjectID("resource-1");
const RESOURCE_LINK: string =
  "https://oneuptime.example.com/dashboard/p1/resources/r1";
const PRIVATE_TITLE: string = "Payroll export sent to the wrong customer";

type MembersEmailedFunction = (entry: EpisodeCase) => Array<JSONObject>;

// The members listed in the first email the job sent.
const membersEmailed: MembersEmailedFunction = (
  entry: EpisodeCase,
): Array<JSONObject> => {
  const envelope: EmailEnvelope = (
    UserNotificationSettingService.sendUserNotification as jest.Mock
  ).mock.calls[0][0].emailEnvelope as EmailEnvelope;

  return (envelope.vars as JSONObject)[
    entry.listKey
  ] as unknown as Array<JSONObject>;
};

type EverythingSentFunction = (entry: EpisodeCase) => string;

/*
 * Everything one run of the job hands on, as text: each recipient's
 * notification (email, SMS and call), the push and WhatsApp messages built
 * for it, the episode's feed entry, and anything logged.
 */
const everythingSent: EverythingSentFunction = (entry: EpisodeCase): string => {
  return JSON.stringify([
    (UserNotificationSettingService.sendUserNotification as jest.Mock).mock
      .calls,
    (PushNotificationUtil.createGenericNotification as jest.Mock).mock.calls,
    (createWhatsAppMessageFromTemplate as jest.Mock).mock.calls,
    entry.createFeedItem.mock.calls,
    (logger.error as jest.Mock).mock.calls,
  ]);
};

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
      entry.getResourceLink.mockResolvedValue(RESOURCE_LINK);
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

    // isPrivate is nullable, and a null one is public, as the privacy filters read it.
    test.each([false, null, undefined])(
      "a member whose isPrivate is %s is listed with its title",
      async (isPrivate: boolean | null | undefined) => {
        entry.episodeService.findOneById.mockResolvedValue({
          title: "Database disruption",
          project: { name: "Acme" },
          episodeNumber: 3,
          episodeNumberWithPrefix: "EPI-3",
          [entry.stateKey]: { name: "Investigating" },
        });
        entry.findResources.mockResolvedValue([
          {
            id: RESOURCE_ID,
            title: "Member notification",
            isPrivate: isPrivate,
            [entry.severityKey]: { name: "Member warning" },
          },
        ]);

        await handlers.get(entry.jobName)!();

        const members: Array<JSONObject> = membersEmailed(entry);

        expect(members).toHaveLength(1);
        expect(members[0]![entry.titleKey]).toBe("Member notification");
        expect(members[0]).not.toHaveProperty("isPrivate");
      },
    );

    /*
     * A private incident or alert is seen only by its own owners and the
     * project's owners and admins, and this email goes to the episode's
     * owners - often none of those, since the grouping engine adds private
     * members to episodes by itself. So a private member is listed by its
     * number, severity and link only, and its title goes nowhere the job
     * sends or writes.
     */
    describe("a private member", () => {
      beforeEach(() => {
        entry.episodeService.findOneById.mockResolvedValue({
          title: "Database disruption",
          project: { name: "Acme" },
          episodeNumber: 3,
          episodeNumberWithPrefix: "EPI-3",
          [entry.stateKey]: { name: "Investigating" },
        });
        entry.findResources.mockResolvedValue([
          {
            id: RESOURCE_ID,
            title: PRIVATE_TITLE,
            isPrivate: true,
            [entry.resourceNumberKey]: "SEC-7",
            [entry.severityKey]: { name: "Member warning" },
          },
        ]);
      });

      test("is read with whether it is private", async () => {
        await handlers.get(entry.jobName)!();

        expect(entry.findResources).toHaveBeenCalledWith(
          expect.objectContaining({
            select: expect.objectContaining({ title: true, isPrivate: true }),
          }),
        );
      });

      test("is listed by its number, severity and link, without its title", async () => {
        await handlers.get(entry.jobName)!();

        expect(logger.error).not.toHaveBeenCalled();

        const members: Array<JSONObject> = membersEmailed(entry);

        expect(members).toHaveLength(1);
        expect(members[0]).toMatchObject({
          isPrivate: "true",
          [entry.numberKey]: "SEC-7",
          [entry.severityKey]: "Member warning",
          [entry.linkKey]: RESOURCE_LINK,
        });
        expect(members[0]).not.toHaveProperty(entry.titleKey);
        expect(everythingSent(entry)).not.toContain(PRIVATE_TITLE);
      });

      /*
       * Project owners can open every private record, so they could be told
       * its title - but the rule is the member's, not the recipient's, as it
       * is for the feed entries: one email never carries a private title.
       */
      test("is listed without its title to the project owners the email falls back to, too", async () => {
        entry.episodeService.findOwners.mockResolvedValue([]);
        (ProjectService.getOwners as jest.Mock).mockResolvedValue([
          {
            id: new ObjectID("project-owner-1"),
            name: "Project owner",
            email: "project-owner@example.com",
          },
        ]);

        await handlers.get(entry.jobName)!();

        expect(
          UserNotificationSettingService.sendUserNotification,
        ).toHaveBeenCalledTimes(1);
        expect(
          UserNotificationSettingService.sendUserNotification,
        ).toHaveBeenCalledWith(
          expect.objectContaining({ userId: new ObjectID("project-owner-1") }),
        );
        expect(membersEmailed(entry)[0]).not.toHaveProperty(entry.titleKey);
        expect(everythingSent(entry)).not.toContain(PRIVATE_TITLE);
      });

      test("leaves a public member beside it listed with its title", async () => {
        const privateId: ObjectID = new ObjectID("resource-2");

        entry.memberService.findAllBy.mockResolvedValue([
          {
            id: new ObjectID("member-1"),
            projectId: PROJECT_ID,
            [entry.memberEpisodeKey]: EPISODE_ID,
            [entry.memberResourceKey]: RESOURCE_ID,
            addedAt: new Date("2026-09-09T07:00:00.000Z"),
          },
          {
            id: new ObjectID("member-2"),
            projectId: PROJECT_ID,
            [entry.memberEpisodeKey]: EPISODE_ID,
            [entry.memberResourceKey]: privateId,
            addedAt: new Date("2026-09-09T07:05:00.000Z"),
          },
        ]);
        entry.findResources.mockResolvedValue([
          {
            id: privateId,
            title: PRIVATE_TITLE,
            isPrivate: true,
            [entry.resourceNumberKey]: "SEC-7",
          },
          {
            id: RESOURCE_ID,
            title: "Checkout latency",
            isPrivate: false,
            [entry.resourceNumberKey]: "OPS-3",
          },
        ]);
        entry.getResourceLink.mockImplementation(
          async (_projectId: ObjectID, id: ObjectID): Promise<string> => {
            return `https://oneuptime.example.com/dashboard/p1/resources/${id.toString()}`;
          },
        );

        await handlers.get(entry.jobName)!();

        // In the order they were added: the public member first.
        const members: Array<JSONObject> = membersEmailed(entry);

        expect(members).toHaveLength(2);
        expect(members[0]).toMatchObject({
          [entry.titleKey]: "Checkout latency",
          [entry.numberKey]: "OPS-3",
          [entry.linkKey]:
            "https://oneuptime.example.com/dashboard/p1/resources/resource-1",
        });
        expect(members[0]).not.toHaveProperty("isPrivate");
        expect(members[1]).toMatchObject({
          isPrivate: "true",
          [entry.numberKey]: "SEC-7",
          [entry.linkKey]:
            "https://oneuptime.example.com/dashboard/p1/resources/resource-2",
        });
        expect(members[1]).not.toHaveProperty(entry.titleKey);
        expect(everythingSent(entry)).toContain("Checkout latency");
        expect(everythingSent(entry)).not.toContain(PRIVATE_TITLE);
      });
    });
  },
);
