import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import { getServerTranslator } from "../../../../../Server/Utils/ServerTranslation";
import SubscriberMessageText, {
  SubscriberChatText,
} from "../../../../../Server/Utils/StatusPage/SubscriberMessageText";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";
import { READER_LANGUAGE_CODES } from "../../../../../Types/ReaderLanguage";
import { Translator } from "../../../../../UI/Utils/TranslateTemplate";
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
 * A STATUS PAGE'S TEAMS MESSAGES, AS A CARD, IN EVERY LANGUAGE.
 *
 * An incoming webhook's MessageCard is built from the message's Markdown
 * (MicrosoftTeamsUtil.buildMessageCardFromMarkdown): each "**Label:** value"
 * line is a fact, but a description or a note is text under its label. That
 * was read in English only. A subscriber written to in German got their
 * note's label as an empty "Notiz" fact at the bottom of the card, the note
 * itself apart from it above the facts, and a description's first line
 * among the facts; one written to in Chinese, whose labels end in a
 * full-width colon ("严重程度："), got no facts at all. Here the subscriber
 * messages are built as the jobs build them (SubscriberMessageText), in
 * each language, and sent through the real card builder.
 */

const WEBHOOK_URL: URL = URL.fromString(
  "https://acme.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi",
);
const STATUS_PAGE_URL: string = "https://status.acme.example";
const UNSUBSCRIBE_URL: string =
  "https://status.acme.example/update-subscription/s1?token=7f_Ab-9";
const NOTE: string = "Traffic moved to the standby region.";
const DESCRIPTION: string = "Payments fail in the EU.";

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

interface Fact {
  name: string;
  value: string;
}

function factsOf(card: JSONObject): Array<Fact> {
  return ((card["sections"] as Array<JSONObject>) || []).flatMap(
    (section: JSONObject): Array<Fact> => {
      return ((section["facts"] as Array<JSONObject>) || []).map(
        (fact: JSONObject): Fact => {
          return { name: String(fact["name"]), value: String(fact["value"]) };
        },
      );
    },
  );
}

function textOf(card: JSONObject): string {
  return ((card["sections"] as Array<JSONObject>) || [])
    .map((section: JSONObject): string => {
      return (section["text"] as string) || "";
    })
    .join("\n");
}

// A label as the card names its fact: without its colon ("Gravité :" is "Gravité").
function factNameOf(translator: Translator, label: string): string {
  const written: string = SubscriberMessageText.text(translator, label).trim();
  const last: string = written.charAt(written.length - 1);

  return (
    last === ":" || last === "\u{FF1A}" ? written.slice(0, -1) : written
  ).trim();
}

