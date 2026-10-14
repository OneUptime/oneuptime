import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService, {
  CurrentPlan,
} from "../../../Server/Services/ProjectService";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Markdown from "../../../Server/Types/Markdown";
import { ExpressRequest } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import Hostname from "../../../Types/API/Hostname";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE,
  STATUS_PAGE_ARCHIVED_SENDS_NOTHING_MESSAGE,
} from "../../../Types/StatusPage/StatusPageArchive";
import {
  STATUS_PAGE_OF_BLOCKED_PROJECT_NO_NEW_SUBSCRIBERS_MESSAGE,
  STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE,
} from "../../../Types/StatusPage/StatusPageProjectBlock";
import { mockRouter } from "../API/Helpers";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

/*
 * A BLOCKED PROJECT'S STATUS PAGES SEND NOTHING TO THEIR SUBSCRIBERS.
 *
 * A master admin blocks a project (Project.isBlocked) to take it offline,
 * most often for abuse - and the people subscribed to a spam site's status
 * page may be the abuse's victims. Its status pages answer every public
 * request as missing pages, the unsubscribe page every message links to
 * included, so they send nothing either: no incident, episode, note or
 * postmortem updates, no scheduled maintenance, announcements or reports,
 * no subscription confirmations, no manage links.
 *
 * Every one of those finds its pages in one place,
 * StatusPageSubscriberService.getStatusPagesToSendNotification, which leaves
 * a blocked project's pages out as it leaves archived pages out, asking the
 * per-process ProjectService.isProjectBlocked. These tests run that lookup
 * for real under each kind of notification - the database stubbed: a page
 * store, and the project rows behind ProjectService - a blocked project's
 * pages next to a live project's; and pin what the dashboard is told when a
 * page sends nothing because its project is blocked. The jobs that read the
 * lookup themselves (announcements, scheduled maintenance notes and state
 * changes) are pinned in their own suites under App/Tests/Workers/Jobs.
 */

const BLOCKED_PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-0000000000b1",
);
const LIVE_PROJECT_ID: ObjectID = new ObjectID(
  "b10c0000-0000-4000-8000-0000000000a1",
);

// Two pages of the blocked project - a spam site's - and one of a live project.
const BLOCKED_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000001",
);
const SECOND_BLOCKED_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000002",
);
const LIVE_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000003",
);
// No page has this id.
const MISSING_PAGE_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-0000000000ff",
);

const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "5c000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "5d000000-0000-4000-8000-000000000001",
);

const SUBSCRIBER_EMAIL: string = "subscriber@example.com";
const UNSUBSCRIBE_TOKEN: string = "7a".repeat(32);

// The pages the stubbed database holds, and the projects that are blocked.
let storedPages: Array<StatusPage>;
let blockedProjectIds: Array<string>;

let isProjectBlocked: jest.SpyInstance;
let statusPageFindBy: jest.SpyInstance;

function statusPage(data: {
  id: ObjectID;
  projectId: ObjectID;
  name: string;
  isArchived?: boolean;
}): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = data.id.toString();
  page.projectId = data.projectId;
  page.name = data.name;
  page.pageTitle = data.name;
  page.isPublicStatusPage = true;
  page.isArchived = data.isArchived ?? false;
  page.showIncidentsOnStatusPage = true;
  page.showEpisodesOnStatusPage = true;
  page.showAnnouncementsOnStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage = true;
  page.onlyShowScopedIncidents = false;
  page.allowSubscribersToChooseResources = false;
  page.allowSubscribersToChooseEventTypes = false;
  page.subscriberTimezones = [];
  return page;
}

function blockedPage(): StatusPage {
  return statusPage({
    id: BLOCKED_PAGE_ID,
    projectId: BLOCKED_PROJECT_ID,
    name: "Free Movies Status",
  });
}

function secondBlockedPage(): StatusPage {
  return statusPage({
    id: SECOND_BLOCKED_PAGE_ID,
    projectId: BLOCKED_PROJECT_ID,
    name: "Free Movies Status (mirror)",
  });
}

function livePage(): StatusPage {
  return statusPage({
    id: LIVE_PAGE_ID,
    projectId: LIVE_PROJECT_ID,
    name: "Acme Status",
  });
}

