import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import { ExpressRequest } from "../../../Server/Utils/Express";
import PublicMessageRateLimit from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import StatusPageSubscriberWebhookUtil from "../../../Server/Utils/StatusPageSubscriberWebhook";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { mockRouter } from "../API/Helpers";
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
 * THE "YOU HAVE SUBSCRIBED" MESSAGE GOES TO A NEW SUBSCRIBER ONLY WHEN IT WAS
 * CREATED TO GET ONE.
 *
 * Send Subscription Notification (sendYouHaveSubscribedMessage) is the word
 * of whoever creates a subscriber on whether it is welcomed. The dashboard's
 * add form and its Add in Bulk import ask, and start off; the API, Terraform
 * and workflows send it, or leave it to the column's default, on. On every
 * channel - email, SMS, Slack, Microsoft Teams and webhook - a subscriber
 * created with it off is sent nothing as it is created. Slack's welcome used
 * to go out all the same, so a CSV import of customers' Slack channels
 * during a migration posted "📢 New Subscription to ..." in every one of
 * them.
 *
 * Someone who subscribes on the status page itself is always welcomed: the
 * sign-up turns it on, whatever the channel.
 *
 * The database is stood in for: onCreateSuccess is handed the row as saved,
 * and every sender is recorded, not called.
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

const STATUS_PAGE_URL: string = "https://status.acme.com";
const TOKEN: string = "7a".repeat(32);

const EMAIL: string = "subscriber@example.com";
const PHONE: string = "+15555550100";
const SLACK_WEBHOOK: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_WEBHOOK: string =
  "https://example.webhook.office.com/webhookb2/abc";
const WEBHOOK: string = "https://hooks.example.com/in";

interface Channel {
  channel: string;
  // Gives a subscriber this channel's contact, as the dashboard or the API sets it.
  giveContact: (row: StatusPageSubscriber) => void;
  // What sends this channel's "you have subscribed" message.
  sender: () => unknown;
}

const CHANNELS: Array<Channel> = [
  {
    channel: "email",
    giveContact: (row: StatusPageSubscriber): void => {
      row.subscriberEmail = new Email(EMAIL);
    },
    sender: (): unknown => {
      return StatusPageSubscriberService.sendYouHaveSubscribedEmail;
    },
  },
  {
    channel: "SMS",
    giveContact: (row: StatusPageSubscriber): void => {
      row.subscriberPhone = new Phone(PHONE);
    },
    sender: (): unknown => {
      return SmsService.sendSms;
    },
  },
  {
    channel: "Slack",
    giveContact: (row: StatusPageSubscriber): void => {
      row.slackIncomingWebhookUrl = URL.fromString(SLACK_WEBHOOK);
      row.slackWorkspaceName = "Acme";
    },
    sender: (): unknown => {
      return SlackUtil.sendMessageToChannelViaIncomingWebhook;
    },
  },
  {
    channel: "Microsoft Teams",
    giveContact: (row: StatusPageSubscriber): void => {
      row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_WEBHOOK);
      row.microsoftTeamsWorkspaceName = "Acme";
    },
    sender: (): unknown => {
      return MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook;
    },
  },
  {
    channel: "webhook",
    giveContact: (row: StatusPageSubscriber): void => {
      row.subscriberWebhook = URL.fromString(WEBHOOK);
    },
    sender: (): unknown => {
      return StatusPageSubscriberWebhookUtil.sendWebhookNotification;
    },
  },
];

interface SignUp {
  channel: string;
  // The contact, as the status page's subscribe form sends it.
  contact: JSONObject;
}

/*
 * The sign-ups that are welcomed as they are created. One by email is sent a
 * confirmation link instead, and is welcomed once it confirms (see Email
 * double opt-in).
 */
const SIGN_UPS: Array<SignUp> = [
  { channel: "SMS", contact: { subscriberPhone: PHONE } },
  {
    channel: "Slack",
    contact: {
      slackIncomingWebhookUrl: SLACK_WEBHOOK,
      slackWorkspaceName: "Acme",
    },
  },
  {
    channel: "Microsoft Teams",
    contact: {
      microsoftTeamsIncomingWebhookUrl: TEAMS_WEBHOOK,
      microsoftTeamsWorkspaceName: "Acme",
    },
  },
  { channel: "webhook", contact: { subscriberWebhook: WEBHOOK } },
];

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

// The channels a "you have subscribed" message went out on.
function sentOn(): Array<string> {
  return CHANNELS.filter((channel: Channel): boolean => {
    return mock(channel.sender()).mock.calls.length > 0;
  }).map((channel: Channel): string => {
    return channel.channel;
  });
}

