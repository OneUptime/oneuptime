import PageComponentProps from "../../PageComponentProps";
import TelemetryAiLogsPage from "../../../Components/TelemetryAi/TelemetryAiLogsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Logs → AI → Activity: everything OneUptime AI did with the problems it
 * found in the project's logs - the lane's AI logs, named Activity here so
 * they do not read as log lines.
 */
const LogsAIActivity: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiLogsPage lane={TelemetryAiLane.Log} />;
};

export default LogsAIActivity;
