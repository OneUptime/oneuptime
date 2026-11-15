import { describe, expect, test } from "@jest/globals";
import { formatCloudSeconds } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles";
import { formatReviewDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewCopy";
import { formatTraceListDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceListComponent";
import { formatLatencyUsec as formatWidgetLatencyUsec } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/StorageArrayWidgetData";
import {
  formatDurationMs as formatTraceChartDurationMs,
  formatDurationMsInLanguage as formatTraceDurationMsInLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import { formatLlmDuration } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmConversationFormat";
import {
  formatMessageQueueDurationMs,
  formatMessageQueueDurationMsInLanguage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import { getOpenStackCheckDurationText } from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Checks/OpenStackChecksView";
import { formatCloudTopologySeconds } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/CloudAccountTopology";
import {
  formatDurationMs as formatTelemetryChartDurationMs,
  formatDurationMsInLanguage as formatTelemetryDurationMs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat";
import { formatDurationMs as formatTopologyDurationMs } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import { formatDatabaseSeconds } from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import StorageArrayResourceUtils from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";
import { formatEvidenceDuration } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import {
  DurationUnit,
  formatMilliseconds,
  formatMillisecondsInEnglish,
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
 * one "1.25 s" where German writes "1,25 s". formatMilliseconds takes a
 * unit now, each through its key, and every formatter writes every unit
 * with it. Per formatter, in English (as before, the figure held to its
 * unit by a no-break space, #8302), German, French, Arabic and Persian. A
 * chart's value axis keeps the English every chart's axis writes. The
 * session replay details panel's own figures are #8299's.
 */

const NB: string = NO_BREAK_SPACE;
const ZWNJ: string = "\u{200C}";

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "fr", "ar", "fa"];

const translators: Record<string, Translator> = Object.fromEntries(
  LANGUAGES.map((language: string): [string, Translator] => {
    return [language, dashboardTranslator(language)];
  }),
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
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const BREAKING_SPACE: RegExp = /[  -  -  ]/;

// A Persian duration: Persian digits and words, nothing Latin.
const expectPersian: (text: string) => void = (text: string): void => {
  expect(LATIN_DIGIT.test(text)).toBe(false);
  expect(LATIN_LETTER.test(text)).toBe(false);
};

// 1.25 s, 250 µs, 850 ns, 1.5 min and 2.5 h as each language writes them.
const SECONDS: InEachLanguage = {
  en: `1.25${NB}s`,
  de: `1,25${NB}s`,
  fr: `1,25${NB}s`,
  ar: `1.25${NB}ث`,
  fa: `۱٫۲۵${NB}ثانیه`,
};

const MICROSECONDS: InEachLanguage = {
  en: `250${NB}µs`,
  de: `250${NB}µs`,
  fr: `250${NB}µs`,
  ar: `250${NB}م.ث.`,
  fa: `۲۵۰${NB}میکروثانیه`,
};

const NANOSECONDS: InEachLanguage = {
  en: `850${NB}ns`,
  de: `850${NB}ns`,
  fr: `850${NB}ns`,
  ar: `850${NB}ن.ث.`,
  fa: `۸۵۰${NB}نانوثانیه`,
};

const MINUTES: InEachLanguage = {
  en: `1.5${NB}min`,
  de: `1,5${NB}Min.`,
  fr: `1,5${NB}min`,
  ar: `1.5${NB}د`,
  fa: `۱٫۵${NB}دقیقه`,
};

const HOURS: InEachLanguage = {
  en: `2.5${NB}h`,
  de: `2,5${NB}Std.`,
  fr: `2,5${NB}h`,
  ar: `2.5${NB}س`,
  fa: `۲٫۵${NB}ساعت`,
};

describe("formatMilliseconds in another unit", () => {
  test("each unit, from the same duration in milliseconds", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMilliseconds(t, 1250, { unit: "s" });
      }),
    ).toEqual(SECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMilliseconds(t, 0.25, { unit: "µs" });
      }),
    ).toEqual(MICROSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMilliseconds(t, 0.00085, { unit: "ns" });
      }),
    ).toEqual(NANOSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMilliseconds(t, 90_000, { unit: "min" });
      }),
    ).toEqual(MINUTES);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMilliseconds(t, 9_000_000, { unit: "h" });
      }),
    ).toEqual(HOURS);
  });

  test("milliseconds stay the default, and 'ms' names them too", () => {
    const english: Translator = translators["en"]!;

    expect(formatMilliseconds(english, 411)).toBe(`411${NB}ms`);
    expect(formatMilliseconds(english, 411, { unit: "ms" })).toBe(`411${NB}ms`);
    // A unit the code does not know is read as milliseconds.
    expect(
      formatMilliseconds(english, 411, {
        unit: "fortnight" as unknown as DurationUnit,
      }),
    ).toBe(`411${NB}ms`);
  });

  test("a small unit is multiplied, never divided by a fraction: 0.5 ms is 500 µs", () => {
    const english: Translator = translators["en"]!;

    expect(formatMilliseconds(english, 0.5, { unit: "µs" })).toBe(`500${NB}µs`);
    expect(formatMilliseconds(english, 0.0005, { unit: "ns" })).toBe(
      `500${NB}ns`,
    );
    expect(formatMilliseconds(english, 0.3, { unit: "µs" })).toBe(`300${NB}µs`);
  });

  test("the decimals are the figure's in its unit, and toFixed's trailing zeros are kept", () => {
    const english: Translator = translators["en"]!;
    const german: Translator = translators["de"]!;

    expect(
      formatMilliseconds(english, 1000, {
        unit: "s",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    ).toBe(`1.00${NB}s`);
    expect(
      formatMilliseconds(german, 61_000, {
        unit: "min",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    ).toBe(`1,0${NB}Min.`);
    expect(
      formatMilliseconds(english, 1234, {
        unit: "s",
        maximumFractionDigits: 0,
      }),
    ).toBe(`1${NB}s`);
  });

  test("a figure of a thousand or more takes its separator, in the reader's way", () => {
    expect(
      formatMilliseconds(translators["en"]!, 1_234_000, { unit: "s" }),
    ).toBe(`1,234${NB}s`);
    expect(
      formatMilliseconds(translators["de"]!, 1_234_000, { unit: "s" }),
    ).toBe(`1.234${NB}s`);
    expect(
      formatMilliseconds(translators["fa"]!, 1_234_000, { unit: "s" }),
    ).toBe(`۱٬۲۳۴${NB}ثانیه`);
  });

  test("a signed offset keeps its sign in any unit", () => {
    expect(
      formatMilliseconds(translators["en"]!, 1500, {
        unit: "s",
        showsSign: true,
      }),
    ).toBe(`+1.5${NB}s`);
    expect(
      formatMilliseconds(translators["en"]!, -1500, {
        unit: "s",
        showsSign: true,
      }),
    ).toBe(`-1.5${NB}s`);
  });

  test("a reading that is not a number reads as a missing fact, in any unit", () => {
    for (const unit of ["ns", "µs", "s", "min", "h"] as Array<DurationUnit>) {
      expect(formatMilliseconds(translators["fa"]!, NaN, { unit })).toBe("-");
      expect(formatMilliseconds(translators["fa"]!, Infinity, { unit })).toBe(
        "-",
      );
    }
  });

  test("English on purpose takes the unit too: Latin figures and symbols in any language", () => {
    expect(formatMillisecondsInEnglish(1250, { unit: "s" })).toBe(`1.25${NB}s`);
    expect(formatMillisecondsInEnglish(0.25, { unit: "µs" })).toBe(
      `250${NB}µs`,
    );
    expect(formatMillisecondsInEnglish(90_000, { unit: "min" })).toBe(
      `1.5${NB}min`,
    );
  });

  test("Persian writes every unit with Persian digits and words", () => {
    for (const [ms, unit] of [
      [0.00085, "ns"],
      [0.25, "µs"],
      [1250, "s"],
      [90_000, "min"],
      [9_000_000, "h"],
    ] as Array<[number, DurationUnit]>) {
      expectPersian(formatMilliseconds(translators["fa"]!, ms, { unit }));
    }
  });

  test("each unit is drawn with no space a line breaks at, in every Dashboard language", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const translator: Translator = dashboardTranslator(language);

      for (const unit of [
        "ns",
        "µs",
        "ms",
        "s",
        "min",
        "h",
      ] as Array<DurationUnit>) {
        const text: string = formatMilliseconds(translator, 5, { unit });

        expect({ language, unit, breaks: BREAKING_SPACE.test(text) }).toEqual({
          language,
          unit,
          breaks: false,
        });
      }
    }
  });
});

