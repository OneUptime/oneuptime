import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import { SloWidgetMetric } from "../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import {
  getNumberLocale,
  isEnglishDateLanguage,
} from "../../Types/DateLanguage";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import {
  fillTemplate,
  PluralTemplate,
  SentenceOptions,
  translationKey,
  Translator,
} from "../../Types/Translator";

/**
 * Pure value/label derivation for the dashboard SLO widget.
 *
 * Everything the widget needs to turn a ServiceLevelObjective row into
 * display strings lives here rather than in the React renderer, so the
 * formatting rules (and every null / negative / rounding edge) are
 * unit-testable without a DOM.
 *
 * The worker-maintained state columns on ServiceLevelObjective are NULL
 * until the SLO is first evaluated, so every entry point must be able to
 * answer "not evaluated yet" instead of rendering "null%" or "NaN%".
 *
 * Each helper takes the reader's Translator as an optional last argument
 * (the Dashboard passes useTranslator()). With one, a figure is written the
 * way the reader's language writes it - "99,874 %" in German, "۹۹٫۸۷۴٪" in
 * Persian, Latin digits in Arabic (DateLanguage's LATIN_DIGIT_LANGUAGES) -
 * and the words are the reader's: each is a key of the Dashboard's locales,
 * read from this file by the extractor (SOURCE_ROOTS in
 * scripts/i18n/ExtractStrings.ts), which reads only what the file marks.
 * Without one, and for an English reader, every text reads exactly as it
 * always did: what the API, Terraform, the server and a unit test get.
 */

/** Shown in place of a number whenever the SLO has no evaluated state. */
export const SLO_NOT_EVALUATED_TEXT: string =
  translationKey("Not evaluated yet");

/** U+2212 MINUS SIGN — reads as a minus rather than a hyphen at tile sizes. */
const MINUS_SIGN: string = "−";

/** U+00D7 MULTIPLICATION SIGN — burn rate is a multiplier ("3.2×"). */
const MULTIPLICATION_SIGN: string = "×";

/*
 * U+200E LEFT-TO-RIGHT MARK. On a page read right to left the burn rate's
 * sign is set between two of them, as Intl sets Arabic's percent sign (a
 * mark on each side of the "%"): the sign then stays after its figure,
 * where the percentages beside it keep theirs - "14.4×" in a tile, a table
 * cell and after a rule's name ("Fast burn 14.4×"), never "×14.4" or
 * "×Fast burn 14.4", which the bidi algorithm draws for a bare "×" at the
 * end of a line read right to left.
 */
const LEFT_TO_RIGHT_MARK: string = String.fromCharCode(0x200e);

/*
 * The line under the error budget: "43 min remaining", "−42 min over
 * budget". Each case is a whole sentence of its own, so a language words
 * it its way - and counts its minutes its way, which is why the forms are
 * plurals even where English writes "min" for any count.
 */
const MINUTES_REMAINING: PluralTemplate = {
  one: translationKey("{{count}} min remaining"),
  other: translationKey("{{count}} min remaining"),
};

const MINUTES_OVER_BUDGET: PluralTemplate = {
  one: translationKey("−{{count}} min over budget"),
  other: translationKey("−{{count}} min over budget"),
};

const UNDER_A_MINUTE_REMAINING: string = translationKey(
  "under 1 min remaining",
);

const UNDER_A_MINUTE_OVER_BUDGET: string = translationKey(
  "under 1 min over budget",
);

/** "target 99.9%": the line under an SLI, on the widget and the SLO list. */
export const SLO_TARGET_SUBLINE_TEMPLATE: string =
  translationKey("target {{target}}");

/*
 * The widget's title is the SLO's name and the metric's label: a name as
 * written, set apart from the line where it reads the other way (an English
 * name on an Arabic dashboard), and the label in the reader's words.
 */
const TITLE_OPTIONS: SentenceOptions = { setsValuesApart: true };

/**
 * The subset of ServiceLevelObjective the widget reads. Declared
 * structurally (rather than importing the database model) so this helper
 * stays dependency-free and tests can pass plain objects. Every state
 * field is nullable because the evaluation worker has not necessarily
 * run yet.
 */
export interface SloWidgetStateData {
  name?: string | undefined | null;
  targetPercentage?: number | undefined | null;
  currentSliPercentage?: number | undefined | null;
  errorBudgetRemainingPercentage?: number | undefined | null;
  errorBudgetRemainingSeconds?: number | undefined | null;
  currentBurnRate?: number | undefined | null;
  sloStatus?: SloStatus | undefined | null;
}

