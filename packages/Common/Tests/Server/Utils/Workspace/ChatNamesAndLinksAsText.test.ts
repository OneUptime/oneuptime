import User from "../../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import UserService from "../../../../Server/Services/UserService";
import MicrosoftTeamsUtil from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import API from "../../../../Utils/API";
import { WORD_JOINER } from "../../../../Utils/Markdown/MarkdownEscape";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { marked } from "marked";

/*
 * A NAME IS TEXT IN A LINK, AND A LINK IS ONLY WHAT MARKDOWN READS AS ONE.
 *
 * A person's name heads feed items and chat messages as the text of a link
 * to their profile, and a title or a name escaped where it was placed
 * (MarkdownEscape) only looks like a link. Both must stay that way on their
 * way out:
 *
 *   - UserService.getUserMarkdownString puts the name inside the link's
 *     text, every Markdown character in it escaped, so the link still goes
 *     to the profile and its text still reads as the name;
 *   - a Teams channel's incoming webhook gets a MessageCard built from the
 *     Markdown, whose links become buttons: only a link Markdown itself
 *     reads becomes a button, its name is the plain text, and the message's
 *     text keeps the escapes it was written with.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194d4ba-0000-4000-8000-00000000c101",
);
const USER_ID: ObjectID = new ObjectID("0194d4ba-0000-4000-8000-00000000c102");

const DASHBOARD_URL: string = "https://oneuptime.example/dashboard";
const PROFILE_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/settings/users/${USER_ID.toString()}`;

const HOSTILE_NAME: string =
  "Jane](https://evil.example/login) ![](https://tracker.example/p.png) <!channel> <b>Doe</b>";

const HTML_LINK_PATTERN: RegExp = /<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

function linksIn(markdown: string): Array<{ href: string; text: string }> {
  const html: string = marked.parse(markdown, { async: false }) as string;

  return Array.from(html.matchAll(HTML_LINK_PATTERN)).map(
    (match: RegExpMatchArray): { href: string; text: string } => {
      return {
        href: match[1]!,
        text: match[2]!
          .replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, "&")
          .split(WORD_JOINER)
          .join(""),
      };
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserService.getUserMarkdownString", () => {
  function userNamed(data: { name?: string; email?: string }): User {
    const user: User = new User();
    user._id = USER_ID.toString();

    if (data.name !== undefined) {
      user.name = data.name as never;
    }

    if (data.email !== undefined) {
      user.email = data.email as never;
    }

    return user;
  }

  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
  });

  async function markdownFor(user: User | null): Promise<string> {
    jest.spyOn(UserService, "findOneBy").mockResolvedValue(user as never);

    return (
      await UserService.getUserMarkdownString({
        userId: USER_ID,
        projectId: PROJECT_ID,
      })
    ).toString();
  }

  test("a name is the text of one link to the profile, and reads as typed", async () => {
    const markdown: string = await markdownFor(
      userNamed({ name: HOSTILE_NAME }),
    );

    expect(linksIn(markdown)).toEqual([
      { href: PROFILE_URL, text: HOSTILE_NAME },
    ]);
    expect(marked.parse(markdown, { async: false }) as string).not.toContain(
      "<img",
    );
    expect(markdown).toContain(`\\<${WORD_JOINER}\\!channel>`);
  });

  test("Slack reads no mention in the name, and no other link", async () => {
    const markdown: string = await markdownFor(
      userNamed({ name: HOSTILE_NAME }),
    );
    const slack: string = SlackUtil.convertMarkdownToSlackRichText(
      `${markdown} acknowledged the alert.`,
    );

    expect(slack).not.toMatch(/<[!@#]/);
    expect(slack).not.toMatch(/<https:\/\/(?:evil|tracker)\.example[^|>]*\|/);
    expect(slack).toContain(`<${PROFILE_URL}|`);
  });

  test("a user without a name is named by their email, escaped the same way", async () => {
    const markdown: string = await markdownFor(
      userNamed({ email: "jane_doe+[sre]@example.com" }),
    );

    expect(markdown).toBe(`[jane\\_doe+\\[sre\\]@example.com](${PROFILE_URL})`);
    expect(linksIn(markdown)).toEqual([
      { href: PROFILE_URL, text: "jane_doe+[sre]@example.com" },
    ]);
  });

  test("a user with neither is 'User'", async () => {
    expect(await markdownFor(userNamed({}))).toBe(`[User](${PROFILE_URL})`);
  });

  test("an ordinary name reads exactly as typed", async () => {
    const markdown: string = await markdownFor(
      userNamed({ name: "Jane O'Neil-Doe (SRE)" }),
    );

    expect(linksIn(markdown)).toEqual([
      { href: PROFILE_URL, text: "Jane O'Neil-Doe (SRE)" },
    ]);
  });

  test("an unknown user is still no text at all", async () => {
    expect(await markdownFor(null)).toBe("");
  });
});

describe("a Teams incoming webhook's MessageCard", () => {
  const WEBHOOK_URL: URL = URL.fromString(
    "https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi",
  );
  const ALERT_URL: string = "https://oneuptime.example/dashboard/alerts/42";

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

  async function cardFor(markdown: string): Promise<JSONObject> {
    await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
      url: WEBHOOK_URL,
      text: markdown,
    });

    expect(sentCards).toHaveLength(1);

    return sentCards[0]!;
  }

  function buttonsOf(card: JSONObject): Array<{ name: string; uri: string }> {
    return ((card["potentialAction"] as Array<JSONObject>) || []).map(
      (action: JSONObject): { name: string; uri: string } => {
        return {
          name: action["name"] as string,
          uri: (action["targets"] as Array<JSONObject>)[0]!["uri"] as string,
        };
      },
    );
  }

  function sectionTextOf(card: JSONObject): string {
    const sections: Array<JSONObject> =
      (card["sections"] as Array<JSONObject>) || [];

    return JSON.stringify(sections);
  }

  test("a title escaped inside a link makes one button to the link's own address", async () => {
    const card: JSONObject = await cardFor(
      [
        "🚨 Alert update",
        `⚠️ **[Alert #42: \\[Reset your password\\](https://evil.example/login)](${ALERT_URL})**`,
        "**Severity:** High",
      ].join("\n\n"),
    );

    expect(buttonsOf(card)).toEqual([
      {
        name: "Alert #42: [Reset your password](https://evil.example/login)",
        uri: ALERT_URL,
      },
    ]);

    /*
     * The section is read as Markdown: the title stays escaped there, so it
     * is no link of its own.
     */
    expect(sectionTextOf(card)).toContain(
      "Alert #42: \\\\[Reset your password\\\\](https://evil.example/login)",
    );
    expect(sectionTextOf(card)).not.toMatch(
      /(?<!\\\\)\[Reset your password\]\(https:\/\/evil\.example/,
    );
  });

  test("text that only looks like a link makes no button", async () => {
    const card: JSONObject = await cardFor(
      [
        "🚨 Alert update",
        "**Title:** \\[Open\\](https://evil.example/login) and !\\[\\](https://tracker.example/p.png)",
        "**State:** \\[Acknowledged\\](https://evil.example/state)",
      ].join("\n\n"),
    );

    expect(buttonsOf(card)).toEqual([]);
    expect(card["sections"]).toEqual([
      expect.objectContaining({
        facts: [
          {
            name: "Title",
            value:
              "\\[Open\\](https://evil.example/login) and !\\[\\](https://tracker.example/p.png)",
          },
          {
            name: "State",
            value: "\\[Acknowledged\\](https://evil.example/state)",
          },
        ],
      }),
    ]);
  });

  test("an escaped title in the card's first line leaves the card's title as text", async () => {
    const card: JSONObject = await cardFor(
      [
        `**[Alert #42: \\[Open\\](https://evil.example/login)](${ALERT_URL})**`,
        "**Severity:** High",
      ].join("\n\n"),
    );

    expect(card["title"]).toBe(
      "Alert #42: \\[Open\\](https://evil.example/login)",
    );
  });

  /*
   * The summary is plain text - Teams shows it in notifications and the
   * activity feed - so the escapes the title was written with are undone
   * there, and it reads as the title was typed.
   */
  test("the card's summary reads as the title was typed", async () => {
    const card: JSONObject = await cardFor(
      [
        "## 🚨 Incident - Disk \\[prod\\] full \\<b>now\\</b>",
        "**Severity:** High",
      ].join("\n\n"),
    );

    expect(card["title"]).toBe(
      "🚨 Incident - Disk \\[prod\\] full \\<b>now\\</b>",
    );
    expect(card["summary"]).toBe("🚨 Incident - Disk [prod] full <b>now</b>");
  });

  test("a link right after an escaped backslash is still a link", async () => {
    /*
     * "C:\\" is a value ending in a backslash, escaped: a literal backslash,
     * and then a real link.
     */
    const card: JSONObject = await cardFor(
      ["🚨 Alert update", `Path C:\\\\[View](${ALERT_URL}) now`].join("\n\n"),
    );

    expect(buttonsOf(card)).toEqual([{ name: "View", uri: ALERT_URL }]);
  });

  test("an escaped bracket after an escaped backslash opens no link", async () => {
    // A literal backslash, then a literal "[": three backslashes before it.
    const card: JSONObject = await cardFor(
      [
        "🚨 Alert update",
        "Path C:\\\\\\[View\\](https://evil.example/login) now",
      ].join("\n\n"),
    );

    expect(buttonsOf(card)).toEqual([]);
  });

  test("an ordinary link still becomes a button, and its text stays in the sentence", async () => {
    const card: JSONObject = await cardFor(
      [
        "🚨 Alert update",
        `Alert [#42](${ALERT_URL}) was acknowledged.`,
        `[View Alert](${ALERT_URL})`,
      ].join("\n\n"),
    );

    expect(buttonsOf(card)).toEqual([
      { name: "#42", uri: ALERT_URL },
      { name: "View Alert", uri: ALERT_URL },
    ]);
    expect(sectionTextOf(card)).toContain("Alert #42 was acknowledged.");
  });

  test("a '$' in a link's text is kept as written", async () => {
    const card: JSONObject = await cardFor(
      ["🚨 Alert update", `Cost [$& over $1 budget](${ALERT_URL}) now`].join(
        "\n\n",
      ),
    );

    expect(buttonsOf(card)).toEqual([
      { name: "$& over $1 budget", uri: ALERT_URL },
    ]);
    expect(sectionTextOf(card)).toContain("Cost $& over $1 budget now");
  });
});
