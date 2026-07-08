import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../PageComponentProps";
import LlmLogsTable from "../../Components/AILogs/LlmLogsTable";

const SettingsAILogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <LlmLogsTable />;
};

export default SettingsAILogs;
