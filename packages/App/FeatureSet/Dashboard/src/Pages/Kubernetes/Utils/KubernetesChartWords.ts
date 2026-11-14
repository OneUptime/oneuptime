import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { Translator } from "Common/Types/Translator";

/*
 * A CHART'S WORDS IN THE READER'S LANGUAGE (#7486).
 *
 * A page of metric charts hands each chart its title, its description and
 * its legend (metricAliasData), and the charts draw them as written: a page
 * hands them its own words, translated, as the Ceph and VMware pages do. The
 * Kubernetes Control Plane page handed them the English, so every chart on
 * it - etcd's Total Keys and its Keys legend among them - read English in
 * every language, though the languages word them.
 *
 * Only the words OneUptime wrote: the metric query, its variable and its
 * unit are left as they are.
 */
export const chartWordsInReadersLanguage: (
  queries: Array<MetricQueryConfigData>,
  translator: Translator,
) => Array<MetricQueryConfigData> = (
  queries: Array<MetricQueryConfigData>,
  translator: Translator,
): Array<MetricQueryConfigData> => {
  const words: (text: string | undefined) => string | undefined = (
    text: string | undefined,
  ): string | undefined => {
    return text ? translator.translateText(text) || text : text;
  };

  return queries.map((query: MetricQueryConfigData): MetricQueryConfigData => {
    if (!query.metricAliasData) {
      return query;
    }

    return {
      ...query,
      metricAliasData: {
        ...query.metricAliasData,
        title: words(query.metricAliasData.title),
        description: words(query.metricAliasData.description),
        legend: words(query.metricAliasData.legend),
      },
    };
  });
};
