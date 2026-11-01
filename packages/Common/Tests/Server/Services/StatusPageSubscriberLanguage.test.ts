import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService, {
  getConfirmSubscriptionTextMessage,
  getYouHaveSubscribedTextMessage,
  UNSUPPORTED_SUBSCRIBER_LANGUAGE_MESSAGE,
} from "../../../Server/Services/StatusPageSubscriberService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { READER_LANGUAGE_CODES } from "../../../Types/ReaderLanguage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A STATUS PAGE SUBSCRIBER'S LANGUAGE, AND THE MESSAGES ABOUT THEIR
 * SUBSCRIPTION IN IT.
 *
 * A subscriber's language is one of the codes OneUptime writes in, or none
 * (the page's default): a team that gives one through the API is held to
 * that. The link to confirm a subscription, the welcome and the manage link
 * are written in it, as every notification after them is.
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
const SLACK_WEBHOOK: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_WEBHOOK: string = "https://outlook.office.com/webhook/abc";

type NormalizeLanguage = (data: JSONObject | undefined) => void;

const normalizeLanguage: NormalizeLanguage = (
  data: JSONObject | undefined,
): void => {
  (
    StatusPageSubscriberService as unknown as {
      normalizeLanguage: NormalizeLanguage;
    }
  ).normalizeLanguage(data);
};

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

describe("a subscriber's language, as it is stored", () => {
  test.each<[unknown, unknown]>([
    ["de", "de"],
    ["de-AT", "de"],
    ["zh-hk", "zh-TW"],
    [" fa ", "fa"],
    ["", null],
    [null, null],
  ])("%p is stored as %p", (given: unknown, stored: unknown) => {
    const data: JSONObject = { language: given as string };

    normalizeLanguage(data);

    expect(data["language"]).toBe(stored);
  });

  test("a language OneUptime does not write in is refused, naming the ones it does", () => {
    for (const given of ["klingon", 42, { code: "de" }]) {
      expect(() => {
        normalizeLanguage({ language: given as JSONObject["language"] });
      }).toThrow(BadDataException);
    }

    for (const code of READER_LANGUAGE_CODES) {
      expect(UNSUPPORTED_SUBSCRIBER_LANGUAGE_MESSAGE).toContain(code);
    }
  });

  test("data that names no language is left as it is", () => {
    const data: JSONObject = { subscriberEmail: "a@example.com" };

    normalizeLanguage(data);
    normalizeLanguage(undefined);

    expect(data).toEqual({ subscriberEmail: "a@example.com" });
  });

  test("both a create and a change are held to it", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../Server/Services/StatusPageSubscriberService.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "this.normalizeLanguage(data.data as unknown as JSONObject);",
    );
    expect(source).toContain(
      "this.normalizeLanguage(updateBy.data as unknown as JSONObject | undefined);",
    );
  });
});

describe("the text messages about a subscription", () => {
  test("in English, exactly as they always were", () => {
    expect(
      getConfirmSubscriptionTextMessage({
        statusPageName: "Acme Status",
        confirmationUrl: "https://status.acme.com/confirm/1",
      }),
    ).toBe(
      "Confirm your subscription to Acme Status by text message within 24 hours. Not you? Ignore this and you will not be subscribed. https://status.acme.com/confirm/1",
    );
    expect(
      getYouHaveSubscribedTextMessage({
        statusPageName: "Acme Status",
        unsubscribeUrl: "https://status.acme.com/unsubscribe/1",
      }),
    ).toBe(
      "You have been subscribed to Acme Status. To unsubscribe, click on the link: https://status.acme.com/unsubscribe/1",
    );
  });

  test("in the subscriber's language, the link last and whole", () => {
    const german: string = getConfirmSubscriptionTextMessage({
      statusPageName: "Acme Status",
      confirmationUrl: "https://status.acme.com/confirm/1",
      translator: getServerTranslator("de"),
    });

    expect(german).toContain("innerhalb von 24 Stunden");
    expect(german.endsWith(" https://status.acme.com/confirm/1")).toBe(true);

    // Persian writes the hours in its own digits, as its sentences do.
    expect(
      getConfirmSubscriptionTextMessage({
        statusPageName: "Acme Status",
        confirmationUrl: "https://status.acme.com/confirm/1",
        translator: getServerTranslator("fa"),
      }),
    ).toContain("۲۴");

    expect(
      getYouHaveSubscribedTextMessage({
        statusPageName: "Acme Status",
        unsubscribeUrl: "https://status.acme.com/unsubscribe/1",
        translator: getServerTranslator("ru"),
      }),
    ).toBe(
      "Вы подписались на Acme Status. Чтобы отписаться, откройте ссылку: https://status.acme.com/unsubscribe/1",
    );
  });
});

describe("the welcome a Slack or Teams channel gets", () => {
  beforeEach(() => {
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
      .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MicrosoftTeamsUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(SlackUtil, "convertMarkdownToSlackRichText")
      .mockImplementation((markdown: string): string => {
        return markdown;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function welcome(data: {
    pageLanguage?: string;
    subscriberLanguage?: string;
  }): Promise<{ slack: string; teams: string }> {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    page.projectId = PROJECT_ID;
    page.name = "Acme";
    page.pageTitle = "Acme Status";
    page.isPublicStatusPage = true;

    if (data.pageLanguage) {
      page.defaultLanguage = data.pageLanguage;
    }

    const created: StatusPageSubscriber = new StatusPageSubscriber();
    created._id = SUBSCRIBER_ID.toString();
    created.projectId = PROJECT_ID;
    created.statusPageId = STATUS_PAGE_ID;
    created.slackIncomingWebhookUrl = URL.fromString(SLACK_WEBHOOK);
    created.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_WEBHOOK);
    created.isSubscriptionConfirmed = true;
    created.sendYouHaveSubscribedMessage = true;
    created.unsubscribeToken = TOKEN;

    if (data.subscriberLanguage) {
      created.language = data.subscriberLanguage;
    }

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
        carryForward: { statusPage: page, replacedSubscriberIds: [] },
      },
      created,
    );

    return {
      slack: String(
        mock(SlackUtil.convertMarkdownToSlackRichText).mock.calls[0]![0],
      ),
      teams: (
        mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
          .calls[0]![0] as { text: string }
      ).text,
    };
  }

  test("on a page whose default language is German, in German", async () => {
    const { slack, teams } = await welcome({ pageLanguage: "de" });

    for (const message of [slack, teams]) {
      expect(message).toContain("## 📢 Neues Abonnement von Acme Status");
      expect(message).toContain(
        "**Sie haben Status-Updates erfolgreich abonniert!**",
      );
      expect(message).toContain(`[Acme Status](${STATUS_PAGE_URL})`);
      expect(message).toContain("Diese Benachrichtigungen beenden");
      expect(message).not.toContain("You will receive");
    }
  });

  test("for a visitor who read the page in Japanese, in Japanese", async () => {
    const { slack } = await welcome({
      pageLanguage: "de",
      subscriberLanguage: "ja",
    });

    expect(slack).toContain("Acme Status の新しい購読");
    expect(slack).toContain("インシデントと障害");
  });

  test("on an English page, as it always was", async () => {
    const { slack } = await welcome({});

    expect(slack).toContain("## 📢 New Subscription to Acme Status");
    expect(slack).toContain("Stay informed about service availability! 🚀");
  });
});
