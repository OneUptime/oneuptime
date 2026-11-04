import { PluralTemplate } from "Common/Types/Translator";

/*
 * A METRIC CHART'S COUNTS OF SERIES, EACH IN THE READER'S PLURAL.
 *
 * English says "series" for one and for many, so each count's two forms
 * are one sentence there. German, French, Spanish, Portuguese, Dutch and
 * the Nordic languages say one series apart from several: looked up as a
 * single sentence, a chart of one line read "1 Reihen", "1 séries", "1
 * serier". MetricCharts draws each with translatePlural, so the reader's
 * language picks the form its grammar wants for the count.
 */

// Beside the unit badge: how many series the chart plots.
export const SERIES_COUNT_TEMPLATE: PluralTemplate = {
  one: "{{count}} series",
  other: "{{count}} series",
};

// The legend's search box, with the number of series it filters.
export const FILTER_SERIES_TEMPLATE: PluralTemplate = {
  one: "Filter {{count}} series",
  other: "Filter {{count}} series",
};

// Under a moment's values: how many more series it holds than it lists.
export const MORE_SERIES_TEMPLATE: PluralTemplate = {
  one: "+{{count}} more series",
  other: "+{{count}} more series",
};
