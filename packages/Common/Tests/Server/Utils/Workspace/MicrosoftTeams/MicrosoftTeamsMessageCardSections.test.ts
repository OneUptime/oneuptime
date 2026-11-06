import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import {
  MessageCardPart,
  MessageCardSection,
  toMessageCardSections,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageCardText";
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
 * A MESSAGE CARD DRAWS ITS TEXT AND ITS FACTS IN THE ORDER THEY WERE WRITTEN.
 *
 * Teams draws a MessageCard section's text above its facts. Every incoming
 * webhook's card was one section of all its text and all its facts, so
 * whatever a message wrote after a "**Label:** value" line was drawn above
 * it: a status page's incident card read its description first and its
 * severity under it. A card is now cut into sections where text follows a
 * fact (toMessageCardSections).
 */

const text: (words: string) => MessageCardPart = (
  words: string,
): MessageCardPart => {
  return { text: words };
};

const fact: (name: string, value: string) => MessageCardPart = (
  name: string,
  value: string,
): MessageCardPart => {
  return { fact: { name, value } };
};

describe("toMessageCardSections", () => {
  test("nothing makes no section", () => {
    expect(toMessageCardSections([])).toEqual([]);
  });

  test("paragraphs side by side are one section's text, as they were", () => {
    expect(
      toMessageCardSections([text("The API is down."), text("We are on it.")]),
    ).toEqual([{ markdown: true, text: "The API is down.\n\nWe are on it." }]);
  });

  test("facts alone are one section's facts, in order", () => {
    expect(
      toMessageCardSections([fact("Severity", "High"), fact("State", "Open")]),
    ).toEqual([
      {
        markdown: true,
        facts: [
          { name: "Severity", value: "High" },
          { name: "State", value: "Open" },
        ],
      },
    ]);
  });

  test("text before facts shares their section: Teams draws it above them", () => {
    expect(
      toMessageCardSections([
        text("**New note has been added to an incident**"),
        fact("Resources Affected", "Checkout API"),
        fact("Severity", "Major Incident"),
      ]),
    ).toEqual([
      {
        markdown: true,
        text: "**New note has been added to an incident**",
        facts: [
          { name: "Resources Affected", value: "Checkout API" },
          { name: "Severity", value: "Major Incident" },
        ],
      },
    ]);
  });

  test("text after a fact starts a section of its own, below it", () => {
    expect(
      toMessageCardSections([
        fact("Severity", "Critical"),
        fact("Resources Affected", "Checkout API"),
        text("**Description:** Payments fail in the EU."),
      ]),
    ).toEqual([
      {
        markdown: true,
        facts: [
          { name: "Severity", value: "Critical" },
          { name: "Resources Affected", value: "Checkout API" },
        ],
      },
      { markdown: true, text: "**Description:** Payments fail in the EU." },
    ]);
  });

  test("text and facts that take turns keep every turn in its place", () => {
    const sections: Array<MessageCardSection> = toMessageCardSections([
      fact("Severity", "High"),
      text("The API is down."),
      text("We are on it."),
      fact("Owner", "Kai"),
      text("**Note:** Traffic moved."),
    ]);

    expect(sections).toEqual([
      { markdown: true, facts: [{ name: "Severity", value: "High" }] },
      {
        markdown: true,
        text: "The API is down.\n\nWe are on it.",
        facts: [{ name: "Owner", value: "Kai" }],
      },
      { markdown: true, text: "**Note:** Traffic moved." },
    ]);

    // Drawn as Teams draws them - each section's text, then its facts.
    const drawn: Array<string> = sections.flatMap(
      (section: MessageCardSection): Array<string> => {
        return [
          ...(section.text ? [section.text] : []),
          ...(section.facts || []).map(
            (item: { name: string; value: string }): string => {
              return `${item.name}: ${item.value}`;
            },
          ),
        ];
      },
    );

    expect(drawn).toEqual([
      "Severity: High",
      "The API is down.\n\nWe are on it.",
      "Owner: Kai",
      "**Note:** Traffic moved.",
    ]);
  });

  test("a section never carries an empty text or an empty list of facts", () => {
    for (const section of toMessageCardSections([
      fact("Severity", "High"),
      text("Down."),
      fact("Owner", "Kai"),
    ])) {
      expect(Object.keys(section)).not.toContain("undefined");
      expect(section.text === undefined || section.text.length > 0).toBe(true);
      expect(section.facts === undefined || section.facts.length > 0).toBe(
        true,
      );
    }
  });
});

describe("an incoming webhook's card", () => {
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

  test("a workflow's message keeps its lines in the order it wrote them", async () => {
    await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
      url: WEBHOOK_URL,
      text: [
        "## Deploy finished",
        "**Service:** checkout",
        "**Version:** 4.2.0",
        "Rolled out to every region.",
        "**Owner:** Kai Morgan",
      ].join("\n"),
    });

    expect(sentCards).toHaveLength(1);
    expect(sentCards[0]!["title"]).toBe("Deploy finished");
    expect(sentCards[0]!["sections"]).toEqual([
      {
        markdown: true,
        facts: [
          { name: "Service", value: "checkout" },
          { name: "Version", value: "4.2.0" },
        ],
      },
      {
        markdown: true,
        text: "Rolled out to every region.",
        facts: [{ name: "Owner", value: "Kai Morgan" }],
      },
    ]);
  });

  test("a message of text alone is one section, as it always was", async () => {
    await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
      url: WEBHOOK_URL,
      text: "## Heads up\n\nThe API is slow.\n\nWe are on it.",
    });

    expect(sentCards[0]!["sections"]).toEqual([
      { markdown: true, text: "The API is slow.\n\nWe are on it." },
    ]);
  });

  test("a message of a title alone has no section", async () => {
    await MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
      url: WEBHOOK_URL,
      text: "## Heads up",
    });

    expect(sentCards[0]!["sections"]).toBeUndefined();
  });
});
