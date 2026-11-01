import { describe, expect, test } from "@jest/globals";
import { getServerTranslator } from "../../../../Server/Utils/ServerTranslation";
import SubscriberMessageText, {
  SubscribedChatText,
  SubscriberChatText,
  SubscriberEmailText,
  SubscriberSmsText,
} from "../../../../Server/Utils/StatusPage/SubscriberMessageText";
import { READER_LANGUAGE_CODES } from "../../../../Types/ReaderLanguage";
import {
  createTranslator,
  Translator,
} from "../../../../UI/Utils/TranslateTemplate";
import { toGsm7Message } from "../../../../Utils/Sms/Gsm7Text";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";

/*
 * ONEUPTIME'S OWN WORDS IN A STATUS PAGE'S SUBSCRIBER MESSAGES.
 *
 * Handed the English translator, every piece is the English the senders
 * always wrote, character for character. Handed a subscriber's, the same
 * piece in their language: OneUptime's default state and severity names
 * translated, the project's own names and every value as written, a text
 * message's links exactly as written.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");
const GERMAN: Translator = getServerTranslator("de");
const PERSIAN: Translator = getServerTranslator("fa");
const JAPANESE: Translator = getServerTranslator("ja");

const DETAILS_URL: string =
  "https://status.acme.example/incidents/0a1b2c3d-1111-4222-8333-444455556666";
const UNSUBSCRIBE_URL: string =
  "https://status.acme.example/update-subscription/s1?token=7f_Ab-9";
const STATUS_PAGE_URL: string = "https://status.acme.example";

const incidentCreatedSms: (translator: Translator) => string = (
  translator: Translator,
): string => {
  return SubscriberMessageText.smsWithLinks(translator, {
    sentences: [
      translator.translateTemplate(SubscriberSmsText.incidentCreated, {
        title: "Checkout is down",
        severity: SubscriberMessageText.stateName("Major Incident"),
        statusPageName: "Acme Status",
        resources: "Checkout API",
      }),
    ],
    detailsUrl: DETAILS_URL,
    unsubscribeUrl: UNSUBSCRIBE_URL,
  });
};

describe("the text messages", () => {
  test("in English, exactly as the senders always wrote them", () => {
    expect(incidentCreatedSms(ENGLISH)).toBe(
      `Incident Checkout is down (Major Incident) on Acme Status. Impact: Checkout API. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    );
  });

  test("in the subscriber's language, OneUptime's severity name too", () => {
    expect(incidentCreatedSms(GERMAN)).toBe(
      `Vorfall Checkout is down (Schwerwiegender Vorfall) auf Acme Status. Betroffen: Checkout API. Details: ${DETAILS_URL}. Abbestellen: ${UNSUBSCRIBE_URL}`,
    );
  });

  test("a severity the project named itself reads as written", () => {
    expect(
      GERMAN.translateTemplate(SubscriberSmsText.incidentCreated, {
        title: "Checkout",
        severity: SubscriberMessageText.stateName("Sev 1 - Customer facing"),
        statusPageName: "Acme",
        resources: "API",
      }),
    ).toContain("(Sev 1 - Customer facing)");
  });

  /*
   * A link goes out exactly as written only when it starts a word
   * (toGsm7Message): in every language, the details and unsubscribe links
   * of a message survive the GSM-7 writer whole.
   */
  test.each([...READER_LANGUAGE_CODES])(
    "%s: the links of a text message go out exactly as written",
    (language: string) => {
      const sms: string = incidentCreatedSms(getServerTranslator(language));

      expect(sms).toContain(DETAILS_URL);
      expect(sms).toContain(UNSUBSCRIBE_URL);
      // The writer changed nothing more: it is already in its characters.
      expect(toGsm7Message(sms).trim()).toBe(sms);
    },
  );

  test("a sentence the subscriber's language words is written in its letters", () => {
    expect(incidentCreatedSms(PERSIAN)).toContain("حادثه");
    expect(incidentCreatedSms(JAPANESE)).toContain("インシデント");
  });

  test("the subscription's own text messages, in English as always", () => {
    expect(
      ENGLISH.translateTemplate(SubscriberSmsText.subscribed, {
        statusPageName: "Acme Status",
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    ).toBe(
      `You have been subscribed to Acme Status. To unsubscribe, click on the link: ${UNSUBSCRIBE_URL}`,
    );
    expect(
      ENGLISH.translateTemplate(SubscriberSmsText.manageSubscription, {
        statusPageName: "Acme Status",
        manageUrl: STATUS_PAGE_URL,
      }),
    ).toBe(
      `You have selected to manage your subscription for the status page: Acme Status. You can manage your subscription here: ${STATUS_PAGE_URL}`,
    );
  });

  test("empty sentences are left out of a text message", () => {
    expect(
      SubscriberMessageText.smsWithLinks(ENGLISH, {
        sentences: ["Incident update: Checkout on Acme.", "  "],
        detailsUrl: DETAILS_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    ).toBe(
      `Incident update: Checkout on Acme. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
    );
  });
});

describe("the Slack and Microsoft Teams messages", () => {
  test("a label and its value, in English as always", () => {
    expect(
      SubscriberMessageText.chatLine(
        ENGLISH,
        SubscriberChatText.severity,
        " - ",
      ).toString(),
    ).toBe(mdText`**Severity:** ${" - "}`.toString());
    expect(
      SubscriberMessageText.chatLine(
        ENGLISH,
        SubscriberChatText.resourcesAffected,
        "API",
      ).toString(),
    ).toBe("**Resources Affected:** API");
  });

  test("a label in the reader's language, with its own colon", () => {
    expect(
      SubscriberMessageText.chatLine(
        GERMAN,
        SubscriberChatText.severity,
        "Kritisch",
      ).toString(),
    ).toBe("**Schweregrad:** Kritisch");
    expect(
      SubscriberMessageText.chatLine(
        getServerTranslator("fr"),
        SubscriberChatText.severity,
        "Majeur",
      ).toString(),
    ).toBe("**Gravité :** Majeur");
    expect(
      SubscriberMessageText.chatLine(
        getServerTranslator("zh-CN"),
        SubscriberChatText.severity,
        "重大",
      ).toString(),
    ).toBe("**严重程度：** 重大");
  });

  test("a value is escaped as a value in the middle of a line", () => {
    expect(
      SubscriberMessageText.chatLine(
        GERMAN,
        SubscriberChatText.resourcesAffected,
        "[Click](https://evil.example) # x",
      ).toString(),
    ).toBe(
      mdText`**Betroffene Ressourcen:** ${"[Click](https://evil.example) # x"}`.toString(),
    );
  });

  test("the links every message ends with", () => {
    expect(
      SubscriberMessageText.chatLinks(ENGLISH, {
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }).toString(),
    ).toBe(
      mdText`[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`.toString(),
    );
    expect(
      SubscriberMessageText.chatLinks(GERMAN, {
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }).toString(),
    ).toBe(
      mdText`[Statusseite ansehen](${STATUS_PAGE_URL}) | [Abbestellen](${UNSUBSCRIBE_URL})`.toString(),
    );
  });

  test("a state change's message, in English exactly as it always was", () => {
    expect(
      SubscriberMessageText.incidentStateChangeChatMessage(ENGLISH, {
        title: "Checkout is down",
        resourcesAffected: "Checkout API",
        severityName: "Major Incident",
        stateName: "Resolved",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    ).toBe(
      mdText`🚨 ## Incident - ${"Checkout is down"}

`.toString() +
        mdText`
**Resources Affected:** ${"Checkout API"}`.toString() +
        mdText`
**Severity:** ${"Major Incident"}
**Status:** ${"Resolved"}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`.toString(),
    );
  });

  test("a state change's message in German names OneUptime's state and severity in German", () => {
    const message: string =
      SubscriberMessageText.incidentStateChangeChatMessage(GERMAN, {
        title: "Checkout is down",
        resourcesAffected: "",
        severityName: "Major Incident",
        stateName: "Resolved",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      });

    expect(message).toContain("Vorfall - Checkout is down");
    expect(message).toContain("**Schweregrad:** Schwerwiegender Vorfall");
    expect(message).toContain("**Status:** Behoben");
    // No resources listed: no resources line.
    expect(message).not.toContain("Betroffene Ressourcen");
  });

  test("a note's message, in English exactly as it always was", () => {
    expect(
      SubscriberMessageText.incidentNoteChatMessage(ENGLISH, {
        title: "Checkout is down",
        sentence: SubscriberChatText.newIncidentNote,
        resourcesAffected: "Checkout API",
        severityName: undefined,
        note: "We rolled back.",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    ).toBe(
      mdText`## Incident - ${"Checkout is down"}

**${"New note has been added to an incident"}**

**Resources Affected:** ${"Checkout API"}
**Severity:** ${" - "}

**Note:**
${SubscriberMessageText.asMarkdown("We rolled back.")}

[View Status Page](${STATUS_PAGE_URL}) | [Unsubscribe](${UNSUBSCRIBE_URL})`.toString(),
    );
  });

  test("a note posted with a state change names the state, in the reader's language", () => {
    const message: string = SubscriberMessageText.incidentNoteChatMessage(
      JAPANESE,
      {
        title: "Checkout is down",
        sentence: SubscriberChatText.newIncidentNote,
        resourcesAffected: "Checkout API",
        severityName: "Minor Incident",
        stateChangeName: " Resolved ",
        note: "Fixed.",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      },
    );

    expect(message).toContain("インシデント - Checkout is down");
    expect(message).toContain("**状態:** 解決済み");
    expect(message).toContain("**重大度:** 軽微なインシデント");
    expect(message).toContain("Fixed.");
  });

  test("the welcome a channel gets, in English exactly as it always was", () => {
    expect(
      SubscriberMessageText.subscribedChatMessage(ENGLISH, {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }),
    ).toBe(
      [
        "## 📢 New Subscription to Acme Status",
        "",
        "**You have successfully subscribed to receive status updates!**",
        "",
        `🔗 **Status Page:** [Acme Status](${STATUS_PAGE_URL})`,
        `🔕 **Unsubscribe:** [Stop these notifications](${UNSUBSCRIBE_URL})`,
        "",
        "You will receive real-time notifications for:",
        "• Incidents and outages ",
        "• Scheduled maintenance events  ",
        "• Service announcements",
        "• Status updates",
        "",
        "Stay informed about service availability! 🚀",
      ].join("\n"),
    );
  });

  test("the welcome in the reader's language", () => {
    const message: string = SubscriberMessageText.subscribedChatMessage(
      getServerTranslator("es"),
      {
        statusPageName: "Acme Status",
        statusPageUrl: STATUS_PAGE_URL,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      },
    );

    expect(message).toContain("## 📢 Nueva suscripción a Acme Status");
    expect(message).toContain(
      `[Dejar de recibir estas notificaciones](${UNSUBSCRIBE_URL})`,
    );
    for (const key of Object.values(SubscribedChatText)) {
      if (key.includes("{{")) {
        continue;
      }

      expect([key, message.includes(key)]).toEqual([key, false]);
    }
  });
});

describe("the email's words the senders put in", () => {
  test("a state change email's heading, with and without resources", () => {
    expect(
      SubscriberMessageText.incidentStateChangeEmailTitle(ENGLISH, {
        resources: "Checkout API",
        state: "Resolved",
      }),
    ).toBe("Incident on Checkout API is Resolved");
    expect(
      SubscriberMessageText.incidentStateChangeEmailTitle(ENGLISH, {
        resources: "",
        state: "Resolved",
      }),
    ).toBe("Incident is Resolved");
    expect(
      SubscriberMessageText.incidentStateChangeEmailTitle(GERMAN, {
        resources: "Checkout API",
        state: "Resolved",
      }),
    ).toBe("Vorfall bei Checkout API: Behoben");
  });

  test("no resources, and a page with no name, in the reader's language", () => {
    expect(SubscriberMessageText.noResources(ENGLISH)).toBe("None");
    expect(SubscriberMessageText.noResources(GERMAN)).toBe("Keine");
    expect(SubscriberMessageText.statusPageName(GERMAN, {})).toBe(
      "Statusseite",
    );
    expect(
      SubscriberMessageText.statusPageName(GERMAN, {
        pageTitle: "",
        name: "Acme",
      }),
    ).toBe("Acme");
  });

  test("the subjects of the subscription's emails", () => {
    expect(
      ENGLISH.translateTemplate(
        SubscriberEmailText.confirmSubscriptionSubject,
        { statusPageName: "Acme" },
      ),
    ).toBe("Confirm your subscription to Acme");
    expect(
      GERMAN.translateTemplate(SubscriberEmailText.subscribedSubject, {
        statusPageName: "Acme",
      }),
    ).toBe("Sie haben Acme abonniert");
  });
});
