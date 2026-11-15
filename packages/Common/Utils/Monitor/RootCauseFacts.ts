import NtpLeapIndicator from "../../Types/Monitor/NtpMonitor/NtpLeapIndicator";
import {
  formatUnitAmount,
  isEnglishDateLanguage,
} from "../../Types/DateLanguage";
import NtpMonitorUtil from "../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import {
  ComposedValue,
  PluralTemplate,
  SentenceOptions,
  TemplateValues,
  translationKey,
  Translator,
} from "../../Types/Translator";
import { formatMilliseconds } from "../Milliseconds";

/*
 * A ROOT CAUSE'S FIGURES, IN THE READER'S DIGITS AND UNITS (#8268).
 *
 * A monitor's root cause lists what the check found under its Response
 * Snapshot: "- Response Time: 411.0 ms", "- Attempts: 3", and for an NTP
 * server that answered "- Stratum: 2 (secondary server)", "- Clock Offset:
 * 0.042 ms ahead of the probe", "- Root Dispersion: 3.25 ms", "- Leap
 * Indicator: 0 (No leap second pending)". The engine writes each figure
 * from a number, in English and in Latin digits, and a Persian page read
 * "زمان پاسخ: 411.0 ms" beside a summary that said "۴۱۱ میلی‌ثانیه".
 *
 * These are OneUptime's own formatting of a number, so the root cause's
 * wording (MonitorRootCauseWording) reads each back here and writes it as
 * the summaries do: a duration with formatMilliseconds, in the reader's
 * unit and digits, a count with translator.formatNumber, an NTP fact with
 * the NTP summary's words. A value is read back only when it is exactly
 * what the engine writes for the number it names (MonitorCriteriaEvaluator's
 * formatMilliseconds, NtpMonitorUtil's describers): anything else - a root cause somebody
 * edited, a value a newer engine writes - stays as stored. A status code is
 * a code, and stays as written.
 *
 * English is never read back: an English page reads the root cause as
 * stored, byte for byte.
 */

/*
 * The decimals the engine writes a response time with: two below 100 ms,
 * one below a second, none above (toFixed, so "411.0 ms").
 */
const getResponseTimeFractionDigits: (milliseconds: number) => number = (
  milliseconds: number,
): number => {
  return milliseconds < 100 ? 2 : milliseconds < 1000 ? 1 : 0;
};

// A stored figure is short: anything longer is no figure the engine wrote.
const MAX_FIGURE_LENGTH: number = 40;

// "411.0 ms", "-3.25 ms": a figure as toFixed writes one, then " ms".
const RESPONSE_TIME: RegExp = /^(-?[0-9]{1,15}(?:\.[0-9]{1,2})?) ms$/;

// "1,532 ms", "0.042 ms": a figure as en-US groups it, then " ms".
const NTP_MILLISECONDS: RegExp =
  /^([0-9]{1,3}(?:,[0-9]{3}){0,5}(?:\.[0-9]{1,3})?) ms$/;

const COUNT: RegExp = /^[0-9]{1,9}$/;

const STRATUM_WITH_MEANING: RegExp = /^([0-9]{1,3}) \((.+)\)$/;

// The response time a stored value names, when the engine wrote exactly it.
export const readRootCauseResponseTime: (stored: string) => number | null = (
  stored: string,
): number | null => {
  if (stored.length > MAX_FIGURE_LENGTH) {
    return null;
  }

  const match: RegExpExecArray | null = RESPONSE_TIME.exec(stored);

  if (!match) {
    return null;
  }

  /*
   * Exactly the engine's figure for that number
   * (MonitorCriteriaEvaluator.formatMilliseconds): its decimals, as toFixed
   * writes them.
   */
  const figure: string = match[1] as string;
  const milliseconds: number = Number(figure);

  return Number.isFinite(milliseconds) &&
    milliseconds.toFixed(getResponseTimeFractionDigits(milliseconds)) === figure
    ? milliseconds
    : null;
};

// An NTP reading in milliseconds, when NtpMonitorUtil wrote exactly it.
const readNtpMilliseconds: (stored: string) => number | null = (
  stored: string,
): number | null => {
  if (stored.length > MAX_FIGURE_LENGTH) {
    return null;
  }

  const match: RegExpExecArray | null = NTP_MILLISECONDS.exec(stored);

  if (!match) {
    return null;
  }

  const milliseconds: number = Number((match[1] as string).split(",").join(""));

  return Number.isFinite(milliseconds) &&
    NtpMonitorUtil.formatMilliseconds(milliseconds) === stored
    ? milliseconds
    : null;
};

