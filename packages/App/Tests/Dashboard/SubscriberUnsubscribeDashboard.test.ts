import SubscriberUnsubscribeCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberUnsubscribeCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

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

const OTHER_LOCALES: Array<string> = [...DASHBOARD_LANGUAGES];

/*
 * The five subscriber lists are one component since #9125
 * (StatusPageSubscriberList), a tab each on the Subscribers page,
 * configured per channel (SubscriberListChannels). The channel's contact
 * column is what its list, and the notice above it, pick its subscribers
 * by.
 */
const CHANNELS: Array<{ channel: string; contactColumn: string }> = [
  { channel: "Email", contactColumn: "subscriberEmail" },
  { channel: "SMS", contactColumn: "subscriberPhone" },
  { channel: "Slack", contactColumn: "slackWorkspaceName" },
  { channel: "MicrosoftTeams", contactColumn: "microsoftTeamsWorkspaceName" },
  { channel: "Webhook", contactColumn: "subscriberWebhook" },
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

function readComponent(file: string): string {
  return fs
    .readFileSync(
      path.join(DASHBOARD_SRC, "Components", "StatusPage", file),
      "utf8",
    )
    .replace(/\s+/g, " ");
}

const LIST: string = readComponent("StatusPageSubscriberList.tsx");
const CHANNEL_DEFINITIONS: string = readComponent("SubscriberListChannels.ts");

// One channel's entry in SubscriberListChannels.
function channelDefinition(channel: string): string {
  const start: number = CHANNEL_DEFINITIONS.indexOf(
    `[StatusPageSubscriberChannel.${channel}]: {`,
  );

  expect(start).toBeGreaterThan(-1);

  return CHANNEL_DEFINITIONS.slice(
    start,
    CHANNEL_DEFINITIONS.indexOf("writeBulkEntry", start),
  );
}

// The body of the `const name ... = [ ... ];` array, bracket-matched.
function arrayConst(source: string, name: string): string {
  const start: number = source.indexOf(`const ${name}`);

  expect(start).toBeGreaterThan(-1);

  let depth: number = 0;

  for (
    let i: number = source.indexOf("= [", start) + 2;
    i < source.length;
    i++
  ) {
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

  throw new Error(`No ${name} array`);
}

const UNSUBSCRIBED_AT_ENTRY: RegExp =
  /\{ field: \{ unsubscribedAt: true, \}, title: SubscriberUnsubscribeCopy\.unsubscribedAtTitle, type: FieldType\.(Date|DateTime),/;

describe("every channel's list", () => {
  test("lists Unsubscribed At as a column", () => {
    expect(arrayConst(LIST, "columns")).toMatch(UNSUBSCRIBED_AT_ENTRY);
  });

  test("can filter on Unsubscribed At", () => {
    expect(arrayConst(LIST, "filters")).toMatch(UNSUBSCRIBED_AT_ENTRY);
  });

  test("shows the notice of team-added subscribers that left, for its own channel", () => {
    expect(LIST).toContain("<TeamAddedSubscribersUnsubscribedNotice");
    expect(LIST).toContain("channelQuery={getSubscriberChannelQuery(channel)}");
    expect(LIST).toContain(
      "contactSelect={getSubscriberContactSelect(channel)}",
    );

    // The same channel the list below it shows.
    expect(LIST).toContain(
      "query={{ ...getSubscriberChannelQuery(channel), statusPageId: modelId,",
    );
    expect(CHANNEL_DEFINITIONS).toContain(
      "[definition.contactColumn]: new NotNull(),",
    );
  });

  test.each(CHANNELS)(
    "$channel picks its subscribers by $contactColumn",
    (entry: { channel: string; contactColumn: string }) => {
      expect(channelDefinition(entry.channel)).toContain(
        `contactColumn: "${entry.contactColumn}",`,
      );
    },
  );
});

describe("the email subscriber forms advise against shared addresses", () => {
  test("Add in Bulk says it in the pasted field's description, after how to paste them", () => {
    const bulkForm: string = LIST.slice(
      LIST.indexOf("<BasicFormModal<TextBulkAddFormData>"),
    );
    const entriesField: string = bulkForm.slice(
      bulkForm.indexOf("field: { entries: true }"),
      bulkForm.indexOf("fieldType: FormFieldSchemaType.LongText"),
    );

    expect(entriesField).toMatch(
      /description: channel\.asksHowToAdd \? \( <> \{translator\.translateText\(textBulkAdd\.fieldDescription\)\}\{" "\} \{translator\.translateText\( SubscriberUnsubscribeCopy\.sharedAddressAdvice, \)\} <\/> \)/,
    );
    // Only email asks how to add them, so only email says it.
    expect(channelDefinition("Email")).toContain("asksHowToAdd: true,");
    expect(channelDefinition("Email")).toContain(
      'fieldDescription: "One email per line',
    );
    // No warning box under the field any more.
    expect(entriesField).not.toContain("footerElement");
    expect(entriesField).not.toContain("<Alert");
  });

  test("so does the form that adds one subscriber, in the Email field's description", () => {
    const contactFields: string = channelDefinition("Email").slice(
      channelDefinition("Email").indexOf("contactFields: ["),
    );

    expect(contactFields).toContain("subscriberEmail: true");
    expect(contactFields).toContain(
      "description: SubscriberUnsubscribeCopy.sharedAddressAdvice,",
    );
    expect(contactFields).not.toContain("footerElement");
    expect(contactFields).not.toContain("<Alert");
  });

  test("the advice is one sentence that names a mailing list and says it is unsubscribed for everyone", () => {
    const advice: string = SubscriberUnsubscribeCopy.sharedAddressAdvice;

    expect(advice).toContain("mailing list");
    expect(advice).toContain("can unsubscribe it for everyone");
    expect(advice.endsWith(".")).toBe(true);
    expect(advice.slice(0, -1)).not.toMatch(/[.!?] /);
  });

  test("the warning box and its three sentences are gone from every subscriber list", () => {
    expect(LIST).not.toContain("shared-address-warning");
    expect(CHANNEL_DEFINITIONS).not.toContain("shared-address-warning");

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
