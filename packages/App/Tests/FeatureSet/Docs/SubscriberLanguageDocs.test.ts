import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import SubscriberLanguage from "Common/Server/Utils/StatusPage/SubscriberLanguage";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { READER_LANGUAGE_CODES } from "Common/Types/ReaderLanguage";
import { DEFAULT_STATUS_NAMES } from "Common/Types/StatusPage/DefaultStatusNames";
import { getEmailLanguageVariables } from "../../../FeatureSet/Notification/Utils/EmailLanguage";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, "The language subscribers are written in",
 * says who is written to in which language, what changes with it and what
 * does not. Held here to the code that decides it: SubscriberLanguage (who
 * gets which language), the subscriber's language column and the service
 * that refuses any other value, the default names that are translated, the
 * way an email in Persian reads, and the report that is still English.
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
  test("every message about a subscription and every notification, on the four channels that have words", () => {
    expect(SECTION).toContain(
      "Each subscriber is written to in their own language: the email or text message that confirms the subscription, the welcome and the link to manage it, and every notification about an incident, an incident episode, a scheduled maintenance event or an announcement, by email, SMS, Slack and Microsoft Teams.",
    );
  });

  test("a visitor who read the page in another language keeps it; everyone else follows the page's default, as it changes", () => {
    expect(SECTION).toContain(
      "A visitor who switches the status page to another language in its footer, then subscribes or updates their subscription, is written to in that language.",
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
      "What your team writes reads as written: titles, descriptions, notes and postmortems, your own names for states, severities and resources, the status page's name, custom fields, and custom templates, whose values read as they are stored.",
    );
  });

  test("an email in Persian reads right to left; a webhook's payload and the report do not change", () => {
    expect(SECTION).toContain("An email in Persian reads right to left.");
    expect(getEmailLanguageVariables("fa")["emailDirection"]).toBe("rtl");
    expect(getEmailLanguageVariables("de")["emailDirection"]).toBeUndefined();

    expect(SECTION).toContain(
      "A webhook's payload is data and stays as it is, and the email report is written in English.",
    );

    // The report's template has no words in another language to give.
    const report: string = readSource(
      "App/FeatureSet/Notification/Templates/StatusPageSubscriberReport.hbs",
    );

    expect(report).toContain('"Uptime Report: "');
    expect(report).not.toMatch(/[({]\s*(t|tHtml|tt|ttHtml|tp)\s+"/);
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
    ).toBe(8);
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

      const paragraphs: string = [2, 4, 6]
        .map((offset: number): string => {
          return lines[headingLine + offset]!;
        })
        .join("\n");

      expect(paragraphs.match(/`[^`]+`/g)).toEqual([
        "`language`",
        "`de`",
        "`zh-TW`",
      ]);
      expect(paragraphs).toContain(
        "](/docs/status-pages/branding-and-domains#",
      );
      expect(paragraphs).not.toContain("#more-settings)");
      expect(paragraphs).toContain("Resolved");
    },
  );
});