function idOf(model: { _id?: string | undefined }): string {
  return (model._id || "").toString().toLowerCase();
}

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsIn(operator: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<
      Array<string | ObjectID>
    >
  )
    .flat()
    .map((id: string | ObjectID): string => {
      return id.toString().toLowerCase();
    });
}

function ids(pages: Array<StatusPage>): Array<string> {
  return pages.map((page: StatusPage): string => {
    return idOf(page);
  });
}

// The project a page of the fixtures belongs to.
function projectOf(statusPageId: ObjectID): ObjectID {
  return [BLOCKED_PAGE_ID, SECOND_BLOCKED_PAGE_ID].some(
    (id: ObjectID): boolean => {
      return id.toString() === statusPageId.toString();
    },
  )
    ? BLOCKED_PROJECT_ID
    : LIVE_PROJECT_ID;
}

function subscriberOf(statusPageId: ObjectID): StatusPageSubscriber {
  const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
  subscriber._id = SUBSCRIBER_ID.toString();
  subscriber.statusPageId = statusPageId;
  subscriber.projectId = projectOf(statusPageId);
  subscriber.subscriberEmail = new Email(SUBSCRIBER_EMAIL);
  subscriber.isSubscriptionConfirmed = true;
  subscriber.isUnsubscribed = false;
  subscriber.isSubscribedToAllResources = true;
  subscriber.isSubscribedToAllEventTypes = true;
  subscriber.sendYouHaveSubscribedMessage = true;
  subscriber.subscriptionConfirmationToken = "123456";
  subscriber.unsubscribeToken = UNSUBSCRIBE_TOKEN;
  return subscriber;
}

function accepted(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

// Who was emailed, in order.
function emailed(): Array<string> {
  return (MailService.sendMail as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as { toEmail: Email }).toEmail.toString();
    },
  );
}

beforeEach(() => {
  storedPages = [blockedPage(), secondBlockedPage(), livePage()];
  blockedProjectIds = [BLOCKED_PROJECT_ID.toString()];

  // Each test starts from no per-process answers.
  ProjectService.forgetBlockedStatus(BLOCKED_PROJECT_ID);
  ProjectService.forgetBlockedStatus(LIVE_PROJECT_ID);
  StatusPageService.clearProjectIdOfStatusPageCache();

  stubProjectDirectory({});

  // The page query the lookup runs: the stored pages it names, not archived.
  statusPageFindBy = jest
    .spyOn(StatusPageService, "findBy")
    .mockImplementation((async (findBy: {
      query: JSONObject;
    }): Promise<Array<StatusPage>> => {
      const wanted: Array<string> = idsIn(findBy.query["_id"]);

      return storedPages.filter((page: StatusPage): boolean => {
        return (
          wanted.includes(idOf(page)) &&
          !(findBy.query["isArchived"] === false && page.isArchived)
        );
      });
    }) as never);

  // A page read by its id, archived or not (its project, whether it is archived).
  jest
    .spyOn(StatusPageService, "findOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<StatusPage | null> => {
      return (
        storedPages.find((page: StatusPage): boolean => {
          return idOf(page) === data.id.toString().toLowerCase();
        }) || null
      );
    }) as never);

  isProjectBlocked = jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async (projectId: ObjectID): Promise<boolean> => {
      return blockedProjectIds.includes(projectId.toString());
    });

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockImplementation(async (statusPageId: ObjectID): Promise<string> => {
      return `https://status.example.com/${statusPageId.toString()}`;
    });
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockResolvedValue(null);
  jest
    .spyOn(ProjectSmtpConfigService, "toEmailServer")
    .mockReturnValue(undefined);
  jest
    .spyOn(ProjectCallSMSConfigService, "toTwilioConfig")
    .mockReturnValue(undefined);
  jest.spyOn(MailService, "sendMail").mockResolvedValue(accepted());
  jest.spyOn(SmsService, "sendSms").mockResolvedValue(accepted() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  ProjectService.forgetBlockedStatus(BLOCKED_PROJECT_ID);
  ProjectService.forgetBlockedStatus(LIVE_PROJECT_ID);
  StatusPageService.clearProjectIdOfStatusPageCache();
});

