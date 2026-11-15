import MetricSeriesScope from "Common/Utils/Metrics/MetricSeriesScope";
import escapeRegExp from "Common/Utils/RegExpEscape";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { getUnsetText } from "../Dashboard/Components/DashboardWidgetFallbackWords";

/*
 * A GROUPED SERIES' NAME, AS ITS READER READS IT (#7523).
 *
 * A metric chart grouped by an attribute names each series "key=value",
 * and a group whose attribute holds nothing "key=(unset)". That name is
 * also a key: a color pin is stored by its "key=value" segment
 * (MetricQueryConfigData.colorsByGroup, SeriesGroupColorSelector), a
 * hidden series is remembered by it, and "(unset)" is what narrows a
 * chart click to the is-empty filter (parseSeriesLabels). So the English
 * "(unset)" stays in the name and in every pin, on every board, and only
 * what a person reads says it in their language: the legend's chips, the
 * chart's tooltip, the series menu and the values at a moment -
 * "service.name=(nicht gesetzt)" on a German board, "(تنظیم‌نشده)" on a
 * Persian one.
 */

// The value a group whose attribute holds nothing is named and pinned by.
export const UNSET_GROUP_VALUE: string =
  MetricSeriesScope.UnsetLabelDisplayValue;

// A group's value as its series' name and its color pin hold it.
export function getSeriesGroupValue(value: unknown): string {
  return value === undefined || value === null || value === ""
    ? UNSET_GROUP_VALUE
    : String(value);
}

/*
 * "=(unset)" as a segment's whole value: before the ", " that joins the
 * next segment, the " (" of an overlay's or a previous period's suffix,
 * or the name's end.
 */
const UNSET_SEGMENT_VALUE: RegExp = new RegExp(
  `=${escapeRegExp(UNSET_GROUP_VALUE)}(?=$|, | \\()`,
  "g",
);

// A group's value as the reader reads it: their word for "(unset)".
export function getSeriesGroupValueForReader(
  value: string,
  translator: Translator,
): string {
  return value === UNSET_GROUP_VALUE ? getUnsetText(translator) : value;
}

/*
 * The value the reader typed or picked for a group, as a pin stores it:
 * their word for "(unset)" is "(unset)".
 */
export function getSeriesGroupValueFromReader(
  value: string,
  translator: Translator,
): string {
  return value !== UNSET_GROUP_VALUE && value === getUnsetText(translator)
    ? UNSET_GROUP_VALUE
    : value;
}

// The series' name as the reader reads it; the name itself is kept as it is.
export function getSeriesNameForReader(
  seriesName: string,
  translator: Translator,
): string {
  if (!seriesName || !seriesName.includes(`=${UNSET_GROUP_VALUE}`)) {
    return seriesName;
  }

  const word: string = getUnsetText(translator);

  if (!word || word === UNSET_GROUP_VALUE) {
    return seriesName;
  }

  return seriesName.replace(UNSET_SEGMENT_VALUE, (): string => {
    return `=${word}`;
  });
}

// Whether a search the reader typed finds the series: by its name, or as they read it.
export function isSeriesFoundBySearch(
  seriesName: string,
  search: string,
  translator: Translator,
): boolean {
  const query: string = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return (
    seriesName.toLowerCase().includes(query) ||
    getSeriesNameForReader(seriesName, translator).toLowerCase().includes(query)
  );
}

/*
 * The series a chart draws, named as the reader reads them: a chart names
 * a line, its tooltip's row and its legend's entry by the series' name.
 * The same array back when no name changes, so a chart that draws no
 * "(unset)" group recomputes nothing.
 */
export function withSeriesNamesForReader<T extends SeriesPoint>(
  series: Array<T>,
  translator: Translator,
): Array<T> {
  let isChanged: boolean = false;

  const named: Array<T> = series.map((item: T): T => {
    const seriesName: string = getSeriesNameForReader(
      item.seriesName,
      translator,
    );

    if (seriesName === item.seriesName) {
      return item;
    }

    isChanged = true;

    return { ...item, seriesName: seriesName };
  });

  return isChanged ? named : series;
}
