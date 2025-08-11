import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../../Components/NotificationLogs/EmailLogsTable";

const IncidentEmailLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EmailLogsTable
      id="incident-email-logs-table"
      userPreferencesKey="incident-email-logs-table"
      showViewIdButton
      query={{ incidentId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Email Logs",
        description: "Emails sent for this incident.",
      }}
      noItemsMessage="No email logs for this incident."
    />
  );
};

export default IncidentEmailLogs;