export interface SloWidgetTileDisplay {
  /** False when the metric's state column is null/undefined/non-finite. */
  isEvaluated: boolean;
  /** The big number, or SLO_NOT_EVALUATED_TEXT when isEvaluated is false. */
  value: string;
  /** Secondary line under the number, or null when there is nothing to add. */
  subline: string | null;
}

/**
 * `null` for anything that is not a real, finite number — which includes
 * the un-evaluated NULL columns, and NaN/Infinity should a bad row ever
 * reach the client. Booleans and strings are rejected too so a JSON
 * round-trip cannot smuggle `"99.9"` past the finite check.
 */
type ToFiniteNumberFunction = (
  value: number | undefined | null,
) => number | null;

const toFiniteNumber: ToFiniteNumberFunction = (
  value: number | undefined | null,
): number | null => {
  if (typeof value !== "number" || !isFinite(value)) {
    return null;
  }

  return value;
};

/**
 * Round to at most `maxDecimals` places. Number -> string conversion drops
 * trailing zeros for free, so 99.90 renders "99.9" and 100 renders "100"
 * instead of "99.90" / "100.00".
 */
type RoundToDecimalsFunction = (value: number, maxDecimals: number) => number;

const roundToDecimals: RoundToDecimalsFunction = (
  value: number,
  maxDecimals: number,
): number => {
  const factor: number = Math.pow(10, maxDecimals);

  /*
   * `+ 0` normalises -0 (which Math.round can produce from a tiny
   * negative) so it never renders as "-0".
   */
  return Math.round(value * factor) / factor + 0;
};

/**
 * SLI is quoted to three decimals to match the SLO pages — the digits past
 * the second matter at 99.99x targets. Error budget remaining is a coarse
 * gauge, so one decimal is enough; the precise number lives in the
 * seconds subline.
 */
export const SLI_DECIMALS: number = 3;
export const BUDGET_PERCENT_DECIMALS: number = 1;
export const BURN_RATE_DECIMALS: number = 2;

/*
 * One Intl format per language, kind and precision: the SLO pages write the
 * same few figures many times on every render.
 */
const figureFormats: Map<string, Intl.NumberFormat | null> = new Map<
  string,
  Intl.NumberFormat | null
>();

interface FigureData {
  // Already rounded to at most `maxDecimals` places.
  rounded: number;
  maxDecimals: number;
  isPercent: boolean;
}

/*
 * A rounded figure as `language` writes it: its decimal mark, its digits
 * and, for a percentage, its own sign and spacing - "99,874 %" in German,
 * "99,874%" in Italian, "۹۹٫۸۷۴٪" in Persian, Latin digits in Arabic
 * (getNumberLocale). Null when Intl cannot write it.
 */
type WriteFigureInLanguageFunction = (
  figure: FigureData,
  language: string,
) => string | null;

const writeFigureInLanguage: WriteFigureInLanguageFunction = (
  figure: FigureData,
  language: string,
): string | null => {
  const key: string = [
    language,
    figure.isPercent ? "percent" : "decimal",
    figure.maxDecimals,
  ].join("|");

  if (!figureFormats.has(key)) {
    let format: Intl.NumberFormat | null = null;

    try {
      format = new Intl.NumberFormat(getNumberLocale(language), {
        style: figure.isPercent ? "percent" : "decimal",
        maximumFractionDigits: figure.maxDecimals,
      });
    } catch {
      format = null;
    }

    figureFormats.set(key, format);
  }

  const format: Intl.NumberFormat | null = figureFormats.get(key) || null;

  if (!format) {
    return null;
  }

  return format.format(
    figure.isPercent ? figure.rounded / 100 : figure.rounded,
  );
};

/*
 * A rounded figure for the reader: in the reader's language, or exactly as
 * it always read ("99.874%", "1440.5") without a translator and for an
 * English reader, whose figures never took a thousands separator.
 */
type WriteFigureFunction = (
  figure: FigureData,
  translator: Translator | undefined,
) => string;

const writeFigure: WriteFigureFunction = (
  figure: FigureData,
  translator: Translator | undefined,
): string => {
  const plain: string = `${figure.rounded}${figure.isPercent ? "%" : ""}`;

  if (!translator || isEnglishDateLanguage(translator.language)) {
    return plain;
  }

  return writeFigureInLanguage(figure, translator.language) ?? plain;
};

/**
 * A figure with no unit of its own - a gap in percentage points, a rule's
 * threshold in a sentence that writes its "×" - rounded to at most
 * `maxDecimals` places and written the reader's way.
 */
