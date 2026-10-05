import PageComponentProps from "../../PageComponentProps";
import IncidentAlertAiLogsPage from "../../../Components/IncidentAlertAi/IncidentAlertAiLogsPage";
import React, { FunctionComponent, ReactElement } from "react";

// Alerts → AI → Logs: everything OneUptime AI did for alerts.
const AlertAILogs: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return <IncidentAlertAiLogsPage {...props} subjectKind="alert" />;
};

export default AlertAILogs;
