import PageComponentProps from "../../PageComponentProps";
import TelemetryAiLogsPage from "../../../Components/TelemetryAi/TelemetryAiLogsPage";
import { TelemetryAiLane } from "Common/Types/AI/TelemetryAi";
import React, { FunctionComponent, ReactElement } from "react";

// Profiler → AI → Logs: everything OneUptime AI did with the slow code it found.
const ProfilesAILogs: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return <TelemetryAiLogsPage lane={TelemetryAiLane.Profile} />;
};

export default ProfilesAILogs;
