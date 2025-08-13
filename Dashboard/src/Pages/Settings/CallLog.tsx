import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import CallLogsTable from "../../Components/NotificationLogs/CallLogsTable";

const CallLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <CallLogsTable />;
};

export default CallLogs;