// An NTP reading in the reader's unit and digits, as the NTP summary writes it.
const ntpMillisecondsInReadersWords: (
  translator: Translator,
  milliseconds: number,
) => string = (translator: Translator, milliseconds: number): string => {
  return formatMilliseconds(translator, milliseconds, {
    maximumFractionDigits:
      NtpMonitorUtil.getMillisecondsFractionDigits(milliseconds),
  });
};

/*
 * The NTP summary's words for a stratum and a clock offset (NtpMonitorView):
 * the same English NtpMonitorUtil writes into a root cause, but for the
 * capital of "In step with the probe".
 */
const PRIMARY_SERVER: string = translationKey("1 (primary server)");
const SECONDARY_SERVER: string = translationKey(
  "{{stratum}} (secondary server)",
);
const NOT_SYNCHRONIZED: string = translationKey(
  "{{stratum}} (not synchronized)",
);
const KISS_OF_DEATH: string = translationKey("0 (kiss-o'-death {{kissCode}})");
// The root cause's stratum 0 says more than the summary's "0 (not synchronized)".
const UNSPECIFIED_STRATUM: string = translationKey(
  "0 (unspecified, not synchronized)",
);
const IN_STEP: string = translationKey("In step with the probe");
const AHEAD: string = translationKey("{{offset}} ahead of the probe");
const BEHIND: string = translationKey("{{offset}} behind the probe");

const KISS_OF_DEATH_START: string = "0 (kiss-o'-death ";

/*
 * A leap indicator as the root cause writes it, "0 (No leap second
 * pending)": the indicator, then what it means.
 */
const LEAP_INDICATOR_WORDS: Readonly<Record<number, string>> = {
  [NtpLeapIndicator.NoWarning]: translationKey(
    "{{indicator}} (No leap second pending)",
  ),
  [NtpLeapIndicator.LastMinuteHas61Seconds]: translationKey(
    "{{indicator}} (A leap second will be added at the end of the day)",
  ),
  [NtpLeapIndicator.LastMinuteHas59Seconds]: translationKey(
    "{{indicator}} (A leap second will be removed at the end of the day)",
  ),
  [NtpLeapIndicator.Unsynchronized]: translationKey(
    "{{indicator}} (Alarm: the server's clock is not synchronized)",
  ),
};

// A sentence of the reader's, or null while their language has no wording of it.
const worded: (
  translator: Translator,
  template: string,
  values?: TemplateValues,
  options?: SentenceOptions,
) => string | null = (
  translator: Translator,
  template: string,
  values?: TemplateValues,
  options?: SentenceOptions,
): string | null => {
  return translator.hasTranslation(template)
    ? translator.translateTemplate(template, values, options)
    : null;
};

const wordStratum: (
  stored: string,
  translator: Translator,
  options?: SentenceOptions,
) => string | null = (
  stored: string,
  translator: Translator,
  options?: SentenceOptions,
): string | null => {
  if (stored === NtpMonitorUtil.describeStratum(0)) {
    return worded(translator, UNSPECIFIED_STRATUM);
  }

  if (stored === NtpMonitorUtil.describeStratum(1)) {
    return worded(translator, PRIMARY_SERVER);
  }

  if (stored.startsWith(KISS_OF_DEATH_START) && stored.endsWith(")")) {
    const kissCode: string = stored.slice(KISS_OF_DEATH_START.length, -1);

    return kissCode &&
      kissCode.length <= 4 &&
      NtpMonitorUtil.describeStratum(0, kissCode) === stored
      ? worded(translator, KISS_OF_DEATH, { kissCode: kissCode }, options)
      : null;
  }

  if (stored.length > MAX_FIGURE_LENGTH) {
    return null;
  }

  const match: RegExpExecArray | null = STRATUM_WITH_MEANING.exec(stored);

  if (!match || !COUNT.test(match[1] as string)) {
    return null;
  }

  const stratum: number = Number(match[1]);

  if (NtpMonitorUtil.describeStratum(stratum) !== stored || stratum < 2) {
    return null;
  }

  return worded(
    translator,
    match[2] === "secondary server" ? SECONDARY_SERVER : NOT_SYNCHRONIZED,
    { stratum: translator.formatNumber(stratum) },
  );
};

