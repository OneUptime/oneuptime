import StatusPageThemeCopy, {
  STATUS_PAGE_DARK_THEME_CSS_PREFIX,
  STATUS_PAGE_THEME_CARD_TEST_ID,
  STATUS_PAGE_THEME_CHOICES,
  STATUS_PAGE_THEME_PREVIEW_SELECTED_EDGE,
  StatusPageThemeChoice,
  StatusPageThemeNotePart,
  StatusPageThemePreviewPalette,
  getShownStatusPageTheme,
  getStatusPageThemeChoiceTestId,
  getStatusPageThemeNoteParts,
  getStatusPageThemePreviewPalettes,
  hasStatusPageCustomCode,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageThemeCopy";
import StatusPageTheme, {
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_COLORS,
} from "Common/Types/StatusPage/StatusPageTheme";
import { RGB } from "Common/Types/Color";
import { getContrastRatio, parseColor } from "Common/Utils/ColorContrast";
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
      // A picture of the page sits beside each one: the words stay short.
      expect(choice.description.length).toBeLessThanOrEqual(90);
      expect(choice.description.endsWith(".")).toBe(true);
      expect(choice.description.split(". ").length).toBeLessThanOrEqual(2);
    }
  });

  test("Dark tells the owner the logo is shown as it is, so it should be one made for a dark background", () => {
    expect(STATUS_PAGE_THEME_CHOICES[1]!.description).toContain(
      "logo made for a dark background",
    );
  });

  test("the visitor's device says visitors can switch it in the footer, and asks nothing of the owner", () => {
    const description: string = STATUS_PAGE_THEME_CHOICES[2]!.description;

    expect(description).toBe(
      "Light or dark, as each visitor's device is set. Visitors can switch it in the footer.",
    );

    /*
     * The logo needs nothing from its owner on such a page - it sits on a
     * light backdrop on the dark page (StatusPage's LogoPlate) - so the
     * sentence leaves it out. Only Dark, whose logo is shown as it is, asks.
     */
    expect(description).not.toContain("logo");
    expect(
      STATUS_PAGE_THEME_CHOICES.filter(
        (choice: StatusPageThemeChoice): boolean => {
          return choice.description.includes("logo");
        },
      ).map((choice: StatusPageThemeChoice): StatusPageTheme => {
        return choice.value;
      }),
    ).toEqual([StatusPageTheme.Dark]);
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
  test.each(
    STATUS_PAGE_THEMES.map((theme: StatusPageTheme): Array<StatusPageTheme> => {
      return [theme];
    }),
  )("a page with %s shows it", (theme: StatusPageTheme) => {
    expect(getShownStatusPageTheme(theme)).toBe(theme);
  });

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
    expect(STATUS_PAGE_DARK_THEME_CSS_PREFIX).toBe("html.dark");
  });

  test("is cut into its words and the CSS prefix, which the card draws as code", () => {
    expect(
      getStatusPageThemeNoteParts(StatusPageThemeCopy.customCodeNote),
    ).toEqual([
      {
        text: "Your custom CSS and HTML apply in both themes. Start a CSS rule with ",
        isCode: false,
      },
      { text: "html.dark", isCode: true },
      { text: " to style only the dark theme.", isCode: false },
    ]);
  });

  test("a prefix at either end, or twice, is code each time, and no empty words are left", () => {
    expect(getStatusPageThemeNoteParts("html.dark first")).toEqual([
      { text: "html.dark", isCode: true },
      { text: " first", isCode: false },
    ]);
    expect(getStatusPageThemeNoteParts("last html.dark")).toEqual([
      { text: "last ", isCode: false },
      { text: "html.dark", isCode: true },
    ]);
    expect(
      getStatusPageThemeNoteParts("html.dark and html.dark").filter(
        (part: StatusPageThemeNotePart): boolean => {
          return part.isCode;
        },
      ),
    ).toHaveLength(2);
    expect(getStatusPageThemeNoteParts("no prefix here")).toEqual([
      { text: "no prefix here", isCode: false },
    ]);
  });
});

/*
 * The picture beside each choice (StatusPageThemePreview) is drawn in the
 * status page's own colours, with plain fills the dashboard's dark theme
 * cannot remap.
 */
