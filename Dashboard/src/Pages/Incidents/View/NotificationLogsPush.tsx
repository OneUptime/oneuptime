import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import PushLogsTable from "../../../Components/NotificationLogs/PushLogsTable";

const IncidentPushLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <PushLogsTable
      id="incident-push-logs-table"
      userPreferencesKey="incident-push-logs-table"
      showViewIdButton
      query={{ incidentId: modelId }}
      selectMoreFields={{ statusMessage: true, body: true }}
      cardProps={{
        title: "Push Logs",
        description: "Push notifications sent for this incident.",
      }}
      noItemsMessage="No Push logs for this incident."
    />
  );
};

export default IncidentPushLogs;
