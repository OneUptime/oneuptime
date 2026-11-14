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
      singularName="maintenance event"
      /*
       * The key its saved columns are kept under, from before the record
       * was called a maintenance event (#6817).
       */
      tableKey="scheduled-maintenance-event-llm-logs-table"
      query={{ scheduledMaintenanceId: modelId }}
    />
  );
};

export default ScheduledMaintenanceAILogs;
