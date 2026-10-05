import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import Hostname from "../../../Types/API/Hostname";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import StatusPageSubscriberUnsubscribe from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The unsubscribe link in the messages sent outside the subscriber jobs (the
 * jobs are pinned by UnsubscribeLinkFixtures in App's worker tests): the
 * subscription confirmation email, the "you have subscribed" email and SMS,
 * and the status page report. Each must carry
 * {statusPageUrl}/unsubscribe/{subscriberId}-{token} - a link without its
 * token only leads to the "this link is out of date" page - including for a
 * subscriber read before the backfill gave it a token, which the sender tops
 * up first. An SMS from a public status page keeps the manage link instead
 * (StatusPageSubscriberUnsubscribe.buildSmsLink).
 *
 * The database is stubbed: the loaders are faked, and the token top-up's SQL
 * is recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);
const SECOND_SUBSCRIBER_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000004",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const TOKEN: string = "7a".repeat(32);
const SECOND_TOKEN: string = "8b".repeat(32);
// What the database holds once the top-up has run for a subscriber without one.
const TOPPED_UP_TOKEN: string = "9c".repeat(32);

function linkFor(subscriberId: ObjectID, token: string): string {
  return `${STATUS_PAGE_URL}/unsubscribe/${subscriberId.toString()}-${token}`;
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function accepted(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

function subscriber(options?: {
  id?: ObjectID;
  token?: string | null;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = (options?.id || SUBSCRIBER_ID).toString();
  row.projectId = PROJECT_ID;
  row.statusPageId = STATUS_PAGE_ID;
  row.subscriberEmail = new Email(
    `subscriber-${row._id.slice(-1)}@example.com`,
  );
  row.isSubscriptionConfirmed = true;
  row.isUnsubscribed = false;
  row.sendYouHaveSubscribedMessage = true;
  row.subscriptionConfirmationToken = "123456";

  if (options?.token !== null) {
    row.unsubscribeToken = options?.token || TOKEN;
  }

  return row;
}

function statusPage(options?: { isPublic?: boolean }): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Site 03";
  page.pageTitle = "Site 03 Status";
  page.isPublicStatusPage = options?.isPublic ?? false;
  return page;
}

function sentMail(): Array<{
  templateType: EmailTemplateType;
  toEmail: Email;
  vars: JSONObject;
}> {
  return mock(MailService.sendMail).mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      templateType: EmailTemplateType;
      toEmail: Email;
      vars: JSONObject;
    };
  });
}

let query: jest.Mock;

beforeEach(() => {
  // The token top-up: an UPDATE, answered [rows, rowCount].
  query = jest.fn(() => {
    return Promise.resolve([[], 1]);
  }) as unknown as jest.Mock;

  jest.spyOn(StatusPageSubscriberService, "getRepository").mockReturnValue({
    manager: { query: query },
  } as never);

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.acme.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue(STATUS_PAGE_URL);
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
    beforeEach(() => {
      jest
        .spyOn(StatusPageService, "findOneBy")
        .mockResolvedValue(statusPage({ isPublic: true }));
    });

    test("links to the subscriber's unsubscribe page, token and all", async () => {
      const findOneBy: jest.SpyInstance = jest
        .spyOn(StatusPageSubscriberService, "findOneBy")
        .mockResolvedValue(subscriber());

      await send();

      // The loader reads the token the link is built from.
      expect(
        (findOneBy.mock.calls[0]![0] as { select: JSONObject }).select[
          "unsubscribeToken"
        ],
      ).toBe(true);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!.templateType).toBe(templateType);
      expect(sentMail()[0]!.vars["unsubscribeUrl"]).toBe(
        linkFor(SUBSCRIBER_ID, TOKEN),
      );
      // A subscriber with its token needs no top-up.
      expect(query).not.toHaveBeenCalled();
    });

    test("a subscriber read without its token is given one first, not sent the out-of-date link", async () => {
      jest
        .spyOn(StatusPageSubscriberService, "findOneBy")
        .mockResolvedValue(subscriber({ token: null }));
      const readBack: jest.SpyInstance = jest
        .spyOn(StatusPageSubscriberService, "findBy")
        .mockResolvedValue([subscriber({ token: TOPPED_UP_TOKEN })] as never);
      const error: jest.SpyInstance = jest.spyOn(logger, "error");

      await send();

      expect(query).toHaveBeenCalledTimes(1);
      expect(String(query.mock.calls[0]![0])).toContain(
        '"subscriber"."unsubscribeToken" IS NULL',
      );
      expect(readBack).toHaveBeenCalledTimes(1);

      expect(sentMail()[0]!.vars["unsubscribeUrl"]).toBe(
        linkFor(SUBSCRIBER_ID, TOPPED_UP_TOKEN),
      );
      expect(
        StatusPageSubscriberUnsubscribe.parseCredential(
          (sentMail()[0]!.vars["unsubscribeUrl"] as string).split(
            "/unsubscribe/",
          )[1],
        )?.token,
      ).toBe(TOPPED_UP_TOKEN);
      // getUnsubscribeLink logs only when it has to fall back.
      expect(error).not.toHaveBeenCalled();
    });
  },
);

