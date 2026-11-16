import { describe, expect, test } from "@jest/globals";
import { formatCloudSeconds } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles";
import { formatReviewDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewCopy";
import { formatTraceListDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceListComponent";
import { formatLatencyUsec as formatWidgetLatencyUsec } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData";
import { formatLlmDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationFormat";
import { getOpenStackCheckDurationText } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackChecksView";
import { formatCloudTopologySeconds } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/CloudAccountTopology";
import { formatEvidenceDuration } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import {
  DurationInUnit,
  formatDurationInUnit,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Milliseconds";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE DASHBOARD'S OTHER DURATION UNITS, IN THE READER'S LANGUAGE (#8348).
 *
 * The Dashboard's duration formatters wrote their milliseconds through
 * formatMilliseconds (#7418) and every other unit by hand: a second
 * `${(ms / 1000).toFixed(2)} s`, a microsecond `${ms * 1000} µs`, a
 * nanosecond `${n}ns`, a minute `${(ms / 60000).toFixed(1)} min`. A
 * Persian row read "1.25 s" in Latin digits under "۴۲ میلی‌ثانیه", a German
 * one "1.25 s" where German writes "1,25 Sek.". Each is formatDurationInUnit
 * now (#8349's helper, which writes Intl's short unit in the reader's
 * digits), its nanoseconds included, and each figure stays on the line of
 * its unit (#8302, #8303). Per formatter, in English (as before, the figure
 * held to its unit), German, French, Arabic and Persian. The charts' own
 * formatters are #8349's, tested beside them.
 */

const NB: string = NO_BREAK_SPACE;
// French's narrow no-break space, which Intl writes before a unit.
const NNB: string = "\u202F";

const translators: Record<string, Translator> = Object.fromEntries(
  ["en", "de", "fr", "ar", "fa"].map(
    (language: string): [string, Translator] => {
      return [language, dashboardTranslator(language)];
    },
  ),
);

interface InEachLanguage {
  en: string;
  de: string;
  fr: string;
  ar: string;
  fa: string;
}

// Each language's text from `write`, its isolating marks left out.
const inEachLanguage: (
  write: (translator: Translator) => string | undefined,
) => InEachLanguage = (
  write: (translator: Translator) => string | undefined,
): InEachLanguage => {
  const text: (language: string) => string = (language: string): string => {
    return withoutIsolateMarks(write(translators[language]!) || "");
  };

  return {
    en: text("en"),
    de: text("de"),
    fr: text("fr"),
    ar: text("ar"),
    fa: text("fa"),
  };
};

const LATIN_DIGIT: RegExp = /[0-9]/;
const BREAKING_SPACE: RegExp = /[ \u2000-\u2006\u2008-\u200A\u205F]/;

// 1.25 s, 250 µs, 850 ns and 2.5 h as each language writes them.
const SECONDS: InEachLanguage = {
  en: `1.25${NB}s`,
  de: `1,25${NB}Sek.`,
  fr: `1,25${NNB}s`,
  ar: `1.25${NB}ث`,
  fa: `۱٫۲۵${NB}ثانیه`,
};

const MICROSECONDS: InEachLanguage = {
  en: `250${NB}µs`,
  de: `250${NB}μs`,
  fr: `250${NNB}μs`,
  ar: `250${NB}م.ث.`,
  fa: "۲۵۰μs",
};

const NANOSECONDS: InEachLanguage = {
  en: `850${NB}ns`,
  de: `850${NB}ns`,
  fr: `850${NNB}ns`,
  ar: `850${NB}ن.ث.`,
  fa: `۸۵۰${NB}نانوثانیه`,
};

const HOURS: InEachLanguage = {
  en: `2.5${NB}h`,
  de: `2,5${NB}Std.`,
  fr: `2,5${NNB}h`,
  ar: `2.5${NB}س`,
  fa: `۲٫۵${NB}ساعت`,
};

describe("formatDurationInUnit holds each figure to its unit", () => {
  test("each unit, in each language", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatDurationInUnit(t, 1.25, "second", { decimals: 2 });
      }),
    ).toEqual(SECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatDurationInUnit(t, 250, "microsecond", { decimals: 0 });
      }),
    ).toEqual(MICROSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatDurationInUnit(t, 850, "nanosecond", { decimals: 0 });
      }),
    ).toEqual(NANOSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatDurationInUnit(t, 2.5, "hour", {
          decimals: 1,
          dropTrailingZeros: true,
        });
      }),
    ).toEqual(HOURS);
  });

  test("the English a caller hands it is held too, and otherwise as written", () => {
    const english: Translator = translators["en"]!;

    expect(
      formatDurationInUnit(english, 250, "microsecond", {
        decimals: 0,
        english: "250 µs",
      }),
    ).toBe(`250${NB}µs`);
    expect(
      formatDurationInUnit(english, 1.5, "second", {
        decimals: 1,
        english: "1.5s",
      }),
    ).toBe("1.5s");
    expect(
      formatDurationInUnit(english, 90, "minute", {
        decimals: 0,
        english: "in 90 min",
      }),
    ).toBe(`in 90${NB}min`);
  });

  test("no space a line breaks at is left between a figure and its unit, in any Dashboard language", () => {
    const units: Array<DurationInUnit> = [
      "nanosecond",
      "microsecond",
      "second",
      "minute",
      "hour",
      "day",
    ];

    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const translator: Translator = dashboardTranslator(language);

      for (const unit of units) {
        const text: string = formatDurationInUnit(translator, 5, unit, {
          decimals: 0,
        });

        expect({ language, unit, breaks: BREAKING_SPACE.test(text) }).toEqual({
          language,
          unit,
          breaks: false,
        });
      }
    }
  });

  test("Persian writes every unit in Persian digits", () => {
    for (const unit of [
      "nanosecond",
      "microsecond",
      "second",
      "minute",
      "hour",
    ] as Array<DurationInUnit>) {
      expect(
        LATIN_DIGIT.test(
          formatDurationInUnit(translators["fa"]!, 5, unit, { decimals: 0 }),
        ),
      ).toBe(false);
    }
  });

  test("a reading that is not a number reads as a missing fact", () => {
    expect(
      formatDurationInUnit(translators["fa"]!, NaN, "nanosecond", {
        decimals: 0,
      }),
    ).toBe("-");
  });
});