describe("the new units' keys, in every Dashboard language", () => {
  test("English holds each under its own words", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of ["{{value}} µs", "{{value}} ns", "{{value}} h"]) {
      expect(english[key]).toBe(key);
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words them, or keeps the symbol on purpose, with the figure's placeholder",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of [
        "{{value}} µs",
        "{{value}} ns",
        "{{value}} h",
        "{{minutes}} min {{seconds}} s",
      ]) {
        expect({
          language,
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({
          language,
          key,
          worded: true,
        });
        expect(locale[key]).toContain(
          key.startsWith("{{minutes}}") ? "{{minutes}}" : "{{value}}",
        );
      }
    },
  );
});

describe("traces", () => {
  test("a trace widget's table cell: microseconds, seconds and minutes", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceDurationMsInLanguage(0.25, t);
      }),
    ).toEqual(MICROSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceDurationMsInLanguage(1250, t);
      }),
    ).toEqual(SECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTraceDurationMsInLanguage(90_000, t);
      }),
    ).toEqual(MINUTES);
  });

  test("a trace chart's value axis keeps English in every unit", () => {
    expect(formatTraceChartDurationMs(0.25)).toBe(`250${NB}µs`);
    expect(formatTraceChartDurationMs(1250)).toBe(`1.25${NB}s`);
    expect(formatTraceChartDurationMs(90_000)).toBe(`1.5${NB}min`);
  });

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

