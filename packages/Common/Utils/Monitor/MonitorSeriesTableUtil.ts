import { writeFigureInLanguage } from "../../Types/DateLanguage";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
  MonitorEvaluationSeries,
  MonitorEvaluationSeriesRow,
  MonitorEvaluationSeriesValueKind,
} from "../../Types/Monitor/MonitorEvaluationSummary";
import SeriesLabelDisplay, {
  DisplaySeriesLabel,
} from "../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import { Translator, translationKey } from "../../Types/Translator";
import MetricValueFormatter from "./MetricValueFormatter";

// The Series card's words (MonitorSeriesCard), looked up where they are drawn.
export const MONITOR_SERIES_CARD_TITLE: string = translationKey("Series");

export const MONITOR_SERIES_CARD_DESCRIPTION: string = translationKey(
  "Each series the last check read, with its latest value, the criteria it meets and its open incident or alert.",
);

export const MONITOR_SERIES_KEEPS_STATUS: string =
  translationKey("Keeps the status");

export const MONITOR_SERIES_KEEPS_STATUS_TIP: string = translationKey(
  "This series met a criteria that changed the monitor's status, and has not met a criteria that brings it back yet. The monitor keeps its status until it does, whatever the other series do.",
);

// One series as the Series card lists it, in the reader's words.
export interface MonitorSeriesTableRow {
  fingerprint: string;
  // What names it, the most identifying first (SeriesLabelDisplay).
  labels: Array<DisplaySeriesLabel>;
  // Its latest value, written the reader's way; null for none.
  valueText: string | null;
  // The criteria it met, by name, in criteria order.
  criteriaNames: Array<string>;
  isKeepingStatus: boolean;
}

/*
 * THE SERIES CARD OF A GROUPED MONITOR'S OVERVIEW (#10062), WITHOUT REACT.
 *
 * The last check's evaluation summary keeps the series it read
 * (MonitorSeriesTable, on the server): a bounded list, the ones that keep
 * the status or met a criteria that changes it first. This turns it into
 * the card's rows - the labels as the series' incidents and alerts name
 * them, the value in the reader's digits with its unit, the criteria by the
 * names the summary gives them - and says when the list is a share of the
 * series. The card adds what is open for each (useMonitorSeriesOpenRecords).
 */
export default class MonitorSeriesTableUtil {
  /*
   * The series of the summary's check, or null for a monitor that does not
   * judge series on its own: the card is not drawn then.
   */
  public static getSeries(
    summary: MonitorEvaluationSummary | null | undefined,
  ): MonitorEvaluationSeries | null {
    const series: MonitorEvaluationSeries | undefined = summary?.series;

    if (
      !series ||
      typeof series !== "object" ||
      !Array.isArray(series.rows) ||
      typeof series.count !== "number"
    ) {
      return null;
    }

    return series;
  }

  public static getRows(input: {
    summary: MonitorEvaluationSummary;
    translator: Translator;
  }): Array<MonitorSeriesTableRow> {
    const series: MonitorEvaluationSeries | null =
      MonitorSeriesTableUtil.getSeries(input.summary);

    if (!series) {
      return [];
    }

    const names: Map<string, string> = new Map<string, string>();

    for (const result of input.summary.criteriaResults || []) {
      if (result.criteriaId) {
        names.set(
          result.criteriaId,
          MonitorSeriesTableUtil.getCriteriaName({
            result: result,
            translator: input.translator,
          }),
        );
      }
    }

    return series.rows
      .filter((row: MonitorEvaluationSeriesRow): boolean => {
        return Boolean(row && row.fingerprint);
      })
      .map((row: MonitorEvaluationSeriesRow): MonitorSeriesTableRow => {
        return {
          fingerprint: row.fingerprint,
          labels: SeriesLabelDisplay.getDisplayLabels(row.labels, {
            context: row.context,
          }),
          valueText: MonitorSeriesTableUtil.getValueText({
            row: row,
            translator: input.translator,
          }),
          criteriaNames: (row.metCriteriaIds || []).map(
            (criteriaId: string): string => {
              return (
                names.get(criteriaId) ||
                input.translator.translateText("Unnamed criteria") ||
                "Unnamed criteria"
              );
            },
          ),
          isKeepingStatus: Boolean(row.isKeepingStatus),
        };
      });
  }

  /*
   * "89,00 %", "12 logs", "3 spans" in the reader's language: a metric's
   * value with its unit, written as the monitor's charts write it
   * (MetricValueFormatter), in the reader's digits and decimal sign; a
   * group's count as a count. Null for a series with no value.
   */
  public static getValueText(input: {
    row: MonitorEvaluationSeriesRow;
    translator: Translator;
  }): string | null {
    const value: number | undefined = input.row.value;

    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }

    if (input.row.valueKind === MonitorEvaluationSeriesValueKind.Logs) {
      return input.translator.translatePlural(
        { one: "{{count}} log", other: "{{count}} logs" },
        value,
      );
    }

    if (input.row.valueKind === MonitorEvaluationSeriesValueKind.Spans) {
      return input.translator.translatePlural(
        { one: "{{count}} span", other: "{{count}} spans" },
        value,
      );
    }

    return writeFigureInLanguage(
      MetricValueFormatter.format({
        value: value,
        unit: input.row.unit,
        metricName: input.row.metricName,
      }),
      input.translator.language,
    );
  }

  /*
   * The line the card says when it lists a share of the series: "Showing 50
   * of 2,345 series: those that keep the status or meet a criteria come
   * first." Null when every series is listed.
   */
  public static getShareText(input: {
    series: MonitorEvaluationSeries;
    translator: Translator;
  }): string | null {
    const shown: number = input.series.rows.length;

    if (input.series.count <= shown) {
      return null;
    }

    return input.translator.translatePlural(
      {
        one: translationKey(
          "Showing {{shown}} of {{count}} series: those that keep the status or meet a criteria come first.",
        ),
        other: translationKey(
          "Showing {{shown}} of {{count}} series: those that keep the status or meet a criteria come first.",
        ),
      },
      input.series.count,
      { shown: input.translator.formatNumber(shown) },
    );
  }

  // A criteria as the summary names it, or "Unnamed criteria".
  private static getCriteriaName(input: {
    result: MonitorEvaluationCriteriaResult;
    translator: Translator;
  }): string {
    return (
      input.result.criteriaName ||
      input.translator.translateText("Unnamed criteria") ||
      "Unnamed criteria"
    );
  }
}
