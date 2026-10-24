import PageComponentProps from "../../PageComponentProps";
import TelemetryAiLogsPage from "../../../Components/TelemetryAi/TelemetryAiLogsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Traces → AI → Logs: everything OneUptime AI did with the problems it
 * found in the project's traces.
 */
const TracesAILogs: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiLogsPage lane={TelemetryAiLane.Trace} />;
};

export default TracesAILogs;
