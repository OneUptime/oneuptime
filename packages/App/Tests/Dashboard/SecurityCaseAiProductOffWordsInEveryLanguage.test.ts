import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { SecurityCaseHandOffReason } from "Common/Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_HAND_OFF_SENTENCES,
  SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES,
} from "Common/Types/SecurityCase/SecurityCaseAiWords";

/*
 * SECURITY EVENTS SWITCHED OFF WHILE ONEUPTIME AI WORKS A CASE (#10816), IN
 * EVERY LANGUAGE THE DASHBOARD SHIPS - read from its locale files as they
 * ship.
 *
 * The case's OneUptime AI card says why OneUptime AI handed the case to
 * people (the hand-off's sentence) and why Respond with AI cannot start
 * (the not-started message), in the reader's language: a German, Japanese
 * or Arabic reader never meets English there. Each names the product as
 * that language's Dashboard names it, and the not-started message names
 * the Admin Dashboard's products page as the language's other sentences
 * about a product switched off do. The timeline and the notices keep the
 * English, as every hand-off's do.
 */

const HAND_OFF: string =
  SECURITY_CASE_HAND_OFF_SENTENCES[SecurityCaseHandOffReason.ProductOff];
const NOT_STARTED: string =
  SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES.product_off;
const SENTENCES: ReadonlyArray<string> = [HAND_OFF, NOT_STARTED];

// Another sentence of the Dashboard's about a product switched off, with the same path.
const ASK_A_SERVER_ADMIN: string =
  "A server admin switched this off for every project. They can switch it on in Admin Dashboard > Settings > Products.";

describe("Security Events switched off while OneUptime AI works a case, in every language", () => {
  test("the hand-off's reason and Respond with AI's are English keys the Dashboard's locales hold", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    expect(HAND_OFF).toBe(
      "Security Events is switched off on this server, so OneUptime AI stopped working the case.",
    );

    for (const sentence of SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }
  });

  test("are worded in every language, each keeping its placeholders", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of SENTENCES) {
        if (!isWordedInDashboardLocale(sentence, language)) {
          unworded.push(`${language}: ${sentence}`);
          continue;
        }

        expect({
          language,
          sentence,
          placeholders: placeholdersOf(words[sentence] || ""),
        }).toEqual({
          language,
          sentence,
          placeholders: placeholdersOf(sentence),
        });
      }
    }

    expect(unworded).toEqual([]);
  });

  test("name Security Events as each language's Dashboard names the product", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const product: string = words["Security Events"] || "";

      expect({ language, product: Boolean(product) }).toEqual({
        language,
        product: true,
      });

      for (const sentence of SENTENCES) {
        expect({
          language,
          sentence,
          named: (words[sentence] || "").includes(product),
        }).toEqual({ language, sentence, named: true });
      }
    }
  });

  test("Respond with AI's names the Admin Dashboard's products page as the language's other sentences do", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const reference: Array<string> = (words[ASK_A_SERVER_ADMIN] || "").split(
        " > ",
      );

      // "<…> Admin Dashboard", "Settings", "Products <…>": the middle is the menu's own word.
      expect({ language, segments: reference.length }).toEqual({
        language,
        segments: 3,
      });

      expect({
        language,
        path: (words[NOT_STARTED] || "").includes(` > ${reference[1]} > `),
      }).toEqual({ language, path: true });
    }
  });

  test("every reason OneUptime AI hands a case to people for is worded in every language", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const reason of Object.values(SecurityCaseHandOffReason)) {
        if (
          !isWordedInDashboardLocale(
            SECURITY_CASE_HAND_OFF_SENTENCES[reason],
            language,
          )
        ) {
          unworded.push(`${language}: ${reason}`);
        }
      }
    }

    expect(unworded).toEqual([]);
  });
});