describe("the one lookup every subscriber notification reads its status pages from", () => {
  test("leaves out the pages of a blocked project, and keeps a live project's, in order", async () => {
    const pages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification([
        BLOCKED_PAGE_ID,
        LIVE_PAGE_ID,
        SECOND_BLOCKED_PAGE_ID,
      ]);

    expect(ids(pages)).toEqual([LIVE_PAGE_ID.toString()]);
  });

  test("sends from every page of a project that is not blocked", async () => {
    blockedProjectIds = [];

    const pages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification([
        BLOCKED_PAGE_ID,
        LIVE_PAGE_ID,
        SECOND_BLOCKED_PAGE_ID,
      ]);

    expect(ids(pages)).toEqual([
      BLOCKED_PAGE_ID.toString(),
      SECOND_BLOCKED_PAGE_ID.toString(),
      LIVE_PAGE_ID.toString(),
    ]);
  });

  test("asks once per project, however many of its pages the notification is for", async () => {
    await StatusPageSubscriberService.getStatusPagesToSendNotification([
      BLOCKED_PAGE_ID,
      SECOND_BLOCKED_PAGE_ID,
      LIVE_PAGE_ID,
    ]);

    expect(
      isProjectBlocked.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as ObjectID).toString();
      }),
    ).toEqual([BLOCKED_PROJECT_ID.toString(), LIVE_PROJECT_ID.toString()]);
  });

  test("adds no query to a notification: the answer is the per-process one", async () => {
    // The real answer, with the project row read through a stub.
    isProjectBlocked.mockRestore();

    const findProject: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation((async (data: { id: ObjectID }): Promise<Project> => {
        const project: Project = new Project();
        project.id = data.id;
        project.isBlocked = blockedProjectIds.includes(data.id.toString());
        return project;
      }) as never);

    for (let notification: number = 0; notification < 3; notification++) {
      const pages: Array<StatusPage> =
        await StatusPageSubscriberService.getStatusPagesToSendNotification([
          BLOCKED_PAGE_ID,
          SECOND_BLOCKED_PAGE_ID,
          LIVE_PAGE_ID,
        ]);

      expect(ids(pages)).toEqual([LIVE_PAGE_ID.toString()]);
    }

    // One read of each project for all three notifications.
    expect(findProject).toHaveBeenCalledTimes(2);
  });

  test("once the project is unblocked, its pages send again", async () => {
    isProjectBlocked.mockRestore();

    jest.spyOn(ProjectService, "findOneById").mockImplementation((async (data: {
      id: ObjectID;
    }): Promise<Project> => {
      const project: Project = new Project();
      project.id = data.id;
      project.isBlocked = blockedProjectIds.includes(data.id.toString());
      return project;
    }) as never);

    expect(
      ids(
        await StatusPageSubscriberService.getStatusPagesToSendNotification([
          BLOCKED_PAGE_ID,
        ]),
      ),
    ).toEqual([]);

    // A master admin unblocks it: the write drops this server's answer.
    blockedProjectIds = [];
    ProjectService.forgetBlockedStatus(BLOCKED_PROJECT_ID);

    expect(
      ids(
        await StatusPageSubscriberService.getStatusPagesToSendNotification([
          BLOCKED_PAGE_ID,
        ]),
      ),
    ).toEqual([BLOCKED_PAGE_ID.toString()]);
  });

  test("asks about no project when no page is found", async () => {
    await expect(
      StatusPageSubscriberService.getStatusPagesToSendNotification([
        MISSING_PAGE_ID,
      ]),
    ).resolves.toEqual([]);

    expect(isProjectBlocked).not.toHaveBeenCalled();
  });

  test("fails open: a page whose project cannot be told sends as usual, and the fault is logged", async () => {
    isProjectBlocked.mockRejectedValue(new Error("database unavailable"));
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    const pages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification([
        BLOCKED_PAGE_ID,
        LIVE_PAGE_ID,
      ]);

    expect(ids(pages)).toEqual([
      BLOCKED_PAGE_ID.toString(),
      LIVE_PAGE_ID.toString(),
    ]);
    expect(
      error.mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      }),
    ).toContainEqual(
      expect.stringContaining(
        `Could not tell whether project ${BLOCKED_PROJECT_ID.toString()} is blocked`,
      ),
    );
  });

  test("still leaves archived pages out in its query", async () => {
    storedPages = [
      statusPage({
        id: LIVE_PAGE_ID,
        projectId: LIVE_PROJECT_ID,
        name: "Acme Status",
        isArchived: true,
      }),
    ];

    await expect(
      StatusPageSubscriberService.getStatusPagesToSendNotification([
        LIVE_PAGE_ID,
      ]),
    ).resolves.toEqual([]);

    expect(
      (statusPageFindBy.mock.calls[0]![0] as { query: JSONObject }).query[
        "isArchived"
      ],
    ).toBe(false);
  });
});