describe.each([...READER_LANGUAGE_CODES])(
  "a subscriber's Teams card in %s",
  (language: string) => {
    const translator: Translator = getServerTranslator(language);

    test("a note is text under its label, not an empty fact apart from it", async () => {
      const card: JSONObject = await cardFor(
        SubscriberMessageText.incidentNoteChatMessage(translator, {
          title: "Checkout is down",
          sentence: SubscriberChatText.newIncidentNote,
          resourcesAffected: "Checkout API",
          severityName: "Major Incident",
          note: NOTE,
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: UNSUBSCRIBE_URL,
        }),
      );

      const facts: Array<Fact> = factsOf(card);

      // The resources and the severity, each with its value.
      expect(
        facts.map((fact: Fact): string => {
          return fact.name;
        }),
      ).toEqual([
        factNameOf(translator, SubscriberChatText.resourcesAffected),
        factNameOf(translator, SubscriberChatText.severity),
      ]);
      expect(
        facts.every((fact: Fact): boolean => {
          return fact.value.length > 0;
        }),
      ).toBe(true);

      // The note's label, then the note, in the text.
      const text: string = textOf(card);
      const label: string = factNameOf(translator, SubscriberChatText.note);

      expect(text).toContain(`**${label}`);
      expect(text).toContain(NOTE);
      expect(text.indexOf(`**${label}`)).toBeLessThan(text.indexOf(NOTE));
    });

    test("a description is text, whole, not a fact", async () => {
      const card: JSONObject = await cardFor(
        mdText`## ${translator.translateTemplate(SubscriberChatText.incidentHeading, { title: "Checkout is down" })}

${SubscriberMessageText.chatLine(translator, SubscriberChatText.severity, "Critical")}

${SubscriberMessageText.chatLine(translator, SubscriberChatText.description, SubscriberMessageText.asMarkdown(DESCRIPTION))}

${SubscriberMessageText.chatLinks(translator, { statusPageUrl: STATUS_PAGE_URL, unsubscribeUrl: UNSUBSCRIBE_URL })}`.toString(),
      );

      expect(factsOf(card)).toEqual([
        {
          name: factNameOf(translator, SubscriberChatText.severity),
          value: "Critical",
        },
      ]);
      expect(textOf(card)).toContain(DESCRIPTION);
      expect(textOf(card)).toContain(
        `**${factNameOf(translator, SubscriberChatText.description)}`,
      );
    });

    test("a state change: the heading without its Markdown marks, then three facts", async () => {
      const card: JSONObject = await cardFor(
        SubscriberMessageText.incidentStateChangeChatMessage(translator, {
          title: "Checkout is down",
          resourcesAffected: "Checkout API",
          severityName: "Major Incident",
          stateName: "Resolved",
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: UNSUBSCRIBE_URL,
        }),
      );

      expect(String(card["title"])).not.toContain("#");
      expect(String(card["title"]).startsWith("\u{1F6A8} ")).toBe(true);
      expect(String(card["title"])).toContain("Checkout is down");
      expect(
        factsOf(card).map((fact: Fact): string => {
          return fact.value;
        }),
      ).toEqual([
        "Checkout API",
        SubscriberMessageText.nameInLanguage(translator, "Major Incident"),
        SubscriberMessageText.nameInLanguage(translator, "Resolved"),
      ]);
    });
  },
);

describe("the label as it was written", () => {
  test("a Chinese label keeps its full-width colon in the text", async () => {
    const card: JSONObject = await cardFor(
      "## \u{4E8B}\u{4EF6}\n\n**\u{5907}\u{6CE8}\u{FF1A}**\nTraffic moved.",
    );

    expect(textOf(card)).toContain("**\u{5907}\u{6CE8}\u{FF1A}**");
    expect(factsOf(card)).toEqual([]);
  });

  test("an English card reads as it always did", async () => {
    const card: JSONObject = await cardFor(
      [
        "## Incident - Checkout is down",
        "",
        "**Severity:** Critical",
        "**Description:** Payments fail in the EU.",
        "",
        "**Note:**",
        "Traffic moved.",
      ].join("\n"),
    );

    expect(factsOf(card)).toEqual([{ name: "Severity", value: "Critical" }]);
    expect(textOf(card)).toBe(
      "**Description:** Payments fail in the EU.\n\n**Note:** \n\nTraffic moved.",
    );
  });

  test("the line of links is the card's buttons, not its text too", async () => {
    const card: JSONObject = await cardFor(
      SubscriberMessageText.incidentStateChangeChatMessage(
        getServerTranslator("de"),
        {
          title: "Checkout is down",
          resourcesAffected: "Checkout API",
          severityName: "Major Incident",
          stateName: "Resolved",
          statusPageUrl: STATUS_PAGE_URL,
          unsubscribeUrl: UNSUBSCRIBE_URL,
        },
      ),
    );

    expect(textOf(card)).not.toContain("Statusseite ansehen");
    expect(
      ((card["potentialAction"] as Array<JSONObject>) || []).map(
        (action: JSONObject): string => {
          return String(action["name"]);
        },
      ),
    ).toEqual(["Statusseite ansehen", "Abbestellen"]);
  });

  test("a label with nothing after it, in any words, is text over what follows", async () => {
    const card: JSONObject = await cardFor(
      ["## Rollout", "", "**Steps:**", "1. Drain the node."].join("\n"),
    );

    expect(factsOf(card)).toEqual([]);
    expect(textOf(card)).toBe("**Steps:** \n\n1. Drain the node.");
  });
});
