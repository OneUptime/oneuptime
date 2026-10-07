import PageComponentProps from "../../PageComponentProps";
import IncidentAlertAiLogsPage from "../../../Components/IncidentAlertAi/IncidentAlertAiLogsPage";
import React, { FunctionComponent, ReactElement } from "react";

// Incidents → AI → Logs: everything OneUptime AI did for incidents.
const IncidentAILogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <IncidentAlertAiLogsPage {...props} subjectKind="incident" />;
};

export default IncidentAILogs;
