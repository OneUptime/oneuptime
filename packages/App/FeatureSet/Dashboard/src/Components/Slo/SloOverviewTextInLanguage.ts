import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  composedValue,
  createTranslator,
  getInlineSeparator,
  SentenceOptions,
  TemplateValue,
  translationKey,
  Translator,
} from "Common/Types/Translator";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import {
  SLO_CURRENT_BURN_RATE_WINDOW_MINUTES,
  SLO_EVALUATION_CADENCE_MINUTES,
} from "Common/Utils/Slo/SloEvaluation";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "Common/Utils/Slo/SloHealth";
import {
  getSloHeadline,
  SloHeadlineData,
  SloWindowTextData,
} from "Common/Utils/Slo/SloOverviewText";
import {
  getSliDelta,
  SliDelta,
  SliDeltaSide,
  SliVersusTargetData,
  SloBudgetRunway,
  SloBudgetRunwayKind,
  SloRollingWindowFill,
} from "Common/Utils/Slo/SloProjection";
import {
  formatSloNumber,
  formatSloPercent,
  SLI_DECIMALS,
  SLO_NOT_EVALUATED_TEXT,
} from "Common/Utils/Slo/SloWidgetFormat";

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
  // getSloBudgetRemainingText
  translationKey("Budget exceeded"),
  translationKey("No budget left"),
  // getSloBudgetRunway's reasons for not projecting
  translationKey("Not projected when downtime is averaged across monitors"),
  translationKey("Needs a target between 0% and 100%"),
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
    { percent: formatSloPercent(threshold, undefined, translator) || "" },
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

const EM_DASH: string = "—";

/*
 * A share of the error budget as a duration in a sentence: "12m 30s", and
 * "under 1s" for a sliver the compact format would floor to "0s" - the
 * KPI strip's words for the budget (SloDuration's formatBudgetDuration).
 */
const sloBudgetDurationValue: (seconds: number) => TemplateValue = (
  seconds: number,
): TemplateValue => {
  return composedValue((sentence: Translator): string => {
    if (seconds !== 0 && Math.abs(seconds) < 1) {
      return sentence.translateText("under 1s") || "under 1s";
    }

    return formatDurationCompactInLanguage(seconds, sentence.language);
  });
};

/*
 * "0.026 pp below the 99.9% target": getSliDeltaText, looked up, with the
 * gap and the target written the reader's way ("0,026", "99,9 %").
 */
export const getSliDeltaTextInLanguage: (
  data: SliVersusTargetData,
  translator?: Translator,
  options?: SentenceOptions,
) => string | null = (
  data: SliVersusTargetData,
  translator: Translator = ENGLISH,
  options?: SentenceOptions,
): string | null => {
  const delta: SliDelta | null = getSliDelta(data);

  if (delta === null) {
    return null;
  }

  const values: { target: string; delta: string } = {
    target:
      formatSloPercent(data.targetPercentage, SLI_DECIMALS, translator) ||
      delta.targetText,
    delta:
      formatSloNumber(delta.percentagePoints, SLI_DECIMALS, translator) ||
      String(delta.percentagePoints),
  };

  switch (delta.side) {
    case SliDeltaSide.JustBelow:
      return translator.translateTemplate(
        "Just below the {{target}} target",
        values,
        options,
      );
    case SliDeltaSide.JustAbove:
      return translator.translateTemplate(
        "Just above the {{target}} target",
        values,
        options,
      );
    case SliDeltaSide.OnTarget:
      return translator.translateTemplate(
        "Exactly on the {{target}} target",
        values,
        options,
      );
    case SliDeltaSide.Above:
      return translator.translateTemplate(
        "{{delta}} pp above the {{target}} target",
        values,
        options,
      );
    case SliDeltaSide.Below:
    default:
      return translator.translateTemplate(
        "{{delta}} pp below the {{target}} target",
        values,
        options,
      );
  }
};

