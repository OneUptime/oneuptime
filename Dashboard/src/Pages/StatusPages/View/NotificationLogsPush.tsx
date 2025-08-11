import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import PushLogsTable from "../../../Components/NotificationLogs/PushLogsTable";

const StatusPagePushLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <PushLogsTable
      id="status-page-push-logs-table"
      userPreferencesKey="status-page-push-logs-table"
      showViewIdButton
      query={{ statusPageId: modelId }}
      selectMoreFields={{ statusMessage: true, body: true }}
      cardProps={{
        title: "Push Logs",
        description: "Push notifications sent for this status page.",
      }}
      noItemsMessage="No Push logs for this status page."
    />
  );
};

export default StatusPagePushLogs;
