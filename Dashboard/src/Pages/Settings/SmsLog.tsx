import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import SmsLogsTable from "../../Components/NotificationLogs/SmsLogsTable";

const SMSLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <SmsLogsTable />;
};

export default SMSLogs;