export type FormatSloNumberFunction = (
  value: number | undefined | null,
  maxDecimals: number,
  translator?: Translator | undefined,
) => string | null;

export const formatSloNumber: FormatSloNumberFunction = (
  value: number | undefined | null,
  maxDecimals: number,
  translator?: Translator | undefined,
): string | null => {
  const numericValue: number | null = toFiniteNumber(value);

  if (numericValue === null) {
    return null;
  }

  return writeFigure(
    {
      rounded: roundToDecimals(numericValue, maxDecimals),
      maxDecimals: maxDecimals,
      isPercent: false,
    },
    translator,
  );
};

export type FormatSloPercentFunction = (
  value: number | undefined | null,
  maxDecimals?: number | undefined,
  translator?: Translator | undefined,
) => string | null;

export const formatSloPercent: FormatSloPercentFunction = (
  value: number | undefined | null,
  maxDecimals?: number | undefined,
  translator?: Translator | undefined,
): string | null => {
  const numericValue: number | null = toFiniteNumber(value);

  if (numericValue === null) {
    return null;
  }

  const decimals: number = maxDecimals ?? SLI_DECIMALS;

  return writeFigure(
    {
      rounded: roundToDecimals(numericValue, decimals),
      maxDecimals: decimals,
      isPercent: true,
    },
    translator,
  );
};

export type FormatSloBurnRateFunction = (
  value: number | undefined | null,
  translator?: Translator | undefined,
) => string | null;

export const formatSloBurnRate: FormatSloBurnRateFunction = (
  value: number | undefined | null,
  translator?: Translator | undefined,
): string | null => {
  const figure: string | null = formatSloNumber(
    value,
    BURN_RATE_DECIMALS,
    translator,
  );

  if (figure === null) {
    return null;
  }

  return translator && isRightToLeftLanguage(translator.language)
    ? `${figure}${LEFT_TO_RIGHT_MARK}${MULTIPLICATION_SIGN}${LEFT_TO_RIGHT_MARK}`
    : `${figure}${MULTIPLICATION_SIGN}`;
};

/**
 * `errorBudgetRemainingSeconds` is SIGNED: negative means the budget is
 * overspent. Render the overage plainly ("−42 min over budget") rather
 * than clamping it to zero, which would hide a breach.
 */
export type FormatErrorBudgetRemainingSecondsFunction = (
  seconds: number | undefined | null,
  translator?: Translator | undefined,
) => string | null;

export const formatErrorBudgetRemainingSeconds: FormatErrorBudgetRemainingSecondsFunction =
  (
    seconds: number | undefined | null,
    translator?: Translator | undefined,
  ): string | null => {
    const numericSeconds: number | null = toFiniteNumber(seconds);

    if (numericSeconds === null) {
      return null;
    }

    const isOverBudget: boolean = numericSeconds < 0;
    const minutes: number = Math.round(Math.abs(numericSeconds) / 60);

    /*
     * Exactly zero is a real state worth stating ("0 min remaining"); a
     * sub-30-second remainder would otherwise round to a misleading "0 min".
     */
    if (minutes === 0 && numericSeconds !== 0) {
      const underAMinute: string = isOverBudget
        ? UNDER_A_MINUTE_OVER_BUDGET
        : UNDER_A_MINUTE_REMAINING;

      return translator
        ? translator.translateText(underAMinute) || underAMinute
        : underAMinute;
    }

    if (!translator) {
      return `${isOverBudget ? MINUS_SIGN : ""}${minutes} min ${
        isOverBudget ? "over budget" : "remaining"
      }`;
    }

    return translator.translatePlural(
      isOverBudget ? MINUTES_OVER_BUDGET : MINUTES_REMAINING,
      minutes,
      {
        count: writeFigure(
          { rounded: minutes, maxDecimals: 0, isPercent: false },
          translator,
        ),
      },
    );
  };

export type GetSloMetricLabelFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
  translator?: Translator | undefined,
) => string;

export const getSloMetricLabel: GetSloMetricLabelFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
  translator?: Translator | undefined,
): string => {
  // Sli is the default metric, so it is also the fallback label.
  let label: string = translationKey("SLI");

  if (sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    label = translationKey("Error Budget Remaining");
  } else if (sloMetric === SloWidgetMetric.BurnRate) {
    label = translationKey("Burn Rate");
  }

  return translator ? translator.translateText(label) || label : label;
};

/**
 * ClickHouse `SloHistory.metricName` value for each widget metric — the
 * strings the evaluation worker writes.
 */
export type GetSloHistoryMetricNameFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
) => string;