describe("each kind of notification sends nothing from a page of a blocked project", () => {
  describe("incidents, episodes, their notes and postmortems", () => {
    /*
     * Every incident and episode job resolves the pages it tells here
     * (IncidentStatusPageScope.resolvePagesForIncidents hands its reaches to
     * resolvePagesForReaches; IncidentStatusPageScopeCallSites.test.ts holds
     * the jobs to the helper), and the helper loads them through the lookup.
     */
    function resolve(): Promise<ResolvedIncidentStatusPages> {
      return IncidentStatusPageScope.resolvePagesForReaches({
        reaches: [{ monitorIds: [MONITOR_ID], scopedStatusPageIds: null }],
      });
    }

    beforeEach(() => {
      // The monitor is listed on every stored page.
      jest
        .spyOn(StatusPageResourceService, "findByMonitors")
        .mockImplementation((async (): Promise<Array<StatusPageResource>> => {
          return storedPages.map(
            (page: StatusPage, index: number): StatusPageResource => {
              const resource: StatusPageResource = new StatusPageResource();
              resource._id = `5e000000-0000-4000-8000-00000000000${index + 1}`;
              resource.statusPageId = new ObjectID(page._id!);
              resource.displayName = "Checkout";
              return resource;
            },
          );
        }) as never);
    });

    test("reach only the live project's page, and list no blocked page as left out by scope", async () => {
      const resolved: ResolvedIncidentStatusPages = await resolve();

      expect(ids(resolved.statusPages)).toEqual([LIVE_PAGE_ID.toString()]);
      expect(Object.keys(resolved.statusPageToResources)).toEqual([
        LIVE_PAGE_ID.toString(),
      ]);
      expect(resolved.excludedStatusPages).toEqual([]);
    });

    test("reach every page once its project is not blocked", async () => {
      blockedProjectIds = [];

      const resolved: ResolvedIncidentStatusPages = await resolve();

      expect(ids(resolved.statusPages).sort()).toEqual(
        [
          BLOCKED_PAGE_ID.toString(),
          SECOND_BLOCKED_PAGE_ID.toString(),
          LIVE_PAGE_ID.toString(),
        ].sort(),
      );
    });
  });

  describe("scheduled maintenance, when it is scheduled and in its reminders", () => {
    function eventOn(statusPageIds: Array<ObjectID>): ScheduledMaintenance {
      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event._id = "5f000000-0000-4000-8000-000000000001";
      event.projectId = BLOCKED_PROJECT_ID;
      event.title = "Database failover";
      event.description = "Failing over the primary.";
      event.startsAt = new Date("2026-10-20T06:00:00.000Z");
      event.endsAt = new Date("2026-10-20T08:00:00.000Z");
      event.statusPages = statusPageIds.map((id: ObjectID): StatusPage => {
        const page: StatusPage = new StatusPage();
        page._id = id.toString();
        return page;
      });
      return event;
    }

    let getSubscribersByStatusPage: jest.SpyInstance;

    beforeEach(() => {
      jest
        .spyOn(StatusPageResourceService, "findByMonitors")
        .mockResolvedValue([]);
      jest
        .spyOn(Markdown, "convertToHTML")
        .mockImplementation(async (markdown: string): Promise<string> => {
          return markdown;
        });
      getSubscribersByStatusPage = jest
        .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
        .mockImplementation((async (
          statusPageId: ObjectID,
        ): Promise<Array<StatusPageSubscriber>> => {
          return [subscriberOf(statusPageId)];
        }) as never);
    });

    test("an event on a blocked project's pages reaches none of their subscribers", async () => {
      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        eventOn([BLOCKED_PAGE_ID, SECOND_BLOCKED_PAGE_ID]),
      ]);

      expect(getSubscribersByStatusPage).not.toHaveBeenCalled();
      expect(emailed()).toEqual([]);
    });

    test("an event on a live project's page is sent as before", async () => {
      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        eventOn([LIVE_PAGE_ID]),
      ]);

      expect(emailed()).toEqual([SUBSCRIBER_EMAIL]);
    });
  });

  describe("status page reports", () => {
    beforeEach(() => {
      jest
        .spyOn(StatusPageService, "getReportByStatusPage")
        .mockResolvedValue({ totalResources: 0, resources: [] } as never);
      jest
        .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
        .mockImplementation((async (
          statusPageId: ObjectID,
        ): Promise<Array<StatusPageSubscriber>> => {
          return [subscriberOf(statusPageId)];
        }) as never);
    });

    test("a blocked project's page sends its subscribers no report", async () => {
      await expect(
        StatusPageService.sendEmailReport({ statusPageId: BLOCKED_PAGE_ID }),
      ).rejects.toThrow(STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE);

      expect(emailed()).toEqual([]);
    });

    test("a live project's page sends its report as before", async () => {
      await StatusPageService.sendEmailReport({ statusPageId: LIVE_PAGE_ID });

      expect(emailed()).toEqual([SUBSCRIBER_EMAIL]);
    });
  });

  describe("the confirmations a subscription sends", () => {
    function subscriberOn(statusPageId: ObjectID): void {
      jest
        .spyOn(StatusPageSubscriberService, "findOneBy")
        .mockResolvedValue(subscriberOf(statusPageId));
    }

    test.each([
      {
        name: "the confirmation request",
        send: (): Promise<void> => {
          return StatusPageSubscriberService.sendConfirmSubscriptionEmail({
            subscriberId: SUBSCRIBER_ID,
          });
        },
      },
      {
        name: "the you-have-subscribed email, as the confirmation link sends it",
        send: (): Promise<void> => {
          return StatusPageSubscriberService.sendYouHaveSubscribedEmail({
            subscriberId: SUBSCRIBER_ID,
          });
        },
      },
    ])(
      "$name goes to nobody on a blocked project's page, and as before on a live one",
      async ({ send }: { send: () => Promise<void> }) => {
        subscriberOn(BLOCKED_PAGE_ID);
        await send();
        expect(emailed()).toEqual([]);

        subscriberOn(LIVE_PAGE_ID);
        await send();
        expect(emailed()).toEqual([SUBSCRIBER_EMAIL]);
      },
    );
  });

  describe("manage-subscription links", () => {
    let api: StatusPageAPI;

    beforeAll(() => {
      api = new StatusPageAPI();
    });

    function sendLinks(statusPageId: ObjectID): Promise<void> {
      return api.sendManageSubscriptionLinks({
        statusPageId: statusPageId,
        subscribers: [subscriberOf(statusPageId)],
        req: { headers: {} } as unknown as ExpressRequest,
      });
    }

    test("go to nobody on a blocked project's page, and as before on a live one", async () => {
      await sendLinks(BLOCKED_PAGE_ID);
      expect(emailed()).toEqual([]);

      await sendLinks(LIVE_PAGE_ID);
      expect(emailed()).toEqual([SUBSCRIBER_EMAIL]);
    });
  });
});

