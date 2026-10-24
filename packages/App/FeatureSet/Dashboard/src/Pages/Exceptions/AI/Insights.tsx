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
 * Exceptions → AI → Insights: the new and rising exceptions, and the
 * services whose exceptions carry no stack trace, that OneUptime found -
 * AI Insights' inbox, scoped to them, each finding opening in Exceptions'
 * own view. With nothing found while "Find and fix new and rising
 * exceptions" is off - every project made before it, until someone turns
 * it on - the page says the section is off, not that nothing was found.
 */
const ExceptionsAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const readiness: TelemetryAiReadinessState = useTelemetryAiReadiness(
    TelemetryAiLane.Exception,
  );

  return (
    <AIInsightsPage
      {...props}
      scope={getTelemetryAiInsightsScope(
        TelemetryAiLane.Exception,
        readiness.readiness?.isLaneOn === false,
      )}
    />
  );
};

export default ExceptionsAIInsights;
