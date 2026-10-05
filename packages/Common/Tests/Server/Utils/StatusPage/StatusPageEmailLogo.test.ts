import File from "../../../../Models/DatabaseModels/File";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "../../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import MailService from "../../../../Server/Services/MailService";
import ProjectSmtpConfigService from "../../../../Server/Services/ProjectSmtpConfigService";
import { Service as StatusPagePrivateUserServiceClass } from "../../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import StatusPageEmailLogo, {
  STATUS_PAGE_EMAIL_LOGO_SELECT,
} from "../../../../Server/Utils/StatusPage/StatusPageEmailLogo";
import Hostname from "../../../../Types/API/Hostname";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Protocol from "../../../../Types/API/Protocol";
import Email from "../../../../Types/Email";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A STATUS PAGE EMAIL SHOWS ITS LOGO ONLY WHEN THE LOGO ROUTE SERVES IT.
 *
 * Emails show a status page's logo by its address on the page's logo route,
 * which serves it only when it is a file of the page's own project and the
 * page is not archived. An email whose logo the route would not serve - a
 * logo of another project, or one the backfill left without a project -
 * leaves it out, as for a page with no logo, rather than show a broken
 * image (StatusPageEmailLogo). Every sender builds the address there; the
 * route's own answer is checked against the same rule in
 * PublicFileOwnershipRoutes.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
const LOGO_FILE_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000004",
);

const HOST: Hostname = new Hostname("oneuptime.acme.com");
const LOGO_URL: string = `https://oneuptime.acme.com/status-page-api/logo/${STATUS_PAGE_ID.toString()}`;

enum Logo {
  // A file of the page's own project: the route serves it.
  Own = "a logo of the page's own project",
  // A file of another project.
  OtherProject = "a logo of another project",
  // A file the backfill could not give a project.
  NoProject = "a logo with no project",
  // The page has no logo.
  None = "no logo",
  // The read did not select the logo's project.
  NotRead = "a logo read without its project",
}

function statusPage(
  logo: Logo,
  options: { isArchived?: boolean } = {},
): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;

  if (options.isArchived !== undefined) {
    page.isArchived = options.isArchived;
  }

  if (logo === Logo.None) {
    return page;
  }

  page.logoFileId = LOGO_FILE_ID;

  if (logo === Logo.NotRead) {
    return page;
  }

  const file: File = new File();
  file._id = LOGO_FILE_ID.toString();

  if (logo === Logo.Own) {
    file.projectId = PROJECT_ID;
  } else if (logo === Logo.OtherProject) {
    file.projectId = OTHER_PROJECT_ID;
  }

  page.logoFile = file;

  return page;
}

