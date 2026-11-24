import RestoreCloudResourceMonitorTotals, {
  CloudResourceRestoredMetrics,
} from "./RestoreCloudResourceMonitorTotals";
import { getCloudResourceTypeLabel } from "Common/Types/Cloud/CloudResourceCatalog";
import {
  CloudResourceSummedParts,
  getCloudResourceSummedParts,
} from "Common/Types/Cloud/CloudResourceMetricAggregation";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "Common/Utils/Markdown/FeedMarkdown";
import { MetricQueryAggregationRestore } from "Common/Utils/Metrics/MetricQueryCloudAggregation";

export {
  NAMES_AN_AZURE_RESOURCE,
  PAGE_SIZE,
} from "./RestoreCloudResourceMonitorTotals";

/*
 * Metrics monitors on a Service Bus or Event Hubs namespace read its
 * metrics with the average. While Azure reported each metric once for the
 * namespace, that was the namespace's number. Since the Azure connection
 * reads them once per queue, topic and event hub (#6415) - as the
 * collector's azure_monitor receiver always did - it is the average queue:
 * a namespace of three queues taking 10, 20 and 30 messages a minute reads
 * 20, not 60, and a monitor set to fire once 100 messages wait fires, in a
 * namespace of four queues, only once 400 do.
 *
 * So each stored Metrics step that reads such a metric with the average a
 * minute at a time - a window of up to 3 hours - reads it with the catalog's
 * Sum from now on (RestoreCloudResourceMonitorTotals): the namespace's
 * number again, which its Metrics tab shows as the "total of series" too,
 * so its criteria's thresholds mean what they meant. Each monitor moved
 * says so in its feed. Only a namespace's queries: a type whose metrics
 * came to be read once per part later is moved by a migration of its own,
 * in its own words (RestoreContainerAppRequestMonitorTotals).
 */

export const NAMESPACE_TYPES: ReadonlyArray<string> = [
  "Microsoft.ServiceBus/namespaces",
  "Microsoft.EventHub/namespaces",
];

export default class RestoreNamespaceMetricMonitorTotals extends RestoreCloudResourceMonitorTotals {
  public constructor() {
    super("RestoreNamespaceMetricMonitorTotals");
  }

  protected getResourceTypes(): ReadonlyArray<string> {
    return NAMESPACE_TYPES;
  }

  protected getFeed(
    restored: Array<MetricQueryAggregationRestore>,
  ): MarkdownText {
    return RestoreNamespaceMetricMonitorTotals.getFeedMarkdown(restored);
  }

  protected describeMoved(moved: number): string {
    return `${moved} monitor(s) read their namespace's metrics as its total`;
  }

  /*
   * What a moved monitor's feed says, first what changed for the person
   * who reads it: the monitor now reads the namespace's total. Then, for
   * each namespace in the order its queries are, why - Azure reports its
   * metrics once per queue and topic (an Event Hubs namespace's, once per
   * event hub), whose Avg is the average queue - and which metrics now read
   * with Sum. Last, that its criteria are as they were.
   */
  public static getFeedMarkdown(
    restored: Array<MetricQueryAggregationRestore>,
  ): MarkdownText {
    const byResource: Array<CloudResourceRestoredMetrics> =
      RestoreNamespaceMetricMonitorTotals.groupByResource(restored);

    const lines: Array<MarkdownText> = byResource.map(
      (entry: CloudResourceRestoredMetrics): MarkdownText => {
        const metrics: MarkdownText =
          RestoreNamespaceMetricMonitorTotals.listOf(
            entry.metricNames.map((metricName: string): MarkdownText => {
              return FeedMarkdown.code(metricName);
            }),
          );

        // Named for every type a query is moved on (restoreResourceTotals).
        const parts: CloudResourceSummedParts = getCloudResourceSummedParts(
          entry.resource,
        )!;

        return mdText`Azure reports the metrics of the ${getCloudResourceTypeLabel(
          entry.resource.provider,
          entry.resource.type,
        )} **${entry.resource.name}** once per ${parts.each}, so their **Avg** is the average ${parts.one}. This monitor now reads ${metrics} with **Sum**, which adds them up, as the namespace's **Metrics** tab does.`;
      },
    );

    return mdText`📊 **This monitor now reads ${
      byResource.length > 1 ? "each namespace's total" : "the namespace's total"
    }.**

${FeedMarkdown.join(lines, "\n\n")}

Its criteria are unchanged.`;
  }
}
