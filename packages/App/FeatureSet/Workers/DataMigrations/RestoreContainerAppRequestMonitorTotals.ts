import RestoreCloudResourceMonitorTotals, {
  CloudResourceRestoredMetrics,
} from "./RestoreCloudResourceMonitorTotals";
import { CONTAINER_APP_TYPE } from "Common/Types/Cloud/CloudAppPlatformResourceMatch";
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

/*
 * Metrics monitors on a Container App's requests read them with the
 * average. While the Azure connection read Requests whole, one series a
 * minute, that was the app's number. Since it reads them once per status
 * code category (#10837: Requests split by statusCodeCategory, so its page
 * can show the share answered with a 5xx status), it is the average
 * category: an app answering 900 requests a minute with a 2xx and 100 with
 * a 5xx reads 500, not 1,000, and a monitor set to fire under 50 requests a
 * minute fires late.
 *
 * So each stored Metrics step that reads a Container App's requests with
 * the average a minute at a time - a window of up to 3 hours - reads them
 * with the catalog's Sum from now on (RestoreCloudResourceMonitorTotals):
 * the app's number again, which its Metrics tab shows as the "total of
 * series" too, so its criteria's thresholds mean what they meant. Each
 * monitor moved says so in its feed. Only a Container App's queries: a
 * namespace's were moved when its queues were split
 * (RestoreNamespaceMetricMonitorTotals).
 */

export default class RestoreContainerAppRequestMonitorTotals extends RestoreCloudResourceMonitorTotals {
  public constructor() {
    super("RestoreContainerAppRequestMonitorTotals");
  }

  protected getResourceTypes(): ReadonlyArray<string> {
    return [CONTAINER_APP_TYPE];
  }

  protected getFeed(
    restored: Array<MetricQueryAggregationRestore>,
  ): MarkdownText {
    return RestoreContainerAppRequestMonitorTotals.getFeedMarkdown(restored);
  }

  protected describeMoved(moved: number): string {
    return `${moved} monitor(s) read their Container App's requests as its total`;
  }

  /*
   * What a moved monitor's feed says, first what changed for the person
   * who reads it: the monitor now reads the app's total requests. Then,
   * for each Container App in the order its queries are, why - Azure
   * reports its requests once per status code category, whose Avg is the
   * average category - and which metrics now read with Sum. Last, that its
   * criteria are as they were.
   */
  public static getFeedMarkdown(
    restored: Array<MetricQueryAggregationRestore>,
  ): MarkdownText {
    const byResource: Array<CloudResourceRestoredMetrics> =
      RestoreContainerAppRequestMonitorTotals.groupByResource(restored);

    const lines: Array<MarkdownText> = byResource.map(
      (entry: CloudResourceRestoredMetrics): MarkdownText => {
        const metrics: MarkdownText =
          RestoreContainerAppRequestMonitorTotals.listOf(
            entry.metricNames.map((metricName: string): MarkdownText => {
              return FeedMarkdown.code(metricName);
            }),
          );
        const label: string = getCloudResourceTypeLabel(
          entry.resource.provider,
          entry.resource.type,
        );
        // A Container App's, the one type this moves (restoreResourceTotals).
        const parts: CloudResourceSummedParts = getCloudResourceSummedParts(
          entry.resource,
        )!;

        return mdText`Azure reports the requests of the ${label} **${entry.resource.name}** once per ${parts.each}, so their **Avg** is the average ${parts.one}. This monitor now reads ${metrics} with **Sum**, which adds them up, as the ${label}'s **Metrics** tab does.`;
      },
    );

    return mdText`📊 **This monitor now reads ${
      byResource.length > 1
        ? "each Container App's total requests"
        : "the Container App's total requests"
    }.**

${FeedMarkdown.join(lines, "\n\n")}

Its criteria are unchanged.`;
  }
}
