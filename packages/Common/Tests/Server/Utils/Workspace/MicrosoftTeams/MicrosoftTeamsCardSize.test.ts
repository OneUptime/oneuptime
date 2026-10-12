import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_INCOMING_WEBHOOK_BUDGET_IN_BYTES,
  MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES,
  MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import { JSONObject } from "../../../../../Types/JSON";
import WorkspaceMessagePayload from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * EVERY TEAMS CARD IS MEASURED AS IT IS SENT.
 *
 * A bot's card carries up to forty text blocks, each held to the budget on
 * its own: together they could be several times what Teams takes, and Teams
 * refuses the whole message (HTTP 413). An incoming webhook takes far less
 * than a bot (28 KB), and its card's tables are HTML several times the size
 * of their Markdown. So a bot's card is held to
 * MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES (fitAdaptiveCard) and a
 * webhook's to MICROSOFT_TEAMS_INCOMING_WEBHOOK_BUDGET_IN_BYTES, as each is
 * sent, whatever the length of its text.
 */

const NOTE: string = MICROSOFT_TEAMS_TRUNCATED_TEXT_NOTE;

function textBlock(text: string): JSONObject {
  return { type: "TextBlock", text: text, wrap: true };
}

function card(body: Array<JSONObject>): JSONObject {
  return {
    type: "AdaptiveCard",
    version: "1.5",
    body: body,
    actions: [{ type: "Action.OpenUrl", title: "Open", url: "https://a.b" }],
  };
}

function textsOf(fitted: JSONObject): Array<string> {
  return (fitted["body"] as Array<JSONObject>)
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return element["text"] as string;
    });
}

describe("MicrosoftTeamsMessageSize.getIncomingWebhookSizeInBytes", () => {
  test("is the larger of the size as Teams counts a bot message and as the request carries it", () => {
    // ASCII: two bytes a character as Teams counts it, one in UTF-8.
    expect(MicrosoftTeamsMessageSize.getIncomingWebhookSizeInBytes("abc")).toBe(
      6,
    );
    // Most Asian scripts: three bytes a character in UTF-8.
    expect(
      MicrosoftTeamsMessageSize.getIncomingWebhookSizeInBytes("障害"),
    ).toBe(6);
    // A card is measured as its JSON: mostly ASCII, UTF-16 is the larger...
    expect(
      MicrosoftTeamsMessageSize.getIncomingWebhookSizeInBytes({ a: "障害" }),
    ).toBe(2 * JSON.stringify({ a: "障害" }).length);
    // ...mostly Asian script, UTF-8 is.
    const asian: JSONObject = { a: "障".repeat(100) };

    expect(MicrosoftTeamsMessageSize.getIncomingWebhookSizeInBytes(asian)).toBe(
      Buffer.byteLength(JSON.stringify(asian), "utf8"),
    );
    expect(
      MicrosoftTeamsMessageSize.getIncomingWebhookSizeInBytes(asian),
    ).toBeGreaterThan(MicrosoftTeamsMessageSize.getSizeInBytes(asian));
  });

  test("an incoming webhook's budget is well under the 28 KB Microsoft allows", () => {
    expect(MICROSOFT_TEAMS_INCOMING_WEBHOOK_BUDGET_IN_BYTES).toBe(24 * 1024);
    expect(MICROSOFT_TEAMS_INCOMING_WEBHOOK_BUDGET_IN_BYTES).toBeLessThan(
      28 * 1024,
    );
  });
});

describe("MicrosoftTeamsMessageSize.fitAdaptiveCard", () => {
  test("a card that fits is returned as it is", () => {
    const fits: JSONObject = card([textBlock("**Incident created**")]);

    expect(MicrosoftTeamsMessageSize.fitAdaptiveCard(fits)).toBe(fits);
  });

  test("forty blocks that each fit, together over the budget, are cut - the longest, to about the same size", () => {
    const body: Array<JSONObject> = [textBlock("**Incident created**")];

    for (let index: number = 0; index < 39; index++) {
      body.push(
        textBlock(`Line ${index}\n${"an affected resource\n".repeat(150)}`),
      );
    }

    const original: JSONObject = card(body);

    expect(MicrosoftTeamsMessageSize.getSizeInBytes(original)).toBeGreaterThan(
      MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES,
    );

    const fitted: JSONObject =
      MicrosoftTeamsMessageSize.fitAdaptiveCard(original);
    const texts: Array<string> = textsOf(fitted);

    expect(
      MicrosoftTeamsMessageSize.getSizeInBytes(fitted),
    ).toBeLessThanOrEqual(MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES);
    // The title is short, and stays whole.
    expect(texts[0]).toBe("**Incident created**");
    expect(texts).toHaveLength(40);

    for (const text of texts.slice(1)) {
      expect(text.endsWith(NOTE)).toBe(true);
      expect(text.startsWith("Line ")).toBe(true);
    }

    // The original card is not changed.
    expect(textsOf(original)[1]!.endsWith(NOTE)).toBe(false);
    // The actions are kept.
    expect(fitted["actions"]).toEqual(original["actions"]);
  });

  test("images are not counted: Teams leaves them out of a message's size", () => {
    const withImage: JSONObject = card([
      textBlock("A screenshot"),
      { type: "Image", url: `data:image/png;base64,${"A".repeat(500000)}` },
    ]);

    expect(MicrosoftTeamsMessageSize.fitAdaptiveCard(withImage)).toBe(
      withImage,
    );
  });

  test("a card with no text block to cut is returned as it is", () => {
    const noText: JSONObject = card([
      { type: "FactSet", facts: [{ title: "a", value: "b".repeat(100000) }] },
    ]);

    expect(MicrosoftTeamsMessageSize.fitAdaptiveCard(noText)).toBe(noText);
  });

  test("a card is held to the budget it is given", () => {
    const original: JSONObject = card([
      textBlock("x".repeat(20000)),
      textBlock("y".repeat(20000)),
    ]);

    const fitted: JSONObject = MicrosoftTeamsMessageSize.fitAdaptiveCard(
      original,
      16 * 1024,
    );

    expect(
      MicrosoftTeamsMessageSize.getSizeInBytes(fitted),
    ).toBeLessThanOrEqual(16 * 1024);
  });
});

describe("Microsoft Teams bot message - many long blocks", () => {
  test("a card built from a message of many long text blocks is within what Teams takes", () => {
    const payload: WorkspaceMessagePayload = {
      _type: "WorkspaceMessagePayload",
      channelNames: [],
      channelIds: [],
      messageBlocks: [
        { _type: "WorkspacePayloadHeader", text: "Incident created" },
        ...Array.from({ length: 30 }, (_value: unknown, index: number) => {
          return {
            _type: "WorkspacePayloadMarkdown" as const,
            text: `**Note ${index}**\n\n${"a log line of a response body\n".repeat(1200)}`,
          };
        }),
      ],
    } as unknown as WorkspaceMessagePayload;

    const built: JSONObject = MicrosoftTeamsUtil[
      "buildAdaptiveCardFromMessageBlocks"
    ]({
      messageBlocks: payload.messageBlocks,
    });

    expect(MicrosoftTeamsMessageSize.getSizeInBytes(built)).toBeLessThanOrEqual(
      MICROSOFT_TEAMS_MARKDOWN_TEXT_BUDGET_IN_BYTES,
    );
    expect(
      textsOf(built).some((text: string): boolean => {
        return text.endsWith(NOTE);
      }),
    ).toBe(true);
  });
});
