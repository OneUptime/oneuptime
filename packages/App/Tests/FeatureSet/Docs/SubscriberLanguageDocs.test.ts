import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import SubscriberLanguage from "Common/Server/Utils/StatusPage/SubscriberLanguage";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { READER_LANGUAGE_CODES } from "Common/Types/ReaderLanguage";
import { DEFAULT_STATUS_NAMES } from "Common/Types/StatusPage/DefaultStatusNames";
import SubscriberTemplateValues from "Common/Server/Utils/StatusPage/SubscriberTemplateValues";
import {
  getEmailHtmlValue,
  getEmailLanguageVariables,
} from "../../../FeatureSet/Notification/Utils/EmailLanguage";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, "The language subscribers are written in",
 * says who is written to in which language, what changes with it and what
 * does not. Held here to the code that decides it: SubscriberLanguage (who
 * gets which language), the subscriber's language column and the service
 * that refuses any other value, the Dashboard's field and column for it,
 * the default names that are translated, a custom template's values in the
 * page's language, the way an email in Persian reads, and the report in
 * each subscriber's language.
 * Markdown is not compiled, so nothing else notices when they drift apart.
 * StatusPageDocsTranslations holds the 16 translations to the English page
 * line for line; this holds the section's place and its code in each.
 */

const PACKAGES_DIRECTORY: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIRECTORY: string = path.join(
  PACKAGES_DIRECTORY,
  "App/FeatureSet/Docs/Content",
);

const HEADING: string = "## The language subscribers are written in";

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIRECTORY, language, `status-pages/${page}.md`),
    "utf8",
  );
}

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIRECTORY, relativePath), "utf8");
}

