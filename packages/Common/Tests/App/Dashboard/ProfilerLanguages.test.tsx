import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as fs from "fs";
import { createInstance, i18n } from "i18next";
import * as path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import * as ProfileMonitorCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProfileMonitor/ProfileMonitorCopy";
import * as ProfileCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileCopy";
import * as TraceProfilerLinkCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceProfilerLinkCopy";
import {
  COMPARED_WITH,
  FIX_GREW_SENTENCE,
  FIX_HOT_SENTENCE,
  HEADLINE_LEADER,
  HEADLINE_LEADER_ALL,
  HEADLINE_NO_DATA,
  HEADLINE_SLOWER,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileCopy";
import ProfileHeadline, {
  ProfileHeadlineComparison,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileHeadline";
import {
  formatAgo,
  formatWindow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTimeText";
import danishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/da.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import spanishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/es.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import frenchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fr.json";
import hindiLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/hi.json";
import italianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/it.json";
import japaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import koreanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ko.json";
import dutchLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/nl.json";
import norwegianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/no.json";
import portugueseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/pt.json";
import russianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ru.json";
import swedishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/sv.json";
import chineseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/zh-CN.json";
import taiwaneseLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/zh-TW.json";
import {
  PROFILE_MONITOR_DESCRIPTION,
  PROFILE_MONITOR_NAME,
  PROFILE_MONITOR_UNHEALTHY_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProfileMonitorPrefill";
import {
  PROFILE_KIND_DESCRIPTIONS,
  PROFILE_KIND_LABELS,
  PROFILE_KIND_NOUNS,
  ProfileFunctionRow,
  ProfileHeadlineFacts,
  ProfileKindChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProfilesView";
import { ProfilesCompareMode } from "../../../../App/FeatureSet/Dashboard/src/Utils/ProfilesUrlState";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  ProfileChangeDirection,
  ProfileFunctionChange,
} from "../../../Utils/Profiles/ProfileComparison";
import {
  ProfileCategory,
  ProfileValueUnit,
} from "../../../Utils/Profiles/ProfileTypes";

/*
 * The Profiler in other languages, read from the real locale files.
 *
 * Its headline is a sentence with the kind of profile in the middle of it
 * ("JSON.parse takes 42% of the CPU time in checkout"). The kind is cased
 * the way the reader's language writes a word there: lowercase in every
 * language but German, so a translation that opened with the kind would
 * open with a small letter. The last block keeps every such sentence, in
 * every locale, from starting with it.
 */

type LocaleFile = Record<string, string>;

const LOCALES: Record<string, LocaleFile> = {
  de: germanLocale as unknown as LocaleFile,
  fr: frenchLocale as unknown as LocaleFile,
  es: spanishLocale as unknown as LocaleFile,
  it: italianLocale as unknown as LocaleFile,
  pt: portugueseLocale as unknown as LocaleFile,
  nl: dutchLocale as unknown as LocaleFile,
  da: danishLocale as unknown as LocaleFile,
  no: norwegianLocale as unknown as LocaleFile,
  sv: swedishLocale as unknown as LocaleFile,
  ru: russianLocale as unknown as LocaleFile,
  ja: japaneseLocale as unknown as LocaleFile,
  ko: koreanLocale as unknown as LocaleFile,
  "zh-CN": chineseLocale as unknown as LocaleFile,
  "zh-TW": taiwaneseLocale as unknown as LocaleFile,
  hi: hindiLocale as unknown as LocaleFile,
  fa: persianLocale as unknown as LocaleFile,
};

const NOW: Date = new Date("2026-10-20T12:00:00.000Z");

function instanceFor(language: string): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      [language]: { translation: LOCALES[language] as LocaleFile },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  return instance;
}

function translatorFor(language: string): Translator {
  const locale: LocaleFile = LOCALES[language] as LocaleFile;

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

function kindChoice(category: ProfileCategory): ProfileKindChoice {
  return {
    selection: category,
    category: category,
    queryTypes: category === ProfileCategory.Memory ? ["inuse_space"] : ["cpu"],
    unit:
      category === ProfileCategory.Memory
        ? ProfileValueUnit.Bytes
        : ProfileValueUnit.Nanoseconds,
    sampleCount: 12000,
    isRawType: false,
  };
}

function row(functionName: string, frameType: string): ProfileFunctionRow {
  return {
    functionName,
    fileName: functionName === "parseOrder" ? "src/orders/parse.ts" : "",
    lineNumber: 0,
    frameType,
    selfValue: 4200,
    totalValue: 6000,
    sampleCount: 4200,
    ownValue: frameType === "own" ? 4200 : 0,
  };
}

const FACTS: ProfileHeadlineFacts = {
  leader: row("JSON.parse", "runtime"),
  leaderShare: 42,
  topThreeShare: 68,
  topThreeCount: 3,
  topOwn: row("parseOrder", "own"),
  topOwnShare: 42,
};

function change(before: number, after: number): ProfileFunctionChange {
  const share: (value: number) => ProfileFunctionChange["before"] = (
    value: number,
  ): ProfileFunctionChange["before"] => {
    return {
      selfValue: value,
      totalValue: value,
      sampleCount: value,
      selfShare: value,
      totalShare: value,
      ownValue: value,
      ownShare: value,
    };
  };

  return {
    functionName: "parseOrder",
    fileName: "src/orders/parse.ts",
    lineNumber: 0,
    frameType: "own",
    before: share(before),
    after: share(after),
    selfShareChange: after - before,
    totalShareChange: after - before,
    ownShareChange: after - before,
    direction: ProfileChangeDirection.Slower,
  };
}

function renderHeadline(data: {
  language: string;
  category?: ProfileCategory | undefined;
  serviceName?: string | null | undefined;
  facts?: ProfileHeadlineFacts | null | undefined;
  comparison?: ProfileHeadlineComparison | undefined;
}): void {
  const translator: Translator = translatorFor(data.language);

  render(
    <I18nextProvider i18n={instanceFor(data.language)}>
      <ProfileHeadline
        serviceName={
          data.serviceName === undefined ? "checkout" : data.serviceName
        }
        kind={kindChoice(data.category || ProfileCategory.Cpu)}
        windowText={formatWindow({
          startTime: new Date(NOW.getTime() - 60 * 60 * 1000),
          endTime: NOW,
          isCustom: false,
          translator,
        })}
        isLoading={false}
        facts={data.facts === undefined ? FACTS : data.facts}
        comparison={data.comparison}
        onOpenFunction={() => {}}
      />
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("the headline, as whole sentences", () => {
  test("German: where the time goes, the top three, the own code and the window", () => {
    renderHeadline({ language: "de" });

    expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
      "Bei checkout entfielen 42% der CPU-Zeit auf JSON.parse. Die 3 größten Funktionen beanspruchen 68%.",
    );
    expect(screen.getByTestId("profiles-headline-own")).toHaveTextContent(
      "In Ihrem eigenen Code beansprucht parseOrder am meisten: 42%, mit dem Bibliotheks- und Laufzeitcode, den sie aufruft.",
    );
    expect(screen.getByTestId("profiles-headline-window")).toHaveTextContent(
      "Die letzte Stunde",
    );
  });

  test("Russian and Danish: the kind in the middle of the sentence, lowercase, never opening it", () => {
    renderHeadline({ language: "ru" });

    expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
      "В checkout на JSON.parse приходится 42% по метрике «время CPU».",
    );
    expect(screen.getByTestId("profiles-headline-window")).toHaveTextContent(
      "Последний час",
    );
    cleanup();

    renderHeadline({
      language: "da",
      category: ProfileCategory.Memory,
      serviceName: null,
    });

    expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
      "I dine tjenester gik 42% af hukommelse til JSON.parse.",
    );
  });

  test("Japanese, and French comparing with the period before", () => {
    renderHeadline({ language: "ja" });

    expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
      "checkout の CPU 時間 の 42% が JSON.parse で使われました。",
    );
    cleanup();

    const french: Translator = translatorFor("fr");

    renderHeadline({
      language: "fr",
      comparison: {
        notable: change(10, 45),
        ownGrowth: null,
        isFooted: true,
        againstText:
          french.translateText(COMPARED_WITH[ProfilesCompareMode.Previous]) ||
          "",
      },
    });

    expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
      "parseOrder est passée de 10% à 45% du total en temps CPU. Comparé à la période précédente.",
    );
  });

  test("a window with nothing in it names the kind in the reader's language", () => {
    renderHeadline({
      language: "es",
      category: ProfileCategory.Memory,
      facts: null,
    });

    expect(screen.getByTestId("profiles-headline-text")).toHaveTextContent(
      "No hay perfiles de memoria en este intervalo.",
    );
  });
});

describe("windows and deploy times", () => {
  test("a preset window is a whole phrase; any other is the last so long", () => {
    const thirtyMinutes: { startTime: Date; endTime: Date; isCustom: boolean } =
      {
        startTime: new Date(NOW.getTime() - 30 * 60 * 1000),
        endTime: NOW,
        isCustom: false,
      };

    expect(
      formatWindow({
        startTime: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
        endTime: NOW,
        isCustom: false,
        translator: translatorFor("de"),
      }),
    ).toBe("die letzten 7 Tage");
    expect(
      formatWindow({ ...thirtyMinutes, translator: translatorFor("de") }),
    ).toBe("die letzten 30 Minuten");
    expect(
      formatWindow({ ...thirtyMinutes, translator: translatorFor("ru") }),
    ).toBe("последние 30 минут");
    expect(
      formatWindow({ ...thirtyMinutes, translator: translatorFor("nl") }),
    ).toBe("de afgelopen 30 minuten");
  });

  test("a deploy's time, as long ago as it was", () => {
    const fortyMinutesAgo: Date = new Date(NOW.getTime() - 40 * 60 * 1000);

    expect(
      formatAgo({
        time: fortyMinutesAgo,
        now: NOW,
        translator: translatorFor("fr"),
      }),
    ).toBe("il y a 40 minutes");
    expect(
      formatAgo({
        time: fortyMinutesAgo,
        now: NOW,
        translator: translatorFor("ru"),
      }),
    ).toBe("40 минут назад");
    expect(
      formatAgo({
        time: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000),
        now: NOW,
        translator: translatorFor("de"),
      }),
    ).toBe("2 Tage her");
  });
});

