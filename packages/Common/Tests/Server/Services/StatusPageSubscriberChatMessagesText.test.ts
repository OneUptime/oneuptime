import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Lexer, Token, Tokens, marked } from "marked";

/*
 * A STATUS PAGE'S NAME, IN THE SLACK AND TEAMS MESSAGES A SUBSCRIBER GETS
 * WHEN THEY SUBSCRIBE, AND IN THE TEST NOTIFICATION.
 *
 * The name is plain text the page's admins typed - or set through the API,
 * with a line break in it. The messages are Markdown: in the heading and in
 * the link to the page, the name reads as typed, on one line, and is no
 * link, image, HTML or chat mention there. The message's own links are
 * still links, to OneUptime's addresses.
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

const HOSTILE_PAGE_NAME: string =
  "Acme <!channel>\n# [Reset your password](https://evil.example/login) ![](https://tracker.example/p.png) <b>now</b>";
const HOSTILE_PAGE_NAME_ON_ONE_LINE: string = HOSTILE_PAGE_NAME.replace(
  /\n/g,
  " ",
);

const SLACK_WEBHOOK: string = "https://hooks.slack.com/services/T000/B000/XXXX";
const TEAMS_WEBHOOK: string = "https://outlook.office.com/webhook/abc";

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

// A Markdown text as its reader sees it: backslash escapes and joiners gone.
function asRead(markdown: string): string {
  return markdown
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .split("⁠")
    .join("");
}

function tokensOf(markdown: string): Array<Token> {
  const tokens: Array<Token> = [];

  marked.walkTokens(
    new Lexer({ gfm: true }).lex(markdown),
    (token: Token): void => {
      tokens.push(token);
    },
  );

  return tokens;
}

/*
 * Nothing of the name acts on its own: no image, no HTML, no heading of its
 * own, no link to an address it brought whose words hide where it goes, and
 * no Slack mention. Every link left goes to OneUptime's addresses or shows
 * its own address.
 */
