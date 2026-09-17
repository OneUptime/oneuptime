import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import LlmLogsTable from "../../../Components/AILogs/LlmLogsTable";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";

const AlertAILogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <LlmLogsTable singularName="alert" query={{ alertId: modelId }} />;
};

export default AlertAILogs;
