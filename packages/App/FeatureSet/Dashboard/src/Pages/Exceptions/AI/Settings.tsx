import PageComponentProps from "../../PageComponentProps";
import TelemetryAiSettingsPage from "../../../Components/TelemetryAi/TelemetryAiSettingsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Exceptions → AI → Settings: whether OneUptime finds and fixes new and
 * rising exceptions - and the stack traces they lack - on its own, what it
 * needs to open pull requests, and - under More settings - the AI rules
 * that narrow which services it works on and how.
 */
const ExceptionsAISettings: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiSettingsPage lane={TelemetryAiLane.Exception} />;
};

export default ExceptionsAISettings;