function logoUrlOf(page: StatusPage): string {
  return StatusPageEmailLogo.getLogoUrl({
    statusPage: page,
    host: HOST,
    httpProtocol: Protocol.HTTPS,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageEmailLogo.getLogoUrl", () => {
  test("a logo of the page's own project: its address on the logo route", () => {
    expect(logoUrlOf(statusPage(Logo.Own))).toBe(LOGO_URL);
    expect(StatusPageEmailLogo.isLogoServed(statusPage(Logo.Own))).toBe(true);
  });

  test.each([Logo.OtherProject, Logo.NoProject, Logo.None, Logo.NotRead])(
    "%s: no logo at all, not a broken one",
    (logo: Logo) => {
      expect(logoUrlOf(statusPage(logo))).toBe("");
      expect(StatusPageEmailLogo.isLogoServed(statusPage(logo))).toBe(false);
    },
  );

  test("an archived page's logo, which the route no longer serves: none", () => {
    expect(logoUrlOf(statusPage(Logo.Own, { isArchived: true }))).toBe("");
    expect(logoUrlOf(statusPage(Logo.Own, { isArchived: false }))).toBe(
      LOGO_URL,
    );
  });

  test("a page with no id has no address to give", () => {
    const page: StatusPage = statusPage(Logo.Own);
    delete (page as unknown as Record<string, unknown>)["_id"];

    expect(logoUrlOf(page)).toBe("");
  });

  test("the logo's project is compared whatever case its id is written in", () => {
    const page: StatusPage = statusPage(Logo.Own);
    page.logoFile!.projectId = new ObjectID(
      PROJECT_ID.toString().toUpperCase(),
    );

    expect(logoUrlOf(page)).toBe(LOGO_URL);
  });

  test("nothing at all is no logo", () => {
    expect(StatusPageEmailLogo.isLogoServed(null)).toBe(false);
    expect(StatusPageEmailLogo.isLogoServed(undefined)).toBe(false);
  });
});

describe("STATUS_PAGE_EMAIL_LOGO_SELECT", () => {
  test("reads what the logo route decides by: the page's project, whether it is archived, the logo and its project", () => {
    expect(STATUS_PAGE_EMAIL_LOGO_SELECT).toEqual({
      _id: true,
      projectId: true,
      isArchived: true,
      logoFileId: true,
      logoFile: { _id: true, projectId: true },
    });
  });
});

/*
 * The senders, with the database stubbed: each reads the page with the
 * logo's project and shows the logo exactly when the route would serve it.
 */
describe("the emails a status page sends", () => {
  function sentMail(): Array<{
    templateType: EmailTemplateType;
    vars: JSONObject;
  }> {
    return (MailService.sendMail as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as { templateType: EmailTemplateType; vars: JSONObject };
      },
    );
  }

  function subscriber(): StatusPageSubscriber {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = SUBSCRIBER_ID.toString();
    row.projectId = PROJECT_ID;
    row.statusPageId = STATUS_PAGE_ID;
    row.subscriberEmail = new Email("subscriber@example.com");
    row.isSubscriptionConfirmed = true;
    row.isUnsubscribed = false;
    row.sendYouHaveSubscribedMessage = true;
    row.subscriptionConfirmationToken = "123456";
    row.unsubscribeToken = "7a".repeat(32);
    return row;
  }

  beforeEach(() => {
    getJestSpyOn(DatabaseConfig, "getHost").mockResolvedValue(HOST);
    getJestSpyOn(DatabaseConfig, "getHttpProtocol").mockResolvedValue(
      Protocol.HTTPS,
    );
    getJestSpyOn(StatusPageService, "getStatusPageURL").mockResolvedValue(
      "https://status.acme.com",
    );
    getJestSpyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    ).mockResolvedValue(null);
    getJestSpyOn(ProjectSmtpConfigService, "toEmailServer").mockReturnValue(
      undefined,
    );
    getJestSpyOn(MailService, "sendMail").mockResolvedValue(
      new HTTPResponse<JSONObject>(200, {}, {}),
    );
  });

  describe.each([
    {
      name: "the subscription confirmation email",
      templateType: EmailTemplateType.ConfirmStatusPageSubscription,
      send: (): Promise<void> => {
        return StatusPageSubscriberService.sendConfirmSubscriptionEmail({
          subscriberId: SUBSCRIBER_ID,
        });
      },
    },
    {
      name: "the you-have-subscribed email",
      templateType: EmailTemplateType.SubscribedToStatusPage,
      send: (): Promise<void> => {
        return StatusPageSubscriberService.sendYouHaveSubscribedEmail({
          subscriberId: SUBSCRIBER_ID,
        });
      },
    },
  ])(
    "$name",
    ({
      templateType,
      send,
    }: {
      templateType: EmailTemplateType;
      send: () => Promise<void>;
    }) => {
      let findPage: jest.SpyInstance;
      let page: StatusPage;

      beforeEach(() => {
        getJestSpyOn(
          StatusPageSubscriberService,
          "findOneBy",
        ).mockResolvedValue(subscriber());
        findPage = getJestSpyOn(
          StatusPageService,
          "findOneBy",
        ).mockImplementation((async () => {
          return page;
        }) as never);
      });

      test("reads the page with its logo's project", async () => {
        page = statusPage(Logo.Own);

        await send();

        expect(
          (findPage.mock.calls[0]![0] as { select: JSONObject }).select,
        ).toMatchObject({
          projectId: true,
          logoFileId: true,
          logoFile: { _id: true, projectId: true },
        });
      });

      test("shows a logo of the page's own project", async () => {
        page = statusPage(Logo.Own);

        await send();

        expect(sentMail()[0]!.templateType).toBe(templateType);
        expect(sentMail()[0]!.vars["logoUrl"]).toBe(LOGO_URL);
      });

      test.each([Logo.OtherProject, Logo.NoProject, Logo.None])(
        "leaves out %s",
        async (logo: Logo) => {
          page = statusPage(logo);

          await send();

          expect(sentMail()[0]!.templateType).toBe(templateType);
          expect(sentMail()[0]!.vars["logoUrl"]).toBe("");
        },
      );
    },
  );

  describe("the status page report", () => {
    let page: StatusPage;

    beforeEach(() => {
      getJestSpyOn(
        StatusPageSubscriberService,
        "getStatusPagesToSendNotification",
      ).mockImplementation((async () => {
        return [page];
      }) as never);
      getJestSpyOn(
        StatusPageService,
        "getReportByStatusPage",
      ).mockResolvedValue({ totalResources: 0, resources: [] } as never);
    });

    test("shows a logo of the page's own project", async () => {
      page = statusPage(Logo.Own);

      await StatusPageService.sendEmailReport({
        statusPageId: STATUS_PAGE_ID,
        email: new Email("someone@acme.com"),
      });

      expect(sentMail()[0]!.vars["logoUrl"]).toBe(LOGO_URL);
    });

    test.each([Logo.OtherProject, Logo.NoProject])(
      "leaves out %s",
      async (logo: Logo) => {
        page = statusPage(logo);

        await StatusPageService.sendEmailReport({
          statusPageId: STATUS_PAGE_ID,
          email: new Email("someone@acme.com"),
        });

        expect(sentMail()[0]!.vars["logoUrl"]).toBe("");
      },
    );
  });

  describe("a private user's invitation", () => {
    class InvitingService extends StatusPagePrivateUserServiceClass {
      public async invite(
        user: StatusPagePrivateUser,
      ): Promise<StatusPagePrivateUser> {
        return await this.onCreateSuccess(
          {
            createBy: { data: user, props: { isRoot: true } },
            carryForward: null,
          },
          user,
        );
      }
    }

    let service: InvitingService;
    let findPage: jest.SpyInstance;
    let page: StatusPage;

    function privateUser(): StatusPagePrivateUser {
      const user: StatusPagePrivateUser = new StatusPagePrivateUser();
      user.id = ObjectID.generate();
      user.statusPageId = STATUS_PAGE_ID;
      user.projectId = PROJECT_ID;
      user.email = new Email("private-user@example.com");
      user.isSsoUser = false;
      return user;
    }

    beforeEach(() => {
      service = new InvitingService();
      getJestSpyOn(service, "updateOneById").mockResolvedValue(1);
      findPage = getJestSpyOn(
        StatusPageService,
        "findOneById",
      ).mockImplementation((async () => {
        const read: StatusPage = page;
        read.requireSsoForLogin = false;
        return read;
      }) as never);
    });

    test("reads the page with its logo's project, and shows a logo of its own project", async () => {
      page = statusPage(Logo.Own);

      await service.invite(privateUser());

      expect(
        (findPage.mock.calls[0]![0] as { select: JSONObject }).select,
      ).toMatchObject({
        projectId: true,
        logoFile: { _id: true, projectId: true },
      });
      expect(sentMail()[0]!.templateType).toBe(
        EmailTemplateType.StatusPageWelcomeEmail,
      );
      expect(sentMail()[0]!.vars["logoUrl"]).toBe(LOGO_URL);
    });

    test.each([Logo.OtherProject, Logo.NoProject])(
      "leaves out %s",
      async (logo: Logo) => {
        page = statusPage(logo);

        await service.invite(privateUser());

        expect(sentMail()[0]!.vars["logoUrl"]).toBe("");
      },
    );
  });

  test("every subscriber notification reads its pages with the logo's project", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      StatusPageService,
      "findBy",
    ).mockResolvedValue([]);

    await StatusPageSubscriberService.getStatusPagesToSendNotification([
      STATUS_PAGE_ID,
    ]);

    expect(
      (findBy.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toMatchObject({
      projectId: true,
      isArchived: true,
      logoFileId: true,
      logoFile: { _id: true, projectId: true },
    });
  });
});
