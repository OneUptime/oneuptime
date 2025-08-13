import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import PushLogsTable from "../../Components/NotificationLogs/PushLogsTable";

const PushLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <PushLogsTable />;
};

export default PushLogs;