describe("every locale", () => {
  // The sentences the kind of profile is filled into.
  const SENTENCES_WITH_THE_KIND: Array<string> = [
    HEADLINE_LEADER,
    HEADLINE_LEADER_ALL,
    HEADLINE_SLOWER,
    HEADLINE_NO_DATA,
    FIX_HOT_SENTENCE,
    FIX_GREW_SENTENCE,
    PROFILE_MONITOR_NAME,
    PROFILE_MONITOR_DESCRIPTION,
    PROFILE_MONITOR_UNHEALTHY_DESCRIPTION,
    ProfileMonitorCopy.PROFILE_MONITOR_PREVIEW_SHARE,
  ];

  test.each(Object.keys(LOCALES))(
    "%s: translates the Profiler's sentences with the kind, and none starts with it",
    (language: string) => {
      const locale: LocaleFile = LOCALES[language] as LocaleFile;

      for (const sentence of SENTENCES_WITH_THE_KIND) {
        const translated: string | undefined = locale[sentence];

        expect(translated).toBeDefined();
        expect(translated).not.toBe(sentence);
        expect(translated).toContain("{{kind}}");
        expect((translated as string).trimStart().startsWith("{{kind}}")).toBe(
          false,
        );
      }
    },
  );
});

/*
 * Every word the Profiler draws, in every locale.
 *
 * The function list's four empty states were once handed to the
 * translator as variables, so the extractor never saw them and every
 * language showed them in English. Each word now lives in a copy module;
 * this reads those modules and holds every locale to having each word,
 * translated - or recorded as reading the same in that language (Total
 * in French, System in Danish), the way the i18n tool records it.
 */
