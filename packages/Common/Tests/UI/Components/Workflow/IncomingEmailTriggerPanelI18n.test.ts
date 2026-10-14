import { IncomingEmailTriggerPanelCopy } from "../../../../UI/Components/Workflow/IncomingEmailTriggerPanel";
import { WebhookTriggerPanelCopy } from "../../../../UI/Components/Workflow/WebhookTriggerPanel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Incoming Email trigger's address panel is drawn in the dashboard, which
 * looks every string up in its locale files by its English text. A string
 * with no entry silently stays English, so this holds every sentence the
 * panel and its Reset address confirmation show to all seventeen files.
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
  new Set(Object.values(IncomingEmailTriggerPanelCopy)),
);

describe("the Incoming Email trigger panel in every dashboard language", () => {
  test("the scan found the panel's strings, so the checks below are not vacuous", () => {
    expect(PANEL_STRINGS.length).toBeGreaterThanOrEqual(20);
    expect(PANEL_STRINGS).toContain("Reset address");
    expect(PANEL_STRINGS).toContain("How to set up inbound email");
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
    "%s keeps OneUptime's name as it is",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const text of PANEL_STRINGS) {
        if (text.includes("OneUptime")) {
          expect(translations[text]).toContain("OneUptime");
        }
      }
    },
  );

  test("with a reset, the advice is one key of its own, never the webhook's", () => {
    /*
     * The two sentences are one key, so a language words them together and
     * gives "it" the address's gender. It was a second key glued on with a
     * space, which Dutch and Portuguese translated as the URL's when it was
     * the Webhook trigger's "If it leaks, reset it.".
     */
    expect(IncomingEmailTriggerPanelCopy.keepPrivateCanReset).toBe(
      `${IncomingEmailTriggerPanelCopy.keepPrivate} If it leaks, reset it.`,
    );
    expect(IncomingEmailTriggerPanelCopy.keepPrivateCanReset).not.toBe(
      WebhookTriggerPanelCopy.keepPrivateCanReset,
    );
  });

  test.each(OTHER_LOCALES)(
    "%s words the case with a reset apart from the case without one",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);
      const alone: string =
        translations[IncomingEmailTriggerPanelCopy.keepPrivate] || "";
      const withReset: string =
        translations[IncomingEmailTriggerPanelCopy.keepPrivateCanReset] || "";

      expect(withReset).not.toBe(
        IncomingEmailTriggerPanelCopy.keepPrivateCanReset,
      );
      expect(withReset.length).toBeGreaterThan(alone.length);
      // The address's own pair, not the URL's.
      expect(withReset).not.toBe(
        translations[WebhookTriggerPanelCopy.keepPrivateCanReset],
      );
    },
  );

  test("the glued sentence is gone from every locale, and the panel glues none", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      expect({
        locale,
        present: "If the address leaks, reset it." in readLocale(locale),
      }).toEqual({ locale, present: false });
    }

    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "UI",
        "Components",
        "Workflow",
        "IncomingEmailTriggerPanel.tsx",
      ),
      "utf8",
    );

    // The second sentence was added after the first when the reset was offered.
    expect(source).not.toMatch(/canReset\s*\?\s*`/);
    expect(source).not.toContain("resetIfLeaked");
    expect(source).toContain(
      "IncomingEmailTriggerPanelCopy.keepPrivateCanReset",
    );
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
          "IncomingEmailTriggerPanel.tsx",
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
