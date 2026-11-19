import {
  AZURE_KEY_METRICS,
  AzureTypeKeyMetrics,
} from "Common/Types/Cloud/CloudKeyMetrics";

/*
 * The key metrics an Azure stream never carries, by resource type, for
 * Stream Azure Monitor Metrics and Logs: those a diagnostic setting cannot
 * export ("DS Export: No" in Microsoft's supported metrics of the type), as
 * CloudKeyMetrics marks them, which the connection's reads keep writing
 * while it streams. A Service Bus or Event Hubs namespace, which streams
 * none of its metrics, has its own paragraph.
 *
 * Written down, the list fell behind each time a type gained key metrics;
 * read from the catalog, it lists exactly what the release that serves it
 * reads. Each line is a type and its metrics as Azure names them - code a
 * reader looks up, the same in every language - so a page carries the one
 * placeholder whatever its language.
 */

export const AZURE_STREAM_KEPT_METRICS_PLACEHOLDER: string =
  "{{AZURE_STREAM_KEPT_METRICS}}";

// The types whose key metrics a stream does not all carry, in the catalog's order.
export function getAzureStreamKeptMetricTypes(): Array<AzureTypeKeyMetrics> {
  return AZURE_KEY_METRICS.filter((entry: AzureTypeKeyMetrics): boolean => {
    return (
      !entry.splitByDimension &&
      (entry.notExportedByDiagnosticSettings || []).length > 0
    );
  });
}

// One line a type: "- `Microsoft.Network/natGateways`: `ByteCount`, `PacketCount`."
export function getAzureStreamKeptMetricsMarkdown(): string {
  return getAzureStreamKeptMetricTypes()
    .map((entry: AzureTypeKeyMetrics): string => {
      return `- \`${entry.type}\`: ${(
        entry.notExportedByDiagnosticSettings || []
      )
        .map((metric: string): string => {
          return `\`${metric}\``;
        })
        .join(", ")}.`;
    })
    .join("\n");
}
