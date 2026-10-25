import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import SecurityEventsHowItWorksCard from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsHowItWorksCard";
import DetectionRulesGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/DetectionRulesGuide";
import ThreatIntelGuide from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/ThreatIntelGuide";
import { getEntityRiskGuide } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/EntityRiskGuide";
import {
  SecurityEventsGuide,
  SecurityEventsGuideLevel,
  SecurityEventsGuideSection,
  SecurityEventsGuideStep,
  SecurityEventsGuideTemplate,
  fillGuideTemplate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide";
import { SECURITY_EVENTS_GUIDE_TITLES } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuideCopy";
import {
  DETECTION_RULE_TYPE_DESCRIPTIONS,
  DETECTION_RULE_TYPE_TITLES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/DetectionRuleShape";
import {
  Translator,
  fillTemplate,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The How it works card heads Detection Rules and Threat Intel. Its words
 * were en.json keys, translated, yet the card drew them in English in every
 * language: a German reader met an English card on a German page. Now
 * everything it draws of its own is looked up - the title and summary, each
 * step (a sentence with numbers in it as a template, the numbers written the
 * reader's way), the levels and their link, the buttons, and the full
 * guide's title, description and tab names. The values come from the
 * shipped locale files, so a sentence a language has not translated yet is
 * expected in English, and one it has, in its own words.
 *
 * What stays as written: a Sigma level (`high`), which is what a rule's YAML
 * says, and the guide's markdown, which is the documentation.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): React.ReactElement => {
      return React.createElement("div", {}, props.text);
    },
  };
});

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.replace(".json", "");
  })
  .sort();

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const GUIDES: Array<[string, SecurityEventsGuide]> = [
  ["Detection Rules", DetectionRulesGuide],
  ["Threat Intel", ThreatIntelGuide],
  // Worked out for a project's threshold: a new project's here.
  ["Entity Risk", getEntityRiskGuide(100)],
];

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function renderIn(
  language: string,
  guide: SecurityEventsGuide,
): Promise<HTMLElement> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });

  const { container } = render(<SecurityEventsHowItWorksCard guide={guide} />);

  return container;
}

/*
 * Any run of white space as one space, as toHaveTextContent reads the page:
 * French writes 1 440 with a narrow no-break space.
 */
const WHITE_SPACE: RegExp = /\s+/g;

function oneSpace(text: string): string {
  return text.replace(WHITE_SPACE, " ");
}

// A key as the language says it: its own words, or English while it has none.
function said(locale: Record<string, string>, key: string): string {
  return locale[key] || key;
}

// A template as the language says it, its numbers written the reader's way.
function saidTemplate(
  locale: Record<string, string>,
  guideTemplate: SecurityEventsGuideTemplate,
): string {
  const translator: Translator = getGlobalTranslator();
  const values: Record<string, string> = {};

  for (const [name, value] of Object.entries(guideTemplate.values)) {
    values[name] = translator.formatNumber(value);
  }

  return oneSpace(fillTemplate(said(locale, guideTemplate.sentence), values));
}

// Every key the card draws of its own for a guide: its words, and the card's.
function drawnKeys(guide: SecurityEventsGuide): Array<string> {
  return [
    guide.title,
    guide.summary,
    guide.levels.title,
    guide.levels.description,
    guide.levels.linkText,
    guide.guideTitle,
    guide.guideDescription,
    ...guide.sections.map((section: SecurityEventsGuideSection) => {
      return section.title;
    }),
    ...guide.steps.flatMap((step: SecurityEventsGuideStep) => {
      return [
        step.title,
        step.descriptionTemplate
          ? step.descriptionTemplate.sentence
          : step.description,
      ];
    }),
    ...guide.levels.items
      .filter((level: SecurityEventsGuideLevel): boolean => {
        return !level.isLabelAValue;
      })
      .map((level: SecurityEventsGuideLevel): string => {
        return level.labelTemplate ? level.labelTemplate.sentence : level.label;
      }),
    "Step {{number}}",
    "Read the full guide",
    "Hide",
    "Show",
    "Full documentation",
  ];
}

function stepText(
  locale: Record<string, string>,
  step: SecurityEventsGuideStep,
): string {
  return step.descriptionTemplate
    ? saidTemplate(locale, step.descriptionTemplate)
    : said(locale, step.description);
}

function levelText(
  locale: Record<string, string>,
  level: SecurityEventsGuideLevel,
): string {
  if (level.labelTemplate) {
    return saidTemplate(locale, level.labelTemplate);
  }

  return level.isLabelAValue ? level.label : said(locale, level.label);
}

