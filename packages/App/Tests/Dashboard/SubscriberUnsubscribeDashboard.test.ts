import SubscriberUnsubscribeCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberUnsubscribeCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a status page's team sees of subscribers unsubscribing themselves:
 *
 *   - an 'Unsubscribed At' column and filter on all five subscriber lists
 *     (email, SMS, Slack, Microsoft Teams, webhook);
 *   - above each list, a notice naming the subscribers the team added that
 *     have unsubscribed recently - for that list's channel only;
 *   - on the email forms (one subscriber and Add in Bulk), one sentence in
 *     the email field's description: anyone who reads a shared address
 *     such as a mailing list can unsubscribe it for everyone. It was a
 *     three-sentence warning box under the field, there on every visit.
 *
 * Every piece of text lives in SubscriberUnsubscribeCopy and reaches the
 * screen by looking its English text up in the Dashboard locale files. A
 * string with no entry silently stays English, so this also pins that en.json
 * maps each one to itself and all sixteen other locales carry a real
 * translation with the same {{placeholders}}.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

interface SubscriberPage {
  file: string;
  // The column the list's own query requires, which names its channel.
  channelField: string;
}

const PAGES: Array<SubscriberPage> = [
  { file: "EmailSubscribers.tsx", channelField: "subscriberEmail" },
  { file: "SMSSubscribers.tsx", channelField: "subscriberPhone" },
  { file: "SlackSubscribers.tsx", channelField: "slackWorkspaceName" },
  {
    file: "MicrosoftTeamsSubscribers.tsx",
    channelField: "microsoftTeamsWorkspaceName",
  },
  { file: "WebhookSubscribers.tsx", channelField: "subscriberWebhook" },
];

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readPage(file: string): string {
  return fs
    .readFileSync(
      path.join(DASHBOARD_SRC, "Pages", "StatusPages", "View", file),
      "utf8",
    )
    .replace(/\s+/g, " ");
}

// The body of the first `name={[ ... ]}` prop after `from`, bracket-matched.
function arrayProp(source: string, name: string): string {
  const start: number = source.indexOf(`${name}={[`);

  expect(start).toBeGreaterThan(-1);

  let depth: number = 0;

  for (let i: number = start + name.length + 2; i < source.length; i++) {
    const character: string = source[i]!;

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;

      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  throw new Error(`No ${name} prop`);
}

const UNSUBSCRIBED_AT_ENTRY: RegExp =
  /\{ field: \{ unsubscribedAt: true, \}, title: SubscriberUnsubscribeCopy\.unsubscribedAtTitle, type: FieldType\.(Date|DateTime),/;

describe.each(PAGES)("$file", (page: SubscriberPage) => {
  const source: string = readPage(page.file);

  test("lists Unsubscribed At as a column", () => {
    expect(arrayProp(source, "columns")).toMatch(UNSUBSCRIBED_AT_ENTRY);
  });

  test("can filter on Unsubscribed At", () => {
    expect(arrayProp(source, "filters")).toMatch(UNSUBSCRIBED_AT_ENTRY);
  });

  test("shows the notice of team-added subscribers that left, for this list's channel", () => {
    expect(source).toContain("<TeamAddedSubscribersUnsubscribedNotice");
    expect(source).toContain(
      `channelQuery={{ ${page.channelField}: new NotNull() }}`,
    );
    expect(source).toContain(`contactSelect={{ ${page.channelField}: true }}`);

    // The same channel the list below it shows.
    expect(source).toContain(`${page.channelField}: new NotNull(), }}`);
  });
});

describe("the email subscriber forms advise against shared addresses", () => {
  const source: string = readPage("EmailSubscribers.tsx");

  test("Add in Bulk says it in the Emails field's description, after how to paste them", () => {
    const bulkForm: string = source.slice(
      source.indexOf("<BasicFormModal<BulkAddFormData>"),
    );
    const emailsField: string = bulkForm.slice(
      bulkForm.indexOf("field: { emails: true }"),
      bulkForm.indexOf("field: { isSubscriptionConfirmed: true }"),
    );

    expect(emailsField).toMatch(
      /description: \( <> \{translator\.translateText\( "One email per line[^"]*", \)\}\{" "\} \{translator\.translateText\( SubscriberUnsubscribeCopy\.sharedAddressAdvice, \)\} <\/> \)/,
    );
    // No warning box under the field any more.
    expect(emailsField).not.toContain("footerElement");
    expect(emailsField).not.toContain("<Alert");
  });

  test("so does the form that adds one subscriber, in the Email field's description", () => {
    const formFields: string = source.slice(
      source.indexOf(
        "const formFields: Array<ModelField<StatusPageSubscriber>>",
      ),
      source.indexOf("isSubscriptionConfirmed: true, }, title:"),
    );

    expect(formFields).toContain("subscriberEmail: true");
    expect(formFields).toContain(
      "description: SubscriberUnsubscribeCopy.sharedAddressAdvice,",
    );
    expect(formFields).not.toContain("footerElement");
    expect(formFields).not.toContain("<Alert");
  });

  test("the advice is one sentence that names a mailing list and says it is unsubscribed for everyone", () => {
    const advice: string = SubscriberUnsubscribeCopy.sharedAddressAdvice;

    expect(advice).toContain("mailing list");
    expect(advice).toContain("can unsubscribe it for everyone");
    expect(advice.endsWith(".")).toBe(true);
    expect(advice.slice(0, -1)).not.toMatch(/[.!?] /);
  });

  test("the warning box and its three sentences are gone from every subscriber page", () => {
    for (const page of PAGES) {
      expect(readPage(page.file)).not.toContain("shared-address-warning");
    }

    expect(Object.keys(SubscriberUnsubscribeCopy)).not.toContain(
      "sharedAddressWarning",
    );
  });
});

describe("SubscriberUnsubscribeCopy translations", () => {
  const strings: Array<string> = Object.values(SubscriberUnsubscribeCopy);

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of strings) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s translates every string and keeps its placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of strings) {
        const translated: unknown = translations[text];

        expect([text, typeof translated]).toEqual([text, "string"]);
        expect([text, translated]).not.toEqual([text, text]);
        expect([text, placeholders(translated as string)]).toEqual([
          text,
          placeholders(text),
        ]);
      }
    },
  );
});