export interface SloBudgetSecondsData {
  remainingSeconds: number | undefined | null;
  totalSeconds: number | undefined | null;
}

/*
 * "12m 30s left of 43m 12s" / "5m over budget · 43m 12s allowed":
 * formatErrorBudgetRemainingOfTotal, looked up. Null before the first
 * evaluation, so the caller says "not evaluated" its own way.
 */
export const getErrorBudgetRemainingOfTotalInLanguage: (
  data: SloBudgetSecondsData,
  translator?: Translator,
  options?: SentenceOptions,
) => string | null = (
  data: SloBudgetSecondsData,
  translator: Translator = ENGLISH,
  options?: SentenceOptions,
): string | null => {
  const remaining: number | null =
    typeof data.remainingSeconds === "number" && isFinite(data.remainingSeconds)
      ? data.remainingSeconds
      : null;

  if (remaining === null) {
    return null;
  }

  const total: number | null =
    typeof data.totalSeconds === "number" &&
    isFinite(data.totalSeconds) &&
    data.totalSeconds > 0
      ? data.totalSeconds
      : null;

  const remainingValue: TemplateValue = sloBudgetDurationValue(remaining);

  // A zero total is a brand-new SLO's: "of 0s" adds nothing.
  if (total === null) {
    return remaining < 0
      ? translator.translateTemplate(
          "{{duration}} over budget",
          { duration: remainingValue },
          options,
        )
      : translator.translateTemplate(
          "{{duration}} left",
          { duration: remainingValue },
          options,
        );
  }

  const totalValue: TemplateValue = sloBudgetDurationValue(total);

  return remaining < 0
    ? translator.translateTemplate(
        "{{remaining}} over budget · {{total}} allowed",
        { remaining: remainingValue, total: totalValue },
        options,
      )
    : translator.translateTemplate(
        "{{remaining}} left of {{total}}",
        { remaining: remainingValue, total: totalValue },
        options,
      );
};

/*
 * The error budget's headline: "42.5%" as it is, or the words
 * getSloBudgetRemainingText answers a spent budget with ("Budget exceeded",
 * "No budget left"), looked up.
 */
export const getSloBudgetRemainingTextInLanguage: (
  text: string | null,
  translator?: Translator,
) => string | null = (
  text: string | null,
  translator: Translator = ENGLISH,
): string | null => {
  if (text === null) {
    return null;
  }

  return translator.translateText(text) || text;
};

/*
 * "Window 25% full" (a badge of its own) / "window 25% full" (after other
 * words on a line): how much of a young rolling window holds data yet, the
 * count written in the reader's digits ("۲۵٪" in Persian).
 */
export const getRollingWindowFillTextInLanguage: (
  fill: SloRollingWindowFill,
  translator?: Translator,
  placement?: { afterOtherWords?: boolean | undefined },
) => string = (
  fill: SloRollingWindowFill,
  translator: Translator = ENGLISH,
  placement?: { afterOtherWords?: boolean | undefined },
): string => {
  const values: { percent: string } = {
    percent:
      formatSloNumber(fill.percent, 0, translator) || String(fill.percent),
  };

  if (placement?.afterOtherWords) {
    return fill.percent < 1
      ? translator.translateText("window under 1% full") ||
          "window under 1% full"
      : translator.translateTemplate("window {{percent}}% full", values);
  }

  return fill.percent < 1
    ? translator.translateText("Window under 1% full") || "Window under 1% full"
    : translator.translateTemplate("Window {{percent}}% full", values);
};

export interface SloBudgetRunwayText {
  value: string;
  description: string;
}

export interface SloBudgetRunwayTextData {
  runway: SloBudgetRunway;
  errorBudgetRemainingSeconds: number | undefined | null;
  windowDays: number | undefined | null;
}

