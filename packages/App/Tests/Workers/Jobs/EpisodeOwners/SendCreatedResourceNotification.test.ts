import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import {
  OwnerNotificationDeliveryStatus,
  OwnerNotificationKind,
} from "Common/Types/Notification/OwnerNotificationDelivery";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";

/*
 * THE "CREATED" NOTIFICATION OF AN INCIDENT EPISODE'S AND AN ALERT EPISODE'S
 * OWNERS (IncidentEpisodeOwner:SendCreatedResourceEmail,
 * AlertEpisodeOwner:SendCreatedResourceEmail).
 *
 * Each job tells a new episode's owners - or the Project Owners, standing in
 * for an episode with none - that it was created, and says in its feed whom
 * it told. And, as the incident and alert jobs do (#7987), it leaves out an
 * owner the episode's own on-call page reached already: someone who is both
 * on call and an owner is told of the episode once, by the page, not a
 * second time with the same facts. Nobody may miss being told because of
 * it: a page that did not reach them - skipped, failed, held, about another
 * record - or a read that fails leaves them to be told.
 *
 * The real jobs run, each tick, with the services they read and write
 * mocked, the delivery table held in memory as Postgres answers it
 * (InMemoryOwnerNotificationDeliveries), and so are the notifications
 * on-call pages sent (InMemoryOnCallPages).
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
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

function mockEpisodeService(): unknown {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
      findOwners: jest.fn(),
      getEpisodeLinkInDashboard: jest.fn(),
    },
  };
}

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return mockEpisodeService();
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return mockEpisodeService();
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

jest.mock("Common/Server/Services/ProjectService", () => {
  return { __esModule: true, default: { getOwners: jest.fn() } };
});

// The owners a later run takes up are read back by their ids.
jest.mock("Common/Server/Services/UserService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return { __esModule: true, default: { sendUserNotification: jest.fn() } };
});

jest.mock("Common/Server/Utils/PushNotificationUtil", () => {
  return {
    __esModule: true,
    default: {
      createGenericNotification: jest.fn(() => {
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

// The notifications on-call pages sent: held in memory (InMemoryOnCallPages).
jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import OwnerNotificationDeliveryService from "Common/Server/Services/OwnerNotificationDeliveryService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
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

// Imported for their side effect: RunCron (mocked above) records each handler.
import "../../../../FeatureSet/Workers/Jobs/AlertEpisodeOwners/SendCreatedResourceNotification";
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisodeOwners/SendCreatedResourceNotification";

interface EpisodeServiceMock {
  findBy: jest.Mock;
  findOneById: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
  findOwners: jest.Mock;
  getEpisodeLinkInDashboard: jest.Mock;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "79870000-0000-4000-8000-0000000000e0",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "79870000-0000-4000-8000-0000000000e1",
);
// One of the episode's members: an alert, or an incident.
const MEMBER_ID: ObjectID = new ObjectID(
  "79870000-0000-4000-8000-0000000000e2",
);
const EPISODE_LINK: string = "https://oneuptime.test/dashboard/episode-1";
const CREATED_AT: Date = new Date("2026-11-15T10:00:00.000Z");

function makeOwner(name: string): User {
  const user: User = new User(new ObjectID(name));
  user.name = new Name(`Owner ${name}`);
  user.email = new Email(`${name}@acme.test`);
  return user;
}

const ANA: User = makeOwner("ana");
const BO: User = makeOwner("bo");
const CARA: User = makeOwner("cara");

interface EpisodeCase {
  name: string;
  jobName: string;
  kind: OwnerNotificationKind;
  episodeService: EpisodeServiceMock;
  createFeedItem: jest.Mock;
  // The column of the episode's feed item naming the episode.
  feedEpisodeKey: string;
  // The on-call timeline column naming the episode a page was about.
  pageColumn: keyof PageNotification;
  // ... and naming one of its members.
  memberPageColumn: keyof PageNotification;
  noun: string;
  subject: string;
  episode: () => AlertEpisode | IncidentEpisode;
}

function project(): Project {
  const record: Project = new Project();
  record.name = "Acme";
  return record;
}

const CASES: Array<EpisodeCase> = [
  {
    name: "alert episode",
    jobName: "AlertEpisodeOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.AlertEpisodeCreated,
    episodeService: AlertEpisodeService as unknown as EpisodeServiceMock,
    createFeedItem:
      AlertEpisodeFeedService.createAlertEpisodeFeedItem as unknown as jest.Mock,
    feedEpisodeKey: "alertEpisodeId",
    pageColumn: "triggeredByAlertEpisodeId",
    memberPageColumn: "triggeredByAlertId",
    noun: "alert episode",
    subject: "[New Alert Episode EPI-3] - CPU is spiking",
    episode: (): AlertEpisode => {
      const episode: AlertEpisode = new AlertEpisode(EPISODE_ID);
      episode.projectId = PROJECT_ID;
      episode.project = project();
      episode.title = "CPU is spiking";
      episode.description = "Three alerts in an hour";
      episode.episodeNumber = 3;
      episode.episodeNumberWithPrefix = "EPI-3";
      episode.createdAt = CREATED_AT;
      const state: AlertState = new AlertState();
      state.name = "Active";
      episode.currentAlertState = state;
      const severity: AlertSeverity = new AlertSeverity();
      severity.name = "High";
      episode.alertSeverity = severity;
      return episode;
    },
  },
  {
    name: "incident episode",
    jobName: "IncidentEpisodeOwner:SendCreatedResourceEmail",
    kind: OwnerNotificationKind.IncidentEpisodeCreated,
    episodeService: IncidentEpisodeService as unknown as EpisodeServiceMock,
    createFeedItem:
      IncidentEpisodeFeedService.createIncidentEpisodeFeedItem as unknown as jest.Mock,
    feedEpisodeKey: "incidentEpisodeId",
    pageColumn: "triggeredByIncidentEpisodeId",
    memberPageColumn: "triggeredByIncidentId",
    noun: "incident episode",
    subject: "[New Incident Episode EPI-3] - Checkout is flapping",
    episode: (): IncidentEpisode => {
      const episode: IncidentEpisode = new IncidentEpisode(EPISODE_ID);
      episode.projectId = PROJECT_ID;
      episode.project = project();
      episode.title = "Checkout is flapping";
      episode.description = "Three incidents in an hour";
      episode.episodeNumber = 3;
      episode.episodeNumberWithPrefix = "EPI-3";
      episode.createdAt = CREATED_AT;
      const state: IncidentState = new IncidentState();
      state.name = "Active";
      episode.currentIncidentState = state;
      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "Major";
      episode.incidentSeverity = severity;
      return episode;
    },
  },
];

const notificationService: { sendUserNotification: jest.Mock } =
  UserNotificationSettingService as unknown as {
    sendUserNotification: jest.Mock;
  };
const projectService: { getOwners: jest.Mock } = ProjectService as unknown as {
  getOwners: jest.Mock;
};
const userService: { findBy: jest.Mock } = UserService as unknown as {
  findBy: jest.Mock;
};
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

describe.each(CASES)(
  "an $name's Created notification",
  (entry: EpisodeCase) => {
    let deliveries: InMemoryOwnerNotificationDeliveries;
    let pages: InMemoryOnCallPages;
    let now: Date;
    // Whether the job marked the episode notified: it is due no more.
    let isMarked: boolean;

    async function runJob(): Promise<void> {
      const handler: CronHandler | undefined = mockCapturedJobs[entry.jobName];

      if (!handler) {
        throw new Error(`${entry.jobName} registered no cron handler.`);
      }

      await handler();
    }

    // A notification of the episode's page to `user`, in `status`.
    function paged(
      user: User,
      status: UserNotificationStatus = UserNotificationStatus.Sent,
    ): void {
      pages.add({
        projectId: PROJECT_ID,
        userId: user.id!,
        [entry.pageColumn]: EPISODE_ID,
        status: status,
      });
    }

    // Whom the owners' notification was sent to, in order.
    function sentTo(): Array<string> {
      return notificationService.sendUserNotification.mock.calls.map(
        (args: Array<unknown>): string => {
          return (args[0] as { userId: ObjectID }).userId.toString();
        },
      );
    }

    function feedItems(): Array<{
      feedInfoInMarkdown: string;
      moreInformationInMarkdown: string;
    }> {
      return entry.createFeedItem.mock.calls.map((args: Array<unknown>) => {
        return args[0] as {
          feedInfoInMarkdown: string;
          moreInformationInMarkdown: string;
        };
      });
    }

    beforeEach(() => {
      jest.clearAllMocks();

      deliveries = useInMemoryOwnerNotificationDeliveries();
      pages = useInMemoryOnCallPages();
      now = new Date("2026-11-15T10:01:00.000Z");
      isMarked = false;

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return new Date(now.getTime());
      });

      for (const each of CASES) {
        each.episodeService.findBy.mockResolvedValue([]);
        each.episodeService.findOneById.mockResolvedValue(null);
        each.episodeService.findOwners.mockResolvedValue([]);
        each.createFeedItem.mockResolvedValue(undefined);
      }

      /*
       * The episode is due until the job takes it: read a page at a time,
       * and taken by one hook-free compare-and-set (OwnerNotificationBacklog,
       * #8862) that only one run wins.
       */
      entry.episodeService.findBy.mockImplementation(async () => {
        return isMarked ? [] : [entry.episode()];
      });
      entry.episodeService.findOneById.mockImplementation(async () => {
        return entry.episode();
      });
      entry.episodeService.compareAndSetColumnsByIdWithoutHooks.mockImplementation(
        async (data: { data: JSONObject; expectedData: JSONObject }) => {
          if (
            isMarked ||
            data.data["isOwnerNotifiedOfEpisodeCreation"] !== true ||
            data.expectedData["isOwnerNotifiedOfEpisodeCreation"] !== false
          ) {
            return false;
          }

          isMarked = true;
          return true;
        },
      );
      entry.episodeService.getEpisodeLinkInDashboard.mockResolvedValue(
        EPISODE_LINK,
      );

      projectService.getOwners.mockResolvedValue([]);
      userService.findBy.mockImplementation(
        async (data: { query: JSONObject }) => {
          return usersNamedBy([ANA, BO, CARA], data.query);
        },
      );
      notificationService.sendUserNotification.mockResolvedValue(undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("tells each owner it was created, once, marks it notified, and names them in its feed", async () => {
      entry.episodeService.findOwners.mockResolvedValue([ANA, BO]);

      await runJob();

      expect(sentTo()).toEqual(["ana", "bo"]);

      const envelope: EmailEnvelope = (
        notificationService.sendUserNotification.mock.calls[0]![0] as {
          emailEnvelope: EmailEnvelope;
        }
      ).emailEnvelope;

      expect(envelope.subject).toBe(entry.subject);
      // Taken by one hook-free compare-and-set (#8862).
      expect(
        entry.episodeService.compareAndSetColumnsByIdWithoutHooks,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          id: EPISODE_ID,
          data: { isOwnerNotifiedOfEpisodeCreation: true },
          expectedData: { isOwnerNotifiedOfEpisodeCreation: false },
        }),
      );
      expect(feedItems()).toEqual([
        expect.objectContaining({
          [entry.feedEpisodeKey]: EPISODE_ID,
          feedInfoInMarkdown: `Owners were notified that this ${entry.noun} was created.`,
          moreInformationInMarkdown:
            "- Owner ana\n- Owner bo\n",
        }),
      ]);

      // Marked: the next run tells nobody again.
      await runJob();
      expect(sentTo()).toEqual(["ana", "bo"]);
    });

    test("an owner who is on call, and was paged for the episode, is not sent the owners' notification", async () => {
      entry.episodeService.findOwners.mockResolvedValue([ANA]);
      paged(ANA);

      await runJob();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      // Nobody was notified, so no entry says the owners were.
      expect(entry.createFeedItem).not.toHaveBeenCalled();
      // Marked all the same, so it is not read again.
      expect(isMarked).toBe(true);
      // Never written down: no later run tells her either.
      expect(deliveries.statusesOf(EPISODE_ID)).toEqual({});
    });

    test("the Project Owners standing in for an episode with none, paged for it: nobody is sent it twice", async () => {
      projectService.getOwners.mockResolvedValue([ANA]);
      paged(ANA);

      await runJob();

      expect(notificationService.sendUserNotification).not.toHaveBeenCalled();
      expect(entry.createFeedItem).not.toHaveBeenCalled();
      expect(deliveries.statusesOf(EPISODE_ID)).toEqual({});
    });

    test("a Project Owner standing in who was not paged is sent it, as before", async () => {
      projectService.getOwners.mockResolvedValue([BO]);

      await runJob();

      expect(sentTo()).toEqual(["bo"]);
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown: `The Project Owners were notified that this ${entry.noun} was created, as it has no owners yet.`,
          moreInformationInMarkdown: "- Owner bo\n",
        }),
      ]);
    });

    test("an owner who is only an owner is sent it, as before - whoever else was paged", async () => {
      entry.episodeService.findOwners.mockResolvedValue([BO]);
      // The engineer on call, who owns nothing.
      paged(CARA);

      await runJob();

      expect(sentTo()).toEqual(["bo"]);
      expect(feedItems()[0]!.moreInformationInMarkdown).toBe(
        "- Owner bo\n",
      );
    });

    test("two owners, one of them paged: only the other is told, and the feed says who was left out, and why", async () => {
      entry.episodeService.findOwners.mockResolvedValue([ANA, BO]);
      paged(ANA);

      await runJob();

      expect(sentTo()).toEqual(["bo"]);
      expect(deliveries.statusesOf(EPISODE_ID)).toEqual({
        ["bo"]: OwnerNotificationDeliveryStatus.Sent,
      });
      expect(feedItems()).toEqual([
        expect.objectContaining({
          feedInfoInMarkdown: `Owners were notified that this ${entry.noun} was created.`,
          moreInformationInMarkdown:
            "- Owner bo\n" +
            "\nNot notified again, as the on-call page reached them: Owner ana.\n",
        }),
      ]);
    });

    test.each([
      UserNotificationStatus.Acknowledged,
      UserNotificationStatus.Sending,
    ])(
      "a notification of the page that is %s reached them: they are left out",
      async (status: UserNotificationStatus) => {
        entry.episodeService.findOwners.mockResolvedValue([ANA, BO]);
        paged(ANA, status);

        await runJob();

        expect(sentTo()).toEqual(["bo"]);
      },
    );

    test.each([UserNotificationStatus.Error, UserNotificationStatus.Skipped])(
      "a page whose notification is %s did not reach them: they are told",
      async (status: UserNotificationStatus) => {
        entry.episodeService.findOwners.mockResolvedValue([ANA, BO]);
        paged(ANA, status);

        await runJob();

        expect(sentTo()).toEqual(["ana", "bo"]);
        expect(feedItems()[0]!.moreInformationInMarkdown).toBe(
          "- Owner ana\n- Owner bo\n",
        );
      },
    );

    test("a page of one of the episode's members - not of the episode - does not count", async () => {
      entry.episodeService.findOwners.mockResolvedValue([ANA]);
      pages.add({
        projectId: PROJECT_ID,
        userId: ANA.id!,
        [entry.memberPageColumn]: MEMBER_ID,
      });

      await runJob();

      expect(sentTo()).toEqual(["ana"]);
    });

    test("the read failing tells everybody, as before, and says so", async () => {
      entry.episodeService.findOwners.mockResolvedValue([ANA, BO]);
      paged(ANA);
      pages.failWith(new Error("The database is away"));

      await runJob();

      expect(sentTo()).toEqual(["ana", "bo"]);
      expect(
        mockedLogger.error.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).startsWith(
            `Could not read whom the on-call page of ${entry.kind} ${EPISODE_ID.toString()} reached`,
          );
        }),
      ).toBe(true);
    });

    test("reads the episode's page once, for all its owners, after reading them and before writing them down", async () => {
      entry.episodeService.findOwners.mockResolvedValue([ANA, BO, CARA]);

      await runJob();

      expect(pages.reads).toHaveLength(1);

      const query: Record<string, unknown> = pages.reads[0]!.query as Record<
        string,
        unknown
      >;

      expect(String(query[entry.pageColumn])).toBe(EPISODE_ID.toString());
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());

      const read: number = (
        UserOnCallLogTimelineService.findBy as unknown as jest.Mock
      ).mock.invocationCallOrder[0]!;

      expect(
        entry.episodeService.findOwners.mock.invocationCallOrder[0]!,
      ).toBeLessThan(read);
      expect(read).toBeLessThan(
        (
          OwnerNotificationDeliveryService.writeOwnersToTell as unknown as jest.Mock
        ).mock.invocationCallOrder[0]!,
      );
      expect(read).toBeLessThan(
        entry.episodeService.compareAndSetColumnsByIdWithoutHooks.mock
          .invocationCallOrder[0]!,
      );
    });

    test("an owner left out is never written down, so a later run that takes up what a stopped one left never tells them", async () => {
      entry.episodeService.findOwners.mockResolvedValue([ANA, BO, CARA]);
      paged(ANA);
      // The worker is killed as it sets out to tell Cara.
      deliveries.stopAt({ statement: "startTelling", userId: "cara" });

      void runJob();

      for (
        let turn: number = 0;
        turn < 500 && deliveries.stops() === 0;
        turn++
      ) {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });
      }

      expect(deliveries.stops()).toBe(1);
      expect(sentTo()).toEqual(["bo"]);
      expect(deliveries.statusesOf(EPISODE_ID)).toEqual({
        ["bo"]: OwnerNotificationDeliveryStatus.Sent,
        ["cara"]: OwnerNotificationDeliveryStatus.Pending,
      });

      // Started again, minutes later.
      now = new Date(
        now.getTime() +
          OwnerNotificationDeliveries.RESUME_AFTER_MINUTES * 60 * 1000,
      );

      await runJob();

      expect(sentTo()).toEqual(["bo", "cara"]);
      // The later run's entry names whom the two runs told - never Ana.
      expect(feedItems()).toHaveLength(1);
      expect(feedItems()[0]!.moreInformationInMarkdown).toBe(
        "- Owner bo\n- Owner cara\n",
      );

      now = new Date(now.getTime() + 60 * 60 * 1000);
      await runJob();

      expect(sentTo()).toEqual(["bo", "cara"]);
    });
  },
);
