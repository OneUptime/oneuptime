import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import {
  buildSloIncidentMetricQueryConfigs,
  SLO_EVENT_METRICS_DEFAULT_TIME_RANGE,
  SLO_INCIDENT_METRICS_CARD,
} from "./SloMetricsQueryConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  sloId: ObjectID;
}

/*
 * Incident metrics filtered to the incidents that affect this SLO - the
 * MonitorIncidentMetrics card, keyed on serviceLevelObjectiveIds instead of
 * monitorIds (a burn-rate incident has no monitors to match on).
 */
const SloIncidentMetrics: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: string = ProjectUtil.getCurrentProjectId()?.toString() || "";
  const sloIdString: string = props.sloId.toString();

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    return buildSloIncidentMetricQueryConfigs({
      sloId: new ObjectID(sloIdString),
      projectId: projectId,
    });
  }, [sloIdString, projectId]);

  return (
    <EmbeddedMetricCard
      title={SLO_INCIDENT_METRICS_CARD.title}
      description={SLO_INCIDENT_METRICS_CARD.description}
      queryConfigs={queryConfigs}
      defaultTimeRange={SLO_EVENT_METRICS_DEFAULT_TIME_RANGE}
    />
  );
};

export default SloIncidentMetrics;
