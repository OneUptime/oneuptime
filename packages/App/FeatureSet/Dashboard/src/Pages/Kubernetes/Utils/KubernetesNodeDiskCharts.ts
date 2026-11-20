import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import { KUBERNETES_STORAGE_USAGE_THRESHOLDS } from "Common/Types/Kubernetes/KubernetesStorageHealth";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A node's disks over time, for its page's Metrics tab (#9645), drawn as a
 * claim's are (KubernetesVolumeUsageCharts):
 *
 *   - its root filesystem's capacity, with its free space on the same
 *     chart, so the gap between the two lines is what is used;
 *   - how much of it is used (%), with the lines the Nodes list's bar turns
 *     amber and red at - the red one where the kubelet starts evicting pods;
 *   - on a node whose container images have a disk of their own, the same
 *     two for that disk, which the kubelet reports as every container's root
 *     filesystem (the largest and smallest reading of a minute: they are the
 *     same disk's).
 */

export const NODE_DISK_CAPACITY_VARIABLE: string = "node_disk_capacity";
export const NODE_DISK_FREE_VARIABLE: string = "node_disk_free";
export const NODE_IMAGE_DISK_CAPACITY_VARIABLE: string =
  "node_image_disk_capacity";
export const NODE_IMAGE_DISK_FREE_VARIABLE: string = "node_image_disk_free";

export interface KubernetesNodeDiskCharts {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
}

// The chart writes an axis figure in English, then in the reader's digits.
function formatBytesForChart(value: number): string {
  return formatStorageBytes(value, "en");
}

export function getKubernetesNodeDiskCharts(data: {
  clusterIdentifier: string;
  nodeName: string;
  // The node's images have a disk of their own: chart it too.
  hasImageDisk: boolean;
  translator: Translator;
}): KubernetesNodeDiskCharts {
  const translator: Translator = data.translator;
  const attributes: Record<string, string> = {
    "resource.k8s.cluster.name": data.clusterIdentifier,
    "resource.k8s.node.name": data.nodeName,
  };

  const queryConfigs: Array<MetricQueryConfigData> = [
    {
      metricAliasData: {
        metricVariable: NODE_DISK_CAPACITY_VARIABLE,
        title: translator.translateText("Disk Capacity and Free Space"),
        description: translator.translateTemplate(
          "The size of node {{nodeName}}'s root filesystem, and how much of it is still free to write.",
          { nodeName: data.nodeName },
        ),
        legend: translator.translateText("Capacity"),
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.node.filesystem.capacity",
          attributes: { ...attributes },
          aggegationType: AggregationType.Max,
          aggregateBy: {},
        },
      },
      yAxisValueFormatter: formatBytesForChart,
    },
    {
      metricAliasData: {
        metricVariable: NODE_DISK_FREE_VARIABLE,
        title: translator.translateText("Free (storage space)"),
        description: translator.translateTemplate(
          "How much of node {{nodeName}}'s root filesystem is still free to write.",
          { nodeName: data.nodeName },
        ),
        legend: translator.translateText("Free (storage space)"),
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.node.filesystem.available",
          attributes: { ...attributes },
          aggegationType: AggregationType.Min,
          aggregateBy: {},
        },
      },
      yAxisValueFormatter: formatBytesForChart,
      // On the Capacity chart: the gap between them is what is used.
      overlayWithPreviousQuery: true,
    },
  ];

  const formulaConfigs: Array<MetricFormulaConfigData> = [
    {
      metricAliasData: {
        metricVariable: "node_disk_used_percent",
        title: translator.translateText("Disk Used (%)"),
        description: translator.translateTemplate(
          "How much of node {{nodeName}}'s root filesystem is used, as a share of its capacity. The kubelet starts evicting pods at 90% by default.",
          { nodeName: data.nodeName },
        ),
        legend: translator.translateText("Used"),
        legendUnit: "%",
      },
      metricFormulaData: {
        metricFormula: `((${NODE_DISK_CAPACITY_VARIABLE} - ${NODE_DISK_FREE_VARIABLE}) / ${NODE_DISK_CAPACITY_VARIABLE}) * 100`,
      },
      warningThreshold: KUBERNETES_STORAGE_USAGE_THRESHOLDS.warningPercent,
      criticalThreshold: KUBERNETES_STORAGE_USAGE_THRESHOLDS.criticalPercent,
    },
  ];

  if (data.hasImageDisk) {
    queryConfigs.push(
      {
        metricAliasData: {
          metricVariable: NODE_IMAGE_DISK_CAPACITY_VARIABLE,
          title: translator.translateText("Image Disk Capacity and Free Space"),
          description: translator.translateTemplate(
            "The size of the disk node {{nodeName}} keeps its container images on, and how much of it is still free to write.",
            { nodeName: data.nodeName },
          ),
          legend: translator.translateText("Capacity"),
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "container.filesystem.capacity",
            attributes: { ...attributes },
            aggegationType: AggregationType.Max,
            aggregateBy: {},
          },
        },
        yAxisValueFormatter: formatBytesForChart,
      },
      {
        metricAliasData: {
          metricVariable: NODE_IMAGE_DISK_FREE_VARIABLE,
          title: translator.translateText("Free (storage space)"),
          description: translator.translateTemplate(
            "How much of the disk node {{nodeName}} keeps its container images on is still free to write.",
            { nodeName: data.nodeName },
          ),
          legend: translator.translateText("Free (storage space)"),
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "container.filesystem.available",
            attributes: { ...attributes },
            aggegationType: AggregationType.Min,
            aggregateBy: {},
          },
        },
        yAxisValueFormatter: formatBytesForChart,
        overlayWithPreviousQuery: true,
      },
    );

    formulaConfigs.push({
      metricAliasData: {
        metricVariable: "node_image_disk_used_percent",
        title: translator.translateText("Image Disk Used (%)"),
        description: translator.translateTemplate(
          "How much of the disk node {{nodeName}} keeps its container images on is used, as a share of its capacity.",
          { nodeName: data.nodeName },
        ),
        legend: translator.translateText("Used"),
        legendUnit: "%",
      },
      metricFormulaData: {
        metricFormula: `((${NODE_IMAGE_DISK_CAPACITY_VARIABLE} - ${NODE_IMAGE_DISK_FREE_VARIABLE}) / ${NODE_IMAGE_DISK_CAPACITY_VARIABLE}) * 100`,
      },
      warningThreshold: KUBERNETES_STORAGE_USAGE_THRESHOLDS.warningPercent,
      criticalThreshold: KUBERNETES_STORAGE_USAGE_THRESHOLDS.criticalPercent,
    });
  }

  return { queryConfigs: queryConfigs, formulaConfigs: formulaConfigs };
}
