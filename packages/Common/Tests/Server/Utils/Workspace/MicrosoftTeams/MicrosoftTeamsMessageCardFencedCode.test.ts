import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import API from "../../../../../Utils/API";
import { neutralizeAiWrittenMarkdown } from "../../../../../Utils/Markdown/UntrustedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * FENCED CODE IN A TEAMS INCOMING WEBHOOK'S MESSAGECARD.
 *
 * A MessageCard has no code blocks: every line of the message becomes text
 * in its section, read as Markdown with HTML, and a "[text](url)" on any line
 * becomes a button. Code - a command OneUptime AI suggests, a debug command
 * in a root cause, a log line - keeps the characters it was written with, so
 * the card builder shows fenced lines as text: escaped for HTML, and never a
 * button or a fact. Lines outside a fence read as before.
 */

const WEBHOOK_URL: URL = URL.fromString(
  "https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi",
);
const DETAILS_URL: string = "https://oneuptime.example/dashboard/incidents/42";

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

function buttonsOf(card: JSONObject): Array<string> {
  return ((card["potentialAction"] as Array<JSONObject>) || []).map(
    (action: JSONObject): string => {
      return (action["targets"] as Array<JSONObject>)[0]!["uri"] as string;
    },
  );
}

function sectionTextOf(card: JSONObject): string {
  const sections: Array<JSONObject> =
    (card["sections"] as Array<JSONObject>) || [];

  return sections
    .map((section: JSONObject): string => {
      return (section["text"] as string) || "";
    })
    .join("\n");
}

const FENCED_LINES: Array<string> = [
  "[Open the runbook](https://evil.example/login)",
  '<img src="https://tracker.example/p.png">',
  "<!-- the rest is hidden -->",
  "**Owner:** someone",
];

describe("a Teams MessageCard shows fenced code as text", () => {
  test.each([
    ["a backtick fence", "```", "```"],
    ["a tilde fence", "~~~", "~~~"],
    ["a fence with a language", "```bash", "```"],
    ["a longer closing fence", "```", "````"],
  ])(
    "%s: no button, no HTML, no fact from a line in it",
    async (_kind: string, opening: string, closing: string) => {
      const card: JSONObject = await cardFor(
        [
          "## AI investigation",
          "",
          `[Open the incident](${DETAILS_URL})`,
          "",
          opening,
          ...FENCED_LINES,
          closing,
        ].join("\n"),
      );

      // Only the line outside the fence is a button.
      expect(buttonsOf(card)).toEqual([DETAILS_URL]);

      const text: string = sectionTextOf(card);

      expect(text).toContain("[Open the runbook](https://evil.example/login)");
      expect(text).toContain('&lt;img src="https://tracker.example/p.png"&gt;');
      expect(text).toContain("&lt;!-- the rest is hidden --&gt;");
      expect(text).toContain("**Owner:** someone");
      expect(text).not.toMatch(/<img|<!--/);
      expect(card["sections"]).not.toEqual([
        expect.objectContaining({ facts: expect.anything() }),
      ]);
    },
  );

  test("a fence nested in a list item, indented, is code too", async () => {
    const card: JSONObject = await cardFor(
      [
        "## Suggested next steps",
        "",
        "1. Restart the pods:",
        "   ```bash",
        "   kubectl apply -f - <<EOF",
        "   [Open the runbook](https://evil.example/login)",
        "   EOF",
        "   ```",
        "2. Watch the error rate.",
      ].join("\n"),
    );

    expect(buttonsOf(card)).toEqual([]);
    expect(sectionTextOf(card)).toContain("kubectl apply -f - &lt;&lt;EOF");
    expect(sectionTextOf(card)).toContain("2. Watch the error rate.");
  });

  test("an unclosed fence runs to the end of the message", async () => {
    const card: JSONObject = await cardFor(
      [
        "## AI investigation",
        "```",
        "[Open the runbook](https://evil.example/login)",
        '<img src="https://tracker.example/p.png">',
      ].join("\n"),
    );

    expect(buttonsOf(card)).toEqual([]);
    expect(sectionTextOf(card)).not.toMatch(/<img/);
  });

  test("lines after a closed fence read as before: a link is a button again", async () => {
    const card: JSONObject = await cardFor(
      [
        "## AI investigation",
        "```",
        "echo hi",
        "```",
        `[Open the incident](${DETAILS_URL})`,
        "**Severity:** High",
      ].join("\n"),
    );

    expect(buttonsOf(card)).toEqual([DETAILS_URL]);
    expect(card["sections"]).toEqual([
      expect.objectContaining({
        facts: [{ name: "Severity", value: "High" }],
      }),
    ]);
  });

  test("three backticks with another backtick after them open no fence", async () => {
    const card: JSONObject = await cardFor(
      [
        "## AI investigation",
        "```inline``` code",
        `[Open the incident](${DETAILS_URL})`,
      ].join("\n"),
    );

    expect(buttonsOf(card)).toEqual([DETAILS_URL]);
  });

  test("OneUptime AI's fenced command reaches the card with its characters, and acts on nothing", async () => {
    const answer: string = neutralizeAiWrittenMarkdown(
      [
        "## Fix",
        "",
        "Apply this:",
        "```bash",
        "kubectl apply -f - <<EOF",
        "apiVersion: v1",
        "EOF",
        "```",
        "",
        "[Open the runbook](https://evil.example/login)",
      ].join("\n"),
    );

    const card: JSONObject = await cardFor(answer);

    // The heredoc is intact; the link outside the fence is broken, so no button.
    expect(sectionTextOf(card)).toContain("kubectl apply -f - &lt;&lt;EOF");
    expect(buttonsOf(card)).toEqual([]);
  });
});
