import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { TimeRangeZoomScope } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayInsightsSection,
  StorageArrayPlatform,
} from "Common/Types/StorageArray/StorageArrayPlatform";
import {
  StorageArrayMetricDefinition,
  getStorageArrayMetricById,
  getStorageArrayObjectLabel,
} from "Common/Types/Monitor/StorageArrayMetricCatalog";
import StorageArrayResourceUtils from "../Utils/StorageArrayResourceUtils";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { chartWordsInReadersLanguage } from "../../../Components/Metrics/Utils/ChartWordsInReadersLanguage";

/*
 * Curated MetricView presets sharing one time-range state — the storage
 * array analog of Pages/Ceph/View/Insights.tsx. Every chart is a
 * StorageArrayMetricCatalog entry, so its label filters (the `dimension`
 * that tells a read from a write) are the catalog's; the per-object charts
 * are grouped by the label that names the object on its platform, top 10
 * by value. Explicitly NOT computed recommendations.
 */

/*
 * One card of the page: catalog metric ids drawn together, the per-object
 * ones split by the label that names the object. Each platform lists its
 * own (StorageArrayPlatform.insightsSections).
 */
export type InsightsSection = StorageArrayInsightsSection;

/*
 * The array's platform's cards, in its order; none for an array whose
 * platform is not known yet.
 */
export function getInsightsSections(
  storageSystem: string | null | undefined,
): Array<InsightsSection> {
  const platform: StorageArrayPlatform | null =
    StorageArrayPlatformRegistry.getPlatform(storageSystem);
  return platform ? (platform.insightsSections as Array<InsightsSection>) : [];
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
    return <PageSkeleton shape="chart" />;
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
            isTitleTranslated={true}
            description={section.description}
            queryConfigs={chartWordsInReadersLanguage(
              getInsightsQueries({
                section: section,
                arrayName: arrayName,
                storageSystem: storageArray.storageSystem,
              }),
              translator,
            )}
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
