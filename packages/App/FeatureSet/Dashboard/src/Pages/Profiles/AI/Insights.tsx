import PageComponentProps from "../../PageComponentProps";
import AIInsightsPage from "../../AIInsights/Insights";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import { TELEMETRY_AI_INSIGHTS_SCOPES } from "../../../Components/TelemetryAi/TelemetryAiCopy";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Profiler → AI → Insights: the slow code OneUptime found in the project's
 * profiles - AI Insights' inbox, scoped to it, each finding opening in the
 * Profiler's own view.
 */
const ProfilesAIInsights: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <AIInsightsPage
      {...props}
      scope={TELEMETRY_AI_INSIGHTS_SCOPES[TelemetryAiLane.Profile]}
    />
  );
};

export default ProfilesAIInsights;
