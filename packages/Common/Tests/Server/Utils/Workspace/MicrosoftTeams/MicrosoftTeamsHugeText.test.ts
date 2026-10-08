import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES,
  MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import API from "../../../../../Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * MICROSOFT TEAMS MESSAGES WHATEVER SIZE OF TEXT THEY CARRY.
 *
 * A description can carry a response body or a log of many megabytes. The
 * incoming webhook's card builder reads the Markdown with regular
 * expressions, and ran out of stack on a long line of JSON, a run of links
 * or a long table; and Teams refuses a message much over 80 KB anyway. So a
 * markdown text - the webhook card's and a bot message's text block - is cut
 * to MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES (as Teams counts it, two
 * bytes a character) and ends with the note a cut Slack message ends with.
 */

const MIB: number = 1024 * 1024;
const MAX_LENGTH: number = MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES / 2;
const NOTE: string = MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE;

const WEBHOOK_URL: URL = URL.fromString(
  "https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi",
);

let sentCards: Array<JSONObject>;

beforeEach(() => {
  sentCards = [];

  jest.spyOn(API, "post").mockImplementation((async (options: {
    data: JSONObject;
  }): Promise<HTTPResponse<JSONObject>> => {
    sentCards.push(options.data);
    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function cardFor(markdown: string): Promise<JSONObject> {
  await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
    url: WEBHOOK_URL,
    text: markdown,
  });

  expect(sentCards).toHaveLength(1);

  return sentCards[0]!;
}

function sectionTextOf(card: JSONObject): string {
  return (
    ((card["sections"] as Array<JSONObject> | undefined)?.[0]?.[
      "text"
    ] as string) || ""
  );
}

describe("MicrosoftTeamsMessageSize.fitMarkdownText", () => {
  test("ends a cut text with the words a cut Slack message ends with", () => {
    expect(NOTE).toBe(SlackUtil.TRUNCATED_SECTION_NOTE);
    expect(MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES).toBe(80 * 1024);
  });

  test("leaves a text that fits as it is", () => {
    const text: string = "x".repeat(MAX_LENGTH);

    expect(MicrosoftTeamsMessageSize.fitMarkdownText(text) === text).toBe(true);
  });

  test("cuts a longer text to the budget, at a line break near the end, with the note", () => {
    const text: string = "an affected resource\n".repeat(5000);

    const fitted: string = MicrosoftTeamsMessageSize.fitMarkdownText(text);

    expect(fitted.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(fitted.endsWith(`an affected resource${NOTE}`)).toBe(true);
    expect(text.startsWith(fitted.slice(0, -NOTE.length))).toBe(true);
  });

  test("cuts one long line where it stops fitting, never inside an emoji", () => {
    const fitted: string = MicrosoftTeamsMessageSize.fitMarkdownText(
      "😀".repeat(MAX_LENGTH),
    );

    const loneSurrogate: RegExp =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    expect(fitted.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(fitted.endsWith(NOTE)).toBe(true);
    expect(loneSurrogate.test(fitted)).toBe(false);
  });

  test("measures a cut text as JSON sends it: quotes and backslashes count twice", () => {
    const fitted: string = MicrosoftTeamsMessageSize.fitMarkdownText(
      '{"a":"\\"}'.repeat(2 * MIB),
    );

    expect(fitted.endsWith(NOTE)).toBe(true);
    expect(
      MicrosoftTeamsMessageSize.getSizeInBytes(JSON.stringify(fitted)),
    ).toBeLessThanOrEqual(MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES);
    // ...and still keeps most of what fits.
    expect(fitted.length).toBeGreaterThan(MAX_LENGTH / 3);
  });

  test("cuts shorter until what the caller builds from the text fits", () => {
    const measured: Array<number> = [];

    const fitted: string = MicrosoftTeamsMessageSize.fitMarkdownText(
      "an affected resource\n".repeat(100000),
      (text: string): number => {
        measured.push(text.length);
        return 7 * MicrosoftTeamsMessageSize.getSizeInBytes(text);
      },
    );

    expect(fitted.endsWith(NOTE)).toBe(true);
    expect(
      7 * MicrosoftTeamsMessageSize.getSizeInBytes(fitted),
    ).toBeLessThanOrEqual(MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES);
    expect(fitted.length).toBeGreaterThan(MAX_LENGTH / 10);
    expect(measured.length).toBeLessThanOrEqual(3);
  });

  test("never measures a text that fits", () => {
    const text: string = '"'.repeat(MAX_LENGTH);

    expect(
      MicrosoftTeamsMessageSize.fitMarkdownText(text, (): number => {
        throw new Error("A text that fits is not measured.");
      }) === text,
    ).toBe(true);
  });

  test("gives up after a few tries when nothing it cuts to fits", () => {
    let tries: number = 0;

    const fitted: string = MicrosoftTeamsMessageSize.fitMarkdownText(
      "x".repeat(MAX_LENGTH + 1),
      (): number => {
        tries++;
        return Number.MAX_SAFE_INTEGER;
      },
    );

    expect(tries).toBeLessThanOrEqual(5);
    expect(fitted.endsWith(NOTE)).toBe(true);
  });
});

describe("Microsoft Teams incoming webhook card - text of any size", () => {
  test.each([
    [
      "a line of JSON",
      `{"items":[${'{"id":1,"name":"web-01"},'.repeat(700000)}]}`,
    ],
    ["a run of links", "[a](https://example.com) ".repeat(700000)],
    [
      "a table",
      `| Host | State |\n| --- | --- |\n${"| web-01 | down |\n".repeat(1000000)}`,
    ],
    ["a log", "2026-10-08T10:00:00Z INFO request served\n".repeat(400000)],
  ])(
    "sixteen megabytes go as a card Teams takes, ending with the note: %s",
    async (_label: string, body: string) => {
      expect(body.length).toBeGreaterThan(15 * MIB);

      const card: JSONObject = await cardFor(`## Incident created\n\n${body}`);

      expect(card["title"]).toBe("Incident created");
      expect(
        MicrosoftTeamsMessageSize.getSizeInBytes(card),
      ).toBeLessThanOrEqual(MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES);
      expect(sectionTextOf(card).endsWith(NOTE.trim())).toBe(true);
    },
  );

  test("a text that fits makes the card it always made", async () => {
    const card: JSONObject = await cardFor(
      "## Incident created\n\n**Severity:** High\n\nThe API is down.\n\n[Open incident](https://oneuptime.example.com/i/1)",
    );

    expect(card).toEqual({
      ["@type"]: "MessageCard",
      ["@context"]: "https://schema.org/extensions",
      title: "Incident created",
      summary: "Incident created",
      sections: [
        {
          markdown: true,
          text: "The API is down.\n\nOpen incident",
          facts: [{ name: "Severity", value: "High" }],
        },
      ],
      potentialAction: [
        {
          ["@type"]: "OpenUri",
          name: "Open incident",
          targets: [
            { os: "default", uri: "https://oneuptime.example.com/i/1" },
          ],
        },
      ],
    });
  });

  test("a table that fits the text budget is never cut, however big its card", async () => {
    const markdown: string = `## Incident created\n\n| Host | State |\n| --- | --- |\n${"| web-01 | down |\n".repeat(2000)}`;

    expect(markdown.length).toBeLessThanOrEqual(MAX_LENGTH);

    const card: JSONObject = await cardFor(markdown);

    expect(card).toEqual(
      MicrosoftTeamsUtil["buildMessageCardFromFittedMarkdown"](markdown),
    );
    expect(sectionTextOf(card).includes(NOTE.trim())).toBe(false);
    expect(sectionTextOf(card).split("<tr>")).toHaveLength(2002);
  });
});

describe("Microsoft Teams bot text block - text of any size", () => {
  function textBlockFor(text: string): string {
    return MicrosoftTeamsUtil.getMarkdownBlock({
      payloadMarkdownBlock: { _type: "WorkspacePayloadMarkdown", text: text },
    })["text"] as string;
  }

  test("sixteen megabytes are cut to the budget, ending with the note", () => {
    const text: string = textBlockFor(`Before\n\n${"a".repeat(16 * MIB)}`);

    expect(text.length).toBeLessThanOrEqual(MAX_LENGTH);
    expect(text.startsWith("Before")).toBe(true);
    expect(text.endsWith(NOTE)).toBe(true);
  });

  test("a text that fits is the text block it always was", () => {
    const markdown: string = `**Incident created**\n\n${"- an affected resource\n".repeat(1000)}`;

    expect(textBlockFor(markdown)).toBe(markdown);
  });
});
