import MetricAliasData from "Common/Types/Metrics/MetricAliasData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { Translator } from "Common/Types/Translator";

/*
 * A CHART'S WORDS IN THE READER'S LANGUAGE (#7486, #8047).
 *
 * A page of metric charts hands each chart its title, its description and
 * its legend (metricAliasData), and the charts draw them exactly as handed:
 * nothing on the way looks them up. The Kubernetes Control Plane page, and
 * after it the Kubernetes resource pages, the Docker, Podman, Proxmox,
 * Docker Swarm, Ceph and OpenStack pages and a network device's charts,
 * handed them their English, so every chart title and legend on them read
 * English in every language, though the languages word them.
 *
 * A page that writes its chart words as English literals hands its queries
 * through this, once, where it hands them to EmbeddedMetricCard,
 * MetricView or ResourceMetricsTab. A page that words a chart itself - a
 * description built around a node's name with translateTemplate, the
 * VMware pages' tx() - looks each of its literals up where it writes it
 * instead, and never comes through here as well: a translation looked up
 * again can itself be an English key, and read as the translation of the
 * translation (#7790). ChartWordsInReadersLanguageGuard holds both.
 *
 * Only the words OneUptime wrote: the metric query, its variable and its
 * unit are left as they are, and so is the page's own config.
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

    const metricAliasData: MetricAliasData = {
      ...query.metricAliasData,
      title: words(query.metricAliasData.title),
      description: words(query.metricAliasData.description),
      legend: words(query.metricAliasData.legend),
    };

    /*
     * Worded here, the description is no longer the metric's stored one:
     * the chart draws it as handed and never looks it up again (#8572).
     */
    delete metricAliasData.isMetricTypeDescription;

    return { ...query, metricAliasData };
  });
};