describe("the duration keys the formatters write, in every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s words the compact and the spaced minutes and seconds, or keeps them on purpose",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        "{{minutes}}m {{seconds}}s",
        "{{hours}}h {{minutes}}m",
        "{{minutes}} min {{seconds}} s",
      ]) {
        expect({
          language,
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ language, key, worded: true });
        expect(locale[key]).toContain("{{minutes}}");
      }
    },
  );
});

describe("traces", () => {
  test("a span in the trace list widget, from nanoseconds: every unit", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceListDuration(850, t);
      }),
    ).toEqual(NANOSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceListDuration(250_000, t);
      }),
    ).toEqual(MICROSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceListDuration(1_250_000_000, t);
      }),
    ).toEqual(SECONDS);
  });
});

describe("cloud", () => {
  test("a cloud headline tile: seconds, minutes and hours", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudSeconds(1.8, t);
      }),
    ).toEqual({
      en: `1.8${NB}s`,
      de: `1,8${NB}Sek.`,
      fr: `1,8${NNB}s`,
      ar: `1.8${NB}ث`,
      fa: `۱٫۸${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudSeconds(720, t);
      }),
    ).toEqual({
      en: `12${NB}min`,
      de: `12${NB}Min.`,
      fr: `12${NB}min`,
      ar: `12${NB}د`,
      fa: `۱۲${NB}دقیقه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudSeconds(9000, t);
      }),
    ).toEqual(HOURS);
  });

  test("a cloud headline tile rounds as formatCloudAmount does", () => {
    const english: Translator = translators["en"]!;

    expect(formatCloudSeconds(100, english)).toBe(`100${NB}s`);
    expect(formatCloudSeconds(119.6, english)).toBe(`120${NB}s`);
    expect(formatCloudSeconds(0.23, english)).toBe(`230${NB}ms`);
  });

  test("a cloud account's topology card: seconds and hours", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudTopologySeconds(1.8, t);
      }),
    ).toEqual({
      en: `1.8${NB}s`,
      de: `1,8${NB}Sek.`,
      fr: `1,8${NNB}s`,
      ar: `1.8${NB}ث`,
      fa: `۱٫۸${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudTopologySeconds(9000, t);
      }),
    ).toEqual(HOURS);
  });
});

describe("code, AI and investigations", () => {
  test("a production review's duration from a second up", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatReviewDuration(1234, t);
      }),
    ).toEqual({
      en: `1.2${NB}s`,
      de: `1,2${NB}Sek.`,
      fr: `1,2${NNB}s`,
      ar: `1.2${NB}ث`,
      fa: `۱٫۲${NB}ثانیه`,
    });
    expect(formatReviewDuration(840, translators["en"]!)).toBe(`840${NB}ms`);
    expect(formatReviewDuration(-1, translators["en"]!)).toBe("");
  });

  test("an LLM call: seconds, then minutes and seconds, then hours and minutes", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(2300, t);
      }),
    ).toEqual({
      en: `2.3${NB}s`,
      de: `2,3${NB}Sek.`,
      fr: `2,3${NNB}s`,
      ar: `2.3${NB}ث`,
      fa: `۲٫۳${NB}ثانیه`,
    });
    expect(formatLlmDuration(42_000, translators["en"]!)).toBe(`42${NB}s`);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(245_000, t);
      }),
    ).toEqual({
      en: "4m 05s",
      de: `4${NB}Min. 05${NB}s`,
      fr: `4${NB}min 05${NB}s`,
      ar: `4${NB}د 05${NB}ث`,
      fa: `۴${NB}دقیقه ۰۵${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(3_720_000, t);
      }),
    ).toEqual({
      en: "1h 02m",
      de: `1${NB}Std. 02${NB}Min.`,
      fr: `1${NB}h 02${NB}min`,
      ar: `1${NB}س 02${NB}د`,
      fa: `۱${NB}ساعت ۰۲${NB}دقیقه`,
    });
  });

  test("an LLM call that rounds up reads in the next unit, as before", () => {
    const english: Translator = translators["en"]!;

    expect(formatLlmDuration(999.6, english)).toBe(`1.0${NB}s`);
    expect(formatLlmDuration(9960, english)).toBe(`10${NB}s`);
    expect(formatLlmDuration(59_600, english)).toBe("1m 00s");
  });

  test("an investigation's step: seconds, a minute, minutes and seconds", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatEvidenceDuration(1200, t)!;
      }),
    ).toEqual({
      en: `1.2${NB}s`,
      de: `1,2${NB}Sek.`,
      fr: `1,2${NNB}s`,
      ar: `1.2${NB}ث`,
      fa: `۱٫۲${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatEvidenceDuration(59_990, t)!;
      }),
    ).toEqual({
      en: `1${NB}min`,
      de: `1${NB}Min.`,
      fr: `1${NB}min`,
      ar: `1${NB}د`,
      fa: `۱${NB}دقیقه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatEvidenceDuration(125_000, t)!;
      }),
    ).toEqual({
      en: `2${NB}min 5${NB}s`,
      de: `2${NB}Min. 5${NB}s`,
      fr: `2${NB}min 5${NB}s`,
      ar: `2${NB}د 5${NB}ث`,
      fa: `۲${NB}دقیقه ۵${NB}ثانیه`,
    });
    expect(formatEvidenceDuration(120_000, translators["en"]!)).toBe(
      `2${NB}min`,
    );
  });
});

