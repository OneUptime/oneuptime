import ExecutionLogsTable from "../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return <ExecutionLogsTable />;
};

export default Settings;
