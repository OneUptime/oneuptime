import PageComponentProps from "../../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import React, { FunctionComponent, ReactElement } from "react";
import PushLogsTable from "../../../../Components/NotificationLogs/PushLogsTable";

const AnnouncementPushLogs: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <PushLogsTable
      id="announcement-push-logs-table"
      userPreferencesKey="announcement-push-logs-table"
      showViewIdButton
      query={{ statusPageAnnouncementId: modelId }}
      selectMoreFields={{ statusMessage: true, body: true }}
      cardProps={{
        title: "Push Logs",
        description: "Push notifications sent for this announcement.",
      }}
      noItemsMessage="No Push logs for this announcement."
    />
  );
};

export default AnnouncementPushLogs;