function expectNameInert(markdown: string): void {
  const tokens: Array<Token> = tokensOf(markdown);

  expect(
    tokens
      .filter((token: Token): boolean => {
        return (
          token.type === "image" ||
          (token.type === "html" && /<\/?[A-Za-z]/.test(token.raw))
        );
      })
      .map((token: Token): string => {
        return token.raw;
      }),
  ).toEqual([]);

  expect(
    tokens
      .filter((token: Token): boolean => {
        return token.type === "heading";
      })
      .map((token: Token): string => {
        return asRead((token as Tokens.Heading).raw.trim());
      })
      .filter((heading: string): boolean => {
        return heading.startsWith("# [Reset");
      }),
  ).toEqual([]);

  for (const token of tokens) {
    if (token.type !== "link") {
      continue;
    }

    const link: Tokens.Link = token as Tokens.Link;

    if (/^https:\/\/(?:evil|tracker)\.example/.test(link.href)) {
      expect(link.text.replace(/&amp;/g, "&")).toBe(link.href);
    }
  }

  expect(SlackUtil.convertMarkdownToSlackRichText(markdown)).not.toMatch(
    /<[!@#][A-Za-z0-9]/,
  );
}

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("The Slack and Teams messages a new subscriber gets", () => {
  function chatSubscriber(): StatusPageSubscriber {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = SUBSCRIBER_ID.toString();
    row.projectId = PROJECT_ID;
    row.statusPageId = STATUS_PAGE_ID;
    row.slackIncomingWebhookUrl = URL.fromString(SLACK_WEBHOOK);
    row.microsoftTeamsIncomingWebhookUrl = URL.fromString(TEAMS_WEBHOOK);
    row.isSubscriptionConfirmed = true;
    row.sendYouHaveSubscribedMessage = true;
    row.unsubscribeToken = TOKEN;
    return row;
  }

  async function subscribe(): Promise<{ slack: string; teams: string }> {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    page.projectId = PROJECT_ID;
    page.name = "Acme";
    page.pageTitle = HOSTILE_PAGE_NAME;
    page.isPublicStatusPage = true;

    /*
     * The Slack message goes through Slack's Markdown conversion on its way
     * out: record what it was given.
     */
    const converted: Array<string> = [];
    const realConvert: (markdown: string) => string =
      SlackUtil.convertMarkdownToSlackRichText.bind(SlackUtil);
    jest
      .spyOn(SlackUtil, "convertMarkdownToSlackRichText")
      .mockImplementation((markdown: string): string => {
        converted.push(markdown);
        return realConvert(markdown);
      });

    const created: StatusPageSubscriber = chatSubscriber();

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

    expect(converted).toHaveLength(1);
    expect(
      mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook),
    ).toHaveBeenCalledTimes(1);

    return {
      slack: converted[0]!,
      teams: (
        mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
          .calls[0]![0] as { text: string }
      ).text,
    };
  }

  test("the page's name reads as typed, on one line, in the heading and the link", async () => {
    const { slack, teams } = await subscribe();

    for (const message of [slack, teams]) {
      expect(asRead(message.split("\n")[0]!)).toBe(
        `## 📢 New Subscription to ${HOSTILE_PAGE_NAME_ON_ONE_LINE}`,
      );
      expect(asRead(message)).toContain(
        `🔗 **Status Page:** [${HOSTILE_PAGE_NAME_ON_ONE_LINE}](${STATUS_PAGE_URL})`,
      );
    }
  });

  test("nothing in the name acts on its own, and the message's own links still go to the status page", async () => {
    const { slack, teams } = await subscribe();

    for (const message of [slack, teams]) {
      expectNameInert(message);

      const hrefs: Array<string> = tokensOf(message)
        .filter((token: Token): boolean => {
          return token.type === "link";
        })
        .map((token: Token): string => {
          return (token as Tokens.Link).href;
        });

      expect(hrefs).toContain(STATUS_PAGE_URL);
      expect(hrefs).toContain(
        `${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID.toString()}-${TOKEN}`,
      );
    }
  });

  test("the link to the status page is one link whose words are the page's name", async () => {
    const { teams } = await subscribe();

    const statusPageLinks: Array<Tokens.Link> = tokensOf(teams).filter(
      (token: Token): boolean => {
        return (
          token.type === "link" &&
          (token as Tokens.Link).href === STATUS_PAGE_URL
        );
      },
    ) as Array<Tokens.Link>;

    expect(statusPageLinks).toHaveLength(1);
    // No image or second link inside its words.
    expect(
      (statusPageLinks[0]!.tokens || []).filter((token: Token): boolean => {
        return token.type === "image" || token.type === "link";
      }),
    ).toEqual([]);
  });
});

describe("The Slack test notification for a status page", () => {
  test("names the page as typed, on one line, and nothing in the name acts on its own", async () => {
    jest.spyOn(StatusPageService, "findOneById").mockImplementation((async () => {
      const page: StatusPage = new StatusPage();
      page._id = STATUS_PAGE_ID.toString();
      page.projectId = PROJECT_ID;
      page.pageTitle = HOSTILE_PAGE_NAME;
      return page;
    }) as never);

    const converted: Array<string> = [];
    const realConvert: (markdown: string) => string =
      SlackUtil.convertMarkdownToSlackRichText.bind(SlackUtil);
    jest
      .spyOn(SlackUtil, "convertMarkdownToSlackRichText")
      .mockImplementation((markdown: string): string => {
        converted.push(markdown);
        return realConvert(markdown);
      });

    await StatusPageSubscriberService.testSlackWebhook({
      webhookUrl: SLACK_WEBHOOK,
      statusPageId: STATUS_PAGE_ID,
    });

    expect(converted).toHaveLength(1);
    expect(asRead(converted[0]!.split("\n")[0]!)).toBe(
      `## Test Notification - ${HOSTILE_PAGE_NAME_ON_ONE_LINE}`,
    );
    expectNameInert(converted[0]!);
  });
});
