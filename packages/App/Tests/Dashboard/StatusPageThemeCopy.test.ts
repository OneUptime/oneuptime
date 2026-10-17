import StatusPageThemeCopy, {
  STATUS_PAGE_THEME_CARD_TEST_ID,
  STATUS_PAGE_THEME_CHOICES,
  StatusPageThemeChoice,
  getShownStatusPageTheme,
  getStatusPageThemeChoiceTestId,
  hasStatusPageCustomCode,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageThemeCopy";
import StatusPageTheme, {
  STATUS_PAGE_THEMES,
} from "Common/Types/StatusPage/StatusPageTheme";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Theme, on a status page's Branding page (StatusPageThemeCopy): one choice
 * of three, in the plain words a status page owner reads - Light, Dark, or
 * Match each visitor's device - each with one sentence on what visitors get,
 * and what the page does with the one logo it has.
 *
 * The card itself is rendered in Common/Tests/App/Dashboard/
 * StatusPageThemeCard.test.tsx; this holds the words and the rules the card
 * reads, and their translations, here where the locale files are.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
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

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const SENTENCES: Array<string> = [
  StatusPageThemeCopy.title,
  StatusPageThemeCopy.description,
  StatusPageThemeCopy.ariaLabel,
  StatusPageThemeCopy.customCodeNote,
  ...STATUS_PAGE_THEME_CHOICES.flatMap(
    (choice: StatusPageThemeChoice): Array<string> => {
      return [choice.title, choice.description];
    },
  ),
];

describe("the three choices", () => {
  test("are Light, Dark and the visitor's device, in that order, one per theme", () => {
    expect(
      STATUS_PAGE_THEME_CHOICES.map((choice: StatusPageThemeChoice) => {
        return [choice.value, choice.title];
      }),
    ).toEqual([
      [StatusPageTheme.Light, "Light"],
      [StatusPageTheme.Dark, "Dark"],
      [StatusPageTheme.System, "Match each visitor's device"],
    ]);

    expect(
      STATUS_PAGE_THEME_CHOICES.map((choice: StatusPageThemeChoice) => {
        return choice.value;
      }),
    ).toEqual([...STATUS_PAGE_THEMES]);
  });

  test("each says what every visitor gets, in one or two short sentences", () => {
    for (const choice of STATUS_PAGE_THEME_CHOICES) {
      expect(choice.description.length).toBeGreaterThan(0);
      expect(choice.description.length).toBeLessThanOrEqual(160);
      expect(choice.description.endsWith(".")).toBe(true);
    }
  });

  test("Dark tells the owner the logo is shown as it is, so it should be one made for a dark background", () => {
    expect(STATUS_PAGE_THEME_CHOICES[1]!.description).toContain(
      "logo made for a dark background",
    );
  });

  test("the visitor's device says visitors can switch, and that the logo gets a light backdrop on the dark page", () => {
    const description: string = STATUS_PAGE_THEME_CHOICES[2]!.description;

    expect(description).toContain("switch it in the page's footer");
    expect(description).toContain("light backdrop on the dark page");
  });

  test("each has its own radio test id", () => {
    expect(
      STATUS_PAGE_THEMES.map((theme: StatusPageTheme): string => {
        return getStatusPageThemeChoiceTestId(theme);
      }),
    ).toEqual([
      "status-page-theme-light",
      "status-page-theme-dark",
      "status-page-theme-system",
    ]);
    expect(STATUS_PAGE_THEME_CARD_TEST_ID).toBe("status-page-theme");
  });
});

describe("what the card shows as checked", () => {
  test.each(STATUS_PAGE_THEMES.map((theme: StatusPageTheme) => [theme]))(
    "a page with %s shows it",
    (theme: StatusPageTheme) => {
      expect(getShownStatusPageTheme(theme)).toBe(theme);
    },
  );

  test.each([undefined, null, "", "dark", "Sepia"])(
    "a page with %p shows Light, the page it is drawn as",
    (value: unknown) => {
      expect(getShownStatusPageTheme(value)).toBe(StatusPageTheme.Light);
    },
  );
});

describe("the note on a page with custom code", () => {
  test("is shown for custom CSS, header HTML or footer HTML", () => {
    expect(hasStatusPageCustomCode({ customCSS: "body { color: red; }" })).toBe(
      true,
    );
    expect(hasStatusPageCustomCode({ headerHTML: "<div>Acme</div>" })).toBe(
      true,
    );
    expect(hasStatusPageCustomCode({ footerHTML: "<p>Legal</p>" })).toBe(true);
  });

  test("is not shown for none, or for only whitespace", () => {
    expect(hasStatusPageCustomCode({})).toBe(false);
    expect(
      hasStatusPageCustomCode({
        customCSS: "  \n",
        headerHTML: null,
        footerHTML: "",
      }),
    ).toBe(false);
  });

  test("says the code applies in both themes, and names the class that styles only the dark one", () => {
    expect(StatusPageThemeCopy.customCodeNote).toContain("both themes");
    expect(StatusPageThemeCopy.customCodeNote).toContain("html.dark");
  });
});

describe("translations", () => {
  test("en.json maps every sentence to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const sentence of SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every sentence, and keeps html.dark as it is",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const sentence of SENTENCES) {
        expect([sentence, typeof translations[sentence]]).toEqual([
          sentence,
          "string",
        ]);
        expect([sentence, translations[sentence]]).not.toEqual([
          sentence,
          sentence,
        ]);
      }

      expect(translations[StatusPageThemeCopy.customCodeNote]).toContain(
        "html.dark",
      );
    },
  );

  test.each(OTHER_LOCALES)(
    "%s names Light, Dark and the device apart",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);
      const titles: Array<unknown> = STATUS_PAGE_THEME_CHOICES.map(
        (choice: StatusPageThemeChoice): unknown => {
          return translations[choice.title];
        },
      );

      expect(new Set(titles).size).toBe(3);
    },
  );
});
