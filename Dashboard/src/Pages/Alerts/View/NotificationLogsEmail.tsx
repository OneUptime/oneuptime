import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../../Components/NotificationLogs/EmailLogsTable";

const AlertEmailLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EmailLogsTable
      id="alert-email-logs-table"
      userPreferencesKey="alert-email-logs-table"
      showViewIdButton
      query={{ alertId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Email Logs",
        description: "Emails sent for this alert.",
      }}
      noItemsMessage="No email logs for this alert."
    />
  );
};

export default AlertEmailLogs;
