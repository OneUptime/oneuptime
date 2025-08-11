import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import CallLogsTable from "../../../Components/NotificationLogs/CallLogsTable";

const IncidentCallLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CallLogsTable
      id="incident-call-logs-table"
      userPreferencesKey="incident-call-logs-table"
      showViewIdButton
      query={{ incidentId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Call Logs",
        description: "Calls made for this incident.",
      }}
      noItemsMessage="No call logs for this incident."
    />
  );
};

export default IncidentCallLogs;
