import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import PushLogsTable from "../../../Components/NotificationLogs/PushLogsTable";

const AlertPushLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <PushLogsTable
      id="alert-push-logs-table"
      userPreferencesKey="alert-push-logs-table"
      showViewIdButton
      query={{ alertId: modelId }}
      selectMoreFields={{ statusMessage: true, body: true }}
      cardProps={{
        title: "Push Logs",
        description: "Push notifications sent for this alert.",
      }}
      noItemsMessage="No Push logs for this alert."
    />
  );
};

export default AlertPushLogs;