const wordClockOffset: (
  stored: string,
  translator: Translator,
) => string | null = (
  stored: string,
  translator: Translator,
): string | null => {
  if (stored === NtpMonitorUtil.describeClockOffset(0)) {
    return worded(translator, IN_STEP);
  }

  for (const [sign, ending, template] of [
    [1, " ahead of the probe", AHEAD],
    [-1, " behind the probe", BEHIND],
  ] as Array<[number, string, string]>) {
    if (!stored.endsWith(ending)) {
      continue;
    }

    const milliseconds: number | null = readNtpMilliseconds(
      stored.slice(0, -ending.length),
    );

    if (
      milliseconds === null ||
      milliseconds === 0 ||
      NtpMonitorUtil.describeClockOffset(sign * milliseconds) !== stored
    ) {
      return null;
    }

    return worded(translator, template, {
      offset: ntpMillisecondsInReadersWords(translator, milliseconds),
    });
  }

  return null;
};

const wordLeapIndicator: (
  stored: string,
  translator: Translator,
) => string | null = (
  stored: string,
  translator: Translator,
): string | null => {
  for (const indicator of Object.keys(LEAP_INDICATOR_WORDS).map(Number)) {
    if (
      stored ===
      `${indicator} (${NtpMonitorUtil.describeLeapIndicator(indicator)})`
    ) {
      return worded(translator, LEAP_INDICATOR_WORDS[indicator] as string, {
        indicator: translator.formatNumber(indicator),
      });
    }
  }

  return null;
};

/*
 * A METRIC CRITERIA'S LINES, IN THE READER'S LANGUAGE (#8674).
 *
 * A metric criteria's root cause says what it read and when: "- Time
 * Window: last 5 minutes", "- Data Arrives: about 2 minutes late", and a
 * forecast's "- Trend: rising 1.2% a day over the last 7 days, from 168
 * samples", "- In 7 days: **93.2%**", "- Reaches 90%: in about 4 days". The
 * engine writes each from its numbers in English (MonitorCriteriaEvaluator,
 * its durations by MetricWindowCoverage.describeDuration), so each is read
 * back here only when it is exactly one the engine writes, and worded with
 * the reader's plurals and digits. A metric's own value ("93.2%", "1.2 GB")
 * is the metric formatter's, and stays as written.
 */

// "5 minutes", "1 hour", "3 days": a duration's count and unit, as written.
interface WrittenDuration {
  count: number;
  unit: "minute" | "hour" | "day";
}

/*
 * A duration as describeDuration writes it. "less than a minute" reads as
 * no whole minute: a count of 0.
 */
type ReadDuration = WrittenDuration;

const LESS_THAN_A_MINUTE_READ: ReadDuration = { count: 0, unit: "minute" };

const LESS_THAN_A_MINUTE: string = translationKey("less than a minute");

const DURATION_UNITS: Readonly<
  Record<WrittenDuration["unit"], PluralTemplate>
> = {
  minute: {
    one: "{{count}} minute",
    other: translationKey("{{count}} minutes"),
  },
  hour: { one: "{{count}} hour", other: translationKey("{{count}} hours") },
  day: { one: "{{count}} day", other: translationKey("{{count}} days") },
};

const SAMPLES: PluralTemplate = {
  one: "{{count}} sample",
  other: translationKey("{{count}} samples"),
};

// "last 5 minutes": the engine writes minutes for every window, one too.
const LAST_MINUTES: PluralTemplate = {
  one: "last {{count}} minute",
  other: translationKey("last {{count}} minutes"),
};

const ABOUT_LATE: string = translationKey("about {{duration}} late");

// A forecast's trend, by its direction and the period its rate is per.
const TRENDS: Readonly<Record<string, string>> = {
  "rising|a day": translationKey(
    "rising {{rate}} a day over the last {{window}}, from {{samples}}",
  ),
  "rising|an hour": translationKey(
    "rising {{rate}} an hour over the last {{window}}, from {{samples}}",
  ),
  "falling|a day": translationKey(
    "falling {{rate}} a day over the last {{window}}, from {{samples}}",
  ),
  "falling|an hour": translationKey(
    "falling {{rate}} an hour over the last {{window}}, from {{samples}}",
  ),
  flat: translationKey("flat over the last {{window}}, from {{samples}}"),
};

// A forecast's other lines: their labels, and what follows them.
export const FORECAST_NOW: string = translationKey("Now, on its trend");
export const FORECAST_AT_HORIZON: string = translationKey("In {{horizon}}");
export const FORECAST_REACHES: string = translationKey("Reaches {{threshold}}");
export const FORECAST_REACHES_IN: string = translationKey(
  "in about {{duration}}",
);
export const FORECAST_ALREADY: Readonly<Record<string, string>> = {
  above: translationKey("already above it"),
  below: translationKey("already below it"),
};