/*
 * The KPI strip's runway tile - "~2d 5h" over "Until exhausted, at the burn
 * rate of the last 1h" - looked up: getSloBudgetRunway's answer, worded from
 * its kind the way getSloBudgetRunway words it in English.
 */
export const getSloBudgetRunwayTextInLanguage: (
  data: SloBudgetRunwayTextData,
  translator?: Translator,
  options?: SentenceOptions,
) => SloBudgetRunwayText = (
  data: SloBudgetRunwayTextData,
  translator: Translator = ENGLISH,
  options?: SentenceOptions,
): SloBudgetRunwayText => {
  const runway: SloBudgetRunway = data.runway;
  const lookbackValue: TemplateValue = sloDurationValue(
    SLO_CURRENT_BURN_RATE_WINDOW_MINUTES * 60,
  );

  // "... · resets in 12d 4h", for a calendar month.
  const withReset: (words: string) => string = (words: string): string => {
    if (runway.secondsUntilReset === null) {
      return words;
    }

    return `${words}${getInlineSeparator(translator.language)}${translator.translateTemplate(
      "resets in {{duration}}",
      { duration: sloDurationValue(runway.secondsUntilReset) },
      options,
    )}`;
  };

  switch (runway.kind) {
    case SloBudgetRunwayKind.NotEvaluated:
      return {
        value: EM_DASH,
        description:
          translator.translateText(SLO_NOT_EVALUATED_TEXT) ||
          SLO_NOT_EVALUATED_TEXT,
      };
    case SloBudgetRunwayKind.NotProjected:
      return {
        value: EM_DASH,
        description:
          translator.translateText(runway.description) || runway.description,
      };
    case SloBudgetRunwayKind.Overspent: {
      const remaining: number =
        typeof data.errorBudgetRemainingSeconds === "number" &&
        isFinite(data.errorBudgetRemainingSeconds)
          ? data.errorBudgetRemainingSeconds
          : 0;

      return {
        value: translator.translateText("Overspent") || "Overspent",
        description: withReset(
          remaining < 0
            ? translator.translateTemplate(
                "{{duration}} over budget",
                { duration: sloDurationValue(remaining) },
                options,
              )
            : translator.translateText("Budget fully spent") ||
                "Budget fully spent",
        ),
      };
    }
    case SloBudgetRunwayKind.NotBurning:
      return {
        value: translator.translateText("Not burning") || "Not burning",
        description: withReset(
          translator.translateTemplate(
            "No budget spent in the last {{window}}",
            { window: lookbackValue },
            options,
          ),
        ),
      };
    case SloBudgetRunwayKind.LastsUntilReset:
      return {
        value:
          translator.translateText("Lasts until reset") || "Lasts until reset",
        description: translator.translateTemplate(
          "Resets in {{reset}}, at the burn rate of the last {{window}}",
          {
            reset: sloDurationValue(runway.secondsUntilReset || 0),
            window: lookbackValue,
          },
          options,
        ),
      };
    case SloBudgetRunwayKind.Sustainable:
      return {
        value: translator.translateText("Sustainable") || "Sustainable",
        description: translator.translatePlural(
          {
            one: "Outlasts the {{count}}-day window, at the burn rate of the last {{window}}",
            other:
              "Outlasts the {{count}}-day window, at the burn rate of the last {{window}}",
          },
          getWindowDays(data.windowDays),
          { window: lookbackValue },
          options,
        ),
      };
    case SloBudgetRunwayKind.RunsOut:
    default: {
      const seconds: number = runway.runwaySeconds || 0;

      return {
        // Under a minute the compact format floors to "~0s", which reads as "now".
        value:
          seconds < 60
            ? translator.translateText("Under 1m") || "Under 1m"
            : `~${formatDurationCompactInLanguage(seconds, translator.language)}`,
        description: withReset(
          translator.translateTemplate(
            "Until exhausted, at the burn rate of the last {{window}}",
            { window: lookbackValue },
            options,
          ),
        ),
      };
    }
  }
};
