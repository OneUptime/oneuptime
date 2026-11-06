import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_PLATFORM_OPTIONS,
  getCloudSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudSetupGuide";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideStepVariant,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";
import {
  createTranslator,
  SentenceOptions,
  TemplateValues,
  Translator,
} from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE ENVIRONMENT GUIDE IN THE READER'S LANGUAGE (#6060, #5702's follow-up).
 *
 * The guide an environment links to - eight managed platforms, each with
 * its intro, its steps and their tabs, Advanced and Troubleshooting - is
 * worded by the reader's translator:
 *
 *   - every sentence goes through the translator: none is written in
 *     English past it, so a German reader meets no English sentence;
 *   - every sentence is a key of the locale files that each of the sixteen
 *     languages words, and so is every title, tab and summary the card
 *     words where it draws them, and each platform's line in the picker;
 *   - a translated guide keeps what is typed as it is typed: each command
 *     and configuration, each `code` span and each link;
 *   - without a translator it reads as en.json words it, which is the
 *     English it always had.
 */

const ONEUPTIME_URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const PLATFORMS: Array<ManagedCloudPlatform> = MANAGED_CLOUD_PLATFORMS.map(
  (descriptor: ManagedCloudPlatformDescriptor): ManagedCloudPlatform => {
    return descriptor.platform;
  },
);

// With a key picked, and before one is (the note that asks for one).
const API_KEYS: Array<string> = [KEY, SETUP_GUIDE_API_KEY_PLACEHOLDER];

const ENGLISH: Translator = createTranslator(undefined, "en");