// A section of a page, from its heading to the next heading of its level.
function sectionOf(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n${heading}\n`);

  expect(start).toBeGreaterThan(0);

  const end: number = markdown.indexOf("\n## ", start + heading.length + 2);

  return markdown.slice(start, end === -1 ? undefined : end);
}

const ENGLISH: string = read("en", "subscribers");
const SECTION: string = sectionOf(ENGLISH, HEADING);

describe("Subscribers & Announcements: the language subscribers are written in", () => {
  test("every message about a subscription and every notification, on the four channels that have words, and the email report", () => {
    expect(SECTION).toContain(
      "Each subscriber is written to in their own language: the email or text message that confirms the subscription, the welcome and the link to manage it, every notification about an incident, an incident episode, a maintenance event or an announcement, by email, SMS, Slack and Microsoft Teams, and the email report.",
    );

    // The report's words are looked up in the email's language.
    const report: string = readSource(
      "App/FeatureSet/Notification/Templates/StatusPageSubscriberReport.hbs",
    );

    expect(report).toContain('(tt "Uptime Report: {{statusPageName}}"');
    expect(report).not.toContain('"Uptime Report: "');
    // Each subscriber's language, else the page's (sendEmailReport).
    expect(readSource("Common/Server/Services/StatusPageService.ts")).toContain(
      "SubscriberLanguage.getLanguage({",
    );
  });

  test("the team sets a subscriber's language under More fields, and each list shows it", () => {
    expect(SECTION).toContain(
      "- **Your team can set a subscriber's language** under **More fields** when adding or editing one, or clear it so they follow the page's default; each subscriber list shows it in its **Language** column.",
    );

    // The field: the subscriber's language, folded under More fields.
    const fields: string = readSource(
      "App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormFields.tsx",
    );
    const languageField: string = fields.slice(
      fields.indexOf("export const getSubscriberLanguageField"),
    );

    expect(languageField).toContain("language: true");
    expect(languageField).toContain("collapsibleSection: data.moreFields");
    expect(languageField).toContain("required: false");

    // Titled Language, as the field and the column are.
    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices.ts",
      ),
    ).toContain('languageTitle: translationKey("Language")');

    // On the Email, SMS, Slack and Microsoft Teams lists, not the webhook one.
    for (const page of [
      "EmailSubscribers",
      "SMSSubscribers",
      "SlackSubscribers",
      "MicrosoftTeamsSubscribers",
    ]) {
      const source: string = readSource(
        `App/FeatureSet/Dashboard/src/Pages/StatusPages/View/${page}.tsx`,
      );

      expect([page, source.includes("getSubscriberLanguageField(")]).toEqual([
        page,
        true,
      ]);
      expect([page, source.includes("getSubscriberLanguageColumn(")]).toEqual([
        page,
        true,
      ]);
    }

    expect(
      readSource(
        "App/FeatureSet/Dashboard/src/Pages/StatusPages/View/WebhookSubscribers.tsx",
      ),
    ).not.toContain("getSubscriberLanguage");
  });

  test("a visitor who read the page in another language keeps it; everyone else follows the page's default, as it changes", () => {
    expect(SECTION).toContain(
      "- **A visitor who switches the status page to another language** in its footer, then subscribes or updates their subscription, is written to in that language.",
    );
    expect(SECTION).toContain(
      "- **Everyone else** is written to in the page's default language, set under [More settings](/docs/status-pages/branding-and-domains#more-settings) on its Branding page:",
    );
    expect(SECTION).toContain(
      "a subscriber your team adds without a language, on the dashboard, through the API or by a workflow",
    );
    expect(
      SubscriberLanguage.getLanguageToStore({
        acceptLanguage: "fr-FR,fr;q=0.9",
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBe("fr");

    // A visitor who read it in the default language keeps none.
    expect(
      SubscriberLanguage.getLanguageToStore({
        acceptLanguage: "de",
        statusPage: { defaultLanguage: "de" },
      }),
    ).toBeNull();

    // The page tells the server the language it is read in.
    expect(readSource("App/FeatureSet/StatusPage/src/Utils/API.ts")).toContain(
      '{ "accept-language": language }',
    );

    expect(SECTION).toContain(
      "Change the default language and they are written to in the new one from the next message on.",
    );

    // Read when each message is written, so a change follows at once.
    for (const pageLanguage of ["de", "ja", undefined]) {
      expect(
        SubscriberLanguage.getLanguage({
          subscriber: {},
          statusPage: { defaultLanguage: pageLanguage },
        }),
      ).toBe(pageLanguage || "en");
    }
  });

  test("through the API: a language code, or empty for the page's default, and nothing else", () => {
    expect(SECTION).toContain(
      "Through the API, a subscriber's `language` is a language code such as `de` or `zh-TW`, or empty for the page's default; any other value is refused.",
    );

    const column: TableColumnMetadata =
      new StatusPageSubscriber().getTableColumnMetadata("language");

    expect(column.type).toBe(TableColumnType.ShortText);
    expect(column.required).toBe(false);

    for (const code of ["de", "zh-TW"]) {
      expect(READER_LANGUAGE_CODES).toContain(code);
    }

    expect(
      readSource("Common/Server/Services/StatusPageSubscriberService.ts"),
    ).toContain(
      "throw new BadDataException(UNSUPPORTED_SUBSCRIBER_LANGUAGE_MESSAGE);",
    );
  });

  test("OneUptime's own names are translated, the team's read as written", () => {
    expect(SECTION).toContain(
      "the names of the incident states, severities and scheduled maintenance states every new project starts with, such as Resolved, Major Incident or Ongoing.",
    );

    for (const name of ["Resolved", "Major Incident", "Ongoing"]) {
      expect(DEFAULT_STATUS_NAMES).toContain(name);
    }

    expect(SECTION).toContain(
      "What your team writes reads as written: titles, descriptions, notes and postmortems, your own names for states, severities and resources, the status page's name, custom fields, and custom templates.",
    );
  });

  test("a custom template's values, and a test report, are in the page's default language", () => {
    expect(SECTION).toContain(
      "A custom template reads the same to every subscriber, so the values OneUptime fills it with, such as a state's name or a date, are in the page's default language, and so is a test report.",
    );

    // The values (SubscriberTemplateValues), in the page's language.
    expect(
      SubscriberTemplateValues.inPageLanguage(
        { defaultLanguage: "de" },
        {
          state: SubscriberTemplateValues.stateName("Resolved"),
          title: "Checkout failing",
        },
      ),
    ).toEqual({ state: "Behoben", title: "Checkout failing" });

    // A test report is the page's default language (sendEmailReport).
    expect(readSource("Common/Server/Services/StatusPageService.ts")).toContain(
      "await sendEmail(data.email, null, pageLanguage);",
    );
  });

  test("an email in Persian reads right to left; a webhook's payload does not change", () => {
    expect(SECTION).toContain(
      "An email in Persian reads right to left, and an English title or note in it still reads left to right.",
    );
    expect(getEmailLanguageVariables("fa")["emailDirection"]).toBe("rtl");
    // A value says which way it reads (Utils/EmailLanguage.ts).
    expect(getEmailHtmlValue("<p>Rolled back v2.4.1.</p>")).toBe(
      '<div dir="ltr"><p>Rolled back v2.4.1.</p></div>',
    );
    expect(getEmailLanguageVariables("de")["emailDirection"]).toBeUndefined();

    expect(SECTION).toContain(
      "A webhook's payload is data and stays as it is.",
    );
    expect(SECTION).not.toContain("written in English");
  });

  test("the Default Language row says subscribers follow it too", () => {
    expect(read("en", "branding-and-domains")).toContain(
      "visitors can always switch from the footer. Subscribers are written to in it too, unless they subscribed while reading the page in another language. |",
    );
  });
});

describe("the section in every docs language", () => {
  const englishLines: Array<string> = ENGLISH.split("\n");
  const headingLine: number = englishLines.indexOf(HEADING);

  test("English has it just before Checking what was sent", () => {
    expect(headingLine).toBeGreaterThan(0);
    expect(
      englishLines.slice(headingLine).indexOf("## Checking what was sent"),
    ).toBe(12);
  });

  test.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s has it at the same line, with the same code and the link to its own heading",
    (language: string) => {
      const lines: Array<string> = read(language, "subscribers").split("\n");

      expect(lines[headingLine]!.startsWith("## ")).toBe(true);
      expect(lines[headingLine]).not.toBe(HEADING);

      // Who gets which language: three items, each led in bold.
      for (const offset of [4, 5, 6]) {
        expect(lines[headingLine + offset]!.startsWith("- **")).toBe(true);
      }

      /*
       * The team's field: under the language's own More fields, in the
       * language's own Language column (DocsDashboardLabels).
       */
      expect(lines[headingLine + 5]!.match(/\*\*[^*]+\*\*/g)).toHaveLength(3);

      // The page's default language, linked to its own heading.
      expect(lines[headingLine + 6]).toContain(
        "](/docs/status-pages/branding-and-domains#",
      );
      expect(lines[headingLine + 6]).not.toContain("#more-settings)");
      expect(lines[headingLine + 8]).toContain("Resolved");

      // The API, last, a paragraph of its own.
      expect(lines[headingLine + 10]!.match(/`[^`]+`/g)).toEqual([
        "`language`",
        "`de`",
        "`zh-TW`",
      ]);
      expect(lines[headingLine + 12]!.startsWith("## ")).toBe(true);
    },
  );
});
