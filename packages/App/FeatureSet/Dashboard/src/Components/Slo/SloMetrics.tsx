import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import {
  buildSloMetricQueryConfigs,
  getSloMetricCategories,
  SLO_METRICS_DEFAULT_TIME_RANGE,
  SloMetricCategory,
} from "./SloMetricsQueryConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  sloId: ObjectID;
}

/*
 * The oneuptime.slo.* series of one SLO, grouped into cards the way a
 * monitor's Metrics tab groups its own: Objective, Burn and Status. The query
 * shapes live in SloMetricsQueryConfig.ts so they can be tested without a
 * renderer; this component only owns the shared time range.
 */
const SloMetricsElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * One range for every card, so a dip on the SLI and the burn spike that
   * caused it are always read over the same window.
   */
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    SLO_METRICS_DEFAULT_TIME_RANGE,
  );

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
  }, []);

  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";
  const sloIdString: string = props.sloId.toString();

  const categories: Array<SloMetricCategory> = useMemo(() => {
    return getSloMetricCategories();
  }, []);

  /*
   * Memoised on the id STRING: the page hands down a new ObjectID instance on
   * every render, and fresh query configs would make each card refetch.
   */
  const categoryQueryConfigs: Array<Array<MetricQueryConfigData>> =
    useMemo(() => {
      return categories.map(
        (category: SloMetricCategory): Array<MetricQueryConfigData> => {
          return buildSloMetricQueryConfigs({
            sloId: new ObjectID(sloIdString),
            projectId: projectId,
            metrics: category.metrics,
          });
        },
      );
    }, [categories, sloIdString, projectId]);

  return (
    <Fragment>
      {categories.map(
        (category: SloMetricCategory, index: number): ReactElement => {
          return (
            <EmbeddedMetricCard
              key={category.id}
              title={category.title}
              description={category.description}
              queryConfigs={categoryQueryConfigs[index] || []}
              timeRange={timeRange}
              onTimeRangeChange={handleTimeRangeChange}
            />
          );
        },
      )}
    </Fragment>
  );
};

export default SloMetricsElement;