const DURATION: RegExp = /^([0-9]{1,9}) (minute|hour|day)(s?)$/;
const LAST_MINUTES_TEXT: RegExp = /^last ([0-9]{1,9}) minutes$/;
const ABOUT_LATE_TEXT: RegExp = /^about (.{1,40}) late$/;
const TREND_TEXT: RegExp =
  /^(?:(rising|falling) (.{1,80}) (a day|an hour)|flat) over the last (.{1,40}), from ([0-9]{1,9}) samples?$/;

// The longest metric line the readers below take: no line the engine writes is longer.
const MAX_METRIC_LINE_LENGTH: number = 300;

/*
 * A duration the engine wrote, read back: a count with its unit, singular
 * exactly for one ("1 minute", "2 minutes"), or "less than a minute".
 */
export const readWrittenDuration: (
  text: string,
  units?: ReadonlyArray<WrittenDuration["unit"]>,
) => ReadDuration | null = (
  text: string,
  units?: ReadonlyArray<WrittenDuration["unit"]>,
): ReadDuration | null => {
  if (text === LESS_THAN_A_MINUTE && !units) {
    return LESS_THAN_A_MINUTE_READ;
  }

  const match: RegExpExecArray | null = DURATION.exec(text);

  if (!match) {
    return null;
  }

  const count: number = Number(match[1]);
  const unit: WrittenDuration["unit"] = match[2] as WrittenDuration["unit"];

  if (
    String(count) !== match[1] ||
    count < 1 ||
    (count === 1) !== (match[3] === "") ||
    (units && !units.includes(unit))
  ) {
    return null;
  }

  return { count, unit };
};

/*
 * A duration in the reader's words and digits, as the sentence round it
 * reads: Intl's long unit, which writes each language's own numeral phrase
 * ("7 дней", "3 дня", "7 أيام", "۷ روز") where a label's plural would not
 * ("7 дн.", "الأيام: 7"). English as the engine wrote it.
 */
const durationInWords: (duration: ReadDuration) => ComposedValue = (
  duration: ReadDuration,
): ComposedValue => {
  return {
    compose: (translator: Translator): string => {
      if (duration.count === 0) {
        return (
          translator.translateText(LESS_THAN_A_MINUTE) || LESS_THAN_A_MINUTE
        );
      }

      if (isEnglishDateLanguage(translator.language)) {
        return `${duration.count} ${duration.unit}${duration.count === 1 ? "" : "s"}`;
      }

      // The number held to its unit, as every amount Intl writes is.
      const written: string | null = formatUnitAmount({
        value: duration.count,
        unit: duration.unit,
        locale: translator.language,
        unitDisplay: "long",
      });

      return (
        written ??
        translator.translatePlural(DURATION_UNITS[duration.unit], duration.count)
      );
    },
  };
};

const wordTimeWindow: (
  stored: string,
  translator: Translator,
) => string | null = (
  stored: string,
  translator: Translator,
): string | null => {
  const match: RegExpExecArray | null = LAST_MINUTES_TEXT.exec(stored);

  if (
    !match ||
    String(Number(match[1])) !== match[1] ||
    !translator.hasTranslation(LAST_MINUTES.other)
  ) {
    return null;
  }

  return translator.translatePlural(LAST_MINUTES, Number(match[1]));
};

const wordDataArrives: (
  stored: string,
  translator: Translator,
) => string | null = (
  stored: string,
  translator: Translator,
): string | null => {
  const match: RegExpExecArray | null = ABOUT_LATE_TEXT.exec(stored);
  const duration: ReadDuration | null = match
    ? readWrittenDuration(match[1] as string)
    : null;

  return duration
    ? worded(translator, ABOUT_LATE, { duration: durationInWords(duration) })
    : null;
};

const wordTrend: (
  stored: string,
  translator: Translator,
  options?: SentenceOptions,
) => string | null = (
  stored: string,
  translator: Translator,
  options?: SentenceOptions,
): string | null => {
  if (stored.length > MAX_METRIC_LINE_LENGTH) {
    return null;
  }

  const match: RegExpExecArray | null = TREND_TEXT.exec(stored);

  if (!match) {
    return null;
  }

  const window: ReadDuration | null = readWrittenDuration(match[4] as string);
  const samples: number = Number(match[5]);
  // "from 1 sample", "from 2 samples".
  const isSamplesWritten: boolean =
    String(samples) === match[5] &&
    stored.endsWith(samples === 1 ? " sample" : " samples");
  const template: string | undefined = match[1]
    ? TRENDS[`${match[1]}|${match[3]}`]
    : TRENDS["flat"];

  if (!window || !isSamplesWritten || !template) {
    return null;
  }

  const values: TemplateValues = {
    window: durationInWords(window),
    samples: {
      compose: (sentence: Translator): string => {
        return sentence.translatePlural(SAMPLES, samples);
      },
    },
  };

  if (match[2] !== undefined) {
    // The metric formatter's own value, as written.
    values["rate"] = match[2];
  }

  return worded(translator, template, values, options);
};

