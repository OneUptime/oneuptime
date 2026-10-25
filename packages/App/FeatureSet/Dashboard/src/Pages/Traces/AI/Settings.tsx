import PageComponentProps from "../../PageComponentProps";
import TelemetryAiSettingsPage from "../../../Components/TelemetryAi/TelemetryAiSettingsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Traces → AI → Settings: whether OneUptime finds and fixes slow and
 * failing operations - and the tracing they lack - on its own, what it
 * needs to open pull requests, and - under More settings - the AI rules
 * that narrow which services it works on and how.
 */
const TracesAISettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiSettingsPage lane={TelemetryAiLane.Trace} />;
};

export default TracesAISettings;
