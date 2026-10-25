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
 * Logs → AI → Insights: the error logs, missing logging and noisy logs
 * OneUptime found in the project's logs - AI Insights' inbox, scoped to
 * them, each finding opening in Logs' own view. With nothing found while
 * "Find and fix error, missing and noisy logs" is off - every project made
 * before it, until someone turns it on - the page says nothing is looked
 * for, not that nothing was found.
 */
const LogsAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const readiness: TelemetryAiReadinessState = useTelemetryAiReadiness(
    TelemetryAiLane.Log,
  );

  return (
    <AIInsightsPage
      {...props}
      scope={getTelemetryAiInsightsScope(
        TelemetryAiLane.Log,
        readiness.readiness?.isLaneOn === false,
      )}
    />
  );
};

export default LogsAIInsights;