// The status page: every channel on, and no SMS config of its own.
function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.isPublicStatusPage = true;
  page.showSubscriberPageOnStatusPage = true;
  page.enableEmailSubscribers = true;
  page.enableSmsSubscribers = true;
  page.enableSlackSubscribers = true;
  page.enableMicrosoftTeamsSubscribers = true;
  page.enableWebhookSubscribers = true;
  return page;
}

type CreateSuccess = (
  onCreate: OnCreate<StatusPageSubscriber>,
  createdItem: StatusPageSubscriber,
) => Promise<StatusPageSubscriber>;

const hooks: { onCreateSuccess: CreateSuccess } =
  StatusPageSubscriberService as unknown as { onCreateSuccess: CreateSuccess };

/*
 * A subscriber saved: the row, as the database hands it back with its id and
 * unsubscribe token, goes to onCreateSuccess.
 */
async function saved(
  createBy: CreateBy<StatusPageSubscriber>,
): Promise<StatusPageSubscriber> {
  const row: StatusPageSubscriber = createBy.data;
  row._id = SUBSCRIBER_ID.toString();
  row.unsubscribeToken = TOKEN;

  return await hooks.onCreateSuccess(
    {
      createBy: createBy,
      carryForward: { statusPage: statusPage(), replacedSubscriberIds: [] },
    },
    row,
  );
}

beforeEach(() => {
  /*
   * Every request here is within the limits on what a public route may
   * send its contacts (PublicMessageRateLimit), which
   * StatusPageSubscriberMessageLimits.test.ts holds.
   */
  jest
    .spyOn(PublicMessageRateLimit, "assertMaySend")
    .mockResolvedValue(undefined);

  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue(STATUS_PAGE_URL);
  jest.spyOn(StatusPageService, "findOneBy").mockResolvedValue(statusPage());

  jest
    .spyOn(StatusPageSubscriberService, "sendYouHaveSubscribedEmail")
    .mockResolvedValue(undefined);
  jest
    .spyOn(StatusPageSubscriberService, "sendConfirmSubscriptionEmail")
    .mockResolvedValue(undefined);
  jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined as never);
  jest
    .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MicrosoftTeamsUtil, "sendMessageToChannelViaIncomingWebhook")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(StatusPageSubscriberWebhookUtil, "sendWebhookNotification")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A subscriber the team adds - on the dashboard, in bulk, or through the API", () => {
  function added(
    channel: Channel,
    sendYouHaveSubscribedMessage: boolean,
  ): CreateBy<StatusPageSubscriber> {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row.projectId = PROJECT_ID;
    row.statusPageId = STATUS_PAGE_ID;
    channel.giveContact(row);
    // Confirmed, as the dashboard adds one: "Do not send confirmation link" starts on.
    row.isSubscriptionConfirmed = true;
    row.sendYouHaveSubscribedMessage = sendYouHaveSubscribedMessage;
    return { data: row, props: { isRoot: true } };
  }

  test.each(CHANNELS)(
    "on $channel, with Send Subscription Notification off, is sent nothing",
    async (channel: Channel) => {
      await saved(added(channel, false));

      expect(sentOn()).toEqual([]);
    },
  );

  test.each(CHANNELS)(
    "on $channel, with Send Subscription Notification on, is sent the message once, on its own channel",
    async (channel: Channel) => {
      await saved(added(channel, true));

      expect(sentOn()).toEqual([channel.channel]);
      expect(mock(channel.sender())).toHaveBeenCalledTimes(1);
    },
  );
});

describe("A visitor who subscribes on the status page", () => {
  let api: StatusPageAPI;

  beforeAll(() => {
    api = new StatusPageAPI();
  });

  beforeEach(() => {
    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });
    // The sign-up's create, down to the database: the row it would write is saved.
    jest.spyOn(StatusPageSubscriberService, "create").mockImplementation(saved);
  });

  function signUpRequest(contact: JSONObject): ExpressRequest {
    return {
      params: { statusPageId: STATUS_PAGE_ID.toString() },
      body: {
        data: {
          ...contact,
          isSubscribedToAllResources: true,
          isSubscribedToAllEventTypes: true,
        },
      },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;
  }

  test.each(SIGN_UPS)(
    "by $channel is sent the message once, on its own channel",
    async (signUp: SignUp) => {
      await api.subscribeToStatusPage(signUpRequest(signUp.contact));

      const signedUp: CreateBy<StatusPageSubscriber> = mock(
        StatusPageSubscriberService.create,
      ).mock.calls[0]![0] as CreateBy<StatusPageSubscriber>;

      expect(signedUp.data.sendYouHaveSubscribedMessage).toBe(true);
      expect(sentOn()).toEqual([signUp.channel]);
      expect(
        mock(
          CHANNELS.find((channel: Channel): boolean => {
            return channel.channel === signUp.channel;
          })!.sender(),
        ),
      ).toHaveBeenCalledTimes(1);
    },
  );
});
