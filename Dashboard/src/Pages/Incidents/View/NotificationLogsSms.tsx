import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import SmsLogsTable from "../../../Components/NotificationLogs/SmsLogsTable";

const IncidentSmsLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <SmsLogsTable
      id="incident-sms-logs-table"
      userPreferencesKey="incident-sms-logs-table"
      showViewIdButton
      query={{ incidentId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "SMS Logs",
        description: "SMS sent for this incident.",
      }}
      noItemsMessage="No SMS logs for this incident."
    />
  );
};

export default IncidentSmsLogs;