// Marks every sentence a translator words; what is left unmarked the guide wrote past it.
const OPEN: string = "⟦";
const CLOSE: string = "⟧";
const MARKED: RegExp = /⟦[^⟦⟧]*⟧/g;
const FENCE: RegExp = /```[^\n]*\n[\s\S]*?```/g;
const CODE_SPAN: RegExp = /`[^`\n]+`/g;
const LINK_TARGET: RegExp = /\]\(([^)\s]+)\)/g;
const LETTER: RegExp = /\p{L}/u;

function markingTranslator(asked: Array<string>): Translator {
  return {
    ...ENGLISH,
    translateText: (text: string | undefined): string | undefined => {
      if (text === undefined) {
        return undefined;
      }
      asked.push(text);
      return `${OPEN}${ENGLISH.translateText(text) || text}${CLOSE}`;
    },
    translateTemplate: (
      template: string,
      values?: TemplateValues,
      options?: SentenceOptions,
    ): string => {
      asked.push(template);
      return `${OPEN}${ENGLISH.translateTemplate(template, values, options)}${CLOSE}`;
    },
  };
}

function guideOf(data: {
  platform: ManagedCloudPlatform;
  apiKey?: string | undefined;
  translator?: Translator | undefined;
}): SetupGuideContent {
  return getCloudSetupGuide({
    oneuptimeUrl: ONEUPTIME_URL,
    apiKey: data.apiKey || KEY,
    platform: data.platform,
    translator: data.translator,
  });
}

function topicsOf(content: SetupGuideContent): Array<SetupGuideTopic> {
  return [...(content.advanced || []), ...(content.troubleshooting || [])];
}

// What the guide words itself: the card draws each as it is given.
function guideWorded(content: SetupGuideContent): Array<string> {
  return [
    content.intro || "",
    ...(content.prerequisites || []),
    content.keyStep?.description || "",
    ...content.steps.flatMap((step: SetupGuideStep): Array<string> => {
      return [
        step.markdown || "",
        ...(step.variants || []).map(
          (variant: SetupGuideStepVariant): string => {
            return variant.markdown;
          },
        ),
        step.note || "",
        step.details || "",
      ];
    }),
    ...topicsOf(content).map((topic: SetupGuideTopic): string => {
      return topic.markdown;
    }),
  ].filter((text: string): boolean => {
    return text.length > 0;
  });
}

// What the card words where it draws it (SetupGuideCard's translate).
function cardWorded(content: SetupGuideContent): Array<string> {
  return [
    content.keyStep?.endpointLabel || "",
    ...content.steps.flatMap((step: SetupGuideStep): Array<string> => {
      return [
        step.title,
        step.description || "",
        ...(step.variants || []).map(
          (variant: SetupGuideStepVariant): string => {
            return variant.label;
          },
        ),
      ];
    }),
    ...topicsOf(content).flatMap((topic: SetupGuideTopic): Array<string> => {
      return [topic.title, topic.summary || ""];
    }),
    ...(content.links || []).map((link: { title: string }): string => {
      return link.title;
    }),
  ].filter((text: string): boolean => {
    return text.length > 0;
  });
}

// The prose of a worded text the translator did not word: commands, code and marked sentences taken out.
function unmarkedProse(text: string): string {
  let rest: string = text.replace(FENCE, " ");
  let previous: string = "";

  // A sentence can hold another (a value worded on its own): innermost first.
  while (rest !== previous) {
    previous = rest;
    rest = rest.replace(MARKED, " ");
  }

  return rest.replace(CODE_SPAN, " ").trim();
}

function codeSpansOf(texts: Array<string>): Array<string> {
  return texts
    .flatMap((text: string): Array<string> => {
      return text.replace(FENCE, " ").match(CODE_SPAN) || [];
    })
    .sort();
}

function linkTargetsOf(texts: Array<string>): Array<string> {
  return texts
    .flatMap((text: string): Array<string> => {
      return Array.from(text.matchAll(LINK_TARGET)).map(
        (match: RegExpMatchArray): string => {
          return match[1] || "";
        },
      );
    })
    .sort();
}

interface AskedWords {
  // Each sentence the guide had the translator word.
  sentences: Set<string>;
  // Each text the guide hands the card to word: a title, a tab, a summary.
  cardKeys: Set<string>;
}

// Everything the guides ask to be worded, for every platform, with a key and before one.
function askedWords(): AskedWords {
  const sentences: Set<string> = new Set<string>();
  const cardKeys: Set<string> = new Set<string>();

  for (const platform of PLATFORMS) {
    for (const apiKey of API_KEYS) {
      const asked: Array<string> = [];
      const content: SetupGuideContent = guideOf({
        platform,
        apiKey,
        translator: markingTranslator(asked),
      });

      for (const text of asked) {
        sentences.add(text);
      }

      // A text the guide worded already is marked; the rest the card words.
      for (const text of cardWorded(content)) {
        if (!text.includes(OPEN)) {
          cardKeys.add(text);
        }
      }
    }
  }

  return { sentences, cardKeys };
}

const ASKED: AskedWords = askedWords();

const PLATFORM_LINES: Array<string> = CLOUD_PLATFORM_OPTIONS.map(
  (option: SetupGuideOption): string => {
    return option.description || "";
  },
);

describe("every sentence of the guide goes through the reader's translator", () => {
  test.each(PLATFORMS)("%s writes none past it", (platform: string) => {
    for (const apiKey of API_KEYS) {
      const asked: Array<string> = [];
      const content: SetupGuideContent = guideOf({
        platform: platform as ManagedCloudPlatform,
        apiKey,
        translator: markingTranslator(asked),
      });

      const leftovers: Array<string> = guideWorded(content)
        .map(unmarkedProse)
        .filter((rest: string): boolean => {
          return LETTER.test(rest);
        });

      expect(leftovers).toEqual([]);
      // The intro, each step's text, Advanced and Troubleshooting.
      expect(asked.length).toBeGreaterThan(15);
    }
  });

  test("the note that asks for a key is a sentence too, and only until one is picked", () => {
    const pickNote: string =
      "Pick an ingestion key in step 1 to fill in `{{placeholder}}`.";

    for (const platform of PLATFORMS) {
      const withKey: Array<string> = [];
      const withoutKey: Array<string> = [];
      guideOf({
        platform,
        apiKey: KEY,
        translator: markingTranslator(withKey),
      });
      guideOf({
        platform,
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
        translator: markingTranslator(withoutKey),
      });

      expect(withKey).not.toContain(pickNote);
      expect(withoutKey).toContain(pickNote);
    }
  });
});

describe("every sentence is a key each language words", () => {
  test("the guides ask for their sentences, titles and tabs by the English of en.json", () => {
    const english: Record<string, string> = readDashboardLocale("en");
    const all: Array<string> = [
      ...Array.from(ASKED.sentences),
      ...Array.from(ASKED.cardKeys),
      ...PLATFORM_LINES,
    ];

    expect(ASKED.sentences.size).toBeGreaterThan(150);
    expect(ASKED.cardKeys.size).toBeGreaterThan(40);
    expect(PLATFORM_LINES).toHaveLength(PLATFORMS.length);
    // The tabs, the key picker's label and the docs link are among the card's.
    for (const key of [
      "Sidecar collector",
      "SDK direct",
      "OTLP Endpoint",
      "Cloud troubleshooting",
    ]) {
      expect(ASKED.cardKeys.has(key)).toBe(true);
    }
    expect(
      all.filter((key: string): boolean => {
        return english[key] !== key;
      }),
    ).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one of them",
    (language: string) => {
      const unworded: Array<string> = [
        ...Array.from(ASKED.sentences),
        ...Array.from(ASKED.cardKeys),
        ...PLATFORM_LINES,
      ].filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      });

      expect(unworded).toEqual([]);
    },
  );
});

describe("a translated guide keeps what is typed as it is typed", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps every command, code span and link",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const platform of PLATFORMS) {
        for (const apiKey of API_KEYS) {
          const english: SetupGuideContent = guideOf({ platform, apiKey });
          const read: SetupGuideContent = guideOf({
            platform,
            apiKey,
            translator,
          });
          const where: string = `${language} ${platform}`;

          // The same steps, tabs and topics, in the same order.
          expect([where, read.steps.length]).toEqual([
            where,
            english.steps.length,
          ]);
          expect([where, topicsOf(read).length]).toEqual([
            where,
            topicsOf(english).length,
          ]);
          expect([where, getSetupGuideCodeBlocks(read)]).toEqual([
            where,
            getSetupGuideCodeBlocks(english),
          ]);
          expect([where, codeSpansOf(guideWorded(read))]).toEqual([
            where,
            codeSpansOf(guideWorded(english)),
          ]);
          expect([where, linkTargetsOf(guideWorded(read))]).toEqual([
            where,
            linkTargetsOf(guideWorded(english)),
          ]);
        }
      }
    },
  );
});

describe("the guide in German", () => {
  const german: Translator = dashboardTranslator("de");
  const lastStep: string =
    "Then send one request: the environment appears at **App Platforms → All Environments** within a minute of the first span, log or metric.";

  test("says each step in German, not in English", () => {
    for (const platform of PLATFORMS) {
      const english: string = guideWorded(guideOf({ platform })).join("\n");
      const read: string = guideWorded(
        guideOf({ platform, translator: german }),
      ).join("\n");

      expect(english).toContain(lastStep);
      expect(read).not.toContain(lastStep);
      expect(read).toContain(german.translateText(lastStep)!);
      expect(german.translateText(lastStep)).toContain(
        "**App-Plattformen → Alle Umgebungen**",
      );
    }
  });

  test("the picker's line under each platform is German", () => {
    for (const line of PLATFORM_LINES) {
      expect(german.translateText(line)).not.toBe(line);
    }
    expect(german.translateText("Web apps on Azure App Service.")).toBe(
      "Web-Apps in Azure App Service.",
    );
  });
});

describe("without a translator", () => {
  test.each(PLATFORMS)("%s reads as en.json words it", (platform: string) => {
    for (const apiKey of API_KEYS) {
      expect(
        guideOf({ platform: platform as ManagedCloudPlatform, apiKey }),
      ).toEqual(
        guideOf({
          platform: platform as ManagedCloudPlatform,
          apiKey,
          translator: dashboardTranslator("en"),
        }),
      );
    }
  });
});