describe("the pictures beside the choices", () => {
  const palettes: {
    light: StatusPageThemePreviewPalette;
    dark: StatusPageThemePreviewPalette;
  } = getStatusPageThemePreviewPalettes();

  const rgb: (color: string) => RGB = (color: string): RGB => {
    return parseColor(color)!;
  };

  test("are the status page's own grounds: the light page and the dark one", () => {
    expect(palettes.light.page).toBe(STATUS_PAGE_THEME_COLORS.light);
    expect(palettes.dark.page).toBe(STATUS_PAGE_THEME_COLORS.dark);
  });

  test("the dark picture's card is the dark theme's card, as Theme.css draws it", () => {
    const themeCss: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "UI",
        "Styles",
        "Theme.css",
      ),
      "utf8",
    );
    const darkTokens: string = themeCss.slice(
      themeCss.indexOf("html.dark {"),
      themeCss.indexOf("}", themeCss.indexOf("html.dark {")),
    );

    expect(darkTokens).toContain(
      `--ou-surface-primary: ${palettes.dark.card};`,
    );
  });

  test("every colour is a plain colour, never a class the dashboard's dark theme would remap", () => {
    for (const palette of [palettes.light, palettes.dark]) {
      for (const color of Object.values(palette)) {
        expect([color, parseColor(color) === null]).toEqual([color, false]);
      }
    }
  });

  test("the bars of a day that was up and one that was not are told apart on both pages", () => {
    for (const palette of [palettes.light, palettes.dark]) {
      expect(palette.up).not.toBe(palette.degraded);
      expect(
        getContrastRatio(rgb(palette.up), rgb(palette.card)),
      ).toBeGreaterThanOrEqual(1.5);
    }
  });

  test("the choice in force is framed in a colour that reads at 3:1 on the light dashboard and the dark one", () => {
    const lightDashboardCard: RGB = rgb("#ffffff");
    const darkDashboardCard: RGB = rgb(palettes.dark.card);

    expect(
      getContrastRatio(
        rgb(STATUS_PAGE_THEME_PREVIEW_SELECTED_EDGE),
        lightDashboardCard,
      ),
    ).toBeGreaterThanOrEqual(3);
    expect(
      getContrastRatio(
        rgb(STATUS_PAGE_THEME_PREVIEW_SELECTED_EDGE),
        darkDashboardCard,
      ),
    ).toBeGreaterThanOrEqual(3);
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

      // The card draws the prefix as code, once, in every language.
      expect(
        getStatusPageThemeNoteParts(
          translations[StatusPageThemeCopy.customCodeNote] as string,
        ).filter((part: StatusPageThemeNotePart): boolean => {
          return part.isCode;
        }),
      ).toEqual([{ text: "html.dark", isCode: true }]);
    },
  );

  /*
   * Each language's word for the logo, as its Dark sentence uses it: the
   * sentence for the visitor's device leaves the logo out in every language,
   * as the English does.
   */
  const LOGO_WORDS: Record<string, string> = {
    de: "Logo",
    fr: "logo",
    es: "logotipo",
    it: "logo",
    pt: "logotipo",
    nl: "logo",
    da: "logo",
    no: "logo",
    sv: "logotyp",
    ru: "логотип",
    ja: "ロゴ",
    ko: "로고",
    "zh-CN": "徽标",
    "zh-TW": "標誌",
    hi: "लोगो",
    fa: "لوگو",
  };

  test.each(OTHER_LOCALES)(
    "%s says the visitor's device as shortly as the English, without the logo",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);
      const english: string = STATUS_PAGE_THEME_CHOICES[2]!.description;
      const translated: string = translations[english] as string;
      const darkSentence: string = translations[
        STATUS_PAGE_THEME_CHOICES[1]!.description
      ] as string;
      const logo: string = LOGO_WORDS[locale]!;

      // The word is the one this language's Dark sentence uses for the logo.
      expect([locale, darkSentence.includes(logo)]).toEqual([locale, true]);
      expect([locale, translated.includes(logo)]).toEqual([locale, false]);
      expect(translated.length).toBeLessThanOrEqual(
        Math.ceil(english.length * 1.6),
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
