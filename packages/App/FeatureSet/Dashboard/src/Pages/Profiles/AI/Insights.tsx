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
 * Profiler → AI → Insights: the slow code OneUptime found in the project's
 * profiles - AI Insights' inbox, scoped to it, each finding opening in the
 * Profiler's own view. With nothing found while "Find and fix slow code"
 * is off - every project made before it, until someone turns it on - the
 * page says nothing is looked for, not that nothing was found.
 */
const ProfilesAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const readiness: TelemetryAiReadinessState = useTelemetryAiReadiness(
    TelemetryAiLane.Profile,
  );

  return (
    <AIInsightsPage
      {...props}
      scope={getTelemetryAiInsightsScope(
        TelemetryAiLane.Profile,
        readiness.readiness?.isLaneOn === false,
      )}
    />
  );
};

export default ProfilesAIInsights;
