import SeriesPoints from "../Types/SeriesPoints";
import { Translator } from "../../../Utils/TranslateTemplate";

/*
 * The charts draw a series' name as they are handed it - in the legend, the
 * hover line and the tooltip - because most series are named by data: a
 * metric, a service, a container, a disk. A page whose series are the
 * product's own words ("In" and "Out", "CPU %", "Read" and "Write") hands
 * them over through this, so they read in the reader's language. A name the
 * reader's locale has no wording for reads as written.
 *
 * The same series, read the same way, gives back the same array: the charts
 * recompute their points whenever `data` changes identity, and a page
 * re-renders far more often than its series change. The names are looked up
 * every time (a handful per chart), so a locale that arrives after the first
 * paint is still picked up.
 */
const translatedSeries: WeakMap<
  Array<SeriesPoints>,
  Array<SeriesPoints>
> = new WeakMap<Array<SeriesPoints>, Array<SeriesPoints>>();

export function withTranslatedSeriesNames<T extends SeriesPoints>(
  series: Array<T>,
  translator: Translator,
): Array<T> {
  const names: Array<string> = series.map((item: T): string => {
    return translator.translateText(item.seriesName) || item.seriesName;
  });

  const cached: Array<SeriesPoints> | undefined = translatedSeries.get(series);

  if (
    cached &&
    cached.length === names.length &&
    cached.every((item: SeriesPoints, index: number): boolean => {
      return item.seriesName === names[index];
    })
  ) {
    return cached as Array<T>;
  }

  const result: Array<T> = series.map((item: T, index: number): T => {
    const seriesName: string = names[index] as string;

    return seriesName === item.seriesName
      ? item
      : { ...item, seriesName: seriesName };
  });

  translatedSeries.set(series, result);

  return result;
}
