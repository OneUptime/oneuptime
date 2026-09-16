import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const MANAGE_SUBSCRIPTION_ROUTE: string =
  "/status-page/manage-subscription/:statusPageId";

const VICTIM_EMAIL: string = "victim@example.com";
const VICTIM_PHONE: string = "+15551230001";
const VICTIM_SLACK_WORKSPACE: string = "Victim Corp";
const VICTIM_SLACK_WEBHOOK: string =
  "https://hooks.slack.com/services/T000/B000/victim";

const ATTACKER_EMAIL: string = "attacker@example.com";
const ATTACKER_PHONE: string = "+15559870002";
const ATTACKER_SLACK_WEBHOOK: string =
  "https://hooks.slack.com/services/T999/B999/attacker";

/*
 * The manage-subscription endpoint is reachable without authentication and
 * sends a link that opens the matched subscription: whoever holds it can read
 * the subscriber's contact details and change or cancel the subscription. The
 * link must therefore only ever reach the contact stored on the subscriber
 * that was matched — never an address supplied in the request.
 */

describe("StatusPageAPI manage-subscription link recipient", () => {
  let statusPageId: ObjectID;
  let projectId: ObjectID;
  let storedSubscribers: Array<StatusPageSubscriber>;
  let emailSubscriber: StatusPageSubscriber;
  let phoneSubscriber: StatusPageSubscriber;
  let slackSubscriber: StatusPageSubscriber;
  let enableSlackSubscribers: boolean;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let sendLinkSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  /*
   * Stands in for the database: matches on every queried column and, like the
   * real query, returns only the columns that were selected.
   */
  const findOneByFake: (findBy: {
    query: JSONObject;
    select: JSONObject;
  }) => Promise<StatusPageSubscriber | null> = (findBy: {
    query: JSONObject;
    select: JSONObject;
  }): Promise<StatusPageSubscriber | null> => {
    const stored: StatusPageSubscriber | undefined = storedSubscribers.find(
      (subscriber: StatusPageSubscriber) => {
        return Object.keys(findBy.query).every((column: string) => {
          const storedValue: unknown = subscriber.getColumnValue(column);
          return (
            storedValue !== undefined &&
            storedValue !== null &&
            String(storedValue) === String(findBy.query[column])
          );
        });
      },
    );

    if (!stored) {
      return Promise.resolve(null);
    }

    const selected: StatusPageSubscriber = new StatusPageSubscriber();
    selected.id = stored.id!;

    for (const column of Object.keys(findBy.select)) {
      if (column !== "_id" && findBy.select[column]) {
        selected.setColumnValue(column, stored.getColumnValue(column));
      }
    }

    return Promise.resolve(selected);
  };

  const buildSubscriber: (
    data: Partial<StatusPageSubscriber>,
  ) => StatusPageSubscriber = (
    data: Partial<StatusPageSubscriber>,
  ): StatusPageSubscriber => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.id = ObjectID.generate();
    subscriber.statusPageId = statusPageId;
    subscriber.projectId = projectId;
    Object.assign(subscriber, data);
    return subscriber;
  };

  const callManageSubscription: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    const request: ExpressRequest = {
      params: {
        statusPageId: statusPageId.toString(),
      },
      body: { data },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("post", MANAGE_SUBSCRIPTION_ROUTE)
      .handlerFunction(request, mockResponse, nextFunction);

    // The link is sent in the background; wait for it before checking what went out.
    await Promise.all(
      sendLinkSpy.mock.results.map((result: jest.MockResult<unknown>) => {
        return result.value;
      }),
    );
  };

  const sentEmails: () => Array<string> = (): Array<string> => {
    return (MailService.sendMail as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { toEmail: Email }).toEmail.toString();
      },
    );
  };

  const sentSms: () => Array<{ to: string; message: string }> = (): Array<{
    to: string;
    message: string;
  }> => {
    return (SmsService.sendSms as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>) => {
        const sms: { to: Phone; message: string } = call[0] as {
          to: Phone;
          message: string;
        };
        return { to: sms.to.toString(), message: sms.message };
      },
    );
  };

  const sentSlackMessages: () => Array<{
    url: string;
    text: string;
  }> = (): Array<{ url: string; text: string }> => {
    return (
      SlackUtil.sendMessageToChannelViaIncomingWebhook as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>) => {
      const message: { url: URL; text: string } = call[0] as {
        url: URL;
        text: string;
      };
      return { url: message.url.toString(), text: message.text };
    });
  };

  const getThrownError: () => unknown = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);
    return calls[0]![0];
  };

  beforeEach(() => {
    jest.clearAllMocks();

    statusPageId = ObjectID.generate();
    projectId = ObjectID.generate();
    enableSlackSubscribers = true;

    emailSubscriber = buildSubscriber({
      subscriberEmail: new Email(VICTIM_EMAIL),
    });
    phoneSubscriber = buildSubscriber({
      subscriberPhone: new Phone(VICTIM_PHONE),
    });
    slackSubscriber = buildSubscriber({
      slackWorkspaceName: VICTIM_SLACK_WORKSPACE,
      slackIncomingWebhookUrl: URL.fromString(VICTIM_SLACK_WEBHOOK),
    });
    storedSubscribers = [emailSubscriber, phoneSubscriber, slackSubscriber];

    sendLinkSpy = jest.spyOn(
      StatusPageAPI.prototype,
      "sendManageSubscriptionLink",
    );

    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation((): Promise<StatusPage | null> => {
        const statusPage: StatusPage = new StatusPage();
        statusPage.id = statusPageId;
        statusPage.projectId = projectId;
        statusPage.showSubscriberPageOnStatusPage = true;
        statusPage.enableEmailSubscribers = true;
        statusPage.enableSmsSubscribers = true;
        statusPage.enableSlackSubscribers = enableSlackSubscribers;
        return Promise.resolve(statusPage);
      });

    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.example.com");

    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockImplementation(findOneByFake as never);

    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockImplementation((): Promise<Array<StatusPage>> => {
        const statusPage: StatusPage = new StatusPage();
        statusPage.id = statusPageId;
        statusPage.projectId = projectId;
        statusPage.name = "Victim Status";
        return Promise.resolve([statusPage]);
      });

    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockResolvedValue(null);

    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(Hostname.fromString("oneuptime.example.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);

    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
    jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never);
    jest
      .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue({} as never);

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("requests naming more than one contact", () => {
    it("sends nothing when an unmatched email is paired with a subscriber's phone", async () => {
      await callManageSubscription({
        subscriberEmail: ATTACKER_EMAIL,
        subscriberPhone: VICTIM_PHONE,
      });

      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);
      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(StatusPageSubscriberService.findOneBy).not.toHaveBeenCalled();
    });

    it("sends nothing when an unmatched phone is paired with a subscriber's email", async () => {
      await callManageSubscription({
        subscriberEmail: VICTIM_EMAIL,
        subscriberPhone: ATTACKER_PHONE,
      });

      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);
      expect(getThrownError()).toBeInstanceOf(BadDataException);
    });

    it("sends nothing when an email is paired with a subscriber's Slack workspace", async () => {
      await callManageSubscription({
        subscriberEmail: ATTACKER_EMAIL,
        slackWorkspaceName: VICTIM_SLACK_WORKSPACE,
      });

      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);
      expect(getThrownError()).toBeInstanceOf(BadDataException);
    });
  });

  describe("email lookup", () => {
    it("sends the link only to the stored email", async () => {
      await callManageSubscription({ subscriberEmail: VICTIM_EMAIL });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(sentEmails()).toEqual([VICTIM_EMAIL]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);

      const vars: JSONObject = (
        (MailService.sendMail as unknown as jest.Mock).mock.calls[0]![0] as {
          vars: JSONObject;
        }
      ).vars;
      expect(String(vars["manageSubscriptionUrl"])).toContain(
        emailSubscriber.id!.toString(),
      );
    });
  });

  describe("phone lookup", () => {
    it("sends the link only to the stored phone", async () => {
      await callManageSubscription({ subscriberPhone: VICTIM_PHONE });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(sentEmails()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);

      const sms: Array<{ to: string; message: string }> = sentSms();
      expect(sms.length).toBe(1);
      expect(sms[0]!.to).toBe(phoneSubscriber.subscriberPhone!.toString());
      expect(sms[0]!.message).toContain(phoneSubscriber.id!.toString());
    });

    it("looks the subscriber up by phone alone, on this status page", async () => {
      await callManageSubscription({ subscriberPhone: VICTIM_PHONE });

      const calls: Array<Array<unknown>> = (
        StatusPageSubscriberService.findOneBy as unknown as jest.Mock
      ).mock.calls as Array<Array<unknown>>;
      expect(calls.length).toBe(1);

      const query: JSONObject = (calls[0]![0] as { query: JSONObject }).query;
      expect(Object.keys(query).sort()).toEqual(
        ["statusPageId", "subscriberPhone"].sort(),
      );
      expect(query["statusPageId"]?.toString()).toBe(statusPageId.toString());
    });
  });

  describe("Slack lookup", () => {
    it("sends the link only to the stored webhook", async () => {
      await callManageSubscription({
        slackWorkspaceName: VICTIM_SLACK_WORKSPACE,
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);

      const messages: Array<{ url: string; text: string }> =
        sentSlackMessages();
      expect(messages.length).toBe(1);
      expect(messages[0]!.url).toBe(VICTIM_SLACK_WEBHOOK);
      expect(messages[0]!.text).toContain(slackSubscriber.id!.toString());
    });

    it("ignores a webhook supplied in the request", async () => {
      await callManageSubscription({
        slackWorkspaceName: VICTIM_SLACK_WORKSPACE,
        slackIncomingWebhookUrl: ATTACKER_SLACK_WEBHOOK,
      });

      const urls: Array<string> = sentSlackMessages().map(
        (message: { url: string }) => {
          return message.url;
        },
      );
      expect(urls).toEqual([VICTIM_SLACK_WEBHOOK]);
    });

    it("sends nothing when Slack subscribers are disabled", async () => {
      enableSlackSubscribers = false;

      await callManageSubscription({
        slackWorkspaceName: VICTIM_SLACK_WORKSPACE,
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(sentSlackMessages()).toEqual([]);
    });
  });

  describe("unknown subscribers", () => {
    it("answers exactly as for a known subscriber and sends nothing", async () => {
      await callManageSubscription({ subscriberEmail: ATTACKER_EMAIL });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);

      jest.clearAllMocks();
      await callManageSubscription({ subscriberEmail: VICTIM_EMAIL });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(sentEmails()).toEqual([VICTIM_EMAIL]);
    });

    it("answers an unknown phone or Slack workspace the same way", async () => {
      await callManageSubscription({ subscriberPhone: ATTACKER_PHONE });
      await callManageSubscription({ slackWorkspaceName: "Nobody Inc" });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(2);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);
    });
  });
});
