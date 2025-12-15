import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import LlmLogsTable from "../../../Components/AILogs/LlmLogsTable";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";

const IncidentAILogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <LlmLogsTable singularName="incident" query={{ incidentId: modelId }} />;
};

export default IncidentAILogs;