describe("the How it works card in every language", () => {
  test("ships for every Dashboard language", () => {
    expect(LANGUAGES).toHaveLength(17);
  });

  for (const [name, guide] of GUIDES) {
    test.each(LANGUAGES)(
      `${name}, %s: everything the card draws of its own is looked up`,
      async (language: string) => {
        const locale: Record<string, string> = readLocale(language);
        const card: HTMLElement = await renderIn(language, guide);

        expect(
          within(card).getByRole("heading", { level: 2 }),
        ).toHaveTextContent(said(locale, guide.title));
        expect(card).toHaveTextContent(said(locale, guide.summary));

        const steps: Array<HTMLElement> =
          within(card).getAllByTestId("how-it-works-step");

        expect(steps).toHaveLength(guide.steps.length);

        guide.steps.forEach((step: SecurityEventsGuideStep, index: number) => {
          const shown: HTMLElement = steps[index]!;

          expect(shown).toHaveTextContent(
            fillTemplate(said(locale, "Step {{number}}"), {
              number: getGlobalTranslator().formatNumber(index + 1),
            }),
          );
          expect(within(shown).getByRole("heading")).toHaveTextContent(
            said(locale, step.title),
          );
          expect(shown).toHaveTextContent(stepText(locale, step));
        });

        expect(card).toHaveTextContent(said(locale, guide.levels.title));
        expect(card).toHaveTextContent(said(locale, guide.levels.description));
        expect(
          within(card).getByTestId("how-it-works-levels-link"),
        ).toHaveTextContent(said(locale, guide.levels.linkText));

        const levels: Array<HTMLElement> =
          within(card).getAllByTestId("how-it-works-level");

        guide.levels.items.forEach(
          (level: SecurityEventsGuideLevel, index: number) => {
            expect(levels[index]!).toHaveTextContent(levelText(locale, level));
          },
        );

        expect(
          within(card).getByTestId("how-it-works-open-guide"),
        ).toHaveTextContent(said(locale, "Read the full guide"));
        expect(
          within(card).getByTestId("how-it-works-toggle"),
        ).toHaveTextContent(said(locale, "Hide"));
      },
    );

    test.each(LANGUAGES)(
      `${name}, %s: the full guide's title, description and tabs are looked up too`,
      async (language: string) => {
        const locale: Record<string, string> = readLocale(language);
        const card: HTMLElement = await renderIn(language, guide);

        await act(async () => {
          fireEvent.click(within(card).getByTestId("how-it-works-open-guide"));
        });

        const dialog: HTMLElement = screen.getByRole("dialog");

        expect(dialog).toHaveTextContent(said(locale, guide.guideTitle));
        expect(dialog).toHaveTextContent(said(locale, guide.guideDescription));
        expect(dialog).toHaveTextContent(said(locale, "Full documentation"));

        for (const section of guide.sections) {
          expect([section.id, dialog.textContent]).toEqual([
            section.id,
            expect.stringContaining(said(locale, section.title)),
          ]);
        }

        // The first tab is open: its markdown, the documentation, as written.
        const first: SecurityEventsGuideSection = guide.sections[0]!;

        expect(
          within(dialog).getByTestId(`how-it-works-section-${first.id}`),
        ).toHaveTextContent(first.markdown.trim().slice(0, 40));
      },
    );
  }

  /*
   * The Type column names every rule's kind, side by side: Sequence and
   * First seen kept English beside a translated Single event until they
   * were translated too.
   */
  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s: every rule kind and what it means is in the language",
    (language: string) => {
      const english: Record<string, string> = readLocale("en");
      const locale: Record<string, string> = readLocale(language);

      for (const key of [
        ...Object.values(DETECTION_RULE_TYPE_TITLES),
        ...Object.values(DETECTION_RULE_TYPE_DESCRIPTIONS),
      ]) {
        expect({ key, translated: locale[key] !== english[key] }).toEqual({
          key,
          translated: true,
        });
      }
    },
  );

  test("in German, a numbered sentence writes its numbers the German way", async () => {
    const card: HTMLElement = await renderIn("de", ThreatIntelGuide);
    const first: HTMLElement =
      within(card).getAllByTestId("how-it-works-step")[0]!;

    expect(first).toHaveTextContent("1.440");
    expect(first).toHaveTextContent("Schritt 1");
    expect(first).not.toHaveTextContent("Every");
    expect(
      within(card).getAllByTestId("how-it-works-level")[0]!,
    ).toHaveTextContent("Konfidenz 90–100");
  });

  test("a Sigma level is drawn as a rule writes it, in every language", async () => {
    const card: HTMLElement = await renderIn("de", DetectionRulesGuide);

    expect(
      within(card)
        .getAllByTestId("how-it-works-level")
        .map((level: HTMLElement): string => {
          return level.querySelector("span")?.textContent || "";
        }),
    ).toEqual(
      DetectionRulesGuide.levels.items.map(
        (level: SecurityEventsGuideLevel): string => {
          return level.label;
        },
      ),
    );
  });

  // The Copy file only marks the guides' own titles for the locale files.
  test("the guides' titles and lines are marked for translation word for word", () => {
    expect(
      GUIDES.map(([, guide]: [string, SecurityEventsGuide]) => {
        return [guide.id, SECURITY_EVENTS_GUIDE_TITLES[guide.id]];
      }),
    ).toEqual(
      GUIDES.map(([, guide]: [string, SecurityEventsGuide]) => {
        return [
          guide.id,
          { title: guide.guideTitle, description: guide.guideDescription },
        ];
      }),
    );
    expect(Object.keys(SECURITY_EVENTS_GUIDE_TITLES)).toHaveLength(
      GUIDES.length,
    );
  });

  test("the card's English is the guide's English: a template filled in is the sentence the help modal and docs read", () => {
    for (const [, guide] of GUIDES) {
      for (const step of guide.steps) {
        if (step.descriptionTemplate) {
          expect(fillGuideTemplate(step.descriptionTemplate)).toBe(
            step.description,
          );
        }
      }

      for (const level of guide.levels.items) {
        if (level.labelTemplate) {
          expect(fillGuideTemplate(level.labelTemplate)).toBe(level.label);
        }
      }
    }

    // Every template and fixed string the card draws is an en.json key.
    const english: Record<string, string> = readLocale("en");

    for (const [, guide] of GUIDES) {
      for (const key of drawnKeys(guide)) {
        expect([key, english[key]]).toEqual([key, key]);
      }
    }
  });

  /*
   * A card half in one language and half in English reads worse than one
   * in English: every language has all of it.
   */
  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )("%s: no word the cards draw is left in English", (language: string) => {
    const english: Record<string, string> = readLocale("en");
    const locale: Record<string, string> = readLocale(language);

    for (const [, guide] of GUIDES) {
      for (const key of drawnKeys(guide)) {
        expect({ key, translated: locale[key] !== english[key] }).toEqual({
          key,
          translated: true,
        });
      }
    }
  });
});