export const getSloHistoryMetricName: GetSloHistoryMetricNameFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
): string => {
  if (sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    return "error.budget.remaining.percent";
  }

  if (sloMetric === SloWidgetMetric.BurnRate) {
    return "burn.rate";
  }

  return "sli.percent";
};

/** What the widget's header is made of (getSloWidgetTitle). */
export interface SloWidgetTitleData {
  widgetTitle?: string | undefined | null;
  sloName?: string | undefined | null;
  sloMetric?: SloWidgetMetric | undefined | null;
  /*
   * True for a widget that follows a toolbar variable instead of being
   * pinned. Its SLO is DATA — it changes with the reader's pick — so the
   * resolved name leads even an author-set title ("Checkout API · SLI"),
   * where a pinned widget's own title stands alone.
   */
  followsSelection?: boolean | undefined;
  /*
   * The reader's: the metric's label in their words, the name and the
   * author's title as written, with the separator their language puts
   * between two facts on a line (getInlineSeparator).
   */
  translator?: Translator | undefined;
}

/**
 * A header that holds the SLO's name, in pieces: the sentence around the
 * name - its English template, a key of the locales - and the name, as
 * written.
 *
 * Drawn as one line, the sentence reads the reader's way, so on an Arabic
 * dashboard an English name in it lost its START where the tile cut the
 * line ("...T AVAILABILITY (EU WEST, 30 DAYS)"), and took the metric after
 * it out of sight. The widget draws a name that reads the other way in a
 * box of its own (TranslatedSentence), cut at its own end.
 */
export interface SloWidgetTitleSentence {
  template: string;
  name: string;
  // The sentence's other value: the metric's label, or the author's title.
  values: Record<string, string>;
}

export type GetSloWidgetTitleSentenceFunction = (
  data: SloWidgetTitleData,
) => SloWidgetTitleSentence | null;

/*
 * Null for a header of one piece: the author's own title on a pinned
 * widget, or the metric's label before the SLO's name is known.
 */
export const getSloWidgetTitleSentence: GetSloWidgetTitleSentenceFunction = (
  data: SloWidgetTitleData,
): SloWidgetTitleSentence | null => {
  const trimmedTitle: string = (data.widgetTitle || "").trim();
  const trimmedName: string = (data.sloName || "").trim();

  if (!trimmedName || (trimmedTitle && !data.followsSelection)) {
    return null;
  }

  if (trimmedTitle) {
    return {
      template: "{{name}} · {{title}}",
      name: trimmedName,
      values: { title: trimmedTitle },
    };
  }

  return {
    template: "{{name}} · {{metric}}",
    name: trimmedName,
    values: { metric: getSloMetricLabel(data.sloMetric, data.translator) },
  };
};

/**
 * Widget header: the author's title wins; otherwise fall back to the SLO
 * name plus the metric label so an unnamed widget still says what it is.
 * A whitespace-only title counts as empty.
 */
export type GetSloWidgetTitleFunction = (data: SloWidgetTitleData) => string;

export const getSloWidgetTitle: GetSloWidgetTitleFunction = (
  data: SloWidgetTitleData,
): string => {
  const translator: Translator | undefined = data.translator;
  const sentence: SloWidgetTitleSentence | null =
    getSloWidgetTitleSentence(data);

  if (!sentence) {
    return (
      (data.widgetTitle || "").trim() ||
      getSloMetricLabel(data.sloMetric, translator)
    );
  }

  const values: Record<string, string> = {
    name: sentence.name,
    ...sentence.values,
  };

  return translator
    ? translator.translateTemplate(sentence.template, values, TITLE_OPTIONS)
    : fillTemplate(sentence.template, values);
};

/**
 * "target 99.9%" under an SLI, or null when the SLO has no target - in the
 * reader's words and with the figure written their way when a translator
 * is passed.
 */
export type FormatSloTargetSublineFunction = (
  targetPercentage: number | undefined | null,
  translator?: Translator | undefined,
) => string | null;

export const formatSloTargetSubline: FormatSloTargetSublineFunction = (
  targetPercentage: number | undefined | null,
  translator?: Translator | undefined,
): string | null => {
  const target: string | null = formatSloPercent(
    targetPercentage,
    SLI_DECIMALS,
    translator,
  );

  if (target === null) {
    return null;
  }

  return translator
    ? translator.translateTemplate(SLO_TARGET_SUBLINE_TEMPLATE, {
        target: target,
      })
    : `target ${target}`;
};

/**
 * Everything the tile renders for one metric. Returns the explicit
 * not-evaluated state whenever the metric's own state column is missing,
 * so the caller never has to guard against "null%" itself.
 */
