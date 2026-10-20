import DashboardThemeCopy, {
  DASHBOARD_THEME_CARD_TEST_ID,
  DASHBOARD_THEME_CHOICES,
  DASHBOARD_THEME_ERROR_TEST_ID,
  DashboardThemeChoice,
  DashboardThemePreviewPalette,
  getDashboardThemeChoiceTestId,
  getDashboardThemePreviewPalettes,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardThemeCopy";
import { PUBLIC_PAGE_THEME_PREVIEW_SELECTED_EDGE } from "../../FeatureSet/Dashboard/src/Components/PublicPageTheme/PublicPageThemeCopy";
import StatusPageThemeCopy, {
  STATUS_PAGE_THEME_CHOICES,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageThemeCopy";
import DashboardTheme, {
  DASHBOARD_THEMES,
  DASHBOARD_THEME_COLORS,
} from "Common/Types/Dashboard/DashboardTheme";
import { RGB } from "Common/Types/Color";
import { getContrastRatio, parseColor } from "Common/Utils/ColorContrast";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Theme, on a dashboard's Branding page (DashboardThemeCopy): one choice of
 * three for how the public dashboard looks to the visitors of its link -
 * Light, Dark, or Match each visitor's device - each with one short
 * sentence on what visitors see, and the card's own line that every visitor
 * can switch it from the dashboard's toolbar. Nothing is asked of the logo:
 * wherever the page is dark, the logo sits on a light backdrop
 * (PublicDashboard's LogoPlate).
 *
 * The card itself is rendered in Common/Tests/App/Dashboard/
 * DashboardThemeCard.test.tsx; this holds the words and the pictures' colours
 * the card reads, and their translations, here where the locale files are.
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
  DashboardThemeCopy.title,
  DashboardThemeCopy.description,
  DashboardThemeCopy.ariaLabel,
  DashboardThemeCopy.notFound,
  ...DASHBOARD_THEME_CHOICES.flatMap(
    (choice: DashboardThemeChoice): Array<string> => {
      return [choice.title, choice.description];
    },
  ),
];

describe("the card", () => {
  test("is called Theme, as on a status page's Branding page", () => {
    expect(DashboardThemeCopy.title).toBe("Theme");
    expect(DashboardThemeCopy.title).toBe(StatusPageThemeCopy.title);
  });

  test("says what it sets and, once, that every visitor can switch it from the toolbar", () => {
    expect(DashboardThemeCopy.description).toBe(
      "How your public dashboard looks to visitors. They can switch it from its toolbar.",
    );
    // One line, under the title: short, two sentences at most.
    expect(DashboardThemeCopy.description.length).toBeLessThanOrEqual(90);
    expect(DashboardThemeCopy.description.split(". ").length).toBe(2);
  });

  test("names its choices for a screen reader as the public dashboard's theme", () => {
    expect(DashboardThemeCopy.ariaLabel).toBe("Public dashboard theme");
  });

  test("has its own test ids", () => {
    expect(DASHBOARD_THEME_CARD_TEST_ID).toBe("dashboard-theme");
    expect(DASHBOARD_THEME_ERROR_TEST_ID).toBe("dashboard-theme-error");
    expect(
      DASHBOARD_THEMES.map((theme: DashboardTheme): string => {
        return getDashboardThemeChoiceTestId(theme);
      }),
    ).toEqual([
      "dashboard-theme-light",
      "dashboard-theme-dark",
      "dashboard-theme-system",
    ]);
  });
});

describe("the three choices", () => {
  test("are Light, Dark and the visitor's device, in that order, one per theme", () => {
    expect(
      DASHBOARD_THEME_CHOICES.map((choice: DashboardThemeChoice) => {
        return [choice.value, choice.title];
      }),
    ).toEqual([
      [DashboardTheme.Light, "Light"],
      [DashboardTheme.Dark, "Dark"],
      [DashboardTheme.System, "Match each visitor's device"],
    ]);

    expect(
      DASHBOARD_THEME_CHOICES.map((choice: DashboardThemeChoice) => {
        return choice.value;
      }),
    ).toEqual([...DASHBOARD_THEMES]);
  });

  test("are named as a status page's are, so each name is one translation", () => {
    expect(
      DASHBOARD_THEME_CHOICES.map((choice: DashboardThemeChoice) => {
        return choice.title;
      }),
    ).toEqual(
      STATUS_PAGE_THEME_CHOICES.map((choice: DashboardThemeChoice) => {
        return choice.title;
      }),
    );
  });

  test("each says what visitors see, in one short sentence", () => {
    expect(
      DASHBOARD_THEME_CHOICES.map((choice: DashboardThemeChoice) => {
        return choice.description;
      }),
    ).toEqual([
      "Visitors see the light dashboard.",
      "Visitors see the dark dashboard.",
      "Light or dark, as each visitor's device is set.",
    ]);

    for (const choice of DASHBOARD_THEME_CHOICES) {
      // A picture of the dashboard sits beside each one.
      expect(choice.description.length).toBeLessThanOrEqual(60);
      expect(choice.description.endsWith(".")).toBe(true);
      expect(choice.description.slice(0, -1)).not.toContain(". ");
    }
  });

  test("none repeats the toolbar switch the card already names, or asks anything of the logo", () => {
    for (const choice of DASHBOARD_THEME_CHOICES) {
      expect(choice.description.toLowerCase()).not.toContain("toolbar");
      expect(choice.description.toLowerCase()).not.toContain("switch");
      expect(choice.description.toLowerCase()).not.toContain("logo");
    }
  });
});

/*
 * The picture beside each choice (DashboardThemePreview) is drawn in the
 * public dashboard's own colours, with plain fills the dashboard's own dark
 * theme cannot remap.
 */
describe("the pictures beside the choices", () => {
  const palettes: {
    light: DashboardThemePreviewPalette;
    dark: DashboardThemePreviewPalette;
  } = getDashboardThemePreviewPalettes();

  const rgb: (color: string) => RGB = (color: string): RGB => {
    return parseColor(color)!;
  };

  const darkTokens: () => string = (): string => {
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

    return themeCss.slice(
      themeCss.indexOf("html.dark {"),
      themeCss.indexOf("}", themeCss.indexOf("html.dark {")),
    );
  };

  test("are the public dashboard's own grounds: the light page and the dark one", () => {
    expect(palettes.light.page).toBe(DASHBOARD_THEME_COLORS.light);
    expect(palettes.dark.page).toBe(DASHBOARD_THEME_COLORS.dark);
  });

  test("the dark picture's header and widgets are the dark theme's card, as Theme.css draws them", () => {
    expect(darkTokens()).toContain(
      `--ou-surface-primary: ${palettes.dark.card};`,
    );
    expect(palettes.dark.header).toBe(palettes.dark.card);
  });

  test("the dark picture's ground is the dark theme's page, as Theme.css draws it", () => {
    expect(darkTokens()).toContain(
      `--ou-background-primary: ${palettes.dark.page};`,
    );
  });

  test("every colour is a plain colour, never a class the dashboard's dark theme would remap", () => {
    for (const palette of [palettes.light, palettes.dark]) {
      for (const color of Object.values(palette)) {
        expect([color, parseColor(color) === null]).toEqual([color, false]);
      }
    }
  });

  test("a widget stands off the page, and its chart and value off the widget, in both pictures", () => {
    for (const palette of [palettes.light, palettes.dark]) {
      expect(palette.card).not.toBe(palette.page);
      expect(
        getContrastRatio(rgb(palette.series), rgb(palette.card)),
      ).toBeGreaterThanOrEqual(3);
      expect(
        getContrastRatio(rgb(palette.value), rgb(palette.card)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(palette.series).not.toBe(palette.secondSeries);
    }
  });

  test("the choice in force is framed in a colour that reads at 3:1 on the light dashboard and the dark one", () => {
    expect(
      getContrastRatio(
        rgb(PUBLIC_PAGE_THEME_PREVIEW_SELECTED_EDGE),
        rgb("#ffffff"),
      ),
    ).toBeGreaterThanOrEqual(3);
    expect(
      getContrastRatio(
        rgb(PUBLIC_PAGE_THEME_PREVIEW_SELECTED_EDGE),
        rgb(palettes.dark.card),
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
    "%s has its own words for every sentence",
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
        expect([sentence, String(translations[sentence]).trim()]).not.toEqual([
          sentence,
          "",
        ]);
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s says each choice about as shortly as the English, and Light and Dark apart",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const choice of DASHBOARD_THEME_CHOICES) {
        const translated: string = translations[choice.description] as string;

        expect([locale, choice.value, translated.length]).toEqual([
          locale,
          choice.value,
          Math.min(
            translated.length,
            Math.ceil(choice.description.length * 1.7),
          ),
        ]);
      }

      expect(
        new Set(
          DASHBOARD_THEME_CHOICES.map(
            (choice: DashboardThemeChoice): unknown => {
              return translations[choice.description];
            },
          ),
        ).size,
      ).toBe(3);
      expect(
        new Set(
          DASHBOARD_THEME_CHOICES.map(
            (choice: DashboardThemeChoice): unknown => {
              return translations[choice.title];
            },
          ),
        ).size,
      ).toBe(3);
    },
  );
});
