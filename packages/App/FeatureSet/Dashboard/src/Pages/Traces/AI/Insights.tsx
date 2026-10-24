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
 * Traces → AI → Insights: the slow operations, failing operations and
 * missing tracing OneUptime found in the project's traces - AI Insights'
 * inbox, scoped to them, each finding opening in Traces' own view. With
 * nothing found while "Find and fix slow and failing operations" is off -
 * every project made before it, until someone turns it on - the page says
 * nothing is looked for, not that nothing was found.
 */
const TracesAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const readiness: TelemetryAiReadinessState = useTelemetryAiReadiness(
    TelemetryAiLane.Trace,
  );

  return (
    <AIInsightsPage
      {...props}
      scope={getTelemetryAiInsightsScope(
        TelemetryAiLane.Trace,
        readiness.readiness?.isLaneOn === false,
      )}
    />
  );
};

export default TracesAIInsights;
