import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import SmsLogsTable from "../../../../Components/NotificationLogs/SmsLogsTable";

const AnnouncementSmsLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <SmsLogsTable
      id="announcement-sms-logs-table"
      userPreferencesKey="announcement-sms-logs-table"
      showViewIdButton
      query={{ statusPageAnnouncementId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "SMS Logs",
        description: "SMS sent for this announcement.",
      }}
      noItemsMessage="No SMS logs for this announcement."
    />
  );
};

export default AnnouncementSmsLogs;
