import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import {
  StorageArrayMetricDefinition,
  getStorageArrayMetricById,
  getStorageArrayObjectLabel,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Curated MetricView presets sharing one time-range state — the storage
 * array analog of Pages/Ceph/View/Insights.tsx. Every chart is a
 * StorageArrayMetricCatalog entry, so its label filters (the `dimension`
 * that tells a read from a write) are the catalog's; the per-object charts
 * are grouped by the label that names the object on its platform, top 10
 * by value. Explicitly NOT computed recommendations.
 */

export interface InsightsSection {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  // Catalog ids; the ones whose series name an object are split by it.
  metricIds: Array<string>;
  groupByObject?: boolean | undefined;
}

export const FLASHARRAY_INSIGHTS_SECTIONS: Array<InsightsSection> = [
  {
    key: "capacity",
    title: "Capacity",
    description:
      "Share of usable capacity in use, the free space left, the space only snapshots hold and the data reduction ratio.",
    icon: IconProp.ChartBar,
    metricIds: [
      "purefa-array-space-utilization",
      "purefa-array-space-empty",
      "purefa-array-space-snapshots",
      "purefa-array-data-reduction",
    ],
  },
  {
    key: "performance",
    title: "Performance",
    description:
      "Where time goes for the whole array: latency hosts see, the part of it spent in the SAN, mirrored writes, queue depth and I/O size.",
    icon: IconProp.Signal,
    metricIds: [
      "purefa-array-read-latency",
      "purefa-array-write-latency",
      "purefa-array-san-read-latency",
      "purefa-array-mirrored-write-latency",
      "purefa-array-queue-depth",
      "purefa-array-io-size",
    ],
  },
  {
    key: "volumes",
    title: "Volumes",
    description: "The ten volumes with the highest latency and IOPS.",
    icon: IconProp.Disc,
    metricIds: [
      "purefa-volume-read-latency",
      "purefa-volume-write-latency",
      "purefa-volume-read-iops",
      "purefa-volume-write-iops",
    ],
    groupByObject: true,
  },
  {
    key: "hosts",
    title: "Hosts",
    description: "The ten hosts that see the highest latency.",
    icon: IconProp.Server,
    metricIds: ["purefa-host-read-latency", "purefa-host-write-latency"],
    groupByObject: true,
  },
  {
    key: "replication",
    title: "Replication",
    description:
      "How far each pod's remote copy is behind, per replica link, and the replication traffic.",
    icon: IconProp.Refresh,
    metricIds: [
      "purefa-pod-replica-lag-max",
      "purefa-pod-replication-bandwidth",
    ],
    groupByObject: true,
  },
  {
    key: "hardware",
    title: "Hardware",
    description:
      "Temperature of each sensor and the error rate of each network interface.",
    icon: IconProp.CPUChip,
    metricIds: ["purefa-hw-temperature", "purefa-network-interface-errors"],
    groupByObject: true,
  },
];

export const FLASHBLADE_INSIGHTS_SECTIONS: Array<InsightsSection> = [
  {
    key: "capacity",
    title: "Capacity",
    description:
      "Share of usable capacity in use, the free space left and the data reduction ratio.",
    icon: IconProp.ChartBar,
    metricIds: [
      "purefb-array-space-utilization",
      "purefb-array-space-empty",
      "purefb-array-data-reduction",
    ],
  },
  {
    key: "performance",
    title: "Performance",
    description:
      "Latency, operations and bandwidth across every protocol the FlashBlade serves.",
    icon: IconProp.Signal,
    metricIds: [
      "purefb-array-read-latency",
      "purefb-array-write-latency",
      "purefb-array-read-iops",
      "purefb-array-write-iops",
      "purefb-array-read-bandwidth",
      "purefb-array-write-bandwidth",
    ],
  },
  {
    key: "file-systems",
    title: "File Systems",
    description:
      "The ten file systems with the highest latency, and the space they use.",
    icon: IconProp.Folder,
    metricIds: [
      "purefb-fs-read-latency",
      "purefb-fs-write-latency",
      "purefb-fs-physical",
    ],
    groupByObject: true,
  },
  {
    key: "buckets",
    title: "Buckets",
    description:
      "The ten buckets with the highest latency, the space they use and the objects they hold.",
    icon: IconProp.Archive,
    metricIds: [
      "purefb-bucket-read-latency",
      "purefb-bucket-physical",
      "purefb-bucket-object-count",
    ],
    groupByObject: true,
  },
  {
    key: "hardware",
    title: "Hardware",
    description:
      "Health of each blade, fabric module, power supply and fan: 1 is healthy, 0 needs a person.",
    icon: IconProp.CPUChip,
    metricIds: ["purefb-hardware-health"],
    groupByObject: true,
  },
];

export function getInsightsSections(
  storageSystem: string | null | undefined,
): Array<InsightsSection> {
  if (storageSystem === StorageSystem.PureStorageFlashArray) {
    return FLASHARRAY_INSIGHTS_SECTIONS;
  }
  if (storageSystem === StorageSystem.PureStorageFlashBlade) {
    return FLASHBLADE_INSIGHTS_SECTIONS;
  }
  return [];
}

export function getInsightsQueries(data: {
  section: InsightsSection;
  arrayName: string;
  storageSystem: string | null | undefined;
}): Array<MetricQueryConfigData> {
  return StorageArrayResourceUtils.buildCatalogQueries(
    data.section.metricIds.map(
      (
        metricId: string,
      ): Parameters<typeof StorageArrayResourceUtils.buildCatalogQuery>[0] => {
        const metric: StorageArrayMetricDefinition | undefined =
          getStorageArrayMetricById(metricId);
        const objectLabel: string | null =
          data.section.groupByObject && metric
            ? getStorageArrayObjectLabel(
                metric.defaultResourceScope,
                data.storageSystem,
                metric.metricName,
              )
            : null;

        return {
          metricId: metricId,
          arrayName: data.arrayName,
          groupByAttributeKeys: objectLabel ? [objectLabel] : undefined,
        };
      },
    ),
  );
}

const StorageArrayInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [storageArray, setStorageArray] = useState<StorageArray | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [startAndEndDate, setStartAndEndDate] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
  );

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  const fetchStorageArray: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: StorageArray | null = await ModelAPI.getItem({
        modelType: StorageArray,
        id: modelId,
        select: {
          name: true,
          storageSystem: true,
        },
      });
      setStorageArray(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchStorageArray().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!storageArray?.name) {
    return <ErrorMessage message="Storage array not found." />;
  }

  const arrayName: string = storageArray.name;
  const sections: Array<InsightsSection> = getInsightsSections(
    storageArray.storageSystem,
  );

  if (sections.length === 0) {
    return (
      <Card
        title="Resource Usage"
        description="The charts on this page depend on the array's platform, which it has not reported yet. They appear once the Storage Array Agent sends its first metrics."
      />
    );
  }

  return (
    /*
     * The cards share the page's one range, so they share one zoom too: a
     * drag on a chart in any card zooms every card, and a double-click on a
     * chart in any card (or "Reset zoom" beside any card's picker) puts the
     * range back, even after a zoom made in another card. A card's Refresh
     * re-sends the zoomed range unchanged, so it keeps the zoom.
     */
    <TimeRangeZoomScope
      timeRange={timeRange}
      onTimeRangeChange={handleTimeRangeChange}
    >
      {sections.map((section: InsightsSection): ReactElement => {
        return (
          <EmbeddedMetricCard
            key={section.key}
            title={
              <div className="flex items-center gap-2">
                <Icon icon={section.icon} className="h-5 w-5 text-gray-500" />
                <span>{translator.translateText(section.title)}</span>
              </div>
            }
            description={section.description}
            queryConfigs={getInsightsQueries({
              section: section,
              arrayName: arrayName,
              storageSystem: storageArray.storageSystem,
            })}
            timeRange={timeRange}
            onTimeRangeChange={handleTimeRangeChange}
            startAndEndDate={startAndEndDate}
          />
        );
      })}
    </TimeRangeZoomScope>
  );
};

export default StorageArrayInsights;
