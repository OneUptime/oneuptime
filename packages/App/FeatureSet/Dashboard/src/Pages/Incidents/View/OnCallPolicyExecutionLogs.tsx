import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ExecutionLogsTable from "../../../Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";

const IncidentDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return <ExecutionLogsTable incidentId={modelId} />;
};

export default IncidentDelete;