describe("telemetry, queues and topology", () => {
  test("a telemetry tile, and its chart's axis", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTelemetryDurationMs(0.25, t);
      }),
    ).toEqual(MICROSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTelemetryDurationMs(1250, t);
      }),
    ).toEqual(SECONDS);
    expect(formatTelemetryChartDurationMs(1250)).toBe(`1.25${NB}s`);
    expect(formatTelemetryChartDurationMs(0.25)).toBe(`250${NB}µs`);
  });

  test("a queue's processing time, and its chart's axis", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMessageQueueDurationMsInLanguage(0.25, t);
      }),
    ).toEqual(MICROSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatMessageQueueDurationMsInLanguage(1250, t);
      }),
    ).toEqual(SECONDS);
    expect(formatMessageQueueDurationMs(1250)).toBe(`1.25${NB}s`);
  });

  test("a topology call's average from a second up", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatTopologyDurationMs(1250, t);
      }),
    ).toEqual(SECONDS);
    // Without a translator: English, as a chart's axis.
    expect(formatTopologyDurationMs(1250)).toBe(`1.25${NB}s`);
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
      de: `1,8${NB}s`,
      fr: `1,8${NB}s`,
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
    expect(formatCloudSeconds(2 * 3600 * 150, english)).toBe(`300${NB}h`);
  });

  test("a cloud account's topology card: seconds, minutes and hours", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatCloudTopologySeconds(1.8, t);
      }),
    ).toEqual({
      en: `1.8${NB}s`,
      de: `1,8${NB}s`,
      fr: `1,8${NB}s`,
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
      de: `1,2${NB}s`,
      fr: `1,2${NB}s`,
      ar: `1.2${NB}ث`,
      fa: `۱٫۲${NB}ثانیه`,
    });
    expect(formatReviewDuration(-1, translators["en"]!)).toBe("");
  });

  test("an LLM call: seconds, then minutes and seconds, then hours and minutes", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return formatLlmDuration(2300, t);
      }),
    ).toEqual({
      en: `2.3${NB}s`,
      de: `2,3${NB}s`,
      fr: `2,3${NB}s`,
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
        return formatEvidenceDuration(1200, t);
      }),
    ).toEqual({
      en: `1.2${NB}s`,
      de: `1,2${NB}s`,
      fr: `1,2${NB}s`,
      ar: `1.2${NB}ث`,
      fa: `۱٫۲${NB}ثانیه`,
    });
    expect(
      inEachLanguage((t: Translator): string => {
        return formatEvidenceDuration(59_990, t);
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
        return formatEvidenceDuration(125_000, t);
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
      de: `1,5${NB}s`,
      fr: `1,5${NB}s`,
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

  test("a storage array's latency under a millisecond, on its pages and its widget", () => {
    expect(
      inEachLanguage((t: Translator): string => {
        return StorageArrayResourceUtils.formatLatencyUsec(250, t);
      }),
    ).toEqual(MICROSECONDS);
    expect(
      inEachLanguage((t: Translator): string => {
        return formatWidgetLatencyUsec(250, t);
      }),
    ).toEqual(MICROSECONDS);
    // Without a translator, the widget writes English.
    expect(formatWidgetLatencyUsec(250)).toBe(`250${NB}µs`);
  });

  test("a database metric's seconds, English with the metric's other units, each held to its figure", () => {
    expect(formatDatabaseSeconds(4.2)).toBe(`4.2${NB}s`);
    expect(formatDatabaseSeconds(42)).toBe(`42${NB}s`);
    expect(formatDatabaseSeconds(90)).toBe(`1.5${NB}min`);
    expect(formatDatabaseSeconds(720)).toBe(`12${NB}min`);
    expect(formatDatabaseSeconds(9000)).toBe(`2.5${NB}h`);
    expect(formatDatabaseSeconds(172_800)).toBe(`2${NB}d`);
    expect(formatDatabaseSeconds(null)).toBe("—");
  });
});

describe("negative control: the hand-written units read wrong", () => {
  test("`${(ms / 1000).toFixed(2)} s` keeps Latin digits, an English decimal point and a plain space in Persian", () => {
    const handBuilt: string = `${(1250 / 1000).toFixed(2)} s`;

    expect(handBuilt).not.toBe(SECONDS.fa);
    expect(LATIN_DIGIT.test(handBuilt)).toBe(true);
    expect(BREAKING_SPACE.test(handBuilt)).toBe(true);
    expect(formatMilliseconds(translators["fa"]!, 1250, { unit: "s" })).toBe(
      SECONDS.fa,
    );
    expect(SECONDS.fa).toContain(`ثانیه`);
    expect(MICROSECONDS.fa).toContain(`میکرو`);
    expect(`میلی${ZWNJ}ثانیه`).not.toContain(" ");
  });
});
