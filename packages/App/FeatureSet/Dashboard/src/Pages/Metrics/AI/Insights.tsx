import PageComponentProps from "../../PageComponentProps";
import AIInsightsPage from "../../AIInsights/Insights";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import { getTelemetryAiInsightsScope } from "../../../Components/TelemetryAi/TelemetryAiCopy";
import {
  TelemetryAiReadinessState,
  useTelemetryAiReadiness,
} from "../../../Components/TelemetryAi/TelemetryAiReadiness";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Metrics → AI → Insights: the high-cardinality metrics, histograms whose
 * buckets do not fit and missing metrics OneUptime found in the project's
 * metrics - AI Insights' inbox, scoped to them, each finding opening in
 * Metrics' own view. With nothing found while "Improve metrics and add
 * missing ones" is off - every project made before it, until someone turns
 * it on - the page says nothing is looked for, not that nothing was found.
 */
const MetricsAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const readiness: TelemetryAiReadinessState = useTelemetryAiReadiness(
    TelemetryAiLane.Metric,
  );

  return (
    <AIInsightsPage
      {...props}
      scope={getTelemetryAiInsightsScope(
        TelemetryAiLane.Metric,
        readiness.readiness?.isLaneOn === false,
      )}
    />
  );
};

export default MetricsAIInsights;
