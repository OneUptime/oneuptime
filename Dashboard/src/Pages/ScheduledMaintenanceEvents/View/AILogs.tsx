import React, { FunctionComponent, ReactElement } from "react";
import PageComponentProps from "../../PageComponentProps";
import LlmLogsTable from "../../../Components/AILogs/LlmLogsTable";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";

const ScheduledMaintenanceAILogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <LlmLogsTable
      singularName="scheduled maintenance event"
      query={{ scheduledMaintenanceId: modelId }}
    />
  );
};

export default ScheduledMaintenanceAILogs;
