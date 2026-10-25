import PageComponentProps from "../../PageComponentProps";
import TelemetryAiSettingsPage from "../../../Components/TelemetryAi/TelemetryAiSettingsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Logs → AI → Settings: whether OneUptime finds and fixes error, missing
 * and noisy logs on its own, what it needs to open pull requests, and -
 * under More settings - the AI rules that narrow which services it works on
 * and how.
 */
const LogsAISettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiSettingsPage lane={TelemetryAiLane.Log} />;
};

export default LogsAISettings;
