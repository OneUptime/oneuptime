import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import CallLogsTable from "../../../../Components/NotificationLogs/CallLogsTable";

const AnnouncementCallLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <CallLogsTable
      id="announcement-call-logs-table"
      userPreferencesKey="announcement-call-logs-table"
      showViewIdButton
      query={{ statusPageAnnouncementId: modelId }}
      selectMoreFields={{ statusMessage: true }}
      cardProps={{
        title: "Call Logs",
        description: "Calls made for this announcement.",
      }}
      noItemsMessage="No call logs for this announcement."
    />
  );
};

export default AnnouncementCallLogs;
