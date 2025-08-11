import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import EmailLogsTable from "../../../../Components/NotificationLogs/EmailLogsTable";

const AnnouncementEmailLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <EmailLogsTable
      id="announcement-email-logs-table"
      userPreferencesKey="announcement-email-logs-table"
      showViewIdButton
      query={{ statusPageAnnouncementId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Email Logs",
        description: "Emails sent for this announcement.",
      }}
      noItemsMessage="No email logs for this announcement."
    />
  );
};

export default AnnouncementEmailLogs;