export type GetSloWidgetTileDisplayFunction = (data: {
  sloMetric?: SloWidgetMetric | undefined | null;
  slo?: SloWidgetStateData | undefined | null;
  // The reader's, for the figures, the line under them and "Not evaluated yet".
  translator?: Translator | undefined;
}) => SloWidgetTileDisplay;

export const getSloWidgetTileDisplay: GetSloWidgetTileDisplayFunction = (data: {
  sloMetric?: SloWidgetMetric | undefined | null;
  slo?: SloWidgetStateData | undefined | null;
  translator?: Translator | undefined;
}): SloWidgetTileDisplay => {
  const translator: Translator | undefined = data.translator;

  const notEvaluated: SloWidgetTileDisplay = {
    isEvaluated: false,
    value: translator
      ? translator.translateText(SLO_NOT_EVALUATED_TEXT) ||
        SLO_NOT_EVALUATED_TEXT
      : SLO_NOT_EVALUATED_TEXT,
    subline: null,
  };

  const slo: SloWidgetStateData | undefined | null = data.slo;

  if (!slo) {
    return notEvaluated;
  }

  if (data.sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    const value: string | null = formatSloPercent(
      slo.errorBudgetRemainingPercentage,
      BUDGET_PERCENT_DECIMALS,
      translator,
    );

    if (value === null) {
      return notEvaluated;
    }

    return {
      isEvaluated: true,
      value: value,
      subline: formatErrorBudgetRemainingSeconds(
        slo.errorBudgetRemainingSeconds,
        translator,
      ),
    };
  }

  if (data.sloMetric === SloWidgetMetric.BurnRate) {
    const value: string | null = formatSloBurnRate(
      slo.currentBurnRate,
      translator,
    );

    if (value === null) {
      return notEvaluated;
    }

    return {
      isEvaluated: true,
      value: value,
      subline: null,
    };
  }

  // Sli (also the default when the argument was never set).
  const value: string | null = formatSloPercent(
    slo.currentSliPercentage,
    SLI_DECIMALS,
    translator,
  );

  if (value === null) {
    return notEvaluated;
  }

  return {
    isEvaluated: true,
    value: value,
    subline: formatSloTargetSubline(slo.targetPercentage, translator),
  };
};

/**
 * Bucket size for the Chart display, picked from the dashboard's selected
 * window so the point count stays bounded no matter how often the worker
 * writes (it writes every ~5 minutes today). Same reasoning as the SLO
 * detail page's charts: aggregate server-side rather than pulling raw
 * rows under a row-count cap, which silently truncates long windows.
 *
 *   <= 12h  -> 5-minute buckets  (<= 144 points, the native write cadence)
 *   <= 3d   -> 30-minute buckets (<= 144 points)
 *   <= 45d  -> hourly buckets    (<= 1,080 points)
 *   >  45d  -> daily buckets     (<= ~365 points for a year)
 */
export type GetSloChartAggregationIntervalFunction = (
  rangeInMinutes: number,
) => AggregationInterval;

export const getSloChartAggregationInterval: GetSloChartAggregationIntervalFunction =
  (rangeInMinutes: number): AggregationInterval => {
    if (!isFinite(rangeInMinutes) || rangeInMinutes <= 12 * 60) {
      return AggregationInterval.FiveMinutes;
    }

    if (rangeInMinutes <= 3 * 24 * 60) {
      return AggregationInterval.ThirtyMinutes;
    }

    if (rangeInMinutes <= 45 * 24 * 60) {
      return AggregationInterval.Hour;
    }

    return AggregationInterval.Day;
  };

/**
 * Y-axis / tooltip formatter for the Chart display. Bare numbers are
 * ambiguous across the three metrics (a "3" could be 3% or 3× budget
 * burn), so each metric carries its own unit.
 */
export type FormatSloChartValueFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
  value: number,
  translator?: Translator | undefined,
) => string;

export const formatSloChartValue: FormatSloChartValueFunction = (
  sloMetric: SloWidgetMetric | undefined | null,
  value: number,
  translator?: Translator | undefined,
): string => {
  if (sloMetric === SloWidgetMetric.BurnRate) {
    return formatSloBurnRate(value, translator) || "";
  }

  if (sloMetric === SloWidgetMetric.ErrorBudgetRemaining) {
    return formatSloPercent(value, BUDGET_PERCENT_DECIMALS, translator) || "";
  }

  return formatSloPercent(value, SLI_DECIMALS, translator) || "";
};
