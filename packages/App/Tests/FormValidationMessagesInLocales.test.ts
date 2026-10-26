import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { FORM_VALIDATION_MESSAGES } from "Common/UI/Components/Forms/Utils/FormValidationMessages";

/*
 * EVERY FRONTEND SAYS WHAT IS WRONG WITH A FIELD IN THE READER'S LANGUAGE.
 *
 * The maintainer's follow-ups: "Admin Dashboard forms have no shared
 * validation messages (English in every language)." A form field's checks
 * (Common Forms/Validation) say one of FORM_VALIDATION_MESSAGES, looked up
 * by its English text in the locale files of the frontend the form is
 * drawn in. The Dashboard's had them; the Admin Dashboard's had one of
 * fourteen, so every Admin form said "Name is required." in English in all
 * sixteen other languages, and Accounts and status pages missed some too.
 *
 * Held here: each frontend with locale files of its own has every message
 * in all seventeen languages, its placeholders intact, and translated
 * wherever the Dashboard translates it - in the Dashboard's words where the
 * frontend had none of its own.
 */

const FEATURE_SET: string = path.join(__dirname, "..", "FeatureSet");

const FRONTENDS: ReadonlyArray<string> = [
  "Dashboard",
  "AdminDashboard",
  "Accounts",
  "StatusPage",
];

const LANGUAGES: ReadonlyArray<string> = [
  "en",
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

const PLACEHOLDER: RegExp = /\{\{[^{}]{1,40}\}\}/g;

function readLocale(
  frontend: string,
  language: string,
): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SET, frontend, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("the form validation messages in every frontend's locales", () => {
  test("the list is the checks' whole list", () => {
    expect(FORM_VALIDATION_MESSAGES.length).toBe(14);
    expect(FORM_VALIDATION_MESSAGES).toContain("{{field}} is required.");
  });

  describe.each(FRONTENDS)("%s", (frontend: string) => {
    test.each(LANGUAGES)("%s has every message", (language: string) => {
      const locale: Record<string, unknown> = readLocale(frontend, language);
      const missing: Array<string> = FORM_VALIDATION_MESSAGES.filter(
        (message: string): boolean => {
          return typeof locale[message] !== "string";
        },
      );

      expect({ frontend, language, missing }).toEqual({
        frontend,
        language,
        missing: [],
      });
    });

    test.each(LANGUAGES)(
      "%s keeps every placeholder of every message",
      (language: string) => {
        const locale: Record<string, unknown> = readLocale(frontend, language);

        for (const message of FORM_VALIDATION_MESSAGES) {
          const translated: string = String(locale[message] || "");

          expect({ message, placeholders: placeholdersOf(translated) }).toEqual(
            { message, placeholders: placeholdersOf(message) },
          );
        }
      },
    );

    test.each(
      LANGUAGES.filter((language: string): boolean => {
        return language !== "en";
      }),
    )("%s reads translated wherever the Dashboard does", (language: string) => {
      const locale: Record<string, unknown> = readLocale(frontend, language);
      const dashboard: Record<string, unknown> = readLocale(
        "Dashboard",
        language,
      );

      for (const message of FORM_VALIDATION_MESSAGES) {
        if (dashboard[message] === message) {
          // The Dashboard has not worded it in this language either.
          continue;
        }

        expect({
          frontend,
          language,
          message,
          translated: locale[message] !== message,
        }).toEqual({
          frontend,
          language,
          message,
          translated: true,
        });
      }
    });
  });

  test("the Admin Dashboard words them as the Dashboard does", () => {
    for (const language of LANGUAGES) {
      const admin: Record<string, unknown> = readLocale(
        "AdminDashboard",
        language,
      );
      const dashboard: Record<string, unknown> = readLocale(
        "Dashboard",
        language,
      );

      for (const message of FORM_VALIDATION_MESSAGES) {
        expect({ language, message, admin: admin[message] }).toEqual({
          language,
          message,
          admin: dashboard[message],
        });
      }
    }
  });

  test("German, for one: a required Admin field reads in German", () => {
    expect(readLocale("AdminDashboard", "de")["{{field}} is required."]).toBe(
      "{{field}} ist erforderlich.",
    );
  });
});
