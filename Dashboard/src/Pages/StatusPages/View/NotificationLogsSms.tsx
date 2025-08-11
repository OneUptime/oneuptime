import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import SmsLogsTable from "../../../Components/NotificationLogs/SmsLogsTable";

const StatusPageSmsLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <SmsLogsTable
      id="status-page-sms-logs-table"
      userPreferencesKey="status-page-sms-logs-table"
      showViewIdButton
      query={{ statusPageId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{ title: "SMS Logs", description: "SMS sent for this status page." }}
      noItemsMessage="No SMS logs for this status page."
    />
  );
};

export default StatusPageSmsLogs;
