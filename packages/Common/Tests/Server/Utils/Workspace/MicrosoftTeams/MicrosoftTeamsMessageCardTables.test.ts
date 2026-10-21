import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import API from "../../../../../Utils/API";
import { mdText } from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * TABLES IN A TEAMS INCOMING WEBHOOK'S MESSAGECARD.
 *
 * A MessageCard has no Markdown tables, so the card builder turns a
 * Markdown table into an HTML table in the section's text. Teams reads that
 * text as HTML, and reads no Markdown inside the table: so each cell is
 * written the way it reads - the Markdown escapes it was written with
 * undone - and escaped for HTML, so a "<img ...>" in a name is those
 * characters, never an image fetched when the card is opened. A "|" a cell
 * escaped stays in its cell.
 */

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

async function sectionTextFor(markdown: string): Promise<string> {
  await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
    url: WEBHOOK_URL,
    text: markdown,
  });

  expect(sentCards).toHaveLength(1);

  const sections: Array<JSONObject> =
    (sentCards[0]!["sections"] as Array<JSONObject>) || [];

  return sections
    .map((section: JSONObject): string => {
      return (section["text"] as string) || "";
    })
    .join("\n");
}

// The text of each <th> and <td> in the card, in order.
function cellsOf(text: string): Array<string> {
  return Array.from(text.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!.replace(/<\/?strong>/g, "");
    },
  );
}

describe("a Teams MessageCard's table cells", () => {
  test("a tag in a cell is its characters, not HTML", async () => {
    const text: string = await sectionTextFor(
      [
        "**Affected services**",
        "",
        "| Name | Owner |",
        "| --- | --- |",
        '| <img src="https://tracker.example/p.png"> | <a href="https://evil.example">Open</a> |',
        "",
      ].join("\n"),
    );

    expect(cellsOf(text)).toEqual([
      "Name",
      "Owner",
      '&lt;img src="https://tracker.example/p.png"&gt;',
      '&lt;a href="https://evil.example"&gt;Open&lt;/a&gt;',
    ]);
    expect(text).not.toMatch(/<img|<a /);
  });

  test("names placed into a table with mdText read as typed, each in its own cell", async () => {
    const table: string = mdText`| ${"Service <b>"} | Owner |
| --- | --- |
| ${"Checkout [EU] *prod* a|b"} | ${"R&D <ops> \\ team"} |
`.toString();

    // The names are escaped where they were placed...
    expect(table).toContain("Checkout \\[EU\\] \\*prod\\* a\\|b");

    const text: string = await sectionTextFor(`**Owners**\n\n${table}`);

    // ...and the card's cells read them as typed, made safe for HTML.
    expect(cellsOf(text)).toEqual([
      "Service &lt;b&gt;",
      "Owner",
      "Checkout [EU] *prod* a|b",
      "R&amp;D &lt;ops&gt; \\ team",
    ]);
    expect(text).not.toMatch(/<b>|<ops>/);
  });

  test("an ordinary table is unchanged", async () => {
    const text: string = await sectionTextFor(
      [
        "**Monitors**",
        "",
        "| Monitor | Status |",
        "| --- | --- |",
        "| API | Down |",
        "",
      ].join("\n"),
    );

    expect(cellsOf(text)).toEqual(["Monitor", "Status", "API", "Down"]);
  });
});
