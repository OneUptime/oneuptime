import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../Components/NotificationLogs/EmailLogsTable";

const EmailLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <EmailLogsTable />;
};

export default EmailLogs;