// A forecast's line, as the engine writes it after its label.
export interface ForecastLine {
  label: string;
  value: string;
}

/*
 * A forecast's line whose label is not a fixed word - "Now, on its trend",
 * "In 7 days", "Reaches 90%" - read from its text (the stored Markdown read
 * back), in the reader's words: its label and what follows it, the
 * metric's values as written. Null for any other line.
 */
export const wordForecastLine: (data: {
  label: string;
  value: string;
  translator: Translator;
  options?: SentenceOptions | undefined;
}) => ForecastLine | null = (data: {
  label: string;
  value: string;
  translator: Translator;
  options?: SentenceOptions | undefined;
}): ForecastLine | null => {
  const translator: Translator = data.translator;

  if (data.label === "Now, on its trend") {
    return translator.hasTranslation(FORECAST_NOW)
      ? {
          label: translator.translateText(FORECAST_NOW) || "",
          value: data.value,
        }
      : null;
  }

  if (data.label.startsWith("In ")) {
    const horizon: ReadDuration | null = readWrittenDuration(
      data.label.slice("In ".length),
      ["hour", "day"],
    );
    const label: string | null = horizon
      ? worded(translator, FORECAST_AT_HORIZON, {
          horizon: durationInWords(horizon),
        })
      : null;

    return label === null ? null : { label, value: data.value };
  }

  if (data.label.startsWith("Reaches ")) {
    const threshold: string = data.label.slice("Reaches ".length);
    const label: string | null = threshold.trim()
      ? worded(translator, FORECAST_REACHES, { threshold }, data.options)
      : null;
    let value: string | null = null;

    if (data.value.startsWith("in about ")) {
      const duration: ReadDuration | null = readWrittenDuration(
        data.value.slice("in about ".length),
      );

      value = duration
        ? worded(translator, FORECAST_REACHES_IN, {
            duration: durationInWords(duration),
          })
        : null;
    } else {
      const already: string | undefined = Object.values(FORECAST_ALREADY).find(
        (key: string): boolean => {
          return key === data.value;
        },
      );

      value = already ? worded(translator, already) : null;
    }

    return label === null || value === null ? null : { label, value };
  }

  return null;
};
/*
 * A fact's value under a root cause's Response Snapshot - its text, read
 * back from the stored Markdown - in the reader's digits and units, when
 * the engine wrote exactly that figure; null for any other value, and for
 * one the reader's language does not word yet, which stays as stored.
 */
export const wordRootCauseFact: (data: {
  label: string;
  value: string;
  translator: Translator;
  options?: SentenceOptions | undefined;
}) => string | null = (data: {
  label: string;
  value: string;
  translator: Translator;
  options?: SentenceOptions | undefined;
}): string | null => {
  const translator: Translator = data.translator;
  const value: string = data.value;

  switch (data.label) {
    case "Response Time": {
      const milliseconds: number | null = readRootCauseResponseTime(value);

      return milliseconds === null
        ? null
        : formatMilliseconds(translator, milliseconds, {
            maximumFractionDigits: getResponseTimeFractionDigits(milliseconds),
          });
    }
    case "Attempts":
      return COUNT.test(value) && String(Number(value)) === value
        ? translator.formatNumber(Number(value))
        : null;
    case "Stratum":
      return wordStratum(value, translator, data.options);
    case "Clock Offset":
      return wordClockOffset(value, translator);
    case "Root Dispersion": {
      const milliseconds: number | null = readNtpMilliseconds(value);

      return milliseconds === null
        ? null
        : ntpMillisecondsInReadersWords(translator, milliseconds);
    }
    case "Leap Indicator":
      return wordLeapIndicator(value, translator);
    case "Time Window":
      return wordTimeWindow(value, translator);
    case "Data Arrives":
      return wordDataArrives(value, translator);
    case "Trend":
      return wordTrend(value, translator, data.options);
    default:
      return null;
  }
};
