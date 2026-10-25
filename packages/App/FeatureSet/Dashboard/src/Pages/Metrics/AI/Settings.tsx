import PageComponentProps from "../../PageComponentProps";
import TelemetryAiSettingsPage from "../../../Components/TelemetryAi/TelemetryAiSettingsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Metrics → AI → Settings: whether OneUptime improves the project's metrics
 * and adds the missing ones on its own, what it needs to open pull
 * requests, and - under More settings - the AI rules that narrow which
 * services it works on and how.
 */
const MetricsAISettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiSettingsPage lane={TelemetryAiLane.Metric} />;
};

export default MetricsAISettings;
