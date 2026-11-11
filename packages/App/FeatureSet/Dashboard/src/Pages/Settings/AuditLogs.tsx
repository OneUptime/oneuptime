import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import AuditLogsTable from "../../Components/AuditLogs/AuditLogsTable";

const SettingsAuditLogs: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  return (
    <AuditLogsTable
      title="Audit Logs"
      description="Every change made to the resources in this project, and every time its members sign in or out."
    />
  );
};

export default SettingsAuditLogs;