describe("the status page report", () => {
  beforeEach(() => {
    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([statusPage({ isPublic: false })]);
    jest
      .spyOn(StatusPageService, "getReportByStatusPage")
      .mockResolvedValue({ totalResources: 0, resources: [] } as never);
  });

  test("gives each subscriber its own unsubscribe link, topping up a missing token first", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(StatusPageSubscriberService, "findBy")
      // getSubscribersByStatusPage: the page's subscribers, one without a token.
      .mockResolvedValueOnce([
        subscriber(),
        subscriber({ id: SECOND_SUBSCRIBER_ID, token: null }),
      ] as never)
      // ensureUnsubscribeTokens: what the database holds after the top-up.
      .mockResolvedValueOnce([
        subscriber({ id: SECOND_SUBSCRIBER_ID, token: SECOND_TOKEN }),
      ] as never);

    await StatusPageService.sendEmailReport({ statusPageId: STATUS_PAGE_ID });

    expect(
      (findBy.mock.calls[0]![0] as { select: JSONObject }).select[
        "unsubscribeToken"
      ],
    ).toBe(true);

    // Only the subscriber without a token was topped up.
    expect(query).toHaveBeenCalledTimes(1);
    expect((query.mock.calls[0]![1] as Array<unknown>)[0]).toEqual([
      SECOND_SUBSCRIBER_ID.toString(),
    ]);

    const links: Record<string, string> = {};
    for (const mail of sentMail()) {
      links[mail.toEmail.toString()] = mail.vars["unsubscribeUrl"] as string;
    }

    expect(links).toEqual({
      "subscriber-3@example.com": linkFor(SUBSCRIBER_ID, TOKEN),
      "subscriber-4@example.com": linkFor(SECOND_SUBSCRIBER_ID, SECOND_TOKEN),
    });
  });

  test("a report sent to one address on request carries no subscriber's link", async () => {
    const findBy: jest.SpyInstance = jest.spyOn(
      StatusPageSubscriberService,
      "findBy",
    );

    await StatusPageService.sendEmailReport({
      statusPageId: STATUS_PAGE_ID,
      email: new Email("someone@acme.com"),
    });

    expect(findBy).not.toHaveBeenCalled();
    expect(sentMail()[0]!.vars["unsubscribeUrl"]).toBe("");
  });
});

describe("the SMS a new SMS subscriber gets", () => {
  function smsSubscriber(): StatusPageSubscriber {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = SUBSCRIBER_ID.toString();
    row.projectId = PROJECT_ID;
    row.statusPageId = STATUS_PAGE_ID;
    row.subscriberPhone = new Phone("+15555550123");
    row.isSubscriptionConfirmed = true;
    row.sendYouHaveSubscribedMessage = true;
    row.unsubscribeToken = TOKEN;
    return row;
  }

  async function createdOn(page: StatusPage): Promise<string> {
    const pageWithTwilio: StatusPage = new StatusPage();
    pageWithTwilio._id = STATUS_PAGE_ID.toString();
    pageWithTwilio.callSmsConfig = new ProjectCallSMSConfig();
    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockResolvedValue(pageWithTwilio);

    const created: StatusPageSubscriber = smsSubscriber();

    await (
      StatusPageSubscriberService as unknown as {
        onCreateSuccess: (
          onCreate: OnCreate<StatusPageSubscriber>,
          createdItem: StatusPageSubscriber,
        ) => Promise<StatusPageSubscriber>;
      }
    ).onCreateSuccess(
      {
        createBy: { data: created, props: { isRoot: true } },
        // onBeforeCreate carries the page forward, read with isPublicStatusPage.
        carryForward: { statusPage: page, replacedSubscriberIds: [] },
      },
      created,
    );

    expect(mock(SmsService.sendSms)).toHaveBeenCalledTimes(1);
    return (mock(SmsService.sendSms).mock.calls[0]![0] as { message: string })
      .message;
  }

  test("on a private status page, links to the unsubscribe page: its manage page needs a signed-in visitor", async () => {
    const message: string = await createdOn(statusPage({ isPublic: false }));

    expect(message).toBe(
      `You have been subscribed to Site 03 Status. To unsubscribe, click on the link: ${linkFor(SUBSCRIBER_ID, TOKEN)}`,
    );
  });

  test("on a public status page, keeps the shorter manage link, and never the token", async () => {
    const message: string = await createdOn(statusPage({ isPublic: true }));

    expect(message).toBe(
      `You have been subscribed to Site 03 Status. To unsubscribe, click on the link: ${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`,
    );
    expect(message).not.toContain(TOKEN);
  });
});
