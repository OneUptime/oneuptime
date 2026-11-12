import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardBrandingCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardBrandingCopy";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

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
 * how big ("Types: PNG, JPG, SVG. Max 10 MB each."). Fourteen languages said
 * that in English while translating the same sentence for a picker with a
 * limit of its own ("Max {{size}} each."). Every limit, the everyday 10 MB
 * too, is now that sentence's value, in the reader's digits (issue #7233),
 * so each language says it once, with its {{size}}.
 *
 * Read from the Dashboard's locale files themselves, so a key that loses its
 * translation, keeps the English or loses a placeholder is caught.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

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

// The picker's line under a drop zone: whatever its limit, one value of the sentence.
const SIZE_LINES: Array<string> = [
  "Types: {{types}}. Max {{size}} each.",
  "Max {{size}} each.",
];

// The picker's words as its code writes them, without the comments that tell their story.
const FILE_PICKER_LAYOUT: string = fs
  .readFileSync(
    path.resolve(
      __dirname,
      "../../../UI/Components/FilePicker/FilePickerLayout.ts",
    ),
    "utf8",
  )
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("the Logo card and its dialog in English", () => {
  test("every word is an English key of its own", () => {
    for (const word of LOGO_WORDS) {
      expect(ENGLISH[word]).toBe(word);
    }

    for (const line of SIZE_LINES) {
      expect(ENGLISH[line]).toBe(line);
    }
  });

  test("the picker writes no limit into its words: the default 10 MB is the sentence's {{size}} too", () => {
    for (const line of SIZE_LINES) {
      expect(FILE_PICKER_LAYOUT).toContain(`"${line}"`);
    }
    // Negative control: the words that wrote the default limit in Latin digits are gone.
    expect(FILE_PICKER_LAYOUT).not.toContain('"Max 10MB each."');
    expect(FILE_PICKER_LAYOUT).not.toContain(
      '"Types: {{types}}. Max 10MB each."',
    );
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

    test("the picker says its limit in the language's own words, with the size and the file types kept", () => {
      for (const line of SIZE_LINES) {
        const translated: string = locale[line]!;

        expect(translated).toBeTruthy();
        expect(translated).not.toBe(line);
        expect(translated).toContain("{{size}}");
        // No limit of its own written into the words.
        expect(translated).not.toMatch(/10\s?MB/);

        if (line.includes("{{types}}")) {
          expect(translated).toContain("{{types}}");
        }
      }
    });
  },
);
