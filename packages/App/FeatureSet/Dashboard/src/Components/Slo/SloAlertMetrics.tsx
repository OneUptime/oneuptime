import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import {
  buildSloAlertMetricQueryConfigs,
  SLO_ALERT_METRICS_CARD,
  SLO_EVENT_METRICS_DEFAULT_TIME_RANGE,
} from "./SloMetricsQueryConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  sloId: ObjectID;
}

/*
 * Alert metrics filtered to the alerts that affect this SLO - the
 * MonitorAlertMetrics card, keyed on serviceLevelObjectiveIds because a
 * burn-rate alert carries no monitor.
 */
const SloAlertMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";
  const sloIdString: string = props.sloId.toString();

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    return buildSloAlertMetricQueryConfigs({
      sloId: new ObjectID(sloIdString),
      projectId: projectId,
    });
  }, [sloIdString, projectId]);

  return (
    <EmbeddedMetricCard
      title={SLO_ALERT_METRICS_CARD.title}
      description={SLO_ALERT_METRICS_CARD.description}
      queryConfigs={queryConfigs}
      defaultTimeRange={SLO_EVENT_METRICS_DEFAULT_TIME_RANGE}
    />
  );
};

export default SloAlertMetrics;
