import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../../Components/NotificationLogs/EmailLogsTable";

const StatusPageEmailLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EmailLogsTable
      id="status-page-email-logs-table"
      userPreferencesKey="status-page-email-logs-table"
      showViewIdButton
      query={{ statusPageId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Email Logs",
        description: "Emails sent for this status page.",
      }}
      noItemsMessage="No email logs for this status page."
    />
  );
};

export default StatusPageEmailLogs;
