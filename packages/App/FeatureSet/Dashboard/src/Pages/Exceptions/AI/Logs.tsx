import PageComponentProps from "../../PageComponentProps";
import TelemetryAiLogsPage from "../../../Components/TelemetryAi/TelemetryAiLogsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Exceptions → AI → Logs: everything OneUptime AI did with the exceptions
 * it found.
 */
const ExceptionsAILogs: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiLogsPage lane={TelemetryAiLane.Exception} />;
};

export default ExceptionsAILogs;