describe("every word of the Profiler", () => {
  const I18N_DIRECTORY: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/i18n",
  );
  const PLACEHOLDER: RegExp = /\{\{[^{}]*\}\}/g;
  const LETTER: RegExp = /\p{L}/u;

  const readJson: (file: string) => unknown = (file: string): unknown => {
    return JSON.parse(fs.readFileSync(path.join(I18N_DIRECTORY, file), "utf8"));
  };

  const GLOBAL_SAME: Set<string> = new Set(
    readJson("SameAsEnglish.json") as Array<string>,
  );

  // A copy module's words: its strings, and a plural's general sentence.
  const collect: (value: unknown, into: Set<string>) => void = (
    value: unknown,
    into: Set<string>,
  ): void => {
    if (typeof value === "string") {
      into.add(value);
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    if (
      typeof record["one"] === "string" &&
      typeof record["other"] === "string"
    ) {
      into.add(record["other"]);
      return;
    }

    for (const nested of Object.values(record)) {
      collect(nested, into);
    }
  };

  const WORDS: Array<string> = ((): Array<string> => {
    const words: Set<string> = new Set();

    for (const source of [
      ProfileCopy,
      ProfileMonitorCopy,
      TraceProfilerLinkCopy,
      { PROFILE_KIND_LABELS, PROFILE_KIND_DESCRIPTIONS, PROFILE_KIND_NOUNS },
    ]) {
      collect(source, words);
    }

    // "{{type}} ({{kind}})" has no word of its own to translate.
    return Array.from(words).filter((word: string): boolean => {
      return LETTER.test(word.replace(PLACEHOLDER, ""));
    });
  })();

  test("the copy modules are read, the list's empty states among them", () => {
    expect(WORDS.length).toBeGreaterThan(100);
    expect(WORDS).toEqual(
      expect.arrayContaining([
        ProfileCopy.FUNCTIONS_EMPTY,
        ProfileCopy.FUNCTIONS_OWN_EMPTY,
        ProfileCopy.CHANGES_EMPTY,
        ProfileCopy.CHANGES_OWN_EMPTY,
        ProfileCopy.HEADLINE_LEADER,
        ProfileMonitorCopy.PROFILE_MONITOR_PREVIEW_SHARE,
        TraceProfilerLinkCopy.TRACE_PROFILER_LINK_NAMED,
        "Show {{count}} kernel threads",
      ]),
    );
  });

  test.each(Object.keys(LOCALES))(
    "%s: has every one, translated or recorded as reading the same",
    (language: string) => {
      const locale: LocaleFile = LOCALES[language] as LocaleFile;
      const progress: { sameAsEnglish?: Array<string> } = readJson(
        `Progress/${language}.json`,
      ) as { sameAsEnglish?: Array<string> };
      const same: Set<string> = new Set(progress.sameAsEnglish || []);

      const untranslated: Array<string> = WORDS.filter(
        (word: string): boolean => {
          const value: string | undefined = locale[word];

          return (
            value === undefined ||
            (value === word && !same.has(word) && !GLOBAL_SAME.has(word))
          );
        },
      );

      expect(untranslated).toEqual([]);
    },
  );
});
