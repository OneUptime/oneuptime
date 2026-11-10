import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "Common/Types/ReadingDirection";
import { createTranslator, Translator } from "Common/Types/Translator";
import { getNavigatorCountTooltip } from "Common/UI/Components/StatusPage/ResourceGroupNavigatorText";
import { formatErrorBudgetRemainingOfTotal } from "Common/Utils/Slo/SloDuration";
import { getSloBudgetRemainingText } from "Common/Utils/Slo/SloOverviewText";
import {
  getRollingWindowFill,
  getSliDeltaText,
  getSloBudgetRunway,
  SloBudgetRunway,
  SloBudgetRunwayData,
  SloBudgetRunwayKind,
  SloRollingWindowFill,
} from "Common/Utils/Slo/SloProjection";
import {
  SLO_METRICS_TAB_KEYS,
  SloMetricsTab,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloMetricsQueryConfig";
import {
  getErrorBudgetRemainingOfTotalInLanguage,
  getRollingWindowFillTextInLanguage,
  getSliDeltaTextInLanguage,
  getSloBudgetRemainingTextInLanguage,
  getSloBudgetRunwayTextInLanguage,
  SloBudgetRunwayText,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloOverviewTextInLanguage";
import {
  getResourcePanelSubtitle,
  gridAxisNameInSentence,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageResourcePanelText";

/*
 * THE SLO KPI STRIP, THE STATUS PAGE RESOURCES PANE AND THE TOPOLOGY'S
 * FIXED WORDS, in the reader's language (#6658, UI review of #6680).
 *
 * The KPI strip read Common/Utils/Slo's English straight onto the page -
 * "0.026 pp below the 99.9% target", "12m left of 43m", "~1d 17h", "Window
 * 25% full" - so a German or an Arabic overview showed English (and, in
 * Arabic, English with its numbers flung to the wrong end). The pane's
 * "3 resources · 2 sub groups" was English too, and a grid axis was
 * lower-cased whatever the language ("rechenzentrum auswählen").
 *
 * Each helper reads, without a translator, exactly as the English it
 * replaced - pinned here against the Common helpers themselves.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

const LOCALE_WORDS: Map<string, Record<string, string>> = new Map<
  string,
  Record<string, string>
>();

function localeWords(language: string): Record<string, string> {
  if (!LOCALE_WORDS.has(language)) {
    LOCALE_WORDS.set(
      language,
      JSON.parse(
        fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
      ) as Record<string, string>,
    );
  }

  return LOCALE_WORDS.get(language) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const words: Record<string, string> = localeWords(language);

  return createTranslator((text: string): string | undefined => {
    return words[text];
  }, language);
}

const ENGLISH_LOCALE: Record<string, string> = localeWords("en");
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  });

const DE: Translator = translatorFor("de");
const AR: Translator = translatorFor("ar");
const JA: Translator = translatorFor("ja");

// A translator that words nothing: every sentence reads as the English.
const NOTHING_WORDED: Translator = createTranslator((): undefined => {
  return undefined;
}, "de");

const ISOLATE_MARKS: RegExp = new RegExp(
  `[${FIRST_STRONG_ISOLATE}${POP_DIRECTIONAL_ISOLATE}]`,
  "g",
);

// Latin letters outside the placeholders' values: English left in a sentence.
function englishWordsIn(text: string, allowed: Array<string>): Array<string> {
  let rest: string = text;

  for (const word of allowed) {
    rest = rest.split(word).join(" ");
  }

  return rest.match(/[A-Za-z]{3,}/g) || [];
}

const SLI_INPUTS: Array<{
  currentSliPercentage: number | null | undefined;
  targetPercentage: number | null | undefined;
}> = [
  { currentSliPercentage: 99.95, targetPercentage: 99.9 },
  { currentSliPercentage: 99.874, targetPercentage: 99.9 },
  { currentSliPercentage: 99.9, targetPercentage: 99.9 },
  { currentSliPercentage: 99.90001, targetPercentage: 99.9 },
  { currentSliPercentage: 99.89999, targetPercentage: 99.9 },
  { currentSliPercentage: 100, targetPercentage: 95 },
  { currentSliPercentage: 0, targetPercentage: 99.999 },
  { currentSliPercentage: 99.9994, targetPercentage: 99.9995 },
  { currentSliPercentage: null, targetPercentage: 99.9 },
  { currentSliPercentage: 99.9, targetPercentage: undefined },
  { currentSliPercentage: Number.NaN, targetPercentage: 99.9 },
];

const BUDGET_INPUTS: Array<{
  remainingSeconds: number | null | undefined;
  totalSeconds: number | null | undefined;
}> = [
  { remainingSeconds: 750, totalSeconds: 2592 },
  { remainingSeconds: 0, totalSeconds: 2592 },
  { remainingSeconds: -300, totalSeconds: 2592 },
  { remainingSeconds: -0.4, totalSeconds: 2592 },
  { remainingSeconds: 0.3, totalSeconds: 2592 },
  { remainingSeconds: 0.3, totalSeconds: 0.6 },
  { remainingSeconds: 200000, totalSeconds: 259200 },
  { remainingSeconds: 750, totalSeconds: 0 },
  { remainingSeconds: -750, totalSeconds: null },
  { remainingSeconds: 750, totalSeconds: undefined },
  { remainingSeconds: null, totalSeconds: 2592 },
  { remainingSeconds: undefined, totalSeconds: undefined },
  { remainingSeconds: Number.NaN, totalSeconds: 2592 },
];

const NOW: Date = new Date("2026-11-10T12:00:00.000Z");

// One input for each answer getSloBudgetRunway gives, both kinds of window.
const RUNWAY_INPUTS: Array<SloBudgetRunwayData> = [
  // Not evaluated
  { now: NOW, errorBudgetRemainingSeconds: null, currentBurnRate: 1 },
  { now: NOW, errorBudgetRemainingSeconds: 100, currentBurnRate: undefined },
  // Not projected: averaged across monitors, and a target with no budget
  {
    now: NOW,
    errorBudgetRemainingSeconds: 100,
    currentBurnRate: 1,
    multiMonitorMode: SloMultiMonitorMode.MonitorSecondsAverage,
  },
  {
    now: NOW,
    errorBudgetRemainingSeconds: 100,
    currentBurnRate: 1,
    targetPercentage: 100,
  },
  // Overspent, rolling and calendar month, over and exactly spent
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: -300,
    currentBurnRate: 4,
  },
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 0,
    currentBurnRate: 4,
  },
  {
    now: NOW,
    windowType: SloWindowType.CalendarMonth,
    timezone: "Europe/Berlin",
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: -5000,
    currentBurnRate: 2,
  },
  // Not burning
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 2000,
    currentBurnRate: 0,
  },
  {
    now: NOW,
    windowType: SloWindowType.CalendarMonth,
    timezone: "UTC",
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 2000,
    currentBurnRate: 0,
  },
  // Lasts until reset
  {
    now: NOW,
    windowType: SloWindowType.CalendarMonth,
    timezone: "UTC",
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 2000,
    currentBurnRate: 0.1,
  },
  // Sustainable, a 30-day and a 1-day window
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 2592,
    currentBurnRate: 1,
  },
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 1,
    targetPercentage: 99,
    errorBudgetRemainingSeconds: 864,
    currentBurnRate: 0.5,
  },
  // Runs out: in days, in minutes, under a minute, and before a month's reset
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 2000,
    currentBurnRate: 14.4,
  },
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 1,
    currentBurnRate: 2,
  },
  {
    now: NOW,
    windowType: SloWindowType.Rolling,
    windowDays: 30,
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 0.01,
    currentBurnRate: 2,
  },
  {
    now: NOW,
    windowType: SloWindowType.CalendarMonth,
    timezone: "UTC",
    targetPercentage: 99.9,
    errorBudgetRemainingSeconds: 2000,
    currentBurnRate: 30,
  },
];

function runwayText(
  data: SloBudgetRunwayData,
  translator?: Translator,
): { runway: SloBudgetRunway; text: SloBudgetRunwayText } {
  const runway: SloBudgetRunway = getSloBudgetRunway(data);

  return {
    runway: runway,
    text: getSloBudgetRunwayTextInLanguage(
      {
        runway: runway,
        errorBudgetRemainingSeconds: data.errorBudgetRemainingSeconds,
        windowDays: data.windowDays,
      },
      translator,
    ),
  };
}

describe("the KPI strip's words without a translator read as Common's English", () => {
  test("the SLI against its target, for every side of the target", () => {
    for (const input of SLI_INPUTS) {
      expect({ input, text: getSliDeltaTextInLanguage(input) }).toEqual({
        input,
        text: getSliDeltaText(input),
      });
    }
  });

  test("the error budget left of its total, spent, overspent and under a second", () => {
    for (const input of BUDGET_INPUTS) {
      expect({
        input,
        text: getErrorBudgetRemainingOfTotalInLanguage(input),
      }).toEqual({ input, text: formatErrorBudgetRemainingOfTotal(input) });
    }
  });

  test("the budget's headline: a percentage as it is, a spent budget's words", () => {
    for (const percentage of [42.5, 0.05, 0, -3, null, undefined, 150]) {
      const english: string | null = getSloBudgetRemainingText(percentage);

      expect(getSloBudgetRemainingTextInLanguage(english)).toBe(english);
    }

    expect(getSloBudgetRemainingTextInLanguage(null)).toBeNull();
  });

  test("the runway, for every answer getSloBudgetRunway gives", () => {
    const kinds: Set<SloBudgetRunwayKind> = new Set<SloBudgetRunwayKind>();

    for (const input of RUNWAY_INPUTS) {
      const result: { runway: SloBudgetRunway; text: SloBudgetRunwayText } =
        runwayText(input);

      kinds.add(result.runway.kind);

      expect({ input, text: result.text }).toEqual({
        input,
        text: {
          value: result.runway.value,
          description: result.runway.description,
        },
      });
    }

    // Every kind is read at least once.
    expect([...kinds].sort()).toEqual(
      Object.values(SloBudgetRunwayKind).sort(),
    );
  });

  test("the window's fill, as a badge and after other words", () => {
    for (const totalSeconds of [1, 26, 648, 1296, 2591]) {
      const fill: SloRollingWindowFill | null = getRollingWindowFill({
        windowType: SloWindowType.Rolling,
        windowDays: 30,
        targetPercentage: 99.9,
        errorBudgetTotalSeconds: totalSeconds,
      });

      expect(fill).not.toBeNull();
      expect(getRollingWindowFillTextInLanguage(fill!)).toBe(fill!.label);
      expect(
        getRollingWindowFillTextInLanguage(fill!, undefined, {
          afterOtherWords: true,
        }),
      ).toBe(fill!.label.toLowerCase());
    }
  });

  test("a language with no wording of a sentence reads it, durations too, in English", () => {
    const input: SloBudgetRunwayData = RUNWAY_INPUTS[12]!;
    const english: SloBudgetRunwayText = runwayText(input).text;
    const unworded: SloBudgetRunwayText = runwayText(
      input,
      NOTHING_WORDED,
    ).text;

    expect(unworded.description).toBe(english.description);
    expect(
      getErrorBudgetRemainingOfTotalInLanguage(
        BUDGET_INPUTS[0]!,
        NOTHING_WORDED,
      ),
    ).toBe("12m 30s left of 43m 12s");
  });
});

describe("the KPI strip's words in the reader's language", () => {
  test("the SLI against its target reads in German, Arabic and Japanese", () => {
    expect(
      getSliDeltaTextInLanguage(
        { currentSliPercentage: 99.874, targetPercentage: 99.9 },
        DE,
      ),
    ).toBe("0.026 Prozentpunkte unter dem Ziel von 99.9%");
    expect(
      getSliDeltaTextInLanguage(
        { currentSliPercentage: 99.9, targetPercentage: 99.9 },
        DE,
      ),
    ).toBe("Genau auf dem Ziel von 99.9%");
    expect(
      getSliDeltaTextInLanguage(
        { currentSliPercentage: 99.95, targetPercentage: 99.9 },
        AR,
      ),
    ).toBe("أعلى من الهدف 99.9% بمقدار 0.05 نقطة مئوية");
    expect(
      getSliDeltaTextInLanguage(
        { currentSliPercentage: 99.89999, targetPercentage: 99.9 },
        JA,
      ),
    ).toBe("目標 99.9% をわずかに下回っています");
  });

  test("a value in a note is set apart from the words, when asked", () => {
    const text: string | null = getSliDeltaTextInLanguage(
      { currentSliPercentage: 99.874, targetPercentage: 99.9 },
      AR,
      { setsValuesApart: true },
    );

    expect(text).toContain(`${FIRST_STRONG_ISOLATE}99.9%`);
    expect(text!.replace(ISOLATE_MARKS, "")).toBe(
      "أدنى من الهدف 99.9% بمقدار 0.026 نقطة مئوية",
    );
  });

  test("the error budget left of its total, durations in the language's own units", () => {
    const left: string | null = getErrorBudgetRemainingOfTotalInLanguage(
      { remainingSeconds: 750, totalSeconds: 2592 },
      DE,
    );

    expect(left).toMatch(/^Noch 12 Min\., 30 Sek\. von 43 Min\., 12 Sek\.$/);

    const over: string | null = getErrorBudgetRemainingOfTotalInLanguage(
      { remainingSeconds: -300, totalSeconds: 2592 },
      DE,
    );

    expect(over).toBe("5 Min. über dem Budget · 43 Min., 12 Sek. erlaubt");

    const sliver: string | null = getErrorBudgetRemainingOfTotalInLanguage(
      { remainingSeconds: 0.3, totalSeconds: 2592 },
      DE,
    );

    expect(sliver).toBe("Noch unter 1 Sek. von 43 Min., 12 Sek.");

    const arabic: string = getErrorBudgetRemainingOfTotalInLanguage(
      { remainingSeconds: 750, totalSeconds: 2592 },
      AR,
    )!;

    expect(englishWordsIn(arabic, [])).toEqual([]);
    expect(arabic.startsWith("يتبقى ")).toBe(true);
  });

  test("the budget's headline for a spent budget, and the window's fill", () => {
    expect(
      getSloBudgetRemainingTextInLanguage(getSloBudgetRemainingText(-3), DE),
    ).toBe("Budget überschritten");
    expect(
      getSloBudgetRemainingTextInLanguage(getSloBudgetRemainingText(0), AR),
    ).toBe("لم يتبقَّ شيء من الميزانية");
    expect(getSloBudgetRemainingTextInLanguage("42.5%", DE)).toBe("42.5%");

    const fill: SloRollingWindowFill = getRollingWindowFill({
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      targetPercentage: 99.9,
      errorBudgetTotalSeconds: 648,
    })!;

    expect(getRollingWindowFillTextInLanguage(fill, DE)).toBe(
      "Fenster zu 25 % gefüllt",
    );
    // German keeps its noun's capital after other words; English does not.
    expect(
      getRollingWindowFillTextInLanguage(fill, DE, { afterOtherWords: true }),
    ).toBe("Fenster zu 25 % gefüllt");
    expect(getRollingWindowFillTextInLanguage(fill, AR)).toBe(
      "امتلأ 25% من النافذة",
    );
  });

  test("every runway answer reads in German and Arabic with no English left", () => {
    for (const input of RUNWAY_INPUTS) {
      const english: SloBudgetRunwayText = runwayText(input).text;
      const german: SloBudgetRunwayText = runwayText(input, DE).text;
      const arabic: SloBudgetRunwayText = runwayText(input, AR).text;

      // German is written in Latin letters: it differs from the English.
      expect({
        input,
        same: german.description === english.description,
      }).toEqual({ input, same: false });

      if (english.value !== "\u2014" && !english.value.startsWith("~")) {
        expect({ input, same: german.value === english.value }).toEqual({
          input,
          same: false,
        });
      }

      // Arabic holds no Latin word at all.
      expect({
        input,
        english: [
          ...englishWordsIn(arabic.value, []),
          ...englishWordsIn(arabic.description, []),
        ],
      }).toEqual({ input, english: [] });
    }

    expect(runwayText(RUNWAY_INPUTS[12]!, DE).text.description).toBe(
      "Bis zur Erschöpfung, bei der Verbrauchsrate der letzten 1 Std.",
    );
    expect(runwayText(RUNWAY_INPUTS[14]!, DE).text.value).toBe("Unter 1 Min.");
    expect(runwayText(RUNWAY_INPUTS[12]!, DE).text.value).toMatch(/^~\d/);
    expect(runwayText(RUNWAY_INPUTS[10]!, DE).text.description).toBe(
      "Reicht über das 30-Tage-Fenster hinaus, bei der Verbrauchsrate der letzten 1 Std.",
    );
  });

  test("a calendar month's reset is joined with the language's separator", () => {
    const overspent: SloBudgetRunwayText = runwayText(
      RUNWAY_INPUTS[6]!,
      DE,
    ).text;

    expect(overspent.description).toMatch(
      /^1 Std\., 23 Min\. über dem Budget · setzt sich in .+ zurück$/,
    );

    const persian: SloBudgetRunwayText = runwayText(
      RUNWAY_INPUTS[6]!,
      translatorFor("fa"),
    ).text;

    // Persian's zero is a dot, so its line takes a bullet between facts.
    expect(persian.description).toContain(" \u{2022} ");
    expect(persian.description).not.toContain(" \u{00B7} ");
  });
});

describe("the KPI strip's sentences are keys worded in every language", () => {
  const KPI_SENTENCES: Array<string> = [
    "Just below the {{target}} target",
    "Just above the {{target}} target",
    "Exactly on the {{target}} target",
    "{{delta}} pp above the {{target}} target",
    "{{delta}} pp below the {{target}} target",
    "{{duration}} over budget",
    "{{remaining}} left of {{total}}",
    "{{remaining}} over budget · {{total}} allowed",
    "under 1s",
    "Budget exceeded",
    "No budget left",
    "Window under 1% full",
    "Window {{percent}}% full",
    "window under 1% full",
    "window {{percent}}% full",
    "Overspent",
    "Budget fully spent",
    "Not burning",
    "No budget spent in the last {{window}}",
    "Lasts until reset",
    "Resets in {{reset}}, at the burn rate of the last {{window}}",
    "Sustainable",
    "Outlasts the {{count}}-day window, at the burn rate of the last {{window}}",
    "Under 1m",
    "Until exhausted, at the burn rate of the last {{window}}",
    "resets in {{duration}}",
    "Not projected when downtime is averaged across monitors",
    "Needs a target between 0% and 100%",
  ];

  test("each is in en.json and has its own wording in every language", () => {
    for (const sentence of KPI_SENTENCES) {
      expect({ sentence, english: ENGLISH_LOCALE[sentence] }).toEqual({
        sentence,
        english: sentence,
      });

      for (const language of LANGUAGES) {
        const words: Record<string, string> = localeWords(language);

        // Danish writes "{{duration}} over budget" as English does.
        if (language === "da" && sentence === "{{duration}} over budget") {
          continue;
        }

        expect({
          sentence,
          language,
          same: words[sentence] === sentence,
        }).toEqual({ sentence, language, same: false });
      }
    }
  });
});

describe("the SLO feed and the SLO metrics tabs are worded", () => {
  test("the feed's title, description and empty line are keys, worded in German", () => {
    // SloFeed renders ResourceFeed, so its source is read rather than run.
    const source: string = fs
      .readFileSync(
        path.resolve(
          __dirname,
          "../../FeatureSet/Dashboard/src/Components/Slo/SloFeed.tsx",
        ),
        "utf8",
      )
      .replace(/\(\s+"/g, '("');

    for (const text of [
      "SLO Feed",
      "Everything that has happened to this SLO - how it was created, every status change, the burn-rate alerts and incidents it raised, and each change to its rules, monitors and owners.",
      "No activity has been recorded for this SLO yet.",
    ]) {
      expect({
        text,
        marked: source.includes(`translationKey(${JSON.stringify(text)}`),
      }).toEqual({ text, marked: true });
      expect(ENGLISH_LOCALE[text]).toBe(text);
      expect(DE.translateText(text)).not.toBe(text);
      expect(AR.translateText(text)).not.toBe(text);
    }

    expect(
      DE.translateText("No activity has been recorded for this SLO yet."),
    ).toBe("Für dieses SLO wurde noch keine Aktivität erfasst.");
  });

  test("the metrics page's tab names are listed as keys and worded", () => {
    expect([...SLO_METRICS_TAB_KEYS].sort()).toEqual(
      Object.values(SloMetricsTab).sort(),
    );

    for (const tab of Object.values(SloMetricsTab)) {
      expect(ENGLISH_LOCALE[tab]).toBe(tab);
      expect(DE.translateText(tab)).not.toBe(tab);
    }

    expect(DE.translateText(SloMetricsTab.ErrorBudgetHistory)).toBe(
      "Verlauf des Fehlerbudgets",
    );
  });
});

describe("the status page resources pane's words", () => {
  test("its subtitle reads in English as it did", () => {
    expect(
      getResourcePanelSubtitle({
        resourceCount: 3,
        subGroupCount: 2,
        isUngroupedOnPageWithGroups: false,
      }),
    ).toBe("3 resources · 2 sub groups");
    expect(
      getResourcePanelSubtitle({
        resourceCount: 1,
        subGroupCount: 1,
        isUngroupedOnPageWithGroups: false,
      }),
    ).toBe("1 resource · 1 sub group");
    expect(
      getResourcePanelSubtitle({
        resourceCount: 1234,
        subGroupCount: 0,
        isUngroupedOnPageWithGroups: true,
      }),
    ).toBe("1,234 resources · visitors see these first, above every group");
    // Still loading: the count is left out, nothing else is said.
    expect(
      getResourcePanelSubtitle({
        resourceCount: null,
        subGroupCount: 0,
        isUngroupedOnPageWithGroups: false,
      }),
    ).toBe("");
  });

  test("its subtitle reads in German and Arabic", () => {
    expect(
      getResourcePanelSubtitle(
        {
          resourceCount: 3,
          subGroupCount: 2,
          isUngroupedOnPageWithGroups: false,
        },
        DE,
      ),
    ).toBe("3 Ressourcen · 2 Untergruppen");
    expect(
      getResourcePanelSubtitle(
        {
          resourceCount: 3,
          subGroupCount: 0,
          isUngroupedOnPageWithGroups: true,
        },
        DE,
      ),
    ).toBe("3 Ressourcen · Besucher sehen diese zuerst, über allen Gruppen");

    const arabic: string = getResourcePanelSubtitle(
      {
        resourceCount: 3,
        subGroupCount: 2,
        isUngroupedOnPageWithGroups: true,
      },
      AR,
    );

    expect(englishWordsIn(arabic, [])).toEqual([]);
    expect(arabic).toBe(
      "3 من الموارد · 2 من المجموعات الفرعية · يراها الزوار أولًا، فوق كل مجموعة",
    );
  });

  test("a grid axis is cased the way the sentence's language writes a word mid-sentence", () => {
    const EN: Translator = createTranslator(undefined);

    expect(
      EN.translateTemplate("Select {{axis}}", {
        axis: gridAxisNameInSentence("Region"),
      }),
    ).toBe("Select region");
    // An abbreviation keeps its capitals.
    expect(
      EN.translateTemplate("Select {{axis}}", {
        axis: gridAxisNameInSentence("AZ"),
      }),
    ).toBe("Select AZ");
    // A German noun keeps its capital; the old toLowerCase() broke it.
    expect(
      DE.translateTemplate("Select {{axis}}", {
        axis: gridAxisNameInSentence("Rechenzentrum"),
      }),
    ).toBe("Rechenzentrum auswählen");
    expect(
      AR.translateTemplate("Select {{axis}}", {
        axis: gridAxisNameInSentence("المنطقة"),
      }),
    ).toBe("اختر المنطقة");
  });

  test("a navigator row's count tooltip, in English as before and in German", () => {
    expect(
      getNavigatorCountTooltip({
        row: { ownResourceCount: 2, subtreeResourceCount: 100 },
        countIndex: { isComplete: true },
      }),
    ).toBe("2 resources in this group · 100 including sub groups");
    expect(
      getNavigatorCountTooltip(
        {
          row: { ownResourceCount: 1, subtreeResourceCount: 1 },
          countIndex: { isComplete: true },
        },
        DE,
      ),
    ).toBe("1 Ressource in dieser Gruppe");
    expect(
      getNavigatorCountTooltip(
        {
          row: { ownResourceCount: 0, subtreeResourceCount: 12 },
          countIndex: { isComplete: true },
        },
        DE,
      ),
    ).toBe("0 Ressourcen in dieser Gruppe · 12 einschließlich Untergruppen");
    expect(
      getNavigatorCountTooltip(
        {
          row: { ownResourceCount: 0, subtreeResourceCount: 12 },
          countIndex: { isComplete: false },
        },
        DE,
      ),
    ).toBeUndefined();
  });
});

describe("the topology's fixed words are keys worded in every language", () => {
  const TOPOLOGY_KEYS: Array<string> = [
    "Browse by site",
    "Start with a location to understand its network and find devices that need attention.",
    "Sites here",
    "Devices here",
    "You're viewing every device in one map. Organize devices into sites to explore your network by location.",
    "Your devices aren't assigned to sites yet. Set a site on each device to explore its network by location.",
    "Link down",
    "High utilization",
    "No operational data",
    "Open the list to see everything",
    "Requests it answered",
    "Calls it made",
    "Leave the community string empty to only ping the device. Add it for interfaces, inventory and health.",
    "Leave it empty to only ping. Used by SNMP V1 and V2c, not V3.",
  ];

  test("each is in en.json, written where the component names it, and worded", () => {
    const topology: string = path.resolve(
      __dirname,
      "../../FeatureSet/Dashboard/src/Components/Topology",
    );
    // Every source of the folder, with a call's line breaks taken out.
    const sources: string = fs
      .readdirSync(topology)
      .filter((file: string): boolean => {
        return /\.tsx?$/.test(file);
      })
      .map((file: string): string => {
        return fs.readFileSync(path.join(topology, file), "utf8");
      })
      .join("\n")
      .replace(/\(\s+"/g, '("');

    for (const key of TOPOLOGY_KEYS) {
      expect({ key, english: ENGLISH_LOCALE[key] }).toEqual({
        key,
        english: key,
      });
      // Marked as a key where it is written, so the extractor keeps it.
      expect({
        key,
        marked: sources.includes(`translationKey(${JSON.stringify(key)}`),
      }).toEqual({ key, marked: true });

      for (const language of LANGUAGES) {
        const words: Record<string, string> = localeWords(language);

        expect({ key, language, same: words[key] === key }).toEqual({
          key,
          language,
          same: false,
        });
      }
    }
  });
});
