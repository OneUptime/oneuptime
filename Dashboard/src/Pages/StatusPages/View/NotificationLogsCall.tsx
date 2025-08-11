import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import CallLogsTable from "../../../Components/NotificationLogs/CallLogsTable";

const StatusPageCallLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CallLogsTable
      id="status-page-call-logs-table"
      userPreferencesKey="status-page-call-logs-table"
      showViewIdButton
      query={{ statusPageId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Call Logs",
        description: "Calls made for this status page.",
      }}
      noItemsMessage="No call logs for this status page."
    />
  );
};

export default StatusPageCallLogs;
