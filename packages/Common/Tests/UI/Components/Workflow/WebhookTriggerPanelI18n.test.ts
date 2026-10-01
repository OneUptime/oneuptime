import {
  WebhookTriggerPanelCopy,
  getMethodsSentence,
} from "../../../../UI/Components/Workflow/WebhookTriggerPanel";
import { WEBHOOK_TRIGGER_HTTP_METHODS } from "../../../../Types/Workflow/WebhookTrigger";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Webhook trigger's URL panel is drawn in the dashboard, which looks every
 * string up in its locale files by its English text. A string with no entry
 * silently stays English, so this holds every sentence the panel and its
 * Reset URL confirmation show to all seventeen files.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

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

type ReadLocaleFunction = (locale: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  );
};

const ENGLISH: Record<string, string> = readLocale("en");

const PANEL_STRINGS: Array<string> = Array.from(
  new Set([...Object.values(WebhookTriggerPanelCopy), getMethodsSentence()]),
);

// The Settings page's old card, gone with it.
const RETIRED_KEYS: Array<string> = [
  "Reset Webhook Secret Key",
  "Are you sure you want to reset the webhook secret key? Any existing integrations using the current key will stop working.",
  "This secret key is used to trigger this workflow via webhook. Use this key in the webhook URL instead of the workflow ID for security. You can reset this key if it is compromised.",
  "No secret key generated yet. Save the workflow to generate one.",
];

describe("the Webhook trigger panel in every dashboard language", () => {
  test("the scan found the panel's strings, so the checks below are not vacuous", () => {
    expect(PANEL_STRINGS.length).toBeGreaterThanOrEqual(20);
    expect(PANEL_STRINGS).toContain("Reset URL");
    expect(PANEL_STRINGS).toContain("Accepts GET or POST requests.");
  });

  test("there are seventeen locale files", () => {
    const files: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string) => {
        return file.endsWith(".json");
      });

    expect(files.sort()).toEqual(
      ["en", ...OTHER_LOCALES]
        .map((locale: string) => {
          return `${locale}.json`;
        })
        .sort(),
    );
  });

  test("English maps every string to itself", () => {
    for (const text of PANEL_STRINGS) {
      expect({ text, english: ENGLISH[text] }).toEqual({ text, english: text });
    }
  });

  test.each(OTHER_LOCALES)("%s translates every string", (locale: string) => {
    const translations: Record<string, string> = readLocale(locale);

    for (const text of PANEL_STRINGS) {
      const translated: string | undefined = translations[text];

      expect({ locale, text, has: typeof translated === "string" }).toEqual({
        locale,
        text,
        has: true,
      });
      expect((translated || "").trim().length).toBeGreaterThan(0);

      // Sentences are translated, not left in English.
      if (text.split(" ").length > 3) {
        expect({ locale, text, same: translated === text }).toEqual({
          locale,
          text,
          same: false,
        });
      }
    }
  });

  test.each(OTHER_LOCALES)(
    "%s keeps the method names as they are, so they can be drawn as badges",
    (locale: string) => {
      const sentence: string = readLocale(locale)[getMethodsSentence()] || "";

      for (const method of WEBHOOK_TRIGGER_HTTP_METHODS) {
        expect(sentence).toMatch(new RegExp(`\\b${method}\\b`));
      }
    },
  );

  test("the old Settings card's keys are gone from every locale", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      const translations: Record<string, string> = readLocale(locale);

      for (const key of RETIRED_KEYS) {
        expect({ locale, key, present: key in translations }).toEqual({
          locale,
          key,
          present: false,
        });
      }
    }
  });

  test("the panel draws no text that bypasses the lookup", () => {
    /*
     * Text written straight into JSX would stay English in every language.
     * Everything the panel says goes through translate(), or is handed to a
     * Button or ConfirmModal, which look their own titles up.
     */
    const source: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "UI",
          "Components",
          "Workflow",
          "WebhookTriggerPanel.tsx",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ");

    // Text between a tag's ">" and the next "<"; an arrow's "=>" is no tag.
    const jsxText: RegExp = /(?<!=)>\s*([A-Za-z][^<>{}]*?)\s*</g;

    const rawJsxText: Array<string> = Array.from(
      source.matchAll(jsxText),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(rawJsxText).toEqual([]);

    // And the scan does catch text written into a tag.
    expect(Array.from("<p>Keep it private</p>".matchAll(jsxText)).length).toBe(
      1,
    );
  });
});
