import React from "react";
import type { LegendPayload } from "recharts";

/*
 * The order a chart's legend names its series in: the order the page hands
 * them (`categories`), which is the order the page chose - Daily, Weekly
 * and Monthly active users; New users before Returning users; a period
 * before the one it is compared with. The colours follow that order too
 * (constructCategoryColors), so the legend reads blue, emerald, violet.
 *
 * recharts 3 sorts its legend items by their label unless told otherwise
 * (`itemSorter` defaults to "value"). Every line, area and bar legend read
 * alphabetically - "Daily active users, Monthly active users, Weekly active
 * users" - and, since series names are translated before they are drawn, in
 * a different order in each language (issue #6562).
 *
 * `itemSorter={null}` would keep the order the series registered in, which
 * recharts warns can change between renders. Ranking each item by its
 * series' place in `categories` is the one order that holds: by the label
 * the legend draws (the series' name), else by its data key.
 */

// What recharts sorts the legend's items by: a series' place among the categories.
export type LegendItemRank = (item: LegendPayload) => number;

/*
 * Ranks a legend item by its series' place in `categories`. An item that is
 * no series of the chart (a helper line or band, drawn with legendType
 * "none") ranks after every series; recharts' sort keeps such items in the
 * order they came.
 */
export function getLegendItemRank(categories: Array<string>): LegendItemRank {
  const places: Map<string, number> = new Map<string, number>();

  categories.forEach((category: string, place: number): void => {
    // A name given twice keeps its first place.
    if (!places.has(category)) {
      places.set(category, place);
    }
  });

  const unranked: number = categories.length;

  return (item: LegendPayload): number => {
    if (typeof item.value === "string" && places.has(item.value)) {
      return places.get(item.value) as number;
    }

    if (typeof item.dataKey === "string" && places.has(item.dataKey)) {
      return places.get(item.dataKey) as number;
    }

    return unranked;
  };
}

/*
 * getLegendItemRank for a chart's `<Legend itemSorter>`, kept while the
 * categories read the same: a page hands its series in a new array on
 * every render, and recharts stores the sorter, so a new one each render
 * would re-sort the legend for nothing.
 */
export function useLegendItemRank(categories: Array<string>): LegendItemRank {
  const categoriesKey: string = JSON.stringify(categories);

  return React.useMemo((): LegendItemRank => {
    return getLegendItemRank(JSON.parse(categoriesKey) as Array<string>);
  }, [categoriesKey]);
}
