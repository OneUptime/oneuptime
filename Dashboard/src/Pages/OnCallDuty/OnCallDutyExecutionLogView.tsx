import ExecutionLogTimelineTable from "../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const Settings: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  return <ExecutionLogTimelineTable onCallPolicyExecutionLogId={modelId} />;
};

export default Settings;