describe("infrastructure", () => {
  test("an OpenStack check's step: seconds, then minutes and seconds", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return getOpenStackCheckDurationText(1500, t);
      }),
    ).toEqual({
      en: `1.5${NB}s`,
      de: `1,5${NB}Sek.`,
      fr: `1,5${NNB}s`,
      ar: `1.5${NB}ث`,
      fa: `۱٫۵${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return getOpenStackCheckDurationText(252_000, t);
      }),
    ).toEqual({
      en: "4m 12s",
      de: `4${NB}Min. 12${NB}s`,
      fr: `4${NB}min 12${NB}s`,
      ar: `4${NB}د 12${NB}ث`,
      fa: `۴${NB}دقیقه ۱۲${NB}ثانیه`,
    });
    // 59.6 s past a minute rounds up to the next minute, never "1m 60s".
    expect(getOpenStackCheckDurationText(119_600, translators["en"]!)).toBe(
      "2m 0s",
    );
  });

  test("a storage array widget's latency under a millisecond", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatWidgetLatencyUsec(250, t);
      }),
    ).toEqual(MICROSECONDS);
    // Without a translator, the widget writes English.
    expect(formatWidgetLatencyUsec(250)).toBe(`250${NB}µs`);
  });
});

describe("negative control: the hand-written units read wrong", () => {
  test("`${(ms / 1000).toFixed(2)} s` keeps Latin digits, an English decimal point and a plain space in Persian", () => {
    const handBuilt: string = `${(1250 / 1000).toFixed(2)} s`;

    expect(handBuilt).not.toBe(SECONDS.fa);
    expect(LATIN_DIGIT.test(handBuilt)).toBe(true);
    expect(BREAKING_SPACE.test(handBuilt)).toBe(true);
  });
});
