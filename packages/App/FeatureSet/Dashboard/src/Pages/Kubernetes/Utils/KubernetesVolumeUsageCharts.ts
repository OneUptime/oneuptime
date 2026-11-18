import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import {
  DEFAULT_STORAGE_USAGE_THRESHOLDS,
  formatStorageBytes,
  formatStorageCount,
} from "Common/Utils/Storage/StorageUsage";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A claim's usage over time, for its page's Usage tab (#9539): the
 * kubeletstats volume series the kubernetes-agent names by claim, read for
 * that one claim in its namespace and cluster.
 *
 *   - Capacity, with the free space drawn on the same chart: the gap
 *     between the two lines is what is used, and a resize shows as a step.
 *   - Used (%), worked out from the two, with the lines the list's bar
 *     turns amber and red at, so a claim filling up is seen coming.
 *   - The same two for its inodes, when the claim reports them.
 *
 * Several pods may mount one claim, and each reports the same filesystem:
 * capacity takes the largest reading of a minute and free space the
 * smallest, never a sum.
 */

export const VOLUME_CAPACITY_VARIABLE: string = "capacity";
export const VOLUME_FREE_VARIABLE: string = "free";
export const VOLUME_INODES_VARIABLE: string = "inodes";
export const VOLUME_FREE_INODES_VARIABLE: string = "free_inodes";

export interface KubernetesVolumeUsageCharts {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
}

// The chart writes an axis figure in English, then in the reader's digits.
function formatBytesForChart(value: number): string {
  return formatStorageBytes(value, "en");
}

function formatCountForChart(value: number): string {
  return formatStorageCount(value, "en");
}

export function getKubernetesVolumeUsageCharts(data: {
  clusterIdentifier: string;
  namespace: string;
  claimName: string;
  // The claim reported its inodes: chart them too.
  hasInodes: boolean;
  translator: Translator;
}): KubernetesVolumeUsageCharts {
  const translator: Translator = data.translator;
  const attributes: Record<string, string> = {
    "resource.k8s.cluster.name": data.clusterIdentifier,
    "resource.k8s.namespace.name": data.namespace,
    "resource.k8s.persistentvolumeclaim.name": data.claimName,
  };

  const queryConfigs: Array<MetricQueryConfigData> = [
    {
      metricAliasData: {
        metricVariable: VOLUME_CAPACITY_VARIABLE,
        title: translator.translateText("Capacity and Free Space"),
        description: translator.translateTemplate(
          "The size of claim {{claimName}}'s filesystem, and how much of it is still free to write.",
          { claimName: data.claimName },
        ),
        legend: translator.translateText("Capacity"),
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.volume.capacity",
          attributes: { ...attributes },
          aggegationType: AggregationType.Max,
          aggregateBy: {},
        },
      },
      yAxisValueFormatter: formatBytesForChart,
    },
    {
      metricAliasData: {
        metricVariable: VOLUME_FREE_VARIABLE,
        title: translator.translateText("Free (storage space)"),
        description: translator.translateTemplate(
          "How much of claim {{claimName}}'s filesystem is still free to write.",
          { claimName: data.claimName },
        ),
        legend: translator.translateText("Free (storage space)"),
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.volume.available",
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
        metricVariable: "used_percent",
        title: translator.translateText("Used (%)"),
        description: translator.translateTemplate(
          "How much of claim {{claimName}}'s filesystem is used, as a share of its capacity.",
          { claimName: data.claimName },
        ),
        legend: translator.translateText("Used"),
        legendUnit: "%",
      },
      metricFormulaData: {
        metricFormula: `((${VOLUME_CAPACITY_VARIABLE} - ${VOLUME_FREE_VARIABLE}) / ${VOLUME_CAPACITY_VARIABLE}) * 100`,
      },
      warningThreshold: DEFAULT_STORAGE_USAGE_THRESHOLDS.warningPercent,
      criticalThreshold: DEFAULT_STORAGE_USAGE_THRESHOLDS.criticalPercent,
    },
  ];

  if (data.hasInodes) {
    queryConfigs.push(
      {
        metricAliasData: {
          metricVariable: VOLUME_INODES_VARIABLE,
          title: translator.translateText("Inodes and Free Inodes"),
          description: translator.translateTemplate(
            "How many files and directories claim {{claimName}}'s filesystem can hold, and how many more it can still create.",
            { claimName: data.claimName },
          ),
          legend: translator.translateText("Inodes"),
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "k8s.volume.inodes",
            attributes: { ...attributes },
            aggegationType: AggregationType.Max,
            aggregateBy: {},
          },
        },
        yAxisValueFormatter: formatCountForChart,
      },
      {
        metricAliasData: {
          metricVariable: VOLUME_FREE_INODES_VARIABLE,
          title: translator.translateText("Free Inodes"),
          description: translator.translateTemplate(
            "How many more files and directories claim {{claimName}}'s filesystem can create.",
            { claimName: data.claimName },
          ),
          legend: translator.translateText("Free Inodes"),
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "k8s.volume.inodes.free",
            attributes: { ...attributes },
            aggegationType: AggregationType.Min,
            aggregateBy: {},
          },
        },
        yAxisValueFormatter: formatCountForChart,
        overlayWithPreviousQuery: true,
      },
    );

    formulaConfigs.push({
      metricAliasData: {
        metricVariable: "inodes_used_percent",
        title: translator.translateText("Inodes Used (%)"),
        description: translator.translateTemplate(
          "How much of claim {{claimName}}'s inodes are used. At 100% no new file can be created, whatever space is free.",
          { claimName: data.claimName },
        ),
        legend: translator.translateText("Inodes Used"),
        legendUnit: "%",
      },
      metricFormulaData: {
        metricFormula: `((${VOLUME_INODES_VARIABLE} - ${VOLUME_FREE_INODES_VARIABLE}) / ${VOLUME_INODES_VARIABLE}) * 100`,
      },
      warningThreshold: DEFAULT_STORAGE_USAGE_THRESHOLDS.warningPercent,
      criticalThreshold: DEFAULT_STORAGE_USAGE_THRESHOLDS.criticalPercent,
    });
  }

  return { queryConfigs: queryConfigs, formulaConfigs: formulaConfigs };
}
