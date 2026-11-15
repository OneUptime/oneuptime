import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import {
  buildSloIncidentMetricQueryConfigs,
  SLO_EVENT_METRICS_DEFAULT_TIME_RANGE,
  SLO_INCIDENT_METRICS_CARD,
} from "./SloMetricsQueryConfig";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
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
  const translator: Translator = useTranslator();

  /*
   * Each chart's title, legend and what it shows in the reader's language,
   * looked up once by the builder (#8282); built again only for another SLO
   * or another language, as the translator is built afresh each render.
   */
  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    return buildSloIncidentMetricQueryConfigs({
      sloId: new ObjectID(sloIdString),
      projectId: projectId,
      translator: translator,
    });
  }, [sloIdString, projectId, translator.language]);

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
