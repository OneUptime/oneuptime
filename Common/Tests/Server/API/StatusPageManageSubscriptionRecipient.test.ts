import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI, {
  MAX_SUBSCRIBERS_PER_MANAGE_SUBSCRIPTION_REQUEST,
} from "../../../Server/API/StatusPageAPI";
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
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
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
const VICTIM_TEAMS_WORKSPACE: string = "Victim Teams";
const VICTIM_TEAMS_WEBHOOK: string =
  "https://victim.webhook.office.com/webhookb2/victim";

const ATTACKER_EMAIL: string = "attacker@example.com";
const ATTACKER_PHONE: string = "+15559870002";
const ATTACKER_SLACK_WEBHOOK: string =
  "https://hooks.slack.com/services/T999/B999/attacker";
const ATTACKER_TEAMS_WEBHOOK: string =
  "https://attacker.webhook.office.com/webhookb2/attacker";

/*
 * The manage-subscription endpoint is reachable without authentication and
 * sends a link that opens the matched subscription: whoever holds it can read
 * the subscriber's contact details and change or cancel the subscription. The
 * link must therefore only ever reach the contact stored on the subscriber it
 * opens — never an address supplied in the request.
 */

interface SentMessage {
  to: string;
  text: string;
}

describe("StatusPageAPI manage-subscription link recipient", () => {
  let statusPageId: ObjectID;
  let projectId: ObjectID;
  let storedSubscribers: Array<StatusPageSubscriber>;
  let emailSubscriber: StatusPageSubscriber;
  let phoneSubscriber: StatusPageSubscriber;
  let slackSubscriber: StatusPageSubscriber;
  let teamsSubscriber: StatusPageSubscriber;
  let enableSlackSubscribers: boolean;
  let enableMicrosoftTeamsSubscribers: boolean;
  let subscriberCount: number;
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let sendLinksSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  /*
   * Stands in for the database: matches on every queried column, honours the
   * sort, skip and limit, and — like the real query — returns only the
   * columns that were selected.
   */
  const findByFake: (findBy: {
    query: JSONObject;
    select: JSONObject;
    sort?: JSONObject;
    limit: number;
    skip: number;
  }) => Promise<Array<StatusPageSubscriber>> = (findBy: {
    query: JSONObject;
    select: JSONObject;
    sort?: JSONObject;
    limit: number;
    skip: number;
  }): Promise<Array<StatusPageSubscriber>> => {
    const matches: Array<StatusPageSubscriber> = storedSubscribers.filter(
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

    if (findBy.sort?.["createdAt"]) {
      const direction: number =
        findBy.sort["createdAt"] === SortOrder.Ascending ? 1 : -1;
      matches.sort((a: StatusPageSubscriber, b: StatusPageSubscriber) => {
        return direction * (a.createdAt!.getTime() - b.createdAt!.getTime());
      });
    }

    const page: Array<StatusPageSubscriber> = matches.slice(
      findBy.skip,
      findBy.skip + findBy.limit,
    );

    return Promise.resolve(
      page.map((stored: StatusPageSubscriber) => {
        const selected: StatusPageSubscriber = new StatusPageSubscriber();
        selected.id = stored.id!;

        for (const column of Object.keys(findBy.select)) {
          if (column !== "_id" && findBy.select[column]) {
            selected.setColumnValue(column, stored.getColumnValue(column));
          }
        }

        return selected;
      }),
    );
  };

  /*
   * Each new subscriber is created a minute after the previous one, whatever
   * position it is stored at.
   */
  const buildSubscriber: (
    data: Record<string, unknown>,
  ) => StatusPageSubscriber = (
    data: Record<string, unknown>,
  ): StatusPageSubscriber => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.id = ObjectID.generate();
    subscriber.statusPageId = statusPageId;
    subscriber.projectId = projectId;
    subscriber.createdAt = new Date(Date.UTC(2026, 0, 1, 0, subscriberCount));
    subscriberCount++;
    Object.assign(subscriber, data);
    return subscriber;
  };

  // Runs the route handler only; links it queues may still be on their way.
  const invokeManageSubscription: (data: JSONObject) => Promise<void> = async (
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
  };

  const callManageSubscription: (data: JSONObject) => Promise<void> = async (
    data: JSONObject,
  ): Promise<void> => {
    await invokeManageSubscription(data);

    // The links are sent in the background; wait for them before checking what went out.
    await Promise.all(
      sendLinksSpy.mock.results.map((result: jest.MockResult<unknown>) => {
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

  const sentSms: () => Array<SentMessage> = (): Array<SentMessage> => {
    return (SmsService.sendSms as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>) => {
        const sms: { to: Phone; message: string } = call[0] as {
          to: Phone;
          message: string;
        };
        return { to: sms.to.toString(), text: sms.message };
      },
    );
  };

  const webhookMessages: (sender: unknown) => Array<SentMessage> = (
    sender: unknown,
  ): Array<SentMessage> => {
    return (sender as jest.Mock).mock.calls.map((call: Array<unknown>) => {
      const message: { url: URL; text: string } = call[0] as {
        url: URL;
        text: string;
      };
      return { to: message.url.toString(), text: message.text };
    });
  };

  const sentSlackMessages: () => Array<SentMessage> =
    (): Array<SentMessage> => {
      return webhookMessages(SlackUtil.sendMessageToChannelViaIncomingWebhook);
    };

  const sentTeamsMessages: () => Array<SentMessage> =
    (): Array<SentMessage> => {
      return webhookMessages(
        MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
      );
    };

  const expectNothingSent: () => void = (): void => {
    expect(sentEmails()).toEqual([]);
    expect(sentSms()).toEqual([]);
    expect(sentSlackMessages()).toEqual([]);
    expect(sentTeamsMessages()).toEqual([]);
  };

  const getThrownError: () => unknown = (): unknown => {
    const calls: Array<Array<unknown>> = (nextFunction as jest.Mock).mock
      .calls as Array<Array<unknown>>;

    expect(calls.length).toBe(1);
    return calls[0]![0];
  };

  const lookupCall: () => {
    query: JSONObject;
    select: JSONObject;
    sort: JSONObject;
    limit: number;
    skip: number;
  } = () => {
    const calls: Array<Array<unknown>> = (
      StatusPageSubscriberService.findBy as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;
    expect(calls.length).toBe(1);

    return calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      limit: number;
      skip: number;
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    statusPageId = ObjectID.generate();
    projectId = ObjectID.generate();
    enableSlackSubscribers = true;
    enableMicrosoftTeamsSubscribers = true;
    subscriberCount = 0;

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
    teamsSubscriber = buildSubscriber({
      microsoftTeamsWorkspaceName: VICTIM_TEAMS_WORKSPACE,
      microsoftTeamsIncomingWebhookUrl: URL.fromString(VICTIM_TEAMS_WEBHOOK),
    });
    storedSubscribers = [
      emailSubscriber,
      phoneSubscriber,
      slackSubscriber,
      teamsSubscriber,
    ];

    sendLinksSpy = jest.spyOn(
      StatusPageAPI.prototype,
      "sendManageSubscriptionLinks",
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
        statusPage.enableMicrosoftTeamsSubscribers =
          enableMicrosoftTeamsSubscribers;
        return Promise.resolve(statusPage);
      });

    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.example.com");

    jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockImplementation(findByFake as never);

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
    jest
      .spyOn(MicrosoftTeamsUtil, "sendMessageToChannelViaIncomingWebhook")
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

      expectNothingSent();
      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(StatusPageSubscriberService.findBy).not.toHaveBeenCalled();
    });

    it("sends nothing when an unmatched phone is paired with a subscriber's email", async () => {
      await callManageSubscription({
        subscriberEmail: VICTIM_EMAIL,
        subscriberPhone: ATTACKER_PHONE,
      });

      expectNothingSent();
      expect(getThrownError()).toBeInstanceOf(BadDataException);
    });

    it("sends nothing when an email is paired with a subscriber's Slack workspace", async () => {
      await callManageSubscription({
        subscriberEmail: ATTACKER_EMAIL,
        slackWorkspaceName: VICTIM_SLACK_WORKSPACE,
      });

      expectNothingSent();
      expect(getThrownError()).toBeInstanceOf(BadDataException);
    });

    it("sends nothing when an email is paired with a subscriber's Microsoft Teams workspace", async () => {
      await callManageSubscription({
        subscriberEmail: ATTACKER_EMAIL,
        microsoftTeamsWorkspaceName: VICTIM_TEAMS_WORKSPACE,
      });

      expectNothingSent();
      expect(getThrownError()).toBeInstanceOf(BadDataException);
    });

    it("sends nothing when a Slack workspace is paired with a Microsoft Teams workspace", async () => {
      await callManageSubscription({
        slackWorkspaceName: VICTIM_SLACK_WORKSPACE,
        microsoftTeamsWorkspaceName: VICTIM_TEAMS_WORKSPACE,
      });

      expectNothingSent();
      expect(getThrownError()).toBeInstanceOf(BadDataException);
    });
  });

  describe("identifier format", () => {
    it("rejects a Slack workspace name that is not text, before any lookup", async () => {
      await callManageSubscription({
        slackWorkspaceName: { $ne: null },
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(StatusPageSubscriberService.findBy).not.toHaveBeenCalled();
      expectNothingSent();
    });

    it("rejects a Microsoft Teams workspace name that is not text, before any lookup", async () => {
      await callManageSubscription({
        microsoftTeamsWorkspaceName: [VICTIM_TEAMS_WORKSPACE, "Other"],
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expect(StatusPageSubscriberService.findBy).not.toHaveBeenCalled();
      expectNothingSent();
    });
  });

  describe("subscribers storing more than one contact", () => {
    const MULTI_EMAIL: string = "multi@example.com";
    const MULTI_PHONE: string = "+15551230003";
    const MULTI_WORKSPACE: string = "Multi Corp";
    const MULTI_SLACK_WEBHOOK: string =
      "https://hooks.slack.com/services/T111/B111/multi";
    const MULTI_TEAMS_WEBHOOK: string =
      "https://multi.webhook.office.com/webhookb2/multi";

    let multiSubscriber: StatusPageSubscriber;

    beforeEach(() => {
      multiSubscriber = buildSubscriber({
        subscriberEmail: new Email(MULTI_EMAIL),
        subscriberPhone: new Phone(MULTI_PHONE),
        slackWorkspaceName: MULTI_WORKSPACE,
        slackIncomingWebhookUrl: URL.fromString(MULTI_SLACK_WEBHOOK),
        microsoftTeamsWorkspaceName: MULTI_WORKSPACE,
        microsoftTeamsIncomingWebhookUrl: URL.fromString(MULTI_TEAMS_WEBHOOK),
      });
      storedSubscribers.push(multiSubscriber);
    });

    it("an email lookup sends the link by email only", async () => {
      await callManageSubscription({ subscriberEmail: MULTI_EMAIL });

      expect(sentEmails()).toEqual([MULTI_EMAIL]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);
      expect(sentTeamsMessages()).toEqual([]);
    });

    it("a phone lookup sends the link by SMS only", async () => {
      await callManageSubscription({ subscriberPhone: MULTI_PHONE });

      expect(sentEmails()).toEqual([]);
      expect(
        sentSms().map((sms: SentMessage) => {
          return sms.to;
        }),
      ).toEqual([MULTI_PHONE]);
      expect(sentSlackMessages()).toEqual([]);
      expect(sentTeamsMessages()).toEqual([]);
    });

    it("a Slack lookup sends the link to the Slack webhook only", async () => {
      await callManageSubscription({ slackWorkspaceName: MULTI_WORKSPACE });

      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);
      expect(
        sentSlackMessages().map((message: SentMessage) => {
          return message.to;
        }),
      ).toEqual([MULTI_SLACK_WEBHOOK]);
      expect(sentTeamsMessages()).toEqual([]);
    });

    it("a Microsoft Teams lookup sends the link to the Teams webhook only", async () => {
      await callManageSubscription({
        microsoftTeamsWorkspaceName: MULTI_WORKSPACE,
      });

      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);
      expect(
        sentTeamsMessages().map((message: SentMessage) => {
          return message.to;
        }),
      ).toEqual([MULTI_TEAMS_WEBHOOK]);
    });
  });

  describe("email lookup", () => {
    it("sends the link only to the stored email", async () => {
      await callManageSubscription({ subscriberEmail: VICTIM_EMAIL });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(sentEmails()).toEqual([VICTIM_EMAIL]);
      expect(sentSms()).toEqual([]);
      expect(sentSlackMessages()).toEqual([]);
      expect(sentTeamsMessages()).toEqual([]);

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
      expect(sentTeamsMessages()).toEqual([]);

      const sms: Array<SentMessage> = sentSms();
      expect(sms.length).toBe(1);
      expect(sms[0]!.to).toBe(phoneSubscriber.subscriberPhone!.toString());
      expect(sms[0]!.text).toContain(phoneSubscriber.id!.toString());
    });

    it("looks subscribers up by phone alone, on this status page, oldest first", async () => {
      await callManageSubscription({ subscriberPhone: VICTIM_PHONE });

      const lookup: {
        query: JSONObject;
        select: JSONObject;
        sort: JSONObject;
        limit: number;
        skip: number;
      } = lookupCall();

      expect(Object.keys(lookup.query).sort()).toEqual(
        ["statusPageId", "subscriberPhone"].sort(),
      );
      expect(lookup.query["statusPageId"]?.toString()).toBe(
        statusPageId.toString(),
      );
      expect(Object.keys(lookup.select).sort()).toEqual(
        ["_id", "subscriberPhone"].sort(),
      );
      expect(lookup.sort).toEqual({ createdAt: SortOrder.Ascending });
      expect(lookup.skip).toBe(0);
      expect(lookup.limit).toBe(
        MAX_SUBSCRIBERS_PER_MANAGE_SUBSCRIPTION_REQUEST,
      );
    });
  });

  interface WorkspaceCase {
    name: string;
    workspaceField: "slackWorkspaceName" | "microsoftTeamsWorkspaceName";
    webhookField:
      | "slackIncomingWebhookUrl"
      | "microsoftTeamsIncomingWebhookUrl";
    workspaceName: string;
    storedWebhook: string;
    attackerWebhook: string;
    subscriber: () => StatusPageSubscriber;
    sent: () => Array<SentMessage>;
    otherSent: () => Array<SentMessage>;
    disable: () => void;
  }

  const WORKSPACE_CASES: Array<WorkspaceCase> = [
    {
      name: "Slack",
      workspaceField: "slackWorkspaceName",
      webhookField: "slackIncomingWebhookUrl",
      workspaceName: VICTIM_SLACK_WORKSPACE,
      storedWebhook: VICTIM_SLACK_WEBHOOK,
      attackerWebhook: ATTACKER_SLACK_WEBHOOK,
      subscriber: () => {
        return slackSubscriber;
      },
      sent: () => {
        return sentSlackMessages();
      },
      otherSent: () => {
        return sentTeamsMessages();
      },
      disable: () => {
        enableSlackSubscribers = false;
      },
    },
    {
      name: "Microsoft Teams",
      workspaceField: "microsoftTeamsWorkspaceName",
      webhookField: "microsoftTeamsIncomingWebhookUrl",
      workspaceName: VICTIM_TEAMS_WORKSPACE,
      storedWebhook: VICTIM_TEAMS_WEBHOOK,
      attackerWebhook: ATTACKER_TEAMS_WEBHOOK,
      subscriber: () => {
        return teamsSubscriber;
      },
      sent: () => {
        return sentTeamsMessages();
      },
      otherSent: () => {
        return sentSlackMessages();
      },
      disable: () => {
        enableMicrosoftTeamsSubscribers = false;
      },
    },
  ];

  describe.each(WORKSPACE_CASES)("$name lookup", (workspace: WorkspaceCase) => {
    it("sends the link only to the stored webhook", async () => {
      await callManageSubscription({
        [workspace.workspaceField]: workspace.workspaceName,
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(sentEmails()).toEqual([]);
      expect(sentSms()).toEqual([]);
      expect(workspace.otherSent()).toEqual([]);

      const messages: Array<SentMessage> = workspace.sent();
      expect(messages.length).toBe(1);
      expect(messages[0]!.to).toBe(workspace.storedWebhook);
      expect(messages[0]!.text).toContain(
        workspace.subscriber().id!.toString(),
      );
    });

    it("ignores a webhook supplied in the request", async () => {
      await callManageSubscription({
        [workspace.workspaceField]: workspace.workspaceName,
        [workspace.webhookField]: workspace.attackerWebhook,
      });

      expect(
        workspace.sent().map((message: SentMessage) => {
          return message.to;
        }),
      ).toEqual([workspace.storedWebhook]);
    });

    it("sends nothing when these subscribers are disabled", async () => {
      workspace.disable();

      await callManageSubscription({
        [workspace.workspaceField]: workspace.workspaceName,
      });

      expect(getThrownError()).toBeInstanceOf(BadDataException);
      expectNothingSent();
    });

    it("sends each subscription sharing the workspace name its own link, on its own webhook", async () => {
      const otherChannel: StatusPageSubscriber = buildSubscriber({
        [workspace.workspaceField]: workspace.workspaceName,
        [workspace.webhookField]: URL.fromString(workspace.attackerWebhook),
      });
      storedSubscribers.push(otherChannel);

      await callManageSubscription({
        [workspace.workspaceField]: workspace.workspaceName,
      });

      expect(nextFunction).not.toHaveBeenCalled();

      const messages: Array<SentMessage> = workspace.sent();
      expect(
        messages
          .map((message: SentMessage) => {
            return message.to;
          })
          .sort(),
      ).toEqual([workspace.storedWebhook, workspace.attackerWebhook].sort());

      const victimId: string = workspace.subscriber().id!.toString();
      const otherId: string = otherChannel.id!.toString();

      for (const message of messages) {
        const ownId: string =
          message.to === workspace.storedWebhook ? victimId : otherId;
        const foreignId: string =
          message.to === workspace.storedWebhook ? otherId : victimId;

        expect(message.text).toContain(ownId);
        expect(message.text).not.toContain(foreignId);
      }
    });

    it("still reaches an existing subscription when many more are added under its name", async () => {
      const laterSubscriptions: Array<StatusPageSubscriber> = Array.from(
        { length: MAX_SUBSCRIBERS_PER_MANAGE_SUBSCRIPTION_REQUEST + 5 },
        (_value: unknown, index: number) => {
          return buildSubscriber({
            [workspace.workspaceField]: workspace.workspaceName,
            [workspace.webhookField]: URL.fromString(
              `${workspace.attackerWebhook}-${index}`,
            ),
          });
        },
      );

      // Stored ahead of the original, but created after it.
      storedSubscribers = [...laterSubscriptions, ...storedSubscribers];

      await callManageSubscription({
        [workspace.workspaceField]: workspace.workspaceName,
      });

      const messages: Array<SentMessage> = workspace.sent();
      expect(messages.length).toBe(
        MAX_SUBSCRIBERS_PER_MANAGE_SUBSCRIPTION_REQUEST,
      );

      const toVictim: Array<SentMessage> = messages.filter(
        (message: SentMessage) => {
          return message.to === workspace.storedWebhook;
        },
      );
      expect(toVictim.length).toBe(1);
      expect(toVictim[0]!.text).toContain(
        workspace.subscriber().id!.toString(),
      );
    });
  });

  describe("unknown subscribers", () => {
    it("answers exactly as for a known subscriber and sends nothing", async () => {
      await callManageSubscription({ subscriberEmail: ATTACKER_EMAIL });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expectNothingSent();
      expect(sendLinksSpy).not.toHaveBeenCalled();

      jest.clearAllMocks();
      await callManageSubscription({ subscriberEmail: VICTIM_EMAIL });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(sentEmails()).toEqual([VICTIM_EMAIL]);
    });

    it("answers an unknown phone, Slack or Microsoft Teams workspace the same way", async () => {
      await callManageSubscription({ subscriberPhone: ATTACKER_PHONE });
      await callManageSubscription({ slackWorkspaceName: "Nobody Inc" });
      await callManageSubscription({
        microsoftTeamsWorkspaceName: "Nobody Teams",
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(3);
      expectNothingSent();
    });

    it("answers before the link has been sent", async () => {
      // Sending never gets past its first step.
      jest
        .spyOn(StatusPageService, "getStatusPageURL")
        .mockReturnValue(new Promise<string>(() => {}));

      await invokeManageSubscription({ subscriberEmail: VICTIM_EMAIL });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(sendLinksSpy).toHaveBeenCalledTimes(1);
      expectNothingSent();
    });

    it("answers the same way when sending the link fails", async () => {
      jest
        .spyOn(StatusPageService, "getStatusPageURL")
        .mockRejectedValue(new Error("status page URL unavailable"));

      await callManageSubscription({ subscriberEmail: VICTIM_EMAIL }).catch(
        () => {
          // The background send's failure is awaited above; it must not reach the response.
        },
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expectNothingSent();
    });
  });
});
