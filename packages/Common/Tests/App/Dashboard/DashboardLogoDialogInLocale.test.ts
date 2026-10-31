import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardBrandingCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardBrandingCopy";

/*
 * EVERY WORD OF A DASHBOARD'S LOGO CARD AND ITS EDIT LOGO DIALOG IS EVERY
 * LANGUAGE'S OWN.
 *
 * Dashboards -> a dashboard -> Branding: the Logo card shows the logo and the
 * logo for the dark theme, and its Edit Logo button opens a dialog titled as
 * the button is. That dialog was titled "Edit Dashboard" - translated in every
 * language - while "Edit Logo" was still English in twelve of them, so naming
 * the dialog as its button would have turned its title English there. Each
 * language now draws it, naming the logo in the word its Logo field uses.
 *
 * Under each logo's drop zone the file picker says which files it takes and
 * how big ("Types: PNG, JPG, SVG. Max 10MB each."). Fourteen languages said
 * that in English while translating the same sentence for a picker with a
 * limit of its own ("Max {{size}} each."); they now say both alike.
 *
 * Read from the Dashboard's locale files themselves, so a key that loses its
 * translation, keeps the English or loses a placeholder is caught.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
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

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = readLocale("en");

// The card's button, and the dialog's title.
const EDIT_LOGO: string = "Edit Logo";

// The words this branch adds to the card and the dialog.
const LOGO_WORDS: Array<string> = [
  EDIT_LOGO,
  DashboardBrandingCopy.logoDescription,
  DashboardBrandingCopy.darkThemeLogoTitle,
  DashboardBrandingCopy.darkThemeLogoDescription,
  DashboardBrandingCopy.darkThemeLogoPlaceholder,
  DashboardBrandingCopy.noDarkThemeLogo,
];

// The picker's line under a drop zone, with the default limit and with a limit of its own.
const SIZE_LINES: Array<{ withDefaultLimit: string; withOwnLimit: string }> = [
  {
    withDefaultLimit: "Types: {{types}}. Max 10MB each.",
    withOwnLimit: "Types: {{types}}. Max {{size}} each.",
  },
  {
    withDefaultLimit: "Max 10MB each.",
    withOwnLimit: "Max {{size}} each.",
  },
];

// The default limit as a language writes it: "10 MB", or "10MB" in Japanese.
const DEFAULT_LIMIT: RegExp = /10\s?MB/;

describe("the Logo card and its dialog in English", () => {
  test("every word is an English key of its own", () => {
    for (const word of LOGO_WORDS) {
      expect(ENGLISH[word]).toBe(word);
    }

    for (const line of SIZE_LINES) {
      expect(ENGLISH[line.withDefaultLimit]).toBe(line.withDefaultLimit);
      expect(ENGLISH[line.withOwnLimit]).toBe(line.withOwnLimit);
    }
  });
});

describe.each(LANGUAGES)(
  "the Logo card and its dialog in %s",
  (language: string) => {
    const locale: Record<string, string> = readLocale(language);

    test("every word is the language's own, not the English", () => {
      const english: Array<string> = LOGO_WORDS.filter(
        (word: string): boolean => {
          return !locale[word] || locale[word] === word;
        },
      );

      expect(english).toEqual([]);
    });

    test("Edit Logo names the logo in the word the Logo field uses, and is not the old Edit Dashboard", () => {
      const editLogo: string = locale[EDIT_LOGO]!;
      const logo: string = locale["Logo"]!;

      expect(logo).toBeTruthy();
      expect(editLogo.toLocaleLowerCase()).toContain(logo.toLocaleLowerCase());
      expect(editLogo).not.toBe(locale["Edit Dashboard"]);
    });

    test("the picker says the default limit as it says a limit of its own, with the file types kept", () => {
      for (const line of SIZE_LINES) {
        const withDefaultLimit: string = locale[line.withDefaultLimit]!;
        const withOwnLimit: string = locale[line.withOwnLimit]!;

        expect(withDefaultLimit).toBeTruthy();
        expect(withDefaultLimit).not.toBe(line.withDefaultLimit);
        expect(withOwnLimit).toContain("{{size}}");
        expect(withDefaultLimit.replace(DEFAULT_LIMIT, "{{size}}")).toBe(
          withOwnLimit,
        );

        if (line.withOwnLimit.includes("{{types}}")) {
          expect(withDefaultLimit).toContain("{{types}}");
        }
      }
    });
  },
);