describe("what the dashboard is told", () => {
  test("the messages say the project is blocked, and what that means for its pages", () => {
    expect(STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE).toBe(
      "This project has been blocked, so its status pages send nothing to their subscribers. Please contact your administrator.",
    );
    expect(STATUS_PAGE_OF_BLOCKED_PROJECT_NO_NEW_SUBSCRIBERS_MESSAGE).toBe(
      "This project has been blocked, so its status pages take no new subscribers. Please contact your administrator.",
    );
  });

  describe("sending a report from the dashboard", () => {
    function sendTestReport(statusPageId: ObjectID): Promise<void> {
      return StatusPageService.sendEmailReport({
        statusPageId: statusPageId,
        email: new Email("teammate@acme.example"),
      });
    }

    beforeEach(() => {
      jest
        .spyOn(StatusPageService, "getReportByStatusPage")
        .mockResolvedValue({ totalResources: 0, resources: [] } as never);
    });

    test("for a blocked project's page, says the project is blocked", async () => {
      await expect(sendTestReport(BLOCKED_PAGE_ID)).rejects.toThrow(
        new BadDataException(
          STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE,
        ),
      );
      expect(emailed()).toEqual([]);
    });

    test("for an archived page of a blocked project, says the project is blocked: unarchiving would not lift it", async () => {
      storedPages = [
        statusPage({
          id: BLOCKED_PAGE_ID,
          projectId: BLOCKED_PROJECT_ID,
          name: "Free Movies Status",
          isArchived: true,
        }),
      ];

      await expect(sendTestReport(BLOCKED_PAGE_ID)).rejects.toThrow(
        new BadDataException(
          STATUS_PAGE_OF_BLOCKED_PROJECT_SENDS_NOTHING_MESSAGE,
        ),
      );
    });

    test("for an archived page of a live project, still says it is archived", async () => {
      storedPages = [
        statusPage({
          id: LIVE_PAGE_ID,
          projectId: LIVE_PROJECT_ID,
          name: "Acme Status",
          isArchived: true,
        }),
      ];

      await expect(sendTestReport(LIVE_PAGE_ID)).rejects.toThrow(
        new BadDataException(STATUS_PAGE_ARCHIVED_SENDS_NOTHING_MESSAGE),
      );
    });

    test("for a page that does not exist, still says it was not found", async () => {
      await expect(sendTestReport(MISSING_PAGE_ID)).rejects.toThrow(
        new BadDataException("Status page not found"),
      );
    });

    test("for a live project's page, sends the test report", async () => {
      await sendTestReport(LIVE_PAGE_ID);

      expect(emailed()).toEqual(["teammate@acme.example"]);
    });
  });

  describe("adding a subscriber from the dashboard", () => {
    type Created = {
      createBy: { data: StatusPageSubscriber };
      carryForward: { statusPage?: StatusPage | undefined };
    };

    type BeforeCreate = (data: {
      data: StatusPageSubscriber;
      props: { isRoot: boolean };
    }) => Promise<Created>;

    function addSubscriber(statusPageId: ObjectID): Promise<Created> {
      const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
      subscriber.statusPageId = statusPageId;
      subscriber.projectId = projectOf(statusPageId);
      subscriber.subscriberEmail = new Email("new-subscriber@example.com");

      const onBeforeCreate: BeforeCreate = (
        StatusPageSubscriberService as unknown as {
          onBeforeCreate: BeforeCreate;
        }
      ).onBeforeCreate.bind(StatusPageSubscriberService);

      return onBeforeCreate({ data: subscriber, props: { isRoot: true } });
    }

    beforeEach(() => {
      /*
       * With billing on (as in CI), the plan is checked before the page: a
       * paid plan lets the check reach the page in both billing modes.
       */
      jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
        plan: PlanType.Growth,
        isSubscriptionUnpaid: false,
      } as CurrentPlan);
      // The contact is not subscribed yet.
      jest.spyOn(StatusPageSubscriberService, "findBy").mockResolvedValue([]);
    });

    test("to a blocked project's page, says the project is blocked", async () => {
      await expect(addSubscriber(BLOCKED_PAGE_ID)).rejects.toThrow(
        new BadDataException(
          STATUS_PAGE_OF_BLOCKED_PROJECT_NO_NEW_SUBSCRIBERS_MESSAGE,
        ),
      );
    });

    test("to an archived page of a blocked project, says the project is blocked", async () => {
      storedPages = [
        statusPage({
          id: BLOCKED_PAGE_ID,
          projectId: BLOCKED_PROJECT_ID,
          name: "Free Movies Status",
          isArchived: true,
        }),
      ];

      await expect(addSubscriber(BLOCKED_PAGE_ID)).rejects.toThrow(
        new BadDataException(
          STATUS_PAGE_OF_BLOCKED_PROJECT_NO_NEW_SUBSCRIBERS_MESSAGE,
        ),
      );
    });

    test("to an archived page of a live project, still says it is archived", async () => {
      storedPages = [
        statusPage({
          id: LIVE_PAGE_ID,
          projectId: LIVE_PROJECT_ID,
          name: "Acme Status",
          isArchived: true,
        }),
      ];

      await expect(addSubscriber(LIVE_PAGE_ID)).rejects.toThrow(
        new BadDataException(STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE),
      );
    });

    test("to a page that does not exist, still says it was not found", async () => {
      await expect(addSubscriber(MISSING_PAGE_ID)).rejects.toThrow(
        new BadDataException("Status Page not found"),
      );
    });

    test("to a live project's page, goes ahead, with the page its welcome is sent from", async () => {
      const created: Created = await addSubscriber(LIVE_PAGE_ID);

      expect(created.createBy.data.projectId?.toString()).toBe(
        LIVE_PROJECT_ID.toString(),
      );
      expect(idOf(created.carryForward.statusPage!)).toBe(
        LIVE_PAGE_ID.toString(),
      );
    });
  });
});
