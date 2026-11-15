import NtpLeapIndicator from "../../Types/Monitor/NtpMonitor/NtpLeapIndicator";
import NtpMonitorUtil from "../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import {
  SentenceOptions,
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
  values?: Record<string, string>,
  options?: SentenceOptions,
) => string | null = (
  translator: Translator,
  template: string,
  values?: Record<string, string>,
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
    default:
      return null;
  }
};
