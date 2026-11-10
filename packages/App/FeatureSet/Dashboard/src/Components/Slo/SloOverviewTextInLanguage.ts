import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  composedValue,
  createTranslator,
  TemplateValue,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import { SLO_EVALUATION_CADENCE_MINUTES } from "Common/Utils/Slo/SloEvaluation";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "Common/Utils/Slo/SloHealth";
import {
  getSloHeadline,
  SloHeadlineData,
  SloWindowTextData,
} from "Common/Utils/Slo/SloOverviewText";
import { formatSloPercent } from "Common/Utils/Slo/SloWidgetFormat";

/*
 * The SLO overview's own words for a setting, in the reader's language.
 *
 * Common/Utils/Slo/SloOverviewText words each setting in English, once, for
 * every caller - the worker's feed among them - and the overview glued its
 * English into sentences of its own, so a German reader met "the last 30
 * days" and "12 monitors" inside German words. These are the same phrases,
 * each looked up whole and counted the way the reader's language counts.
 * React-free, so a unit test reads them without a renderer.
 *
 * Without a translator they read exactly as SloOverviewText does - what the
 * tests compare them with.
 */
const ENGLISH: Translator = createTranslator(undefined);

// The worker's and SloHealth's fallback: the column's default.
const getWindowDays: (windowDays: number | undefined | null) => number = (
  windowDays: number | undefined | null,
): number => {
  return typeof windowDays === "number" &&
    isFinite(windowDays) &&
    windowDays > 0
    ? windowDays
    : DEFAULT_ROLLING_WINDOW_DAYS;
};

/** "Rolling 30 days" / "Calendar month (Europe/Berlin)" - a chip or a row value. */
export const getSloWindowTextInLanguage: (
  data: SloWindowTextData,
  translator?: Translator,
) => string = (
  data: SloWindowTextData,
  translator: Translator = ENGLISH,
): string => {
  if (data.windowType === SloWindowType.CalendarMonth) {
    return translator.translateTemplate("Calendar month ({{timezone}})", {
      timezone: data.timezone || "UTC",
    });
  }

  return translator.translatePlural(
    { one: "Rolling {{count}} day", other: "Rolling {{count}} days" },
    getWindowDays(data.windowDays),
  );
};

/** "the last 30 days" / "this calendar month (UTC)" - the end of a sentence. */
export const getSloWindowPhraseInLanguage: (
  data: SloWindowTextData,
  translator?: Translator,
) => string = (
  data: SloWindowTextData,
  translator: Translator = ENGLISH,
): string => {
  if (data.windowType === SloWindowType.CalendarMonth) {
    return translator.translateTemplate("this calendar month ({{timezone}})", {
      timezone: data.timezone || "UTC",
    });
  }

  return translator.translatePlural(
    { one: "the last {{count}} day", other: "the last {{count}} days" },
    getWindowDays(data.windowDays),
  );
};

/*
 * The window phrase as a value of another sentence: worded in that
 * sentence's language, so an English sentence (one the reader's language has
 * not worded yet) never holds a German phrase.
 */
export const sloWindowPhraseValue: (
  data: SloWindowTextData,
) => TemplateValue = (data: SloWindowTextData): TemplateValue => {
  return composedValue((sentence: Translator): string => {
    return getSloWindowPhraseInLanguage(data, sentence);
  });
};

/** "No monitors" / "1 monitor" / "12 monitors". */
export const getSloMonitorCountInLanguage: (
  count: number,
  translator?: Translator,
) => string = (count: number, translator: Translator = ENGLISH): string => {
  if (!isFinite(count) || count <= 0) {
    return translator.translateText("No monitors") || "No monitors";
  }

  return translator.translatePlural(
    { one: "{{count}} monitor", other: "{{count}} monitors" },
    count,
  );
};

export const sloMonitorCountValue: (count: number) => TemplateValue = (
  count: number,
): TemplateValue => {
  return composedValue((sentence: Translator): string => {
    return getSloMonitorCountInLanguage(count, sentence);
  });
};

/*
 * A duration put into a sentence ("1h", "1 Std."): written in the
 * sentence's language, and read back as the English "1h" when the reader's
 * language has no wording of the sentence yet.
 */
