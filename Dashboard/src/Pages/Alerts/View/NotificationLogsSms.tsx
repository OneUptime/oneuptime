import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import SmsLogsTable from "../../../Components/NotificationLogs/SmsLogsTable";

const AlertSmsLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <SmsLogsTable
      id="alert-sms-logs-table"
      userPreferencesKey="alert-sms-logs-table"
      showViewIdButton
      query={{ alertId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{ title: "SMS Logs", description: "SMS sent for this alert." }}
      noItemsMessage="No SMS logs for this alert."
    />
  );
};

export default AlertSmsLogs;