export const sloDurationValue: (seconds: number) => TemplateValue = (
  seconds: number,
): TemplateValue => {
  return composedValue((sentence: Translator): string => {
    return formatDurationCompactInLanguage(seconds, sentence.language);
  });
};

/** "Runs every 5 minutes": how often the worker evaluates every SLO. */
export const getSloEvaluationCadenceText: (
  translator?: Translator,
) => string = (translator: Translator = ENGLISH): string => {
  return translator.translatePlural(
    {
      // The Runbook schedule's own wording of one minute.
      one: "Runs every minute",
      other: "Runs every {{count}} minutes",
    },
    SLO_EVALUATION_CADENCE_MINUTES,
  );
};

/*
 * The fixed words SloOverviewText answers with, which the overview looks up
 * as they come: listed here so the extractor gives each one a key (a test
 * reads every answer the helpers can give against this list, so a new one
 * cannot be missed).
 */
export const SLO_OVERVIEW_FIXED_TEXTS: ReadonlyArray<string> = [
  // getSloHeadline
  translationKey("Archived — not being measured"),
  translationKey("Disabled — not being measured"),
  translationKey("Cannot be evaluated"),
  translationKey("Measurement paused"),
  translationKey("Waiting for the first evaluation"),
  translationKey("Waiting for monitors"),
  translationKey("Within error budget"),
  translationKey("Error budget running low"),
  translationKey("Error budget exhausted"),
  translationKey("Status unknown"),
  // getSloMultiMonitorModeText
  translationKey("Averaged across monitors"),
  translationKey(
    "Each monitor's downtime counts on its own, so one monitor down out of four spends a quarter of the budget an outage of all four would.",
  ),
  translationKey("Down when any monitor is down"),
  translationKey(
    "A moment counts against the budget whenever at least one monitor is in a downtime status.",
  ),
  // getSliTypeText
  translationKey("Metric"),
  translationKey("Monitor uptime"),
  // getSloDowntimeStatusesText([])
  translationKey("Every non-operational status"),
];

/** The overview's one-line verdict: getSloHeadline, looked up. */
export const getSloHeadlineInLanguage: (
  data: SloHeadlineData,
  translator?: Translator,
) => string = (
  data: SloHeadlineData,
  translator: Translator = ENGLISH,
): string => {
  const headline: string = getSloHeadline(data);

  return translator.translateText(headline) || headline;
};

/** "When 20% or less of the error budget is left". */
export const getSloAtRiskTextInLanguage: (
  atRiskThresholdPercentage: number | undefined | null,
  translator?: Translator,
) => string = (
  atRiskThresholdPercentage: number | undefined | null,
  translator: Translator = ENGLISH,
): string => {
  const threshold: number =
    typeof atRiskThresholdPercentage === "number" &&
    isFinite(atRiskThresholdPercentage)
      ? atRiskThresholdPercentage
      : DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE;

  return translator.translateTemplate(
    "When {{percent}} or less of the error budget is left",
    { percent: formatSloPercent(threshold) || "" },
  );
};

/*
 * "43m 12s of downtime allowed per rolling 30 days" / "... this calendar
 * month": the target restated as the downtime it allows, the duration
 * written in the sentence's language.
 */
export const getSloAllowedDowntimeTextInLanguage: (
  data: {
    seconds: number;
    windowType?: SloWindowType | undefined | null;
    windowDays?: number | undefined | null;
  },
  translator?: Translator,
) => string = (
  data: {
    seconds: number;
    windowType?: SloWindowType | undefined | null;
    windowDays?: number | undefined | null;
  },
  translator: Translator = ENGLISH,
): string => {
  const duration: TemplateValue = sloDurationValue(data.seconds);

  if (data.windowType === SloWindowType.CalendarMonth) {
    return translator.translateTemplate(
      "{{duration}} of downtime allowed this calendar month",
      { duration: duration },
    );
  }

  return translator.translatePlural(
    {
      one: "{{duration}} of downtime allowed per rolling {{count}} day",
      other: "{{duration}} of downtime allowed per rolling {{count}} days",
    },
    getWindowDays(data.windowDays),
    { duration: duration },
  );
};
